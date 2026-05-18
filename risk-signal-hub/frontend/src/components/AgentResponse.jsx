const SECTIONS = {
  "Findings":            { color: "#38bdf8", dot: "rgba(56,189,248,.6)"  },
  "Analysis":            { color: "#a78bfa", dot: "rgba(167,139,250,.6)" },
  "Recommended Actions": { color: "#00dba8", dot: "rgba(0,219,168,.6)"   },
  "Escalation Email":    { color: "#f59e0b", dot: "rgba(245,158,11,.6)"  },
  "Impact Summary":      { color: "#22c55e", dot: "rgba(34,197,94,.6)"   },
  "Trade-off Analysis":  { color: "#f59e0b", dot: "rgba(245,158,11,.6)"  },
  "Playbook Name":       { color: "#00dba8", dot: "rgba(0,219,168,.6)"   },
  "Trigger Conditions":  { color: "#38bdf8", dot: "rgba(56,189,248,.6)"  },
  "Response Steps":      { color: "#a78bfa", dot: "rgba(167,139,250,.6)" },
  "Success Metrics":     { color: "#22c55e", dot: "rgba(34,197,94,.6)"   },
};

function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e2e8f0;font-weight:600">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#07090e;color:#7dd3fc;padding:1px 5px;border-radius:3px;font-size:10px;font-family:monospace">$1</code>');
}

function renderBody(text) {
  const clean = text.replace(/\[(GENIE|AGENT BRICKS|FORECAST|ACTION)\]/g, "").trim();

  return clean.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} style={{ height: 6 }} />;

    const num = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (num) {
      return (
        <div key={i} style={{ display: "flex", gap: 9, marginBottom: 5 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#00dba8",
            fontFamily: "monospace", flexShrink: 0, minWidth: 16,
          }}>
            {num[1]}.
          </span>
          <span
            style={{ fontSize: 12, color: "#d8e0eb", lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: inlineMarkdown(num[2]) }}
          />
        </div>
      );
    }

    const bullet = trimmed.match(/^[-•]\s+(.*)/);
    if (bullet) {
      return (
        <div key={i} style={{ display: "flex", gap: 9, marginBottom: 5 }}>
          <span style={{ color: "#384d63", flexShrink: 0, marginTop: 2 }}>·</span>
          <span
            style={{ fontSize: 12, color: "#d8e0eb", lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: inlineMarkdown(bullet[1]) }}
          />
        </div>
      );
    }

    return (
      <p key={i} style={{ margin: "0 0 5px", fontSize: 12, color: "#d8e0eb", lineHeight: 1.65 }}
        dangerouslySetInnerHTML={{ __html: inlineMarkdown(trimmed) }}
      />
    );
  });
}

export default function AgentResponse({ text }) {
  if (!text) return null;

  const chunks = text.split(/^##\s+/m).filter(Boolean);

  if (chunks.length <= 1 && !text.includes("##")) {
    return (
      <div style={{ fontSize: 12, lineHeight: 1.7, color: "#d8e0eb" }}>
        {renderBody(text)}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {chunks.map((chunk, i) => {
        const newline = chunk.indexOf("\n");
        const heading = newline === -1 ? chunk.trim() : chunk.slice(0, newline).trim();
        const body    = newline === -1 ? ""            : chunk.slice(newline + 1).trim();
        const cfg     = SECTIONS[heading] || { color: "#7a8ba0", dot: "rgba(122,139,160,.5)" };

        return (
          <div key={i} style={{
            background: "#0c0f16",
            border: "1px solid rgba(255,255,255,.055)",
            borderRadius: 10, padding: "11px 14px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: cfg.dot, flexShrink: 0,
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700, color: cfg.color,
                textTransform: "uppercase", letterSpacing: ".09em",
                fontFamily: "monospace",
              }}>
                {heading}
              </span>
            </div>
            <div>{renderBody(body)}</div>
          </div>
        );
      })}
    </div>
  );
}
