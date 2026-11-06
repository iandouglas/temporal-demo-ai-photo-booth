"""PhotoBoothWorkflow tests against Temporal's time-skipping test server,
using the mock image provider and the email outbox."""

from __future__ import annotations

import asyncio
import io
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from PIL import Image, ImageDraw
from temporalio import activity
from temporalio.client import Client
from temporalio.exceptions import ApplicationError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from holodeck.config import settings
from holodeck.photobooth import activities as pb_acts
from holodeck.photobooth.defs import ACTIVITIES, WORKFLOWS
from holodeck.photobooth.spool import Spool
from holodeck.photobooth.workflows import PhotoBoothInput, PhotoBoothStatus, PhotoBoothWorkflow
from holodeck.shared import email as email_mod
from holodeck.shared.email import send_email
from holodeck.shared.leads import save_lead


def _portrait() -> bytes:
    im = Image.new("RGB", (768, 1024), (90, 110, 130))
    ImageDraw.Draw(im).ellipse((200, 180, 560, 570), fill=(230, 185, 155))
    buf = io.BytesIO()
    im.save(buf, "JPEG")
    return buf.getvalue()


def _new_input(email: str = "visitor@example.com") -> PhotoBoothInput:
    sid = uuid.uuid4().hex[:10]
    rel_dir = f"photobooth/{sid}"
    (settings.media_dir / rel_dir).mkdir(parents=True, exist_ok=True)
    (settings.media_dir / rel_dir / "capture.jpg").write_bytes(_portrait())
    return PhotoBoothInput(session_id=sid, station="test", photo_path=f"{rel_dir}/capture.jpg",
                           email=email, consent_text_version="v1-test", provider="mock")


@pytest.fixture
async def env():
    async with await WorkflowEnvironment.start_time_skipping() as e:
        yield e


def _worker(client: Client, tq: str, activities: list | None = None) -> Worker:
    return Worker(client, task_queue=tq, workflows=WORKFLOWS,
                  activities=(activities or ACTIVITIES) + [save_lead, send_email])


def _assert_strip(inp: PhotoBoothInput, result) -> None:
    assert result.stage == "done"
    assert all(s.state == "done" for s in result.steps), result.steps
    strip = settings.media_dir / result.strip_url.removeprefix("/media/")
    anim = settings.media_dir / result.animated_url.removeprefix("/media/")
    assert Image.open(strip).height > 4 * 600
    assert Image.open(anim).n_frames > 1
    out = email_mod.OUTBOX / f"photobooth-{inp.session_id}.html"
    assert out.exists() and inp.email in out.read_text()


async def test_photobooth_end_to_end(env: WorkflowEnvironment):
    # chaos_rate (settings) makes some first attempts fail; retries absorb that.
    inp = _new_input()
    tq = f"test-{inp.session_id}"
    async with _worker(env.client, tq):
        result = await env.client.execute_workflow(PhotoBoothWorkflow.run, inp, id=f"pb-{inp.session_id}", task_queue=tq)
    _assert_strip(inp, result)


async def test_spool_then_start_later(env: WorkflowEnvironment, tmp_path: Path):
    """Temporal is 'down' for the first two start attempts; the spool keeps the
    session (even across a simulated API restart) and starts it later."""
    inp = _new_input()
    tq = f"test-{inp.session_id}"
    wf_id = f"pb-{inp.session_id}"
    calls = {"n": 0}

    async def flaky_start(workflow_id: str, i: PhotoBoothInput) -> None:
        calls["n"] += 1
        if calls["n"] <= 2:
            raise ConnectionError("temporal cloud unreachable (simulated)")
        await env.client.start_workflow(PhotoBoothWorkflow.run, i, id=workflow_id, task_queue=tq)

    db = tmp_path / "spool.sqlite"
    spool = Spool(db)
    spool.add(wf_id, inp)
    assert not await spool.try_start(spool.get(inp.session_id), flaky_start)
    assert spool.get(inp.session_id).attempts == 1

    # "Restart" the API: a fresh Spool on the same file still has the pending row.
    spool = Spool(db)
    assert [r.session_id for r in spool.pending()] == [inp.session_id]
    drain = asyncio.create_task(spool.drain_forever(flaky_start, every=timedelta(milliseconds=50)))
    try:
        for _ in range(100):
            if spool.get(inp.session_id).started_at:
                break
            await asyncio.sleep(0.05)
    finally:
        drain.cancel()
    row = spool.get(inp.session_id)
    assert row.started_at and row.attempts == 2 and not spool.pending()

    # A duplicate start (e.g. a retry that raced the first) is harmless.
    assert await spool.try_start(row, flaky_start)

    async with _worker(env.client, tq):
        result = await env.client.get_workflow_handle(wf_id, result_type=PhotoBoothStatus).result()
    _assert_strip(inp, result)


