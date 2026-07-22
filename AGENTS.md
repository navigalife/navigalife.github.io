# AGENTS.md — MediVasc website (navigalife.github.io)

You are the **executor** on this repo. The architecture, design system, and
acceptance criteria were set by the advisor (a principal engineer). Your job is
faithful, high-craft implementation — not re-architecture. If a spec decision
proves impossible, STOP, record the blocker in `PROGRESS.md`, and end the
session cleanly; do not improvise around architectural decisions.

The company is **MediVasc** (renamed from Naviga Life in run 2). Mission:
prevention of foot and leg amputation; customized, affordable home therapy
protocols with follow-up until the desired result. Products are archived from
the public site (`productsEnabled: false` in `data/site-config.json`) — the
data and admin tab remain, but nothing product-related may render publicly.
The catalogue PDF pipeline (Puppeteer) was removed; restore steps are in
`docs/RESTORE-PDF-PIPELINE.md`.

## ⚠️ STOP — before you push to `main` (read this first)

`main` is written by **TWO** actors: the **admin CMS** (the owner publishes
content — it commits `data/*.json` straight to `main` via the GitHub API and
auto-deploys) and **you/the advisor** (code from a local clone). Your clone goes
**stale the moment the owner publishes**, so:

- **Never `git push --force` (or `--force-with-lease`) to `main`.** That is the one
  action that can permanently erase the owner's published content. There is no
  reason to force-push this repo — ever.
- **Before every push to `main`:** `git commit` your work → `git fetch` →
  `git pull --rebase origin main` → `node src/build.js` (revalidate merged
  content) → `git push`. A rejected push means the owner published; rebase and
  retry. `pull --rebase` needs a clean tree, so **commit before you rebase.**
- **Codex never pushes `main` at all** (work on `codex/<spec>-<slug>`); this block
  is chiefly for advisor/design pushes. Full rationale: **Lesson 19** in `docs/LESSONS.md`.
- A `pre-push` guard hook is wired in this clone (`core.hooksPath=tools/hooks`) and
  will block a non-fast-forward push to `main`. If you cloned fresh, re-arm it:
  `git config core.hooksPath tools/hooks`. Server-side, `main` also blocks force
  pushes — do not try to work around either; they are protecting live data.

This STOP block is the **single canonical statement** of the two-writer / never-force
rule; everything else in this file points here.

## The `/changes` staging workflow (use `tools/preview.sh`, don't freelance it)

Owner-facing changes go to the `preview` branch FIRST (shown at
`medivasc.in/changes`), and never ship to `main` until Puranjai explicitly says
so. Because `main` has two writers, `preview` must always START from the current
`main` or the owner reviews stale content and promotion stops being linear. That
sequence is encoded — use it instead of hand-running git:

- **Before editing preview:** `bash tools/preview.sh sync` (resets
  `origin/preview` → current `origin/main`; the only branch ever force-pushed).
