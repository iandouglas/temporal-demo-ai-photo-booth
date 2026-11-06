"""Every outgoing email carries the Temporal logo header."""

import json

import httpx
from temporalio.testing import ActivityEnvironment

from holodeck.shared import email as email_mod
from holodeck.shared.email import EmailMessage, send_email


def _msg(key: str) -> EmailMessage:
    return EmailMessage(to="ben@example.com", subject="hi", html="<p>body</p>", idempotency_key=key)


async def test_outbox_email_has_embedded_logo():
    path = await ActivityEnvironment().run(send_email, _msg("logo-outbox"))
    html = open(path).read()
    assert 'alt="Temporal"' in html and "data:image/png;base64," in html and "<p>body</p>" in html


async def test_sendgrid_email_attaches_inline_logo(monkeypatch):
    sent: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(json.loads(request.content))
        return httpx.Response(202)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(email_mod.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(email_mod, "settings", type("S", (), {**{k: getattr(email_mod.settings, k) for k in ("email_from", "data_dir")},
                                                               "email_provider": "sendgrid", "sendgrid_api_key": "test"})())
    assert await ActivityEnvironment().run(send_email, _msg("logo-sg")) == "sendgrid"
    assert 'src="cid:temporal-logo"' in sent["content"][0]["value"]
    att = sent["attachments"][0]
    assert att["content_id"] == "temporal-logo" and att["disposition"] == "inline" and att["type"] == "image/png"