async def test_frame_survives_repeated_failures(env: WorkflowEnvironment):
    """The image model fails 4 times in a row for every frame; Temporal keeps retrying."""

    @activity.defn(name="render_scene")
    async def flaky_render(i: pb_acts.RenderSceneInput) -> pb_acts.RenderResult:
        if activity.info().attempt <= 4:
            raise RuntimeError(f"image model 503 (attempt {activity.info().attempt})")
        return await pb_acts.render_scene(i)

    acts = [a for a in ACTIVITIES if a is not pb_acts.render_scene] + [flaky_render]
    inp = _new_input()
    tq = f"test-{inp.session_id}"
    async with _worker(env.client, tq, acts):
        result = await env.client.execute_workflow(PhotoBoothWorkflow.run, inp, id=f"pb-{inp.session_id}", task_queue=tq)
    _assert_strip(inp, result)
    renders = [s for s in result.steps if s.key.startswith("render-")]
    assert all(s.attempts == 5 for s in renders), [(s.key, s.attempts) for s in renders]


async def test_content_policy_refusal_softens_prompt(env: WorkflowEnvironment):
    """A refusal is not retried as-is: the workflow retries that frame with a softer prompt."""

    @activity.defn(name="render_scene")
    async def picky_render(i: pb_acts.RenderSceneInput) -> pb_acts.RenderResult:
        if i.index == 0 and not i.soft:
            raise ApplicationError("moderation_blocked", type=pb_acts.CONTENT_POLICY, non_retryable=True)
        return await pb_acts.render_scene(i)

    acts = [a for a in ACTIVITIES if a is not pb_acts.render_scene] + [picky_render]
    inp = _new_input()
    tq = f"test-{inp.session_id}"
    async with _worker(env.client, tq, acts):
        result = await env.client.execute_workflow(PhotoBoothWorkflow.run, inp, id=f"pb-{inp.session_id}", task_queue=tq)
    _assert_strip(inp, result)
    assert next(s for s in result.steps if s.key == "render-0").detail == "softened prompt"


# ---------------------------------------------------------------------------
# Photo analysis: framing drives prompts; unusable photos degrade gracefully
# ---------------------------------------------------------------------------

from holodeck.photobooth.analysis import PhotoAnalysis, analyze_heuristic  # noqa: E402
from holodeck.photobooth.providers import MockImageProvider  # noqa: E402
from holodeck.photobooth.scenes import BY_ID, scene_prompt  # noqa: E402


def _synthetic(face_box: tuple[int, int, int, int]) -> bytes:
    im = Image.new("RGB", (768, 1024), (70, 80, 95))
    ImageDraw.Draw(im).ellipse(face_box, fill=(224, 172, 138))
    buf = io.BytesIO()
    im.save(buf, "JPEG")
    return buf.getvalue()


def test_pick_four_rules_over_many_seeds():
    import random as _r

    from holodeck.photobooth.scenes import SCENES, pick_four

    seen_ids = set()
    for seed in range(2000):
        ids = pick_four(_r.Random(seed))
        scenes = [BY_ID[i] for i in ids]
        assert len(ids) == 4 and len(set(ids)) == 4
        assert len({x.category for x in scenes}) == 4
        assert sum(x.transform for x in scenes) <= 1
        assert sum(x.family == "helm" for x in scenes) <= 1  # never two cockpit-style frames
        seen_ids.update(ids)
    assert seen_ids == {x.id for x in SCENES}  # every scene gets used
    assert len(SCENES) >= 15


def test_inspired_prompts():
    for sc in BY_ID.values():
        p = scene_prompt(sc, "torso", appearance="wearing glasses")
        assert "looks very much like the person in the reference photo" in p
        assert "face, hairstyle and facial hair" in p
        assert "new pose, camera angle, lighting and costume" in p
        assert "wearing glasses" in p
        assert "reference photo" in scene_prompt(sc, soft=True)  # softer fallback keeps the likeness ask
    crew = scene_prompt(BY_ID["starfighter_ace"], face_count=3)
    assert "people in the reference photo" in crew and "as a crew" in crew
    assert "cartoon astronaut" in scene_prompt(BY_ID["cantina"], usable=False)
    assert "Even transformed" in scene_prompt(BY_ID["zorblaxian"])


def test_photo_style_prompts():
    p = scene_prompt(BY_ID["starfighter_ace"], "head_only", style="photo")
    assert p.startswith("Edit this photo") and "Keep the tight head-and-face framing" in p
    assert "tight head-and-face" not in scene_prompt(BY_ID["starfighter_ace"], "torso", style="photo")
    assert "these people" in scene_prompt(BY_ID["cantina"], face_count=2, style="photo")


