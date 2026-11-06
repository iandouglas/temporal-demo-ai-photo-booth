"""Image providers for the Holo-Booth.

- ``openai`` (default when OPENAI_API_KEY is set): image edits straight from the photo.
- ``bedrock``: Stability AI Image Services / Amazon Nova Canvas on Bedrock (UNTESTED).
- ``mock``: Pillow only, no network. Never cuts the visitor out: it places an
  undistorted crop of the whole photo (centred on the face box from the photo
  analysis) inside a shaped frame such as a helmet visor, porthole, cockpit
  viewscreen, or alien hologram.

Every provider renders from the original photo plus a framing-aware prompt
(``scenes.scene_prompt``). Methods are blocking; activities call them in a thread.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import math
import random
from typing import Protocol

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

from .analysis import PhotoAnalysis
from .scenes import Scene

FRAME_W, FRAME_H = 800, 600
log = logging.getLogger(__name__)


class ImageProvider(Protocol):
    name: str

    def render_scene(self, photo_jpg: bytes, scene: Scene, prompt: str, analysis: PhotoAnalysis) -> bytes:
        """Return an image of the visitor in ``scene`` (any size; caller fits it to the frame)."""
        ...


class ContentPolicyError(Exception):
    """The provider refused the prompt or image (not worth retrying as-is)."""


_cache: dict[str, ImageProvider] = {}


def get_provider(name: str) -> ImageProvider:
    if name not in _cache:
        if name == "bedrock":
            _cache[name] = BedrockImageProvider()
        elif name == "openai":
            _cache[name] = OpenAIImageProvider()
        else:
            _cache[name] = MockImageProvider()
    return _cache[name]


def resolve_provider_name() -> str:
    """Provider for new sessions, falling back to mock (loudly) if openai can't work here."""
    from ..config import settings

    name = settings.image_provider
    if name == "openai":
        if not settings.openai_api_key:
            log.warning("HOLODECK_IMAGE_PROVIDER=openai but OPENAI_API_KEY is not set: using the MOCK image provider")
            return "mock"
        try:
            import openai  # noqa: F401
        except ImportError:
            log.warning("openai package not installed (uv sync --extra openai): using the MOCK image provider")
            return "mock"
    return name


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("Arial Bold.ttf", "Arial.ttf", "DejaVuSans-Bold.ttf", "Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def fit_frame(img_bytes: bytes) -> Image.Image:
    """Normalise any provider output to the strip's frame size (crop, never stretch)."""
    return ImageOps.fit(Image.open(io.BytesIO(img_bytes)).convert("RGB"), (FRAME_W, FRAME_H), Image.LANCZOS)


# --------------------------------------------------------------------------
# Mock provider
# --------------------------------------------------------------------------

def _hex(c: str, a: int = 255) -> tuple[int, int, int, int]:
    c = c.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), a)


def crop_around(photo: Image.Image, box: list[float], out_w: int, out_h: int, pad: float = 1.9,
                lift: float = 0.12, top_margin: float | None = None) -> tuple[Image.Image, tuple[float, float, float, float]]:
    """Crop ``photo`` around a normalised ``box`` at exactly out_w:out_h, then scale uniformly.

    The crop only ever grows, shifts, or shrinks to stay inside the photo; the
    aspect ratio always matches the output, so faces are never squashed.
    ``lift`` nudges the centre up (hair, hats); ``top_margin`` instead pins the
    crop's top edge that many box-heights above the box. Returns the crop and the
    box's position inside the output, in output pixels.
    """
    W, H = photo.size
    bx0, by0, bx1, by1 = box[0] * W, box[1] * H, box[2] * W, box[3] * H
    bw, bh = max(8.0, bx1 - bx0), max(8.0, by1 - by0)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2 - bh * lift
    cw, ch = bw * pad, bh * pad
    aspect = out_w / out_h
    if cw / ch > aspect:
        ch = cw / aspect
    else:
        cw = ch * aspect
    shrink = min(1.0, W / cw, H / ch)
    cw, ch = cw * shrink, ch * shrink
    x0 = min(max(cx - cw / 2, 0), W - cw)
    y0 = min(max(cy - ch / 2 if top_margin is None else by0 - bh * top_margin, 0), H - ch)
    out = photo.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((out_w, out_h), Image.LANCZOS)
    sx, sy = out_w / cw, out_h / ch
    return out, ((bx0 - x0) * sx, (by0 - y0) * sy, (bx1 - x0) * sx, (by1 - y0) * sy)


def _shape_mask(size: tuple[int, int], shape: str, feather: int = 0) -> Image.Image:
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    w, h = size
    if shape == "circle":
        d.ellipse((0, 0, w - 1, h - 1), fill=255)
    elif shape == "rounded":
        d.rounded_rectangle((0, 0, w - 1, h - 1), radius=min(w, h) // 8, fill=255)
    else:  # oval with generous inset for feathering
        d.ellipse((feather, feather, w - 1 - feather, h - 1 - feather), fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather)) if feather else m


