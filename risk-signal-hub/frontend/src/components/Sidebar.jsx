import { useState, useEffect } from "react";
import KPICard from "./KPICard.jsx";
import { LineChart, Line, BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { fetchKPIs, fetchSevenDayTrend, fetchChannelSplit, fetchAlerts } from "../api/dashboard.js";

const SEV_COLOR = { CRITICAL:"#f43f5e", WARNING:"#f59e0b", RESOLVED:"#22c55e", INFO:"#22c55e" };
const CC = (m) => ({"UPI":"rgba(244,63,94,.7)","CARD":"rgba(245,158,11,.65)","WALLET":"rgba(34,197,94,.6)"})[m] || "rgba(34,197,94,.4)";

const TT = { backgroundColor:"#171e2b", border:"1px solid rgba(255,255,255,.07)", borderRadius:6, color:"#d8e0eb", fontSize:10 };
const AX = { tick:{ fill:"#384d63", fontSize:9, fontFamily:"monospace" }, axisLine:false, tickLine:false };

function fmtTime(str) {
  if (!str) return "";
  try {
    return new Date(str).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true });
  } catch { return ""; }
}

function fmtNum(n) {
  const v = +n || 0;
  return v >= 1000 ? `${(v/1000).toFixed(1)}K` : String(v);
}

