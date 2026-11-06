# Photo Booth Runbook

These updates are only for AWS re:Invent 2026. Do not merge this branch into the default branch. Contact Ian Douglas or Tomas Josovsky with questions.

[Setup](#standalone-setup) | [Walkthrough](#walkthrough) | [Tests](#tests) | [Source](SOURCE.md)

## Standalone Setup

Use uv, Python 3.12+, Node 22.23.2/npm 10.9.8 and the latest Temporal CLI. Install while online:

```bash
(cd backend && uv sync --extra aws --extra openai)
(cd web && npm ci && npm run build)
```

For the booth, use the bundle Config panel below. For an independent local rehearsal, run these in separate terminals from this repo, keeping local data between runs:

```bash
mkdir -p tmp
temporal server start-dev --db-filename tmp/temporal.db
```

```bash
cd backend
uv run --no-sync python -m holodeck.worker
```

```bash
cd backend
uv run --no-sync uvicorn holodeck.server:app --host 127.0.0.1 --port 8600
```

```bash
cd web
npm run dev -- --host 127.0.0.1 --port 5600 --strictPort
```

Open [localhost:5600](http://127.0.0.1:5600). The API health route is [localhost:8600/api/health](http://127.0.0.1:8600/api/health); check local Temporal separately on port 7233.

For standalone Cloud runs, export `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY`, `HOLODECK_STATION` and `TEMPORAL_TASK_QUEUE` in both backend terminals. `backend/.env` is also supported. Exported values take precedence. The standalone default is local Temporal; the bundle's initial mode is Cloud.

## Walkthrough

Use camera permission or append `?testcam=1` for the synthetic camera. Submit a synthetic visitor and email, wait for four frames, then verify the local outbox and Workflow history. Do not send live email during rehearsal.

Both demos default to mock image processing and local email files without provider keys. Credentials and runtime files stay outside Git. The Config link expects the bundle panel at localhost:5199; bookmark that page when using the booth bundle. A standalone repo does not include the bundle panel.

## Tests

```bash
cd backend
uv run pytest -q
```

```bash
cd web
npm run build
```

Backend tests use synthetic data and their own Temporal test environment. No production API keys are needed. For a booth smoke test, submit a new run locally, then verify its Workflow in Temporal UI.

## Reset and Shutdown

Stop only the processes started in the terminals above, using Ctrl-C. Preserve `backend/data/` and `tmp/temporal.db` between restarts. Stop/restart the worker during a run to demonstrate recovery. Target switching does not migrate Workflow histories or local media between servers.

## Sources

[Original demo notes](docs/original-demo.md), [source commit](SOURCE.md), [Temporal CLI](https://docs.temporal.io/cli).

## re:Invent 2026 Booth Setup

These updates are only for AWS re:Invent 2026. Do not merge this branch into the default branch. Contact Ian Douglas or Tomas Josovsky with questions.

The laptop bundle uses this demo's source instructions with a separate UI port and a laptop-specific task queue. From the parent `new-demos/` folder, run `./bundle-setup.sh --only photo-booth` and `python3 bundle.py panel`, then start **Photo Booth** in [Config](http://127.0.0.1:5199/config). UI: [localhost:5620](http://127.0.0.1:5620/).

Use the shared `.env` from 1Password at the bundle root. Keep machine identity in `.env.local`. The panel keeps local Temporal running in Cloud mode and restarts this demo's owned processes when switching targets. See the [bundle runbook](../RUNBOOK.md) for Cloud prerequisites, offline limits and verification. Runtime is not verified by installation alone.
