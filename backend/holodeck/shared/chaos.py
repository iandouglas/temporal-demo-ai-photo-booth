"""Optional failure injection so visitors see Temporal retry a flaky AI call."""

from __future__ import annotations

import random

from temporalio import activity

from ..config import settings


class FlakyProviderError(RuntimeError):
    pass


def maybe_fail(what: str) -> None:
    """Fail the first attempt of an activity with probability chaos_rate.

    Only ever fails attempt 1, so a demo never gets stuck retrying forever.
    """
    info = activity.info()
    if info.attempt == 1 and random.random() < settings.chaos_rate:
        raise FlakyProviderError(f"{what}: upstream AI provider timed out (simulated)")
