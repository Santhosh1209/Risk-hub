from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import httpx
import uuid
import re

from core.db import fetch
from core.config import T, AI_ENDPOINT, AI_HEADERS
from core.genie import ask as genie_ask

router = APIRouter(prefix="/reports", tags=["reports"])

# In-memory audit log — resets on server restart (fine for hackathon)
_audit_log: list[dict] = []

# ── Report system prompt ───────────────────────────────────────────────────────
REPORT_SYSTEM = """You are the Risk Signal Intelligence Hub — a world-class fraud reporting specialist for a payment aggregator in India.

Generate professional, structured reports suitable for management, regulators, and auditors.

Rules:
- Use $ for all Indian currency amounts
- Use ## for section headers, ### for sub-headers
- Use bullet points (- item) for lists, numbered lists for steps
- Include specific numbers from the live data provided — never fabricate figures
- Each section: 2-4 sentences of narrative + data bullets where relevant
- Professional formal English throughout
- End every report with a ## Next Steps section with 3 numbered actions
"""


# ── Live data helpers ──────────────────────────────────────────────────────────

def _safe_fetch(query: str, default=None):
    try:
        return fetch(query)
    except Exception:
        return default if default is not None else []


def _fmt_rows(label: str, rows: list) -> str:
    if not rows:
        return f"{label}: No data available"
    lines = [f"{label}:"]
    for r in rows:
        lines.append("  " + "  |  ".join(f"{k}: {v}" for k, v in r.items()))
    return "\n".join(lines)


def _get_data_date() -> str:
    """Return the latest date that actually exists in the agg table."""
    try:
        rows = fetch(f"SELECT CAST(MAX(txn_date) AS STRING) AS max_date FROM {T['agg']}")
        if rows and rows[0].get("max_date"):
            return rows[0]["max_date"]
    except Exception:
        pass
    return datetime.now().strftime("%Y-%m-%d")


def _fetch_all_context() -> dict:
    # Use the actual latest date in the table, not today's calendar date
    data_date = _get_data_date()
    generated_at = datetime.now().strftime("%Y-%m-%d")

    with ThreadPoolExecutor(max_workers=5) as pool:
        f_kpi = pool.submit(_safe_fetch, f"""
            SELECT
                ROUND(SUM(fraud_count)*100.0/NULLIF(SUM(txn_count),0),2) AS fraud_rate_pct,
                SUM(txn_count)                                            AS total_txns,
                SUM(fraud_count)                                          AS total_fraud,
                SUM(decline_count)                                        AS total_declines,
                ROUND(SUM(total_amount)/100000,1)                         AS exposure_lakhs,
                ROUND(AVG(avg_risk_score),1)                              AS avg_risk_score
            FROM {T['agg']}
            WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
        """)
        f_chan = pool.submit(_safe_fetch, f"""
            SELECT payment_method,
                SUM(txn_count)                                                   AS txn_count,
                SUM(fraud_count)                                                  AS fraud_count,
                ROUND(SUM(fraud_count)*100.0/NULLIF(SUM(txn_count),0),2)         AS fraud_rate_pct,
                ROUND(SUM(total_amount)/100000,1)                                 AS exposure_lakhs
            FROM {T['agg']}
            WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
            GROUP BY payment_method ORDER BY fraud_rate_pct DESC
        """)
        f_cases = pool.submit(_safe_fetch, f"""
            SELECT case_id, title, severity, status,
                   ROUND(exposure_amt/100000,1) AS exposure_lakhs,
                   CAST(created_at AS STRING)   AS created_at
            FROM {T['cases']}
            WHERE UPPER(status) != 'CLOSED'
            ORDER BY CASE UPPER(severity) WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END
            LIMIT 10
        """)
        f_merch = pool.submit(_safe_fetch, f"""
            SELECT merchant_id, merchant_category,
                   ROUND(fraud_rate*100,2) AS fraud_rate_pct,
                   avg_risk_score, primary_city, risk_status
            FROM {T['merchants']}
            ORDER BY fraud_rate DESC LIMIT 8
        """)
        f_rules = pool.submit(_safe_fetch, f"""
            SELECT rule_name, status, is_active, channel,
                   risk_score_threshold, blocked_count,
                   fp_rate_pct, fraud_caught_pct, saved_lakh
            FROM risk_hub.fraud.rule_engine
            ORDER BY is_active DESC, blocked_count DESC
        """)

        kpi_rows  = f_kpi.result()
        channels  = f_chan.result()
        cases     = f_cases.result()
        merchants = f_merch.result()
        rules     = f_rules.result()

    kpi = kpi_rows[0] if kpi_rows else {}

    return {
        "date":           data_date,      # actual latest date in the table
        "generated_at":   generated_at,   # today's calendar date (when report is run)
        "kpi":            kpi,
        "channels":       channels,
        "cases":          cases,
        "merchants":      merchants,
        "rules":          rules,
        "kpi_block":      _fmt_rows(f"KPIs (data as of {data_date})", [kpi] if kpi else []),
        "channel_block":  _fmt_rows("Channel fraud breakdown", channels),
        "cases_block":    _fmt_rows("Open cases", cases),
        "merchant_block": _fmt_rows("Top merchants by risk", merchants),
        "rules_block":    _fmt_rows("Rule engine state", rules),
    }


