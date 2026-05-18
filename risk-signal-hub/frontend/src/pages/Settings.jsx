import { useState, useEffect, useCallback } from "react";
import AgentResponse from "../components/AgentResponse.jsx";

const API = import.meta.env.VITE_API_BASE || "/api";

async function apiFetch(path, opts = {}, timeoutMs = 90_000) {
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

const get  = (path)       => apiFetch(path);
const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body) }, 120_000);

// ── design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg: "#07090e", bg2: "#0c0f16", bg3: "#111620", bg4: "#171e2b",
  b: "rgba(255,255,255,.055)", b2: "rgba(255,255,255,.1)",
  t: "#d8e0eb", t2: "#7a8ba0", t3: "#384d63",
  a: "#00dba8", r: "#f43f5e", w: "#f59e0b", g: "#22c55e", p: "#a78bfa",
};

const BTN = {
  fontSize: 10, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
  fontFamily: "inherit", fontWeight: 500, transition: "all .15s",
  border: "1px solid rgba(255,255,255,.1)", background: "transparent", color: "#7a8ba0",
};
const BTN_PRIMARY = {
  ...BTN, background: "#00dba8", color: "#000", border: "none", fontWeight: 700,
};
const BTN_GHOST = {
  ...BTN, border: "1px solid rgba(0,219,168,.25)", color: "#00dba8",
};

// ── shared primitives ──────────────────────────────────────────────────────────
function Spinner({ size = 14 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,.1)", borderTopColor: "#00dba8",
      animation: "s-spin .7s linear infinite", display: "inline-block", flexShrink: 0,
    }} />
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <label style={{ position: "relative", width: 34, height: 18, flexShrink: 0, display: "block" }}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled}
        style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
      <div style={{
        position: "absolute", inset: 0, borderRadius: 9,
        background: checked ? "#00dba8" : "#242f42",
        cursor: disabled ? "not-allowed" : "pointer", transition: "background .2s",
      }}>
        <div style={{
          position: "absolute", width: 14, height: 14, top: 2, borderRadius: "50%",
          background: "#fff", left: checked ? 18 : 2, transition: "left .2s",
        }} />
      </div>
    </label>
  );
}

function SectionCard({ title, children }) {
  return (
    <div style={{
      background: C.bg3, border: `1px solid ${C.b}`,
      borderRadius: 12, marginBottom: 14, overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px", borderBottom: `1px solid ${C.b}`,
        background: C.bg2,
        fontSize: 11, fontWeight: 600, color: C.t, letterSpacing: ".02em",
      }}>
        {title}
      </div>
      <div style={{ padding: 14 }}>
        {children}
      </div>
    </div>
  );
}

// ── threshold slider row ───────────────────────────────────────────────────────
function SliderRow({ label, description, value, min, max, onChange, unit = "" }) {
  const pct = ((value - min) / (max - min)) * 100;
  const trackColor = `linear-gradient(to right, #00dba8 ${pct}%, rgba(255,255,255,.08) ${pct}%)`;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 11, color: C.t, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 10, color: C.t2, marginTop: 2 }}>{description}</div>
        </div>
        <div style={{
          minWidth: 52, textAlign: "center",
          background: C.bg4, border: `1px solid ${C.b2}`,
          borderRadius: 6, padding: "4px 8px",
          fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.a,
        }}>
          {value}{unit}
        </div>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        style={{
          width: "100%", height: 4, appearance: "none", borderRadius: 2,
          background: trackColor, outline: "none", cursor: "pointer",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>{min}{unit}</span>
        <span style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>{max}{unit}</span>
      </div>
    </div>
  );
}

// ── alert toggle row ───────────────────────────────────────────────────────────
function AlertRow({ label, description, checked, onChange, saving }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0", borderBottom: `1px solid ${C.b}`,
    }}>
      <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
        <div style={{ fontSize: 11, color: C.t, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 10, color: C.t2, marginTop: 2 }}>{description}</div>
      </div>
      {saving
        ? <Spinner size={16} />
        : <Toggle checked={checked} onChange={onChange} />
      }
    </div>
  );
}

