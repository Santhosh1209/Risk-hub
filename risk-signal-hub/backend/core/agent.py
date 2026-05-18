import httpx
from concurrent.futures import ThreadPoolExecutor
from core.config import AI_ENDPOINT, AI_HEADERS
from core.genie import ask as genie_ask
from core.db import fetch
from core.config import T

# ── Main SYSTEM prompt — used by sidebar, rule engine, settings ───────────────
# Produces [GENIE] / [AGENT BRICKS] / [FORECAST] / [ACTION] tagged sections
SYSTEM = """
You are a senior fraud risk analyst writing for a fraud operations team.

You have access to the following data (Catalog: risk_hub, Schema: fraud):
- risk_events: transactions with payment method, merchant, customer, risk score, fraud flag, amount, location, device
- risk_signals_agg: aggregated daily/hourly fraud rates, transaction counts, decline counts by channel and city
- merchant_risk_profiles: per-merchant fraud rate, risk score, transaction volume, category, city, status
- account_risk_features: per-customer risk score, fraud history, account age, device count, spend, fraud pattern
- cases: fraud investigation cases with severity, status, financial exposure, merchant, notes

Format your response using exactly these section tags in order:
[KPI] — List 4-6 key metrics directly relevant to the question as "Metric Name: Value" pairs, one per line (e.g. "Fraud Rate: 2.3%" or "Exposure: $45.2L" or "Flagged Txns: 1,240"). Always include this section with real numbers from the data.
[GENIE] — Summarize the data retrieved (1-2 sentences, specific numbers).
[AGENT BRICKS] — Main analysis (3-5 sentences with $ amounts, percentages, counts).
[FORECAST] — Short forecast or prediction (1-2 sentences with confidence level).
[ACTION] — 2-3 recommended actions as a numbered list.

Rules:
- Write in plain English as if briefing a fraud manager.
- Be specific with numbers: include $ amounts, percentages, counts.
- Keep it concise — every sentence must add value.
"""

# ── Cases-only SYSTEM prompt — produces ## Section headings ───────────────────
SYSTEM_CASES = """
You are a senior fraud risk analyst writing for a fraud operations team.

You have access to the following data (Catalog: risk_hub, Schema: fraud):
- risk_events: transactions with payment method, merchant, customer, risk score, fraud flag, amount, location, device
- risk_signals_agg: aggregated daily/hourly fraud rates, transaction counts, decline counts by channel and city
- merchant_risk_profiles: per-merchant fraud rate, risk score, transaction volume, category, city, status
- account_risk_features: per-customer risk score, fraud history, account age, device count, spend, fraud pattern
- cases: fraud investigation cases with severity, status, financial exposure, merchant, notes

Each question will tell you exactly what sections to output using ## headings.
Follow those instructions precisely — output only the requested sections, nothing more.

Rules:
- Never mention SQL, column names, internal tools, or system names.
- Never use tags like [GENIE], [AGENT BRICKS], [FORECAST], [ACTION].
- Write in plain English as if briefing a fraud manager.
- Be specific with numbers: include $ amounts, percentages, counts.
- Keep it concise — every sentence must add value.
"""


def _fetch_kpis() -> str:
    try:
        kpis = fetch(f"""
            SELECT
                ROUND(SUM(fraud_count)*100.0/NULLIF(SUM(txn_count),0),2) AS fraud_rate_pct,
                ROUND(SUM(total_amount)/100000,1) AS exposure_lakhs
            FROM {T['agg']}
            WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
        """)
        return str(kpis[0]) if kpis else ""
    except Exception:
        return ""


