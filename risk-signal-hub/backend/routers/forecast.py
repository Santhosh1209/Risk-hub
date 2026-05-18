from fastapi import APIRouter, Query
from core.db import fetch
from core.config import T, CATALOG, SCHEMA, AI_ENDPOINT, AI_HEADERS
from core.genie import ask as ask_genie

import warnings
import httpx
import numpy as np
import pandas as pd

from datetime import date, timedelta

from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
)

try:
    from prophet import Prophet
    PROPHET_OK = True
except ImportError:
    PROPHET_OK = False

try:
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    SARIMA_OK = True
except ImportError:
    SARIMA_OK = False

warnings.filterwarnings("ignore")


def _ask_llm(prompt: str):
    try:
        r = httpx.post(
            AI_ENDPOINT,
            headers=AI_HEADERS,
            json={
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 500,
                "temperature": 0.2,
            },
            timeout=45,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return {"error": str(e)}


router = APIRouter(
    prefix="/forecast",
    tags=["forecast"],
)

MAX_DATE = f"(SELECT MAX(txn_date) FROM {T['agg']})"


# =========================================================
# DATA LOADER
# =========================================================

def _load_daily() -> pd.DataFrame:

    rows = fetch(f"""
        SELECT
            txn_date,

            SUM(txn_count)
                AS txn_count,

            SUM(fraud_count)
                AS fraud_count,

            ROUND(
                SUM(fraud_count)*100.0/
                NULLIF(SUM(txn_count),0),
                4
            ) AS fraud_rate_pct,

            ROUND(
                SUM(total_amount)/100000,
                2
            ) AS exposure_lakhs,

            ROUND(
                AVG(avg_risk_score),
                2
            ) AS avg_risk_score

        FROM {T['agg']}

        GROUP BY txn_date

        ORDER BY txn_date
    """)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)

    df["txn_date"] = pd.to_datetime(
        df["txn_date"]
    )

    df["fraud_rate_pct"] = (
        df["fraud_rate_pct"]
        .astype(float)
        .fillna(0)
    )

    df["exposure_lakhs"] = (
        df["exposure_lakhs"]
        .astype(float)
        .fillna(0)
    )

    df["txn_count"] = (
        df["txn_count"]
        .astype(int)
    )

    df["fraud_count"] = (
        df["fraud_count"]
        .astype(int)
    )

    df["avg_risk_score"] = (
        df["avg_risk_score"]
        .astype(float)
        .fillna(50)
    )

    df["day_idx"] = (
        df["txn_date"] -
        df["txn_date"].min()
    ).dt.days

    df["day_of_week"] = (
        df["txn_date"]
        .dt.dayofweek
    )

    df["is_weekend"] = (
        df["day_of_week"] >= 5
    ).astype(int)

    df["rolling_3d"] = (
        df["fraud_rate_pct"]
        .rolling(3, min_periods=1)
        .mean()
    )

    df["rolling_7d"] = (
        df["fraud_rate_pct"]
        .rolling(7, min_periods=1)
        .mean()
    )

    return df.reset_index(drop=True)


# =========================================================
# FUTURE FEATURES
# =========================================================

def _future_rows(
    df: pd.DataFrame,
    horizon: int
) -> pd.DataFrame:

    last_date = df["txn_date"].max()

    last_idx = df["day_idx"].max()

    roll3 = float(
        df["rolling_3d"].iloc[-1]
    )

    roll7 = float(
        df["rolling_7d"].iloc[-1]
    )

    rows = []

    for i in range(1, horizon + 1):

        d = last_date + timedelta(days=i)

        rows.append({
            "txn_date": d,
            "day_idx": last_idx + i,
            "day_of_week": d.dayofweek,
            "is_weekend": int(d.dayofweek >= 5),
            "rolling_3d": roll3,
            "rolling_7d": roll7,
        })

    return pd.DataFrame(rows)


# =========================================================
# RULE EFFECTIVENESS (cached daily from rule_engine table)
# =========================================================

_eff_cache: dict = {"date": None, "value": 0.35}


