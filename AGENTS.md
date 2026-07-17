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
  is chiefly for advisor/design pushes. Full rationale: **Hard rules** + **Lesson 19**.
- A `pre-push` guard hook is wired in this clone (`core.hooksPath=tools/hooks`) and
  will block a non-fast-forward push to `main`. If you cloned fresh, re-arm it:
  `git config core.hooksPath tools/hooks`. Server-side, `main` also blocks force
  pushes — do not try to work around either; they are protecting live data.

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
4. Confirm you are on the run's work branch (`codex/<spec>-<slug>` or the
   branch PROGRESS.md names). Never commit to `main`.

## Hard rules

- **Branch**: never commit to `main` — it deploys to GitHub Pages; merging is
  the human's decision after advisor review.
- **`main` has two writers — sync before pushing, never force** (advisor pushes):
  the admin CMS commits `data/*.json` to `main` out-of-band. `git commit → fetch →
  pull --rebase origin main → node src/build.js → push` every time; **never
  `--force`** (the one irreversible mistake — it erases the owner's published
  content). Enforced by the `pre-push` hook + server-side force-push block. See the
  STOP block above and Lesson 19.
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
- **Progress protocol**: at every checkpoint, update `PROGRESS.md` (phase,
  checkpoint reached, exact next step, open blockers) and commit. Commit
  granularly with plain, descriptive messages. If you sense the session/context
  window running out: finish the current checkpoint only, update `PROGRESS.md`,
  commit, stop. A clean stop beats a rushed phase.
- **Dependencies**: `puppeteer` and `sharp` as devDependencies, nothing else
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

## Lessons (advisor appends after each review)

From run 1 (spec 001, signed off 2026-07-12):

1. **Staged assets need an explicit lifecycle state machine.** Session-staged
   uploads and base-tree files are different states with different delete
   semantics; treating them uniformly produced invalid `sha:null` tombstones
   at four call sites. When a feature holds "pending" objects, write down the
   states and legal transitions before coding the handlers.
2. **Markup/CSS drift is invisible to static checks.** The theme-preview mocks
   shipped broken through multiple static-clean checkpoints because the CSS
   targeted an element the markup never emitted. Any claim about a UI
   component requires a rendered screenshot of that component in the real
   page context (real stylesheet, real tokens) — `node --check`, builds, and
   grep prove nothing about pixels.
3. **Verification screenshots must come from the real page context.** A
   harness render that omits the app's `:root` tokens produces convincing
   but wrong evidence (non-token backdrop colors leaked into run 1's punch
   verification). If a harness is unavoidable, it must load the full real
   stylesheet and state the context it fakes.

From run 2 (spec 002, advisor-implemented, signed off 2026-07-12):

4. **Brand/copy scrubs must cover rendered image assets, not just strings.**
   The banned phrase survived inside the run-1 OG PNG after every text grep
   came back clean. When a rule says "X must not appear anywhere", inspect
   every shipped raster/SVG that carries text (OG images, icons, PDFs).
5. **Scope runtime theme tokens to the subtree they style.** Writing token
   overrides inline on `documentElement` pinned the admin login screen's
   colors after logout and made its theme toggle appear dead (run-1 bug).
   Dynamic tokens belong on the app view element, never the document root.
6. **Escape `-` in HTML `pattern` character classes.** Current Chrome
   compiles `pattern` with the stricter `/v` regex flag; an unescaped
   trailing hyphen throws (console-only) and silently disables native form
   validation.

From run 3 (design overhaul, advisor-implemented, 2026-07-12):

7. **No design change ships without full-surface browser verification.**
   Run 2 shipped with the admin flow untested — the owner caught it. The
   bar now: exact-viewport screenshots at 1600px AND 390px in light AND
   dark, plus scripted interaction tests of the public site and the ENTIRE
   admin flow (vault create/unlock/forget, story CRUD incl. the crop
   dialog, appearance, publish plumbing) against a mocked GitHub API —
   a fake token plus request interception exercises everything up to and
   including the commit calls without touching the real repo.
