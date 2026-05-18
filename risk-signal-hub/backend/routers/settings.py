from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from core.db import fetch, execute
from core.config import CATALOG, SCHEMA
from core.agent import run as agent_run
from core.genie import ask as genie_ask

router = APIRouter(prefix="/settings", tags=["settings"])

SETTINGS_TABLE = f"{CATALOG}.{SCHEMA}.settings"

# ── in-memory fallback defaults ──────────────────────────────────────────────
_DEFAULT_THRESHOLDS = {
    "upi_block_score":        85,
    "card_block_score":       80,
    "velocity_txn_per_10min": 5,
    "new_account_txn_per_hr": 5,
}

_DEFAULT_ALERTS = {
    "slack_enabled":          True,
    "email_digest_hourly":    True,
    "sms_critical":           True,
    "auto_escalate_30min":    False,
    "weekend_oncall":         True,
}

_DEFAULT_PLAYBOOKS = [
    {
        "playbook_id": "ATO_RESPONSE",
        "name":        "ATO Response",
        "description": "Account takeover detection and containment playbook",
        "steps":       "1. Detect unusual login + txn pattern\n2. Freeze account\n3. Alert customer\n4. Force password reset\n5. Review last 24h transactions",
    },
    {
        "playbook_id": "WEEKEND_SURGE",
        "name":        "Weekend Surge",
        "description": "Weekend transaction volume spike response",
        "steps":       "1. Activate weekend on-call team\n2. Lower block thresholds by 5 points\n3. Enable SMS alerts for CRITICAL\n4. Review merchant-level surges hourly",
    },
    {
        "playbook_id": "NEW_AGGREGATOR_RISK",
        "name":        "New Aggregator Risk",
        "description": "Risk management for newly onboarded payment aggregators",
        "steps":       "1. Cap daily transaction volume\n2. Enable enhanced monitoring for 30 days\n3. Require manual review for txns > $50,000\n4. Daily risk score review",
    },
]

# ── safe DB helpers ───────────────────────────────────────────────────────────

def _read_setting(key: str, default):
    try:
        rows = fetch(f"SELECT value FROM {SETTINGS_TABLE} WHERE key = '{key}'")
        if rows:
            raw = rows[0]["value"]
            if isinstance(default, bool):
                return str(raw).lower() in ("1", "true", "yes")
            if isinstance(default, int):
                return int(raw)
            return raw
    except Exception:
        pass
    return default


def _write_setting(key: str, value) -> None:
    try:
        str_val = str(value).lower() if isinstance(value, bool) else str(value)
        existing = fetch(f"SELECT key FROM {SETTINGS_TABLE} WHERE key = '{key}'")
        if existing:
            execute(f"UPDATE {SETTINGS_TABLE} SET value = '{str_val}' WHERE key = '{key}'")
        else:
            execute(f"INSERT INTO {SETTINGS_TABLE} (key, value) VALUES ('{key}', '{str_val}')")
    except Exception:
        pass


# ── thresholds ────────────────────────────────────────────────────────────────

@router.get("/thresholds")
def get_thresholds():
    return {k: _read_setting(k, v) for k, v in _DEFAULT_THRESHOLDS.items()}


class ThresholdsReq(BaseModel):
    upi_block_score:        Optional[int] = None
    card_block_score:       Optional[int] = None
    velocity_txn_per_10min: Optional[int] = None
    new_account_txn_per_hr: Optional[int] = None


@router.post("/thresholds")
def save_thresholds(req: ThresholdsReq):
    data = req.model_dump(exclude_none=True)
    for key, value in data.items():
        _write_setting(key, value)
    return {"status": "ok", "saved": data}


# ── alert routing ─────────────────────────────────────────────────────────────

@router.get("/alerts")
def get_alerts():
    return {k: _read_setting(k, v) for k, v in _DEFAULT_ALERTS.items()}


class AlertsReq(BaseModel):
    slack_enabled:       Optional[bool] = None
    email_digest_hourly: Optional[bool] = None
    sms_critical:        Optional[bool] = None
    auto_escalate_30min: Optional[bool] = None
    weekend_oncall:      Optional[bool] = None


@router.post("/alerts")
def save_alerts(req: AlertsReq):
    data = req.model_dump(exclude_none=True)
    for key, value in data.items():
        _write_setting(key, value)
    return {"status": "ok", "saved": data}


# ── playbooks ─────────────────────────────────────────────────────────────────

@router.get("/playbooks")
def get_playbooks():
    try:
        rows = fetch(f"""
            SELECT playbook_id, name, description, steps
            FROM {SETTINGS_TABLE}_playbooks
            ORDER BY name
        """)
        if rows:
            return rows
    except Exception:
        pass
    return _DEFAULT_PLAYBOOKS


class PlaybookAskReq(BaseModel):
    playbook_id: str
    name:        str
    question:    str
    context:     str = ""


@router.post("/playbooks/ask")
def playbook_ask(req: PlaybookAskReq):
    genie  = genie_ask(req.question)
    answer = agent_run(req.question, context=req.context)
    return {"answer": answer, "genie": genie}


class CreatePlaybookReq(BaseModel):
    description: str


@router.post("/playbooks/create")
def create_playbook(req: CreatePlaybookReq):
    prompt = (
        f"Create a detailed fraud operations playbook based on this description: {req.description}. "
        f"Output exactly these sections:\n"
        f"## Playbook Name\n"
        f"A concise name (3-5 words).\n\n"
        f"## Trigger Conditions\n"
        f"What signals or events trigger this playbook. Be specific.\n\n"
        f"## Response Steps\n"
        f"Numbered list of exactly 5-7 steps the fraud operations team should take.\n\n"
        f"## Success Metrics\n"
        f"How to measure if the playbook is working. 3-4 bullet points."
    )
    answer = agent_run(prompt, context=req.description)
    return {"answer": answer}


# ── simulate thresholds ───────────────────────────────────────────────────────

class SimulateReq(BaseModel):
    upi_block_score:        int
    card_block_score:       int
    velocity_txn_per_10min: int
    new_account_txn_per_hr: int


@router.post("/simulate")
def simulate_thresholds(req: SimulateReq):
    prompt = (
        f"Simulate the impact of these risk threshold changes on fraud operations:\n"
        f"- UPI block score threshold: {req.upi_block_score} (default 85)\n"
        f"- Card block score threshold: {req.card_block_score} (default 80)\n"
        f"- Max velocity per 10 minutes: {req.velocity_txn_per_10min} transactions (default 5)\n"
        f"- Max new account transactions per hour: {req.new_account_txn_per_hr} (default 5)\n\n"
        f"Query risk_hub.fraud.risk_events to get today's transaction data and output exactly:\n\n"
        f"## Impact Summary\n"
        f"How many more or fewer transactions would be blocked vs current thresholds. "
        f"Include $ exposure amounts.\n\n"
        f"## Trade-off Analysis\n"
        f"For each changed threshold: fraud caught vs false positive rate change."
    )
    genie  = genie_ask(prompt)
    answer = agent_run(prompt)
    return {"answer": answer, "genie": genie}
