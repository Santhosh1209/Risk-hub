import { get, post } from "./client.js";
import { getCached, setCached } from "./cache.js";

export const CASES_KEYS = {
  counts: "cases/counts",
  list:   (status) => `cases/list/${status || "all"}`,
};

function cached(key, fetcher) {
  const hit = getCached(key);
  if (hit !== null) return Promise.resolve(hit);
  return fetcher().then(v => setCached(key, v));
}

export const fetchCases      = (status) => cached(CASES_KEYS.list(status), () => get(`/cases${status && status !== "all" ? `?status=${encodeURIComponent(status)}` : ""}`));
export const fetchCaseCounts = ()       => cached(CASES_KEYS.counts, () => get("/cases/counts"));
export const updateStatus    = (id, status) => post(`/cases/${encodeURIComponent(id)}/status`, { status });
export const updateNotes     = (id, notes)  => post(`/cases/${encodeURIComponent(id)}/notes`,  { notes });
export const sendEmail       = (to, subject, body) => post("/cases/send-email", { to, subject, body });