8. **Screenshot tooling lies at mobile widths.** Chrome enforces a ~500px
   minimum window width: `--headless --window-size=390,...` lays the page
   out at ~500 and clips the capture (fake horizontal-overflow "bugs"),
   and the extension's window resize can silently no-op. macOS dark mode
   also leaks into headless `prefers-color-scheme`. Reliable harness:
   puppeteer-core with `page.setViewport` + `emulateMediaFeatures`.
9. **Media-query blocks leak into narrower breakpoints.** `align-items:
   start` set on `.pair-story` in the ≤1000px grid layout still applied in
   the ≤760px flex-column layout, collapsing children to content width
   (0px before lazy images load). When the same selector changes display
   model across breakpoints, explicitly reset every layout property the
   wider block set.
10. **`src/build.js` criticalCss is a manual mirror of `src/styles.css`.**
    Any change to header/hero/reveal styles must be resynced there in the
    same commit, or first paint diverges from the stylesheet (FOUC/layout
    shift). The reveal-hide rule (`:where(.js) [data-reveal]`) must be in
    critical CSS and gated on the `.js` class the inline head script sets.
11. **The brand lockup is the owner's image, not a rebuild.** Header and
    footer use `assets/brand/logo-{ink,paper}.png`, generated from the
    owner's `logo-full.png` by `tools/gen-brand.js` (chain documented in
    its header). Never recompose the logo from mark + typeset text.
12. **Public label renames have admin copy references.** The clinical-note
    → case-note rename left stale help text in `admin/app.js`; grep
    `admin/` for the old label whenever public UI concepts are renamed.

From spec 004 (admin validation sync — first Codex-executed spec, signed off
2026-07-13):

13. **The admin and the build hold the same content invariants; keep them in
    lockstep.** Shipping the layout-integrity build guards (f54a287) without
    updating the admin left the owner able to save states the build now rejects
    → a confusing failed publish. Spec 004 resynced the admin (see §Content
    invariants). Whenever you tighten one validator, mirror it in the other in
    the same change, and remember the split: pure validation logic is cleanly
    executor-work even though the admin is otherwise advisor-implemented.
14. **CI run registration and hosted-runner assignment lag by minutes; publish
    polling must tolerate it.** `admin/app.js pollActions` uses a ~4-min run
    discovery window and ~20-min completion window and distinguishes queued
    ("Waiting for a runner") from in_progress ("Building and deploying"). Do not
    shorten these or read a not-yet-registered run as failure. The Node-20
    deprecation warnings in the Actions log are cosmetic (actions' runtime 20→24
    + punycode DEP0040) and are NOT the runner-queue cause — never set
    `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`.

From the design/mobile/email bundle + custom-domain migration (advisor-implemented,
2026-07-13):

15. **Custom domain (`medivasc.in`) contract.** This repo deploys via GitHub
    Actions, so GitHub **ignores any `CNAME` file in the build artifact** — the
    custom domain lives ONLY in repo Settings → Pages (no workflow/build change
    sets it). `src/build.js:10 SITE_URL` is the **single source** of canonical /
    `og:url` / `og:image` / JSON-LD `url`+`logo`; changing the canonical origin
    is that one edit. The repo is **deliberately not renamed** — `admin/app.js`
    `REPO` const and the `raw.githubusercontent.com` photo-preview paths are
    load-bearing on the `navigalife.github.io` name. The `www` cert SAN folds in
    only when `www` CNAMEs to `<user>.github.io` (NOT the apex) **and** the custom
    domain is re-saved after that DNS is correct; Enforce HTTPS stays ON.
16. **criticalCss is above-the-fold ONLY; below-the-fold styles are
    `styles.css`-only.** Lesson 10's mirror rule applies to header/hero/reveal —
    and now the hero stat counters (`.hero__stats*`), whose `≤760`/`≤400` rules
    DO belong in `build.js` criticalCss. Section styles below the fold
    (recoveries/journey/pair-story/approach/pathway/conditions/about/contact/
    footer, incl. their media-query rules) live **only** in `src/styles.css` —
    do NOT duplicate them into criticalCss. Before editing criticalCss, confirm
    the selector is genuinely above the fold; a below-fold rule there is dead
    weight and a second place to drift.