// ── playbook card ──────────────────────────────────────────────────────────────
function PlaybookCard({ playbook, onOpen }) {
  return (
    <div
      onClick={() => onOpen(playbook)}
      style={{
        background: C.bg4, border: `1px solid ${C.b}`,
        borderRadius: 10, padding: "12px 14px", marginBottom: 8,
        cursor: "pointer", transition: "border-color .15s, background .15s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "rgba(0,219,168,.25)";
        e.currentTarget.style.background = "rgba(0,219,168,.04)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = C.b;
        e.currentTarget.style.background = C.bg4;
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.t }}>{playbook.name}</div>
          <div style={{ fontSize: 10, color: C.t2, marginTop: 3 }}>{playbook.description}</div>
        </div>
        <div style={{
          fontSize: 9, color: C.a, fontFamily: "monospace", fontWeight: 600,
          padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(0,219,168,.2)",
          background: "rgba(0,219,168,.06)", marginLeft: 10, flexShrink: 0,
        }}>
          OPEN →
        </div>
      </div>
    </div>
  );
}

// ── playbook modal ─────────────────────────────────────────────────────────────
function PlaybookModal({ playbook, onClose }) {
  const [question, setQuestion]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [answer, setAnswer]       = useState("");

  async function handleAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const res = await post("/settings/playbooks/ask", {
        playbook_id: playbook.playbook_id,
        name:        playbook.name,
        question:    question,
        context:     `Playbook: ${playbook.name}\n${playbook.description}\nSteps:\n${playbook.steps}`,
      });
      setAnswer(res.answer || "");
    } catch (e) {
      setAnswer(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const steps = (playbook.steps || "").split("\n").filter(Boolean);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 500,
    }}>
      <div style={{
        background: C.bg2, border: `1px solid ${C.b2}`,
        borderRadius: 14, width: 540, maxHeight: "80vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,.6)",
        overflow: "hidden",
      }}>
        {/* header */}
        <div style={{
          padding: "12px 16px", borderBottom: `1px solid ${C.b}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.bg3, flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.t }}>{playbook.name}</div>
            <div style={{ fontSize: 10, color: C.t2, marginTop: 2 }}>{playbook.description}</div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: C.t2,
            fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "2px 6px",
          }}>×</button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {/* steps */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: C.t3, fontFamily: "monospace", marginBottom: 8, fontWeight: 600 }}>
              RESPONSE STEPS
            </div>
            {steps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                <span style={{
                  minWidth: 20, height: 20, borderRadius: "50%",
                  background: "rgba(0,219,168,.12)", color: C.a,
                  fontSize: 9, fontWeight: 700, display: "flex",
                  alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 11, color: C.t2, lineHeight: 1.65 }}>
                  {step.replace(/^\d+\.\s*/, "")}
                </span>
              </div>
            ))}
          </div>

          {/* AI Q&A */}
          <div style={{ borderTop: `1px solid ${C.b}`, paddingTop: 14 }}>
            <div style={{ fontSize: 10, color: C.t3, fontFamily: "monospace", marginBottom: 8, fontWeight: 600 }}>
              ASK AI ABOUT THIS PLAYBOOK
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAsk()}
                placeholder="e.g. How do I adapt this for mobile payments?"
                style={{
                  flex: 1, background: C.bg4, border: `1px solid ${C.b2}`,
                  borderRadius: 6, padding: "7px 10px",
                  color: C.t, fontSize: 11, outline: "none", fontFamily: "inherit",
                }}
              />
              <button
                onClick={handleAsk}
                disabled={loading || !question.trim()}
                style={{
                  ...BTN_PRIMARY,
                  display: "flex", alignItems: "center", gap: 5,
                  opacity: loading || !question.trim() ? 0.5 : 1,
                }}
              >
                {loading ? <><Spinner size={11} /> Asking…</> : "Ask"}
              </button>
            </div>
            {answer && <AgentResponse text={answer} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── static data ────────────────────────────────────────────────────────────────
const _DEFAULT_THR = {
  upi_block_score:        85,
  card_block_score:       80,
  velocity_txn_per_10min: 5,
  new_account_txn_per_hr: 5,
};

const _DEFAULT_ALERT = {
  slack_enabled:       true,
  email_digest_hourly: true,
  sms_critical:        true,
  auto_escalate_30min: false,
  weekend_oncall:      true,
};

const ALERT_DEFS = [
  { key: "slack_enabled",       label: "Slack Alerts",              description: "Push fraud alerts to #fraud-alerts Slack channel" },
  { key: "email_digest_hourly", label: "Email Hourly Digest",        description: "Send aggregated hourly report to fraud-ops@company.com" },
  { key: "sms_critical",        label: "SMS for CRITICAL cases",    description: "Trigger SMS to on-call analyst for CRITICAL severity" },
  { key: "auto_escalate_30min", label: "Auto-escalate after 30min", description: "Automatically escalate open cases unresolved for 30+ minutes" },
  { key: "weekend_oncall",      label: "Weekend on-call routing",   description: "Route weekend alerts to weekend on-call team" },
];

const STATUS_ITEMS = [
  { label: "Databricks connection", value: "Connected",      color: "#22c55e" },
  { label: "Genie space",           value: "Active",         color: "#22c55e" },
  { label: "Model endpoint",        value: "LLaMA-3.3-70B",  color: "#00dba8" },
  { label: "Email relay",           value: "Gmail SMTP",     color: "#00dba8" },
  { label: "Data catalog",          value: "risk_hub.fraud", color: "#7a8ba0" },
];

// ── main component ─────────────────────────────────────────────────────────────
export default function Settings() {
  const [thresholds,    setThresholds]    = useState(_DEFAULT_THR);
  const [draftThr,      setDraftThr]      = useState(_DEFAULT_THR);
  const [alerts,        setAlerts]        = useState(_DEFAULT_ALERT);
  const [playbooks,     setPlaybooks]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [savingThr,     setSavingThr]     = useState(false);
  const [savingAlert,   setSavingAlert]   = useState({});
  const [simLoading,    setSimLoading]    = useState(false);
  const [simResult,     setSimResult]     = useState("");
  const [openPlaybook,  setOpenPlaybook]  = useState(null);
  const [createText,    setCreateText]    = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createResult,  setCreateResult]  = useState("");
  const [showCreate,    setShowCreate]    = useState(false);
  const [thrSaved,      setThrSaved]      = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [thr, alt, pb] = await Promise.all([
        get("/settings/thresholds"),
        get("/settings/alerts"),
        get("/settings/playbooks"),
      ]);
      setThresholds(thr);
      setDraftThr(thr);
      setAlerts(alt);
      setPlaybooks(Array.isArray(pb) ? pb : []);
    } catch {
      // keep defaults on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaveThresholds = async () => {
    setSavingThr(true);
    try {
      await post("/settings/thresholds", draftThr);
      setThresholds(draftThr);
      setThrSaved(true);
      setTimeout(() => setThrSaved(false), 2500);
    } catch {/* ignore */} finally {
      setSavingThr(false);
    }
  };

  const handleToggleAlert = async (key, currentVal) => {
    const newVal = !currentVal;
    setAlerts(p => ({ ...p, [key]: newVal }));
    setSavingAlert(p => ({ ...p, [key]: true }));
    try {
      await post("/settings/alerts", { [key]: newVal });
    } catch {
      setAlerts(p => ({ ...p, [key]: currentVal }));
    } finally {
      setSavingAlert(p => ({ ...p, [key]: false }));
    }
  };

  const handleSimulate = async () => {
    setSimLoading(true);
    setSimResult("");
    try {
      const res = await post("/settings/simulate", draftThr);
      setSimResult(res.answer || "");
    } catch (e) {
      setSimResult(`Error: ${e.message}`);
    } finally {
      setSimLoading(false);
    }
  };

  const handleCreatePlaybook = async () => {
    if (!createText.trim()) return;
    setCreateLoading(true);
    setCreateResult("");
    try {
      const res = await post("/settings/playbooks/create", { description: createText });
      setCreateResult(res.answer || "");
    } catch (e) {
      setCreateResult(`Error: ${e.message}`);
    } finally {
      setCreateLoading(false);
    }
  };

  const thrChanged = JSON.stringify(draftThr) !== JSON.stringify(thresholds);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes s-spin { to { transform: rotate(360deg) } }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
          background: #00dba8; cursor: pointer; border: 2px solid #0c0f16;
          box-shadow: 0 0 4px rgba(0,219,168,.4);
        }
        input[type=range]::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%;
          background: #00dba8; cursor: pointer; border: 2px solid #0c0f16;
        }
      `}</style>

      {/* header */}
      <div style={{
        padding: "11px 14px", borderBottom: `1px solid ${C.b}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, background: C.bg2,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.t }}>Settings & Configuration</div>
          <div style={{ fontSize: 10, color: C.t2, marginTop: 2 }}>
            Risk thresholds · Alert routing · Playbooks
          </div>
        </div>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.t2, fontSize: 10 }}>
            <Spinner size={14} /> Loading…
          </div>
        )}
      </div>

      {/* two-column scrollable body */}
      <div style={{
        flex: 1, overflowY: "auto", padding: 14,
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignContent: "start",
      }}>

        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <div>

          {/* Risk Thresholds */}
          <SectionCard title="Risk Thresholds">
            <SliderRow
              label="UPI Block Score"
              description="Block UPI transactions above this risk score"
              value={draftThr.upi_block_score}
              min={50} max={99}
              onChange={v => setDraftThr(p => ({ ...p, upi_block_score: v }))}
            />
            <SliderRow
              label="Card Block Score"
              description="Block card transactions above this risk score"
              value={draftThr.card_block_score}
              min={50} max={99}
              onChange={v => setDraftThr(p => ({ ...p, card_block_score: v }))}
            />
            <SliderRow
              label="Velocity Limit / 10 min"
              description="Max transactions per 10 minutes per account"
              value={draftThr.velocity_txn_per_10min}
              min={1} max={20}
              unit=" txns"
              onChange={v => setDraftThr(p => ({ ...p, velocity_txn_per_10min: v }))}
            />
            <SliderRow
              label="New Account Txns / hr"
              description="Max transactions per hour for new accounts"
              value={draftThr.new_account_txn_per_hr}
              min={1} max={20}
              unit=" txns"
              onChange={v => setDraftThr(p => ({ ...p, new_account_txn_per_hr: v }))}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                onClick={handleSaveThresholds}
                disabled={savingThr || !thrChanged}
                style={{
                  ...BTN_PRIMARY,
                  opacity: savingThr || !thrChanged ? 0.5 : 1,
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                {savingThr ? <><Spinner size={11} /> Saving…</> : thrSaved ? "Saved ✓" : "Save thresholds"}
              </button>

              <button
                onClick={handleSimulate}
                disabled={simLoading}
                style={{
                  ...BTN_GHOST,
                  display: "flex", alignItems: "center", gap: 5,
                  opacity: simLoading ? 0.6 : 1,
                }}
              >
                {simLoading ? <><Spinner size={11} /> Simulating…</> : "Simulate impact with AI"}
              </button>
            </div>

            {simResult && (
              <div style={{ marginTop: 12 }}>
                <AgentResponse text={simResult} />
              </div>
            )}
          </SectionCard>

          {/* Alert Routing */}
          <SectionCard title="Alert Routing">
            {ALERT_DEFS.map(({ key, label, description }) => (
              <AlertRow
                key={key}
                label={label}
                description={description}
                checked={!!alerts[key]}
                onChange={() => handleToggleAlert(key, alerts[key])}
                saving={!!savingAlert[key]}
              />
            ))}
          </SectionCard>
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────────────────────── */}
        <div>

          {/* Saved Playbooks */}
          <SectionCard title="Saved Playbooks">
            {playbooks.map(pb => (
              <PlaybookCard key={pb.playbook_id} playbook={pb} onOpen={setOpenPlaybook} />
            ))}

            {/* Create with AI toggle */}
            <button
              onClick={() => { setShowCreate(v => !v); setCreateResult(""); }}
              style={{ ...BTN_GHOST, marginTop: 6, width: "100%", justifyContent: "center" }}
            >
              {showCreate ? "Cancel" : "+ Create with AI"}
            </button>

            {showCreate && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: C.t2, marginBottom: 6 }}>
                  Describe the situation or threat scenario:
                </div>
                <textarea
                  value={createText}
                  onChange={e => setCreateText(e.target.value)}
                  placeholder="e.g. Sudden spike in UPI transactions from new devices in metro areas after midnight…"
                  rows={3}
                  style={{
                    width: "100%", background: C.bg4, border: `1px solid ${C.b2}`,
                    borderRadius: 8, padding: "8px 10px", color: C.t,
                    fontSize: 11, resize: "vertical", fontFamily: "inherit",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={handleCreatePlaybook}
                  disabled={createLoading || !createText.trim()}
                  style={{
                    ...BTN_PRIMARY, marginTop: 8,
                    display: "flex", alignItems: "center", gap: 5,
                    opacity: createLoading || !createText.trim() ? 0.5 : 1,
                  }}
                >
                  {createLoading ? <><Spinner size={11} /> Generating…</> : "Generate playbook"}
                </button>

                {createResult && (
                  <div style={{ marginTop: 10 }}>
                    <AgentResponse text={createResult} />
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* quick-stat cards */}
          <SectionCard title="System Status">
            {STATUS_ITEMS.map(({ label, value, color }) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 0", borderBottom: `1px solid ${C.b}`,
              }}>
                <span style={{ fontSize: 11, color: C.t2 }}>{label}</span>
                <span style={{ fontSize: 11, color, fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </SectionCard>
        </div>
      </div>

      {/* Playbook modal */}
      {openPlaybook && (
        <PlaybookModal playbook={openPlaybook} onClose={() => setOpenPlaybook(null)} />
      )}
    </div>
  );
}

