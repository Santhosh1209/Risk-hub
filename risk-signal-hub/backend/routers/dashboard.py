import time
from fastapi import APIRouter
from core.db import fetch, _conn
from core.config import T

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_cache: dict = {}
_CACHE_TTL = 300  # 5 minutes


def _cached_all():
    entry = _cache.get("all")
    if entry and time.time() - entry["ts"] < _CACHE_TTL:
        return entry["data"]
    return None


def _store_all(data):
    _cache["all"] = {"data": data, "ts": time.time()}


@router.get("/all")
def all_dashboard():
    cached = _cached_all()
    if cached is not None:
        return cached
    queries = {
        "kpis": f"""
            SELECT
                ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 2) AS fraud_rate_pct,
                SUM(txn_count)                                                   AS total_txns,
                SUM(fraud_count)                                                 AS total_fraud,
                SUM(decline_count)                                               AS total_declines,
                ROUND(SUM(total_amount) / 100000, 1)                             AS exposure_lakhs,
                ROUND(SUM(decline_count) * 100.0 / NULLIF(SUM(txn_count), 0), 2) AS decline_rate_pct,
                ROUND(AVG(avg_risk_score), 1)                                    AS avg_risk_score
            FROM {T['agg']}
            WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
        """,
        "hourly": f"""
            SELECT txn_hour, payment_method,
                SUM(txn_count)   AS txn_count,
                SUM(fraud_count) AS fraud_count,
                ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 3) AS fraud_rate_pct
            FROM {T['agg']}
            WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
              AND txn_hour IS NOT NULL
            GROUP BY txn_hour, payment_method
            ORDER BY txn_hour, payment_method
        """,
        "decline": f"""
            SELECT COALESCE(decline_reason, 'NO_DECLINE') AS decline_reason, COUNT(*) AS cnt
            FROM {T['events']}
            WHERE DATE(txn_timestamp) = (SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})
              AND decline_reason IS NOT NULL
            GROUP BY decline_reason ORDER BY cnt DESC
        """,
        "riskDist": f"""
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
            GROUP BY 1 ORDER BY 1
        """,
        "trend": f"""
            SELECT CAST(txn_date AS STRING) AS txn_date,
                SUM(txn_count)   AS txn_count,
                SUM(fraud_count) AS fraud_count,
                ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 3) AS fraud_rate_pct
            FROM {T['agg']}
            WHERE txn_date >= (SELECT MAX(txn_date) FROM {T['agg']}) - INTERVAL 7 DAYS
            GROUP BY txn_date ORDER BY txn_date
        """,
        "channels": f"""
            SELECT payment_method,
                SUM(txn_count)   AS txn_count,
                SUM(fraud_count) AS fraud_count,
                ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 2) AS fraud_rate_pct
            FROM {T['agg']}
            WHERE txn_date >= (SELECT MAX(txn_date) FROM {T['agg']}) - INTERVAL 7 DAYS
            GROUP BY payment_method ORDER BY fraud_rate_pct DESC
        """,
        "alerts": f"""
            SELECT case_id, title, severity, status, exposure_amt,
                CAST(created_at AS STRING) AS created_at
            FROM {T['cases']}
            WHERE UPPER(status) != 'CLOSED'
            ORDER BY CASE UPPER(severity) WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
                     created_at DESC
            LIMIT 5
        """,
        "accounts": f"""
            SELECT customer_id, ROUND(avg_risk_score, 0) AS risk_score,
                total_txns, fraud_txns, account_age_days,
                unique_devices, preferred_method, fraud_pattern
            FROM {T['accounts']}
            WHERE fraud_pattern != 'NORMAL'
            ORDER BY avg_risk_score DESC LIMIT 50
        """,
    }

    result = {}
    with _conn() as conn:
        with conn.cursor() as cur:
            for key, sql in queries.items():
                cur.execute(sql)
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, row)) for row in cur.fetchall()]
                result[key] = rows[0] if key == "kpis" and rows else rows

    _store_all(result)
    return result


