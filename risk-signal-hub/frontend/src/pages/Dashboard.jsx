import { useState, useEffect, useCallback } from "react";
import { ComposedChart, Area, Line, BarChart, Bar, PieChart, Pie, Cell,
         XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import GenieViz       from "../components/GenieViz.jsx";
import { fetchKPIs, fetchHourly, fetchDecline, fetchRiskDist,
         fetchSevenDayTrend, fetchChannelSplit, fetchAlerts,
         fetchFlaggedAccounts, DASHBOARD_KEYS } from "../api/dashboard.js";
import { invalidate } from "../api/cache.js";
import { askAgent } from "../api/agent.js";

const AX  = { tick:{ fill:"#384d63", fontSize:11, fontFamily:"monospace" }, axisLine:false, tickLine:false };
const TT  = { backgroundColor:"#171e2b", border:"1px solid rgba(255,255,255,.07)", borderRadius:6, color:"#d8e0eb", fontSize:12 };
const PC  = ["#f43f5e","#f59e0b","#a78bfa","#0ea5e9","#374151"];
const RC  = { "0-20":"#22c55e99","21-40":"#22c55e66","41-60":"#f59e0b72","61-80":"#f43f5e72","81-100":"#f43f5ebf" };
const CHIPS = [
  { label:"UPI spike root cause",        q:"Why did UPI fraud spike at 11 PM yesterday?" },
  { label:"Declines by category",        q:"Which merchant categories have highest decline rates this week?" },
  { label:"Full risk summary + actions", q:"Summarize all active risk signals and top 3 recommended actions" },
  { label:"Exposure if no action",       q:"What is the estimated financial exposure if we do nothing today?" },
  { label:"Week vs last month",          q:"Compare this week fraud pattern vs same period last month" },
];

// ── tag-based section renderer (matches AgentBricksWindow style) ──────────────
const TAG_CFG = {
  "KPI":          { label: "Key Metrics",   color: "#00dba8", bg: "rgba(0,219,168,.06)",   border: "rgba(0,219,168,.18)"  },
  "GENIE":        { label: "Genie",         color: "#38bdf8", bg: "rgba(14,165,233,.07)",  border: "rgba(14,165,233,.2)"  },
  "AGENT BRICKS": { label: "Analysis",      color: "#c4b5fd", bg: "rgba(167,139,250,.07)", border: "rgba(167,139,250,.2)" },
  "FORECAST":     { label: "Forecast",      color: "#fbbf24", bg: "rgba(245,158,11,.07)",  border: "rgba(245,158,11,.2)"  },
  "ACTION":       { label: "Actions",       color: "#4ade80", bg: "rgba(34,197,94,.07)",   border: "rgba(34,197,94,.2)"   },
};

function parseTags(text) {
  if (!text) return [];
  const tagRe = /\[(KPI|GENIE|AGENT BRICKS|FORECAST|ACTION)\]/g;
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

function TagSection({ tag, content }) {
  const cfg = TAG_CFG[tag] || TAG_CFG["AGENT BRICKS"];

  if (tag === "KPI") {
    const metrics = content.split("\n")
      .map(l => { const idx = l.indexOf(":"); return idx > 0 ? { label: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim() } : null; })
      .filter(Boolean);
    if (!metrics.length) return null;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: cfg.color, fontFamily: "monospace", fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 7 }}>
          {cfg.label}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 7 }}>
          {metrics.map(({ label, value }) => (
            <div key={label} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`,
                                       borderRadius: 8, padding: "8px 11px" }}>
              <div style={{ fontSize: 9, color: "#384d63", fontFamily: "monospace",
                             textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: cfg.color, letterSpacing: "-.3px" }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const lines = content.split("\n").filter(l => l.trim());
  return (
    <div style={{
      marginBottom: 8, borderRadius: 8, overflow: "hidden",
      border: `1px solid ${cfg.border}`, background: cfg.bg,
    }}>
      <div style={{
        padding: "4px 10px", display: "flex", alignItems: "center", gap: 6,
        borderBottom: `1px solid ${cfg.border}`, background: `${cfg.color}12`,
      }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: "monospace",
          color: cfg.color, textTransform: "uppercase", letterSpacing: ".1em",
        }}>{cfg.label}</span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        {lines.map((line, i) => {
          const trimmed = line.trim();
          const num = trimmed.match(/^(\d+)\.\s+(.*)/);
          if (num) return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
              <span style={{
                minWidth: 18, height: 18, borderRadius: "50%", background: `${cfg.color}22`,
                color: cfg.color, fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>{num[1]}</span>
              <span style={{ fontSize: 11, color: "#d8e0eb", lineHeight: 1.6 }}>{num[2]}</span>
            </div>
          );
          const bullet = trimmed.match(/^[-•—]\s*(.*)/);
          if (bullet) return (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "flex-start" }}>
              <span style={{ color: cfg.color, flexShrink: 0 }}>·</span>
              <span style={{ fontSize: 11, color: "#7a8ba0", lineHeight: 1.6 }}>{bullet[1]}</span>
            </div>
          );
          return <p key={i} style={{ margin: "0 0 4px", fontSize: 11, color: "#7a8ba0", lineHeight: 1.65 }}>{trimmed}</p>;
        })}
      </div>
    </div>
  );
}

function Card({ title, children, style={} }) {
  return (
    <div style={{ background:"#111620", border:"1px solid rgba(255,255,255,.055)",
                  borderRadius:12, padding:13, ...style }}>
      <div style={{ fontSize:11, fontWeight:700, color:"#384d63", textTransform:"uppercase",
                    letterSpacing:".08em", fontFamily:"monospace", marginBottom:10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                  justifyContent:"center", padding:36 }}>
      <div style={{ width:38, height:38, border:"3px solid rgba(255,255,255,.08)",
                    borderTop:"3px solid #00dba8", borderRadius:"50%",
                    animation:"rsh-spin 0.8s linear infinite", marginBottom:12 }}/>
      <div style={{ fontSize:13, color:"#7a8ba0" }}>Genie is analyzing…</div>
    </div>
  );
}

export default function Dashboard({ setAlertCount, chat, setChat }) {
  const [s, setS] = useState({
    kpis:null, hourly:[], decline:[], riskDist:[], trend:[], channels:[], alerts:[], accounts:[]
  });
  const [query, setQuery]       = useState("");
  const [loading, setLoad]      = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    Promise.all([
      fetchKPIs().then(r           => setS(p=>({...p,kpis:r}))),
      fetchHourly().then(r         => setS(p=>({...p,hourly:r}))),
      fetchDecline().then(r        => setS(p=>({...p,decline:r}))),
      fetchRiskDist().then(r       => setS(p=>({...p,riskDist:r}))),
      fetchSevenDayTrend().then(r  => setS(p=>({...p,trend:r}))),
      fetchChannelSplit().then(r   => setS(p=>({...p,channels:r}))),
      fetchAlerts().then(r         => { setS(p=>({...p,alerts:r})); setAlertCount?.(r.length); }),
      fetchFlaggedAccounts().then(r=> setS(p=>({...p,accounts:r.slice(0,6)}))),
    ]).catch(console.error);
  }, [refreshTick]);

  function handleRefresh() {
    invalidate(...Object.values(DASHBOARD_KEYS));
    setRefreshTick(t => t + 1);
  }

  const hourlyByHour = {};
  s.hourly.forEach(r => {
    const h = +r.txn_hour;
    if (!hourlyByHour[h]) hourlyByHour[h] = { fraud:0, total:0 };
    hourlyByHour[h].fraud += +r.fraud_count || 0;
    hourlyByHour[h].total += +r.txn_count   || 0;
  });
  const baseline = +(s.kpis?.fraud_rate_pct || 0);
  const hourlyData = Array.from({ length:24 }, (_, h) => {
    const d = hourlyByHour[h] || { fraud:0, total:0 };
    return {
      hour: `${h}:00`,
      pct:  d.total > 0 ? +(d.fraud / d.total * 100).toFixed(3) : 0,
      base: baseline,
    };
  });

  const ask = useCallback(async (q) => {
    const question = q || query;
    if (!question.trim() || loading) return;
    setLoad(true); setQuery("");
    try {
      const res = await askAgent(question);
      setChat(prev => [{ q:question, a:res.answer, genie:res.genie }, ...prev.slice(0,4)]);
    } catch(e) {
      setChat(prev => [{ q:question, a:`[AGENT BRICKS] Error: ${e.message}` }, ...prev.slice(0,4)]);
    } finally { setLoad(false); }
  }, [query, loading]);

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <style>{`@keyframes rsh-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Charts row */}
      <div style={{ padding:"10px 12px 10px", flexShrink:0,
                    display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10,
                    borderBottom:"1px solid rgba(255,255,255,.055)" }}>
        <Card title="Hourly fraud rate — all channels today">
          <ResponsiveContainer width="100%" height={175}>
            <ComposedChart data={hourlyData}>
              <XAxis dataKey="hour" {...AX}/>
              <YAxis {...AX} tickFormatter={v=>`${v}%`}/>
              <Tooltip contentStyle={TT} formatter={v=>[`${v}%`]}/>
              <Area type="monotone" dataKey="pct" stroke="#f43f5e" strokeWidth={1.5}
                    fill="rgba(244,63,94,.07)" dot={false} name="Fraud rate"/>
              <Line type="monotone" dataKey="base" stroke="#f59e0b" strokeWidth={1}
                    strokeDasharray="4 3" dot={false} name="Baseline"/>
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Decline reason breakdown">
          {s.decline.length > 0 ? (
            <ResponsiveContainer width="100%" height={175}>
              <PieChart>
                <Pie data={s.decline.map(r=>({name:r.decline_reason,value:+r.cnt||0}))}
                     cx="50%" cy="50%" innerRadius={42} outerRadius={64}
                     dataKey="value" stroke="none">
                  {s.decline.map((_,i) => <Cell key={i} fill={PC[i%PC.length]}/>)}
                </Pie>
                <Tooltip contentStyle={TT}/>
                <Legend iconSize={8} wrapperStyle={{ fontSize:11, color:"#7a8ba0" }}/>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height:175, display:"flex", alignItems:"center",
                          justifyContent:"center", color:"#384d63", fontSize:12 }}>
              No declines today
            </div>
          )}
        </Card>

        <Card title="Risk score distribution">
          <ResponsiveContainer width="100%" height={175}>
            <BarChart data={s.riskDist.map(r=>({bucket:r.bucket,cnt:+r.cnt||0}))}>
              <XAxis dataKey="bucket" {...AX}/>
              <YAxis {...AX}/>
              <Tooltip contentStyle={TT}/>
              <Bar dataKey="cnt" radius={[3,3,0,0]}>
                {s.riskDist.map((r,i) => <Cell key={i} fill={RC[r.bucket]||"#374151"}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Query bar */}
      <div style={{ padding:"11px 14px", borderBottom:"1px solid rgba(255,255,255,.055)",
                    background:"#0c0f16", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#384d63", textTransform:"uppercase",
                        letterSpacing:".1em", fontFamily:"monospace" }}>
            Ask Genie + Agent Bricks
          </div>
          <button onClick={handleRefresh} style={{
            fontSize:11, padding:"3px 10px",
            border:"1px solid rgba(255,255,255,.1)", borderRadius:6,
            color:"#7a8ba0", background:"transparent", cursor:"pointer",
          }}>⟳ Refresh</button>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <textarea value={query} onChange={e=>setQuery(e.target.value)} rows={1}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask();} }}
            placeholder="e.g. Why did UPI fraud spike at 11 PM yesterday?"
            style={{ flex:1, background:"#07090e", border:"1px solid rgba(255,255,255,.1)",
                     borderRadius:8, padding:"8px 11px", color:"#d8e0eb", fontSize:13,
                     outline:"none", resize:"none", lineHeight:1.4 }}/>
          <button onClick={()=>ask()} disabled={loading} style={{
            background:"#00dba8", color:"#000", border:"none", borderRadius:8,
            padding:"8px 14px", fontWeight:700, fontSize:13, flexShrink:0,
            opacity:loading?0.4:1, cursor:"pointer",
          }}>{loading?"…":"Ask ↵"}</button>
        </div>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:7 }}>
          {CHIPS.map((c,i) => (
            <button key={i} onClick={()=>setQuery(c.q)} style={{
              fontSize:12, padding:"4px 10px",
              border:"1px solid rgba(255,255,255,.1)", borderRadius:20,
              color:"#7a8ba0", background:"transparent", cursor:"pointer",
            }}>{c.label}</button>
          ))}
        </div>
      </div>

      {/* Scrollable chat area */}
      <div style={{ flex:1, overflowY:"auto", padding:12 }}>
        {loading && <Spinner/>}

        {!loading && chat.length === 0 && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                        justifyContent:"center", padding:48, color:"#384d63" }}>
            <svg width="48" height="48" fill="none" viewBox="0 0 24 24" style={{ marginBottom:14, opacity:.4 }}>
              <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" stroke="#384d63" strokeWidth="1.5"/>
              <path d="M8 12s1.5 2 4 2 4-2 4-2" stroke="#384d63" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="9" cy="9" r="1" fill="#384d63"/>
              <circle cx="15" cy="9" r="1" fill="#384d63"/>
            </svg>
            <div style={{ fontSize:14, fontWeight:500, color:"#7a8ba0", marginBottom:6 }}>
              Ask Genie + Agent Bricks anything
            </div>
            <div style={{ fontSize:13, color:"#384d63", textAlign:"center", maxWidth:300 }}>
              Click a chip above or type a question to get AI-powered fraud analysis with live Databricks data.
            </div>
          </div>
        )}

        {chat.map((item,i) => (
          <div key={i} style={{ background:"#111620", border:"1px solid rgba(255,255,255,.055)",
                                 borderRadius:12, padding:14, marginBottom:9 }}>
            <div style={{ fontSize:12, color:"#7a8ba0", fontStyle:"italic", marginBottom:8 }}>
              ❓ {item.q}
            </div>
            <GenieViz genie={item.genie}/>
            {parseTags(item.a).map((sec, j) => <TagSection key={j} tag={sec.tag} content={sec.content} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
