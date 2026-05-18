import { get } from "./client.js";
import { getCached, setCached } from "./cache.js";

export const DASHBOARD_KEYS = {
  all:     "dashboard/all",
  kpis:    "dashboard/kpis",
  hourly:  "dashboard/hourly",
  decline: "dashboard/decline",
  riskDist:"dashboard/risk-dist",
  trend:   "dashboard/trend",
  channels:"dashboard/channels",
  alerts:  "dashboard/alerts",
  flagged: "dashboard/flagged",
};

let _allPromise = null;

async function _fetchWithRetry(maxAttempts = 4, delayMs = 8000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await get("/dashboard/all", 90_000);
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

function fetchAll() {
  const hit = getCached(DASHBOARD_KEYS.all);
  if (hit !== null) return Promise.resolve(hit);
  if (_allPromise) return _allPromise;
  _allPromise = _fetchWithRetry()
    .then(v => { setCached(DASHBOARD_KEYS.all, v); _allPromise = null; return v; })
    .catch(e => { _allPromise = null; throw e; });
  return _allPromise;
}

export const fetchKPIs            = () => fetchAll().then(d => d.kpis);
export const fetchHourly          = () => fetchAll().then(d => d.hourly);
export const fetchDecline         = () => fetchAll().then(d => d.decline);
export const fetchRiskDist        = () => fetchAll().then(d => d.riskDist);
export const fetchSevenDayTrend   = () => fetchAll().then(d => d.trend);
export const fetchChannelSplit    = () => fetchAll().then(d => d.channels);
export const fetchAlerts          = () => fetchAll().then(d => d.alerts);
export const fetchFlaggedAccounts = () => fetchAll().then(d => d.accounts);
