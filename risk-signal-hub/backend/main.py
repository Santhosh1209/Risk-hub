from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import dashboard, forecast
from routers.agent import router as agent_router
from routers.cases import router as cases_router
from routers.genie import router as genie_router
from routers.network import router as network_router
from routers.rules import router as rules_router
from routers.settings import router as settings_router
from routers.reports import router as report_router

app = FastAPI(
    title="Risk Signal Hub API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(network_router)
app.include_router(cases_router)
app.include_router(rules_router)
app.include_router(settings_router)
app.include_router(dashboard.router)
app.include_router(forecast.router)
app.include_router(genie_router)
app.include_router(agent_router)
app.include_router(report_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "1.0.0",
    }