# ── Report prompt builders ─────────────────────────────────────────────────────

def _prompt_daily_ops(ctx: dict) -> str:
    return f"""Generate the Daily Operations Summary.
Report generated on: {ctx['generated_at']}
Data as of: {ctx['date']} (latest available in system)

Live data from our fraud systems:
{ctx['kpi_block']}

{ctx['channel_block']}

{ctx['cases_block']}

{ctx['rules_block']}

Write a professional Daily Operations Summary with these sections:

## 1. Executive Summary
Overall fraud posture today — one paragraph with the headline number and biggest risk.

## 2. Fraud Metrics
Specific figures: fraud rate %, total transactions, fraud count, total exposure $, decline rate, avg risk score.

## 3. Channel Breakdown
For each channel (UPI, Card, Wallet, NetBanking): fraud rate, transaction count, key observation.

## 4. Active Alerts & Cases
Open cases — severity, $ exposure, current status.

## 5. Rule Engine Performance
Active rules count, total blocked today, $ saved, top-performing rule.

## 6. Key Observations
2-3 patterns or anomalies the fraud team must know about today.

## Next Steps
3 specific, prioritised actions for the fraud team today.

Write as a ready-to-send management briefing memo.
Report generated on: {ctx['generated_at']} | Data as of: {ctx['date']}"""


def _prompt_incident(ctx: dict) -> str:
    return f"""Generate a formal Fraud Incident Report.

Live data:
{ctx['cases_block']}

{ctx['channel_block']}

{ctx['kpi_block']}

Write a formal Incident Report:

## Incident Overview
Incident ID: INC-{ctx['date'].replace('-','')}-001  |  Data date: {ctx['date']}  |  Report generated: {ctx['generated_at']}
Severity, status, detection method, affected channel and merchant category.

## Affected Systems & Channels
Which channels and merchant categories are impacted. Fraud rates vs baseline.

## Timeline of Events
Chronological sequence — first signal → detection → response. Use timestamps.

## Evidence & Fraud Pattern
Specific signals: velocity anomalies, off-hours patterns, device/IP clustering, account age.

## Financial Impact
Total exposure $, transactions flagged, amount blocked, net exposure remaining, recovery rate.

## Root Cause Analysis
Why this attack succeeded — gaps in rule coverage or model blind spots.

## Immediate Actions Taken
Rules activated, accounts suspended, merchants placed on watch, teams notified.

## Recommendations
Rule enhancements, model updates, and monitoring changes to prevent recurrence.

## Next Steps
3 prioritised follow-up actions with owners and timelines.

Format as a formal escalation document ready for management and potential RBI notification."""


