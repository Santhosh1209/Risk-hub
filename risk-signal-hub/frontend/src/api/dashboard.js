import { get } from "./client.js";
import { getCached, setCached } from "./cache.js";

export const DASHBOARD_KEYS = {
  kpis:    "dashboard/kpis",
  hourly:  "dashboard/hourly",
  decline: "dashboard/decline",
  riskDist:"dashboard/risk-dist",
  trend:   "dashboard/trend",
  channels:"dashboard/channels",
  alerts:  "dashboard/alerts",
  flagged: "dashboard/flagged",
};

function cached(key, fetcher) {
  const hit = getCached(key);
  if (hit !== null) return Promise.resolve(hit);
  return fetcher().then(v => setCached(key, v));
}

const T = 120_000; // 2 min — allow for cold warehouse start

export const fetchKPIs            = () => cached(DASHBOARD_KEYS.kpis,     () => get("/dashboard/kpis", T));
export const fetchHourly          = () => cached(DASHBOARD_KEYS.hourly,   () => get("/dashboard/hourly", T));
export const fetchDecline         = () => cached(DASHBOARD_KEYS.decline,  () => get("/dashboard/decline-breakdown", T));
export const fetchRiskDist        = () => cached(DASHBOARD_KEYS.riskDist, () => get("/dashboard/risk-score-dist", T));
export const fetchSevenDayTrend   = () => cached(DASHBOARD_KEYS.trend,    () => get("/dashboard/seven-day-trend", T));
export const fetchChannelSplit    = () => cached(DASHBOARD_KEYS.channels,  () => get("/dashboard/channel-split", T));
export const fetchAlerts          = () => cached(DASHBOARD_KEYS.alerts,   () => get("/dashboard/alerts", T));
export const fetchFlaggedAccounts = () => cached(DASHBOARD_KEYS.flagged,  () => get("/dashboard/flagged-accounts", T));
