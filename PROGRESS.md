# PROGRESS — Spec 001 (initial site)

> Executor: update at EVERY checkpoint, and before ending any session.
> This file is the only handoff between sessions. Be precise.

- **Current phase**: Phase 3 — Public site (not started)
- **Branch**: `codex/001-initial-site`
- **Next action**: Read only spec §Phase 3 plus §Design System and §Constraints,
  then build `src/build.js`, the public templates, CSS, and progressive JS.
- **Blockers**: none

## Checkpoint log

| Date | Phase | Checkpoint | Evidence / notes |
|---|---|---|---|
| 2026-07-10 | Phase 1 | Checkpoint 1 complete | `python3 -c "import json;d=json.load(open('scrape/extracted.json'));print(len(d['products']),'products')"` → `20 products`. Manifest: 304 URLs (`200`: 300, `403`: 2 image-host malformed size probes from the first variant implementation, `0`: 2 locally rejected whitespace links); 26/26 requested catalogue HTML pages returned 200, 237 product image selections recorded, `blocked_at: None`. All 20 products have specifications and local images; categories, company facts, address, contact, masked GST, and registration date extracted. No reviews/testimonials or certifications were present in the server-rendered cache. `git status --ignored -- scrape/` → `scrape/` listed under “Ignored files”; nothing staged. |
| 2026-07-10 | Phase 2 | Brand foundation complete | Authored the frozen product-edit and portrait prompts in `IMAGE-STYLE.md`, plus copy rules and worked examples in `COPY-VOICE.md`. Vendored Anthropic's official `frontend-design` skill byte-for-byte from its public repository; SHA-256 `1608ea77fbb6fc30d13a97d12cfa8ebf31358d40f0dd97beed24829d6b3f45dd`. |
| 2026-07-10 | Phase 2 | Public data complete | Added 20 products with unique immutable ids, normalized specifications, rewritten descriptions, conditions, and reserved image paths; 9 placeholder testimonials (5 photo, 4 quote); company and SEO copy; and 4 complete light/dark themes. All five JSON files parse. Contrast audit passed every tested body, CTA, link, and focus pair; lowest required ratio 5.46:1. Fingerprint scan across `data/` and `docs/brand/` returned 0. |
| 2026-07-10 | Phase 2 | Checkpoint 2 complete | Generated and approved 20 product edits from archived references plus 5 text-to-image testimonial portraits using the locked prompts in `IMAGE-STYLE.md`. Re-encoded product assets to 1800×1200 WebP and portraits to 1200×1200 WebP with `sharp`; EXIF/XMP/IPTC/ICC scan returned 0 findings. `assets/products/manifest.json` contains 25 records with complete prompts, model, date, output, and archived-source paths for all product edits. Added Fraunces wordmark SVG, SVG favicon, 32/180/192/512 PNG favicon set, and a 1200×630 OG image; all raster brand files are metadata-clean. Exact JSON parse command passed; exact fingerprint scan across `data/ assets/ src/ admin/ docs/brand/` returned `0`; 20/20 product image directories are non-empty. Visual contact-sheet review found consistent warm studio treatment, no visible source branding, and varied natural portraits. Installed only the permitted dev dependencies: `puppeteer@24.43.1` and `sharp@0.34.5`; npm reported 0 vulnerabilities at installation. |

## QA evidence (Phase 5)

_(empty until Phase 5)_
