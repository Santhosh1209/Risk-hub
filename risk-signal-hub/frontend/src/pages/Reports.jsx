import { useState, useEffect, useRef } from "react";
import { fetchReportContext, generateReport, fetchTemplates, saveTemplate, deleteTemplate } from "../api/reports.js";

const C = {
  bg: "#07090e", bg2: "#0c0f16", bg3: "#111620", bg4: "#171e2b", bg5: "#1e2736",
  b:  "rgba(255,255,255,.055)", b2: "rgba(255,255,255,.1)", b3: "rgba(255,255,255,.16)",
  t:  "#d8e0eb", t2: "#7a8ba0", t3: "#384d63",
  a:  "#00dba8", r: "#f43f5e", w: "#f59e0b", g: "#22c55e", p: "#a78bfa", b_: "#0ea5e9",
};

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtDate(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}
function prevMonth(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
function prevMonthDue(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  return `15 ${d.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`;
}

function Spinner({ size = 13 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,.1)", borderTopColor: C.a,
      animation: "rp-spin .7s linear infinite", display: "inline-block", flexShrink: 0,
    }} />
  );
}

function LoadingDots() {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 4, height: 4, borderRadius: "50%", background: C.a,
          display: "inline-block", animation: `rp-bl 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ── download helper ───────────────────────────────────────────────────────────
function downloadReport(content, reportName, dataDate) {
  const header = `${reportName}\nData as of: ${dataDate || "latest"}\nGenerated: ${new Date().toLocaleString("en-IN")}\n${"─".repeat(60)}\n\n`;
  const blob = new Blob([header + content], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${reportName.replace(/[^a-z0-9]/gi, "_")}_${dataDate || "report"}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── report body renderer ──────────────────────────────────────────────────────
function ReportContent({ text }) {
  if (!text) return null;
  const bold = (s) =>
    s.split(/(\*\*[^*]+\*\*|$[\d,.]+[LKCrk]*)/g).map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**"))
        return <strong key={i} style={{ color: C.a, fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("$"))
        return <strong key={i} style={{ color: C.w, fontWeight: 600 }}>{p}</strong>;
      return p;
    });

  return (
    <div style={{ fontSize: 12, color: C.t2, lineHeight: 1.8 }}>
      {text.split("\n").map((line, i) => {
        const h2     = line.match(/^##\s+(.*)/);
        const h3     = line.match(/^###\s+(.*)/);
        const bullet = line.match(/^[-•]\s+(.*)/);
        const num    = line.match(/^(\d+)\.\s+(.*)/);
        if (h2) return (
          <div key={i} style={{
            fontSize: 12, fontWeight: 700, color: C.t,
            marginTop: 16, marginBottom: 5,
            paddingBottom: 4, borderBottom: `1px solid ${C.b}`,
          }}>{h2[1]}</div>
        );
        if (h3) return (
          <div key={i} style={{ fontSize: 11, fontWeight: 600, color: C.a, marginTop: 10, marginBottom: 3 }}>
            {h3[1]}
          </div>
        );
        if (bullet) return (
          <div key={i} style={{ display: "flex", gap: 7, marginBottom: 3, paddingLeft: 4, alignItems: "flex-start" }}>
            <span style={{ color: C.a, fontSize: 14, lineHeight: 1, marginTop: 2, flexShrink: 0 }}>·</span>
            <span>{bold(bullet[1])}</span>
          </div>
        );
        if (num) return (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
            <span style={{
              minWidth: 20, height: 20, borderRadius: "50%",
              background: "rgba(0,219,168,.15)", color: C.a,
              fontSize: 9, fontWeight: 700, display: "flex",
              alignItems: "center", justifyContent: "center",
              flexShrink: 0, marginTop: 1,
            }}>{num[1]}</span>
            <span>{bold(num[2])}</span>
          </div>
        );
        if (!line.trim()) return <div key={i} style={{ height: 5 }} />;
        return <p key={i} style={{ margin: "0 0 3px" }}>{bold(line.trim())}</p>;
      })}
    </div>
  );
}

// ── Add Report modal ──────────────────────────────────────────────────────────
function AddReportModal({ onAdd, onClose }) {
  const [name, setName]   = useState("");
  const [desc, setDesc]   = useState("");
  const nameRef           = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), description: desc.trim() });
    onClose();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(0,0,0,.65)", display: "flex",
      alignItems: "center", justifyContent: "center",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: C.bg2, border: `1px solid ${C.b2}`,
        borderRadius: 14, width: 460, overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,.7)",
        animation: "rp-fu .18s ease",
      }}>
        {/* modal header */}
        <div style={{
          padding: "13px 16px", borderBottom: `1px solid ${C.b}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.t }}>Add Custom Report</div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: C.t2,
            cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px",
          }}>×</button>
        </div>

        {/* modal body */}
        <form onSubmit={handleSubmit} style={{ padding: "16px" }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{
              display: "block", fontSize: 10, fontWeight: 700, color: C.t3,
              fontFamily: "monospace", textTransform: "uppercase",
              letterSpacing: ".08em", marginBottom: 6,
            }}>Report Name *</label>
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Weekend UPI Fraud Deep-Dive"
              style={{
                width: "100%", background: C.bg3, border: `1px solid ${C.b2}`,
                borderRadius: 7, padding: "8px 11px", color: C.t,
                fontFamily: "inherit", fontSize: 12, outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = C.a}
              onBlur={e  => e.target.style.borderColor = C.b2}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{
              display: "block", fontSize: 10, fontWeight: 700, color: C.t3,
              fontFamily: "monospace", textTransform: "uppercase",
              letterSpacing: ".08em", marginBottom: 6,
            }}>Report Description / Instructions</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Describe what this report should cover — the AI will generate a structured report using live fraud data and your instructions."
              rows={4}
              style={{
                width: "100%", background: C.bg3, border: `1px solid ${C.b2}`,
                borderRadius: 7, padding: "8px 11px", color: C.t,
                fontFamily: "inherit", fontSize: 12, outline: "none",
                resize: "vertical", lineHeight: 1.55,
              }}
              onFocus={e => e.target.style.borderColor = C.a}
              onBlur={e  => e.target.style.borderColor = C.b2}
            />
            <div style={{ fontSize: 10, color: C.t3, marginTop: 5, lineHeight: 1.5 }}>
              The AI will combine your instructions with live Databricks data (KPIs, channels, cases, rules) to generate a complete professional report.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={{
              fontSize: 12, padding: "7px 16px", borderRadius: 7, cursor: "pointer",
              border: `1px solid ${C.b2}`, background: "transparent",
              color: C.t2, fontFamily: "inherit",
            }}>Cancel</button>
            <button type="submit" disabled={!name.trim()} style={{
              fontSize: 12, padding: "7px 18px", borderRadius: 7, cursor: name.trim() ? "pointer" : "not-allowed",
              border: "none", background: name.trim() ? C.a : C.bg5,
              color: name.trim() ? "#000" : C.t3, fontFamily: "inherit", fontWeight: 700,
              transition: "all .15s",
            }}>Add Report</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── single report card ────────────────────────────────────────────────────────
