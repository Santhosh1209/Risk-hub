import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const TT  = { backgroundColor:"#171e2b", border:"1px solid rgba(255,255,255,.07)", borderRadius:6, color:"#d8e0eb", fontSize:12 };
const AX  = { tick:{ fill:"#384d63", fontSize:11, fontFamily:"monospace" }, axisLine:false, tickLine:false };
const CLR = ["#f43f5e","#f59e0b","#a78bfa","#0ea5e9","#22c55e","#ec4899","#38bdf8"];

const DATE_SET = new Set([
  "date","txn_date","day","hour","txn_hour","month","week","period","time","created_at","ds",
]);

function tryNum(v) {
  if (v === "" || v == null) return null;
  const n = +v;
  return isNaN(n) ? null : n;
}

function fmtVal(v) {
  const n = tryNum(v);
  if (n === null) return v ?? "—";
  if (Math.abs(n) >= 100000) return `$${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000)   return n.toLocaleString("en-IN");
  if (n % 1 !== 0)           return n.toFixed(2);
  return String(n);
}

function classify(data) {
  const cols = Object.keys(data[0]);
  const sample = data.slice(0, 5);
  const dateCols = cols.filter(c => DATE_SET.has(c.toLowerCase()));
  const numCols  = cols.filter(c => {
    if (DATE_SET.has(c.toLowerCase())) return false;
    return sample.filter(r => tryNum(r[c]) !== null).length >= Math.min(2, sample.length);
  });
  const catCols = cols.filter(c => !dateCols.includes(c) && !numCols.includes(c));
  return { cols, dateCols, numCols, catCols };
}

function pickViz(data, info) {
  const { dateCols, numCols, catCols, cols } = info;
  if (!data?.length || numCols.length === 0) return { type:"table", cols };

  // Single row → KPI cards (aggregate summary result)
  if (data.length === 1) return { type:"kpi", cols, numCols, catCols };

  // 2-3 rows → compact table
  if (data.length <= 3) return { type:"table", cols };

  const xKey = dateCols[0] || catCols[0] || cols.find(c => !numCols.includes(c)) || cols[0];
  const yKey = numCols[0];
  const y2   = numCols[1] || null;
  if (dateCols.length > 0) return { type:"area", xKey, yKey, y2, cols };
  return { type:"bar", xKey, yKey, y2, cols };
}

function coerce(row, numCols) {
  const out = { ...row };
  numCols.forEach(c => { const n = tryNum(row[c]); if (n !== null) out[c] = n; });
  return out;
}

function StatsRow({ data, yKey, y2 }) {
  function colStats(col) {
    const vals = data.map(r => tryNum(r[col])).filter(v => v !== null);
    if (!vals.length) return null;
    const min   = Math.min(...vals);
    const max   = Math.max(...vals);
    const avg   = vals.reduce((a, b) => a + b, 0) / vals.length;
    const total = vals.reduce((a, b) => a + b, 0);
    return { min, max, avg, total };
  }

  const s1 = colStats(yKey);
  if (!s1) return null;
  const s2 = y2 ? colStats(y2) : null;

  const chips = [
    { lbl: "min",   val: fmtVal(s1.min)   },
    { lbl: "max",   val: fmtVal(s1.max)   },
    { lbl: "avg",   val: fmtVal(s1.avg)   },
    { lbl: "total", val: fmtVal(s1.total) },
    ...(s2 ? [
      { lbl: `${y2} avg`,   val: fmtVal(s2.avg),   dim: true },
      { lbl: `${y2} total`, val: fmtVal(s2.total),  dim: true },
    ] : []),
  ];

  return (
    <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
      {chips.map(({ lbl, val, dim }) => (
        <div key={lbl} style={{
          background: dim ? "rgba(167,139,250,.06)" : "rgba(0,219,168,.06)",
          border: `1px solid ${dim ? "rgba(167,139,250,.15)" : "rgba(0,219,168,.14)"}`,
          borderRadius:6, padding:"4px 9px", minWidth:52,
        }}>
          <div style={{ fontSize:9, color:"#384d63", fontFamily:"monospace",
                        textTransform:"uppercase", letterSpacing:".06em", marginBottom:2 }}>
            {lbl}
          </div>
          <div style={{ fontSize:13, fontWeight:600, fontFamily:"monospace",
                        color: dim ? "#a78bfa" : "#00dba8" }}>
            {val}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GenieViz({ genie }) {
  if (!genie || genie.status === "error" || !genie.data?.length) return null;

  const { sql, data, summary } = genie;
  const info    = classify(data);
  const coerced = data.map(r => coerce(r, info.numCols));
  const viz     = pickViz(data, info);

  return (
    <div style={{ marginBottom:12, padding:"12px 14px",
                  background:"rgba(0,219,168,.04)", border:"1px solid rgba(0,219,168,.14)",
                  borderRadius:10 }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:".12em",
                       fontFamily:"monospace", color:"#00dba8", textTransform:"uppercase" }}>
          ⬡ Genie Data
        </span>
        <span style={{ fontSize:11, color:"#384d63" }}>· {data.length} row{data.length !== 1 ? "s" : ""}</span>
        {sql && (
          <details style={{ marginLeft:"auto" }}>
            <summary style={{ fontSize:11, color:"#384d63", cursor:"pointer",
                              userSelect:"none", listStyle:"none", fontFamily:"monospace" }}>
              view SQL ▾
            </summary>
            <pre style={{ margin:"8px 0 0", padding:"9px 12px", background:"#07090e",
                          border:"1px solid rgba(255,255,255,.07)", borderRadius:8,
                          fontSize:11, color:"#7a8ba0", fontFamily:"monospace",
                          whiteSpace:"pre-wrap", wordBreak:"break-word", lineHeight:1.6 }}>
              {sql}
            </pre>
          </details>
        )}
      </div>

      {/* KPI card mode — single aggregate row */}
      {viz.type === "kpi" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))", gap:8 }}>
          {viz.numCols.map(c => (
            <div key={c} style={{ background:"#111620", border:"1px solid rgba(255,255,255,.07)",
                                   borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:"#384d63", fontFamily:"monospace",
                             textTransform:"uppercase", letterSpacing:".08em", marginBottom:5 }}>
                {c.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize:22, fontWeight:600, color:"#00dba8", letterSpacing:"-.5px" }}>
                {fmtVal(data[0][c])}
              </div>
            </div>
          ))}
          {viz.catCols.map(c => (
            <div key={c} style={{ background:"#111620", border:"1px solid rgba(255,255,255,.07)",
                                   borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:"#384d63", fontFamily:"monospace",
                             textTransform:"uppercase", letterSpacing:".08em", marginBottom:5 }}>
                {c.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:"#d8e0eb" }}>
                {data[0][c] ?? "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Area chart — time series */}
      {viz.type === "area" && (
        <StatsRow data={data} yKey={viz.yKey} y2={viz.y2} />
      )}
      {viz.type === "area" && (
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={coerced}>
            <XAxis dataKey={viz.xKey} {...AX}/>
            <YAxis {...AX}/>
            <Tooltip contentStyle={TT}/>
            <Area type="monotone" dataKey={viz.yKey} stroke="#f43f5e" strokeWidth={1.5}
                  fill="rgba(244,63,94,.08)" dot={false} name={viz.yKey}/>
            {viz.y2 && (
              <Area type="monotone" dataKey={viz.y2} stroke="#f59e0b" strokeWidth={1.5}
                    fill="rgba(245,158,11,.06)" dot={false} name={viz.y2}/>
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Bar chart — categorical comparison */}
      {viz.type === "bar" && (
        <StatsRow data={data} yKey={viz.yKey} y2={viz.y2} />
      )}
      {viz.type === "bar" && (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={coerced} margin={{ left:0, right:8 }}>
            <XAxis dataKey={viz.xKey} {...AX}/>
            <YAxis {...AX}/>
            <Tooltip contentStyle={TT}/>
            <Bar dataKey={viz.yKey} radius={[3,3,0,0]} name={viz.yKey}>
              {coerced.map((_,i) => <Cell key={i} fill={CLR[i % CLR.length]}/>)}
            </Bar>
            {viz.y2 && (
              <Bar dataKey={viz.y2} radius={[3,3,0,0]} fill="#a78bfa" name={viz.y2}/>
            )}
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Table — few rows or mixed types */}
      {viz.type === "table" && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse",
                          fontSize:12, fontFamily:"monospace", color:"#d8e0eb" }}>
            <thead>
              <tr>
                {viz.cols.map(c => (
                  <th key={c} style={{ textAlign:"left", padding:"5px 10px", color:"#384d63",
                                       fontWeight:700, fontSize:11, textTransform:"uppercase",
                                       letterSpacing:".08em",
                                       borderBottom:"1px solid rgba(255,255,255,.07)" }}>
                    {c.replace(/_/g," ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((row, i) => (
                <tr key={i} style={{ background: i%2===0 ? "transparent" : "rgba(255,255,255,.02)" }}>
                  {viz.cols.map(c => (
                    <td key={c} style={{ padding:"6px 10px",
                                         borderBottom:"1px solid rgba(255,255,255,.04)",
                                         color: tryNum(row[c]) !== null ? "#00dba8" : "#d8e0eb" }}>
                      {tryNum(row[c]) !== null ? fmtVal(row[c]) : (row[c] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 10 && (
            <div style={{ fontSize:11, color:"#384d63", padding:"5px 10px", fontFamily:"monospace" }}>
              +{data.length - 10} more rows
            </div>
          )}
        </div>
      )}

      {/* Genie natural language summary */}
      {summary && (
        <div style={{ marginTop:10, fontSize:12, color:"#7a8ba0", lineHeight:1.65,
                      borderLeft:"2px solid rgba(0,219,168,.3)", paddingLeft:10 }}>
          {summary}
        </div>
      )}
    </div>
  );
}