def _compute_rule_effectiveness() -> float:
    """
    Fraction of today's fraud txns caught by at least one active rule.
    Falls back to 0.35 if rule_engine is unavailable or empty.
    """
    rules_table = f"{CATALOG}.{SCHEMA}.rule_engine"
    try:
        rules = fetch(f"""
            SELECT channel, merchant_category, risk_score_threshold,
                   time_window_start, time_window_end, account_age_max_days
            FROM {rules_table}
            WHERE is_active = true AND status = 'active'
        """)
    except Exception:
        return 0.35

    if not rules:
        return 0.35

    rule_conditions = []
    for rule in rules:
        parts = []
        channel = rule.get("channel") or "ALL"
        cat     = rule.get("merchant_category")
        thr     = rule.get("risk_score_threshold")
        age_max = rule.get("account_age_max_days")
        t_start = rule.get("time_window_start")
        t_end   = rule.get("time_window_end")

        if channel and channel != "ALL":
            parts.append(f"payment_method = '{channel}'")
        if thr is not None:
            parts.append(f"risk_score > {int(thr)}")
        if age_max is not None:
            parts.append(f"account_age_days < {int(age_max)}")
        if t_start is not None and t_end is not None:
            s, e = int(t_start), int(t_end)
            if s > e:
                parts.append(f"(HOUR(txn_timestamp) >= {s} OR HOUR(txn_timestamp) < {e})")
            else:
                parts.append(f"HOUR(txn_timestamp) BETWEEN {s} AND {e}")
        if cat:
            parts.append(
                f"merchant_id IN (SELECT merchant_id FROM {T['merchants']} "
                f"WHERE merchant_category = '{cat}')"
            )
        if parts:
            rule_conditions.append("(" + " AND ".join(parts) + ")")

    if not rule_conditions:
        return 0.35

    combined = " OR ".join(rule_conditions)
    try:
        rows = fetch(f"""
            SELECT
                SUM(CASE WHEN fraud_flag = 1 THEN 1 ELSE 0 END)                       AS total_fraud,
                SUM(CASE WHEN fraud_flag = 1 AND ({combined}) THEN 1 ELSE 0 END)       AS fraud_caught
            FROM {T['events']}
            WHERE DATE(txn_timestamp) = (SELECT MAX(DATE(txn_timestamp)) FROM {T['events']})
        """)
        if not rows:
            return 0.35
        row    = rows[0]
        total  = int(row.get("total_fraud")  or 0)
        caught = int(row.get("fraud_caught") or 0)
        if total == 0:
            return 0.35
        return min(round(caught / total, 4), 1.0)
    except Exception:
        return 0.35


def _get_rule_effectiveness() -> float:
    today = str(date.today())
    if _eff_cache["date"] == today:
        return _eff_cache["value"]
    value = _compute_rule_effectiveness()
    _eff_cache["date"]  = today
    _eff_cache["value"] = value
    return value


# =========================================================
# EXPOSURE CALC
# =========================================================

def _exposure(rate: float) -> dict:
    eff        = _get_rule_effectiveness()
    base       = max(rate, 0)
    no_action  = round(base * 10, 2)
    with_rules = round(no_action * (1 - eff), 2)
    return {
        "exposure_no_action_lakhs":  no_action,
        "exposure_with_rules_lakhs": with_rules,
        "savings_lakhs":             round(no_action - with_rules, 2),
        "rule_effectiveness_pct":    round(eff * 100, 1),
    }


# =========================================================
# CONFIDENCE INTERVALS
# =========================================================

def _ci(pred: float, std: float):

    return {
        "upper_80":
            round(pred + 1.282 * std, 4),

        "lower_80":
            round(
                max(pred - 1.282 * std, 0),
                4,
            ),

        "upper_95":
            round(pred + 1.960 * std, 4),

        "lower_95":
            round(
                max(pred - 1.960 * std, 0),
                4,
            ),
    }


# =========================================================
# PROPHET MODEL
# =========================================================

