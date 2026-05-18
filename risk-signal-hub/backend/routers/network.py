from fastapi import APIRouter, Query
from core.db import fetch
from core.config import T

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/stats")
def stats():
    """Overall network statistics."""
    rows = fetch(f"""
        SELECT
            COUNT(DISTINCT merchant_id)        AS total_merchants,
            COUNT(DISTINCT customer_id)        AS total_customers,
            COUNT(DISTINCT device_fingerprint) AS total_devices,
            SUM(fraud_flag)                    AS total_fraud_txns,
            COUNT(*)                           AS total_txns,
            ROUND(SUM(fraud_flag)*100.0/COUNT(*), 2) AS fraud_rate_pct
        FROM {T['events']}
    """)
    return rows[0] if rows else {}


@router.get("/merchants")
def merchants(limit: int = Query(default=20, le=50)):
    """Top risk merchants with connection counts."""
    return fetch(f"""
        SELECT
            e.merchant_id,
            m.merchant_category,
            m.primary_city,
            m.risk_status,
            ROUND(m.avg_risk_score, 1)                                    AS avg_risk_score,
            ROUND(m.fraud_rate, 2)                                        AS fraud_rate_pct,
            COUNT(DISTINCT e.customer_id)                                 AS unique_customers,
            COUNT(DISTINCT e.device_fingerprint)                          AS unique_devices,
            SUM(e.fraud_flag)                                             AS fraud_txns,
            COUNT(*)                                                      AS total_txns,
            ROUND(SUM(e.amount)/100000, 1)                                AS total_amount_lakhs
        FROM {T['events']} e
        JOIN {T['merchants']} m ON e.merchant_id = m.merchant_id
        GROUP BY e.merchant_id, m.merchant_category, m.primary_city,
                 m.risk_status, m.avg_risk_score, m.fraud_rate
        ORDER BY m.avg_risk_score DESC
        LIMIT {limit}
    """)


@router.get("/shared-devices")
def shared_devices(limit: int = Query(default=15, le=30)):
    """Devices shared across multiple customers — ATO signal."""
    return fetch(f"""
        SELECT
            device_fingerprint,
            COUNT(DISTINCT customer_id)   AS customer_count,
            COUNT(DISTINCT merchant_id)   AS merchant_count,
            SUM(fraud_flag)               AS fraud_txns,
            COUNT(*)                      AS total_txns,
            ROUND(SUM(fraud_flag)*100.0/COUNT(*), 2) AS fraud_rate_pct,
            COUNT(DISTINCT location_city) AS city_count,
            COUNT(DISTINCT payment_method) AS method_count
        FROM {T['events']}
        GROUP BY device_fingerprint
        HAVING COUNT(DISTINCT customer_id) > 3
        ORDER BY customer_count DESC
        LIMIT {limit}
    """)


@router.get("/risky-customers")
def risky_customers(limit: int = Query(default=20, le=50)):
    """High risk customers with network signals."""
    return fetch(f"""
        SELECT
            a.customer_id,
            a.fraud_pattern,
            ROUND(a.avg_risk_score, 1)    AS avg_risk_score,
            a.fraud_txns,
            a.total_txns,
            a.account_age_days,
            a.unique_devices,
            a.unique_cities,
            a.preferred_method,
            ROUND(a.total_spend/100000, 1) AS total_spend_lakhs
        FROM {T['accounts']} a
        WHERE a.fraud_pattern != 'NORMAL'
        ORDER BY a.avg_risk_score DESC
        LIMIT {limit}
    """)


@router.get("/merchant-customer-links")
def merchant_customer_links(limit: int = Query(default=30, le=60)):
    """
    Edges between high-risk merchants and fraud customers.
    Used to draw network graph links.
    """
    return fetch(f"""
        SELECT
            e.merchant_id,
            e.customer_id,
            COUNT(*)                      AS txn_count,
            SUM(e.fraud_flag)             AS fraud_count,
            MAX(e.risk_score)             AS max_risk_score,
            COUNT(DISTINCT e.device_fingerprint) AS device_count,
            MAX(e.payment_method)         AS payment_method,
            MAX(e.location_city)          AS location_city
        FROM {T['events']} e
        JOIN {T['merchants']} m ON e.merchant_id = m.merchant_id
        JOIN {T['accounts']}  a ON e.customer_id = a.customer_id
        WHERE m.risk_status IN ('HIGH_RISK', 'MEDIUM_RISK')
          AND a.fraud_pattern != 'NORMAL'
        GROUP BY e.merchant_id, e.customer_id
        ORDER BY fraud_count DESC, max_risk_score DESC
        LIMIT {limit}
    """)


@router.get("/device-clusters")
def device_clusters(limit: int = Query(default=10, le=20)):
    """
    Device fingerprints shared by 5+ customers — rings/clusters.
    """
    return fetch(f"""
        SELECT
            d.device_fingerprint,
            d.customer_count,
            d.fraud_txns,
            d.fraud_rate_pct,
            d.merchant_count,
            GROUP_CONCAT(DISTINCT e.location_city) AS cities,
            GROUP_CONCAT(DISTINCT e.payment_method) AS methods
        FROM (
            SELECT
                device_fingerprint,
                COUNT(DISTINCT customer_id)          AS customer_count,
                COUNT(DISTINCT merchant_id)          AS merchant_count,
                SUM(fraud_flag)                      AS fraud_txns,
                ROUND(SUM(fraud_flag)*100.0/COUNT(*), 2) AS fraud_rate_pct
            FROM {T['events']}
            GROUP BY device_fingerprint
            HAVING COUNT(DISTINCT customer_id) >= 5
            ORDER BY customer_count DESC
            LIMIT {limit}
        ) d
        JOIN {T['events']} e ON e.device_fingerprint = d.device_fingerprint
        GROUP BY d.device_fingerprint, d.customer_count,
                 d.fraud_txns, d.fraud_rate_pct, d.merchant_count
        ORDER BY d.customer_count DESC
    """)


@router.get("/city-network")
def city_network():
    """Fraud flow between cities — for geographic network view."""
    return fetch(f"""
        SELECT
            location_city,
            COUNT(DISTINCT merchant_id)   AS merchant_count,
            COUNT(DISTINCT customer_id)   AS customer_count,
            SUM(fraud_flag)               AS fraud_txns,
            COUNT(*)                      AS total_txns,
            ROUND(SUM(fraud_flag)*100.0/COUNT(*), 2) AS fraud_rate_pct,
            ROUND(SUM(amount)/100000, 1)  AS total_amount_lakhs
        FROM {T['events']}
        GROUP BY location_city
        ORDER BY fraud_rate_pct DESC
    """)