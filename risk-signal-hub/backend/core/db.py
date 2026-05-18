from databricks import sql
from core.config import (
    DATABRICKS_HOST,
    SQL_WAREHOUSE_ID,
    _auth_token,
)


def _conn():
    return sql.connect(
        server_hostname=DATABRICKS_HOST.replace("https://", ""),
        http_path=f"/sql/1.0/warehouses/{SQL_WAREHOUSE_ID}",
        access_token=_auth_token(),
    )


def fetch(query: str) -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]


def execute(query: str) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            conn.commit()