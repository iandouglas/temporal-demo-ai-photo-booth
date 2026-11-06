"""Lead capture activities shared by every Holodeck demo (docs/lead-capture.md).

``save_lead`` writes to local SQLite first so nothing is lost if the network
drops. Central sync (DynamoDB) is handled by the project-wide lead worker.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from temporalio import activity

from ..config import settings

DB_PATH = settings.data_dir / "leads.sqlite"


@dataclass
class Lead:
    email: str
    demo: str
    station: str
    consent_text_version: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    captured_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    extra: str = ""  # JSON blob: role, genre, etc.


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS leads (
            id TEXT PRIMARY KEY, email TEXT NOT NULL, demo TEXT, station TEXT,
            consent_text_version TEXT, captured_at TEXT, synced_at TEXT, extra TEXT)"""
    )
    return conn


@activity.defn
async def save_lead(lead: Lead) -> str:
    """Idempotent on lead.id, so Temporal retries never duplicate a lead."""
    with _conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO leads (id, email, demo, station, consent_text_version, captured_at, extra)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (lead.id, lead.email, lead.demo, lead.station, lead.consent_text_version, lead.captured_at, lead.extra),
        )
    return lead.id
