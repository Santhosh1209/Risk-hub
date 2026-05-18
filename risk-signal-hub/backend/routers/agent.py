from fastapi import APIRouter
from pydantic import BaseModel
from core.agent import run

router = APIRouter(prefix="/agent", tags=["agent"])


class AgentReq(BaseModel):
    question: str
    context:  str = ""


@router.post("/ask")
def agent_ask(req: AgentReq):
    answer, genie = run(req.question, req.context)
    return {"answer": answer, "genie": genie}
