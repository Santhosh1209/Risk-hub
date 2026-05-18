"""
Run this once to create the rule_engine table in Databricks and seed it with 4 rules.

    cd backend
    python setup_rule_engine.py
"""
from core.db import execute, fetch
from core.config import CATALOG, SCHEMA

TABLE = f"{CATALOG}.{SCHEMA}.rule_engine"


CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    rule_id              STRING      NOT NULL,
    rule_name            STRING      NOT NULL,
    description          STRING,
    channel              STRING,
    merchant_category    STRING,
    risk_score_threshold INT,
    time_window_start    INT,
    time_window_end      INT,
    account_age_max_days INT,
    is_active            BOOLEAN,
    status               STRING,
    created_at           TIMESTAMP,
    updated_at           TIMESTAMP
)
USING DELTA
COMMENT 'Fraud rule engine — stores active and draft rule configurations'
"""

# 4 seed rules matching the Risk Signal Hub mockup
RULES = [
    {
        "rule_id":              "RULE-001",
        "rule_name":            "UPI High Risk Score Block",
        "description":          "Block UPI transactions where risk_score exceeds threshold — catches ATO and synthetic identity fraud",
        "channel":              "UPI",
        "merchant_category":    None,
        "risk_score_threshold": 85,
        "time_window_start":    None,
        "time_window_end":      None,
        "account_age_max_days": None,
        "is_active":            True,
        "status":               "active",
    },
    {
        "rule_id":              "RULE-002",
        "rule_name":            "New Account Velocity Limit",
        "description":          "Flag new accounts (< 7 days old) with elevated risk score — targets velocity-abuse rings using freshly created accounts",
        "channel":              "ALL",
        "merchant_category":    None,
        "risk_score_threshold": 70,
        "time_window_start":    None,
        "time_window_end":      None,
        "account_age_max_days": 7,
        "is_active":            True,
        "status":               "active",
    },
    {
        "rule_id":              "RULE-003",
        "rule_name":            "Food Delivery Night Block",
        "description":          "Block high-risk food delivery transactions between 22:00–06:00 — addresses peak ATO-driven order fraud hours",
        "channel":              "ALL",
        "merchant_category":    "food_delivery",
        "risk_score_threshold": 70,
        "time_window_start":    22,
        "time_window_end":      6,
        "account_age_max_days": None,
        "is_active":            False,
        "status":               "draft",
    },
    {
        "rule_id":              "RULE-004",
        "rule_name":            "Multi-Device Young Account Block",
        "description":          "Flag young accounts (< 30 days) with high risk scores — targets device-farm and mule account fraud rings",
        "channel":              "ALL",
        "merchant_category":    None,
        "risk_score_threshold": 75,
        "time_window_start":    None,
        "time_window_end":      None,
        "account_age_max_days": 30,
        "is_active":            True,
        "status":               "active",
    },
]


def _val(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return f"'{v}'"


def main():
    print(f"Creating table {TABLE} …")
    execute(CREATE_SQL)
    print("  Table created (or already exists).")

    # Only insert if table is empty
    existing = fetch(f"SELECT rule_id FROM {TABLE} LIMIT 1")
    if existing:
        print(f"  Table already has rows — skipping seed. "
              "Delete rows first if you want to re-seed.")
        return

    print("  Seeding 4 rules …")
    for r in RULES:
        cols = ", ".join(r.keys())
        vals = ", ".join(_val(v) for v in r.values())
        execute(f"""
            INSERT INTO {TABLE} ({cols}, created_at, updated_at)
            VALUES ({vals}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """)
        print(f"    Inserted {r['rule_id']} — {r['rule_name']}")

    print("\nDone. Rule engine is ready.")
    rows = fetch(f"SELECT rule_id, rule_name, status FROM {TABLE} ORDER BY rule_id")
    for row in rows:
        print(f"  {row['rule_id']}  [{row['status']}]  {row['rule_name']}")


if __name__ == "__main__":
    main()
