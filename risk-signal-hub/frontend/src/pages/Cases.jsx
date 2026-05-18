import { useState, useEffect, useCallback } from "react";
import AgentResponse from "../components/AgentResponse.jsx";
import { askAgent }  from "../api/agent.js";
import { fetchCases, fetchCaseCounts, updateStatus, updateNotes, sendEmail, CASES_KEYS } from "../api/cases.js";
import { invalidate } from "../api/cache.js";

// ── shared primitives ──────────────────────────────────────────────────────

function Spinner({ size = 16 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,.1)",
      borderTopColor: "#00dba8",
      animation: "cm-spin .7s linear infinite",
      display: "inline-block", flexShrink: 0,
    }} />
  );
}

// Each button tracks its own key — only the button whose key matches loadingKey shows spinner
function AiButton({ label, btnKey, loadingKey, onClick }) {
  const isMe = loadingKey === btnKey;
  const busy  = loadingKey !== null;
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "transparent",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 6, padding: "5px 11px",
        color: isMe ? "#384d63" : busy ? "#2a3548" : "#7a8ba0",
        fontSize: 11,
        cursor: busy ? "not-allowed" : "pointer",
        transition: "color .15s",
      }}
    >
      {isMe
        ? <Spinner size={10} />
        : <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: busy ? "#2a3548" : "#00dba8",
            animation: busy ? "none" : "cm-pulse 1.5s infinite",
          }} />}
      {isMe ? "Analysing…" : label}
    </button>
  );
}

// ── severity / status config ───────────────────────────────────────────────

const SEV = {
  CRITICAL: { bg: "rgba(244,63,94,.08)",  color: "#fb7185", border: "rgba(244,63,94,.2)" },
  WARNING:  { bg: "rgba(245,158,11,.08)", color: "#fbbf24", border: "rgba(245,158,11,.2)" },
  INFO:     { bg: "rgba(34,197,94,.08)",  color: "#4ade80", border: "rgba(34,197,94,.2)" },
};

const STATUS_CFG = {
  open:          { bg: "rgba(14,165,233,.08)",  color: "#38bdf8", border: "rgba(14,165,233,.2)" },
  investigating: { bg: "rgba(167,139,250,.08)", color: "#a78bfa", border: "rgba(167,139,250,.2)" },
  escalated:     { bg: "rgba(244,63,94,.08)",   color: "#fb7185", border: "rgba(244,63,94,.2)" },
  closed:        { bg: "rgba(100,116,139,.1)",  color: "#94a3b8", border: "rgba(100,116,139,.2)" },
};

const STATUS_TRANSITIONS = {
  open:          ["Investigating", "Escalated", "Closed"],
  investigating: ["Escalated", "Closed", "Open"],
  escalated:     ["Investigating", "Closed"],
  closed:        ["Open"],
};

function Badge({ label, bg, color, border }) {
  return (
    <span style={{
      fontSize: 9, padding: "2px 8px", borderRadius: 20,
      fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap",
      background: bg, color, border: `1px solid ${border}`,
    }}>
      {label}
    </span>
  );
}

function statusCfg(status = "") {
  return STATUS_CFG[status.toLowerCase()] || STATUS_CFG.closed;
}

function sevCfg(sev = "") {
  return SEV[sev.toUpperCase()] || SEV.INFO;
}

// ── case AI context ────────────────────────────────────────────────────────

function caseCtx(c, expLakh) {
  return (
    `Case: ${c.case_id} | ${c.title}\n` +
    `Severity: ${c.severity} | Status: ${c.status}\n` +
    `Exposure: $${expLakh}L | Merchant: ${c.merchant_id || "unknown"}\n` +
    `Opened: ${c.created_at || ""}\n` +
    `Notes: ${c.notes || "none"}`
  );
}

// ── filter labels ──────────────────────────────────────────────────────────

const FILTER_LABELS = ["all", "open", "investigating", "escalated", "closed"];

// ═══════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════

