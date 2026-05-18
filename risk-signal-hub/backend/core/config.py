import os
from dotenv import load_dotenv

load_dotenv()

DATABRICKS_HOST  = os.environ["DATABRICKS_HOST"]
# On Databricks Apps, token auth is replaced by the app's service principal
# (DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET). Fall back to empty so
# the SDK can pick up credentials automatically via its default auth chain.
DATABRICKS_TOKEN = os.environ.get("DATABRICKS_TOKEN", "")
SQL_WAREHOUSE_ID = os.environ["SQL_WAREHOUSE_ID"]
GENIE_SPACE_ID   = os.environ["GENIE_SPACE_ID"]
CATALOG          = os.environ.get("CATALOG", "risk_hub")
SCHEMA           = os.environ.get("SCHEMA", "fraud")

T = {
    "events":    f"{CATALOG}.{SCHEMA}.risk_events",
    "agg":       f"{CATALOG}.{SCHEMA}.risk_signals_agg",
    "merchants": f"{CATALOG}.{SCHEMA}.merchant_risk_profiles",
    "accounts":  f"{CATALOG}.{SCHEMA}.account_risk_features",
    "cases":     f"{CATALOG}.{SCHEMA}.cases",
}
AI_ENDPOINT = f"https://{DATABRICKS_HOST}/serving-endpoints/databricks-meta-llama-3-3-70b-instruct/invocations"

def _auth_token() -> str:
    if DATABRICKS_TOKEN:
        return DATABRICKS_TOKEN
    try:
        from databricks.sdk import WorkspaceClient
        headers = WorkspaceClient().config.authenticate()
        return headers.get("Authorization", "Bearer ").removeprefix("Bearer ")
    except Exception:
        return ""

AI_HEADERS = {
    "Authorization": f"Bearer {_auth_token()}",
    "Content-Type":  "application/json",
}

GMAIL_SENDER   = os.environ.get("GMAIL_SENDER", "")
GMAIL_APP_PASS = os.environ.get("GMAIL_APP_PASS", "")