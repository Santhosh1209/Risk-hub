import { useState, useRef, useEffect } from "react";

const C = {
  bg: "#07090e", bg2: "#0c0f16", bg3: "#111620", bg4: "#171e2b",
  b: "rgba(255,255,255,.055)", b2: "rgba(255,255,255,.1)",
  t: "#d8e0eb", t2: "#7a8ba0", t3: "#384d63",
  a: "#00dba8", a2: "#0ea5e9", r: "#f43f5e", w: "#f59e0b", g: "#22c55e", p: "#a78bfa",
};

// ── response parser ───────────────────────────────────────────────────────────
function parseResponse(text) {
  if (!text) return [];
  const tagRe = /\[(GENIE|AGENT BRICKS|FORECAST|ACTION)\]/g;
  const sections = [];
  let lastTag = null, lastIdx = 0, m;
  while ((m = tagRe.exec(text)) !== null) {
    if (lastTag !== null) sections.push({ tag: lastTag, content: text.slice(lastIdx, m.index).trim() });
    lastTag = m[1];
    lastIdx = m.index + m[0].length;
  }
  if (lastTag !== null) sections.push({ tag: lastTag, content: text.slice(lastIdx).trim() });
  if (!sections.length) return [{ tag: "AGENT BRICKS", content: text.trim() }];
  return sections;
}

const SECTION_CONFIG = {
  "GENIE":        { label: "Genie SQL",      color: "#38bdf8", bg: "rgba(14,165,233,.07)",  border: "rgba(14,165,233,.2)"  },
  "AGENT BRICKS": { label: "Agent Bricks",   color: "#c4b5fd", bg: "rgba(167,139,250,.07)", border: "rgba(167,139,250,.2)" },
  "FORECAST":     { label: "Forecast",       color: "#fbbf24", bg: "rgba(245,158,11,.07)",  border: "rgba(245,158,11,.2)"  },
  "ACTION":       { label: "Actions",        color: "#4ade80", bg: "rgba(34,197,94,.07)",   border: "rgba(34,197,94,.2)"   },
};

// ── content formatter (handles sql blocks + numbered lists + plain text) ──────
function formatContent(content, cfg) {
  const lines = content.split("\n");
  const out = [];
  let inCode = false, codeBuf = [], codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      if (inCode) {
        out.push(
          <pre key={`code-${codeKey++}`} style={{
            background: C.bg, border: `1px solid ${C.b2}`, borderRadius: 6,
            padding: "8px 10px", fontFamily: "monospace", fontSize: 10,
            color: "#7dd3fc", margin: "6px 0", overflowX: "auto",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{codeBuf.join("\n")}</pre>
        );
        codeBuf = []; inCode = false;
      } else { inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const numMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      out.push(
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
          <span style={{
            minWidth: 20, height: 20, borderRadius: "50%",
            background: `${cfg.color}22`, color: cfg.color,
            fontSize: 9, fontWeight: 700, display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
          }}>{numMatch[1]}</span>
          <span style={{ fontSize: 11, color: C.t, lineHeight: 1.65 }}>
            {highlightText(numMatch[2])}
          </span>
        </div>
      );
      continue;
    }

    // Bullet points (- or •)
    const bulletMatch = line.trim().match(/^[-•]\s+(.*)/);
    if (bulletMatch) {
      out.push(
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "flex-start", paddingLeft: 4 }}>
          <span style={{ color: cfg.color, fontSize: 13, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>·</span>
          <span style={{ fontSize: 11, color: C.t2, lineHeight: 1.65 }}>{highlightText(bulletMatch[1])}</span>
        </div>
      );
      continue;
    }

    const trimmed = line.trim();
    if (trimmed) {
      out.push(
        <p key={i} style={{ fontSize: 11, color: C.t2, lineHeight: 1.7, marginBottom: 4 }}>
          {highlightText(trimmed)}
        </p>
      );
    }
  }
  return out;
}

// Bold **text** and $ amounts
function highlightText(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\$[\d,.]+[LKCrk]*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} style={{ color: C.a, fontWeight: 600 }}>{p.slice(2,-2)}</strong>;
    if (p.startsWith("$"))
      return <strong key={i} style={{ color: C.w, fontWeight: 600 }}>{p}</strong>;
    return p;
  });
}