def test_heuristic_framing():
    assert analyze_heuristic(_synthetic((84, 60, 684, 900))).framing == "head_only"      # laptop close-up
    assert analyze_heuristic(_synthetic((290, 100, 480, 330))).framing in ("torso", "head_shoulders")
    dark = io.BytesIO()
    Image.new("RGB", (768, 1024), (5, 5, 5)).save(dark, "JPEG")
    a = analyze_heuristic(dark.getvalue())
    assert not a.usable and a.reason == "too dark"


def test_mock_never_cuts_out_the_visitor():
    """Regression for the 'hourglass head': no fake cutout mask anywhere."""
    assert not hasattr(MockImageProvider, "remove_background")
    photo = _synthetic((84, 60, 684, 900))
    a = analyze_heuristic(photo)
    for sid in BY_ID:
        out = MockImageProvider().render_scene(photo, BY_ID[sid], "", a)
        assert Image.open(io.BytesIO(out)).size == (800, 600)


def _recording_acts(analysis: PhotoAnalysis, seen: list):
    @activity.defn(name="analyze_photo")
    async def fake_analyze(_i: pb_acts.AnalyzeInput) -> PhotoAnalysis:
        return analysis

    @activity.defn(name="render_scene")
    async def recording_render(i: pb_acts.RenderSceneInput) -> pb_acts.RenderResult:
        a = i.analysis
        res = await pb_acts.render_scene(i)  # may raise (chaos); only record successful renders
        seen.append(scene_prompt(BY_ID[i.scene_id], a.framing, a.face_count, a.usable, a.appearance, i.soft, i.style))
        return res

    keep = [x for x in ACTIVITIES if x not in (pb_acts.render_scene, pb_acts.analyze_photo)]
    return keep + [fake_analyze, recording_render]


@pytest.mark.parametrize("framing", ["head_only", "torso"])
async def test_workflow_photo_style_uses_framing(env: WorkflowEnvironment, framing: str):
    seen: list[str] = []
    inp = _new_input()
    inp.style = "photo"
    tq = f"test-{inp.session_id}"
    async with _worker(env.client, tq, _recording_acts(PhotoAnalysis(framing=framing), seen)):
        result = await env.client.execute_workflow(PhotoBoothWorkflow.run, inp, id=f"pb-{inp.session_id}", task_queue=tq)
    _assert_strip(inp, result)
    assert result.analysis.framing == framing
    close_ups = [p for p in seen if "Keep the tight head-and-face framing" in p]
    assert len(close_ups) == (4 if framing == "head_only" else 0), seen


async def test_unusable_photo_still_gets_a_strip(env: WorkflowEnvironment):
    seen: list[str] = []
    inp = _new_input()
    tq = f"test-{inp.session_id}"
    bad = PhotoAnalysis(usable=False, face_count=0, reason="no face visible")
    async with _worker(env.client, tq, _recording_acts(bad, seen)):
        result = await env.client.execute_workflow(PhotoBoothWorkflow.run, inp, id=f"pb-{inp.session_id}", task_queue=tq)
    _assert_strip(inp, result)
    assert "improvising" in next(s for s in result.steps if s.key == "scan").detail
    assert len(seen) == 4 and all("cartoon astronaut" in p for p in seen)
    assert not (settings.media_dir / f"photobooth/{inp.session_id}/cutout.png").exists()


async def test_workflow_inspired_is_default(env: WorkflowEnvironment):
    seen: list[str] = []
    inp = _new_input()
    tq = f"test-{inp.session_id}"
    async with _worker(env.client, tq, _recording_acts(PhotoAnalysis(framing="head_only"), seen)):
        result = await env.client.execute_workflow(PhotoBoothWorkflow.run, inp, id=f"pb-{inp.session_id}", task_queue=tq)
    _assert_strip(inp, result)
    assert len(seen) == 4 and all("looks very much like the person in the reference photo" in p for p in seen)


async def test_provider_errors_are_retried_with_a_short_message():
    """A connection error's cause chain can exceed Temporal's failure size limit."""
    from temporalio.exceptions import ApplicationError
    from holodeck.photobooth.activities import _heartbeating

    def boom():
        try:
            raise ConnectionRefusedError("[Errno 61] Connection refused")
        except ConnectionRefusedError as inner:
            raise RuntimeError("Connection error. " + "x" * 5000) from inner

    from temporalio.testing import ActivityEnvironment

    async def run():
        return await _heartbeating(boom)

    try:
        await ActivityEnvironment().run(run)
    except ApplicationError as e:
        assert e.type == "RuntimeError" and len(e.message) < 400 and e.__cause__ is None and not e.non_retryable
    else:
        raise AssertionError("expected ApplicationError")
