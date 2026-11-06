"""Runs the Temporal worker for every Holodeck demo on this station's task queue."""

from __future__ import annotations

import asyncio
import logging

from temporalio.worker import Worker

from . import registry
from .config import settings
from .temporal_client import get_client


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    client = await get_client()
    worker = Worker(
        client,
        task_queue=settings.task_queue,
        workflows=registry.workflows(),
        activities=registry.activities(),
        max_concurrent_activities=20,
    )
    logging.info("Holodeck worker on %s (namespace %s)", settings.task_queue, settings.temporal_namespace)
    logging.info(
        "Providers: image=%s llm=%s email=%s chaos=%.2f",
        settings.image_provider, settings.llm_provider, settings.email_provider, settings.chaos_rate,
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
