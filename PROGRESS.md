# PROGRESS

This file carries the **current run header only** — phase, branch, next action,
blockers. Completed spec runs are recorded in git history and the advisor's
review records, not here.

## Current state

- **Live:** MediVasc site is live at `medivasc.in`. No spec run is in flight.
- **Branch:** `main`. Advisor design/content changes use the direct-change lane
  (`commit → pull --rebase origin main → node src/build.js → push`, never force —
  see the STOP block in `AGENTS.md`). Codex runs use `codex/<spec>-<slug>` and
  never touch `main`.
- **Next action:** none pending. Owner content flows through the admin CMS;
  advisor changes go direct, or through a numbered spec in `docs/specs/` for
  large or mechanical runs.
- **Blockers:** none.

## Completed runs (evidence in git history + advisor reviews)

- **001** — initial site (signed off 2026-07-12)
- **002** — MediVasc pivot (advisor-implemented, signed off 2026-07-12)
- **003** — design overhaul (advisor-implemented, review-only; no `docs/specs/003-*.md`)
- **004** — admin validation sync (first Codex-executed spec, merged & live 2026-07-13)
