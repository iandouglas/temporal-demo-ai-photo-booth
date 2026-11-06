"""Local spool: the booth's promise to the visitor survives the network.

The API writes every capture (photo on disk + workflow input here) BEFORE it
touches the network, then tries to start the workflow. If Temporal is
unreachable, a background task keeps retrying pending rows until each one is
started, including across API restarts. Starting is idempotent because the
workflow ID is derived from the session ID.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable, Callable

from temporalio.exceptions import WorkflowAlreadyStartedError

from .workflows import PhotoBoothInput

log = logging.getLogger(__name__)

StartFn = Callable[[str, PhotoBoothInput], Awaitable[None]]


@dataclasses.dataclass
class SpoolRow:
    session_id: str
    workflow_id: str
    input: PhotoBoothInput
    created_at: str
    started_at: str | None
    attempts: int
    last_error: str | None


class Spool:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        with self._conn() as c:
            c.execute(
                """CREATE TABLE IF NOT EXISTS photobooth_spool (
                    session_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, input TEXT NOT NULL,
                    created_at TEXT NOT NULL, started_at TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT)"""
            )

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def add(self, workflow_id: str, inp: PhotoBoothInput) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT OR IGNORE INTO photobooth_spool (session_id, workflow_id, input, created_at) VALUES (?, ?, ?, ?)",
                (inp.session_id, workflow_id, json.dumps(dataclasses.asdict(inp)),
                 datetime.now(timezone.utc).isoformat()),
            )

    def get(self, session_id: str) -> SpoolRow | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM photobooth_spool WHERE session_id = ?", (session_id,)).fetchone()
        return self._row(r) if r else None

    def pending(self) -> list[SpoolRow]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM photobooth_spool WHERE started_at IS NULL ORDER BY created_at").fetchall()
        return [self._row(r) for r in rows]

    def mark_started(self, session_id: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE photobooth_spool SET started_at = ?, last_error = NULL WHERE session_id = ?",
                      (datetime.now(timezone.utc).isoformat(), session_id))

    def mark_failed(self, session_id: str, err: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE photobooth_spool SET attempts = attempts + 1, last_error = ? WHERE session_id = ?",
                      (err[:500], session_id))

    @staticmethod
    def _row(r: tuple) -> SpoolRow:
        return SpoolRow(r[0], r[1], PhotoBoothInput(**json.loads(r[2])), r[3], r[4], r[5], r[6])

    async def try_start(self, row: SpoolRow, start: StartFn) -> bool:
        """One attempt to start a spooled session. Returns True once it's running in Temporal."""
        try:
            await start(row.workflow_id, row.input)
        except WorkflowAlreadyStartedError:
            pass  # an earlier attempt got through before we recorded it
        except Exception as e:  # noqa: BLE001 - any failure means "try again later"
            self.mark_failed(row.session_id, f"{type(e).__name__}: {e}")
            return False
        self.mark_started(row.session_id)
        return True

    async def drain_forever(self, start: StartFn, every: timedelta = timedelta(seconds=5)) -> None:
        """Background loop: keep starting pending sessions until the network comes back."""
        while True:
            try:
                for row in self.pending():
                    if await self.try_start(row, start):
                        log.info("spooled photo booth session %s started", row.session_id)
                    else:
                        break  # Temporal still unreachable; don't hammer it
            except Exception:  # noqa: BLE001 - the loop must never die
                log.exception("spool drain failed")
            await asyncio.sleep(every.total_seconds())