def _run_prophet(
    df: pd.DataFrame,
    horizon: int
):

    if not PROPHET_OK:
        return {
            "error":
                "Prophet not installed"
        }

    if len(df) < 10:
        return {
            "error":
                f"Need 10+ days. Have {len(df)}"
        }

    try:

        pdf = df.rename(
            columns={
                "txn_date": "ds",
                "fraud_rate_pct": "y",
            }
        )[["ds", "y"]].copy()

        pdf["is_weekend"] = (
            df["is_weekend"].values
        )

        model = Prophet(
            changepoint_prior_scale=0.05,
            seasonality_prior_scale=10.0,
            weekly_seasonality=True,
            daily_seasonality=False,
            interval_width=0.80,
        )

        model.add_regressor(
            "is_weekend"
        )

        model.fit(pdf)

        future = model.make_future_dataframe(
            periods=horizon
        )

        future["is_weekend"] = (
            future["ds"]
            .dt.dayofweek >= 5
        ).astype(int)

        fc = model.predict(
            future
        ).tail(horizon)

        train_pred = model.predict(pdf)

        resid = (
            pdf["y"].values -
            train_pred["yhat"].values
        )

        std = float(np.std(resid))

        mae = float(
            mean_absolute_error(
                pdf["y"].values,
                train_pred["yhat"].values,
            )
        )

        preds = []

        for _, row in fc.iterrows():

            p = max(
                float(row["yhat"]),
                0,
            )

            preds.append({
                "date":
                    row["ds"].strftime("%Y-%m-%d"),

                "day_label":
                    row["ds"].strftime("%a %d %b"),

                "is_weekend":
                    bool(
                        row["ds"].dayofweek >= 5
                    ),

                "model":
                    "Prophet",

                "fraud_rate_pct":
                    round(p, 4),

                "upper_80":
                    round(
                        max(
                            float(row["yhat_upper"]),
                            0,
                        ),
                        4,
                    ),

                "lower_80":
                    round(
                        max(
                            float(row["yhat_lower"]),
                            0,
                        ),
                        4,
                    ),

                "upper_95":
                    round(
                        p + 1.96 * std,
                        4,
                    ),

                "lower_95":
                    round(
                        max(
                            p - 1.96 * std,
                            0,
                        ),
                        4,
                    ),

                **_exposure(p),
            })

        return {
            "model": "Prophet",
            "predictions": preds,
            "metrics": {
                "mae": round(mae, 4),
                "residual_std": round(std, 4),
            },
        }

    except Exception as e:
        return {
            "error": f"Prophet failed: {e}"
        }


# =========================================================
# SARIMA MODEL
# =========================================================

def _run_sarima(
    df: pd.DataFrame,
    horizon: int
):

    if not SARIMA_OK:
        return {
            "error":
                "statsmodels missing"
        }

    try:

        y = (
            df["fraud_rate_pct"]
            .values
            .astype(float)
        )

        mod = SARIMAX(
            y,
            order=(1, 1, 1),
            seasonal_order=(1, 0, 1, 7),
            enforce_stationarity=False,
            enforce_invertibility=False,
        )

        res = mod.fit(
            disp=False,
            maxiter=200,
        )

        fc = res.get_forecast(
            steps=horizon
        )

        mn = np.array(
            fc.predicted_mean
        )

        ci80 = fc.conf_int(
            alpha=0.20
        )

        ci80_arr = (
            ci80.values
            if hasattr(ci80, "values")
            else np.array(ci80)
        )

        fitted = np.array(
            res.fittedvalues
        )

        resid = np.array(
            res.resid
        )

        std = float(np.std(resid))

        mae = float(
            mean_absolute_error(
                y[1:],
                fitted[1:],
            )
        )

        fut = _future_rows(
            df,
            horizon,
        )

        preds = []

        for i, (_, row) in enumerate(
            fut.iterrows()
        ):

            p = max(
                float(mn[i]),
                0,
            )

            preds.append({
                "date":
                    row["txn_date"].strftime("%Y-%m-%d"),

                "day_label":
                    row["txn_date"].strftime("%a %d %b"),

                "is_weekend":
                    bool(row["is_weekend"]),

                "model":
                    "SARIMA",

                "fraud_rate_pct":
                    round(p, 4),

                "upper_80":
                    round(
                        max(
                            float(ci80_arr[i, 1]),
                            0,
                        ),
                        4,
                    ),

                "lower_80":
                    round(
                        max(
                            float(ci80_arr[i, 0]),
                            0,
                        ),
                        4,
                    ),

                **_exposure(p),
            })

        return {
            "model": "SARIMA",
            "predictions": preds,
            "metrics": {
                "mae": round(mae, 4),
                "residual_std":
                    round(std, 4),
            },
        }

    except Exception as e:
        return {
            "error": f"SARIMA failed: {e}"
        }


# =========================================================
# RIDGE MODEL
# =========================================================

