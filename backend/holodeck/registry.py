"""Each demo package exposes ``defs.py`` (WORKFLOWS, ACTIVITIES) and ``api.py`` (router)."""

from __future__ import annotations

import importlib

DEMOS = ["photobooth"]


def workflows() -> list:
    out: list = []
    for d in DEMOS:
        out += importlib.import_module(f"holodeck.{d}.defs").WORKFLOWS
    return out


def activities() -> list:
    from .shared.email import send_email
    from .shared.leads import save_lead

    out: list = [save_lead, send_email]
    for d in DEMOS:
        out += importlib.import_module(f"holodeck.{d}.defs").ACTIVITIES
    return out


def routers() -> list:
    return [importlib.import_module(f"holodeck.{d}.api").router for d in DEMOS]
