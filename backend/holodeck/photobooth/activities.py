"""Holo-Booth activities. Images live on disk under media_dir/photobooth/<session>/
and activities pass relative paths, keeping Temporal payloads tiny."""

from __future__ import annotations

import asyncio
import io
import math
import random
import time
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw
from temporalio import activity
from temporalio.exceptions import ApplicationError

from ..config import settings
from ..shared.chaos import maybe_fail
from .providers import FRAME_H, FRAME_W, ContentPolicyError, _font, fit_frame, get_provider
from .analysis import PhotoAnalysis, analyze
from .scenes import BY_ID, scene_prompt


def media_path(rel: str) -> Path:
    return settings.media_dir / rel


def media_url(rel: str) -> str:
    return f"/media/{rel}"


@dataclass
class AnalyzeInput:
    photo_path: str
    provider: str = "heuristic"  # openai | heuristic


@dataclass
class RenderSceneInput:
    session_dir: str
    index: int
    scene_id: str
    photo_path: str
    provider: str
    analysis: PhotoAnalysis = field(default_factory=PhotoAnalysis)
    soft: bool = False  # gentler prompt after a content-policy refusal
    style: str = "inspired"  # inspired | photo (see scenes.py)


@dataclass
class RenderResult:
    path: str
    url: str
    provider: str
    attempt: int = 1
    seconds: float = 0.0  # duration of the successful attempt


@dataclass
class ComposeInput:
    session_dir: str
    frame_paths: list[str]
    caption: str
    date_label: str


@dataclass
class ImageResult:
    path: str
    url: str
    attempt: int = 1


@dataclass
class PlaceholderInput:
    session_dir: str
    index: int
    title: str


CONTENT_POLICY = "ContentPolicy"


async def _heartbeating(fn, *args):
    """Run a blocking provider call in a thread, heartbeating so Temporal can
    tell a slow image model apart from a dead worker."""
    async def beat() -> None:
        while True:
            activity.heartbeat("working")
            await asyncio.sleep(5)

    hb = asyncio.create_task(beat())
    try:
        return await asyncio.to_thread(fn, *args)
    except (ContentPolicyError, ApplicationError):
        raise
    except Exception as e:
        # Keep failures small: an SDK error's full cause chain can exceed
        # Temporal's failure size limit, which hides the real message in the UI.
        raise ApplicationError(f"{type(e).__name__}: {str(e)[:300]}", type=type(e).__name__) from None
    finally:
        hb.cancel()


@activity.defn
async def analyze_photo(inp: AnalyzeInput) -> PhotoAnalysis:
    """Framing, face boxes, usability. Drives prompts and the mock crops."""
    if inp.provider != "openai":
        maybe_fail("analyze_photo")
        await asyncio.sleep(random.uniform(0.3, 0.8))
    data = media_path(inp.photo_path).read_bytes()
    result = await _heartbeating(analyze, data, inp.provider)
    activity.logger.info("photo analysis (%s): %s", result.source, result)
    return result


@activity.defn
async def render_scene(inp: RenderSceneInput) -> RenderResult:
    scene = BY_ID[inp.scene_id]
    if inp.provider == "mock":
        maybe_fail(f"render_scene[{inp.scene_id}]")
        await asyncio.sleep(random.uniform(1.0, 3.0))
    provider = get_provider(inp.provider)
    a = inp.analysis
    prompt = scene_prompt(scene, a.framing, a.face_count, a.usable, a.appearance, inp.soft, inp.style)
    photo = media_path(inp.photo_path).read_bytes()
    t0 = time.monotonic()
    try:
        img = await _heartbeating(provider.render_scene, photo, scene, prompt, a)
    except ContentPolicyError as e:
        # Retrying the same prompt won't help; the workflow picks a softer one.
        raise ApplicationError(str(e)[:300], type=CONTENT_POLICY, non_retryable=True) from e
    took = time.monotonic() - t0
    frame = fit_frame(img)
    rel = f"{inp.session_dir}/frame-{inp.index}.jpg"
    frame.save(media_path(rel), "JPEG", quality=90)
    activity.logger.info("frame %s (%s via %s, %s) rendered in %.1fs", inp.index, inp.scene_id, provider.name, a.framing, took)
    return RenderResult(rel, media_url(rel), provider.name, activity.info().attempt, round(took, 1))


