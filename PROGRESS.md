# PROGRESS — Spec 001 (initial site)

> Executor: update at EVERY checkpoint, and before ending any session.
> This file is the only handoff between sessions. Be precise.

- **Current phase**: Phase 2 — Content, brand kit, imagery (in progress)
- **Branch**: `codex/001-initial-site`
- **Next action**: Read the data schemas referenced by Phase 2, then rewrite
  the full cache-derived catalogue into `data/*.json`.
- **Blockers**: none

## Checkpoint log

| Date | Phase | Checkpoint | Evidence / notes |
|---|---|---|---|
| 2026-07-10 | Phase 1 | Checkpoint 1 complete | `python3 -c "import json;d=json.load(open('scrape/extracted.json'));print(len(d['products']),'products')"` → `20 products`. Manifest: 304 URLs (`200`: 300, `403`: 2 image-host malformed size probes from the first variant implementation, `0`: 2 locally rejected whitespace links); 26/26 requested catalogue HTML pages returned 200, 237 product image selections recorded, `blocked_at: None`. All 20 products have specifications and local images; categories, company facts, address, contact, masked GST, and registration date extracted. No reviews/testimonials or certifications were present in the server-rendered cache. `git status --ignored -- scrape/` → `scrape/` listed under “Ignored files”; nothing staged. |
| 2026-07-10 | Phase 2 | Brand foundation complete | Authored the frozen product-edit and portrait prompts in `IMAGE-STYLE.md`, plus copy rules and worked examples in `COPY-VOICE.md`. Vendored Anthropic's official `frontend-design` skill byte-for-byte from its public repository; SHA-256 `1608ea77fbb6fc30d13a97d12cfa8ebf31358d40f0dd97beed24829d6b3f45dd`. |

## QA evidence (Phase 5)

_(empty until Phase 5)_
