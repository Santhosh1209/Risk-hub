import { useState, useEffect, useCallback } from "react";
import AgentBricksWindow from "../components/AgentBricksWindow.jsx";
import { getCached, setCached, invalidate } from "../api/cache.js";

const RULES_KEY = "rules/list";

const API = import.meta.env.VITE_API_BASE || "/api";

async function apiFetch(path, opts = {}, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      signal: ctrl.signal,
      ...opts,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  } finally {
    clearTimeout(id);
  }
}

const get  = (path)           => apiFetch(path);
const post = (path, body, ms) => apiFetch(path, { method: "POST", body: JSON.stringify(body) }, ms);

function ruleMetaDesc(rule) {
  const parts = [];
  if (rule.channel && rule.channel !== "ALL") parts.push(`Channel: ${rule.channel}`);
  if (rule.risk_score_threshold != null)       parts.push(`Threshold: score > ${rule.risk_score_threshold}`);
  if (rule.account_age_max_days != null)       parts.push(`Accounts < ${rule.account_age_max_days}d`);
  if (rule.time_window_start != null && rule.time_window_end != null)
    parts.push(`Time: ${rule.time_window_start}:00–${rule.time_window_end}:00`);
  if (rule.merchant_category)                  parts.push(`Category: ${rule.merchant_category}`);
  return parts.join(" · ") || "All transactions";
}

function ruleWhereDesc(rule) {
  const parts = [];
  if (rule.channel && rule.channel !== "ALL") parts.push(`payment_method = '${rule.channel}'`);
  if (rule.risk_score_threshold != null)       parts.push(`risk_score > ${rule.risk_score_threshold}`);
  if (rule.account_age_max_days != null)       parts.push(`account_age_days < ${rule.account_age_max_days}`);
  if (rule.time_window_start != null && rule.time_window_end != null)
    parts.push(`HOUR ∈ [${rule.time_window_start}:00–${rule.time_window_end}:00]`);
  if (rule.merchant_category)                  parts.push(`merchant_category = '${rule.merchant_category}'`);
  return parts.join(" AND ") || "All transactions";
}

const STATUS_STYLE = {
  active: { bg: "rgba(244,63,94,.1)",   color: "#fb7185", border: "rgba(244,63,94,.18)" },
  draft:  { bg: "rgba(245,158,11,.1)",  color: "#fbbf24", border: "rgba(245,158,11,.18)" },
  paused: { bg: "rgba(100,116,139,.1)", color: "#94a3b8", border: "rgba(100,116,139,.2)" },
};

function Spinner({ size = 16 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,.1)", borderTopColor: "#00dba8",
      animation: "re-spin .7s linear infinite",
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <label style={{ position: "relative", width: 30, height: 16, flexShrink: 0, display: "block" }}>
      <input
        type="checkbox" checked={checked} onChange={onChange} disabled={disabled}
        style={{ opacity: 0, width: 0, height: 0, position: "absolute" }}
      />
      <div style={{
        position: "absolute", inset: 0, borderRadius: 8,
        background: checked ? "#00dba8" : "#242f42",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .2s",
      }}>
        <div style={{
          position: "absolute", width: 12, height: 12, top: 2, borderRadius: "50%",
          background: "#fff", left: checked ? 16 : 2, transition: "left .2s",
        }} />
      </div>
    </label>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: "#171e2b", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
      <div style={{ fontSize: 9, color: "#384d63", fontFamily: "monospace", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{
      background: "rgba(244,63,94,.07)", border: "1px solid rgba(244,63,94,.18)",
      borderRadius: 10, padding: "14px 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div>
        <div style={{ fontSize: 12, color: "#fb7185", fontWeight: 600, marginBottom: 3 }}>Failed to load data</div>
        <div style={{ fontSize: 11, color: "#7a8ba0", fontFamily: "monospace" }}>{message}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.2)",
          borderRadius: 6, padding: "5px 12px", color: "#fb7185", fontSize: 11, cursor: "pointer",
        }}>Retry</button>
      )}
    </div>
  );
}