class MockImageProvider:
    """Offline stand-in: backdrop painter + a frame that shows an undistorted crop of the photo."""

    name = "mock"

    def render_scene(self, photo_jpg: bytes, scene: Scene, prompt: str, analysis: PhotoAnalysis) -> bytes:
        rng = random.Random(scene.id)
        photo = Image.open(io.BytesIO(photo_jpg)).convert("RGB")
        canvas = self._sky(scene, rng)
        ctx: dict = {}
        getattr(self, f"_bd_{scene.backdrop}")(canvas, scene, rng, ctx)
        getattr(self, f"_fr_{scene.frame}")(canvas, photo, analysis, scene, rng, ctx)
        after = getattr(self, f"_after_{scene.backdrop}", None)
        if after:
            after(canvas, scene, rng, ctx)
        return _png(self._finish(canvas, scene).convert("RGB"))

    # ------------------------------------------------------------ helpers
    def _sky(self, scene: Scene, rng: random.Random) -> Image.Image:
        top, bottom = _hex(scene.sky[0]), _hex(scene.sky[1])
        grad = Image.new("RGBA", (1, FRAME_H))
        for y in range(FRAME_H):
            t = y / (FRAME_H - 1)
            grad.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
        bg = grad.resize((FRAME_W, FRAME_H))
        glow = Image.new("RGBA", bg.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for _ in range(5):
            x, y, r = rng.randint(0, FRAME_W), rng.randint(0, FRAME_H // 2), rng.randint(80, 220)
            gd.ellipse((x - r, y - r * 0.6, x + r, y + r * 0.6), fill=_hex(scene.extras.get("accent", scene.sky[1]), rng.randint(40, 90)))
        bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(60)))
        d = ImageDraw.Draw(bg)
        for _ in range(140):
            x, y, s = rng.randint(0, FRAME_W), rng.randint(0, FRAME_H), rng.choice((1, 1, 1, 2, 2, 3))
            d.ellipse((x, y, x + s, y + s), fill=(255, 255, 255, rng.randint(120, 255)))
        return bg

    @staticmethod
    def _tint(img: Image.Image, hue: float, strength: float = 0.6) -> Image.Image:
        h, s, v = img.convert("HSV").split()
        h = Image.new("L", img.size, int(hue * 255))
        s = s.point(lambda p: max(p, 110))
        return Image.blend(img, Image.merge("HSV", (h, s, v)).convert("RGB"), strength)

    @staticmethod
    def _paste_shaped(canvas: Image.Image, img: Image.Image, xy: tuple[int, int], shape: str, feather: int = 0) -> None:
        canvas.paste(img, xy, _shape_mask(img.size, shape, feather))

    @staticmethod
    def _glow_line(canvas, pts, color, width=14, core=(255, 240, 245, 255)):
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).line(pts, fill=color, width=width)
        canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(7)))
        ImageDraw.Draw(canvas).line(pts, fill=core, width=max(2, width // 4))

    def _ground(self, canvas, color: str, rng, level: float = 0.78, bumps: int = 18):
        d = ImageDraw.Draw(canvas)
        pts = [(0, FRAME_H)] + [(i, FRAME_H * level + rng.randint(-bumps, bumps)) for i in range(0, FRAME_W + 40, 40)] + [(FRAME_W, FRAME_H)]
        d.polygon(pts, fill=_hex(color))

    def _planet(self, d, x, y, r, col, ring=True):
        c = _hex(col)
        box = (x - r * 1.7, y - r * 0.28, x + r * 1.7, y + r * 0.28)
        if ring:
            d.arc(box, 180, 360, fill=(255, 240, 210, 200), width=6)
        d.ellipse((x - r, y - r, x + r, y + r), fill=c)
        d.chord((x - r, y - r, x + r, y + r), 20, 160, fill=tuple(int(v * 0.82) for v in c[:3]) + (255,))
        if ring:
            d.arc(box, 0, 180, fill=(255, 240, 210, 230), width=6)

    # ------------------------------------------------------------ backdrops
    def _bd_nebula(self, canvas, scene, rng, ctx):
        pass  # the sky already has nebula glows and stars

    def _bd_lab(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        for x in range(0, FRAME_W, 50):
            d.line((x, 0, x, FRAME_H), fill=(40, 60, 70, 255))
        for y in range(0, FRAME_H, 50):
            d.line((0, y, FRAME_W, y), fill=(40, 60, 70, 255))
        for side in (0, 1):
            x = 70 if side == 0 else FRAME_W - 70
            d.line((x, FRAME_H, x + (40 if side == 0 else -40), 330, x + (110 if side == 0 else -110), 250), fill=(150, 170, 185, 255), width=16, joint="curve")

    def _bd_warp(self, canvas, scene, rng, ctx):
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(layer)
        vx, vy = FRAME_W / 2, FRAME_H * 0.35
        for _ in range(90):
            a, r0, r1 = rng.uniform(0, math.tau), rng.uniform(40, 200), rng.uniform(260, 700)
            sd.line((vx + math.cos(a) * r0, vy + math.sin(a) * r0, vx + math.cos(a) * r1, vy + math.sin(a) * r1),
                    fill=(200, 220, 255, rng.randint(90, 200)), width=rng.choice((1, 2, 2, 3)))
        canvas.alpha_composite(layer)

    def _bd_bridge(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.rounded_rectangle((40, 30, FRAME_W - 40, 330), radius=30, fill=(4, 6, 20, 255), outline=(90, 100, 150, 255), width=6)
        self._planet(d, 560, 170, 90, "#ff9ad5")
        for x, y in ((140, 90), (230, 200), (420, 120), (700, 260)):
            d.ellipse((x, y, x + 3, y + 3), fill=(255, 255, 255, 255))
        d.polygon([(0, 420), (FRAME_W, 420), (FRAME_W, FRAME_H), (0, FRAME_H)], fill=(30, 34, 60, 255))
        for row in range(2):
            for i in range(12):
                x = 60 + i * 58
                d.rounded_rectangle((x, 450 + row * 40, x + 40, 470 + row * 40), radius=6,
                                    fill=_hex(rng.choice(("#ffb547", "#59fdd0", "#7b6cff", "#ff6b7a"))))

    def _bd_mech(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        for x in range(-400, FRAME_W + 400, 70):  # perspective floor
            d.line((FRAME_W / 2, 360, x, FRAME_H), fill=(255, 107, 122, 120), width=2)
        d.rectangle((0, 360, FRAME_W, 364), fill=(255, 107, 122, 255))
        body = (230, 110, 570, 470)
        d.rounded_rectangle(body, radius=40, fill=(90, 96, 130, 255), outline=(170, 180, 220, 255), width=6)
        for x0 in (150, 570):  # arms
            d.rounded_rectangle((x0, 170, x0 + 80, 430), radius=30, fill=(80, 86, 118, 255), outline=(170, 180, 220, 255), width=5)
        for x0 in (270, 450):  # legs
            d.rounded_rectangle((x0, 460, x0 + 80, FRAME_H + 20), radius=20, fill=(70, 76, 108, 255), outline=(170, 180, 220, 255), width=5)
        d.rounded_rectangle((350, 60, 450, 120), radius=20, fill=(90, 96, 130, 255), outline=(170, 180, 220, 255), width=5)
        d.ellipse((380, 78, 420, 102), fill=(255, 107, 122, 255))

    def _bd_ringworld(self, canvas, scene, rng, ctx):
        self._planet(ImageDraw.Draw(canvas), 620, 140, 100, scene.extras.get("planet", "#ffcf7a"))
        self._ground(canvas, scene.extras.get("ground", "#6b2e1a"), rng)
        d = ImageDraw.Draw(canvas)
        d.line((560, 470, 560, 330), fill=(220, 220, 230, 255), width=6)  # flag
        d.polygon([(563, 332), (650, 350), (563, 372)], fill=(123, 108, 255, 255))
        ctx["visor"] = (300, 290, 150)

    def _bd_slugs(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        for sx, sy, sr, col in ((140, 90, 46, "#fff2a8"), (250, 60, 26, "#ffd0a0")):
            d.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=_hex(col))
        self._ground(canvas, scene.extras.get("ground", "#0d3b2e"), rng, level=0.72)
        d = ImageDraw.Draw(canvas)
        targets = []
        for x, y, s in ((120, 470, 1.0), (260, 430, 0.7), (60, 400, 0.55)):
            w, hgt = 150 * s, 70 * s
            d.ellipse((x - w / 2, y - hgt / 2, x + w / 2, y + hgt / 2), fill=(120, 220, 60, 255), outline=(40, 110, 20, 255), width=4)
            for side in (-1, 1):
                ex, ey = x - w * 0.3 + side * 12 * s, y - hgt * 1.1
                d.line((x - w * 0.3, y - hgt * 0.3, ex, ey), fill=(40, 110, 20, 255), width=int(5 * s) + 1)
                d.ellipse((ex - 9 * s, ey - 9 * s, ex + 9 * s, ey + 9 * s), fill=(255, 255, 255, 255))
                d.ellipse((ex - 4 * s, ey - 4 * s, ex + 4 * s, ey + 4 * s), fill=(0, 0, 0, 255))
            targets.append((x, y))
        ctx["visor"] = (580, 270, 128)
        ctx["targets"] = targets

    def _after_slugs(self, canvas, scene, rng, ctx):
        cx, cy, r = ctx["visor"]
        start = (cx - r * 1.5, cy + r * 1.35)
        for tx, ty in ctx["targets"][:2]:
            self._glow_line(canvas, [start, (tx + 30, ty - 10)], (255, 60, 120, 255), 16)
            ImageDraw.Draw(canvas).regular_polygon((tx + 30, ty - 10, 26), 8, rotation=22, fill=(255, 240, 120, 230))
        ImageDraw.Draw(canvas).rounded_rectangle((start[0] - 30, start[1] - 18, start[0] + 50, start[1] + 18), radius=8,
                                                 fill=(70, 80, 110, 255), outline=(200, 210, 255, 255), width=3)

    def _bd_hull(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.ellipse((-200, 380, FRAME_W + 200, 1300), fill=_hex(scene.extras.get("planet", "#2f7de0")))
        d.arc((-180, 400, FRAME_W + 180, 1280), 200, 340, fill=(190, 230, 255, 255), width=10)
        d.polygon([(420, FRAME_H), (FRAME_W, 330), (FRAME_W, FRAME_H)], fill=(150, 158, 180, 255))
        for i in range(5):
            x = 500 + i * 60
            d.line((x, FRAME_H, x + 100, FRAME_H - 150 - i * 20), fill=(110, 118, 140, 255), width=3)
        ctx["visor"] = (330, 260, 140)

    def _after_hull(self, canvas, scene, rng, ctx):
        cx, cy, r = ctx["visor"]
        d = ImageDraw.Draw(canvas)
        d.line([(cx + r * 1.4, cy + r * 1.3), (620, 300), (FRAME_W, 420)], fill=(255, 181, 71, 255), width=5, joint="curve")

    def _bd_asteroids(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        rock = _hex(scene.extras.get("rock", "#6b6078"))
        for _ in range(9):
            x, y, r = rng.randint(0, FRAME_W), rng.randint(0, 300), rng.randint(14, 50)
            d.regular_polygon((x, y, r), rng.randint(6, 9), rotation=rng.randint(0, 60), fill=rock, outline=(40, 36, 50, 255))
        d.ellipse((-150, 430, FRAME_W + 150, 900), fill=rock, outline=(40, 36, 50, 255), width=4)
        cry = _hex(scene.extras.get("crystal", "#59fdd0"))
        for x in (90, 180, 640, 720):
            d.polygon([(x - 16, 470), (x + 16, 470), (x, 400)], fill=cry, outline=(255, 255, 255, 220))
        ctx["visor"] = (400, 270, 140)

    def _after_asteroids(self, canvas, scene, rng, ctx):
        cx, cy, r = ctx["visor"]
        self._glow_line(canvas, [(cx + r * 1.2, cy + r * 1.4), (660, 450)], (89, 253, 208, 255), 12)
        d = ImageDraw.Draw(canvas)
        d.ellipse((cx - 20, cy - r * 1.12 - 18, cx + 20, cy - r * 1.12 + 6), fill=(255, 245, 190, 255))  # headlamp

    def _bd_ice(self, canvas, scene, rng, ctx):
        aur = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ad = ImageDraw.Draw(aur)
        for i, col in enumerate(((89, 253, 208, 120), (123, 108, 255, 110))):
            ad.arc((-200, 40 + i * 40, FRAME_W + 200, 500 + i * 40), 190, 350, fill=col, width=40)
        canvas.alpha_composite(aur.filter(ImageFilter.GaussianBlur(14)))
        d = ImageDraw.Draw(canvas)
        for x, hgt in ((60, 220), (150, 160), (660, 240), (740, 170)):
            d.polygon([(x - 40, 470), (x + 40, 470), (x, 470 - hgt)], fill=(190, 230, 255, 255), outline=(255, 255, 255, 255))
        self._ground(canvas, scene.extras.get("ground", "#dff4ff"), rng, level=0.8, bumps=8)
        ctx["visor"] = (400, 270, 145)

    def _after_ice(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        for _ in range(40):
            x, y = rng.randint(0, FRAME_W), rng.randint(0, FRAME_H)
            d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 255, 255, 230))

    def _bd_jungle(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        for x, y, r, col in ((90, 380, 90, "#ff7ae0"), (700, 360, 110, "#7b6cff"), (620, 470, 60, "#59fdd0")):
            d.rectangle((x - 12, y, x + 12, FRAME_H), fill=(220, 230, 200, 255))
            d.chord((x - r, y - r * 0.8, x + r, y + r * 0.6), 180, 360, fill=_hex(col))
        for _ in range(3):  # jellyfish
            x, y = rng.randint(80, 720), rng.randint(40, 180)
            d.chord((x - 26, y - 20, x + 26, y + 24), 180, 360, fill=(200, 160, 255, 200))
            for k in range(4):
                d.line((x - 15 + k * 10, y + 2, x - 18 + k * 10, y + 40), fill=(200, 160, 255, 200), width=3)
        ctx["poster"] = (250, 70, 300, 360)

    def _after_jungle(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.line([(0, 0), (200, 120), (300, 40), (500, 140), (FRAME_W, 20)], fill=(60, 140, 60, 255), width=8, joint="curve")
        for x in range(20, FRAME_W, 70):
            d.ellipse((x, 60 + (x % 3) * 20, x + 26, 80 + (x % 3) * 20), fill=(90, 190, 90, 255))

    def _bd_desert(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        for sx, sy, sr, col in ((600, 250, 70, "#fff0b0"), (700, 300, 40, "#ffb07a")):
            d.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=_hex(col))
        for i, col in enumerate(("#c98a3a", "#b0702a", "#8a5520")):
            y = 380 + i * 60
            d.chord((-300 + i * 200, y, 700 + i * 200, y + 400), 180, 360, fill=_hex(col))
        ctx["poster"] = (140, 60, 300, 360)

    def _after_desert(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.rounded_rectangle((470, 470, 700, 510), radius=20, fill=(70, 80, 110, 255), outline=(255, 210, 138, 255), width=4)
        for i in range(4):
            d.line((460 - i * 40, 480 + i * 8, 380 - i * 60, 480 + i * 8), fill=(255, 230, 180, 180), width=3)

    def _bd_cantina(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.rectangle((0, 430, FRAME_W, FRAME_H), fill=(60, 30, 20, 255))
        d.rectangle((0, 420, FRAME_W, 436), fill=(120, 70, 40, 255))
        for i, col in enumerate(("#59fdd0", "#ffb547", "#ff6b7a", "#7b6cff")):
            x = 470 + i * 70
            d.rounded_rectangle((x, 330, x + 30, 420), radius=8, fill=_hex(col, 220))
        for x in (560, 650, 740):  # band silhouettes
            d.ellipse((x - 26, 200, x + 26, 250), fill=(20, 10, 30, 255))
            d.rounded_rectangle((x - 36, 250, x + 36, 330), radius=20, fill=(20, 10, 30, 255))
            d.ellipse((x - 18, 212, x - 6, 224), fill=(182, 255, 92, 255))
        self._glow_line(canvas, [(460, 60), (760, 60)], (255, 122, 224, 255), 10)
        ImageDraw.Draw(canvas).text((520, 80), scene.extras.get("label", "CANTINA"), font=_font(34), fill=(255, 122, 224, 255))
        ctx["poster"] = (60, 80, 330, 330)

    def _after_cantina(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.polygon([(420, 360), (460, 360), (450, 420), (430, 420)], fill=(89, 253, 208, 200), outline=(255, 255, 255, 230))

    def _bd_podium(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        for (x0, top, label) in ((150, 440, "2"), (300, 380, "1"), (500, 470, "3")):
            d.rectangle((x0, top, x0 + 200 if label == "1" else x0 + 150, FRAME_H), fill=(60, 64, 110, 255), outline=(255, 210, 63, 255), width=3)
            d.text((x0 + 60, top + 20), label, font=_font(40), fill=(255, 210, 63, 255))
        for _ in range(70):
            x, y = rng.randint(0, FRAME_W), rng.randint(0, 420)
            d.rectangle((x, y, x + 8, y + 4), fill=_hex(rng.choice(("#ff6b7a", "#59fdd0", "#ffd23f", "#7b6cff"))))
        for fx, fy in ((120, 110), (690, 90)):
            for a in range(0, 360, 30):
                d.line((fx, fy, fx + math.cos(math.radians(a)) * 55, fy + math.sin(math.radians(a)) * 55), fill=(255, 210, 63, 255), width=3)
        ctx["poster"] = (270, 40, 260, 320)

    def _after_podium(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.polygon([(560, 250), (640, 250), (620, 320), (580, 320)], fill=(255, 210, 63, 255))
        d.rectangle((590, 320, 610, 350), fill=(255, 210, 63, 255))
        d.rectangle((570, 350, 630, 362), fill=(200, 160, 40, 255))

    def _bd_station_exterior(self, canvas, scene, rng, ctx):
        d = ImageDraw.Draw(canvas)
        d.ellipse((-220, 380, 380, 980), fill=_hex(scene.extras.get("planet", "#3a8dff")))
        d.arc((-190, 410, 350, 950), 250, 330, fill=(180, 230, 255, 255), width=12)
        d.rounded_rectangle((330, -40, FRAME_W + 40, FRAME_H + 40), radius=60, fill=(150, 158, 180, 255), outline=(90, 98, 120, 255), width=6)
        for y in range(40, FRAME_H, 110):
            d.line((330, y, FRAME_W, y), fill=(120, 128, 150, 255), width=3)

    # ------------------------------------------------------------ frames
    def _fr_visor(self, canvas, photo, a, scene, rng, ctx):
        cx, cy, r = ctx.get("visor", (400, 280, 145))
        d = ImageDraw.Draw(canvas)
        top = cy + r * 0.72
        suit = (238, 226, 205, 255) if scene.backdrop == "ice" else (232, 236, 245, 255)
        d.rounded_rectangle((cx - r * 1.6, top, cx + r * 1.6, FRAME_H + 60), radius=int(r * 0.6), fill=suit, outline=(150, 160, 185, 255), width=5)
        d.rounded_rectangle((cx - r * 0.55, top + r * 0.35, cx + r * 0.55, top + r * 0.8), radius=10, fill=(60, 70, 95, 255))
        for i, col in enumerate(("#59fdd0", "#ffb547", "#ff6b7a")):
            bx = cx - r * 0.33 + i * r * 0.33
            d.ellipse((bx - 8, top + r * 0.575 - 8, bx + 8, top + r * 0.575 + 8), fill=_hex(col))
        d.ellipse((cx - r * 1.12, cy - r * 1.12, cx + r * 1.12, cy + r * 1.12), fill=(225, 230, 242, 255), outline=(150, 160, 185, 255), width=5)
        face, _ = crop_around(photo, a.face_bbox, 2 * r, 2 * r, pad=1.7)
        self._paste_shaped(canvas, face, (int(cx - r), int(cy - r)), "circle")
        glass = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        g = ImageDraw.Draw(glass)
        g.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(200, 230, 255, 30), outline=(220, 240, 255, 240), width=6)
        g.arc((cx - r * 0.85, cy - r * 0.88, cx + r * 0.2, cy + r * 0.1), 200, 255, fill=(255, 255, 255, 190), width=9)
        canvas.alpha_composite(glass)

    def _fr_screen(self, canvas, photo, a, scene, rng, ctx):
        hud = _hex(scene.extras.get("hud", "#59fdd0"))
        d = ImageDraw.Draw(canvas)
        if scene.backdrop == "warp":  # cockpit canopy frame + console
            frame_col, edge = (18, 20, 34, 255), (60, 66, 100, 255)
            d.polygon([(0, 0), (120, 0), (40, FRAME_H), (0, FRAME_H)], fill=frame_col, outline=edge)
            d.polygon([(FRAME_W, 0), (FRAME_W - 120, 0), (FRAME_W - 40, FRAME_H), (FRAME_W, FRAME_H)], fill=frame_col, outline=edge)
            d.polygon([(0, 0), (FRAME_W, 0), (FRAME_W - 150, 40), (150, 40)], fill=frame_col, outline=edge)
        if a.close_up:
            sw, sh = 276, 340
            cam, _ = crop_around(photo, a.subject_bbox, sw, sh, pad=1.0, lift=0)
        else:
            sw, sh = 400, 300
            cam, _ = crop_around(photo, a.face_bbox, sw, sh, pad=3.0, top_margin=0.45)
        if scene.backdrop == "mech":  # chest cockpit window
            scale = 0.72
            sw, sh = int(sw * scale), int(sh * scale)
            cam = cam.resize((sw, sh), Image.LANCZOS)
            sx, sy = (FRAME_W - sw) // 2, 290 - sh // 2
        elif scene.backdrop == "bridge":
            sx, sy = 90, 70 if a.close_up else 110
        else:
            sx, sy = (FRAME_W - sw) // 2, 92 if a.close_up else 110
        d.rounded_rectangle((sx - 10, sy - 10, sx + sw + 10, sy + sh + 10), radius=24, fill=(10, 12, 24, 255), outline=hud, width=4)
        self._paste_shaped(canvas, cam, (sx, sy), "rounded")
        d = ImageDraw.Draw(canvas)
        d.text((sx + 14, sy + 10), "● " + ("PILOT CAM" if scene.backdrop != "bridge" else "CAPTAIN"), font=_font(16), fill=hud)
        if scene.backdrop == "warp":
            d.polygon([(0, FRAME_H * 0.8), (FRAME_W, FRAME_H * 0.8), (FRAME_W, FRAME_H), (0, FRAME_H)], fill=(24, 28, 48, 255))
            d.line((0, FRAME_H * 0.8, FRAME_W, FRAME_H * 0.8), fill=hud, width=3)
            for i in range(14):
                bx = 70 + i * 48
                d.rounded_rectangle((bx, FRAME_H * 0.85, bx + 32, FRAME_H * 0.85 + 18), radius=5,
                                    fill=hud if rng.random() > 0.3 else _hex(rng.choice(("#ffb547", "#ff6b7a", "#7b6cff"))))
        d.text((150 if scene.backdrop == "warp" else 60, 50 if scene.backdrop == "warp" else FRAME_H - 90),
               scene.extras.get("label", ""), font=_font(22), fill=hud)

    def _fr_porthole(self, canvas, photo, a, scene, rng, ctx):
        cx, cy, r = 565, 290, 170
        inside = Image.new("RGB", (2 * r, 2 * r), (30, 36, 60))
        face, _ = crop_around(photo, a.face_bbox, 2 * r, 2 * r, pad=1.9)
        inside.paste(face.rotate(-10, resample=Image.BICUBIC, fillcolor=(30, 36, 60)))
        idr = ImageDraw.Draw(inside)
        idr.ellipse((40, 250, 88, 290), fill=(110, 60, 30), outline=(160, 100, 60), width=3)
        idr.ellipse((250, 40, 300, 90), fill=(240, 150, 190), outline=(180, 90, 130), width=3)
        idr.ellipse((266, 56, 284, 74), fill=(30, 36, 60))
        self._paste_shaped(canvas, inside, (cx - r, cy - r), "circle")
        d = ImageDraw.Draw(canvas)
        d.ellipse((cx - r - 10, cy - r - 10, cx + r + 10, cy + r + 10), outline=(80, 88, 112, 255), width=20)
        for ang in range(0, 360, 30):
            bx, by = cx + math.cos(math.radians(ang)) * (r + 10), cy + math.sin(math.radians(ang)) * (r + 10)
            d.ellipse((bx - 5, by - 5, bx + 5, by + 5), fill=(190, 196, 215, 255))

    def _fr_hologram(self, canvas, photo, a, scene, rng, ctx):
        hw, hh = 380, 440
        holo, (fx0, fy0, fx1, fy1) = crop_around(photo, a.face_bbox, hw, hh, pad=1.8)
        hue = scene.extras.get("tint_hue")
        if hue is not None:
            holo = self._tint(holo, hue, 0.45 if not scene.transform else 0.6)
        if scene.extras.get("feature") == "circuits":
            holo = Image.blend(holo, ImageOps.grayscale(holo).convert("RGB"), 0.5)
        lines = Image.new("RGBA", holo.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(lines)
        for y in range(0, hh, 5):
            ld.line((0, y, hw, y), fill=(0, 0, 0, 55))
        holo = Image.alpha_composite(holo.convert("RGBA"), lines).convert("RGB")
        ox, oy = (FRAME_W - hw) // 2, 50
        accent = _hex(scene.extras.get("accent", "#59fdd0"))
        beam = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(beam)
        bd.polygon([(FRAME_W / 2 - 60, FRAME_H - 40), (FRAME_W / 2 + 60, FRAME_H - 40), (ox + hw - 20, oy + hh - 40), (ox + 20, oy + hh - 40)], fill=accent[:3] + (70,))
        bd.ellipse((ox - 20, oy - 20, ox + hw + 20, oy + hh + 20), fill=accent[:3] + (60,))
        canvas.alpha_composite(beam.filter(ImageFilter.GaussianBlur(18)))
        self._paste_shaped(canvas, holo, (ox, oy), "oval", feather=22)
        d = ImageDraw.Draw(canvas)
        d.ellipse((FRAME_W / 2 - 110, FRAME_H - 58, FRAME_W / 2 + 110, FRAME_H - 22), fill=(40, 44, 70, 255), outline=accent, width=4)
        cx, top, fw, fh = ox + (fx0 + fx1) / 2, oy + fy0, fx1 - fx0, fy1 - fy0
        feature = scene.extras.get("feature")
        if feature == "antennae":
            for side in (-1, 1):
                x0, y0 = cx + side * fw * 0.22, top + fh * 0.05
                pts = [(x0 + side * fw * 0.18 * t + side * math.sin(t * 3) * 6, y0 - fh * 0.55 * t) for t in [i / 12 for i in range(13)]]
                d.line(pts, fill=(40, 70, 20, 255), width=9, joint="curve")
                d.line(pts, fill=accent, width=5, joint="curve")
                ex, ey = pts[-1]
                d.ellipse((ex - 15, ey - 15, ex + 15, ey + 15), fill=accent, outline=(255, 255, 255, 200), width=3)
        elif feature == "third_eye":
            ey = top + fh * 0.2
            glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            ImageDraw.Draw(glow).ellipse((cx - 36, ey - 22, cx + 36, ey + 22), fill=accent)
            canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(12)))
            d = ImageDraw.Draw(canvas)
            d.ellipse((cx - 20, ey - 12, cx + 20, ey + 12), fill=(255, 255, 255, 255), outline=(20, 30, 60, 255), width=3)
            d.ellipse((cx - 8, ey - 8, cx + 8, ey + 8), fill=accent)
            d.ellipse((cx - 3, ey - 3, cx + 3, ey + 3), fill=(0, 0, 0, 255))
        elif feature == "crystals":
            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            ld2 = ImageDraw.Draw(layer)
            for i in range(7):
                t = (i - 3) / 3
                bx, by = cx + t * fw * 0.4, top + fh * 0.08 * abs(t)
                hgt = fh * (0.45 - 0.15 * abs(t)) * rng.uniform(0.8, 1.2)
                ld2.polygon([(bx - 14, by + 8), (bx + 14, by + 8), (bx + t * 20, by - hgt)], fill=accent[:3] + (190,), outline=(255, 255, 255, 230))
            canvas.alpha_composite(layer)
        elif feature == "circuits":
            for i in range(6):
                y = oy + 80 + i * 55
                x0 = ox + 40 + (i % 2) * 30
                d.line([(x0, y), (x0 + 60, y), (x0 + 80, y + 20), (x0 + 140, y + 20)], fill=accent, width=3)
                d.ellipse((x0 + 136, y + 16, x0 + 146, y + 26), fill=accent)

    def _fr_poster(self, canvas, photo, a, scene, rng, ctx):
        x, y, w, hgt = ctx.get("poster", (250, 70, 300, 360))
        shape = scene.extras.get("shape", "rounded")
        box = a.face_bbox if a.close_up or shape == "oval" else a.face_bbox
        img, _ = crop_around(photo, box, w, hgt, pad=2.0 if shape == "oval" else 2.6, top_margin=None if shape == "oval" else 0.5)
        accent = _hex(scene.extras.get("accent", "#ff7ae0"))
        glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        if shape == "oval":
            gd.ellipse((x - 14, y - 14, x + w + 14, y + hgt + 14), outline=accent, width=14)
        else:
            gd.rounded_rectangle((x - 14, y - 14, x + w + 14, y + hgt + 14), radius=34, outline=accent, width=14)
        canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(8)))
        self._paste_shaped(canvas, img, (x, y), "circle" if shape == "oval" else "rounded")
        d = ImageDraw.Draw(canvas)
        if shape == "oval":
            d.ellipse((x - 6, y - 6, x + w + 6, y + hgt + 6), outline=accent, width=5)
        else:
            d.rounded_rectangle((x - 6, y - 6, x + w + 6, y + hgt + 6), radius=30, outline=accent, width=5)

    @staticmethod
    def _finish(canvas: Image.Image, scene: Scene) -> Image.Image:
        vig = Image.new("L", canvas.size, 0)
        ImageDraw.Draw(vig).ellipse((-120, -90, FRAME_W + 120, FRAME_H + 90), fill=255)
        vig = ImageChops.invert(vig.filter(ImageFilter.GaussianBlur(90)))
        dark = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        dark.putalpha(vig.point(lambda p: int(p * 0.55)))
        canvas = Image.alpha_composite(canvas, dark)
        d = ImageDraw.Draw(canvas)
        label, f = scene.title.upper(), _font(20)
        tw = d.textlength(label, font=f)
        d.rounded_rectangle((16, FRAME_H - 46, 16 + tw + 28, FRAME_H - 14), radius=16, fill=(0, 0, 0, 140))
        d.text((30, FRAME_H - 42), label, font=f, fill=(238, 240, 255, 255))
        return canvas


# --------------------------------------------------------------------------
# Amazon Bedrock (UNTESTED: needs Bedrock model access in us-west-2)
# --------------------------------------------------------------------------

class BedrockImageProvider:
    """UNTESTED. Stability AI Image Services on Bedrock, Nova Canvas as fallback.

    Model IDs to confirm in the console before the show:
      stability.stable-image-control-structure-v1:0
      amazon.nova-canvas-v1:0
    """

    name = "bedrock"

    def __init__(self) -> None:
        import boto3  # lazy: only needed when this provider is selected

        from ..config import settings

        self._rt = boto3.client("bedrock-runtime", region_name=settings.aws_region)

    def _invoke(self, model_id: str, body: dict) -> dict:
        res = self._rt.invoke_model(modelId=model_id, body=json.dumps(body), accept="application/json",
                                    contentType="application/json")
        return json.loads(res["body"].read())

    def render_scene(self, photo_jpg: bytes, scene: Scene, prompt: str, analysis: PhotoAnalysis) -> bytes:
        b64 = base64.b64encode(photo_jpg).decode()
        try:
            # Structure control keeps the visitor's pose and face layout.
            out = self._invoke("stability.stable-image-control-structure-v1:0", {
                "image": b64, "prompt": prompt, "control_strength": 0.65, "output_format": "png"})
        except Exception:  # noqa: BLE001
            out = self._invoke("amazon.nova-canvas-v1:0", {
                "taskType": "IMAGE_VARIATION",
                "imageVariationParams": {"text": prompt, "images": [b64], "similarityStrength": 0.7},
                "imageGenerationConfig": {"numberOfImages": 1, "width": 1024, "height": 768},
            })
        return base64.b64decode(out["images"][0])


# --------------------------------------------------------------------------
# OpenAI
# --------------------------------------------------------------------------

class OpenAIImageProvider:
    """OpenAI image edits. One call per frame, straight from the original photo:
    the model re-renders the person into the scene itself, so there's no
    background removal step (one fewer round trip, no mask edges)."""

    name = "openai"

    def __init__(self) -> None:
        from openai import OpenAI  # lazy: optional dependency

        from ..config import settings

        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not set on this worker")
        self._s = settings
        # SDK retries are off: Temporal owns retries (and shows them in the UI).
        self._client = OpenAI(api_key=settings.openai_api_key, max_retries=0, timeout=150)

    def render_scene(self, photo_jpg: bytes, scene: Scene, prompt: str, analysis: PhotoAnalysis) -> bytes:
        import openai

        s = self._s
        kw: dict = {}
        if s.openai_input_fidelity:
            kw["input_fidelity"] = s.openai_input_fidelity
        extra = {"moderation": s.openai_moderation} if s.openai_moderation != "auto" else None
        try:
            res = self._client.images.edit(
                model=s.openai_image_model,
                image=("photo.jpg", photo_jpg, "image/jpeg"),
                prompt=prompt + " Wide landscape composition.",
                quality=s.openai_image_quality,
                size=s.openai_image_size,
                output_format="jpeg",
                output_compression=90,
                n=1,
                extra_body=extra,
                **kw,
            )
        except openai.BadRequestError as e:
            body = e.body if isinstance(e.body, dict) else {}
            err = body.get("error", body)
            code = getattr(e, "code", None) or (err.get("code") if isinstance(err, dict) else None)
            if code in ("moderation_blocked", "content_policy_violation") or "moderation_blocked" in str(e):
                raise ContentPolicyError(str(e)) from e
            raise
        return base64.b64decode(res.data[0].b64_json)