def _run_ridge(
    df: pd.DataFrame,
    horizon: int
):

    FEATS = [
        "day_idx",
        "is_weekend",
        "day_of_week",
        "rolling_3d",
        "rolling_7d",
    ]

    try:

        X = df[FEATS].values

        y = (
            df["fraud_rate_pct"]
            .values
        )

        sc = StandardScaler()

        Xs = sc.fit_transform(X)

        model = Ridge(alpha=1.0)

        model.fit(Xs, y)

        yp = model.predict(Xs)

        std = float(
            np.std(y - yp)
        )

        fut = _future_rows(
            df,
            horizon,
        )

        Xf = sc.transform(
            fut[FEATS].values
        )

        raw = model.predict(Xf)

        preds = []

        for i, (_, row) in enumerate(
            fut.iterrows()
        ):

            p = max(
                float(raw[i]),
                0,
            )

            preds.append({
                "date":
                    row["txn_date"].strftime("%Y-%m-%d"),

                "day_label":
                    row["txn_date"].strftime("%a %d %b"),

                "is_weekend":
                    bool(row["is_weekend"]),

                "model":
                    "Ridge Regression",

                "fraud_rate_pct":
                    round(p, 4),

                **_ci(p, std),

                **_exposure(p),
            })

        return {
            "model":
                "Ridge Regression",

            "predictions":
                preds,
        }

    except Exception as e:
        return {
            "error":
                f"Ridge failed: {e}"
        }


# =========================================================
# ENSEMBLE
# =========================================================

def _ensemble(
    p: dict,
    s: dict,
    r: dict
):

    available = [
        x for x in [p, s, r]
        if "predictions" in x
    ]

    if not available:
        return {
            "error":
                "No predictions"
        }

    n = len(
        available[0]["predictions"]
    )

    preds = []

    for i in range(n):

        rate = np.mean([
            x["predictions"][i]
            ["fraud_rate_pct"]
            for x in available
        ])

        base = (
            available[0]
            ["predictions"][i]
        )

        preds.append({
            "date": base["date"],
            "day_label":
                base["day_label"],
            "is_weekend":
                base["is_weekend"],

            "model":
                "Ensemble",

            "fraud_rate_pct":
                round(rate, 4),

            **_exposure(rate),
        })

    return {
        "model":
            "Ensemble",

        "predictions":
            preds,
    }


# =========================================================
# HISTORY
# =========================================================

@router.get("/history")
def history():

    return fetch(f"""
        SELECT
            CAST(txn_date AS STRING)
                AS txn_date,

            SUM(txn_count)
                AS txn_count,

            SUM(fraud_count)
                AS fraud_count,

            ROUND(
                SUM(fraud_count)*100.0/
                NULLIF(SUM(txn_count),0),
                4
            ) AS fraud_rate_pct,

            ROUND(
                SUM(total_amount)/100000,
                2
            ) AS exposure_lakhs

        FROM {T['agg']}

        GROUP BY txn_date

        ORDER BY txn_date
    """)


# =========================================================
# FORECAST
# =========================================================

@router.get("/predict")
def predict(
    horizon: int = Query(
        default=7,
        ge=1,
        le=14,
    )
):

    df = _load_daily()

    if df.empty:
        return {
            "error":
                "Not enough data"
        }

    prophet = _run_prophet(
        df,
        horizon,
    )

    sarima = _run_sarima(
        df,
        horizon,
    )

    ridge = _run_ridge(
        df,
        horizon,
    )

    ensemble = _ensemble(
        prophet,
        sarima,
        ridge,
    )

    return {
        "models": {
            "prophet": prophet,
            "sarima": sarima,
            "ridge": ridge,
        },

        "ensemble": ensemble,
    }


# =========================================================
# MERCHANT TABLE
# =========================================================

@router.get("/merchants")
def merchants():

    return fetch(f"""
        SELECT
            merchant_id,
            merchant_category,
            primary_city,
            total_txns,
            fraud_txns,

            ROUND(fraud_rate, 2)
                AS fraud_rate_pct,

            ROUND(avg_risk_score, 1)
                AS avg_risk_score,

            ROUND(total_amount/100000, 1)
                AS total_amount_lakhs,

            risk_status

        FROM {T['merchants']}

        ORDER BY avg_risk_score DESC

        LIMIT 20
    """)


# =========================================================
# CITY RISK
# =========================================================

@router.get("/city-risk")
def city_risk():

    return fetch(f"""
        SELECT
            location_city,

            SUM(txn_count)
                AS txn_count,

            SUM(fraud_count)
                AS fraud_count,

            ROUND(
                SUM(fraud_count)*100.0/
                NULLIF(SUM(txn_count),0),
                2
            ) AS fraud_rate_pct,

            ROUND(
                SUM(total_amount)/100000,
                1
            ) AS exposure_lakhs

        FROM {T['agg']}

        GROUP BY location_city

        ORDER BY fraud_rate_pct DESC
    """)


# =========================================================
# SUSPECT CUSTOMERS
# =========================================================

