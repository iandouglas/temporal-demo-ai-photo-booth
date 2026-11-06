"""Photo analysis: how is the visitor framed, where is the face, is it usable?

- ``openai``: a small vision model with a strict JSON schema (structured outputs).
- ``heuristic``: offline fallback. A skin-tone bounding box plus a brightness
  check; crude, but it only has to pick a safe crop and composition.

Deliberately no sensitive attributes (age, gender, ethnicity, etc.): the
appearance note is limited to neutral, visible styling like glasses or a hat.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from dataclasses import dataclass, field

from PIL import Image, ImageStat

log = logging.getLogger(__name__)

FRAMINGS = ("head_only", "head_shoulders", "torso", "full_body")


@dataclass
class PhotoAnalysis:
    framing: str = "head_shoulders"
    face_count: int = 1
    face_bbox: list[float] = field(default_factory=lambda: [0.25, 0.12, 0.75, 0.62])  # x0, y0, x1, y1 (0-1)
    subject_bbox: list[float] = field(default_factory=lambda: [0.0, 0.0, 1.0, 1.0])
    usable: bool = True
    reason: str = ""
    appearance: str = ""
    source: str = "default"

    @property
    def close_up(self) -> bool:
        return self.framing == "head_only"


_BBOX = {
    "type": "object",
    "additionalProperties": False,
    "properties": {k: {"type": "number"} for k in ("x0", "y0", "x1", "y1")},
    "required": ["x0", "y0", "x1", "y1"],
}

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "framing": {"type": "string", "enum": list(FRAMINGS)},
        "face_count": {"type": "integer"},
        "primary_face_bbox": _BBOX,
        "subject_bbox": _BBOX,
        "usable": {"type": "boolean"},
        "reason": {"type": "string", "description": "Empty if usable; else a short reason like 'no face visible', 'too dark', 'very blurry'."},
        "appearance": {"type": "string", "description": "Neutral visible styling only, e.g. 'wearing glasses and a red beanie'. Max 12 words."},
    },
    "required": ["framing", "face_count", "primary_face_bbox", "subject_bbox", "usable", "reason", "appearance"],
}

INSTRUCTIONS = (
    "You analyse photo booth snapshots so an image generator can place the visitor in sci-fi scenes. "
    "Report how the main subject is framed (head_only = face fills most of the frame, little or no shoulders; "
    "head_shoulders; torso = down to about the waist; full_body), how many human faces are clearly visible, and "
    "bounding boxes normalised to 0-1 (x0,y0 top-left, x1,y1 bottom-right) for the most prominent face and for "
    "all the people together. Mark usable=false only if no human face is visible, the photo is too dark or "
    "blurry to see a face, or the face is mostly covered. The appearance note may mention only neutral visible "
    "styling such as glasses, hats, headphones, hair accessories or clothing colours. Never guess or mention age, "
    "gender, ethnicity, race, skin colour, body type, health, disability, emotions, or any other sensitive or "
    "personal attribute."
)


def _box(d: dict) -> list[float]:
    x0, y0, x1, y1 = (min(1.0, max(0.0, float(d[k]))) for k in ("x0", "y0", "x1", "y1"))
    if x1 - x0 < 0.02 or y1 - y0 < 0.02:
        raise ValueError(f"degenerate bbox {d}")
    return [x0, y0, x1, y1]


def analyze_openai(img_bytes: bytes) -> PhotoAnalysis:
    """Blocking OpenAI call (run it in a thread). Raises on network/API errors so Temporal retries."""
    from openai import OpenAI

    from ..config import settings

    client = OpenAI(api_key=settings.openai_api_key, max_retries=0, timeout=30)
    url = "data:image/jpeg;base64," + base64.b64encode(_small_jpeg(img_bytes)).decode()
    res = client.responses.create(
        model=settings.openai_vision_model,
        instructions=INSTRUCTIONS,
        input=[{"role": "user", "content": [
            {"type": "input_text", "text": "Analyse this photo booth snapshot."},
            {"type": "input_image", "image_url": url, "detail": "low"},
        ]}],
        text={"format": {"type": "json_schema", "name": "photo_analysis", "schema": SCHEMA, "strict": True}},
        max_output_tokens=400,
    )
    try:
        d = json.loads(res.output_text)
        framing = d["framing"] if d["framing"] in FRAMINGS else "head_shoulders"
        return PhotoAnalysis(
            framing=framing, face_count=max(0, int(d["face_count"])),
            face_bbox=_box(d["primary_face_bbox"]), subject_bbox=_box(d["subject_bbox"]),
            usable=bool(d["usable"]) and int(d["face_count"]) > 0, reason=str(d["reason"])[:120],
            appearance=str(d["appearance"])[:120], source="openai")
    except (ValueError, KeyError, TypeError) as e:
        # Refusal or malformed output: don't retry forever, use the offline guess.
        log.warning("vision analysis unparseable (%s); using heuristic", e)
        out = analyze_heuristic(img_bytes)
        out.source = "heuristic-after-openai"
        return out


def _small_jpeg(img_bytes: bytes, max_side: int = 512) -> bytes:
    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def analyze_heuristic(img_bytes: bytes) -> PhotoAnalysis:
    """Offline guess: skin-tone pixels in YCbCr give a rough face/subject box."""
    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    small = im.resize((96, 128))
    lum = ImageStat.Stat(small.convert("L")).mean[0]
    if lum < 28:
        return PhotoAnalysis(usable=False, reason="too dark", face_count=0, source="heuristic")

    ycc = small.convert("YCbCr")
    w, h = small.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            yy, cb, cr = ycc.getpixel((x, y))
            if yy > 40 and 77 <= cb <= 127 and 133 <= cr <= 173:
                xs.append(x)
                ys.append(y)
    if len(xs) < w * h * 0.01:
        # Can't find skin: don't reject (lighting varies), just use the safe default crop.
        return PhotoAnalysis(source="heuristic", reason="")

    xs.sort()
    ys.sort()
    n = len(xs)
    x0, x1 = xs[int(n * 0.05)] / w, xs[int(n * 0.95) - 1] / w
    y0 = ys[int(n * 0.03)] / h
    y1 = ys[int(n * 0.97) - 1] / h
    # Skin usually spans face + neck; the face is the top ~70% of it.
    face_h = max(0.08, (y1 - y0) * 0.72)
    face = [x0, y0, x1, min(1.0, y0 + face_h)]
    if face_h > 0.42:
        framing = "head_only"
    elif face_h > 0.24:
        framing = "head_shoulders"
    else:
        framing = "torso"
    return PhotoAnalysis(framing=framing, face_bbox=face, subject_bbox=[0.0, 0.0, 1.0, 1.0], source="heuristic")


def analyze(img_bytes: bytes, provider: str) -> PhotoAnalysis:
    if provider == "openai":
        return analyze_openai(img_bytes)
    return analyze_heuristic(img_bytes)


def resolve_analysis_provider() -> str:
    """openai whenever a key + SDK are available (even if images are mocked), else heuristic."""
    from ..config import settings

    if settings.openai_api_key:
        try:
            import openai  # noqa: F401
            return "openai"
        except ImportError:
            log.warning("openai package not installed: photo analysis uses the offline heuristic")
    return "heuristic"
