from fastapi import APIRouter
from pydantic import BaseModel
from core.db import fetch, execute
from core.config import T, CATALOG, SCHEMA
from core.agent import run as agent_run
from core.genie import ask as genie_ask
import httpx
from concurrent.futures import ThreadPoolExecutor, as_completed

router = APIRouter(prefix="/rules", tags=["rules"])

RULES_TABLE = f"{CATALOG}.{SCHEMA}.rule_engine"


# ── helpers ──────────────────────────────────────────────────

def _rule_live_stats(rule: dict) -> dict:
    """
    Compute live stats for each rule from risk_events and risk_signals_agg.
    Every number comes from the actual tables — nothing hardcoded.
    """
    channel  = rule.get("channel", "ALL")
    cat      = rule.get("merchant_category")
    thr      = rule.get("risk_score_threshold")
    age_max  = rule.get("account_age_max_days")
    t_start  = rule.get("time_window_start")
    t_end    = rule.get("time_window_end")

    # Build WHERE clause dynamically from rule config
    _max_date = f"(SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})"
    conditions = [f"DATE(txn_timestamp) = {_max_date}"]
    if channel and channel != "ALL":
        conditions.append(f"payment_method = '{channel}'")
    if thr is not None:
        conditions.append(f"risk_score > {thr}")
    if age_max is not None:
        conditions.append(f"account_age_days < {age_max}")
    if t_start is not None and t_end is not None:
        if t_start > t_end:
            conditions.append(f"(HOUR(txn_timestamp) >= {t_start} OR HOUR(txn_timestamp) < {t_end})")
        else:
            conditions.append(f"HOUR(txn_timestamp) BETWEEN {t_start} AND {t_end}")
    if cat:
        # join to merchant_risk_profiles to filter by category
        where_str = " AND ".join(conditions)
        try:
            rows = fetch(f"""
                SELECT
                    COUNT(*)                                                     AS blocked_count,
                    SUM(CASE WHEN e.fraud_flag = 1 THEN 1 ELSE 0 END)           AS fraud_caught,
                    SUM(CASE WHEN e.fraud_flag = 0 THEN 1 ELSE 0 END)           AS false_positives,
                    ROUND(SUM(e.amount), 2)                                      AS total_amount_blocked
                FROM {T['events']} e
                JOIN {T['merchants']} m ON e.merchant_id = m.merchant_id
                WHERE {where_str}
                  AND m.merchant_category = '{cat}'
            """)
        except Exception:
            rows = []
    else:
        where_str = " AND ".join(conditions)
        try:
            rows = fetch(f"""
                SELECT
                    COUNT(*)                                                     AS blocked_count,
                    SUM(CASE WHEN fraud_flag = 1 THEN 1 ELSE 0 END)             AS fraud_caught,
                    SUM(CASE WHEN fraud_flag = 0 THEN 1 ELSE 0 END)             AS false_positives,
                    ROUND(SUM(amount), 2)                                        AS total_amount_blocked
                FROM {T['events']}
                WHERE {where_str}
            """)
        except Exception:
            rows = []

    if not rows:
        return {
            "blocked_count": 0, "fraud_caught": 0,
            "false_positives": 0, "total_amount_blocked": 0,
            "fp_rate_pct": 0.0, "fraud_caught_pct": 0.0,
            "saved_lakh": 0.0,
        }

    r = rows[0]
    blocked   = int(r.get("blocked_count") or 0)
    caught    = int(r.get("fraud_caught") or 0)
    fp        = int(r.get("false_positives") or 0)
    amount    = float(r.get("total_amount_blocked") or 0)

    fp_rate     = round(fp / blocked * 100, 2)     if blocked > 0 else 0.0
    caught_rate = round(caught / blocked * 100, 2) if blocked > 0 else 0.0
    saved_lakh  = round(amount / 100000, 2)

    return {
        "blocked_count":         blocked,
        "fraud_caught":          caught,
        "false_positives":       fp,
        "total_amount_blocked":  amount,
        "fp_rate_pct":           fp_rate,
        "fraud_caught_pct":      caught_rate,
        "saved_lakh":            saved_lakh,
    }


def _overall_stats() -> dict:
    """Top-level rule engine KPIs from real data."""
    try:
        rows = fetch(f"""
            SELECT
                COUNT(*)                                           AS total_rules,
                SUM(CASE WHEN is_active THEN 1 ELSE 0 END)        AS active_rules,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_rules
            FROM {RULES_TABLE}
        """)
        rule_counts = rows[0] if rows else {}
    except Exception:
        rule_counts = {}

    try:
        today_rows = fetch(f"""
            SELECT
                COUNT(*)                                               AS total_txns_today,
                SUM(fraud_flag)                                        AS total_fraud_today,
                ROUND(SUM(amount), 2)                                  AS total_amount_today,
                ROUND(SUM(CASE WHEN fraud_flag=1 THEN amount ELSE 0 END), 2) AS fraud_amount_today
            FROM {T['events']}
            WHERE DATE(txn_timestamp) = (SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})
        """)
        today = today_rows[0] if today_rows else {}
    except Exception:
        today = {}

    return {**rule_counts, **today}


# ── routes ───────────────────────────────────────────────────

