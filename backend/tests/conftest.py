"""Keep tests hermetic: never call real AI or email providers, even when the
developer's shell has API keys exported."""

import os

for var in ("OPENAI_API_KEY", "SENDGRID_API_KEY", "TEMPORAL_API_KEY", "HOLODECK_AGENTCORE_RUNTIME_ARN"):
    os.environ[var] = ""  # empty (not unset) so a backend/.env can't fill it back in
os.environ["HOLODECK_IMAGE_PROVIDER"] = "mock"
os.environ["HOLODECK_LLM_PROVIDER"] = "mock"
os.environ["HOLODECK_EMAIL_PROVIDER"] = "outbox"