export default function Sidebar({ onAction, onAlertCount }) {
  const [kpis,     setKpis]     = useState(null);
  const [trend,    setTrend]    = useState([]);
  const [channels, setChannels] = useState([]);
  const [alerts,   setAlerts]   = useState([]);
  const [loadErr,  setLoadErr]  = useState(null);

  useEffect(() => {
    setLoadErr(null);
    fetchKPIs().then(setKpis).catch(e => setLoadErr(e.message || "Failed"));
    fetchSevenDayTrend().then(v => setTrend(v || [])).catch(() => {});
    fetchChannelSplit().then(v => setChannels(v || [])).catch(() => {});
    fetchAlerts().then(v => {
      setAlerts(v || []);
      onAlertCount?.(Array.isArray(v) ? v.length : 0);
    }).catch(() => {});
  }, []);

  const blocked = kpis ? `$${(+(kpis.exposure_lakhs||0) * 0.34).toFixed(1)}L` : "—";

  return (
    <div style={{ width:280, flexShrink:0, borderRight:"1px solid rgba(255,255,255,.055)",
                  background:"#0c0f16", overflowY:"auto", padding:12 }}>
      {loadErr && (
        <div style={{ fontSize:11, color:"#f43f5e", background:"rgba(244,63,94,.08)",
                      border:"1px solid rgba(244,63,94,.25)", borderRadius:6,
                      padding:"6px 9px", marginBottom:10, fontFamily:"monospace" }}>
          ⚠ {loadErr}
        </div>
      )}
      <Lbl>Live KPIs</Lbl>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:18 }}>
        <KPICard label="Fraud rate"   value={kpis ? `${kpis.fraud_rate_pct}%` : "—"} delta="+0.61%" up />
        <KPICard label="Declines"     value={kpis ? fmtNum(kpis.total_declines) : "—"} delta="+18%" up />
        <KPICard label="Decline rate" value={kpis ? `${kpis.decline_rate_pct}%` : "—"} />
        <KPICard label="Risk score"   value={kpis?.avg_risk_score ?? "—"} delta="+4.3" up />
        <KPICard label="Exposure"     value={kpis ? `$${kpis.exposure_lakhs}L` : "—"} />
        <KPICard label="Blocked $"   value={blocked} />
      </div>

      <Lbl>7-day trend</Lbl>
      <div style={{ marginBottom:18 }}>
        {trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={105}>
            <LineChart data={trend.map(r => {
              const abbr = r.txn_date
                ? ["S","M","T","W","T","F","S"][new Date(r.txn_date).getDay()] ?? r.txn_date.slice(5)
                : "";
              return { date: abbr, pct: +r.fraud_rate_pct || 0 };
            })} margin={{ top:4, right:4, left:0, bottom:0 }}>
              <XAxis dataKey="date" {...AX} />
              <YAxis {...AX} width={28} tickCount={3} tickFormatter={v=>`${v}%`} />
              <Tooltip contentStyle={TT} formatter={v=>[`${v}%`,"Fraud rate"]}/>
              <Line type="monotone" dataKey="pct" stroke="#f43f5e" strokeWidth={1.5} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height:105, display:"flex", alignItems:"center",
                        justifyContent:"center", color:"#384d63", fontSize:12 }}>
            {loadErr ? "—" : "Connecting…"}
          </div>
        )}
      </div>

      <Lbl>Channel split (7d)</Lbl>
      <div style={{ marginBottom:18 }}>
        {channels.length > 0 ? (
          <ResponsiveContainer width="100%" height={105}>
            <BarChart data={channels.map(r=>({ method:r.payment_method, pct:+r.fraud_rate_pct||0 }))}
                      margin={{ top:4, right:4, left:0, bottom:0 }}>
              <XAxis dataKey="method" {...AX}/>
              <YAxis {...AX} width={28} tickCount={3} tickFormatter={v=>`${v}%`} />
              <Tooltip contentStyle={TT} formatter={v=>[`${v}%`,"Fraud rate"]}/>
              <Bar dataKey="pct" radius={[3,3,0,0]}>
                {channels.map((r,i) => <Cell key={i} fill={CC(r.payment_method)}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height:105, display:"flex", alignItems:"center",
                        justifyContent:"center", color:"#384d63", fontSize:12 }}>
            {loadErr ? "—" : "Connecting…"}
          </div>
        )}
      </div>

      <Lbl>Active Alerts</Lbl>
      <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:18 }}>
        {!alerts.length && <div style={{ fontSize:12, color:"#384d63" }}>No active alerts</div>}
        {alerts.map((a, i) => {
          const sev = (a.severity||"").toUpperCase();
          const col = SEV_COLOR[sev] || "#22c55e";
          return (
            <div key={i} onClick={() => onAction?.(`Analyse case ${a.case_id}: ${a.title}`)}
              style={{ borderLeft:`3px solid ${col}`, background:`${col}12`,
                       padding:"7px 9px 7px 11px", borderRadius:"0 6px 6px 0", cursor:"pointer" }}>
              <div style={{ fontSize:11, fontWeight:700, color:col, fontFamily:"monospace" }}>
                {sev}
              </div>
              <div style={{ fontSize:12, color:"#7a8ba0", lineHeight:1.4, marginTop:2 }}>{a.title}</div>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
                <span style={{ fontSize:11, color:"#384d63", fontFamily:"monospace" }}>
                  ${((a.exposure_amt||0)/100000).toFixed(1)}L
                </span>
                <span style={{ fontSize:11, color:"#384d63", fontFamily:"monospace" }}>
                  {fmtTime(a.created_at)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <Lbl>Quick Actions</Lbl>
      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
        {[
          ["AI executive summary",    "Generate 3-bullet executive summary of today's risk posture"],
          ["Top 3 actions now",       "What are the top 3 immediate fraud actions I should take right now?"],
          ["Generate incident report","Generate a fraud incident report for the highest severity open case"],
        ].map(([label, prompt]) => (
          <button key={label} onClick={() => onAction?.(prompt)} style={{
            width:"100%", textAlign:"left", background:"transparent",
            border:"1px solid rgba(255,255,255,.07)", borderRadius:6,
            padding:"5px 9px", fontSize:12, color:"#7a8ba0", cursor:"pointer",
          }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function Lbl({ children }) {
  return (
    <div style={{ fontSize:11, fontWeight:700, color:"#384d63", textTransform:"uppercase",
                  letterSpacing:".1em", fontFamily:"monospace", marginBottom:7, marginTop:14 }}>
      {children}
    </div>
  );
}