17. **Mobile breakpoint ladder + the pathway "spine" pattern.** Breakpoints are
    `≤1000` (nav collapses, grids → 1–2 col), `≤760` (phone), `≤400` (tightest
    hero/stat compaction). A new section's phone treatment goes in `≤760`. The
    "What to expect" approach list becomes an **editorial vertical-spine
    timeline** on phones: each `.pathway>li` is a `44px | 1fr` grid, the Fraunces
    serif numerals become ring-disc nodes threaded by a gradient `::before`
    spine; desktop keeps the 4-across grid. This is intentionally NOT the
    reference's orange-disc/gray-card look — keep the editorial voice.
18. **Email-first CTAs + medical-photo edits are tone-only.** With phone/WhatsApp
    cleared, CTAs resolve to `mailto:contact@medivasc.in`; the `cta` helper
    auto-restores a WhatsApp action if a number returns, and JSON-LD omits a
    blank `telephone`. Patient photo adjustments are **brightness/tone only**
    (e.g. a γ<1 tone-preserving lift) — never generative, consistent with the
    Hard-rules evidence policy.

From advisor-implemented work colliding with live owner admin edits (2026-07-14):

19. **`main` has two writers — the advisor syncs before every write.** The admin
    CMS commits `data/*.json` straight to `main` via the GitHub API (each an
    `"Update site content from admin"` commit) and auto-deploys; the advisor
    commits code/design (and occasionally data) from a local clone, so that clone
    goes **stale the instant the owner publishes**. **Before starting work AND
    before every commit/push: `git fetch && git pull --rebase origin main`**
    (rebase, not merge — keeps advisor commits linear on top of admin commits),
    then `node src/build.js` so the owner's new content passes `validate()`
    *together with* your change, then push. A rejected (non-fast-forward) push
    means the owner published mid-session — pull --rebase, rebuild, push again;
    **never `--force`.** Treat `data/*.json` as the admin's domain: avoid
    hand-editing it, and when a structural change is unavoidable (e.g. emptying
    `heroStats`) keep it to a tight isolated commit, **match the admin's JSON
    serialization** (2-space indent, expanded arrays — a compact hand-edit turns
    a same-value reformat into a needless conflict), push promptly, and ask the
    owner to hold admin edits on that field until it lands. Rely on the asymmetry:
    the admin publish is resilient to your pushes (`updateRef` `force:false` → 409
    `BranchConflictError` → reload+reapply, so the owner never clobbers your code),
    but your push is protected only by git's non-fast-forward rejection — the sync
    burden is **entirely the advisor's.** Precedent: this session's hero change hit
    a `heroStats` conflict against 4 queued admin commits; commit → `pull --rebase`
    → keep `[]` → rebuild resolved it with zero owner content lost.

From the MediVasc Assistant chatbot (advisor-implemented, shipped & live 2026-07-16):

20. **Client widgets are JS-gated enhancements — the no-JS contact routes stay the
    path.** The MediVasc Assistant (bottom-right conversational lead-form that walks
    name → condition → city, then deep-links to `wa.me/<number>` with the case
    prefilled) is server-rendered as an inert shell in `src/template.js`
    (`renderChatbot`; its config — WhatsApp number / email / condition chips — is
    baked as a `data-mvbot-config` JSON `<script>`) so there's zero layout shift, and
    `src/site.js` only wires it up when that shell is present. It is hidden without JS
    (`html:not(.js) .mvbot{display:none}` in `src/styles.css`), so the page's own
    `mailto:`/WhatsApp routes remain the way to reach the business — the widget never
    becomes the *only* path. `renderChatbot` returns `''` when neither a number nor an
    email is on record (site.js then no-ops), so it degrades to email like every other
    CTA (Lesson 18). Untrusted visitor input is written via `textContent`, never
    `innerHTML`. Its CSS is below-the-fold → `styles.css` only, not criticalCss
    (Lesson 16); it respects `prefers-reduced-motion`.

From the content-copy friction (advisor-implemented, shipped & live 2026-07-16):

