# Spec 002 — MediVasc pivot: rebrand, product archive, real testimonials, full UI overhaul

**Status**: implemented by the advisor directly (no executor run). This spec is the
design record for review and future maintenance.

## Context

Owner feedback after run 1 (docs in `owner-assets/`, relayed 2026-07-12):

- Company renamed **MediVasc**. Mission-first positioning: **prevention of foot/leg
  amputation**; immobile and bedridden patients back to independence.
- **Zero product focus** on the public site, for now. Products may return —
  archive, don't delete. Admin product management stays functionally untouched.
- Primary public focus: **protocols, testimonials (real recoveries), and the
  follow-up model** (case study → customized affordable solution → follow-ups
  until amputation is prevented / desired result achieved).
- Audience: two tracks only — **disease-specific** and **bedridden / elderly
  (mobility)**. Sports/athletic targeting dropped.
- Four real testimonials supplied (photos + clinical narratives). #1 is the hero
  with a 3-image transformation flow.
- Readability complaint: font too small → global type-scale overhaul.
- Admin: PAT paste-login replaced; login theme toggle broken; appearance tab
  overhauled.

## Goal

Ship the pivoted, redesigned site at navigalife.github.io (URL unchanged) with a
maintainable content model the owner can drive through the admin panel.

## Constraints

- Static output, no frameworks, hand-written HTML/CSS/JS via `src/build.js`
  (unchanged architecture). `sharp` + `puppeteer` remain the only dependencies.
- No generative image editing of patient evidence: crops, rotation, EXIF strip,
  and mild tonal normalization only (run-1 evidence policy).
- No fabricated testimonials: run-1 placeholder quotes are removed, not replaced
  with new inventions. Patient names not supplied are shown as "Identity
  protected" until the owner fills them in.
- Products stay in `data/products.json` and the admin Products tab; nothing
  product-related renders publicly while `siteConfig.productsEnabled` is false.
- Copy voice per AGENTS.md: clinical-but-warm, specific, no hype.
- Dark/light parity for every new component.

## Architecture

### Content model

`data/site-config.json`
```
theme, productsEnabled (bool), heroHeadline, heroSub, seo{title,description}
```

`data/testimonials.json` — one array, one schema, three render variants:
```
id            slug, required
featured      bool — at most one; renders as the hero transformation story
name          required ("Identity protected" allowed)
location      required
condition     required — short clinical label shown as the card kicker
duration      optional — e.g. "Recovery signs within 30 days"
remark        company clinical narrative (condition, cure, recovery)
quote         patient's own words
images        [] of {src, stage} — 0, 2, or 3 entries; stage ∈ Before/During/After
```
Validation (build + admin):
- 0 images → `quote` required (`remark` optional).
- 2–3 images → `remark` required, `quote` optional.
- `featured` requires ≥2 images; exactly 0 or 1 featured.
- 1 image is invalid (a lone photo is not evidence of change).

Render variants: featured+3 images → journey flow; 2 images → before/after card;
0 images → quote card.

`data/protocols.json` — rebuilt from the owner's protocols document.
`audience` ∈ `disease` | `elderly`. Device links retained in data (`deviceIds`)
but never rendered while products are archived. The run-1 sports protocol is
archived to `data/archive/protocols-retired.json`.

### Public page (index)

Header (logo mark + MediVasc wordmark, nav, theme toggle, WhatsApp CTA) →
Hero (mission headline, care-pathway panel, condition chips) →
Focus tracks (disease / bedridden & elderly) →
Recoveries (hero journey + before/after cards + quote cards, clinical-note
styling for remarks) →
Protocols (grouped by track, engagement details) →
How we work (4 steps, follow-up emphasis, affordability) →
For the medical fraternity (collaboration band) →
About & mission → Contact → footer (disclaimer, © MediVasc).

Removed from public output: product grid/groups, product dialog + JS, catalogue
PDFs and links, product JSON-LD ItemList, product hero imagery, sports track.
`tools/gen-pdfs.js` exits early (code 0, message) when `productsEnabled` is false.

### Design system v2

- Type: Fraunces 600 display / Instrument Sans text (self-hosted, unchanged
  files). Base 1.125rem (18px), line-height 1.7; fluid headings
  h1 clamp(2.75rem, 6.5vw, 4.25rem), h2 clamp(2rem, 3.6vw, 2.75rem).
