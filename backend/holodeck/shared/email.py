"""Email activity: SendGrid in production, a local outbox folder otherwise.

Every message gets the Temporal logo header added here, so no demo can send
an unbranded email.
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from temporalio import activity

from ..config import settings

OUTBOX = settings.data_dir / "outbox"
LOGO_PNG = Path(__file__).parent / "assets" / "temporal-logo-white.png"
LOGO_CID = "temporal-logo"
# Public URL for the logo once assets are hosted (S3/CloudFront). Most
# reliable across mail clients; otherwise SendGrid sends it as an inline
# attachment and the local outbox embeds it.
LOGO_URL = os.getenv("HOLODECK_EMAIL_LOGO_URL") or None


@dataclass
class EmailMessage:
    to: str
    subject: str
    html: str
    # Stable key so a retried send is recognisable (SendGrid custom arg / outbox filename).
    idempotency_key: str
    attachments: list[str] = field(default_factory=list)  # paths under media_dir


def branded_html(body: str, logo_src: str) -> str:
    """Wrap a demo's email body with the Temporal logo header."""
    return f"""<div style="background:#05060d;margin:0;padding:0">
  <div style="padding:28px 32px 4px;text-align:center">
    <img src="{logo_src}" width="44" height="44" alt="Temporal"
      style="display:inline-block;vertical-align:middle;border:0;width:44px;height:44px">
    <span style="display:inline-block;vertical-align:middle;margin-left:12px;color:#ffffff;
      font-family:Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;letter-spacing:0.5px">Temporal</span>
  </div>
  {body}
</div>"""


def _logo_b64() -> str:
    return base64.b64encode(LOGO_PNG.read_bytes()).decode()


@activity.defn
async def send_email(msg: EmailMessage) -> str:
    if settings.email_provider == "sendgrid" and settings.sendgrid_api_key:
        payload: dict = {
            "personalizations": [{"to": [{"email": msg.to}]}],
            "from": {"email": settings.email_from, "name": "Temporal Holodeck"},
            "subject": msg.subject,
            "content": [{"type": "text/html", "value": branded_html(msg.html, LOGO_URL or f"cid:{LOGO_CID}")}],
            "custom_args": {"idempotency_key": msg.idempotency_key},
        }
        if not LOGO_URL:
            payload["attachments"] = [{
                "content": _logo_b64(), "type": "image/png", "filename": "temporal-logo.png",
                "disposition": "inline", "content_id": LOGO_CID,
            }]
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {settings.sendgrid_api_key}"},
                json=payload,
            )
            r.raise_for_status()
        return "sendgrid"

    OUTBOX.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w.-]", "_", msg.idempotency_key)
    path = OUTBOX / f"{safe}.html"
    html = branded_html(msg.html, LOGO_URL or f"data:image/png;base64,{_logo_b64()}")
    path.write_text(f"<!-- to: {msg.to} | subject: {msg.subject} -->\n{html}")
    activity.logger.info("Email written to outbox: %s", path)
    return str(path)