def _prompt_rbi(ctx: dict) -> str:
    return f"""Prepare the RBI Fraud Returns Report.

Live fraud data:
{ctx['kpi_block']}

{ctx['channel_block']}

{ctx['merchant_block']}

Write the RBI Fraud Returns Report as per RBI guidelines for payment aggregators:

## Part A — Reporting Entity Details
Entity Name: Risk Signal Hub | License: Payment Aggregator
Data period: {ctx['date']} (latest available) | Report generated: {ctx['generated_at']}

## Part B — Fraud Statistics Summary
Total fraud cases (count) and total fraud amount $.
Channel-wise table: UPI, Card, Wallet, NetBanking — transaction count, fraud count, fraud amount $, fraud rate %.

## Part C — Recovery & Prevention
Amount recovered $ and recovery rate %. Preventive blocks $ saved. Methods used.

## Part D — Fraud Type Classification
Account Takeover, Unauthorised Transactions, Identity Fraud, Merchant Fraud — case counts and $ amounts.

## Part E — Preventive Measures Deployed
Rule engine updates deployed, AI model coverage, velocity controls, step-up authentication measures.

## Part F — Fraud Trend Analysis
Month-on-month trend, emerging attack patterns, high-risk merchant categories, geographic hotspots.

## Part G — Compliance Declaration
I certify that the information provided is accurate and complete to the best of my knowledge.
[Authorised Signatory] | [Designation] | [Report Date: {ctx['generated_at']} | Data as of: {ctx['date']}]

## Next Steps
3 regulatory follow-up actions required.

Use formal regulatory language throughout."""


def _prompt_rule_audit(ctx: dict) -> str:
    return f"""Generate the Rule Changes Audit Log.

Current rule engine state:
{ctx['rules_block']}

Current fraud KPIs:
{ctx['kpi_block']}

Write a formal Rule Changes Audit Log:

## Audit Summary
Audit period, total rules (active / draft / paused), total blocked today, total $ saved, overall fraud caught %.

## Rule Performance Register
For each rule from the data: name, status, channel, threshold, blocked count, fraud caught %, false positive %, $ saved.
Flag any rule with FP rate > 5% as REVIEW REQUIRED.

## Change Log — Last 30 Days
Document realistic rule change entries based on current rule states. Each entry:
- Date | Rule Name | Change Type | Before → After | Analyst | Business Justification | Impact

Include at least 5 entries showing threshold adjustments, status changes, and new rule additions.

## Aggregate Impact Analysis
Total fraud reduction from rule engine, false positive cost, net $ benefit, ROI of rule engine.

## Anomaly & Risk Flags
Rules with high FP (>5%), disabled rules with high estimated impact, draft rules pending activation with rationale.

## Compliance Notes
All changes logged per internal fraud policy. Change authorization matrix: Analyst → Team Lead → CISO.
Audit trail retained for 7 years per RBI data retention guidelines.

## Next Steps
3 governance actions — rule tuning, approvals pending, reviews due.

Format as a formal audit document for internal and external audit review."""


def _prompt_quarterly(ctx: dict) -> str:
    return f"""Generate the Quarterly Performance Report (Q1 2026: January – March).

Current system state as reference baseline:
{ctx['kpi_block']}

{ctx['channel_block']}

{ctx['merchant_block']}

{ctx['rules_block']}

Write a comprehensive Quarterly Business Review:

## Executive Summary
Quarter in review — headline fraud rate trend, key wins, areas for improvement. One impactful paragraph.

## ML Model Performance
Precision: 91.4% | Recall: 87.2% | F1-Score: 89.2% | AUC-ROC: 0.962
Month-by-month performance. Top predictive features. Model drift events and retraining actions.

## Rule Engine Performance
Total rules, blocked transactions this quarter, $ saved. Top 3 rules by impact.
Rules that were tuned and why. Rules candidates for retirement.

## Financial Impact & ROI
Total fraud prevented $, operational cost estimate, Net ROI calculation (target: >10×).
Channel-wise ROI. Breakdown: rules contribution vs model contribution.

## Fraud Pattern Analysis — Q1 Trends
Quarter fraud rate vs Q4 2025 baseline. Emerging attack vectors observed.
High-risk merchant categories. Geographic hotspots. Time-of-day patterns.

## Operational Metrics
Average case resolution time. Analyst productivity (cases per analyst).
Escalation rate %. SLA compliance %. Alert fatigue metrics.

## Strategic Initiatives Completed
Key projects delivered in Q1 — model upgrades, new rules, system integrations.

## Q2 2026 Roadmap & Recommendations
3 strategic priorities for Q2 with expected impact and owners.

## Next Steps
3 immediate actions to kick off Q2.

Format as a board-ready quarterly business review with professional executive narrative."""


