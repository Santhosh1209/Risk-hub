export default function KPICard({ label, value, delta, up }) {
  return (
    <div style={{ background:"#111620", border:"1px solid rgba(255,255,255,.055)",
                  borderRadius:8, padding:"10px 12px" }}>
      <div style={{ fontSize:11, color:"#384d63", fontFamily:"monospace",
                    textTransform:"uppercase", letterSpacing:".1em", marginBottom:4 }}>
        {label}
      </div>
      <div style={{ fontSize:28, fontWeight:600, letterSpacing:"-.5px", lineHeight:1, color:"#d8e0eb" }}>
        {value ?? "—"}
      </div>
      {delta && (
        <div style={{ fontSize:11, fontFamily:"monospace", marginTop:2,
                      color: up ? "#f43f5e" : "#22c55e" }}>
          {up ? "▲" : "▼"} {delta}
        </div>
      )}
    </div>
  );
}