@activity.defn
async def render_placeholder(inp: PlaceholderInput) -> RenderResult:
    """Last resort when a provider refuses every prompt for a frame: a branded
    card, never a fake picture of the visitor."""
    img = Image.new("RGB", (FRAME_W, FRAME_H), (12, 14, 34))
    d = ImageDraw.Draw(img)
    rng = random.Random(inp.session_dir + str(inp.index))
    for _ in range(180):
        x, y, r = rng.randint(0, FRAME_W), rng.randint(0, FRAME_H), rng.choice((1, 1, 2))
        d.ellipse((x, y, x + r, y + r), fill=(255, 255, 255))
    d.ellipse((FRAME_W / 2 - 150, FRAME_H / 2 - 150, FRAME_W / 2 + 150, FRAME_H / 2 + 150), outline=(123, 108, 255), width=6)
    for text, size, y, col in (("SIGNAL LOST IN A NEBULA", 40, FRAME_H / 2 - 40, (169, 159, 255)),
                               (inp.title.upper(), 24, FRAME_H / 2 + 20, (154, 163, 214))):
        f = _font(size)
        d.text(((FRAME_W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=col)
    rel = f"{inp.session_dir}/frame-{inp.index}.jpg"
    img.save(media_path(rel), "JPEG", quality=90)
    return RenderResult(rel, media_url(rel), "placeholder")


# ---------------------------------------------------------------------------
# Strip composition
# ---------------------------------------------------------------------------

PAD = 36          # film border around each frame
SPROCKET = 34     # side band with sprocket holes
CAPTION_H = 150
STRIP_BG = (14, 14, 22)


def _strip_canvas(n: int) -> tuple[Image.Image, list[tuple[int, int]]]:
    w = FRAME_W + 2 * (PAD + SPROCKET)
    h = n * FRAME_H + (n + 1) * PAD + CAPTION_H
    img = Image.new("RGB", (w, h), STRIP_BG)
    d = ImageDraw.Draw(img)
    for y in range(18, h - 18, 44):  # sprocket holes on both edges
        for x in (10, w - 10 - 18):
            d.rounded_rectangle((x, y, x + 18, y + 24), radius=5, fill=(40, 40, 58))
    slots = [(SPROCKET + PAD, PAD + i * (FRAME_H + PAD)) for i in range(n)]
    return img, slots


def _caption(img: Image.Image, caption: str, date_label: str) -> None:
    d = ImageDraw.Draw(img)
    w, h = img.size
    y0 = h - CAPTION_H
    title_f, small_f = _font(44), _font(22)
    tw = d.textlength(caption, font=title_f)
    d.text(((w - tw) / 2, y0 + 18), caption, font=title_f, fill=(169, 159, 255))
    sub = f"{date_label}  ·  AWS re:Invent  ·  powered by Temporal"
    sw = d.textlength(sub, font=small_f)
    d.text(((w - sw) / 2, y0 + 80), sub, font=small_f, fill=(154, 163, 214))


def _render_strip(frames: list[Image.Image], caption: str, date_label: str) -> Image.Image:
    img, slots = _strip_canvas(len(frames))
    for frame, (x, y) in zip(frames, slots):
        img.paste(frame, (x, y))
    _caption(img, caption, date_label)
    return img


@activity.defn
async def compose_strip(inp: ComposeInput) -> ImageResult:
    def work() -> str:
        frames = [Image.open(media_path(p)).convert("RGB") for p in inp.frame_paths]
        strip = _render_strip(frames, inp.caption, inp.date_label)
        rel = f"{inp.session_dir}/strip.jpg"
        strip.save(media_path(rel), "JPEG", quality=92)
        return rel

    rel = await asyncio.to_thread(work)
    return ImageResult(rel, media_url(rel))


@activity.defn
async def make_animated_strip(inp: ComposeInput) -> ImageResult:
    """Mock animation: slow push-in plus twinkling sparkles, as a looping GIF.

    A real version could send each frame to Amazon Nova Reel (async, ~minutes)
    and email the videos later; the workflow already waits durably for that.
    """

    def work() -> str:
        frames = [Image.open(media_path(p)).convert("RGB") for p in inp.frame_paths]
        rng = random.Random(inp.session_dir)
        sparkles = [[(rng.randint(0, FRAME_W), rng.randint(0, FRAME_H // 2), rng.random() * math.tau) for _ in range(14)]
                    for _ in frames]
        n = 10
        out: list[Image.Image] = []
        for t in range(n):
            phase = t / n * math.tau
            animated = []
            for i, f in enumerate(frames):
                z = 1.0 + 0.025 * (1 + math.sin(phase + i))  # gentle push-in, offset per panel
                cw, ch = int(FRAME_W / z), int(FRAME_H / z)
                ox, oy = (FRAME_W - cw) // 2, int((FRAME_H - ch) * 0.4)
                g = f.crop((ox, oy, ox + cw, oy + ch)).resize((FRAME_W, FRAME_H), Image.BILINEAR)
                d = ImageDraw.Draw(g)
                for sx, sy, sp in sparkles[i]:
                    a = (math.sin(phase * 2 + sp) + 1) / 2
                    if a > 0.55:
                        r = 2 + 5 * (a - 0.55)
                        d.line((sx - r * 2, sy, sx + r * 2, sy), fill=(255, 255, 255), width=2)
                        d.line((sx, sy - r * 2, sx, sy + r * 2), fill=(255, 255, 255), width=2)
                animated.append(g)
            strip = _render_strip(animated, inp.caption, inp.date_label)
            strip = strip.resize((strip.width // 2, strip.height // 2), Image.LANCZOS)
            out.append(strip.convert("P", palette=Image.ADAPTIVE, colors=192))
        rel = f"{inp.session_dir}/strip-animated.gif"
        buf = io.BytesIO()
        out[0].save(buf, "GIF", save_all=True, append_images=out[1:], duration=120, loop=0, optimize=True)
        media_path(rel).write_bytes(buf.getvalue())
        return rel

    rel = await asyncio.to_thread(work)
    return ImageResult(rel, media_url(rel))
