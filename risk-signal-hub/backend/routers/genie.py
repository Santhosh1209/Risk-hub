from fastapi import APIRouter
from pydantic import BaseModel
from core.genie import ask

router = APIRouter(prefix="/genie", tags=["genie"])


class GenieReq(BaseModel):
    question: str


@router.post("/ask")
def genie_ask(req: GenieReq):
    return ask(req.question)