function Section({ tag, content }) {
  const cfg = SECTION_CONFIG[tag] || SECTION_CONFIG["AGENT BRICKS"];
  return (
    <div style={{
      marginBottom: 10, borderRadius: 8, overflow: "hidden",
      border: `1px solid ${cfg.border}`, background: cfg.bg,
    }}>
      <div style={{
        padding: "5px 10px", display: "flex", alignItems: "center", gap: 6,
        borderBottom: `1px solid ${cfg.border}`,
        background: `${cfg.color}12`,
      }}>
        <div style={{
          width: 5, height: 5, borderRadius: "50%",
          background: cfg.color, flexShrink: 0,
        }} />
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: "monospace",
          color: cfg.color, textTransform: "uppercase", letterSpacing: ".1em",
        }}>{cfg.label}</span>
      </div>
      <div style={{ padding: "9px 10px" }}>
        {formatContent(content, cfg)}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export default function AgentBricksWindow({ modal, onClose }) {
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos]             = useState(null); // null = use default bottom-right
  const dragging  = useRef(false);
  const dragOff   = useRef({ x: 0, y: 0 });
  const winRef    = useRef(null);

  // Expand when a new query comes in
  useEffect(() => {
    if (modal) setMinimized(false);
  }, [modal?.prompt]);

  if (!modal) return null;

  const sections = parseResponse(modal.result);

  // ── drag ──────────────────────────────────────────────────────────────────
  function onHeaderMouseDown(e) {
    if (e.target.closest("button")) return;
    dragging.current = true;
    const rect = winRef.current.getBoundingClientRect();
    dragOff.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    function move(ev) {
      if (!dragging.current) return;
      setPos({ x: ev.clientX - dragOff.current.x, y: ev.clientY - dragOff.current.y });
    }
    function up() {
      dragging.current = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    e.preventDefault();
  }

  const posStyle = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : { right: 20, bottom: 20 };

  return (
    <div
      ref={winRef}
      style={{
        position: "fixed",
        ...posStyle,
        width: 440,
        zIndex: 400,
        display: "flex",
        flexDirection: "column",
        maxHeight: minimized ? "auto" : "min(580px, calc(100vh - 80px))",
        background: C.bg2,
        border: `1px solid ${C.b2}`,
        borderRadius: 12,
        boxShadow: "0 24px 64px rgba(0,0,0,.65), 0 0 0 1px rgba(0,219,168,.1)",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          padding: "9px 12px",
          borderBottom: minimized ? "none" : `1px solid ${C.b}`,
          display: "flex", alignItems: "center", gap: 8,
          cursor: "grab", background: C.bg3, flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: "linear-gradient(135deg,#00dba8,#0ea5e9)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5.5" stroke="#000" strokeWidth="1.3"/>
            <path d="M3.5 6.5l2 2 4-4" stroke="#000" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.t }}>Agent Bricks</div>
          <div style={{
            fontSize: 9, color: C.t3, fontFamily: "monospace", marginTop: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {modal.prompt.length > 70 ? modal.prompt.slice(0, 70) + "…" : modal.prompt}
          </div>
        </div>

        {/* Status dot */}
        {modal.loading
          ? <LoadingDots />
          : <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.g, flexShrink: 0 }} />
        }

        {/* Minimize */}
        <button
          onClick={() => setMinimized(v => !v)}
          title={minimized ? "Expand" : "Minimize"}
          style={btnStyle}
        >
          {minimized ? "⬆" : "⬇"}
        </button>

        {/* Close */}
        <button onClick={onClose} title="Close" style={btnStyle}>×</button>
      </div>

      {/* ── body ───────────────────────────────────────────────────────────── */}
      {!minimized && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 14px" }}>

          {/* Question bubble */}
          <div style={{
            background: C.bg4, borderRadius: 8, padding: "8px 11px",
            marginBottom: 12, fontSize: 11, color: C.t2, lineHeight: 1.55,
            borderLeft: `2px solid ${C.a}`, userSelect: "text",
          }}>
            {modal.prompt}
          </div>

          {/* Loading */}
          {modal.loading && (
            <div style={{
              padding: "20px 0", display: "flex", alignItems: "center",
              gap: 10, color: C.t2, fontSize: 11, fontFamily: "monospace",
            }}>
              <LoadingDots large />
              <span>Querying Genie + analysing…</span>
            </div>
          )}

          {/* Formatted sections */}
          {!modal.loading && modal.result && (
            <div style={{ userSelect: "text" }}>
              {sections.map((s, i) => <Section key={i} tag={s.tag} content={s.content} />)}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes bl{0%,80%,100%{opacity:.2}40%{opacity:1}}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
      `}</style>
    </div>
  );
}

// ── small reuse pieces ────────────────────────────────────────────────────────
const btnStyle = {
  background: "none", border: "none", color: "#7a8ba0", cursor: "pointer",
  fontSize: 15, lineHeight: 1, padding: "3px 5px", borderRadius: 4,
  display: "flex", alignItems: "center", justifyContent: "center",
};

function LoadingDots({ large }) {
  const size = large ? 6 : 4;
  const gap  = large ? 5 : 3;
  return (
    <div style={{ display: "flex", gap }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: size, height: size, borderRadius: "50%", background: "#00dba8",
          display: "inline-block", animation: `bl 1.2s ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}
