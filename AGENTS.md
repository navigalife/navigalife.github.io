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
- **`main` takes linear history only.** The server-side ruleset is
  `required_linear_history` + `non_fast_forward` + `deletion`, so a push that
  carries a merge commit is rejected. To ship a long branch that has merges in it:
  merge `origin/main` into the branch → `npm run build` green → make one commit with
  the branch's exact tree on top of `origin/main` and fast-forward to it:
  `sha=$(git commit-tree HEAD^{tree} -p origin/main -m '<summary>')` →
  `git push origin $sha:main`. Keep the branch locally for its history.
  Precedent: admin full control, `0f30bd3` (2026-11-12).
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
  `~/dev/claude/advisor/projects/navigalife/tools/strategy/` — edit there and regenerate; never edit
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
keeps serving the last good deploy. The admin enforces the same rules at edit
time, so the owner is stopped before a failed publish. Two kinds of rules:

- **Shared by construction — `admin/content-rules.js`.** The rules for
  `data/content.json`, `treatment.json`, `films.json`, `data/blog/*.json`, and the
  SEO, hero, eligibility and company fields live in this ONE classic-script file.
  The build `require()`s it and the admin `import`s it, so those rules cannot
  drift. Add a new content rule there, not in `build.js` or `app.js`.
- **Still written twice — keep in lockstep by hand (Lesson 13).** The testimonial
  invariants below live in both `src/build.js` and `admin/app.js`. Separately,
  `src/site.js` ships standalone, so it carries a verbatim copy of content-rules
  `wholeWordMatch`. The build fails if the two copies differ (`5e4de3b`), so
  change both in the same commit.

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

## Public copy is data (since admin full control, 2026-11-12)

- **Every piece of visible site copy lives in `data/*.json` and is owner-editable in
  the admin.** Section copy is on the Page tab (`data/content.json`). The patients in
  `#treatment` are on In therapy (`data/treatment.json`; the old static
  `TREATMENT_PATIENTS` in `template.js` is gone), and films are on Videos
  (`data/films.json`). SEO is Appearance → "Search listing"; the structured address,
  map pin, founded date and languages are on Company (JSON-LD and llms.txt are
  generated from both, never hand-written). `src/template.js` holds markup,
  plus screen-reader and no-JS chrome only. Old notes that say a section is "static
  template/CSS, no admin field" predate this and are false. **Never hardcode new
  copy in the template**: add the field to `data/` + `content-rules.js` + the
  admin editor in the same change (Lesson 27).
- **Local admin harness: `admin/__harness.html`** (gitignored, so it exists only in
  the advisor's clone). It drives the real admin against local `data/` with a mocked
  GitHub API, so nothing touches the live repo. Serve the **repo root** on
  127.0.0.1, then open `/admin/__harness.html`. Plain `python3 -m http.server`
  resets connections under the admin's parallel fetches (it is already threaded;
  its listen backlog is 5): subclass `ThreadingHTTPServer` with
  `request_queue_size = 128`. Its header lists
  the test hooks (`__published`, `__reconstruct()`, `__cutoutFail` …). The Blog tab's
  preview needs `node src/blog/admin-preview.js` first (writes the gitignored
  `admin/preview/`). A local `npm run build` copies the harness into `dist/admin/`
  (CI never has it), so **never deploy a local `dist/`**.

## The blog (`/blog/`, The MediVasc Journal)

Schemas are code, not prose: every field and enum is in `admin/content-rules.js`
`validateBlogConfig` / `validateBlogPosts` (+ `*Detailed`, `BLOG_ENUMS`, `TINTS`,
`LAYOUTS`), the body in `admin/blog-blocks.js`. Read them; never copy lists here.

- **Build** — `src/build.js` calls `src/blog/build-blog.js` (`loadBlog()` validates
  before `dist` is wiped, `buildBlog()` writes pages). In `src/blog/`: pure renderers
  `render-landing.js` / `render-post.js`; `seo.js`; `og.js` share cards;
  `check-refs.js` (files on disk, links to live posts, featured ids, film srcs —
  build-fatal). One hashed `blog.css` (landing + post + blocks) and `blog.js`
  (`reader.js` + `landing.js`, each a guarded IIFE); reading works with JS off.