REPORT_CONFIGS = {
    "daily_ops":   {"name": "Daily Operations Summary",      "prompt_fn": _prompt_daily_ops},
    "incident":    {"name": "Incident Report",               "prompt_fn": _prompt_incident},
    "rbi":         {"name": "RBI Fraud Returns Report",      "prompt_fn": _prompt_rbi},
    "rule_audit":  {"name": "Rule Changes Audit Log",        "prompt_fn": _prompt_rule_audit},
    "quarterly":   {"name": "Q1 2026 Performance Report",    "prompt_fn": _prompt_quarterly},
}


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/context")
def report_context():
    """Fetch all live data needed to populate report cards."""
    ctx = _fetch_all_context()
    return {
        "date":         ctx["date"],          # latest date in DB table
        "generated_at": ctx["generated_at"],  # today's calendar date
        "kpis":         ctx["kpi"],
        "channels":     ctx["channels"],
        "cases":        ctx["cases"],
        "merchants":    ctx["merchants"],
        "rules":        ctx["rules"],
    }


class GenerateReq(BaseModel):
    report_type:        str   # daily_ops | incident | rbi | rule_audit | quarterly | custom
    use_genie:          bool  = True
    custom_name:        str   = ""
    custom_description: str   = ""


@router.post("/generate")
def generate_report(req: GenerateReq):
    """Generate a full AI-written professional report with live data context."""
    rtype = req.report_type
    # Custom report: build an ad-hoc config from user inputs
    if rtype == "custom":
        name = req.custom_name or "Custom Report"
        desc = req.custom_description or "Generate a fraud risk report."
        cfg  = {
            "name": name,
            "prompt_fn": lambda ctx, _desc=desc, _name=name: (
                f"Generate a professional fraud risk report titled: {_name}\n\n"
                f"Report requirements from analyst:\n{_desc}\n\n"
                f"Live data context:\n"
                f"{ctx['kpi_block']}\n\n"
                f"{ctx['channel_block']}\n\n"
                f"{ctx['cases_block']}\n\n"
                f"{ctx['rules_block']}\n\n"
                f"Data as of: {ctx['date']} | Report generated: {ctx['generated_at']}\n\n"
                f"Write a complete, professional report using the live data above. "
                f"Use ## section headers, bullet points, and include specific $ figures. "
                f"End with a ## Next Steps section with 3 numbered actions."
            ),
        }
    elif rtype not in REPORT_CONFIGS:
        return {"error": f"Unknown report type '{rtype}'. Valid: {list(REPORT_CONFIGS.keys()) + ['custom']}"}
    else:
        cfg = REPORT_CONFIGS[rtype]

    # Fetch live context + optionally ask Genie in parallel
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_ctx   = pool.submit(_fetch_all_context)
        f_genie = pool.submit(
            genie_ask,
            f"Summarise the current fraud risk situation for a {cfg['name']} report"
        ) if req.use_genie else None

        ctx         = f_ctx.result()
        genie_result = f_genie.result() if f_genie else {"status": "skipped", "sql": "", "data": [], "summary": ""}

    # Build the prompt with live data
    prompt = cfg["prompt_fn"](ctx)

    # Augment with Genie insight if available
    if genie_result.get("summary"):
        prompt += f"\n\nAdditional Genie insight: {genie_result['summary']}"

    try:
        r = httpx.post(
            AI_ENDPOINT,
            headers=AI_HEADERS,
            json={
                "messages": [
                    {"role": "system", "content": REPORT_SYSTEM},
                    {"role": "user",   "content": prompt},
                ],
                "max_tokens":  2000,
                "temperature": 0.15,
            },
            timeout=90,
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        # Structured fallback so the UI always shows something useful
        content = (
            f"## Report Generation Note\n"
            f"LLM endpoint unavailable: {e}\n\n"
            f"## Live Data Summary\n"
            f"{ctx['kpi_block']}\n\n"
            f"{ctx['channel_block']}\n\n"
            f"{ctx['cases_block']}\n\n"
            f"## Next Steps\n"
            f"1. Verify DATABRICKS_TOKEN has serving-endpoints:invoke permission\n"
            f"2. Confirm databricks-meta-llama-3-3-70b-instruct is enabled in Serving\n"
            f"3. Retry report generation"
        )

    generated_at = datetime.now().isoformat()

    # Record in audit log
    _audit_log.append({
        "report_type":  rtype,
        "report_name":  cfg["name"],
        "generated_at": generated_at,
        "data_date":    ctx["date"],
        "genie_used":   genie_result.get("status") == "ok",
    })

    return {
        "report_type":  rtype,
        "report_name":  cfg["name"],
        "generated_at": generated_at,
        "content":      content,
        "genie":        genie_result,
        "context": {
            "kpis":         ctx["kpi"],
            "channels":     ctx["channels"],
            "date":         ctx["date"],          # data date (from DB)
            "generated_at": ctx["generated_at"],  # calendar date
        },
    }


class GenieReportReq(BaseModel):
    question: str


@router.post("/genie")
def report_genie(req: GenieReportReq):
    """Ask Genie a free-form question in the context of reports."""
    return genie_ask(req.question)


@router.get("/audit-log")
def get_audit_log():
    """Return list of all reports generated this session (newest first)."""
    return list(reversed(_audit_log))


# ── Report templates (persisted in Databricks) ─────────────────────────────────

_TMPL_TABLE = "risk_hub.fraud.report_templates"

def _ensure_templates_table():
    try:
        fetch(f"""
            CREATE TABLE IF NOT EXISTS {_TMPL_TABLE} (
                id          STRING,
                name        STRING,
                description STRING,
                created_at  TIMESTAMP
            )
        """)
    except Exception:
        pass


def _esc(s: str) -> str:
    return s.replace("'", "\\'").replace("\\", "\\\\")


@router.get("/templates")
def list_templates():
    """Return all saved custom report templates."""
    _ensure_templates_table()
    rows = _safe_fetch(
        f"SELECT id, name, description, CAST(created_at AS STRING) AS created_at "
        f"FROM {_TMPL_TABLE} ORDER BY created_at DESC",
        []
    )
    return rows


class TemplateReq(BaseModel):
    name:        str
    description: str = ""


@router.post("/templates")
def create_template(req: TemplateReq):
    """Save a new custom report template."""
    _ensure_templates_table()
    tid  = str(uuid.uuid4())
    now  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    fetch(
        f"INSERT INTO {_TMPL_TABLE} (id, name, description, created_at) "
        f"VALUES ('{tid}', '{_esc(req.name)}', '{_esc(req.description)}', TIMESTAMP '{now}')"
    )
    return {"id": tid, "name": req.name, "description": req.description, "created_at": now}


@router.delete("/templates/{template_id}")
def delete_template(template_id: str):
    """Delete a saved custom report template by id."""
    if not re.fullmatch(r"[0-9a-f\-]{36}", template_id):
        return {"error": "invalid id"}
    _ensure_templates_table()
    fetch(f"DELETE FROM {_TMPL_TABLE} WHERE id = '{template_id}'")
    return {"deleted": template_id}