- Token contract extended: `--good` (recovery/after), `--alert` (before),
  `--surface-raised`, kept otherwise identical so themes stay swappable.
- Themes rebuilt (light+dark each): `medivasc` (default; clinical porcelain,
  deep slate ink, vascular teal-blue primary, restrained arterial red reserved
  for "before" markers), `meridian`, `sage`, `graphite` re-tuned to the new
  contract and AA contrast.
- Evidence components: journey flow (stage frames with connectors + stage
  labels), before/after pair with semantic labels, "Clinical note" remark block,
  quote cards. All images 4:5, lazy, srcset 320/640.

### Admin v2

- Rebrand + restyle on the v2 tokens; storage keys `medivasc-*` (legacy
  `naviga-*` keys cleared on first load).
- **Auth vault**: first run — paste fine-grained PAT once, set a device
  passcode (min 8 chars), token encrypted with AES-GCM under a PBKDF2-SHA-256
  key (600k iterations, random salt/IV) and stored in localStorage. Later runs —
  passcode unlock; decrypted token lives in sessionStorage for the tab session
  only. "Forget this device" wipes the vault. Plain-text PAT is never persisted.
- Login screen theme toggle works pre-auth (shared theming module, no
  dependency on loaded repo state).
- Testimonials tab: single creation flow implementing the schema above; three
  labeled image slots (Before/During/After) with the existing 4:5 crop dialog;
  featured toggle; inline validation messages matching build rules.
- Protocols tab: audience select limited to the two tracks.
- Products tab: functionally untouched; passive notice that products are
  archived from the public site.
- Appearance tab: rebuilt — theme cards with real-token mini previews of the
  new landing layout, active/apply state, admin light/dark control, hero copy
  and SEO fields.

### Brand assets

From `owner-assets/MediVasc_Logo.PNG` (sharp pipeline, no redraw): transparent
tinted mark for light/dark headers, favicon PNG set + SVG wrapper, apple-touch,
maskable 192/512, and a puppeteer-rendered 1200×630 OG image with the real
fonts. Old Naviga Life brand files replaced.

## Phases & verify

1. **Assets** — testimonial evidence pipeline (`tools/prepare-evidence.js`,
   one-off; documented crop boxes) + brand set. Verify: view every output
   image; dimensions 4:5; no UI chrome remnants; EXIF absent.
2. **Data** — rewrite company/site-config/testimonials/protocols/themes.
   Verify: `npm run build` passes validation.
3. **Site** — template/styles/site.js rewrite. Verify: build; serve; rendered
   screenshots (desktop+mobile, light+dark); no "product" strings in rendered
   HTML besides archive-neutral wording; Lighthouse-level sanity (fonts load,
   no console errors).
4. **Admin** — auth vault, tabs, appearance. Verify in browser: first-run
   setup, lock/unlock, wrong-passcode path, theme toggle on login, testimonial
   create with images, appearance switch, publish dry-run (staged changes
   listed without publishing).
5. **Ship** — README/AGENTS/PROGRESS updates, merge to main, workflow deploy,
   live checks (200s, fingerprints, rendered spot-check).

## Acceptance criteria

- `npm run build` succeeds; `dist/index.html` contains no product cards,
  product dialog, catalogue links, or sports-track content; "MediVasc"
  branding throughout; no "Naviga Life" remnants in rendered output.
- All four real testimonials render: story-001 as a 3-stage journey (featured),
  002–004 as before/after cards; each shows clinical remark; no fabricated
  quotes anywhere in `dist/`.
- Base body size ≥ 18px computed on desktop and mobile.
- Theme toggle works on the admin login screen; PAT is never stored in plain
  text in localStorage; unlock works after a full browser reload with only the
  passcode.
- `tools/gen-pdfs.js` is a no-op success while `productsEnabled` is false;
  the deploy workflow passes unmodified in behavior.
- Live site serves the new landing page with all evidence images 200.

## Out of scope

- GitHub account/repo rename or custom domain (owner/user decision).
- Product content redesign (archived as-is for possible return).
- The supplied testimonial video (kept in owner-assets, unused).
- Admin multi-user auth or server-side anything.