function ReportCard({ typeLabel, typeColor, title, meta, buttons, previewText, reportType,
                      customName, customDescription, onDelete }) {
  const [generating,  setGenerating]  = useState(false);
  const [result,      setResult]      = useState(null);
  const [showResult,  setShowResult]  = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copied,      setCopied]      = useState(false);
  const [downloaded,  setDownloaded]  = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setResult(null);
    setShowResult(false);
    try {
      const res = await generateReport(reportType, true, customName || "", customDescription || "");
      setResult(res);
      setShowResult(true);
    } catch (e) {
      setResult({ content: `Error generating report: ${e.message}`, context: {} });
      setShowResult(true);
    } finally {
      setGenerating(false);
    }
  }

  function copy() {
    if (!result?.content) return;
    navigator.clipboard.writeText(result.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function download() {
    if (!result?.content) return;
    downloadReport(result.content, result.report_name || title, result.context?.date);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  }

  const leftBorderColor =
    typeColor === "teal"   ? C.a  :
    typeColor === "red"    ? C.r  :
    typeColor === "purple" ? C.p  :
    typeColor === "amber"  ? C.w  :
    typeColor === "blue"   ? C.b_ : C.a;

  const typeLabelColor =
    typeColor === "teal"   ? C.a  :
    typeColor === "red"    ? "#fb7185" :
    typeColor === "purple" ? "#c4b5fd" :
    typeColor === "amber"  ? "#fbbf24" :
    typeColor === "blue"   ? "#38bdf8" : C.a;

  return (
    <div style={{
      background: C.bg3, borderRadius: 10,
      border: `1px solid ${C.b}`,
      borderLeft: `3px solid ${leftBorderColor}`,
      padding: "14px 16px", marginBottom: 8,
      transition: "border-color .15s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.b2}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.b}
    >
      {/* ── card row ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 9, fontFamily: "monospace", fontWeight: 700,
            color: typeLabelColor, textTransform: "uppercase",
            letterSpacing: ".1em", marginBottom: 5,
          }}>{typeLabel}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.t, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 11, color: C.t2 }}>{meta}</div>
        </div>

        {/* ── buttons ── */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          {previewText && (
            <button
              onClick={() => setShowPreview(v => !v)}
              style={{
                fontSize: 11, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                border: `1px solid ${C.b2}`, background: "transparent", color: C.t2,
                fontFamily: "inherit", transition: "all .15s",
              }}
              onMouseEnter={e => { e.target.style.color = C.t; e.target.style.borderColor = C.b3; }}
              onMouseLeave={e => { e.target.style.color = C.t2; e.target.style.borderColor = C.b2; }}
            >
              {showPreview ? "Hide" : "Preview"}
            </button>
          )}

          {result && !generating && (
            <button
              onClick={() => setShowResult(v => !v)}
              style={{
                fontSize: 11, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                border: `1px solid rgba(0,219,168,.22)`, background: "rgba(0,219,168,.06)",
                color: C.a, fontFamily: "inherit", transition: "all .15s",
              }}
            >
              {showResult ? "Collapse" : "View report"}
            </button>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              fontSize: 11, padding: "5px 14px", borderRadius: 6, cursor: generating ? "not-allowed" : "pointer",
              border: "none", background: C.a, color: "#000",
              fontFamily: "inherit", fontWeight: 700,
              display: "flex", alignItems: "center", gap: 6,
              opacity: generating ? .65 : 1, transition: "opacity .15s",
            }}
          >
            {generating ? <><Spinner size={11} /> Generating…</> : buttons.primary}
          </button>

          {onDelete && (
            <button
              onClick={onDelete}
              title="Delete report"
              style={{
                fontSize: 13, lineHeight: 1, padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                border: `1px solid rgba(244,63,94,.2)`, background: "transparent",
                color: "rgba(244,63,94,.55)", fontFamily: "inherit",
                transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = C.r; e.currentTarget.style.borderColor = "rgba(244,63,94,.5)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(244,63,94,.55)"; e.currentTarget.style.borderColor = "rgba(244,63,94,.2)"; }}
            >×</button>
          )}
        </div>
      </div>

      {/* ── preview strip ── */}
      {showPreview && !generating && !showResult && (
        <div style={{
          marginTop: 12, background: C.bg4,
          border: `1px solid ${C.b}`, borderRadius: 8, padding: 12,
          fontSize: 11, color: C.t2, lineHeight: 1.65,
          animation: "rp-fu .15s ease",
        }}>
          {previewText}
        </div>
      )}

      {/* ── generating state ── */}
      {generating && (
        <div style={{
          marginTop: 12, padding: "12px 14px",
          background: "rgba(0,219,168,.04)",
          border: `1px solid rgba(0,219,168,.12)`,
          borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
          animation: "rp-fu .15s ease",
        }}>
          <LoadingDots />
          <span style={{ fontSize: 11, color: C.t3, fontFamily: "monospace" }}>
            Fetching live data from Databricks → querying Genie → generating with LLM…
          </span>
        </div>
      )}

      {/* ── generated report ── */}
      {!generating && result && showResult && (
        <div style={{ marginTop: 14, animation: "rp-fu .2s ease" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 8, gap: 6,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>
                Data as of: {result.context?.date || "latest"}
              </span>
              {result.genie?.status === "ok" && (
                <span style={{
                  fontSize: 9, padding: "1px 6px", borderRadius: 10,
                  background: "rgba(0,219,168,.08)", color: C.a,
                  border: "1px solid rgba(0,219,168,.16)", fontFamily: "monospace",
                }}>+ Genie SQL</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <button onClick={copy} style={{
                fontSize: 10, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                border: `1px solid ${C.b2}`, background: "transparent",
                color: copied ? C.g : C.t2, fontFamily: "inherit",
              }}>{copied ? "✓ Copied" : "Copy"}</button>
              <button onClick={download} style={{
                fontSize: 10, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                border: `1px solid ${downloaded ? "rgba(0,219,168,.3)" : C.b2}`,
                background: downloaded ? "rgba(0,219,168,.08)" : "transparent",
                color: downloaded ? C.a : C.t2, fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {downloaded ? "✓ Downloaded" : <>↓ Download</>}
              </button>
              <button onClick={() => setShowResult(false)} style={{
                fontSize: 10, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                border: `1px solid ${C.b2}`, background: "transparent",
                color: C.t2, fontFamily: "inherit",
              }}>Collapse ↑</button>
            </div>
          </div>
          <div style={{
            background: C.bg4, border: `1px solid ${C.b}`,
            borderLeft: `3px solid ${leftBorderColor}`,
            borderRadius: 10, padding: "14px 16px",
            maxHeight: 580, overflowY: "auto",
          }}>
            <ReportContent text={result.content} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function Reports() {
  const [ctx,            setCtx]            = useState(null);
  const [ctxLoading,     setCtxLoading]     = useState(true);
  const [dailyGen,       setDailyGen]       = useState(false);
  const [dailyResult,    setDailyResult]    = useState(null);
  const [showDaily,      setShowDaily]      = useState(false);
  const [dailyMinimized, setDailyMinimized] = useState(false);
  const [dailyDl,        setDailyDl]        = useState(false);
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [customReports,  setCustomReports]  = useState([]);
  const [tmplLoading,    setTmplLoading]    = useState(false);

  useEffect(() => {
    fetchReportContext()
      .then(setCtx)
      .catch(() => setCtx(null))
      .finally(() => setCtxLoading(false));
    // Load persisted templates from Databricks
    setTmplLoading(true);
    fetchTemplates()
      .then(rows => setCustomReports(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => setTmplLoading(false));
  }, []);

  async function handleAddReport({ name, description }) {
    try {
      const saved = await saveTemplate(name, description);
      setCustomReports(prev => [saved, ...prev]);
    } catch {
      // optimistic fallback: add locally with temp id
      setCustomReports(prev => [{ id: `tmp-${Date.now()}`, name, description }, ...prev]);
    }
  }

  async function handleDeleteReport(id) {
    setCustomReports(prev => prev.filter(r => r.id !== id));
    try { await deleteTemplate(id); } catch { /* ignore */ }
  }

  async function handleDailyReport() {
    setDailyGen(true);
    setDailyResult(null);
    setShowDaily(false);
    try {
      const res = await generateReport("daily_ops");
      setDailyResult(res);
      setShowDaily(true);
    } catch (e) {
      setDailyResult({ content: `Error: ${e.message}`, context: {} });
      setShowDaily(true);
    } finally {
      setDailyGen(false);
    }
  }

  // Derive dynamic values from context
  const dataDate   = ctx?.date || null;
  const dateLabel  = fmtDate(dataDate);
  const prevMon    = prevMonth(dataDate);
  const prevMonDue = prevMonthDue(dataDate);

  const topCase     = ctx?.cases?.[0];
  const caseId      = topCase?.case_id   || "CASE-0041";
  const caseTitle   = topCase?.title     || "UPI ATO Campaign";
  const caseSev     = topCase?.severity  || "CRITICAL";
  const caseExp     = topCase?.exposure_lakhs != null ? `$${topCase.exposure_lakhs}L` : "$18.4L";

  const activeRules = (ctx?.rules || []).filter(r => r.is_active).length;
  const ruleCount   = ctx?.rules?.length || 18;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @keyframes rp-spin { to { transform: rotate(360deg) } }
        @keyframes rp-bl   { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
        @keyframes rp-fu   { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
      `}</style>

      {/* ── header ── */}
      <div style={{
        padding: "13px 18px", borderBottom: `1px solid ${C.b}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, background: C.bg2,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.t }}>Reports &amp; Audit</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${C.b2}`, background: "transparent",
              color: C.t2, fontFamily: "inherit", fontWeight: 500,
              display: "flex", alignItems: "center", gap: 6,
              transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.a; e.currentTarget.style.color = C.a; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.b2; e.currentTarget.style.color = C.t2; }}
          >+ Add Report</button>

        <button
          onClick={handleDailyReport}
          disabled={dailyGen}
          style={{
            fontSize: 12, padding: "7px 16px", borderRadius: 8,
            border: "none", background: C.a, color: "#000",
            fontFamily: "inherit", fontWeight: 700, cursor: dailyGen ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 7,
            opacity: dailyGen ? .65 : 1,
          }}
        >
          {dailyGen ? <><Spinner size={12} /> Generating…</> : "Generate daily report with AI"}
        </button>
        </div>
      </div>

      {/* ── scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>

        {/* ── Daily report panel (minimizable) ── */}
        {(dailyGen || dailyResult) && (
          <div style={{
            background: C.bg3, border: `1px solid rgba(0,219,168,.2)`,
            borderLeft: `3px solid ${C.a}`,
            borderRadius: 10, marginBottom: 14,
            animation: "rp-fu .2s ease", overflow: "hidden",
          }}>
            {/* panel header — always visible */}
            <div style={{
              padding: "10px 14px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: (!dailyMinimized && !dailyGen) ? `1px solid rgba(0,219,168,.12)` : "none",
              cursor: dailyResult ? "default" : "default",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {dailyGen && <Spinner size={11} />}
                <span style={{
                  fontSize: 10, fontWeight: 700, color: C.a, fontFamily: "monospace",
                  textTransform: "uppercase", letterSpacing: ".1em",
                }}>Daily Operations Report</span>
                <span style={{ fontSize: 10, color: C.t3, fontFamily: "monospace" }}>· {dateLabel}</span>
                {dailyResult?.genie?.status === "ok" && !dailyGen && (
                  <span style={{
                    fontSize: 9, padding: "1px 6px", borderRadius: 10,
                    background: "rgba(0,219,168,.08)", color: C.a,
                    border: "1px solid rgba(0,219,168,.16)", fontFamily: "monospace",
                  }}>+ Genie SQL</span>
                )}
              </div>

              {/* panel controls */}
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {!dailyGen && dailyResult?.content && (
                  <>
                    <button
                      onClick={() => {
                        downloadReport(dailyResult.content, "Daily Operations Report", dailyResult.context?.date);
                        setDailyDl(true);
                        setTimeout(() => setDailyDl(false), 2000);
                      }}
                      style={{
                        fontSize: 10, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                        border: `1px solid ${dailyDl ? "rgba(0,219,168,.3)" : C.b2}`,
                        background: dailyDl ? "rgba(0,219,168,.08)" : "transparent",
                        color: dailyDl ? C.a : C.t2, fontFamily: "inherit",
                      }}
                    >{dailyDl ? "✓ Downloaded" : "↓ Download"}</button>

                    {/* minimize / expand */}
                    <button
                      onClick={() => setDailyMinimized(v => !v)}
                      title={dailyMinimized ? "Expand" : "Minimize"}
                      style={{
                        fontSize: 13, lineHeight: 1, padding: "2px 6px", borderRadius: 5,
                        border: `1px solid ${C.b2}`, background: "transparent",
                        color: C.t2, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >{dailyMinimized ? "⬆" : "⬇"}</button>
                  </>
                )}

                <button
                  onClick={() => { setDailyResult(null); setDailyMinimized(false); setShowDaily(false); }}
                  title="Close"
                  style={{
                    fontSize: 14, lineHeight: 1, padding: "2px 6px", borderRadius: 5,
                    border: `1px solid ${C.b2}`, background: "transparent",
                    color: C.t2, cursor: "pointer", fontFamily: "inherit",
                  }}
                >×</button>
              </div>
            </div>

            {/* panel body — hidden when minimized */}
            {!dailyMinimized && (
              <div style={{ padding: "12px 14px" }}>
                {dailyGen && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.t3, fontSize: 11, fontFamily: "monospace" }}>
                    <LoadingDots /> Fetching live data → querying Genie → generating with LLM…
                  </div>
                )}
                {!dailyGen && dailyResult && (
                  <>
                    {showDaily && (
                      <div style={{ maxHeight: 480, overflowY: "auto", marginBottom: 10 }}>
                        <ReportContent text={dailyResult.content} />
                      </div>
                    )}
                    <button
                      onClick={() => setShowDaily(v => !v)}
                      style={{
                        fontSize: 10, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                        border: `1px solid ${C.b2}`, background: "transparent",
                        color: C.t2, fontFamily: "inherit",
                      }}
                    >{showDaily ? "Collapse ↑" : "Show full report ↓"}</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 5 report cards ── */}

        {/* 1. Daily ops */}
        <ReportCard
          reportType="daily_ops"
          typeLabel="Daily Report"
          typeColor="teal"
          title={ctxLoading ? "Fraud Operations Summary" : `Fraud Operations Summary — ${dateLabel}`}
          meta={`Auto-generated · 7 sections · Last run: 06:00 IST`}
          previewText="Fraud rate, total transactions, channel breakdown (UPI/Card/Wallet/NetBanking), open cases, rule engine performance, and 3 recommended actions — all generated from live Databricks data."
          buttons={{ primary: "Generate with AI" }}
        />

        {/* 2. Incident */}
        <ReportCard
          reportType="incident"
          typeLabel="Incident Report"
          typeColor="red"
          title={`${caseTitle} — ${caseId}`}
          meta={`${caseSev} · ${caseExp} · 214 transactions`}
          previewText="Formal incident report with timeline of events, fraud evidence pattern, financial impact $, root cause analysis, immediate actions taken, and preventive recommendations."
          buttons={{ primary: "Generate formal report" }}
        />

        {/* 3. RBI regulatory */}
        <ReportCard
          reportType="rbi"
          typeLabel="Regulatory Report"
          typeColor="purple"
          title={`RBI Fraud Returns — ${prevMon}`}
          meta={`Monthly · Due: ${prevMonDue}`}
          previewText={null}
          buttons={{ primary: "Generate RBI report" }}
        />

        {/* 4. Rule audit */}
        <ReportCard
          reportType="rule_audit"
          typeLabel="Audit Log"
          typeColor="amber"
          title="Rule Changes Audit — Last 30 Days"
          meta={`${ruleCount} rules · ${activeRules} active · All logged`}
          previewText={null}
          buttons={{ primary: "AI audit analysis" }}
        />

        {/* 5. Quarterly performance */}
        <ReportCard
          reportType="quarterly"
          typeLabel="Performance Report"
          typeColor="blue"
          title="Model &amp; Rule Performance — Q1 2026"
          meta="Quarterly · Precision, Recall, ROC analysis"
          previewText={null}
          buttons={{ primary: "Generate with AI" }}
        />

        {/* ── custom reports (DB-persisted) ── */}
        {tmplLoading && (
          <div style={{ fontSize: 11, color: C.t3, fontFamily: "monospace", padding: "6px 2px" }}>
            Loading saved reports…
          </div>
        )}
        {customReports.map(r => (
          <ReportCard
            key={r.id}
            reportType="custom"
            typeLabel="Custom Report"
            typeColor="teal"
            title={r.name}
            meta={r.description || "User-defined report · AI-generated with live data"}
            previewText={r.description || null}
            buttons={{ primary: "Generate with AI" }}
            customName={r.name}
            customDescription={r.description}
            onDelete={() => handleDeleteReport(r.id)}
          />
        ))}

      </div>

      {/* ── Add Report modal ── */}
      {showAddModal && (
        <AddReportModal
          onAdd={handleAddReport}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
