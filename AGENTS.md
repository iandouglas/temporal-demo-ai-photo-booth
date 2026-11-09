# Agent Instructions: Photo Booth

This is Ian Douglas's AWS re:Invent 2026 demo repository: **iandouglas/temporal-demo-ai-photo-booth**. Contact Ian Douglas or Tomas Josovsky with questions.

## Git Workflow

- Do all work directly on **main** in this repository. These forks are the re:Invent demo versions used by the design team and booth systems.
- Do not create feature branches or PRs unless Ian explicitly requests them. The previous feature-branch/PR instruction is superseded.
- Check `git status` before editing and preserve existing local work. Coordinate file ownership when another person or agent is working on the same demo.
- Use `git pull --ff-only mine main` when the working tree permits it. If histories diverge, coordinate rather than reset or force-push.
- Commit and push to **iandouglas/temporal-demo-ai-photo-booth main**. Never push demo work to the upstream temporal-sa, temporal-community or temporalio repository.
- If Ian explicitly requests a PR, name this repository and main as its destination; never let GitHub default a PR to upstream. Never merge a PR without Ian's request.
- Keep commit and PR text concise and plain ASCII. Do not add co-author trailers or AI attribution.

## Skinning and Theming

- Read `RUNBOOK.md` before changing the app. Match the design team's agreed re:Invent theme on this app's UI.
- Preserve the staff Config link, existing routes/ports, accessibility and Cloud/local controls. The demos remain private on booth computers.
- Do not restyle or overlay the Temporal UI. Keep Workflow, Activity, API and business behavior intact unless the assigned task explicitly includes those changes.
- Inspect the actual frontend scripts and run the relevant build/typecheck and existing tests for the change. A test runner is not necessarily a typecheck.
- Share screenshots at the intended booth viewport. Report which checks passed, failed or were skipped; local builds do not verify Cloud/provider readiness.
- Never commit or print credentials. Keep `.env`, visitor data, generated media, runtime logs, dependencies and runtime state out of Git.