- **Shared UMD** (Node `require`, `globalThis.*` in the admin) — `content-rules.js`,
  `blog-blocks.js` (the ONE body renderer, the XSS boundary), `blog-checks.js`.
- **Admin** — `blog-tab.js` hosts (list, status, publish/schedule, autosave);
  `blog-editor.js` (document), `blog-seo.js` (SEO, preview, revisions), `blog-manage.js`
  (settings, calendar, schedule alert), `image-intake.js`, `drafts-api.js`.
- **Scheduler** `.github/workflows/blog-schedule.yml` + `tools/blog-due.js`.
  **Worker** `traffic/worker.js` `/drafts…` (behind `adminGate`) + `/blog-stats`,
  tables in `traffic/migrations/0002_blog.sql`.

**Data, flags, drafts, scheduling**
- Shipped: `data/blog/config.json` (settings, categories, authors, featured,
  redirects) and `posts.json` (published | scheduled | unpublished), both written by
  the admin's normal publish commit. `samples.json` + `samples.config.json` are
  tracked but **local preview only**, loaded only by `MV_BLOG_SAMPLES=1`, which is
  never in the deploy path. Sample featured ids live there, so **`config.featured`
  ships as `[]`** (a featured id with no post fails the build).
- `MV_DIST=<dir>` builds anywhere (parallel builds); `MV_BLOG_DATA=<dir>` = fixtures.
- **Drafts are private**: D1 `drafts` + `draft_assets` in the Worker, never git. A
  D1-only post reaches components as `status: 'draft'`, never written to posts.json.
