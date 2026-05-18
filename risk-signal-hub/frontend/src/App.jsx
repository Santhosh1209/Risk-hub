import { useState, useEffect } from "react";
import TopBar            from "./components/TopBar.jsx";
import Sidebar           from "./components/Sidebar.jsx";
import AgentBricksWindow from "./components/AgentBricksWindow.jsx";
import Dashboard  from "./pages/Dashboard.jsx";
import Forecast   from "./pages/Forecast.jsx";
import RuleEngine from "./pages/RuleEngine.jsx";
import Cases      from "./pages/Cases.jsx";
import Network    from "./pages/Network.jsx";
import Settings   from "./pages/Settings.jsx";
import { fetchKPIs, fetchHourly, fetchDecline, fetchRiskDist,
         fetchSevenDayTrend, fetchChannelSplit, fetchAlerts,
         fetchFlaggedAccounts } from "./api/dashboard.js";
import { fetchHistory, fetchMerchants, fetchCityRisk,
         fetchSuspectCustomers } from "./api/forecast.js";
import { fetchCases, fetchCaseCounts } from "./api/cases.js";
import { askAgent } from "./api/agent.js";
import Reports from "./pages/Reports.jsx";

function Placeholder({ label }) {
  return (
    <div style={{
      height: "100%", display: "flex", alignItems: "center",
      justifyContent: "center", flexDirection: "column", gap: 8,
    }}>
      <div style={{ fontSize: 32 }}>🚧</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#7a8ba0" }}>
        {label} — Coming next
      </div>
    </div>
  );
}

export default function App() {
  const [active,         setActive]         = useState("dashboard");
  const [alertCount,     setAlertCount]     = useState(0);
  const [modal,          setModal]          = useState(null);
  const [dashboardChat,  setDashboardChat]  = useState([]);

  useEffect(() => {
    Promise.allSettled([
      fetchKPIs(), fetchSevenDayTrend(), fetchChannelSplit(), fetchAlerts(),
      fetchHourly(), fetchDecline(), fetchRiskDist(), fetchFlaggedAccounts(),
      fetchHistory(), fetchMerchants(), fetchCityRisk(), fetchSuspectCustomers(),
      fetchCases(), fetchCaseCounts(),
    ]);
  }, []);

  function handleSidebarAction(q) {
    setModal({ prompt: q, loading: true, result: "" });
    askAgent(q)
      .then(r  => setModal(m => m && { ...m, loading: false, result: r.answer || JSON.stringify(r) }))
      .catch(e => setModal(m => m && { ...m, loading: false, result: `Error: ${e.message}` }));
  }

  function renderPage() {
    switch (active) {
      case "dashboard": return <Dashboard setAlertCount={setAlertCount} chat={dashboardChat} setChat={setDashboardChat} />;
      case "forecast":  return <Forecast />;
      case "rules":     return <RuleEngine />;
      case "cases":     return <Cases />;
      case "network":   return <Network />;
      case "reports":   return <Reports />;
      case "settings":  return <Settings />;
      default:          return <Placeholder label={active} />;
    }
  }

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "#07090e", color: "#d8e0eb",
      fontFamily: "'Inter', sans-serif", fontSize: 13,
    }}>
      <TopBar active={active} setActive={setActive} alertCount={alertCount} />
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {active !== "settings" && (
          <Sidebar onAction={handleSidebarAction} onAlertCount={setAlertCount} />
        )}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {renderPage()}
        </div>
      </div>
      <AgentBricksWindow modal={modal} onClose={() => setModal(null)} />
    </div>
  );
}
