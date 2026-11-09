# Agent Instructions: Photo Booth

These instructions cover this fork. This work is only for AWS re:Invent 2026. Contact Ian Douglas or Tomas Josovsky with questions.

## Branch and PR Rules

- Read `RUNBOOK.md` before changing the app.
- Start every change on a feature branch from the latest `mine/reinvent-2026-donotmerge`. Use a name such as `codex/theme-<topic>` or `claude/theme-<topic>`.
- Never commit work directly to `main` or `reinvent-2026-donotmerge`.
- Before editing, inspect `git status` and preserve all existing work. Do not reset, clean or delete someone else's changes.
- Push the feature branch to **iandouglas/temporal-demo-ai-photo-booth**. Open its PR in **iandouglas/temporal-demo-ai-photo-booth**, targeting **reinvent-2026-donotmerge**.
- Name the PR repository explicitly. Do not let GitHub default a fork PR to the upstream repository. Do not open this work against temporal-sa, temporal-community or temporalio.
- Never merge. Ian reviews and merges on GitHub.
- Use concise plain ASCII commit/PR text. Do not add co-author trailers or AI attribution.

Example, after making and committing changes on your feature branch:

```bash
git push -u mine YOUR_FEATURE_BRANCH
gh pr create --repo iandouglas/temporal-demo-ai-photo-booth --base reinvent-2026-donotmerge --head YOUR_FEATURE_BRANCH
```

## Skinning and Theming

- Match the design team's agreed theme on this demo's UI. Do not restyle or overlay the Temporal UI.
- Preserve the staff Config link, existing routes/ports, Cloud/local switching and accessibility. The demos remain private on booth computers.
- Keep Workflow, Activity, API and business behavior intact unless the assigned task explicitly includes those changes.
- Read the actual frontend scripts and run the relevant build/typecheck and existing tests for the change. A test runner is not necessarily a typecheck.
- Include screenshots at the intended booth viewport in the PR. Report exactly which checks passed, failed or were skipped; do not claim Cloud/provider verification from a local build.
- Never commit or print credentials. Keep `.env`, visitor data, generated media, logs, dependency folders and runtime state out of Git.
