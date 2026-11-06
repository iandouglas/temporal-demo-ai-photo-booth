"""Shared Temporal client (local dev server or Temporal Cloud)."""

from __future__ import annotations

from temporalio.client import Client

from .config import settings

_client: Client | None = None


async def get_client() -> Client:
    global _client
    if _client is None:
        if settings.temporal_api_key:
            _client = await Client.connect(
                settings.temporal_address,
                namespace=settings.temporal_namespace,
                api_key=settings.temporal_api_key,
                tls=True,
            )
        else:
            _client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    return _client


def wf_id(demo: str, suffix: str, station: str | None = None) -> str:
    """Per-station workflow IDs keep stations apart in a shared namespace."""
    return f"holodeck-{station or settings.station}-{demo}-{suffix}"
