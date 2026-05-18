import { useState, useEffect } from "react";
import {
  ComposedChart, Line, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  fetchHistory, fetchPredictions, fetchMerchants,
  fetchCityRisk, fetchSuspectCustomers, FORECAST_KEYS,
} from "../api/forecast";
import { invalidate } from "../api/cache.js";
import { askAgent } from "../api/agent.js";
import AgentBricksWindow from "../components/AgentBricksWindow.jsx";

// ── style tokens ──────────────────────────────────────────────────────────────
const C = {
  bg3: "#111620", bg4: "#171e2b", bg5: "#1e2736",
  b: "rgba(255,255,255,.055)", b2: "rgba(255,255,255,.1)",
  t: "#d8e0eb", t2: "#7a8ba0", t3: "#384d63",
  a: "#00dba8", r: "#f43f5e", w: "#f59e0b", g: "#22c55e",
};

const MODEL_COLORS = {
  Ensemble: "#f43f5e", Prophet: "#00dba8",
  SARIMA: "#f59e0b", "Ridge Regression": "#a78bfa",
};

const AX = {
  tick: { fill: C.t3, fontSize: 9, fontFamily: "monospace" },
  axisLine: false, tickLine: false,
};
const TT = {
  contentStyle: {
    background: C.bg4, border: `1px solid ${C.b2}`,
    borderRadius: 6, color: C.t, fontSize: 11,
  },
  labelStyle: { color: C.t2 },
};

// ── tiny UI primitives ────────────────────────────────────────────────────────
const PILL_STYLES = {
  r: { bg: "rgba(244,63,94,.1)",   c: "#fb7185", border: "rgba(244,63,94,.18)" },
  w: { bg: "rgba(245,158,11,.1)",  c: "#fbbf24", border: "rgba(245,158,11,.18)" },
  g: { bg: "rgba(34,197,94,.08)",  c: "#4ade80", border: "rgba(34,197,94,.16)" },
  a: { bg: "rgba(0,219,168,.08)",  c: "#00dba8", border: "rgba(0,219,168,.16)" },
  p: { bg: "rgba(167,139,250,.1)", c: "#c4b5fd", border: "rgba(167,139,250,.18)" },
  b: { bg: "rgba(14,165,233,.1)",  c: "#38bdf8", border: "rgba(14,165,233,.18)" },
};

function Pill({ label, color = "p" }) {
  const s = PILL_STYLES[color] || PILL_STYLES.p;
  return (
    <span style={{
      display: "inline-block", fontSize: 9, padding: "2px 7px", borderRadius: 20,
      fontFamily: "monospace", fontWeight: 600, whiteSpace: "nowrap", marginRight: 3,
      background: s.bg, color: s.c, border: `1px solid ${s.border}`,
    }}>{label}</span>
  );
}

function Card({ title, badge, children, style = {} }) {
  return (
    <div style={{
      background: C.bg3, border: `1px solid ${C.b}`,
      borderRadius: 12, padding: 14, ...style,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: C.t3, textTransform: "uppercase",
        letterSpacing: ".08em", fontFamily: "monospace", marginBottom: 10,
        display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
      }}>
        {title}
        {badge}
      </div>
      {children}
    </div>
  );
}

function Insight({ children }) {
  return (
    <div style={{
      marginTop: 9, padding: "8px 10px",
      background: "rgba(0,219,168,.05)", borderLeft: `2px solid ${C.a}`,
      borderRadius: "0 6px 6px 0", fontSize: 11, color: C.t2, lineHeight: 1.55,
    }}>{children}</div>
  );
}

function AskAIBtn({ label, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        background: hov ? "rgba(0,219,168,.05)" : C.bg4,
        border: `1px solid ${hov ? C.a : C.b2}`,
        borderRadius: 8, padding: "6px 11px",
        color: hov ? C.a : C.t2, cursor: "pointer",
        fontSize: 10, fontFamily: "inherit", marginTop: 8,
      }}
    >
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: C.a, display: "inline-block", flexShrink: 0,
      }} />
      {label}
    </button>
  );
}

