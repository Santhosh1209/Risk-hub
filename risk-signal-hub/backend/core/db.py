from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState, Disposition
from core.config import SQL_WAREHOUSE_ID


def _wc() -> WorkspaceClient:
    return WorkspaceClient()


def fetch(query: str) -> list[dict]:
    w = _wc()
    resp = w.statement_execution.execute_statement(
        statement=query,
        warehouse_id=SQL_WAREHOUSE_ID,
        wait_timeout="50s",
        disposition=Disposition.INLINE,
    )
    if resp.status.state != StatementState.SUCCEEDED:
        err = resp.status.error
        raise RuntimeError(
            f"Query failed [{resp.status.state}]: "
            f"{err.message if err else 'unknown error'}"
        )
    if not resp.result or not resp.result.data_array:
        return []
    cols = [c.name for c in resp.manifest.schema.columns]
    return [dict(zip(cols, row)) for row in resp.result.data_array]


def execute(query: str) -> None:
    w = _wc()
    resp = w.statement_execution.execute_statement(
        statement=query,
        warehouse_id=SQL_WAREHOUSE_ID,
        wait_timeout="50s",
    )
    if resp.status.state not in (StatementState.SUCCEEDED,):
        err = resp.status.error
        raise RuntimeError(
            f"Query failed [{resp.status.state}]: "
            f"{err.message if err else 'unknown error'}"
        )
