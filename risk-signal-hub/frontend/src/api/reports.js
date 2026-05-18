import { get, post, del } from "./client.js";
import { getCached, setCached } from "./cache.js";

const CTX_KEY = "reports/context";

/** Fetch live KPIs, channels, cases, merchants, rules for report cards. Cached 2 min. */
export async function fetchReportContext() {
  const cached = getCached(CTX_KEY);
  if (cached !== null) return cached;
  const data = await get("/reports/context", 30_000);
  setCached(CTX_KEY, data);
  return data;
}

/** Generate a full AI-written report with live data from Databricks + Genie + LLM. */
export async function generateReport(reportType, useGenie = true, customName = "", customDescription = "") {
  return post("/reports/generate", {
    report_type:        reportType,
    use_genie:          useGenie,
    custom_name:        customName,
    custom_description: customDescription,
  }, 120_000);
}

/** Fetch all user-saved report templates from Databricks. */
export async function fetchTemplates() {
  return get("/reports/templates", 15_000);
}

/** Persist a new custom report template to Databricks. */
export async function saveTemplate(name, description) {
  return post("/reports/templates", { name, description }, 15_000);
}

/** Delete a report template by id. */
export async function deleteTemplate(id) {
  return del(`/reports/templates/${id}`, 15_000);
}
