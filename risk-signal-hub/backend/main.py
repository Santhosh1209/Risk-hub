import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

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

app.include_router(network_router,   prefix="/api")
app.include_router(cases_router,     prefix="/api")
app.include_router(rules_router,     prefix="/api")
app.include_router(settings_router,  prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(forecast.router,  prefix="/api")
app.include_router(genie_router,     prefix="/api")
app.include_router(agent_router,     prefix="/api")
app.include_router(report_router,    prefix="/api")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "1.0.0",
    }


# ── serve React build (production / Databricks Apps) ──────────────────────
DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.isdir(DIST):
    @app.get("/")
    async def serve_root():
        return FileResponse(os.path.join(DIST, "index.html"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file = os.path.join(DIST, full_path)
        if os.path.isfile(file):
            return FileResponse(file)
        return FileResponse(os.path.join(DIST, "index.html"))