def _keyword_fallback(question: str) -> dict:
    """Run a question-relevant Databricks SQL query when Genie returns no data."""
    q = question.lower()
    try:
        if any(w in q for w in ["hour", "spike", "peak", "time of day", "last hour", "11 pm", "23:00", "when did"]):
            sql = f"""
                SELECT txn_hour, payment_method,
                    SUM(txn_count)   AS txn_count,
                    SUM(fraud_count) AS fraud_count,
                    ROUND(SUM(fraud_count)*100.0/NULLIF(SUM(txn_count),0),3) AS fraud_rate_pct
                FROM {T['agg']}
                WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
                  AND txn_hour IS NOT NULL
                GROUP BY txn_hour, payment_method
                ORDER BY txn_hour"""
        elif any(w in q for w in ["merchant", "shop", "store", "vendor", "seller", "aggregator"]):
            sql = f"""
                SELECT merchant_id,
                    ROUND(fraud_rate_7d, 2) AS fraud_rate_pct,
                    risk_score, category, city, status
                FROM {T['merchants']}
                ORDER BY risk_score DESC
                LIMIT 15"""
        elif any(w in q for w in ["city", "location", "region", "geography", "where", "mumbai", "delhi",
                                   "bangalore", "chennai", "hyderabad", "pune", "kolkata", "ahmedabad"]):
            sql = f"""
                SELECT location_city,
                    COUNT(*)                                                          AS txn_count,
                    SUM(CAST(fraud_flag AS INT))                                      AS fraud_count,
                    ROUND(SUM(CAST(fraud_flag AS INT))*100.0/NULLIF(COUNT(*),0), 3)   AS fraud_rate_pct
                FROM {T['events']}
                WHERE DATE(txn_timestamp) >= (SELECT MAX(DATE(txn_timestamp)) FROM {T['events']}) - INTERVAL 7 DAYS
                GROUP BY location_city
                ORDER BY fraud_rate_pct DESC"""
        elif any(w in q for w in ["week", "7 day", "7-day", "trend", "daily", "history",
                                   "pattern", "compare", "last month", "period", "over time"]):
            sql = f"""
                SELECT CAST(txn_date AS STRING) AS txn_date,
                    SUM(txn_count)   AS txn_count,
                    SUM(fraud_count) AS fraud_count,
                    ROUND(SUM(fraud_count)*100.0/NULLIF(SUM(txn_count),0),3) AS fraud_rate_pct
                FROM {T['agg']}
                WHERE txn_date >= (SELECT MAX(txn_date) FROM {T['agg']}) - INTERVAL 7 DAYS
                GROUP BY txn_date
                ORDER BY txn_date"""
        elif any(w in q for w in ["channel", "payment method", "upi", "card", "wallet", "netbank", "split"]):
            sql = f"""
                SELECT payment_method,
                    SUM(txn_count)   AS txn_count,
                    SUM(fraud_count) AS fraud_count,
                    ROUND(SUM(fraud_count)*100.0/NULLIF(SUM(txn_count),0),2) AS fraud_rate_pct
                FROM {T['agg']}
                WHERE txn_date >= (SELECT MAX(txn_date) FROM {T['agg']}) - INTERVAL 7 DAYS
                GROUP BY payment_method
                ORDER BY fraud_rate_pct DESC"""
        elif any(w in q for w in ["risk score", "score distribution", "bucket", "high risk", "low risk", "distribution"]):
            sql = f"""
                SELECT
                    CASE
                        WHEN risk_score BETWEEN 0  AND 20  THEN '0-20'
                        WHEN risk_score BETWEEN 21 AND 40  THEN '21-40'
                        WHEN risk_score BETWEEN 41 AND 60  THEN '41-60'
                        WHEN risk_score BETWEEN 61 AND 80  THEN '61-80'
                        WHEN risk_score BETWEEN 81 AND 100 THEN '81-100'
                    END AS bucket,
                    COUNT(*) AS cnt
                FROM {T['events']}
                WHERE DATE(txn_timestamp) = (SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})
                GROUP BY 1
                ORDER BY 1"""
        elif any(w in q for w in ["decline", "block", "reject", "reason", "why fail"]):
            sql = f"""
                SELECT COALESCE(decline_reason, 'UNKNOWN') AS decline_reason,
                    COUNT(*) AS cnt
                FROM {T['events']}
                WHERE DATE(txn_timestamp) = (SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})
                  AND decline_reason IS NOT NULL
                GROUP BY decline_reason
                ORDER BY cnt DESC"""
        elif any(w in q for w in ["account", "customer", "user", "velocity", "ato", "takeover", "new account"]):
            sql = f"""
                SELECT customer_id,
                    ROUND(avg_risk_score, 0) AS risk_score,
                    total_txns, fraud_txns,
                    account_age_days, unique_devices, fraud_pattern
                FROM {T['accounts']}
                WHERE fraud_pattern != 'NORMAL'
                ORDER BY avg_risk_score DESC
                LIMIT 10"""
        elif any(w in q for w in ["case", "investigation", "incident", "escalat", "open case"]):
            sql = f"""
                SELECT case_id, title, severity, status,
                    ROUND(exposure_amt/100000, 1) AS exposure_lakhs,
                    CAST(created_at AS STRING)    AS created_at
                FROM {T['cases']}
                WHERE UPPER(status) != 'CLOSED'
                ORDER BY CASE UPPER(severity) WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END
                LIMIT 10"""
        else:
            sql = f"""
                SELECT
                    ROUND(SUM(fraud_count)*100.0/NULLIF(SUM(txn_count),0),2) AS fraud_rate_pct,
                    SUM(txn_count)                                             AS total_txns,
                    SUM(fraud_count)                                           AS total_fraud,
                    ROUND(SUM(total_amount)/100000,1)                          AS exposure_lakhs,
                    SUM(decline_count)                                         AS total_declines
                FROM {T['agg']}
                WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})"""

        rows = fetch(sql.strip())
        return {"status": "ok", "sql": sql.strip(), "data": rows, "summary": ""}
    except Exception:
        return {"status": "error", "data": [], "sql": ""}


