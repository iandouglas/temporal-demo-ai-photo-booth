"""Runtime configuration, read from environment (and an optional .env file).

Every AI provider defaults to ``mock`` so the whole Holodeck runs offline
against a local ``temporal server start-dev`` with no cloud credentials.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
# The backend's own .env wins over the shell, so a stale OPENAI_API_KEY in the
# launching shell can't replace the working key configured here.
load_dotenv(ROOT / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    temporal_address: str = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")
    temporal_namespace: str = os.getenv("TEMPORAL_NAMESPACE", "default")
    temporal_api_key: str | None = os.getenv("TEMPORAL_API_KEY") or None
    station: str = os.getenv("HOLODECK_STATION", "laptop")

    # mock | bedrock | openai. Unset = openai when OPENAI_API_KEY is present, else mock.
    image_provider: str = os.getenv("HOLODECK_IMAGE_PROVIDER") or ("openai" if os.getenv("OPENAI_API_KEY") else "mock")
    # mock | bedrock | agentcore
    llm_provider: str = os.getenv("HOLODECK_LLM_PROVIDER", "mock")
    # outbox (write .html files locally) | sendgrid
    email_provider: str = os.getenv("HOLODECK_EMAIL_PROVIDER", "outbox")

    aws_region: str = os.getenv("AWS_REGION", "us-west-2")
    bedrock_text_model: str = os.getenv("HOLODECK_BEDROCK_TEXT_MODEL", "us.anthropic.claude-sonnet-5")
    agentcore_runtime_arn: str | None = os.getenv("HOLODECK_AGENTCORE_RUNTIME_ARN") or None
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY") or None
    # Photo booth image edits (see docs/photobooth.md for why flare + medium).
    openai_image_model: str = os.getenv("HOLODECK_OPENAI_IMAGE_MODEL", "gpt-image-2.5-flare")
    openai_image_quality: str = os.getenv("HOLODECK_OPENAI_IMAGE_QUALITY", "medium")
    openai_image_size: str = os.getenv("HOLODECK_OPENAI_IMAGE_SIZE", "1536x1024")
    # Likeness to the reference photo: "high" (default; new poses cost likeness) | "low" | "" to omit.
    # gpt-image-2.5-* support it; gpt-image-2 ignores it.
    openai_input_fidelity: str | None = os.getenv("HOLODECK_OPENAI_INPUT_FIDELITY", "high") or None
    # inspired = new cinematic scene featuring someone who looks like the visitor; photo = edit their photo.
    photobooth_style: str = os.getenv("HOLODECK_PHOTOBOOTH_STYLE", "inspired")
    # auto (default, stricter) | low
    openai_moderation: str = os.getenv("HOLODECK_OPENAI_MODERATION", "auto")
    # Photo booth photo analysis (framing, face boxes). Small, fast, image input + structured outputs.
    openai_vision_model: str = os.getenv("HOLODECK_OPENAI_VISION_MODEL", "gpt-6-luna")
    sendgrid_api_key: str | None = os.getenv("SENDGRID_API_KEY") or None
    email_from: str = os.getenv("HOLODECK_EMAIL_FROM", "holodeck@example.com")

    # Chaos: probability (0-1) that a mock AI activity fails, to show retries.
    chaos_rate: float = float(os.getenv("HOLODECK_CHAOS_RATE", "0.25"))

    public_base_url: str = os.getenv("HOLODECK_PUBLIC_BASE_URL", "http://localhost:8600")
    data_dir: Path = Path(os.getenv("HOLODECK_DATA_DIR", str(ROOT / "data")))

    @property
    def task_queue(self) -> str:
        return os.getenv("TEMPORAL_TASK_QUEUE", f"photo-booth-{self.station}")

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"


settings = Settings()
settings.media_dir.mkdir(parents=True, exist_ok=True)