function ScoreBar({ score }) {
  const pct = Math.min(score, 100);
  const color = score > 75 ? C.r : score > 50 ? C.w : C.g;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        flex: 1, height: 5, background: C.bg5, borderRadius: 3,
        minWidth: 60, overflow: "hidden",
      }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{
        fontFamily: "monospace", fontSize: 10, fontWeight: 600,
        color, minWidth: 22, textAlign: "right",
      }}>{score}</span>
    </div>
  );
}

// ── derive helpers ────────────────────────────────────────────────────────────
function merchantSignals(m) {
  const cat = (m.merchant_category || "").toLowerCase();
  const score = m.avg_risk_score || 0;
  const sigs = [];
  if (cat.includes("food"))        sigs.push(["Off-hrs",     "r"]);
  if (cat.includes("electronics")) sigs.push(["High ticket", "w"]);
  if (cat.includes("fuel"))        sigs.push(["Card skimming","w"]);
  if (score > 80)                  sigs.push(["ATO",         "r"]);
  if (!sigs.length && score > 55)  sigs.push(["Elevated",    "w"]);
  return sigs.length ? sigs : [["—", "p"]];
}

function merchantStatus(m) {
  const score = m.avg_risk_score || 0;
  const rs = (m.risk_status || "").toLowerCase();
  if (rs.includes("block") || score > 85) return { label: "Block pending",  color: "r" };
  if (rs.includes("watch") || score > 65) return { label: "Enhanced mon.",  color: "w" };
  if (rs.includes("monitor") || score > 40) return { label: "Watch list",   color: "w" };
  return { label: "Low risk", color: "g" };
}

function merchantTrend(m) {
  const r = m.fraud_rate_pct || 0;
  if (r > 3)   return { label: "↑↑↑", color: C.r };
  if (r > 2)   return { label: "↑↑—", color: C.w };
  if (r > 1)   return { label: "↑——", color: C.t2 };
  return { label: "↓↓↓", color: C.g };
}

function cityColor(rate) {
  if (rate > 3)   return C.r;
  if (rate > 1.5) return C.w;
  if (rate < 1)   return C.g;
  return C.t;
}

function cityLabel(rate) {
  if (rate > 3)   return "▲ HIGH";
  if (rate > 2)   return "▲ ELEVATED";
  if (rate > 1.5) return "↑ RISING";
  if (rate < 1)   return "↓ LOW";
  return "— STABLE";
}

function custAvatarStyle(score) {
  if (score > 80) return { bg: "rgba(244,63,94,.12)",  c: "#fb7185" };
  if (score > 60) return { bg: "rgba(245,158,11,.12)", c: "#fbbf24" };
  return              { bg: "rgba(34,197,94,.1)",   c: "#4ade80" };
}

function custBorder(score) {
  if (score > 80) return "rgba(244,63,94,.25)";
  if (score > 60) return "rgba(245,158,11,.2)";
  return C.b;
}

function custStatus(score) {
  if (score > 80) return "Flagged";
  if (score > 60) return "Watch";
  return "Normal";
}

function custPatterns(c) {
  const p = (c.fraud_pattern || "").toLowerCase();
  if (p.includes("ato"))      return [["ATO", "r"], ["Velocity", "r"]];
  if (p.includes("bust"))     return [["Bust-out", "w"]];
  if (p.includes("velocity")) return [["Velocity", "w"]];
  if ((c.avg_risk_score || 0) < 30) return [["Low risk", "g"]];
  return [["Monitor", "p"]];
}

function txnsPerHr(c) {
  const days = Math.max(c.account_age_days || 1, 1);
  return ((c.total_txns || 0) / (days * 24)).toFixed(1);
}