- **Show it to the owner:** commit to a local `preview` branch, then
  `bash tools/preview.sh publish` (pushes preview + dispatches a `main` deploy so
  `/changes` refreshes — a bare preview push can't deploy, the env is main-only).
- **Go live (only on Puranjai's explicit OK):** `bash tools/preview.sh ship`
  (dry-run) → review → `bash tools/preview.sh ship --yes` (linear FF to `main`,
  then re-syncs preview). `tools/preview.sh status` shows where things stand.

## Session start ritual (every session, no exceptions)

1. Read this file fully.
2. Read `PROGRESS.md` — it tells you the current phase and exact next step.
3. Read ONLY the current phase's section of the active spec in `docs/specs/`
   (plus §Design System and §Constraints if the phase touches UI). Do not
   re-read completed phases or paste large scraped files into context.
4. Lesson bodies live in `docs/LESSONS.md` (indexed below) — read only the ones
   relevant to what you're touching; don't load them all.
5. Confirm you are on the run's work branch (`codex/<spec>-<slug>` or the
   branch PROGRESS.md names). Never commit to `main`.

## Hard rules

- **Branch**: never commit to `main` — it deploys to GitHub Pages; merging is
  the human's decision after advisor review.
- **`main` has two writers — sync before pushing, never force.** Full procedure and
  rationale: the **STOP block** at the top of this file (the single source for this
  rule). Enforced by the `pre-push` hook + server-side force-push block.
- **`/strategy` is a pre-encrypted artifact.** `strategy/index.html` is generated
  ciphertext (the owner-only growth-plan page: noindex, robots-disallowed, never
  in the sitemap). Plaintext source + encryptor live in the advisor workspace at
  `~/dev/claude/advisor/tools/strategy/` — edit there and regenerate; never edit
  the artifact in place, and never commit plaintext or the password to this
  public repo.
- **Patient evidence**: photographs may be cropped, rotated, tonally
  normalized, and metadata-stripped — never generated or generatively edited.
  No fabricated testimonials, names, or quotes. "Identity protected" is the
  placeholder for withheld names.
- **Owner copy anchors**: the motto "A solution is not a solution unless it
  is affordable" appears verbatim; the string "sequential compression" must
  not appear in rendered output (`owner-assets/` docs are the source of
  truth for owner-authored copy). `owner-assets/` is gitignored — never ship
  raw owner files.
- **No IndiaMart fingerprints** in anything shipped: no "indiamart"/"imimg"
  strings in code, data, filenames, alt text, or metadata; no verbatim copied
  descriptions (rewrite all copy); strip EXIF from every shipped image. The
  `scrape/` directory is gitignored and must stay untracked — verify with
  `git status --ignored -- scrape/` before every commit.
- **Scraping discipline**: follow the 429-avoidance protocol in spec §Phase 1
  exactly. On the first 429 from any indiamart host, stop ALL requests to that
  host immediately, log the timestamp in `scrape/manifest.json`, and switch to
  cache-only work. Never scrape from CI. Never re-fetch a URL that exists in
  the cache.
- **GitHub account scoping**: everything this repo does on GitHub happens as
  **navigalife**. Git is already wired — local `user.*` config plus the
  `navigalife@` username embedded in the remote URL select the right keychain
  credential automatically; commits and pushes need nothing special. The
  machine's global `gh` CLI account is `puranjai-dev` and other projects use it
  in parallel, so **never run `gh auth switch`** (it flips a machine-global
  setting and races concurrent sessions). Scope any `gh` call to this repo
  per-command instead: `GH_TOKEN=$(gh auth token -u navigalife) gh <cmd>`.
- **Progress protocol**: at every checkpoint, update `PROGRESS.md` (phase,
  checkpoint reached, exact next step, open blockers) and commit. Commit
  granularly with plain, descriptive messages. If you sense the session/context
  window running out: finish the current checkpoint only, update `PROGRESS.md`,
  commit, stop. A clean stop beats a rushed phase.
- **Dependencies**: `sharp` as the only devDependency, nothing else
  without a written blocker in PROGRESS.md. No frontend frameworks, no CSS
  frameworks, no runtime JS libraries. The shipped site is hand-written
  HTML/CSS/JS generated by `src/build.js`.
- **Verify before declaring done**: every phase has verify commands in the
  spec. Run them. Paste real output into PROGRESS.md. "Should work" is not done.

## Content invariants (build-enforced — the admin mirrors these)

`src/build.js validate()` is the backstop: a violating content state fails
`npm run build`, so the deploy job (`needs: build`) never runs and GitHub Pages
keeps serving the last good deploy. The admin (`admin/app.js`) enforces the same
rules client-side (spec 004) so the owner is stopped at edit time, not at a
failed publish. Both must hold — when you touch either validator, keep them in
sync (see Lesson 13).

- **Exactly one featured testimonial** — not zero (the hero's right column
  empties and the lead recovery story drops), not more than one. The admin
  blocks un-featuring or deleting the sole featured story, and a publish-time
  backstop refuses a draft that isn't exactly-one-featured.
- **The featured story has exactly 3 stage images** (Before, During, After) so
  it fills the hero three-up strip; 2 leaves an empty slot.
- **Every testimonial has 0, 2, or 3 images — never 1.** A single photo is not
  evidence of change; 2 = Before + After (During optional), 3 = all stages.
- **Protocol tracks with no visible items are skipped** (`src/template.js`), not
  rendered as a section heading over an empty list.

## Design authority

The design system in spec §Design System is binding: exact palette tokens,
type scale, spacing, motion rules, and the ban list (no purple/indigo
gradients, no glassmorphism, no emoji-as-icons, no Inter/Roboto/Arial/Space
Grotesk, no generic SaaS card grids, no lorem ipsum). Where the vendored
frontend-design skill (`docs/brand/frontend-design-skill.md`, if present) and
the spec disagree, **the spec wins**.

Craft bar: this must read as a real medical-device company's site built by a
senior design team — restrained, editorial, trust-first. When in doubt,
remove decoration rather than add it.

## Copy voice

Confident, clinical-but-warm, specific. Name the conditions each device
addresses plainly (lymphedema, DVT prevention, varicose veins, venous ulcers,
chronic venous insufficiency, diabetic foot / amputation prevention,
filariasis). Short sentences. No hype adjectives ("revolutionary",
"cutting-edge"), no exclamation marks, no em-dash chains. Keep the standard
footer disclaimer specified in the spec.

## Lessons index (full bodies in `docs/LESSONS.md`)

Durable lessons the advisor folds in after each review. Read the relevant body in
`docs/LESSONS.md` on demand — do not paste them all into context.

- **1. Staged-asset lifecycle** — session-staged vs base-tree assets are different states; write the state machine before coding delete handlers.
- **2. UI drift is invisible to static checks** — any UI claim needs a real-context rendered screenshot; `node --check`/build/grep prove nothing about pixels.
- **3. Verification screenshots must use the real page context** — a harness missing `:root` tokens produces convincing-but-wrong evidence.
- **4. Brand/copy scrubs must cover rendered images** — inspect every shipped raster/SVG that carries text (OG, icons, PDFs), not just strings.
- **5. Scope runtime theme tokens to the styled subtree** — token overrides on `documentElement` leak (pinned the admin login colors); put them on the app view.
- **6. Escape `-` in HTML `pattern` classes** — Chrome's `/v` flag throws on an unescaped trailing hyphen and silently disables native form validation.
- **7. No design change ships without full-surface browser verification** — 1600px AND 390px, light AND dark, plus scripted public + full admin flow against a mocked GitHub API.
- **8. Screenshot tooling lies at mobile widths** — Chrome's ~500px min window clips 390px captures; use puppeteer-core `setViewport` + `emulateMediaFeatures`.
- **9. Media-query blocks leak into narrower breakpoints** — reset every layout property when the same selector changes display model across breakpoints.
- **10. `build.js` criticalCss is a manual mirror of `styles.css`** — resync header/hero/reveal changes in the SAME commit or first paint diverges (FOUC).
- **11. The brand lockup is the owner's image, not a rebuild** — header/footer use `assets/brand/logo-{ink,paper}.png`; never recompose from mark + typeset text.
- **12. Public label renames have admin copy references** — grep `admin/` for the old label whenever a public UI concept is renamed.
- **13. Admin and build hold the same content invariants — keep them in lockstep** — tighten one validator, mirror it in the other in the same change.
- **14. CI run registration + runner assignment lag by minutes** — `pollActions` uses ~4-min discovery / ~20-min completion windows; Node-20 warnings are cosmetic.
- **15. Custom-domain contract** — domain lives ONLY in Settings→Pages (Actions ignores CNAME); `SITE_URL` is the single canonical source; the repo name is load-bearing; the www SAN folds in only when www→`<user>.github.io` and the domain is re-saved.
- **16. criticalCss is above-the-fold ONLY** — below-the-fold section styles live only in `styles.css`; don't duplicate them into criticalCss.
- **17. Mobile breakpoint ladder + pathway spine** — `≤1000`/`≤760`/`≤400`; the approach list becomes an editorial vertical-spine timeline on phones.
- **18. Email-first CTAs + tone-only photo edits** — CTAs resolve to `mailto:` when no number; the `cta` helper restores WhatsApp if a number returns; patient photos are brightness/tone only, never generative.
- **19. `main` has two writers — sync before every write, never force** — see the STOP block (the canonical statement); precedent = a `heroStats` conflict against 4 queued admin commits, resolved by `pull --rebase`.
- **20. Client widgets are JS-gated enhancements** — the chatbot is an inert server-rendered shell hidden without JS; no-JS `mailto:`/WhatsApp routes stay the path; untrusted input via `textContent`.
- **21. Unselectable text + drag/save-blocked images = deliberate deterrent** — friction only (screenshots/View-Source defeat it); keep the selection allowlist and extend it for any new copyable UI/form field.
- **22. Mobile menu is a body-level slide-in drawer, NOT inside `.site-header`** — the header's `backdrop-filter` traps `position:fixed` kids; drawer/scrim are direct `<body>` children (z-160/150); hamburger + toggle both need `grid-row:1`.
- **23. Footer ™ is baked into the logo image; hero quotes come from the template** — a CSS `<sup>` has nowhere to sit at the canvas edge, so ™ is baked into `logo-*-tm*.png` (two sizes); the template strips surrounding quotes from `heroHeadline` (store plain text).
