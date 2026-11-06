"""HTTP API for the Holo-Booth UI.

Capture is local-first: photo + email are written to disk and the spool
before anything touches the network, so a Temporal Cloud or Wi-Fi outage
never loses a visitor's strip.
"""

from __future__ import annotations

import asyncio
import base64
import dataclasses
import io
import logging
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from PIL import Image, ImageOps
from pydantic import BaseModel

from ..config import settings
from ..temporal_client import get_client, wf_id
from .analysis import analyze, resolve_analysis_provider
from .providers import resolve_provider_name
from .spool import Spool
from .workflows import PhotoBoothInput, PhotoBoothWorkflow

log = logging.getLogger(__name__)
spool = Spool(settings.data_dir / "photobooth_spool.sqlite")
START_TIMEOUT = timedelta(seconds=4)


async def start_workflow(workflow_id: str, inp: PhotoBoothInput) -> None:
    client = await asyncio.wait_for(get_client(), START_TIMEOUT.total_seconds())
    await client.start_workflow(PhotoBoothWorkflow.run, inp, id=workflow_id, task_queue=settings.task_queue,
                                rpc_timeout=START_TIMEOUT)


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(spool.drain_forever(start_workflow))
    try:
        yield
    finally:
        task.cancel()


router = APIRouter(prefix="/photobooth", tags=["photobooth"], lifespan=lifespan)

_SID = re.compile(r"^[a-f0-9]{10}$")
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}")


class AnalyzeRequest(BaseModel):
    image: str


class StartRequest(BaseModel):
    image: str  # data URL or raw base64 JPEG/PNG
    email: str
    consent_text_version: str = ""


def _station(x_station: str | None) -> str:
    return x_station if x_station and re.fullmatch(r"[\w-]{1,16}", x_station) else settings.station


def _decode(data: str) -> Image.Image:
    raw = data.split(",", 1)[1] if data.startswith("data:") else data
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(raw)))).convert("RGB")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"not an image: {e}") from e
    img.thumbnail((1024, 1024))
    return img


@router.post("/analyze")
async def analyze_now(req: AnalyzeRequest) -> dict:
    """Quick check at review time. Best effort: on timeout or error the UI just carries on
    (the workflow runs its own analysis and copes with unusable photos)."""
    buf = io.BytesIO()
    _decode(req.image).save(buf, "JPEG", quality=85)
    try:
        a = await asyncio.wait_for(asyncio.to_thread(analyze, buf.getvalue(), resolve_analysis_provider()), 3.5)
    except Exception as e:  # noqa: BLE001
        return {"checked": False, "error": type(e).__name__}
    return {"checked": True, **dataclasses.asdict(a)}


@router.post("/sessions")
async def start_session(req: StartRequest, x_station: str | None = Header(default=None)) -> dict:
    station = _station(x_station)
    email = req.email.strip().lower()
    if not _EMAIL.fullmatch(email):
        raise HTTPException(400, "invalid email")
    img = _decode(req.image)

    # 1. Local first: photo to disk, request to the spool.
    session_id = uuid.uuid4().hex[:10]
    rel_dir = f"photobooth/{session_id}"
    (settings.media_dir / rel_dir).mkdir(parents=True, exist_ok=True)
    photo_rel = f"{rel_dir}/capture.jpg"
    img.save(settings.media_dir / photo_rel, "JPEG", quality=92)
    inp = PhotoBoothInput(
        session_id=session_id, station=station, photo_path=photo_rel, email=email,
        consent_text_version=req.consent_text_version, provider=resolve_provider_name(),
        analysis_provider=resolve_analysis_provider(),
        style=settings.photobooth_style if settings.photobooth_style in ("inspired", "photo") else "inspired",
        public_base_url=settings.public_base_url, captured_at=datetime.now(timezone.utc).isoformat())
    workflow_id = wf_id("photobooth", session_id, station)
    spool.add(workflow_id, inp)

    # 2. Then try the network. Failure is fine: the spool drainer keeps trying.
    row = spool.get(session_id)
    started = bool(row) and await spool.try_start(row, start_workflow)
    if not started:
        log.warning("photo booth session %s spooled; Temporal unreachable", session_id)
    return {"session_id": session_id, "workflow_id": workflow_id, "spooled": not started, "provider": inp.provider}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    if not _SID.match(session_id):
        raise HTTPException(400, "bad session id")
    row = spool.get(session_id)
    if not row:
        raise HTTPException(404, "unknown session")
    base = {"session_id": session_id, "workflow_id": row.workflow_id, "email": row.input.email}
    if not row.started_at:
        return {**base, "stage": "spooled", "steps": []}
    try:
        handle = (await asyncio.wait_for(get_client(), 3)).get_workflow_handle(row.workflow_id)
        status, desc = await asyncio.wait_for(asyncio.gather(handle.query(PhotoBoothWorkflow.status),
                                                             handle.describe()), 4)
    except Exception as e:  # noqa: BLE001 - network or worker trouble: the UI shows "we'll email it"
        return {**base, "stage": "unreachable", "steps": [], "error": type(e).__name__}

    out = {**base, **dataclasses.asdict(status), "workflow_status": desc.status.name if desc.status else None}
    # Overlay live retry info from pending activities (attempt counts, last error).
    steps = {s["key"]: s for s in out["steps"]}
    for pa in desc.raw_description.pending_activities:
        key = re.sub(r"-(soft|fallback)$", "", pa.activity_id)
        step = steps.get(key)
        if not step or step["state"] == "done":
            continue
        step["attempts"] = pa.attempt
        if pa.attempt > 1:
            step["state"] = "retrying"
            step["detail"] = pa.last_failure.message or step["detail"]
    return out
