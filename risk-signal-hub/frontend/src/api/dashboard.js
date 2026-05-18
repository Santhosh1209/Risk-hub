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

export const fetchKPIs            = () => cached(DASHBOARD_KEYS.kpis,     () => get("/dashboard/kpis"));
export const fetchHourly          = () => cached(DASHBOARD_KEYS.hourly,   () => get("/dashboard/hourly"));
export const fetchDecline         = () => cached(DASHBOARD_KEYS.decline,  () => get("/dashboard/decline-breakdown"));
export const fetchRiskDist        = () => cached(DASHBOARD_KEYS.riskDist, () => get("/dashboard/risk-score-dist"));
export const fetchSevenDayTrend   = () => cached(DASHBOARD_KEYS.trend,    () => get("/dashboard/seven-day-trend"));
export const fetchChannelSplit    = () => cached(DASHBOARD_KEYS.channels,  () => get("/dashboard/channel-split"));
export const fetchAlerts          = () => cached(DASHBOARD_KEYS.alerts,   () => get("/dashboard/alerts"));
export const fetchFlaggedAccounts = () => cached(DASHBOARD_KEYS.flagged,  () => get("/dashboard/flagged-accounts"));