export default function Cases() {
  const [cases,       setCases]       = useState([]);
  const [counts,      setCounts]      = useState({});
  const [filter,      setFilter]      = useState("all");
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError,   setPageError]   = useState(null);

  // per-case UI state
  const [expanded,   setExpanded]   = useState({});
  const [statusBusy, setStatusBusy] = useState({});
  const [notesDraft, setNotesDraft] = useState({});
  const [notesBusy,  setNotesBusy]  = useState({});

  // AI panel — loadingKey is "{caseId}-{action}" or null; only that button spins
  const [loadingKey,    setLoadingKey]    = useState(null);
  const [aiResult,      setAiResult]      = useState("");
  const [aiLabel,       setAiLabel]       = useState("");
  const [aiError,       setAiError]       = useState("");
  const [isEscalation,  setIsEscalation]  = useState(false);

  // email send state
  const [recipients,   setRecipients]   = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody,    setEmailBody]    = useState("");
  const [sendBusy,     setSendBusy]     = useState(false);
  const [sendStatus,   setSendStatus]   = useState(null); // "sent" | "error" | null
  const [sendError,    setSendError]    = useState("");

  // ── load ────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setPageLoading(true);
    setPageError(null);
    try {
      const [c, k] = await Promise.all([fetchCases(filter), fetchCaseCounts()]);
      setCases(Array.isArray(c) ? c : []);
      setCounts(k || {});
    } catch (e) {
      setPageError(e.message);
    } finally {
      setPageLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── status change → writes to DB ────────────────────────────────────────

  const handleStatusChange = useCallback(async (caseId, newStatus) => {
    const prev = cases.find(x => x.case_id === caseId);
    setStatusBusy(p => ({ ...p, [caseId]: true }));
    setCases(p => p.map(c => c.case_id === caseId ? { ...c, status: newStatus } : c));
    try {
      await updateStatus(caseId, newStatus);
      invalidate(CASES_KEYS.counts, ...FILTER_LABELS.map(f => CASES_KEYS.list(f)));
      const k = await fetchCaseCounts();
      setCounts(k || {});
    } catch {
      setCases(p => p.map(c => c.case_id === caseId ? { ...c, status: prev?.status || c.status } : c));
    } finally {
      setStatusBusy(p => ({ ...p, [caseId]: false }));
    }
  }, [cases]);

  // ── notes save → writes to DB ────────────────────────────────────────────

  const handleNotesSave = useCallback(async (caseItem) => {
    const draft = notesDraft[caseItem.case_id];
    if (draft === undefined) return;
    setNotesBusy(p => ({ ...p, [caseItem.case_id]: true }));
    try {
      await updateNotes(caseItem.case_id, draft);
      invalidate(...FILTER_LABELS.map(f => CASES_KEYS.list(f)));
      setCases(p => p.map(c => c.case_id === caseItem.case_id ? { ...c, notes: draft } : c));
      setNotesDraft(p => { const n = { ...p }; delete n[caseItem.case_id]; return n; });
    } catch (e) {
      setAiError(`Notes save failed: ${e.message}`);
    } finally {
      setNotesBusy(p => ({ ...p, [caseItem.case_id]: false }));
    }
  }, [notesDraft]);

  // ── AI via askAgent (Genie → Agent Bricks chain) ─────────────────────────
  // btnKey format: "{caseId}-investigate" | "{caseId}-escalate" | "{caseId}-action"

  const runAI = useCallback(async (btnKey, question, label, escalation = false) => {
    setLoadingKey(btnKey);
    setAiResult("");
    setAiError("");
    setAiLabel(label);
    setIsEscalation(escalation);
    setSendStatus(null);
    setSendError("");
    setRecipients("");
    try {
      const res = await askAgent(question);
      const answer = res.answer || "";
      setAiResult(answer);
      if (escalation) {
        const { subject, body } = parseEmail(answer);
        setEmailSubject(subject);
        setEmailBody(body);
      }
    } catch (e) {
      setAiError(e.message);
    } finally {
      setLoadingKey(null);
    }
  }, []);

  // ── parse subject + body from escalation draft ────────────────────────────
  // Expects the AI to produce a "Subject: ..." line somewhere in the email body
  function parseEmail(raw) {
    const bodyOnly = raw.replace(/^##\s+Escalation Email\s*/m, "").trim();
    const subjectMatch = bodyOnly.match(/^Subject:\s*(.+)/im);
    const subject = subjectMatch ? subjectMatch[1].trim() : "Fraud Escalation Alert";
    const body = subjectMatch
      ? bodyOnly.slice(bodyOnly.indexOf(subjectMatch[0]) + subjectMatch[0].length).trim()
      : bodyOnly;
    return { subject, body };
  }

  // ── send via SES ──────────────────────────────────────────────────────────
  const handleSendEmail = useCallback(async () => {
    const toList = recipients.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!toList.length || !emailSubject.trim() || !emailBody.trim()) return;
    setSendBusy(true);
    setSendStatus(null);
    setSendError("");
    try {
      await sendEmail(toList, emailSubject.trim(), emailBody.trim());
      setSendStatus("sent");
    } catch (e) {
      setSendStatus("error");
      setSendError(e.message);
    } finally {
      setSendBusy(false);
    }
  }, [recipients, emailSubject, emailBody]);

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 14 }}>
      <style>{`
        @keyframes cm-spin  { to { transform: rotate(360deg) } }
        @keyframes cm-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>

      {/* ── page loading ── */}
      {pageLoading && (
        <div style={{
          height: 300, display: "flex", alignItems: "center",
          justifyContent: "center", gap: 10, color: "#384d63",
        }}>
          <Spinner size={20} />
          <span style={{ fontSize: 12, fontFamily: "monospace" }}>
            Loading cases from risk_hub.fraud.cases…
          </span>
        </div>
      )}

      {/* ── page error ── */}
      {!pageLoading && pageError && (
        <div style={{
          background: "rgba(244,63,94,.07)", border: "1px solid rgba(244,63,94,.18)",
          borderRadius: 10, padding: "14px 16px", marginBottom: 14,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 12, color: "#fb7185", fontWeight: 600, marginBottom: 3 }}>
              Failed to load cases
            </div>
            <div style={{ fontSize: 11, color: "#7a8ba0", fontFamily: "monospace" }}>
              {pageError}
            </div>
          </div>
          <button onClick={loadAll} style={{
            background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.2)",
            borderRadius: 6, padding: "5px 12px", color: "#fb7185",
            fontSize: 11, cursor: "pointer",
          }}>Retry</button>
        </div>
      )}

      {!pageLoading && !pageError && (
        <>
          {/* ── header ── */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#d8e0eb", marginBottom: 3 }}>
              Case Manager
            </div>
            <div style={{ fontSize: 11, color: "#7a8ba0" }}>
              {counts.all || 0} total · {counts.open || 0} open · {counts.investigating || 0} investigating · from{" "}
              <span style={{ fontFamily: "monospace", color: "#384d63" }}>risk_hub.fraud.cases</span>
            </div>
          </div>

          {/* ── KPI strip ── */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4,1fr)",
            gap: 8, marginBottom: 14,
          }}>
            {[
              ["Open",          counts.open          || 0, "#38bdf8"],
              ["Investigating", counts.investigating  || 0, "#a78bfa"],
              ["Escalated",     counts.escalated      || 0, "#fb7185"],
              ["Closed",        counts.closed         || 0, "#4ade80"],
            ].map(([label, value, color]) => (
              <div key={label} style={{
                background: "#111620", border: "1px solid rgba(255,255,255,.055)",
                borderRadius: 10, padding: "10px 12px",
              }}>
                <div style={{
                  fontSize: 9, color: "#384d63", fontFamily: "monospace",
                  textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 4,
                }}>
                  {label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* ── filter bar ── */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {FILTER_LABELS.map(f => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: "5px 13px", borderRadius: 20, fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    background: active ? "rgba(0,219,168,.12)" : "transparent",
                    border: active ? "1px solid rgba(0,219,168,.35)" : "1px solid rgba(255,255,255,.08)",
                    color: active ? "#00dba8" : "#7a8ba0",
                    cursor: "pointer",
                  }}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  <span style={{
                    marginLeft: 6, fontSize: 9, fontFamily: "monospace",
                    color: active ? "#00dba8" : "#384d63",
                  }}>
                    {counts[f] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── AI result panel ── */}
          {(loadingKey !== null || aiResult || aiError) && (
            <div style={{
              background: "#111620", border: "1px solid rgba(255,255,255,.055)",
              borderRadius: 12, padding: 14, marginBottom: 14,
            }}>
              {aiLabel && (
                <div style={{
                  fontSize: 9, color: "#384d63", fontFamily: "monospace",
                  textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8,
                }}>
                  {aiLabel}
                </div>
              )}
              {loadingKey !== null && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#384d63", fontSize: 11 }}>
                  <Spinner />
                  Analysing…
                </div>
              )}
              {loadingKey === null && aiError && (
                <div style={{ fontSize: 11, color: "#fb7185", fontFamily: "monospace" }}>
                  Error: {aiError}
                </div>
              )}
              {loadingKey === null && aiResult && <AgentResponse text={aiResult} />}

              {/* ── send email form — only after escalation drafts ── */}
              {loadingKey === null && aiResult && isEscalation && (
                <div style={{
                  marginTop: 14, paddingTop: 14,
                  borderTop: "1px solid rgba(255,255,255,.06)",
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <div style={{
                    fontSize: 9, color: "#384d63", fontFamily: "monospace",
                    textTransform: "uppercase", letterSpacing: ".08em",
                  }}>
                    Send this email
                  </div>

                  {/* Subject */}
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={e => { setEmailSubject(e.target.value); setSendStatus(null); }}
                    placeholder="Subject"
                    style={{
                      background: "#07090e", border: "1px solid rgba(255,255,255,.12)",
                      borderRadius: 7, padding: "7px 11px",
                      color: "#d8e0eb", fontSize: 12, outline: "none",
                      fontFamily: "inherit", fontWeight: 600,
                    }}
                  />

                  {/* Body */}
                  <textarea
                    rows={8}
                    value={emailBody}
                    onChange={e => { setEmailBody(e.target.value); setSendStatus(null); }}
                    style={{
                      background: "#07090e", border: "1px solid rgba(255,255,255,.12)",
                      borderRadius: 7, padding: "8px 11px",
                      color: "#d8e0eb", fontSize: 12, outline: "none",
                      fontFamily: "inherit", lineHeight: 1.6,
                      resize: "vertical", boxSizing: "border-box", width: "100%",
                    }}
                  />

                  {/* Recipients + Send */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      value={recipients}
                      onChange={e => { setRecipients(e.target.value); setSendStatus(null); }}
                      placeholder="To: recipient@company.com, another@company.com"
                      style={{
                        flex: 1, minWidth: 240,
                        background: "#07090e", border: "1px solid rgba(255,255,255,.12)",
                        borderRadius: 7, padding: "7px 11px",
                        color: "#d8e0eb", fontSize: 12, outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                    <button
                      onClick={handleSendEmail}
                      disabled={sendBusy || !recipients.trim() || !emailSubject.trim() || sendStatus === "sent"}
                      style={{
                        background: sendStatus === "sent" ? "rgba(34,197,94,.15)" : "#00dba8",
                        color: sendStatus === "sent" ? "#4ade80" : "#000",
                        border: sendStatus === "sent" ? "1px solid rgba(34,197,94,.3)" : "none",
                        borderRadius: 7, padding: "7px 18px",
                        fontWeight: 700, fontSize: 12, flexShrink: 0,
                        cursor: (sendBusy || !recipients.trim() || sendStatus === "sent") ? "not-allowed" : "pointer",
                        opacity: (sendBusy || !recipients.trim()) && sendStatus !== "sent" ? 0.45 : 1,
                        display: "flex", alignItems: "center", gap: 6,
                      }}
                    >
                      {sendBusy ? <><Spinner size={11} /> Sending…</> : sendStatus === "sent" ? "✓ Sent" : "Send"}
                    </button>
                  </div>

                  {sendStatus === "error" && (
                    <div style={{ fontSize: 11, color: "#fb7185", fontFamily: "monospace" }}>
                      Failed: {sendError}
                    </div>
                  )}
                  {sendStatus === "sent" && (
                    <div style={{ fontSize: 11, color: "#4ade80" }}>Email sent successfully.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── empty state ── */}
          {cases.length === 0 && (
            <div style={{
              background: "#111620", border: "1px solid rgba(255,255,255,.055)",
              borderRadius: 12, padding: 32,
              textAlign: "center", color: "#384d63", fontSize: 12,
            }}>
              No cases{filter !== "all" && <span> with status <span style={{ color: "#7a8ba0", fontFamily: "monospace" }}>{filter}</span></span>}
              . Ensure <span style={{ fontFamily: "monospace", color: "#7a8ba0" }}>risk_hub.fraud.cases</span> has rows.
            </div>
          )}

          {/* ── case cards ── */}
          {cases.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {cases.map(c => {
                const sev     = sevCfg(c.severity);
                const st      = statusCfg(c.status);
                const isOpen  = !!expanded[c.case_id];
                const isBusy  = !!statusBusy[c.case_id];
                const expLakh = ((c.exposure_amt || 0) / 100000).toFixed(1);
                const transitions = STATUS_TRANSITIONS[c.status?.toLowerCase()] || [];
                const ctx = caseCtx(c, expLakh);

                // unique button keys for this card
                const kInv = `${c.case_id}-investigate`;
                const kEsc = `${c.case_id}-escalate`;
                const kAct = `${c.case_id}-action`;

                return (
                  <div key={c.case_id} style={{
                    background: "#111620",
                    border: `1px solid ${c.severity?.toUpperCase() === "CRITICAL"
                      ? "rgba(244,63,94,.18)" : "rgba(255,255,255,.055)"}`,
                    borderRadius: 12, overflow: "hidden",
                  }}>

                    {/* ── header ── */}
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* badges */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 9, color: "#384d63", fontFamily: "monospace", flexShrink: 0 }}>
                              {c.case_id}
                            </span>
                            <Badge label={c.severity?.toUpperCase() || "INFO"} bg={sev.bg} color={sev.color} border={sev.border} />
                            <Badge label={(c.status || "open").toUpperCase()} bg={st.bg} color={st.color} border={st.border} />
                          </div>

                          {/* title */}
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#d8e0eb", marginBottom: 6, lineHeight: 1.4 }}>
                            {c.title}
                          </div>

                          {/* metrics */}
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                            <Metric label="Exposure" value={`$${expLakh}L`} color="#00dba8" />
                            {c.merchant_id && <Metric label="Merchant" value={c.merchant_id} color="#d8e0eb" />}
                            {c.created_at  && <Metric label="Opened"   value={c.created_at.slice(0, 10)} color="#384d63" />}
                          </div>
                        </div>

                        {/* status dropdown */}
                        <div style={{ flexShrink: 0 }}>
                          {isBusy
                            ? <Spinner size={18} />
                            : transitions.length > 0 && (
                              <select
                                value=""
                                onChange={e => e.target.value && handleStatusChange(c.case_id, e.target.value)}
                                style={{
                                  background: "#0c0f16", border: "1px solid rgba(255,255,255,.1)",
                                  borderRadius: 6, padding: "4px 8px",
                                  color: "#7a8ba0", fontSize: 10,
                                  fontFamily: "monospace", cursor: "pointer", outline: "none",
                                }}
                              >
                                <option value="">Move to…</option>
                                {transitions.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            )}
                        </div>
                      </div>
                    </div>

                    {/* ── AI buttons ── */}
                    <div style={{ padding: "0 14px 10px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <AiButton
                        label="AI investigate"
                        btnKey={kInv}
                        loadingKey={loadingKey}
                        onClick={() => runAI(
                          kInv,
                          `Investigate case ${c.case_id}: "${c.title}". ` +
                          `Merchant: ${c.merchant_id || "unknown"}, exposure $${expLakh}L, severity: ${c.severity}. ` +
                          `Pull the last 7 days of fraud activity for this merchant: ` +
                          `number of fraudulent transactions, total amount lost, number of affected customers, ` +
                          `peak fraud hours during the day, and any account behaviour patterns (new accounts, multiple devices, shared IPs). ` +
                          `Output exactly two sections: ` +
                          `## Findings — the key facts and numbers from the data in readable sentences, no column names. ` +
                          `## Analysis — what these findings indicate about the nature and severity of this case.`,
                          `Investigation · ${c.case_id}`
                        )}
                      />
                      <AiButton
                        label="Draft escalation"
                        btnKey={kEsc}
                        loadingKey={loadingKey}
                        onClick={() => runAI(
                          kEsc,
                          `Draft an escalation email for case ${c.case_id}: "${c.title}". ` +
                          `Financial exposure: $${expLakh}L. Severity: ${c.severity}. Merchant: ${c.merchant_id || "unknown"}. ` +
                          `Pull the latest fraud evidence for this merchant over the last 7 days: ` +
                          `total fraudulent transactions, total amount, affected customers, fraud rate trend. ` +
                          `Output exactly one section: ` +
                          `## Escalation Email — write a complete ready-to-send email using this exact format: ` +
                          `first line must be "Subject: <subject>", ` +
                          `then a blank line, ` +
                          `then the full email body addressed to the Fraud Management Team covering what happened, the financial impact with real numbers, what immediate action is needed, and a decision deadline, ` +
                          `then a blank line followed by "Recommended Actions:" and a numbered list of 2-3 prioritised actions (each with expected impact and trade-off), ` +
                          `then end the email with a blank line and "With regards,\nRisk & Fraud Management Team". ` +
                          `Professional tone. Keep total email under 280 words.`,
                          `Escalation draft · ${c.case_id}`,
                          true
                        )}
                      />
                      <AiButton
                        label="Recommend action"
                        btnKey={kAct}
                        loadingKey={loadingKey}
                        onClick={() => runAI(
                          kAct,
                          `Recommend the best course of action for case ${c.case_id}: "${c.title}". ` +
                          `Merchant: ${c.merchant_id || "unknown"}, exposure $${expLakh}L, severity: ${c.severity}. ` +
                          `Look up this merchant's fraud rate, risk score, and transaction category. ` +
                          `Evaluate these four options: full merchant suspension, step-up authentication, ` +
                          `transaction velocity limits, enhanced monitoring only. ` +
                          `Output exactly one section: ` +
                          `## Recommended Actions — a numbered list of 2-3 actions ranked by priority. ` +
                          `For each: state the action clearly, expected impact in $ or %, and any trade-off to be aware of.`,
                          `Action recommendation · ${c.case_id}`
                        )}
                      />
                    </div>

                    {/* expand toggle */}
                    <div
                      onClick={() => setExpanded(p => ({ ...p, [c.case_id]: !p[c.case_id] }))}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,.04)",
                        padding: "7px 14px", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                      }}
                    >
                      <span style={{ fontSize: 10, color: "#7a8ba0" }}>
                        {isOpen ? "Hide" : "Show"} notes & investigation log
                      </span>
                      <span style={{
                        color: "#384d63", fontSize: 14,
                        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform .15s", display: "inline-block",
                      }}>▾</span>
                    </div>

                    {/* ── notes panel ── */}
                    {isOpen && (
                      <div style={{ borderTop: "1px solid rgba(255,255,255,.04)", padding: "12px 14px" }}>
                        <div style={{
                          fontSize: 9, color: "#384d63", fontFamily: "monospace",
                          textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6,
                        }}>
                          Investigation notes
                        </div>
                        <textarea
                          rows={4}
                          value={notesDraft[c.case_id] ?? (c.notes || "")}
                          onChange={e => setNotesDraft(p => ({ ...p, [c.case_id]: e.target.value }))}
                          placeholder="Document investigation steps, findings, and decisions here…"
                          style={{
                            width: "100%", background: "#07090e",
                            border: "1px solid rgba(255,255,255,.1)",
                            borderRadius: 8, padding: "8px 10px",
                            color: "#d8e0eb", fontSize: 12,
                            outline: "none", resize: "vertical", lineHeight: 1.5,
                            boxSizing: "border-box",
                          }}
                        />
                        {notesDraft[c.case_id] !== undefined &&
                          notesDraft[c.case_id] !== (c.notes || "") && (
                          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                            <button
                              onClick={() => handleNotesSave(c)}
                              disabled={!!notesBusy[c.case_id]}
                              style={{
                                background: "rgba(0,219,168,.1)", border: "1px solid rgba(0,219,168,.25)",
                                borderRadius: 6, padding: "5px 14px",
                                color: "#00dba8", fontSize: 11,
                                cursor: notesBusy[c.case_id] ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", gap: 6,
                              }}
                            >
                              {notesBusy[c.case_id] ? <><Spinner size={10} /> Saving…</> : "Save notes"}
                            </button>
                          </div>
                        )}
                        {c.created_at && (
                          <div style={{ marginTop: 10, fontSize: 9, color: "#384d63", fontFamily: "monospace" }}>
                            Opened: {c.created_at.slice(0, 19).replace("T", " ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div>
      <div style={{
        fontSize: 9, color: "#384d63", fontFamily: "monospace",
        textTransform: "uppercase", letterSpacing: ".07em",
      }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