// ── main component ────────────────────────────────────────────────────────────
export default function Forecast() {
  const [history,   setHistory]   = useState([]);
  const [forecast,  setForecast]  = useState(null);
  const [merchants, setMerchants] = useState([]);
  const [cities,    setCities]    = useState([]);
  const [customers, setCustomers] = useState([]);
  const [activeModel, setActiveModel] = useState("Ensemble");
  const [horizon,   setHorizon]   = useState(7);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // ── data load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    async function safe(fn, fb) { try { return await fn(); } catch { return fb; } }
    Promise.all([
      safe(fetchHistory,                       []),
      safe(() => fetchPredictions(horizon),    null),
      safe(fetchMerchants,                     []),
      safe(fetchCityRisk,                      []),
      safe(fetchSuspectCustomers,              []),
    ]).then(([h, f, m, c, cu]) => {
      setHistory(h || []);
      setForecast(f);
      setMerchants(m || []);
      setCities(c || []);
      setCustomers((cu || []).slice(0, 6));
      setLoading(false);
    });
  }, [horizon, refreshTick]);

  function handleRefresh() {
    invalidate(
      FORECAST_KEYS.history, FORECAST_KEYS.merchants,
      FORECAST_KEYS.cityRisk, FORECAST_KEYS.suspects,
      FORECAST_KEYS.predict(7), FORECAST_KEYS.predict(14),
    );
    setRefreshTick(t => t + 1);
  }

  // ── AI opener ──────────────────────────────────────────────────────────────
  function openAI(prompt) {
    setModal({ prompt, result: null, loading: true });
    askAgent(prompt)
      .then(r  => setModal(m => m && { ...m, result: r.answer || JSON.stringify(r), loading: false }))
      .catch(e => setModal(m => m && { ...m, result: `Error: ${e.message}`, loading: false }));
  }

  // ── active predictions ─────────────────────────────────────────────────────
  const preds = (() => {
    if (!forecast) return [];
    if (activeModel === "Ensemble")        return forecast?.ensemble?.predictions || [];
    if (activeModel === "Prophet")         return forecast?.models?.prophet?.predictions || [];
    if (activeModel === "SARIMA")          return forecast?.models?.sarima?.predictions || [];
    return forecast?.models?.ridge?.predictions || [];
  })();

  // ── chart data ─────────────────────────────────────────────────────────────
  const histSlice = history.slice(-14);

  const fraudChartData = [
    ...histSlice.map(r => ({
      label:  (r.txn_date || "").slice(5),
      actual: parseFloat(r.fraud_rate_pct) || 0,
    })),
    ...preds.map(p => ({
      label:    p.day_label || (p.date || "").slice(5),
      forecast: parseFloat(p.fraud_rate_pct) || 0,
      upper80:  parseFloat(p.upper_80 || 0),
      lower80:  parseFloat(p.lower_80 || 0),
    })),
  ];

  const expChartData = preds.map(p => ({
    label:      p.day_label || (p.date || "").slice(5),
    no_action:  parseFloat(p.exposure_no_action_lakhs) || 0,
    with_rules: parseFloat(p.exposure_with_rules_lakhs) || 0,
  }));

  // ── derived insights ───────────────────────────────────────────────────────
  const peakDay = preds.length
    ? preds.reduce((a, b) => b.fraud_rate_pct > a.fraud_rate_pct ? b : a, preds[0])
    : null;
  const weekendDays  = preds.filter(p => p.is_weekend).length;
  const totalExp     = preds.reduce((s, p) => s + (parseFloat(p.exposure_no_action_lakhs) || 0), 0);
  const savedExp     = preds.reduce((s, p) => s + (parseFloat(p.savings_lakhs) || 0), 0);
  const ruleEffPct   = preds.length > 0 ? (preds[0].rule_effectiveness_pct ?? 35) : 35;

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 20, color: C.t2, display: "flex", alignItems: "center", gap: 8 }}>
        Loading forecast models…
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: 14, color: C.t }}>

      {/* ── model / horizon selector ────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.t3, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", marginRight: 2 }}>Model</span>
        {["Ensemble", "Prophet", "SARIMA", "Ridge Regression"].map(m => (
          <button key={m} onClick={() => setActiveModel(m)} style={{
            padding: "4px 10px", borderRadius: 20, fontSize: 10, cursor: "pointer",
            border:      activeModel === m ? `1px solid ${MODEL_COLORS[m]}` : `1px solid ${C.b}`,
            background:  activeModel === m ? `${MODEL_COLORS[m]}20` : "transparent",
            color:       activeModel === m ? MODEL_COLORS[m] : C.t2,
            fontFamily: "inherit",
          }}>{m}</button>
        ))}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>Horizon</span>
          {[7, 14].map(h => (
            <button key={h} onClick={() => setHorizon(h)} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 10, cursor: "pointer",
              border:     horizon === h ? `1px solid ${C.a}` : `1px solid ${C.b}`,
              background: horizon === h ? "rgba(0,219,168,.1)" : "transparent",
              color:      horizon === h ? C.a : C.t2,
              fontFamily: "inherit",
            }}>{h}d</button>
          ))}
          <button onClick={handleRefresh} style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 10, cursor: "pointer",
            border: `1px solid ${C.b}`, background: "transparent",
            color: C.t2, fontFamily: "inherit", marginLeft: 4,
          }}>⟳ Refresh</button>
        </div>
      </div>

      {/* ── top row: fraud chart + exposure chart ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>

        {/* Fraud rate forecast */}
        <Card title="Fraud rate forecast — next 7 days" badge={<Pill label="ML forecast" color="w" />}>
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={fraudChartData}>
              <XAxis dataKey="label" {...AX} interval="preserveStartEnd" />
              <YAxis {...AX} tickFormatter={v => `${v}%`} width={38} />
              <Tooltip {...TT} formatter={(v, n) => [`${Number(v).toFixed(2)}%`, n]} />
              <Area dataKey="upper80" fill={`${MODEL_COLORS[activeModel]}18`} stroke="transparent" legendType="none" />
              <Area dataKey="lower80" fill="#111620" stroke="transparent" legendType="none" />
              <Line dataKey="actual"   stroke={C.r}                    strokeWidth={2} dot={false} name="Actual" />
              <Line dataKey="forecast" stroke={MODEL_COLORS[activeModel]} strokeWidth={2} dot={false} strokeDasharray="5 5" name="Forecast" />
            </ComposedChart>
          </ResponsiveContainer>
          <Insight>
            <strong style={{ color: C.a }}>Agent Bricks:</strong>{" "}
            {peakDay
              ? <>Fraud rate forecast to peak at <strong style={{ color: C.a }}>{peakDay.fraud_rate_pct}%</strong> on {peakDay.day_label || peakDay.date}
                  {weekendDays > 0 && ` (weekend surge, ${weekendDays} weekend days in range)`}. UPI drives majority of projected increase. Pre-emptive threshold tightening recommended.</>
              : "No forecast data available — check backend connection."}
          </Insight>
          <AskAIBtn label="Deep forecast analysis" onClick={() => openAI(
            `Forecast UPI fraud for next ${horizon} days using historical weekend surge patterns. Show confidence intervals and key risk drivers.`
          )} />
        </Card>

        {/* Exposure projection */}
        <Card title="Financial exposure projection" badge={<Pill label="$ projection" color="w" />}>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={expChartData}>
              <XAxis dataKey="label" {...AX} interval="preserveStartEnd" />
              <YAxis {...AX} tickFormatter={v => `$${v}L`} width={46} />
              <Tooltip {...TT} formatter={(v, n) => [`$${Number(v).toFixed(1)}L`, n]} />
              <Bar dataKey="no_action"  fill="rgba(244,63,94,.5)"  name="No action"  radius={[3,3,0,0]} />
              <Bar dataKey="with_rules" fill="rgba(0,219,168,.45)" name="With rules" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <Insight>
            <strong style={{ color: C.a }}>Agent Bricks:</strong>{" "}
            {totalExp > 0
              ? <>Projected <strong style={{ color: C.a }}>${totalExp.toFixed(1)}L</strong> exposure this period if no action. Active rules block <strong style={{ color: C.a }}>{ruleEffPct}%</strong> of fraud, saving <strong style={{ color: C.a }}>${savedExp.toFixed(1)}L</strong>.</>
              : "Exposure projections loading from forecast model."}
          </Insight>
          <AskAIBtn label="Model rule change impact" onClick={() => openAI(
            `Model the financial impact of lowering UPI rule threshold from 85 to 75. Show expected fraud blocked, false positive rate, and net savings in lakhs.`
          )} />
        </Card>
      </div>

      {/* ── merchant profiling ─────────────────────────────────────────────── */}
      <Card title="Suspect merchant profiling" badge={<Pill label="AI scored" color="a" />} style={{ marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              {["Merchant", "Category", "Fraud rate", "Risk score", "7d trend", "Signals", "Status"].map(h => (
                <th key={h} style={{
                  textAlign: "left", fontSize: 9, fontWeight: 700, color: C.t3,
                  textTransform: "uppercase", letterSpacing: ".07em", fontFamily: "monospace",
                  padding: "5px 10px", borderBottom: `1px solid ${C.b}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {merchants.map((m, i) => {
              const trend  = merchantTrend(m);
              const status = merchantStatus(m);
              const sigs   = merchantSignals(m);
              const rColor = m.fraud_rate_pct > 3 ? C.r : m.fraud_rate_pct > 1.5 ? C.w : C.g;
              return (
                <MerchantRow
                  key={i} m={m} trend={trend} status={status} sigs={sigs} rColor={rColor}
                  onClick={() => openAI(`Full AI risk profile and 30-day forecast for merchant ${m.merchant_id} in category ${m.merchant_category}. Fraud rate ${m.fraud_rate_pct}%, risk score ${m.avg_risk_score}. Include root cause and recommended action.`)}
                />
              );
            })}
          </tbody>
        </table>
        {merchants.length === 0 && (
          <div style={{ padding: 16, color: C.t3, fontSize: 11, textAlign: "center" }}>No merchant data</div>
        )}
        <AskAIBtn label="Forecast threshold breaches" onClick={() => openAI(
          `Which merchants are forecasted to breach the 3% fraud rate threshold in the next 7 days? Rank by urgency with supporting evidence.`
        )} />
      </Card>

      {/* ── location heatmap ───────────────────────────────────────────────── */}
      <Card title="Location risk heatmap" badge={<Pill label="AI scored" color="a" />} style={{ marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {cities.slice(0, 8).map((c, i) => {
            const rate  = parseFloat(c.fraud_rate_pct) || 0;
            const color = cityColor(rate);
            const label = cityLabel(rate);
            const pct   = Math.min((rate / 4) * 100, 100);
            return (
              <CityCard
                key={i} city={c} rate={rate} color={color} label={label} pct={pct}
                onClick={() => openAI(`Deep dive ${c.location_city} fraud risk. Why is fraud rate at ${rate}%? What is the 30-day forecast and what local factors drive it?`)}
              />
            );
          })}
        </div>
        {cities.length === 0 && (
          <div style={{ padding: 16, color: C.t3, fontSize: 11, textAlign: "center" }}>No city data</div>
        )}
        <AskAIBtn label="30-day city forecast" onClick={() => openAI(
          `Which cities are forecasted to have the highest fraud rate increase in the next 30 days? Rank and explain the drivers.`
        )} />
      </Card>

      {/* ── customer profiling ─────────────────────────────────────────────── */}
      <Card title="Suspect customer profiling" badge={<Pill label="AI scored" color="a" />}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {customers.map((c, i) => {
            const av      = custAvatarStyle(c.avg_risk_score);
            const border  = custBorder(c.avg_risk_score);
            const status  = custStatus(c.avg_risk_score);
            const patterns = custPatterns(c);
            const rColor  = c.avg_risk_score > 80 ? C.r : c.avg_risk_score > 60 ? C.w : C.g;
            const txhr    = txnsPerHr(c);
            return (
              <CustomerCard
                key={i} c={c} av={av} border={border} status={status}
                patterns={patterns} rColor={rColor} txhr={txhr}
                onClick={() => openAI(`Full AI risk profile for customer ${c.customer_id}. Risk score ${c.avg_risk_score}, ${txhr} txns/hr, account age ${c.account_age_days} days, ${c.unique_devices} unique devices. Fraud pattern: ${c.fraud_pattern}. Recommend action and forecast impact if not blocked.`)}
              />
            );
          })}
        </div>
        {customers.length === 0 && (
          <div style={{ padding: 16, color: C.t3, fontSize: 11, textAlign: "center" }}>No suspect customer data</div>
        )}
        <AskAIBtn label="High-risk segment forecast" onClick={() => openAI(
          `Forecast which customer segments are highest risk for fraud in the next 14 days. Include new accounts, high velocity users, and multi-device users.`
        )} />
      </Card>

      <AgentBricksWindow modal={modal} onClose={() => setModal(null)} />
    </div>
  );
}

// ── split out interactive rows/cards to avoid inline arrow fns in loops ───────

function MerchantRow({ m, trend, status, sigs, rColor, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ cursor: "pointer", background: hov ? C.bg4 : "transparent" }}
    >
      <td style={{ padding: "7px 10px", borderBottom: `1px solid ${C.b}`, color: C.t }}>
        <strong>{m.merchant_id}</strong>
        <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>{m.primary_city || ""}</div>
      </td>
      <td style={{ padding: "7px 10px", borderBottom: `1px solid ${C.b}`, color: C.t2 }}>{m.merchant_category}</td>
      <td style={{ padding: "7px 10px", borderBottom: `1px solid ${C.b}`, color: rColor, fontWeight: 600 }}>{m.fraud_rate_pct}%</td>
      <td style={{ padding: "7px 10px", borderBottom: `1px solid ${C.b}` }}>
        <ScoreBar score={m.avg_risk_score || 0} />
      </td>
      <td style={{ padding: "7px 10px", borderBottom: `1px solid ${C.b}`, color: trend.color, fontFamily: "monospace", fontWeight: 600 }}>
        {trend.label}
      </td>
      <td style={{ padding: "7px 10px", borderBottom: `1px solid ${C.b}` }}>
        {sigs.map(([l, c], j) => <Pill key={j} label={l} color={c} />)}
      </td>
      <td style={{ padding: "7px 10px", borderBottom: `1px solid ${C.b}` }}>
        <Pill label={status.label} color={status.color} />
      </td>
    </tr>
  );
}

function CityCard({ city, rate, color, label, pct, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: C.bg3, border: `1px solid ${hov ? C.b2 : C.b}`,
        borderRadius: 8, padding: "8px 10px", cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 3 }}>{city.location_city}</div>
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.5px", color, marginBottom: 2 }}>{rate}%</div>
      <div style={{ height: 3, borderRadius: 2, marginBottom: 3, background: C.bg5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>
        {label} · {(city.txn_count || 0).toLocaleString()} txns
      </div>
    </div>
  );
}

function CustomerCard({ c, av, border, status, patterns, rColor, txhr, onClick }) {
  const [hov, setHov] = useState(false);
  const initials = (c.customer_id || "??").slice(-2).toUpperCase();
  const metrics = [
    ["Risk score", c.avg_risk_score, rColor],
    ["Txns/hr",    txhr,             c.avg_risk_score > 60 ? C.w : C.t],
    ["Acct age",   `${c.account_age_days}d`, C.t],
    ["Devices",    c.unique_devices,  (c.unique_devices || 0) > 3 ? C.w : C.t],
  ];
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: C.bg3,
        border: `1px solid ${hov ? C.b2 : border}`,
        borderRadius: 12, padding: 11, cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, flexShrink: 0,
          background: av.bg, color: av.c,
        }}>{initials}</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 500 }}>{c.customer_id}</div>
          <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>{status}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {metrics.map(([l, v, vc]) => (
          <div key={l} style={{ background: C.bg4, borderRadius: 5, padding: "5px 7px" }}>
            <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>{l}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: vc }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>Pattern</span>
        <span>{patterns.map(([l, col], j) => <Pill key={j} label={l} color={col} />)}</span>
      </div>
    </div>
  );
}