const BTN = {
  fontSize: 10, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
  fontFamily: "inherit", fontWeight: 500, transition: "all .15s",
  border: "1px solid rgba(255,255,255,.1)", background: "transparent", color: "#7a8ba0",
};
const BTN_PRIMARY = {
  ...BTN, background: "#00dba8", color: "#000", border: "none", fontWeight: 700,
};

export default function RuleEngine() {
  const [rules,       setRules]       = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError,   setPageError]   = useState(null);
  const [toggling,    setToggling]    = useState({});
  const [simThr,      setSimThr]      = useState({});
  const [simResult,   setSimResult]   = useState({});
  const [simLoading,  setSimLoading]  = useState({});
  const [modal,       setModal]       = useState(null);

  const loadAll = useCallback(async (bust = false) => {
    setPageLoading(true);
    setPageError(null);
    try {
      if (bust) invalidate(RULES_KEY);
      const cached = getCached(RULES_KEY);
      const r = cached !== null ? cached : await get("/rules/").then(v => setCached(RULES_KEY, v));
      setRules(Array.isArray(r) ? r : []);
    } catch (e) {
      setPageError(e.message);
    } finally {
      setPageLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleToggle = useCallback(async (rule) => {
    const newActive = !rule.is_active;
    setToggling(p => ({ ...p, [rule.rule_id]: true }));
    setRules(prev => prev.map(r =>
      r.rule_id === rule.rule_id
        ? { ...r, is_active: newActive, status: newActive ? "active" : "paused" }
        : r
    ));
    try {
      await post("/rules/toggle", { rule_id: rule.rule_id, is_active: newActive });
    } catch {
      setRules(prev => prev.map(r =>
        r.rule_id === rule.rule_id ? { ...r, is_active: rule.is_active, status: rule.status } : r
      ));
    } finally {
      setToggling(p => ({ ...p, [rule.rule_id]: false }));
    }
  }, []);

  const handleSimulate = useCallback(async (rule) => {
    const newThr = simThr[rule.rule_id] ?? rule.risk_score_threshold ?? 80;
    setSimLoading(p => ({ ...p, [rule.rule_id]: true }));
    setSimResult(p => ({ ...p, [rule.rule_id]: null }));
    try {
      const res = await post("/rules/simulate", {
        rule_id:              rule.rule_id,
        rule_name:            rule.rule_name,
        description:          rule.description,
        channel:              rule.channel || "ALL",
        current_thr:          rule.risk_score_threshold ?? 80,
        new_thr:              newThr,
        merchant_category:    rule.merchant_category || "",
        account_age_max_days: rule.account_age_max_days ?? null,
      }, 120_000);
      setSimResult(p => ({ ...p, [rule.rule_id]: res }));
      if (res.answer) {
        setModal({
          prompt: `Simulate "${rule.rule_name}": threshold ${rule.risk_score_threshold} → ${newThr}`,
          loading: false,
          result: res.answer,
        });
      }
    } catch (e) {
      setSimResult(p => ({ ...p, [rule.rule_id]: { error: e.message } }));
    } finally {
      setSimLoading(p => ({ ...p, [rule.rule_id]: false }));
    }
  }, [simThr]);

  const openAI = useCallback(async (prompt) => {
    setModal({ prompt, loading: true, result: "" });
    try {
      const res = await post("/rules/ask", { question: prompt }, 120_000);
      setModal(m => ({ ...m, loading: false, result: res.answer || "" }));
    } catch (e) {
      setModal(m => ({ ...m, loading: false, result: `Error: ${e.message}` }));
    }
  }, []);

  const activeCount = rules.filter(r => r.is_active).length;
  const draftCount  = rules.filter(r => r.status === "draft").length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes re-spin  { to { transform: rotate(360deg) } }
        @keyframes re-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>

      {/* ── fixed header ── */}
      <div style={{
        padding: "11px 14px", borderBottom: "1px solid rgba(255,255,255,.055)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, background: "#0c0f16",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#d8e0eb" }}>Fraud Rule Engine</div>
          <div style={{ fontSize: 10, color: "#7a8ba0", marginTop: 2 }}>
            {pageLoading
              ? "Loading…"
              : `${activeCount} active rules · ${draftCount} draft pending · AI suggestions available`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={BTN} onClick={() => loadAll(true)}>⟳ Refresh</button>
          <button style={BTN} onClick={() => openAI(
            "Based on current fraud patterns in risk_hub.fraud.risk_events and risk_signals_agg today, " +
            "suggest 3 new fraud rules I should add. For each rule specify: " +
            "the exact column condition (e.g. risk_score > X, account_age_days < Y, payment_method = Z), " +
            "expected fraud reduction %, estimated false positive rate, and $ impact."
          )}>AI suggest new rules</button>
          <button style={BTN_PRIMARY} onClick={() => openAI(
            "Simulate the impact of adding a new rule: block UPI transactions with risk_score > 75 " +
            "between 22:00–06:00 IST. What is the expected fraud reduction and false positive rate " +
            "from today's risk_events data?"
          )}>Simulate rule</button>
        </div>
      </div>

      {/* ── scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

        {pageLoading && (
          <div style={{
            height: 200, display: "flex", alignItems: "center",
            justifyContent: "center", gap: 10, color: "#384d63",
          }}>
            <Spinner size={20} />
            <span style={{ fontSize: 12, fontFamily: "monospace" }}>
              Loading rule engine from risk_hub.fraud…
            </span>
          </div>
        )}

        {!pageLoading && pageError && (
          <ErrorState
            message={`Cannot reach backend: ${pageError}. Is uvicorn running on port 8000?`}
            onRetry={loadAll}
          />
        )}

        {!pageLoading && !pageError && rules.length === 0 && (
          <div style={{
            background: "#111620", border: "1px solid rgba(255,255,255,.055)",
            borderRadius: 12, padding: 32, textAlign: "center", color: "#384d63", fontSize: 12,
          }}>
            No rules found in{" "}
            <span style={{ fontFamily: "monospace", color: "#7a8ba0" }}>
              risk_hub.fraud.rule_engine
            </span>
            . Run the CREATE TABLE + INSERT script first.
          </div>
        )}

        {!pageLoading && !pageError && rules.map(rule => {
          const st        = STATUS_STYLE[rule.status] || STATUS_STYLE.paused;
          const hasThr    = rule.risk_score_threshold != null;
          const simRes    = simResult[rule.rule_id];
          const simLoad   = !!simLoading[rule.rule_id];
          const isToggling = !!toggling[rule.rule_id];
          const fpColor   = (rule.fp_rate_pct  || 0) > 5  ? "#f43f5e"
                          : (rule.fp_rate_pct  || 0) > 2  ? "#f59e0b" : "#22c55e";
          const crColor   = (rule.fraud_caught_pct || 0) > 80 ? "#22c55e"
                          : (rule.fraud_caught_pct || 0) > 50 ? "#f59e0b" : "#f43f5e";

          let simSummary = hasThr
            ? `Current: ${rule.risk_score_threshold} → adjust and simulate`
            : "";
          if (simRes && !simRes.error && simRes.current_data && simRes.new_data) {
            const delta     = (parseInt(simRes.new_data.total)       || 0) - (parseInt(simRes.current_data.total)       || 0);
            const savedDelta = (parseFloat(simRes.new_data.fraud_lakhs) || 0) - (parseFloat(simRes.current_data.fraud_lakhs) || 0);
            simSummary = `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)} blocked · $${Math.abs(savedDelta).toFixed(1)}L ${savedDelta >= 0 ? "more" : "less"} saved`;
          }
          if (simRes?.error) simSummary = `Error: ${simRes.error}`;

          return (
            <div
              key={rule.rule_id}
              style={{
                background: "#111620", border: "1px solid rgba(255,255,255,.055)",
                borderRadius: 12, padding: 13, marginBottom: 8, transition: "border-color .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,.1)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,.055)"}
            >
              {/* rule-top */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#d8e0eb" }}>{rule.rule_name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 9, padding: "2px 7px", borderRadius: 20,
                      fontFamily: "monospace", fontWeight: 600,
                      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                      whiteSpace: "nowrap",
                    }}>
                      {(rule.status || "").toUpperCase()}
                    </span>
                    <span style={{ fontSize: 10, color: "#7a8ba0", fontFamily: "monospace" }}>
                      {ruleMetaDesc(rule)}
                    </span>
                  </div>
                </div>
                {isToggling
                  ? <Spinner size={18} />
                  : <Toggle checked={!!rule.is_active} onChange={() => handleToggle(rule)} />
                }
              </div>

              {/* rule-stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: 10 }}>
                <Stat label="Blocked today"   value={(rule.blocked_count || 0).toLocaleString()} color="#f43f5e" />
                <Stat label="False positive"  value={`${rule.fp_rate_pct || 0}%`}                color={fpColor} />
                <Stat label="Fraud caught"    value={`${rule.fraud_caught_pct || 0}%`}           color={crColor} />
                <Stat label="$ saved"         value={`$${(rule.saved_lakh || 0).toFixed(1)}L`}  color="#00dba8" />
              </div>

              {/* sim-bar */}
              {hasThr && (
                <div style={{ background: "#171e2b", borderRadius: 8, padding: 12, marginTop: 10 }}>
                  <div style={{ fontSize: 10, color: "#7a8ba0", marginBottom: 8 }}>
                    Simulate: change threshold
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "#7a8ba0" }}>Threshold:</span>
                    <input
                      type="number" min={50} max={99}
                      value={simThr[rule.rule_id] ?? rule.risk_score_threshold}
                      onChange={e => setSimThr(p => ({ ...p, [rule.rule_id]: parseInt(e.target.value) }))}
                      style={{
                        width: 80, background: "#07090e",
                        border: "1px solid rgba(255,255,255,.1)",
                        borderRadius: 6, padding: "5px 9px",
                        color: "#d8e0eb", fontFamily: "monospace", fontSize: 11, outline: "none",
                      }}
                    />
                    <button
                      style={{ ...BTN, display: "flex", alignItems: "center", gap: 6 }}
                      onClick={() => handleSimulate(rule)}
                      disabled={simLoad}
                    >
                      {simLoad ? <><Spinner size={10} /> Running…</> : "Simulate with AI"}
                    </button>
                    <span style={{
                      fontSize: 11, fontFamily: "monospace", padding: "6px 12px",
                      background: "#111620", borderRadius: 6, border: "1px solid rgba(255,255,255,.055)",
                      color: "#7a8ba0",
                    }}>
                      {simSummary}
                    </span>
                  </div>
                </div>
              )}

              {/* draft action buttons */}
              {rule.status === "draft" && (
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  <button style={BTN_PRIMARY} onClick={() => openAI(
                    `I want to activate draft rule: '${rule.rule_name}'. ${rule.description}. ` +
                    `Conditions: ${ruleWhereDesc(rule)}. ` +
                    `Query risk_hub.fraud.risk_events to estimate: how many transactions match this condition today, ` +
                    `what fraction have fraud_flag=1 vs 0, total amount affected. ` +
                    `Give a clear go/no-go recommendation with confidence level.`
                  )}>Activate with AI review</button>
                  <button style={BTN} onClick={() => openAI(
                    `Refine the rule '${rule.rule_name}'. What threshold and conditions would ` +
                    `maximize fraud caught while keeping false positives below 2%? ` +
                    `Use data from risk_hub.fraud.risk_events.`
                  )}>AI optimize rule</button>
                </div>
              )}

              {/* active rule — AI analyse button */}
              {rule.is_active && (
                <div style={{ marginTop: 8 }}>
                  <button
                    style={{ ...BTN, display: "flex", alignItems: "center", gap: 5 }}
                    onClick={() => openAI(
                      `Analyse the performance of rule '${rule.rule_name}': ${rule.description}. ` +
                      `Conditions: ${ruleWhereDesc(rule)}. ` +
                      `Live stats today: blocked=${rule.blocked_count || 0}, ` +
                      `fraud_caught_pct=${rule.fraud_caught_pct || 0}%, ` +
                      `fp_rate_pct=${rule.fp_rate_pct || 0}%, ` +
                      `saved=$${rule.saved_lakh || 0}L. ` +
                      `Is this rule optimally configured? Suggest improvements.`
                    )}
                  >
                    <div style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: "#00dba8", animation: "re-pulse 1.5s infinite", flexShrink: 0,
                    }} />
                    AI analyse performance
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AgentBricksWindow modal={modal} onClose={() => setModal(null)} />
    </div>
  );
}