@router.get("/suspect-customers")
def suspect_customers():

    return fetch(f"""
        SELECT
            customer_id,
            total_txns,
            fraud_txns,

            ROUND(avg_risk_score,1)
                AS avg_risk_score,

            account_age_days,
            unique_devices,
            unique_cities,

            ROUND(total_spend,2)
                AS total_spend,

            preferred_method,
            fraud_pattern

        FROM {T['accounts']}

        ORDER BY avg_risk_score DESC

        LIMIT 10
    """)


# =========================================================
# AI SUMMARY
# =========================================================

@router.get("/ai-summary")
def ai_summary():

    prediction = predict(7)

    prompt = f"""
    Analyze this fraud forecast.

    Forecast:
    {prediction}

    Explain:
    - fraud trend
    - weekend spikes
    - merchant risks
    - exposure concerns
    - operational actions

    Keep concise.
    """

    summary = _ask_llm(prompt)

    return {
        "forecast": prediction,
        "ai_summary": summary,
    }


# =========================================================
# MERCHANT AI
# =========================================================

@router.get("/merchant-ai/{merchant_id}")
def merchant_ai(merchant_id: str):

    rows = fetch(f"""
        SELECT *
        FROM {T['merchants']}
        WHERE merchant_id = '{merchant_id}'
    """)

    if not rows:
        return {
            "error":
                "Merchant not found"
        }

    merchant = rows[0]

    prompt = f"""
    Analyze this merchant.

    Data:
    {merchant}

    Explain:
    - fraud severity
    - suspicious indicators
    - operational risk
    - recommendations
    """

    analysis = _ask_llm(prompt)

    return {
        "merchant": merchant,
        "analysis": analysis,
    }


# =========================================================
# CITY AI
# =========================================================

@router.get("/city-ai/{city}")
def city_ai(city: str):

    rows = fetch(f"""
        SELECT
            location_city,

            SUM(txn_count)
                AS txn_count,

            SUM(fraud_count)
                AS fraud_count,

            ROUND(
                SUM(fraud_count)*100.0/
                NULLIF(SUM(txn_count),0),
                2
            ) AS fraud_rate_pct,

            ROUND(
                SUM(total_amount)/100000,
                2
            ) AS exposure_lakhs

        FROM {T['agg']}

        WHERE location_city = '{city}'

        GROUP BY location_city
    """)

    if not rows:
        return {
            "error":
                "City not found"
        }

    city_data = rows[0]

    prompt = f"""
    Analyze this city fraud profile.

    Data:
    {city_data}

    Explain:
    - risk trend
    - likely causes
    - fraud patterns
    - monitoring actions
    """

    analysis = _ask_llm(prompt)

    return {
        "city": city_data,
        "analysis": analysis,
    }


# =========================================================
# CUSTOMER AI
# =========================================================

@router.get("/customer-ai/{customer_id}")
def customer_ai(customer_id: str):

    rows = fetch(f"""
        SELECT *
        FROM {T['accounts']}
        WHERE customer_id = '{customer_id}'
    """)

    if not rows:
        return {
            "error":
                "Customer not found"
        }

    customer = rows[0]

    prompt = f"""
    Analyze this customer fraud profile.

    Data:
    {customer}

    Explain:
    - fraud probability
    - account takeover signals
    - bust-out indicators
    - suspicious behavior
    - recommended actions
    """

    analysis = _ask_llm(prompt)

    return {
        "customer": customer,
        "analysis": analysis,
    }
@router.get("/model-comparison")
def model_comparison():

    df = _load_daily()

    if df.empty or len(df) < 5:
        return {
            "error": "Not enough data"
        }

    p = _run_prophet(df, 7)
    s = _run_sarima(df, 7)
    r = _run_ridge(df, 7)

    out = []

    for name, res in [
        ("Prophet", p),
        ("SARIMA", s),
        ("Ridge Regression", r),
    ]:

        if "metrics" in res:

            out.append({
                "model": name,
                "available": True,
                "description": res.get(
                    "description",
                    ""
                ),

                **res["metrics"],
            })

        else:

            out.append({
                "model": name,
                "available": False,
                "error": res.get(
                    "error",
                    ""
                ),
            })

    return {
        "models": out,
        "data_points": len(df),
    }

# =========================================================
# GENIE CHAT
# =========================================================

@router.post("/genie")
def genie(payload: dict):

    question = payload.get(
        "question"
    )

    if not question:
        return {
            "error":
                "Question required"
        }

    result = ask_genie(question)

    return {
        "question": question,
        "response": result,
    }