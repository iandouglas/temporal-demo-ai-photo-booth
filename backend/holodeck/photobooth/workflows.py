"""PhotoBoothWorkflow: photo + email in, AI photo strip out, emailed to the visitor.

The booth can reset as soon as the workflow is started (or even just spooled
locally, see spool.py). From then on Temporal owns the job: AI calls retry
until they succeed, across worker restarts and network outages, and the
visitor gets the email whenever it finishes.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from ..shared.email import EmailMessage, send_email
    from ..shared.leads import Lead, save_lead
    from .activities import (
        CONTENT_POLICY,
        AnalyzeInput,
        ComposeInput,
        PlaceholderInput,
        RenderResult,
        RenderSceneInput,
        analyze_photo,
        compose_strip,
        make_animated_strip,
        render_placeholder,
        render_scene,
    )
    from .analysis import PhotoAnalysis
    from .scenes import BY_ID, FALLBACK, pick_four

# AI calls: retry forever (capped backoff) within a day. A booth outage or a
# flaky model delays the email; it never loses the photo.
AI_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=60),
    maximum_attempts=0,  # unlimited
    non_retryable_error_types=[CONTENT_POLICY],
)
AI_TIMEOUTS = dict(
    schedule_to_close_timeout=timedelta(hours=24),
    start_to_close_timeout=timedelta(minutes=3),  # one image edit; slow ones take ~1 min
    heartbeat_timeout=timedelta(seconds=30),
)
PLUMBING_RETRY = RetryPolicy(initial_interval=timedelta(seconds=2), maximum_interval=timedelta(seconds=60),
                             maximum_attempts=0)


@dataclass
class PhotoBoothInput:
    session_id: str
    station: str
    photo_path: str  # relative to media_dir
    email: str
    consent_text_version: str = ""
    provider: str = "mock"  # fixed at capture time so a session never mixes providers
    analysis_provider: str = "heuristic"  # openai whenever a key exists, even with mock images
    style: str = "inspired"  # prompt style, fixed at capture time
    public_base_url: str = "http://localhost:8000"  # for links in the email
    captured_at: str = ""  # ISO timestamp from the booth (may be long before the workflow starts)


@dataclass
class StepState:
    key: str
    label: str
    state: str = "pending"  # pending | running | retrying | done | failed | skipped
    attempts: int = 0
    detail: str = ""
    url: str | None = None
    seconds: float = 0.0


@dataclass
class PhotoBoothStatus:
    session_id: str
    stage: str = "starting"  # processing | sending | done
    steps: list[StepState] = field(default_factory=list)
    photo_url: str | None = None
    strip_url: str | None = None
    animated_url: str | None = None
    email: str | None = None
    provider: str = ""
    analysis: PhotoAnalysis | None = None


def _is_policy_refusal(err: ActivityError) -> bool:
    return isinstance(err.cause, ApplicationError) and err.cause.type == CONTENT_POLICY


@workflow.defn
class PhotoBoothWorkflow:
    def __init__(self) -> None:
        self._s: PhotoBoothStatus | None = None

    def _step(self, key: str) -> StepState:
        assert self._s
        return next(s for s in self._s.steps if s.key == key)

    @workflow.query
    def status(self) -> PhotoBoothStatus:
        return self._s or PhotoBoothStatus(session_id="")

    @workflow.run
    async def run(self, inp: PhotoBoothInput) -> PhotoBoothStatus:
        session_dir = inp.photo_path.rsplit("/", 1)[0]
        scene_ids = pick_four(workflow.random())
        s = self._s = PhotoBoothStatus(
            session_id=inp.session_id,
            stage="processing",
            photo_url=f"/media/{inp.photo_path}",
            email=inp.email,
            provider=inp.provider,
            steps=[StepState("scan", "Scanning your photo")]
            + [StepState(f"render-{i}", f"Frame {i + 1}: {BY_ID[sid].title}") for i, sid in enumerate(scene_ids)]
            + [StepState("strip", "Developing photo strip"), StepState("animate", "Animating strip"),
               StepState("email", "Beaming strip to your inbox")],
        )

        # Lead first: it's the one thing we must never lose.
        await workflow.execute_activity(
            save_lead,
            Lead(email=inp.email, demo="holodeck-photobooth", station=inp.station,
                 consent_text_version=inp.consent_text_version,
                 id=str(workflow.uuid4()), captured_at=inp.captured_at or workflow.now().isoformat(),
                 extra=json.dumps({"session_id": inp.session_id, "scenes": scene_ids, "provider": inp.provider})),
            start_to_close_timeout=timedelta(seconds=15), retry_policy=PLUMBING_RETRY)

        # 1. Analyse the photo: framing, face boxes, usable? Drives prompts and crops.
        scan = self._step("scan")
        scan.state = "running"
        a = await workflow.execute_activity(
            analyze_photo, AnalyzeInput(inp.photo_path, inp.analysis_provider),
            activity_id="scan", retry_policy=AI_RETRY, **AI_TIMEOUTS)
        s.analysis = a
        scan.state = "done"
        who = f"{a.face_count} people" if a.face_count > 1 else a.framing.replace("_", " ")
        scan.detail = who if a.usable else f"{a.reason or 'hard to see you'}: improvising"

        # 2. Four frames in parallel. A content-policy refusal gets one softer
        # prompt, then a bland fallback scene, then a branded placeholder card.
        async def render(i: int, scene_id: str) -> str:
            st = self._step(f"render-{i}")
            st.state = "running"
            tries = [(scene_id, False, ""), (scene_id, True, "-soft"), (FALLBACK.id, True, "-fallback")]
            res: RenderResult | None = None
            for sid, soft, suffix in tries:
                try:
                    res = await workflow.execute_activity(
                        render_scene,
                        RenderSceneInput(session_dir, i, sid, inp.photo_path, inp.provider, a, soft, inp.style),
                        activity_id=f"render-{i}{suffix}", retry_policy=AI_RETRY, **AI_TIMEOUTS)
                    if suffix:
                        st.detail = "softened prompt" if suffix == "-soft" else f"swapped to {FALLBACK.title}"
                    break
                except ActivityError as e:
                    if not _is_policy_refusal(e):
                        raise
                    workflow.logger.warning("frame %s refused by content policy (%s)", i, sid)
            if res is None:
                res = await workflow.execute_activity(
                    render_placeholder, PlaceholderInput(session_dir, i, BY_ID[scene_id].title),
                    start_to_close_timeout=timedelta(seconds=30), retry_policy=PLUMBING_RETRY)
                st.detail = "provider refused every prompt"
            st.state, st.url, st.attempts, st.seconds = "done", res.url, res.attempt, res.seconds
            if res.attempt > 1 and not st.detail:
                st.detail = f"done after {res.attempt} attempts"
            return res.path

        frames = await asyncio.gather(*(render(i, sid) for i, sid in enumerate(scene_ids)))

        # 3. Compose the strip, then the animated version.
        date_label = workflow.now().strftime("%b %d, %Y").upper()
        compose = ComposeInput(session_dir, list(frames), "TEMPORAL HOLODECK", date_label)
        st = self._step("strip")
        st.state = "running"
        strip = await workflow.execute_activity(compose_strip, compose, activity_id="strip",
                                                start_to_close_timeout=timedelta(seconds=60),
                                                retry_policy=PLUMBING_RETRY)
        st.state, st.url, s.strip_url = "done", strip.url, strip.url

        st = self._step("animate")
        st.state = "running"
        anim = await workflow.execute_activity(make_animated_strip, compose, activity_id="animate",
                                               start_to_close_timeout=timedelta(seconds=120),
                                               retry_policy=PLUMBING_RETRY)
        st.state, st.url, s.animated_url = "done", anim.url, anim.url

        # 4. Email it.
        s.stage = "sending"
        st = self._step("email")
        st.state = "running"
        await workflow.execute_activity(
            send_email,
            EmailMessage(to=inp.email, subject="Your Temporal Holodeck photo strip \U0001f680",
                         html=_email_html(inp.public_base_url, strip.url, anim.url),
                         idempotency_key=f"photobooth-{inp.session_id}"),
            activity_id="email", start_to_close_timeout=timedelta(seconds=30),
            schedule_to_close_timeout=timedelta(days=3), retry_policy=PLUMBING_RETRY)
        st.state, st.detail = "done", f"Sent to {inp.email}"
        s.stage = "done"
        return s


def _email_html(base: str, strip_url: str, anim_url: str) -> str:
    base = base.rstrip("/")
    return f"""
<div style="background:#05060d;color:#eef0ff;font-family:Helvetica,Arial,sans-serif;padding:32px;text-align:center">
  <h1 style="color:#a99fff;letter-spacing:2px">GREETINGS FROM THE HOLODECK</h1>
  <p>Thanks for visiting the Temporal booth at AWS re:Invent. Here's your photo strip.</p>
  <p><img src="{base}{anim_url}" alt="Your animated photo strip" style="max-width:420px;width:100%"></p>
  <p><a style="color:#59fdd0" href="{base}{strip_url}">Download the full-resolution strip</a></p>
  <p style="color:#9aa3d6;font-size:13px">Every frame was generated by an AI pipeline running as a Temporal
  workflow. When the image model hiccuped, Temporal retried it for us.
  <a style="color:#59fdd0" href="https://temporal.io">Learn more at temporal.io</a></p>
</div>"""
