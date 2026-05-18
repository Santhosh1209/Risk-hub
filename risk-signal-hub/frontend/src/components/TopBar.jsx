const NAV = [
  { id:"dashboard", label:"Dashboard", dot:"#f43f5e" },
  { id:"rules",     label:"Rule Engine" },
  { id:"forecast",  label:"Forecast" },
  { id:"cases",     label:"Cases", dot:"#f59e0b" },
  { id:"network",   label:"Network" },
  { id:"reports",   label:"Reports" },
  { id:"settings",  label:"Settings" },
];

export default function TopBar({ active, setActive, alertCount=0 }) {
  return (
    <div style={{ height:50, flexShrink:0, display:"flex", alignItems:"center", gap:10,
                  padding:"0 16px", borderBottom:"1px solid rgba(255,255,255,.055)",
                  background:"rgba(7,9,14,.97)" }}>

      <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:6 }}>
        <div style={{ width:24, height:24, borderRadius:6, flexShrink:0,
                      background:"linear-gradient(135deg,#00dba8,#0ea5e9)",
                      display:"flex", alignItems:"center", justifyContent:"center" }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5.5" stroke="#000" strokeWidth="1.1"/>
            <path d="M3.5 6.5l2 2 4-4" stroke="#000" strokeWidth="1.3"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span style={{ fontSize:13, fontWeight:600 }}>Risk Signal Hub</span>      </div>

      <div style={{ width:1, height:20, background:"rgba(255,255,255,.1)" }}/>

      <nav style={{ display:"flex", gap:1, flex:1, overflowX:"auto" }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setActive(n.id)} style={{
            padding:"4px 11px", borderRadius:6, fontSize:11, fontWeight:500,
            border: active===n.id ? "1px solid rgba(0,219,168,.14)" : "1px solid transparent",
            background: active===n.id ? "rgba(0,219,168,.09)" : "transparent",
            color: active===n.id ? "#00dba8" : "#7a8ba0",
            display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap",
          }}>
            {n.dot && <div style={{ width:5, height:5, borderRadius:"50%", background:n.dot }}/>}
            {n.label}
          </button>
        ))}
      </nav>

      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:"#22c55e",
                        animation:"bpulse 2s infinite" }}/>
          <span style={{ fontSize:9, color:"#7a8ba0", fontFamily:"monospace" }}>LIVE</span>
        </div>
        {alertCount > 0 && (
          <span style={{ background:"rgba(244,63,94,.12)", color:"#fb7185",
                         border:"1px solid rgba(244,63,94,.2)", borderRadius:20,
                         padding:"2px 8px", fontSize:9, fontWeight:600, fontFamily:"monospace" }}>
            {alertCount} alert{alertCount!==1?"s":""}
          </span>
        )}
      </div>
    </div>
  );
}