def _call_llm(system_prompt: str, question: str, context: str = ""):
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_genie = pool.submit(genie_ask, question)
        f_kpis  = pool.submit(_fetch_kpis)
        genie_result = f_genie.result()
        kpi_str      = f_kpis.result()

    if not genie_result.get("data"):
        fallback = _keyword_fallback(question)
        if fallback.get("data"):
            genie_result = fallback

    augmented = "\n".join(filter(None, [
        f"Question: {question}",
        f"Context: {context}" if context else "",
        f"Genie SQL: {genie_result.get('sql', '')}",
        f"Genie summary: {genie_result.get('summary', '')}",
        f"Genie data rows (first 5): {genie_result.get('data', [])[:5]}",
        f"Live KPIs: {kpi_str}",
    ]))

    try:
        r = httpx.post(
            AI_ENDPOINT,
            headers=AI_HEADERS,
            json={
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": augmented},
                ],
                "max_tokens":  900,
                "temperature": 0.1,
            },
            timeout=45,
        )
        r.raise_for_status()
        answer = r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        sql_shown = genie_result.get("sql", "N/A")
        summary   = genie_result.get("summary", "")
        answer = (
            f"[GENIE] SQL executed:\n```sql\n{sql_shown}\n```\n"
            f"Summary: {summary}\n\n"
            f"[AGENT BRICKS] LLM endpoint unavailable: {e}\n\n"
            f"[ACTION]\n1. Enable databricks-meta-llama-3-1-70b-instruct in Serving\n"
            f"2. Verify DATABRICKS_TOKEN has serving-endpoints:invoke permission"
        )

    return answer, genie_result


def run(question: str, context: str = ""):
    """Tag-format response — used by sidebar, rule engine, settings.
    Returns (answer: str, genie: dict)."""
    return _call_llm(SYSTEM, question, context)


def run_sections(question: str, context: str = "") -> str:
    """## Section-format response — used by Cases page only.
    Returns answer string only."""
    answer, _ = _call_llm(SYSTEM_CASES, question, context)
    return answer
