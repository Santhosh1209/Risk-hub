import httpx
import time
from core.config import DATABRICKS_HOST, DATABRICKS_TOKEN, GENIE_SPACE_ID
from core.db import fetch

BASE    = f"{DATABRICKS_HOST}/api/2.0/genie/spaces/{GENIE_SPACE_ID}"
HEADERS = {
    "Authorization": f"Bearer {DATABRICKS_TOKEN}",
    "Content-Type":  "application/json",
}


def _cell_value(cell):
    if isinstance(cell, dict):
        for key in ("str", "string_value", "value", "long", "double", "boolean", "timestamp"):
            if cell.get(key) is not None:
                return cell[key]
        if "array_value" in cell:
            return cell["array_value"]
        return ""
    return cell


def _column_names(payload: dict) -> list[str]:
    candidates = [
        payload.get("columns"),
        payload.get("schema", {}).get("columns"),
        payload.get("manifest", {}).get("schema", {}).get("columns"),
        payload.get("statement_response", {}).get("manifest", {}).get("schema", {}).get("columns"),
    ]
    for columns in candidates:
        if columns:
            return [
                col.get("name") if isinstance(col, dict) else str(col)
                for col in columns
            ]
    return []


def _result_rows(payload: dict) -> list:
    candidates = [
        payload.get("data_typed_array"),
        payload.get("data_array"),
        payload.get("result", {}).get("data_typed_array"),
        payload.get("result", {}).get("data_array"),
        payload.get("statement_response", {}).get("result", {}).get("data_typed_array"),
        payload.get("statement_response", {}).get("result", {}).get("data_array"),
    ]
    for rows in candidates:
        if rows:
            return rows
    return []


def _rows_from_payload(payload: dict) -> list[dict]:
    cols = _column_names(payload)
    raw_rows = _result_rows(payload)
    if not raw_rows:
        return []

    rows = []
    for raw in raw_rows:
        if isinstance(raw, dict):
            rows.append({k: _cell_value(v) for k, v in raw.items()})
            continue

        values = [_cell_value(cell) for cell in raw]
        if not cols:
            cols = [f"col_{i + 1}" for i in range(len(values))]
        rows.append(dict(zip(cols, values)))
    return rows


def _extract_text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        content = value.get("content") or value.get("text") or value.get("value")
        if isinstance(content, list):
            return "\n".join(str(item) for item in content)
        return str(content or "")
    if isinstance(value, list):
        return "\n".join(str(item) for item in value)
    return ""


def _extract_sql(query) -> str:
    if isinstance(query, str):
        return query
    if isinstance(query, dict):
        sql = query.get("query") or query.get("sql") or query.get("statement")
        if isinstance(sql, list):
            return "".join(sql)
        return str(sql or "")
    return ""


def _fetch_attachment_result(conv_id: str, msg_id: str, attachment_id: str) -> dict:
    paths = [
        f"{BASE}/conversations/{conv_id}/messages/{msg_id}/attachments/{attachment_id}/query-result",
        f"{BASE}/conversations/{conv_id}/messages/{msg_id}/query-result/{attachment_id}",
    ]
    last_error = None
    for url in paths:
        try:
            r = httpx.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 404:
                continue
            r.raise_for_status()
            return r.json()
        except Exception as ex:
            last_error = ex
    if last_error:
        return {"error": str(last_error)}
    return {}


def ask(question: str) -> dict:
    r = httpx.post(
        f"{BASE}/start-conversation",
        headers=HEADERS,
        json={"content": question},
        timeout=15,
    )
    r.raise_for_status()
    d = r.json()
    conversation_id = d.get("conversation_id") or d.get("conversation", {}).get("id")
    message_id = d.get("message_id") or d.get("message", {}).get("id")
    return _poll(conversation_id, message_id)


def _can_fetch_sql(sql: str) -> bool:
    normalized = sql.strip().lower()
    return normalized.startswith(("select", "with", "show", "describe"))


def _fetch_sql_rows(sql: str) -> list[dict]:
    if not sql or not _can_fetch_sql(sql):
        return []
    try:
        return fetch(sql)
    except Exception:
        return []


def _poll(conv_id: str, msg_id: str, max_wait: int = 25) -> dict:
    deadline = time.time() + max_wait
    while time.time() < deadline:
        r = httpx.get(
            f"{BASE}/conversations/{conv_id}/messages/{msg_id}",
            headers=HEADERS,
            timeout=10,
        )
        d = r.json()
        state = d.get("status", "")

        if state == "COMPLETED":
            sql_q, rows, summary = "", [], ""
            for att in d.get("attachments") or []:
                if "query" in att:
                    sql_q = _extract_sql(att.get("query")) or sql_q

                if "text" in att:
                    summary = _extract_text(att.get("text")) or summary

                inline_rows = _rows_from_payload(att.get("result", {})) or _rows_from_payload(att)
                if inline_rows:
                    rows = inline_rows

                attachment_id = att.get("attachment_id") or att.get("id")
                if attachment_id and "query" in att:
                    result_payload = _fetch_attachment_result(conv_id, msg_id, attachment_id)
                    result_rows = _rows_from_payload(result_payload)
                    if result_rows:
                        rows = result_rows

            if not rows:
                rows = (
                    _rows_from_payload(d.get("query_result") or {})
                    or _rows_from_payload(d.get("result") or {})
                    or _fetch_sql_rows(sql_q)
                )
            return {"status": "ok", "sql": sql_q, "data": rows, "summary": summary}

        if state in {"FAILED", "CANCELLED"}:
            return {"status": "error", "error": d.get("error", "Genie failed")}

        time.sleep(1)

    return {"status": "error", "error": "Genie timed out"}