@router.get("/kpis")
def kpis():
    rows = fetch(f"""
        SELECT
            ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 2) AS fraud_rate_pct,
            SUM(txn_count)                                                   AS total_txns,
            SUM(fraud_count)                                                 AS total_fraud,
            SUM(decline_count)                                               AS total_declines,
            ROUND(SUM(total_amount) / 100000, 1)                             AS exposure_lakhs,
            ROUND(SUM(decline_count) * 100.0 / NULLIF(SUM(txn_count), 0), 2) AS decline_rate_pct,
            ROUND(AVG(avg_risk_score), 1)                                    AS avg_risk_score
        FROM {T['agg']}
        WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
    """)
    return rows[0] if rows else {}


@router.get("/hourly")
def hourly():
    return fetch(f"""
        SELECT
            txn_hour,
            payment_method,
            SUM(txn_count)                                                    AS txn_count,
            SUM(fraud_count)                                                  AS fraud_count,
            ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 3)   AS fraud_rate_pct
        FROM {T['agg']}
        WHERE txn_date = (SELECT MAX(txn_date) FROM {T['agg']})
          AND txn_hour IS NOT NULL
        GROUP BY txn_hour, payment_method
        ORDER BY txn_hour, payment_method
    """)


@router.get("/decline-breakdown")
def decline_breakdown():
    return fetch(f"""
        SELECT
            COALESCE(decline_reason, 'NO_DECLINE') AS decline_reason,
            COUNT(*)                                AS cnt
        FROM {T['events']}
        WHERE DATE(txn_timestamp) = (SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})
          AND decline_reason IS NOT NULL
        GROUP BY decline_reason
        ORDER BY cnt DESC
    """)


@router.get("/risk-score-dist")
def risk_score_dist():
    return fetch(f"""
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
        ORDER BY 1
    """)


@router.get("/seven-day-trend")
def seven_day_trend():
    return fetch(f"""
        SELECT
            CAST(txn_date AS STRING)                                          AS txn_date,
            SUM(txn_count)                                                    AS txn_count,
            SUM(fraud_count)                                                  AS fraud_count,
            ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 3)   AS fraud_rate_pct
        FROM {T['agg']}
        WHERE txn_date >= (SELECT MAX(txn_date) FROM {T['agg']}) - INTERVAL 7 DAYS
        GROUP BY txn_date
        ORDER BY txn_date
    """)


@router.get("/channel-split")
def channel_split():
    return fetch(f"""
        SELECT
            payment_method,
            SUM(txn_count)                                                    AS txn_count,
            SUM(fraud_count)                                                  AS fraud_count,
            ROUND(SUM(fraud_count) * 100.0 / NULLIF(SUM(txn_count), 0), 2)   AS fraud_rate_pct
        FROM {T['agg']}
        WHERE txn_date >= (SELECT MAX(txn_date) FROM {T['agg']}) - INTERVAL 7 DAYS
        GROUP BY payment_method
        ORDER BY fraud_rate_pct DESC
    """)


@router.get("/alerts")
def alerts():
    return fetch(f"""
        SELECT
            case_id, title, severity, status,
            exposure_amt,
            CAST(created_at AS STRING) AS created_at
        FROM {T['cases']}
        WHERE UPPER(status) != 'CLOSED'
        ORDER BY
            CASE UPPER(severity)
                WHEN 'CRITICAL' THEN 1
                WHEN 'WARNING'  THEN 2
                ELSE 3
            END,
            created_at DESC
        LIMIT 5
    """)


@router.get("/flagged-accounts")
def flagged_accounts():
    return fetch(f"""
        SELECT
            customer_id,
            ROUND(avg_risk_score, 0)  AS risk_score,
            total_txns,
            fraud_txns,
            account_age_days,
            unique_devices,
            preferred_method,
            fraud_pattern
        FROM {T['accounts']}
        WHERE fraud_pattern != 'NORMAL'
        ORDER BY avg_risk_score DESC
        LIMIT 50
    """)
