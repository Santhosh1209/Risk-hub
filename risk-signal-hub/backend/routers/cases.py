from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from core.db import fetch, execute
from core.config import T, GMAIL_SENDER, GMAIL_APP_PASS
from core.agent import run_sections as agent_run
from core.genie import ask as genie_ask
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

router = APIRouter(prefix="/cases", tags=["cases"])

CASES_TABLE = T["cases"]

SEV_ORDER = "CASE UPPER(severity) WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END"


@router.get("/")
def get_cases(status: Optional[str] = None):
    where = ""
    if status and status.lower() != "all":
        safe = status.replace("'", "''")
        where = f"WHERE LOWER(status) = LOWER('{safe}')"
    return fetch(f"""
        SELECT
            case_id,
            title,
            severity,
            status,
            exposure_amt,
            merchant_id,
            notes,
            CAST(created_at AS STRING) AS created_at
        FROM {CASES_TABLE}
        {where}
        ORDER BY {SEV_ORDER}, created_at DESC
    """)


@router.get("/counts")
def get_counts():
    rows = fetch(f"""
        SELECT LOWER(status) AS status, COUNT(*) AS cnt
        FROM {CASES_TABLE}
        GROUP BY LOWER(status)
    """)
    counts = {r["status"]: int(r["cnt"] or 0) for r in rows}
    return {"all": sum(counts.values()), **counts}


class StatusReq(BaseModel):
    status: str


@router.post("/{case_id}/status")
def update_status(case_id: str, req: StatusReq):
    safe_id     = case_id.replace("'", "''")
    safe_status = req.status.replace("'", "''")
    execute(f"""
        UPDATE {CASES_TABLE}
        SET status = '{safe_status}'
        WHERE case_id = '{safe_id}'
    """)
    return {"status": "ok", "case_id": case_id, "new_status": req.status}


class NotesReq(BaseModel):
    notes: str


@router.post("/{case_id}/notes")
def update_notes(case_id: str, req: NotesReq):
    safe_id    = case_id.replace("'", "''")
    safe_notes = req.notes.replace("'", "''")
    execute(f"""
        UPDATE {CASES_TABLE}
        SET notes = '{safe_notes}'
        WHERE case_id = '{safe_id}'
    """)
    return {"status": "ok", "case_id": case_id}


class AskReq(BaseModel):
    question: str
    context:  str = ""


@router.post("/ask")
def ask(req: AskReq):
    genie  = genie_ask(req.question)
    answer = agent_run(req.question, context=req.context)
    return {"answer": answer, "genie": genie}


class EmailReq(BaseModel):
    to: List[str]
    subject: str
    body: str


@router.post("/send-email")
def send_email(req: EmailReq):
    if not GMAIL_SENDER or not GMAIL_APP_PASS:
        raise HTTPException(
            status_code=500,
            detail="GMAIL_SENDER or GMAIL_APP_PASS not set in environment."
        )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = req.subject
    msg["From"]    = GMAIL_SENDER
    msg["To"]      = ", ".join(req.to)
    msg.attach(MIMEText(req.body, "plain"))

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.ehlo()
            server.starttls(context=ctx)
            server.login(GMAIL_SENDER, GMAIL_APP_PASS)
            server.sendmail(GMAIL_SENDER, req.to, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(
            status_code=401,
            detail="Gmail authentication failed. Check GMAIL_SENDER and GMAIL_APP_PASS."
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {"status": "sent", "to": req.to}