- **Scheduled posts are public** in posts.json before go-live; the build omits a post
  until its `publishAt`, and the cron dispatches `deploy.yml` when one came due since
  the last deploy started. GitHub runs cron late (tell the owner "within ~30
  minutes") and disables it after 60 days of repo inactivity; `mountScheduleAlert`
  watches the workflow state and offers re-enable.

**Images**
- `intakeImage` takes any size/format (incl. HEIC), fixes orientation, downscales in
  the browser to ≤2400px (never via a full-size canvas: iOS kills the tab) and
  re-encodes WebP with metadata dropped; only that uploads.
- Draft photos are `draft:<name>` in `draft_assets`; publish rewrites them to
  `assets/blog/<slug>/<name>` and stages the blobs in the SAME commit as posts.json.
  Author photos (≤800px) stage as-is at `assets/blog/authors/<slug>.<ext>`, never
  `draft:`. The build makes WebP variants at `BLOG_WIDTHS`, never past the source.
- `patient: true` (editor demands the consent tick) keeps a photo on the page but out
  of OG cards, JSON-LD/RSS images and the image sitemap.

**SEO outputs** (`seo.js`, pure)
- One JSON-LD `@graph` per page reusing the homepage's `<site>#website` and
  `<site>#organization` (MedicalClinic); a post is MedicalWebPage (+FAQPage with a
  faq block) + BlogPosting. RSS `blog/feed.xml`; blog URLs + `<image:image>` join the
  root `sitemap.xml`; a `## Journal` section joins `llms.txt`; `previousSlugs` and
  `config.redirects` become noindex redirect stubs. `og.js` draws each post's card
  from glyph outlines (Mac = CI); a null card falls back to the site image.
- **Author (as of ship)**: the company, `a_team` / "MediVasc" / slug `medivasc`. Its
  name equals `data/company.json` `name`, so `authorRef` renders it AS the
  `<site>#organization` node, not a second entity (rename one, break the join). No
  reviewer, so `reviewedBy` stays absent; credential fields render only when set.

**URLs** — flat `/blog/<slug>/` (no category in it), `/blog/category/<slug>/`,
`/blog/author/<slug>/`. Every blog href/src is RELATIVE via `ctx.depth` (`/changes/`
mounts the site under a subpath); absolute URLs only in canonical, og:*, JSON-LD, RSS
and sitemaps. blog-blocks `depthOf` silently drops an absolute depth (`'/'`).

**Admin contracts that cross files**
- `blog-tab.js` owns ONE in-memory post; components read `getPost()`, write
  `onChange(patch)` (shallow top-level fields), never touch `state` or publish.
  Signatures: the exported `mount*` functions in blog-editor/-seo/-manage.js.
- The renderers take no Node built-ins and no new `require`: `admin-preview.js`
  bundles them for the preview, referenced ONLY as `'./preview/blog-render.js'` /
  `'./preview/blog-preview.css'` (copyAdmin adds `?v=`).
- New posts carry `titleSize`/`bodySize`/`leadIn` from `blankPost` (required).
  Deleting a category moves its posts (`onMovePosts`), redirecting if any is live; an
  author named by a post cannot be deleted.

**Invariants**
- Validator-enforced (the build fails, the admin blocks): posts are structured blocks
  + allowlisted inline marks (`INLINE_KEYS`; links only to `BLOG_HREFS`), never raw
  HTML. Alt text is required. Headings are H2/H3 and an H3 cannot precede the first
  H2. Sizes and colours are presets, never raw px/hex.
- Build-side: the Blog nav and all blog pages exist only with ≥1 live post (`blogNav`).

**Blog gotchas**
- `data-theme` on ANY element matches styles.css's global `[data-theme="dark"]`
  rules; use another name (the SEO preview uses `data-ptheme`).
- The editor's `onChange` is debounced 240ms; tests wait ≥300ms before asserting.
- A pointer-drag handle needs `touch-action:none`, else touch fires `pointercancel`.
- `site.js` counts up only `.hero__stat-value[data-count]`; never reuse `data-count`
  (a bare selector once zeroed the gallery's counters; blocks use `data-n`).
- Scroll offsets under the header use the single `--header-h` token, never a literal.
- copyAdmin and the `dist` wipe refuse any target whose real path overlaps `admin/`
  (`assertNotAdminSource`): a symlinked admin once let `?v=` rewrite source files.
- `tools/test/*.test.js` are plain node scripts (non-zero exit = fail), not in CI:
  run `for f in tools/test/*.test.js; do node "$f"; done` before every blog commit.
- Browser checks: puppeteer-core (Lesson 8; not a repo dependency) on the system
  Chrome via `executablePath`. Screenshot clips are page coordinates (add scrollX/Y
  when scrolled); clicks ignore the preview's CSS `transform: scale`.
- Parent-document listeners DO fire inside the `sandbox="allow-same-origin"` preview.
- `draft:` srcs fail `BLOG_IMAGE` until publish rewrites them; harness pages stub
  `stageImage` with `assets/` paths.
- A LAN preview of the repo root must deny dotfiles, `traffic/` (holds
  `traffic/.dev.vars`), `owner-assets/`, `scrape/` and `dist/`.
- **Worker ship order**: apply `0002_blog.sql` to the REMOTE D1 BEFORE deploying the
  Worker, then smoke `/drafts` from the live admin.

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
- **13. Admin and build hold the same content invariants — keep them in lockstep** — most rules now share one file (`admin/content-rules.js`); the hand-mirrored remainder (testimonials, site.js `wholeWordMatch`) is listed under §Content invariants.
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
- **24. Generated raster assets must verify their own layout** — a render script has no failure mode short of a crash; give it measured text, declared safe areas and a non-zero exit, or don't route it to the executor.
- **25. Docs that quote measured pixels go stale silently** — paste the verifier's own passing-check output into the README rather than retyping a measurement; name a gitignored input's regeneration recipe ABOVE the build command.
- **26. `!` is inert under an ignored `dir/`** — to keep a source file inside a derived directory, fence `dir/*` and negate under that; check any "derived" directory for the tooling that derives it before ignoring it.
- **27. Public copy is data — never hardcode it in the template** — a static string is one the owner can't edit; add the field to `data/` + `content-rules.js` + the admin editor together (see §Public copy is data).
