"""Scene catalog and prompt templates for the Holo-Booth.

18 scenes, each in its own setting category. A strip takes 4 scenes with 4
different categories and at most one transformation-type frame (and at most
one "at the controls" frame), chosen with ``workflow.random()`` so replays are
deterministic.

Two prompt styles (HOLODECK_PHOTOBOOTH_STYLE):
- ``inspired`` (default): the photo is a likeness reference for a brand-new
  cinematic scene with its own pose, camera angle, lighting and costume.
- ``photo``: edit the visitor's actual photo, keeping its pose and framing.

Each scene also has a mock recipe (``backdrop`` + ``frame``) for the offline renderer.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Scene:
    id: str
    category: str  # unique setting category
    title: str
    action: str  # what the hero is doing, where; shared by both prompt styles
    backdrop: str  # mock: scenery painter
    frame: str  # mock: how the photo is shown (visor, screen, porthole, hologram, poster)
    sky: tuple[str, str] = ("#0b0630", "#2a0f5e")
    extras: dict = field(default_factory=dict)
    transform: bool = False  # turns the visitor into something (max one per strip)
    family: str = ""  # scenes in the same family are too alike to share a strip


SCENES: list[Scene] = [
    Scene("starfighter_ace", "cockpit", "Starfighter Ace",
          "a starfighter pilot gripping the flight stick in a sleek cockpit, stars streaking past at warp speed, glowing holographic HUD",
          "warp", "screen", ("#000010", "#101a4a"), {"hud": "#59fdd0", "label": "TEMPORAL-1"}, family="helm"),
    Scene("bridge_captain", "bridge", "Captain on the Bridge",
          "a starship captain standing tall on a vast command bridge, giving orders in front of a giant viewscreen showing a ringed planet",
          "bridge", "screen", ("#050a1e", "#1d2b5c"), {"hud": "#ffb547", "label": "BRIDGE · DECK 1"}, family="helm"),
    Scene("mech_pilot", "mech", "Mech Commander",
          "piloting a towering friendly battle mech, hatch open, striding across a neon hangar bay",
          "mech", "screen", ("#140a1e", "#3a1d5c"), {"hud": "#ff6b7a", "label": "MECH-07"}, family="helm"),
    Scene("kepler_explorer", "planet_explorer", "Explorer of Kepler-T",
          "a planetary explorer in a sleek white spacesuit with a clear bubble helmet, planting a flag on a rocky orange alien world under a giant ringed planet",
          "ringworld", "visor", ("#1a0b2e", "#ff8a4c"), {"ground": "#6b2e1a", "planet": "#ffcf7a"}),
    Scene("slug_patrol", "creature_battle", "Space Slug Patrol",
          "a space ranger in armored gear heroically blasting goofy giant green space slugs with a glowing toy-like blaster on a teal world with two suns (cartoonish action, no gore)",
          "slugs", "visor", ("#003333", "#3fbfa0"), {"ground": "#0d3b2e"}),
    Scene("zero_g", "zero_g_station", "Zero-G Coffee Break",
          "floating weightless inside a cozy space station module, a wobbling coffee blob and snacks drifting by, a blue planet glowing in the big window",
          "station_exterior", "porthole", ("#020412", "#0b1840"), {"planet": "#3a8dff"}),
    Scene("spacewalk", "spacewalk", "Spacewalk Repair Crew",
          "on a daring spacewalk, tethered to the hull of a huge starship, tightening a glowing panel with Earth-like planet below",
          "hull", "visor", ("#000008", "#0a1030"), {"planet": "#2f7de0"}),
    Scene("asteroid_miner", "asteroid_miner", "Asteroid Miner",
          "an asteroid miner with a headlamp and a sparkling plasma drill, standing on a tumbling asteroid full of glowing crystals",
          "asteroids", "visor", ("#0a0a12", "#2a2438"), {"rock": "#6b6078", "crystal": "#59fdd0"}),
    Scene("ice_planet", "ice_planet", "Ice Planet Trailblazer",
          "a trailblazer in a fur-lined parka spacesuit on a sparkling ice planet, aurora overhead, riding a friendly snow-lizard",
          "ice", "visor", ("#0a1a3a", "#7fd3ff"), {"ground": "#dff4ff"}),
    Scene("jungle_ranger", "alien_jungle", "Alien Jungle Ranger",
          "a ranger swinging on a vine through a glowing alien jungle with giant bioluminescent mushrooms and curious floating jellyfish creatures",
          "jungle", "poster", ("#021a12", "#0c5a3a"), {"accent": "#b6ff5c", "shape": "oval"}),
    Scene("desert_nomad", "desert_world", "Twin-Sun Desert Nomad",
          "a hooded desert nomad on a hover-bike racing across golden dunes under two setting suns",
          "desert", "poster", ("#3a1a0a", "#ffb547"), {"accent": "#ffd28a", "shape": "oval"}),
    Scene("cantina", "cantina", "Cantina Legend",
          "the coolest regular at a neon-lit space cantina, raising a glowing drink with a band of friendly aliens playing behind them",
          "cantina", "poster", ("#1a0612", "#4a1030"), {"accent": "#ff7ae0", "shape": "rounded", "label": "CANTINA"}),
    Scene("grand_prix", "space_race", "Galactic Grand Prix Champion",
          "the champion on the top step of a galactic racing podium, holding a giant trophy while confetti and fireworks burst around them",
          "podium", "poster", ("#07071a", "#26206b"), {"accent": "#ffd23f", "shape": "rounded", "label": "CHAMPION"}),
    Scene("holo_message", "hologram", "Holo-Message from HQ",
          "appearing as a shimmering blue hologram projected above a starship console, delivering an urgent mission briefing",
          "nebula", "hologram", ("#001a33", "#0a4d8c"), {"accent": "#5ec8ff", "tint_hue": 0.55, "feature": ""}),
    Scene("zorblaxian", "alien_transformation", "Zorblaxian Ambassador",
          "transformed into a friendly green-skinned alien ambassador with two springy antennae and a shimmering silver collar, greeting visitors in front of a purple nebula",
          "nebula", "hologram", ("#12002b", "#5b1a8f"), {"accent": "#b6ff5c", "tint_hue": 0.28, "feature": "antennae"}, transform=True),
    Scene("nebulon", "alien_oracle", "Nebulon Oracle",
          "transformed into a serene blue-skinned alien oracle with a glowing third eye and star freckles, floating in a cosmic temple",
          "nebula", "hologram", ("#001a33", "#0a4d8c"), {"accent": "#7fd3ff", "tint_hue": 0.6, "feature": "third_eye"}, transform=True),
    Scene("vexari", "crystal_being", "Crystalline Vexari",
          "transformed into a magenta crystal being with sparkling crystal spikes on the head and softly glowing skin, inside a crystal cave",
          "nebula", "hologram", ("#2b0022", "#8c1a6b"), {"accent": "#ff7ae0", "tint_hue": 0.86, "feature": "crystals"}, transform=True),
    Scene("android", "android", "Chrome Android Upgrade",
          "transformed into a gleaming friendly chrome android with glowing circuit lines, in a futuristic robotics lab",
          "lab", "hologram", ("#0a0f14", "#23313d"), {"accent": "#59fdd0", "tint_hue": 0.52, "feature": "circuits"}, transform=True),
]

# Used when a provider refuses a scene twice (content policy). Deliberately bland.
FALLBACK = Scene("star_portrait", "fallback", "Starfarer Portrait",
                 "a proud space-academy graduate in a smart navy uniform, soft starfield and a distant blue planet behind",
                 "nebula", "hologram", ("#020412", "#0b1840"), {"accent": "#7b6cff", "tint_hue": None, "feature": ""})

BY_ID = {s.id: s for s in SCENES + [FALLBACK]}
assert len({s.category for s in SCENES}) == len(SCENES), "categories must be unique"


def pick_four(rand) -> list[str]:
    """4 scenes, 4 different categories, at most one transformation and one per family.

    ``rand`` must be ``workflow.random()`` so the choice is deterministic on replay.
    """
    pool = list(SCENES)
    rand.shuffle(pool)
    chosen: list[Scene] = []
    for s in pool:
        if any(c.category == s.category for c in chosen):
            continue
        if s.transform and any(c.transform for c in chosen):
            continue
        if s.family and any(c.family == s.family for c in chosen):
            continue
        chosen.append(s)
        if len(chosen) == 4:
            break
    return [s.id for s in chosen]


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_TAIL = ("Fun, heroic and family-friendly; any action is cartoonish with no gore. "
         "Cinematic lighting, rich detail, wide 3:2 composition.")


def _inspired(scene: Scene, crew: bool, appearance: str, usable: bool) -> str:
    who = ("characters who look very much like the people in the reference photo: each one's face, hairstyle and "
           "facial hair clearly recognisable as them, together as a crew") if crew else \
          ("a character who looks very much like the person in the reference photo: the same face, hairstyle and "
           "facial hair, instantly recognisable as them")
    hero = "The heroes are" if crew else "The hero is"
    body = (f"Create a brand-new cinematic sci-fi scene titled '{scene.title}': {scene.action}. {hero} {who}.")
    if scene.transform:
        body += " Even transformed, keep their face shape, features and hairstyle recognisable."
    if appearance and usable:
        body += f" Keep visible details from the photo: {appearance.strip().rstrip('.')}."
    body += (" Invent a new pose, camera angle, lighting and costume that suit the scene; do not copy the photo's"
             " pose, background or clothing.")
    if not usable:
        body += " If no face is clearly visible in the reference photo, invent a friendly cartoon astronaut hero instead."
    return f"{body} {_TAIL}"


def _photo(scene: Scene, framing: str, crew: bool, appearance: str, usable: bool) -> str:
    who = "these people" if crew else "this person"
    body = (f"Edit this photo into a sci-fi scene titled '{scene.title}': show {who} as {scene.action}. "
            f"Keep {'each' if crew else 'the'} person's face, expression, pose and identity clearly recognisable.")
    if framing == "head_only":
        body += " Keep the tight head-and-face framing."
    if crew:
        body += " Include everyone from the photo."
    if appearance and usable:
        body += f" Keep visible details: {appearance.strip().rstrip('.')}."
    if not usable:
        body += " If no person is clearly visible in the photo, create a friendly cartoon astronaut character in their place."
    return f"{body} {_TAIL}"


def soft_prompt(scene: Scene, crew: bool = False) -> str:
    """Gentler wording for a retry after a content-policy refusal: no weapons,
    no transformation, just a cheerful costume and setting."""
    who = "the people in the reference photo, recognisable as them" if crew else \
          "a character who looks like the person in the reference photo"
    return (f"A cheerful, family-friendly sci-fi portrait themed '{scene.title}' featuring {who}, "
            f"in a colorful space costume with a friendly {scene.category.replace('_', ' ')} setting. "
            f"No weapons, no action. {_TAIL}")


def scene_prompt(scene: Scene, framing: str = "head_shoulders", face_count: int = 1, usable: bool = True,
                 appearance: str = "", soft: bool = False, style: str = "inspired") -> str:
    """The prompt actually sent to the image model."""
    crew = face_count > 1
    if soft:
        return soft_prompt(scene, crew)
    if style == "photo":
        return _photo(scene, framing, crew, appearance, usable)
    return _inspired(scene, crew, appearance, usable)
