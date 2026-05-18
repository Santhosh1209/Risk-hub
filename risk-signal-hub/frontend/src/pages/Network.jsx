import { useState, useEffect, useRef } from "react";
import AgentBricksWindow from "../components/AgentBricksWindow.jsx";
import { askAgent } from "../api/agent.js";
import { getCached, setCached, invalidate } from "../api/cache.js";

const API = import.meta.env.VITE_API_BASE || "/api";
async function apiFetch(path) {
  const res = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const NET_KEYS = {
  merchants: "network/merchants",
  customers: "network/customers",
  devices:   "network/devices",
  cities:    "network/cities",
  links:     "network/links",
};

function cachedFetch(key, path) {
  const hit = getCached(key);
  if (hit !== null) return Promise.resolve(hit);
  return apiFetch(path).then(v => setCached(key, v));
}

// ── tokens ────────────────────────────────────────────────────────────────────
const C = {
  bg:  "#07090e", bg2: "#0c0f16", bg3: "#111620", bg4: "#171e2b",
  b:   "rgba(255,255,255,.055)", b2: "rgba(255,255,255,.1)",
  t:   "#d8e0eb", t2: "#7a8ba0", t3: "#384d63",
  a:   "#00dba8",
  merchant: "#f43f5e",   // red
  account:  "#f59e0b",   // amber
  device:   "#a78bfa",   // purple
  ip:       "#0ea5e9",   // blue
  agg:      "#4b5563",   // grey
};

// ── node colours by type ──────────────────────────────────────────────────────
const NODE_COLOR = {
  merchant: C.merchant,
  account:  C.account,
  device:   C.device,
  ip:       C.ip,
  agg:      C.agg,
};

const LEGEND = [
  { color: C.merchant, label: "Suspect merchant"   },
  { color: C.account,  label: "Flagged account"    },
  { color: C.device,   label: "Device fingerprint" },
  { color: C.ip,       label: "IP cluster"         },
  { color: C.agg,      label: "Aggregator"         },
];

const FILTERS = [
  { id: "all",      label: "All nodes"   },
  { id: "merchant", label: "Merchants"   },
  { id: "account",  label: "Accounts"    },
  { id: "device",   label: "Devices"     },
  { id: "ip",       label: "IP clusters" },
];

// ── canvas ────────────────────────────────────────────────────────────────────
function NetworkCanvas({ merchants, customers, devices, cities, links, filter, onNodeClick }) {
  const canvasRef = useRef(null);
  const nodesRef  = useRef([]);
  const animRef   = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.parentElement.clientWidth  || 900;
    const H   = canvas.parentElement.clientHeight || 500;

    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.width  = W + "px";
    canvas.style.height = H + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const cx = W / 2, cy = H / 2;
    const pad = 40; // keep nodes this many px from edges

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // ── build node sets ──────────────────────────────────────────────────────
    const allNodes = [];

    const show = (type) =>
      filter === "all" || filter === type;

    // Aggregator — centre
    if (show("agg") || filter === "all") {
      allNodes.push({
        id: "AGG_7741", type: "agg", label: "AGG_7741",
        x: cx, y: cy, radius: 20, color: C.agg,
        data: { info: "Payment aggregator hub" },
      });
    }

    // Merchants — evenly spaced full-circle outer ring
    if (show("merchant")) {
      const slice = merchants.slice(0, 6);
      const outerR = Math.min(W * 0.38, H * 0.38, 220);
      slice.forEach((m, i) => {
        const angle = (i / slice.length) * Math.PI * 2 - Math.PI / 2;
        allNodes.push({
          id: m.merchant_id, type: "merchant",
          label: m.merchant_id.replace("MER-", "").replace("AGG_", ""),
          x: clamp(cx + Math.cos(angle) * outerR, pad, W - pad),
          y: clamp(cy + Math.sin(angle) * outerR, pad, H - pad),
          radius: 11 + Math.min((m.fraud_txns || 0) * 0.3, 7),
          color: C.merchant, data: m,
        });
      });
    }

    // Accounts — inner ring, offset so they don't overlap merchants
    if (show("account")) {
      const slice = customers.slice(0, 5);
      const innerR = Math.min(W * 0.20, H * 0.20, 110);
      slice.forEach((c, i) => {
        const angle = (i / slice.length) * Math.PI * 2 + Math.PI / 5;
        allNodes.push({
          id: c.customer_id, type: "account",
          label: c.customer_id.replace("CUST-", "C-"),
          x: clamp(cx + Math.cos(angle) * innerR, pad, W - pad),
          y: clamp(cy + Math.sin(angle) * innerR, pad, H - pad),
          radius: 9 + Math.min((c.fraud_txns || 0) * 0.4, 6),
          color: C.account, data: c,
        });
      });
    }

    // Devices — mid ring, bottom half
    if (show("device")) {
      const slice = devices.slice(0, 4);
      const devR = Math.min(W * 0.28, H * 0.28, 155);
      slice.forEach((d, i) => {
        const angle = Math.PI * 0.15 + (i / Math.max(slice.length - 1, 1)) * Math.PI * 0.7;
        allNodes.push({
          id: d.device_fingerprint, type: "device",
          label: `Dev-${String(i + 1).padStart(2, "0")}`,
          x: clamp(cx + Math.cos(angle) * devR, pad, W - pad),
          y: clamp(cy + Math.sin(angle) * devR, pad, H - pad),
          radius: 8,
          color: C.device, data: d,
        });
      });
    }

    // IP clusters — corners of the canvas, clamped inside bounds
    if (show("ip")) {
      const slice = cities.slice(0, 3);
      const ipAngles = [Math.PI * 1.15, Math.PI * 1.5, Math.PI * 1.85];
      const ipR = Math.min(W * 0.40, H * 0.40, 230);
      slice.forEach((c, i) => {
        allNodes.push({
          id: `ip-${c.location_city}`, type: "ip",
          label: `IP ${c.location_city}`,
          x: clamp(cx + Math.cos(ipAngles[i]) * ipR, pad, W - pad),
          y: clamp(cy + Math.sin(ipAngles[i]) * ipR, pad, H - pad),
          radius: 10,
          color: C.ip, data: c,
        });
      });
    }

    nodesRef.current = allNodes;

    // ── build edges ──────────────────────────────────────────────────────────
    const edges = [];

    const agg = allNodes.find(n => n.type === "agg");
    const mNodes = allNodes.filter(n => n.type === "merchant");
    const cNodes = allNodes.filter(n => n.type === "account");
    const dNodes = allNodes.filter(n => n.type === "device");
    const iNodes = allNodes.filter(n => n.type === "ip");

    // aggregator ↔ merchants
    if (agg) {
      mNodes.forEach(m => edges.push({ src: agg, tgt: m, color: "rgba(75,85,99,.4)", w: 1 }));
    }

    // merchants ↔ accounts (from links)
    links.slice(0, 20).forEach(l => {
      const s = allNodes.find(n => n.id === l.merchant_id);
      const t = allNodes.find(n => n.id === l.customer_id);
      if (s && t) edges.push({ src: s, tgt: t, color: l.fraud_count > 1 ? "rgba(244,63,94,.35)" : "rgba(245,158,11,.25)", w: 0.8 });
    });

    // accounts ↔ devices (synthetic from shared-device data)
    cNodes.forEach((c, i) => {
      const d = dNodes[i % dNodes.length];
      if (d) edges.push({ src: c, tgt: d, color: "rgba(167,139,250,.3)", w: 0.7 });
    });

    // devices / merchants ↔ IP clusters
    iNodes.forEach((ip, i) => {
      const target = mNodes[i % mNodes.length] || cNodes[i % cNodes.length];
      if (target) edges.push({ src: ip, tgt: target, color: "rgba(14,165,233,.25)", w: 0.7 });
    });

    // ── animation loop ───────────────────────────────────────────────────────
    let frame = 0;

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // subtle radial gradient background
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.55);
      grad.addColorStop(0, "rgba(0,219,168,.025)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // grid lines
      ctx.strokeStyle = "rgba(255,255,255,.018)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 44) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for (let y = 0; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

      // edges
      edges.forEach(({ src, tgt, color, w }) => {
        const mx = (src.x + tgt.x) / 2 + (tgt.y - src.y) * 0.08;
        const my = (src.y + tgt.y) / 2 - (tgt.x - src.x) * 0.08;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.stroke();
      });

      // nodes
      allNodes.forEach(node => {
        const col = node.color;

        // outer glow ring (animated pulse for high-risk types)
        if (node.type === "merchant" || node.type === "account") {
          const pulse = Math.sin(frame * 0.04 + node.x * 0.01) * 3;
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 6 + pulse, 0, Math.PI * 2);
          ctx.strokeStyle = col + "28";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // outer border ring — gives a clean halo
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = col + "40";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // solid filled circle — no gradient = sharp edges
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = col + "30";   // subtle fill
        ctx.fill();

        // crisp solid stroke border
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();

        // inner highlight dot for depth
        ctx.beginPath();
        ctx.arc(node.x - node.radius * 0.28, node.y - node.radius * 0.28, node.radius * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = col + "55";
        ctx.fill();

        // crisp label below node
        const shortLabel = node.label.length > 11 ? node.label.slice(0, 11) + "…" : node.label;
        ctx.font = `bold 9.5px 'IBM Plex Mono', monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        // text shadow for legibility
        ctx.fillStyle = "rgba(7,9,14,.8)";
        ctx.fillText(shortLabel, node.x + 0.5, node.y + node.radius + 5.5);
        ctx.fillStyle = C.t;
        ctx.fillText(shortLabel, node.x, node.y + node.radius + 5);
      });

      frame++;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [merchants, customers, devices, cities, links, filter]);

  // ── hover + click helpers ─────────────────────────────────────────────────
  function getHit(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    // Use CSS pixel coords directly (nodes are placed in CSS pixel space)
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    return nodesRef.current.find(n => {
      const dx = n.x - mx, dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) < n.radius + 10;
    });
  }

  function handleMouseMove(e) {
    const hit = getHit(e);
    if (hit) {
      const rect = canvasRef.current.getBoundingClientRect();
      setTooltip({ node: hit, x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      setTooltip(null);
    }
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        onClick={e => { const h = getHit(e); if (h) onNodeClick(h); }}
        style={{ display: "block", cursor: "crosshair", background: C.bg }}
      />

      {/* hover tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute", left: tooltip.x + 14, top: tooltip.y - 10, zIndex: 10,
          background: C.bg4, border: `1px solid ${C.b2}`, borderRadius: 8,
          padding: "8px 11px", fontSize: 11, color: C.t, pointerEvents: "none", minWidth: 160,
        }}>
          <div style={{ fontWeight: 700, color: tooltip.node.color, marginBottom: 4, fontSize: 10 }}>
            {tooltip.node.label}
          </div>
          <div style={{ color: C.t2, fontSize: 10, marginBottom: 3 }}>
            {tooltip.node.type.charAt(0).toUpperCase() + tooltip.node.type.slice(1)} node
          </div>
          {tooltip.node.type === "merchant" && tooltip.node.data && (
            <>
              <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>fraud_rate: {tooltip.node.data.fraud_rate_pct}%</div>
              <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>risk_score: {tooltip.node.data.avg_risk_score}</div>
            </>
          )}
          {tooltip.node.type === "account" && tooltip.node.data && (
            <>
              <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>pattern: {tooltip.node.data.fraud_pattern}</div>
              <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>risk_score: {tooltip.node.data.avg_risk_score}</div>
            </>
          )}
          {tooltip.node.type === "device" && tooltip.node.data && (
            <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>customers: {tooltip.node.data.customer_count}</div>
          )}
          {tooltip.node.type === "ip" && tooltip.node.data && (
            <div style={{ fontSize: 9, color: C.t3, fontFamily: "monospace" }}>fraud_rate: {tooltip.node.data.fraud_rate_pct}%</div>
          )}
          <div style={{ marginTop: 6, fontSize: 9, color: C.a, fontFamily: "monospace" }}>click to analyse →</div>
        </div>
      )}
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function Network() {
  const [merchants,  setMerchants]  = useState([]);
  const [customers,  setCustomers]  = useState([]);
  const [devices,    setDevices]    = useState([]);
  const [cities,     setCities]     = useState([]);
  const [links,      setLinks]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [filter,     setFilter]     = useState("all");
  const [modal,      setModal]      = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  function handleRefresh() {
    invalidate(...Object.values(NET_KEYS));
    setRefreshTick(t => t + 1);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      cachedFetch(NET_KEYS.merchants, "/network/merchants?limit=10"),
      cachedFetch(NET_KEYS.customers, "/network/risky-customers?limit=8"),
      cachedFetch(NET_KEYS.devices,   "/network/shared-devices?limit=6"),
      cachedFetch(NET_KEYS.cities,    "/network/city-network"),
      cachedFetch(NET_KEYS.links,     "/network/merchant-customer-links?limit=30"),
    ]).then(([m, c, d, ct, l]) => {
      setMerchants(Array.isArray(m)  ? m  : []);
      setCustomers(Array.isArray(c)  ? c  : []);
      setDevices(Array.isArray(d)    ? d  : []);
      setCities(Array.isArray(ct)    ? ct : []);
      setLinks(Array.isArray(l)      ? l  : []);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [refreshTick]);

  function openAI(prompt) {
    setModal({ prompt, result: null, loading: true });
    askAgent(prompt)
      .then(r  => setModal(m => m && { ...m, result: r.answer || JSON.stringify(r), loading: false }))
      .catch(e => setModal(m => m && { ...m, result: `Error: ${e.message}`, loading: false }));
  }

  function handleNodeClick(node) {
    if (node.type === "merchant" && node.data) {
      openAI(`Deep network analysis for merchant ${node.id} (${node.data.merchant_category || ""}, ${node.data.primary_city || ""}). Fraud rate ${node.data.fraud_rate_pct}%, risk score ${node.data.avg_risk_score}. Which customers are connected to this merchant and are any linked to other high-risk merchants? Is there a coordinated fraud ring?`);
    } else if (node.type === "account" && node.data) {
      openAI(`Network investigation for customer ${node.id}: fraud_pattern=${node.data.fraud_pattern}, risk_score=${node.data.avg_risk_score}, unique_devices=${node.data.unique_devices}, unique_cities=${node.data.unique_cities}. Which merchants has this customer transacted with? What fraud ring does this suggest?`);
    } else if (node.type === "device" && node.data) {
      openAI(`Investigate device fingerprint ${node.id}. Shared by ${node.data.customer_count} customers across ${node.data.merchant_count} merchants with ${node.data.fraud_txns} fraud transactions. Is this an ATO ring, synthetic identity fraud, or device spoofing? What immediate action should be taken?`);
    } else if (node.type === "ip" && node.data) {
      openAI(`Analyze IP/city cluster for ${node.data.location_city}. Fraud rate ${node.data.fraud_rate_pct}%, ${node.data.fraud_txns} fraud transactions. Which merchants and customers are driving fraud here? Is there cross-city device sharing suggesting organized fraud?`);
    } else if (node.type === "agg") {
      openAI(`Analyze the central payment aggregator AGG_7741. Which merchants connected through this aggregator have the highest fraud rates? Is the aggregator itself compromised or being used as a fraud conduit? What is the total fraud exposure flowing through this aggregator?`);
    }
  }

  if (loading) return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: C.t3 }}>
      <style>{`@keyframes nw-spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.b2}`, borderTopColor: C.a, animation: "nw-spin .7s linear infinite" }} />
      <span style={{ fontSize: 12, fontFamily: "monospace" }}>Loading fraud network…</span>
    </div>
  );

  if (error) return (
    <div style={{ padding: 20 }}>
      <div style={{ background: "rgba(244,63,94,.07)", border: "1px solid rgba(244,63,94,.18)", borderRadius: 10, padding: 16, fontSize: 12, color: "#fb7185", fontFamily: "monospace" }}>
        Error: {error}
      </div>
    </div>
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg }}>
      <style>{`@keyframes nw-spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── header ──────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: "11px 16px",
        borderBottom: `1px solid ${C.b}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: C.bg2,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.t }}>Fraud Network Graph</div>
          <div style={{ fontSize: 10, color: C.t2, marginTop: 2 }}>
            Visualize connections between suspect merchants, accounts, devices, and IPs. Click nodes to investigate.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <HeaderBtn label="⟳ Refresh" onClick={handleRefresh} />
          <HeaderBtn label="AI analyze network" onClick={() => openAI(`Analyze the fraud network connections shown: merchants sharing aggregator AGG_7741, accounts sharing device fingerprints, and linked IP clusters. What does this network topology suggest about the fraud organization structure and key intervention points?`)} />
          <HeaderBtn label="Find key nodes" primary onClick={() => openAI(`Based on the fraud network topology in risk_hub.fraud, identify the single most critical node that if blocked would disrupt the maximum fraudulent activity. Which node has the highest betweenness centrality — most connections routing through it?`)} />
        </div>
      </div>

      {/* ── filter pills ────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, padding: "10px 16px", display: "flex", gap: 6, borderBottom: `1px solid ${C.b}`, background: C.bg }}>
        {FILTERS.map(f => (
          <FilterBtn key={f.id} label={f.label} active={filter === f.id} onClick={() => setFilter(f.id)} />
        ))}
      </div>

      {/* ── canvas ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <NetworkCanvas
          merchants={merchants}
          customers={customers}
          devices={devices}
          cities={cities}
          links={links}
          filter={filter}
          onNodeClick={handleNodeClick}
        />
      </div>

      {/* ── legend ──────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: "8px 16px",
        borderTop: `1px solid ${C.b}`,
        display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center",
        background: C.bg2,
      }}>
        {LEGEND.map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: C.t3, fontFamily: "monospace" }}>{label}</span>
          </div>
        ))}
      </div>

      <AgentBricksWindow modal={modal} onClose={() => setModal(null)} />
    </div>
  );
}

// ── tiny button components ────────────────────────────────────────────────────
function FilterBtn({ label, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 11, padding: "4px 12px", borderRadius: 6, cursor: "pointer",
        fontFamily: "inherit", fontWeight: active ? 600 : 400,
        border: active || hov ? `1px solid rgba(255,255,255,.16)` : `1px solid rgba(255,255,255,.07)`,
        background: active ? "rgba(255,255,255,.08)" : hov ? "rgba(255,255,255,.04)" : "transparent",
        color: active ? "#d8e0eb" : "#7a8ba0",
      }}
    >{label}</button>
  );
}

function HeaderBtn({ label, primary, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 11, padding: "5px 13px", borderRadius: 6, cursor: "pointer",
        fontFamily: "inherit", fontWeight: primary ? 700 : 400,
        border: primary ? "none" : `1px solid rgba(255,255,255,.1)`,
        background: primary ? "#00dba8" : hov ? "rgba(255,255,255,.05)" : "transparent",
        color: primary ? "#000" : "#d8e0eb",
        opacity: hov && !primary ? 0.85 : 1,
      }}
    >{label}</button>
  );
}