@router.get("/")
def get_rules():
    try:
        rules = fetch(f"""
            SELECT rule_id, rule_name, description, channel,
                   merchant_category, risk_score_threshold,
                   time_window_start, time_window_end,
                   account_age_max_days, is_active, status,
                   CAST(created_at AS STRING) AS created_at,
                   CAST(updated_at AS STRING) AS updated_at
            FROM {RULES_TABLE}
            ORDER BY
                CASE status WHEN 'active' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
                rule_id
        """)
    except Exception:
        return []
    _zero = {
        "blocked_count": 0, "fraud_caught": 0,
        "false_positives": 0, "total_amount_blocked": 0,
        "fp_rate_pct": 0.0, "fraud_caught_pct": 0.0,
        "saved_lakh": 0.0,
    }
    stats_map: dict = {}
    with ThreadPoolExecutor(max_workers=min(len(rules), 6)) as pool:
        futures = {pool.submit(_rule_live_stats, rule): rule["rule_id"] for rule in rules}
        for future in as_completed(futures):
            rid = futures[future]
            try:
                stats_map[rid] = future.result()
            except Exception:
                stats_map[rid] = _zero.copy()

    return [{**rule, **stats_map.get(rule["rule_id"], _zero)} for rule in rules]


@router.get("/overview")
def overview():
    return _overall_stats()


class ToggleReq(BaseModel):
    rule_id: str
    is_active: bool

@router.post("/toggle")
def toggle(req: ToggleReq):
    new_status = "active" if req.is_active else "paused"
    execute(f"""
        UPDATE {RULES_TABLE}
        SET is_active = {str(req.is_active).lower()},
            status = '{new_status}',
            updated_at = CURRENT_TIMESTAMP
        WHERE rule_id = '{req.rule_id}'
    """)
    return {"status": "ok", "rule_id": req.rule_id, "is_active": req.is_active}


class SimulateReq(BaseModel):
    rule_id:     str
    rule_name:   str
    description: str
    channel:     str
    current_thr: int
    new_thr:     int
    merchant_category: str = ""
    account_age_max_days: int = None

@router.post("/simulate")
def simulate(req: SimulateReq):
    # Pull real numbers for both thresholds from risk_events
    _max_date = f"(SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})"
    conditions_current = [f"DATE(txn_timestamp) = {_max_date}"]
    conditions_new     = [f"DATE(txn_timestamp) = {_max_date}"]

    if req.channel and req.channel != "ALL":
        conditions_current.append(f"payment_method = '{req.channel}'")
        conditions_new.append(f"payment_method = '{req.channel}'")
    if req.account_age_max_days:
        conditions_current.append(f"account_age_days < {req.account_age_max_days}")
        conditions_new.append(f"account_age_days < {req.account_age_max_days}")

    conditions_current.append(f"risk_score > {req.current_thr}")
    conditions_new.append(f"risk_score > {req.new_thr}")

    def _pull(conditions):
        where = " AND ".join(conditions)
        try:
            rows = fetch(f"""
                SELECT
                    COUNT(*)                                               AS total,
                    SUM(fraud_flag)                                        AS fraud,
                    SUM(1 - fraud_flag)                                    AS legit,
                    ROUND(SUM(CASE WHEN fraud_flag=1 THEN amount ELSE 0 END)/100000,2) AS fraud_lakhs,
                    ROUND(SUM(amount)/100000,2)                            AS total_lakhs
                FROM {T['events']}
                WHERE {where}
            """)
            return rows[0] if rows else {}
        except Exception:
            return {}

    current_data = _pull(conditions_current)
    new_data     = _pull(conditions_new)

    context = (
        f"Rule: {req.rule_name} | {req.description}\n"
        f"Channel: {req.channel} | Category: {req.merchant_category or 'ALL'}\n\n"
        f"Current threshold ({req.current_thr}) — from risk_events today:\n"
        f"  Transactions blocked: {current_data.get('total',0)}\n"
        f"  Fraud transactions caught: {current_data.get('fraud',0)}\n"
        f"  Legitimate transactions blocked (false positives): {current_data.get('legit',0)}\n"
        f"  Fraud amount saved: ${current_data.get('fraud_lakhs',0)}L\n\n"
        f"New threshold ({req.new_thr}) — from risk_events today:\n"
        f"  Transactions blocked: {new_data.get('total',0)}\n"
        f"  Fraud transactions caught: {new_data.get('fraud',0)}\n"
        f"  Legitimate transactions blocked (false positives): {new_data.get('legit',0)}\n"
        f"  Fraud amount saved: ${new_data.get('fraud_lakhs',0)}L"
    )

    answer = agent_run(
        f"Simulate changing rule '{req.rule_name}' threshold from "
        f"{req.current_thr} to {req.new_thr}. "
        f"Analyse the real data impact shown above and give a clear go/no-go recommendation.",
        context=context
    )
    return {
        "answer":        answer,
        "current_data":  current_data,
        "new_data":      new_data,
    }


class AskReq(BaseModel):
    question: str
    context:  str = ""

@router.post("/ask")
def ask_genie(req: AskReq):
    genie  = genie_ask(req.question)
    answer = agent_run(req.question, context=req.context)
    return {"answer": answer, "genie": genie}