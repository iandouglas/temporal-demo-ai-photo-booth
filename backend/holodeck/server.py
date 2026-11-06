"""Small API server the Holodeck web UIs talk to. Starts workflows, sends
signals/updates, and reads workflow state via queries."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import registry
from .config import settings

app = FastAPI(title="Holodeck API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

for r in registry.routers():
    app.include_router(r, prefix="/api")

app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")

@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "station": settings.station, "task_queue": settings.task_queue}