21. **Page text is intentionally unselectable and images are drag/save-blocked —
    this is a deliberate deterrent, not a bug.** Owner directive for light content
    protection: `src/styles.css` sets `user-select:none` on `body` and
    `-webkit-user-drag:none`/`user-select:none` on `img`; `src/site.js` blocks
    `dragstart`/`contextmenu` when the target is inside an `<img>`. It is friction
    only — screenshots, reader mode, and View Source still get everything, so if the
    owner ever asks for "real" protection, say so plainly (the honest layer is the
    testimonial watermark + shipping compressed images, never originals — you cannot
    hide source/network from a browser that must download the page to render it). A
    **selection allowlist** keeps what patients actually need usable: `.contact-row`
    (+ its children), `input,textarea,select,[contenteditable]`, and the chatbot
    (`.mvbot__input`,`.mvbot__log`) are re-enabled to `user-select:text` /
    `-webkit-touch-callout:default`. **If you add any new copyable text (a phone
    number, an address) or a form field, add its selector to that allowlist** or it
    will be dead to selection and copy.

From the mobile nav drawer (advisor-implemented, shipped & live 2026-07-16):

22. **The mobile menu is a body-level slide-in drawer — NOT inside `.site-header`.**
    `src/template.js` renders a right-anchored drawer (`.nav-drawer` + dim `.nav-scrim`,
    MindStudio-style: drawer head with logo + X, stacked links with row dividers,
    WhatsApp CTA pinned bottom) as a **direct child of `<body>`**, after `</header>`. It
    must NOT live inside `.site-header`: that element has `backdrop-filter:blur()`, which
    makes it the *containing block* for any `position:fixed` descendant (and its own
    stacking context) — a fixed drawer placed inside gets clamped to the header's ~84px
    box (body clipped) and stacks *below* the z-120 chatbot. Body-level fixes both
    (drawer `z-index:160` / scrim `150`, above the chatbot). Nav links are a **single
    source** (`navLinksHtml` in template.js) rendered into both the desktop header nav
    and the drawer — keep them in sync there, never duplicate. `src/site.js` toggles
    `.is-open` on drawer + scrim + `html.nav-open` (scroll lock) and closes on scrim tap
    / X (`data-menu-close`) / Escape / link tap. On mobile the hamburger is deliberately
    in the far-right corner (`grid-column:3`) with the theme toggle to its left
    (`grid-column:2`) so open (☰) and close (X) share one target — and **both need
    `grid-row:1`**: reversing the header-inner columns makes CSS grid's sparse
    auto-placement (which never backtracks) drop the theme toggle to a second row.

From the footer ™ + hero-quote reconciliation (advisor-implemented, shipped & live 2026-07-17):

23. **The footer ™ is baked into the logo image, not drawn in CSS — and the hero
    headline's quotes come from the template, not the stored text.** Two separate gotchas
    that both trace to "who owns this glyph":
    - *Footer ™:* the wordmark's `c` sits at the very right edge of the logo canvas
      (~99.9% width), so a CSS `<sup>` ™ has nowhere to sit tight and floats in empty
      space. Instead the ™ is **baked** into footer-only variants `assets/brand/logo-*-tm*.png`
      (regenerated by `tools/`-style PIL script — ink `#1C2B2E`, paper `#EAF2F0`, SF
      Rounded, nestled into the c's top terminal tip at source-px (719,182)), wired via
      `prepareMarkSized` in `src/build.js` (carries its own width/height — wider canvas
      than the plain mark) and a `footerLockup()` in `src/template.js`. **Two sizes**:
      `-tm-lg` (bigger ™) shows on desktop's 54px render, base `-tm` on the ≤760px phone
      render (64px) — swapped by `.lockup__size--lg/--sm` in `src/styles.css` — so the ™
      reads at the same absolute size on both. Header/drawer lockups are unchanged (no ™).
    - *Hero quotes:* `src/template.js` wraps the headline in styled curly quotes. The
      **admin CMS is a co-writer** and the owner sometimes types their own quotes into the
      headline field → that would render doubled («"…"»). The template now **strips any
      surrounding straight/curly quotes** from `config.heroHeadline` before wrapping
      (`heroHeadlineText`), so exactly one styled set renders regardless of what's stored.
      Store the headline as **plain text** (no quotes) — the template owns the styling.
