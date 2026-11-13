# Blog build contract (parallel-worker interface — advisor-owned, temporary)

This file pins the interfaces every blog worker codes against. **Do not edit it**;
if the contract is wrong, say so in your report. It is folded into AGENTS.md and
deleted at ship. The full product plan (owner asks, design calls) is summarised in
your task card; this file is the shared truth for data shapes, file ownership and
function signatures.

## URLs and paths
- `/blog/` landing · `/blog/<slug>/` post (flat; the category is NOT in the URL, so
  category renames never move posts) · `/blog/category/<slug>/` · `/blog/author/<slug>/`
  · `/blog/feed.xml` (RSS) · blog URLs + `<image:image>` entries go into the root
  `sitemap.xml`.
- Output: `dist/blog/index.html`, `dist/blog/<slug>/index.html`, …
- **Every href/src in a blog page is relative**, prefixed by `ctx.depth`
  (`../` for /blog/, `../../` for a post/category-less page, `../../../` for
  category/author pages). **Never a root-absolute path** — the preview is mounted at
  `/changes/`. Absolute `https://medivasc.in/...` URLs only in canonical, og:*, JSON-LD,
  RSS and sitemaps.
- Build output dir is overridable: `MV_DIST=/tmp/x node src/build.js` (use your own
  dir — several workers build concurrently; never build into the shared `dist/`).
- `MV_BLOG_SAMPLES=1` also loads `data/blog/samples.json` (sample posts, never shipped).

## Data files
- `data/blog/config.json` — the blog's settings:
```json
{
  "name": "The MediVasc Journal",
  "navLabel": "Blog",
  "intro": "Plain-spoken guidance on diabetic foot, circulation and limb care.",
  "seo": { "title": "", "description": "" },
  "featured": ["<postId>", "..."],
  "categories": [
    { "id": "c_foot", "name": "Diabetic foot", "slug": "diabetic-foot",
      "intro": "…", "metaDescription": "…", "tint": "teal" }
  ],
  "authors": [
    { "id": "a_team", "name": "MediVasc Care Team", "slug": "medivasc-care-team",
      "role": "", "credentials": "", "bio": "", "photo": "", "sameAs": [] }
  ],
  "redirects": [ { "from": "blog/old-slug/", "to": "blog/new-slug/" } ]
}
```
  - `tint` ∈ `teal | clay | sage | ochre | slate | plum` (preset swatches; actual colours
    defined in `src/blog/blog-landing.css` as `--tint-<name>` + `--tint-<name>-ink`, light
    and dark, contrast-checked).
  - `featured` is the owner's ordered list (drives the landing carousel + the post rail).
  - Author `role`/`credentials`/`photo` render only when non-empty (owner decision 2 pending).
- `data/blog/posts.json` — array of published/scheduled/unpublished posts. **Drafts are
  never in the repo** (they live privately in the Worker's D1, see `traffic/`).
- `data/blog/samples.json` — same shape as posts.json, every post `"sample": true`.

### Post
```json
{
  "id": "p_9f2k1a", "slug": "diabetic-foot-warning-signs", "previousSlugs": [],
  "status": "published",               // published | scheduled | unpublished
  "publishAt": "2026-11-20T09:00:00+05:30",  // ISO with offset; build omits future posts
  "updatedAt": "2026-11-21T10:00:00+05:30",  // optional, shown as "Updated"
  "lang": "en",
  "layout": "editorial",               // editorial | cover | split | guide
  "category": "c_foot",
  "title": "Seven warning signs your feet need a doctor",
  "titleAccent": "warning signs",      // optional whole-word phrase rendered <em> accent italic
  "dek": "Most amputations start as a small wound nobody watched. Here is what to look for.",
  "titleSize": "L",                    // S | M | L | XL  (preset scale, never px)
  "bodySize": "M",                     // S | M | L
  "leadIn": "dropcap",                 // dropcap | smallcaps | boldwords | none
  "cover": { "src": "assets/blog/<slug>/cover.webp", "alt": "…", "caption": "…",
             "credit": "", "focal": { "x": 0.5, "y": 0.5 }, "patient": false },
  "author": "a_team", "reviewer": null, "reviewedAt": null,
  "about": ["Diabetic foot ulcer"],    // MedicalCondition names for JSON-LD (optional)
  "seo": { "title": "", "description": "", "focusKeyphrase": "diabetic foot warning signs",
           "keywords": ["foot ulcer", "neuropathy"] },
  "related": [],                       // manual override post ids (else auto)
  "blocks": [ /* see Blocks */ ],
  "references": [ { "id": "r1", "text": "IWGDF Guidelines 2023, …", "url": "https://…" } ],
  "sample": true                       // samples.json only
}
```
`seo.title`/`seo.description` empty → fall back to title / dek.
`patient: true` on any image means a patient photo (consent confirmed in the admin).

### Inline text (`Inline`) — never HTML
Either a plain string, or an array of runs:
`{ "t": "text", "b": true, "i": true, "hl": true, "href": "https://…" }` (all marks
optional) and citation runs `{ "cite": "r1" }` (superscript number linking to the
references list, with a back-link). Renderers escape everything; `href` must be
`https:`, `mailto:`, `tel:`, a relative `blog/<slug>/` internal link, or `#anchor` —
anything else is dropped. External links get `rel="noopener"` + `target="_blank"`.

### Blocks
| type | fields |
|---|---|
| `paragraph` | `text: Inline` |
| `lead` | `text: Inline` (larger intro paragraph) |
| `heading` | `level: 2\|3`, `text: string`, `size?: S\|M\|L`, `anchor?: string` (auto-slug if absent; TOC uses it) |
| `list` | `style: bullet\|number`, `items: Inline[]` |
| `quote` | `text: Inline`, `cite?: string` |
| `pullquote` | `text: string`, `cite?: string` |
| `image` | `src, alt, caption?: Inline, credit?, width: column\|wide\|full, align: center\|left\|right, size?: S\|M\|L` (size applies to floats), `patient?` |
| `gallery` | `images: [{src, alt, caption?, patient?}]` (2–3), `caption?: Inline` |
| `imageText` | `image: {src, alt, caption?, patient?}`, `side: left\|right`, `text: Inline[]` (paragraphs) |
| `callout` | `tone: doctor\|tip\|note`, `title?: string`, `text: Inline` (`doctor` default title "When to see a doctor") |
| `takeaways` | `title?: string` (default "Key takeaways"), `items: Inline[]` |
| `divider` | — (accent diamond) |
| `table` | `caption?: string`, `header: string[]`, `rows: Inline[][]` |
| `video` | `source: film\|youtube`, `src?` (film: a `data/films.json` src), `youtube?` (11-char id), `caption?: Inline` |
| `faq` | `title?: string` (default "Questions people ask"), `items: [{q: string, a: Inline}]` |
| `cta` | `kind: whatsapp\|call\|contact`, `label?: string`, `text?: string` |

## Module map — ONE owner per file (edit only files you own)
| File | Owner | Exports |
|---|---|---|
| `src/template.js`, `src/build.js`, `src/blog/build-blog.js` | W1 build | `renderShell(opts)` in template.js |
| `src/blog/render-landing.js`, `src/blog/blog-landing.css` | W2a landing | `renderLanding(ctx)`, `renderCategoryPage(ctx, category)`, `renderAuthorPage(ctx, author)`, `renderPostCard(ctx, post, variant)` — each returns the HTML inside `<main id="main">` |
| `src/blog/render-post.js`, `src/blog/blog-post.css`, `src/blog/reader.js` | W2b post | `renderPost(ctx, post)` → HTML inside `<main>` |
| `admin/blog-blocks.js`, `src/blog/blog-blocks.css` | W2c blocks | UMD classic script (like content-rules.js; Node `require`, browser `globalThis.MediVascBlogBlocks`): `renderBlocks(blocks, opts)`, `renderInline(inline, opts)`, `headingsOf(blocks)` → `[{level, text, anchor}]`, `plainText(post)`, `readingMinutes(post)`, `slugify(text)`, `BLOCK_TYPES` |
| `src/blog/seo.js`, `src/blog/og.js`, `.github/workflows/blog-schedule.yml`, `tools/blog-due.js` | W3 seo | see seo.js stub |
| `admin/content-rules.js` (blog section only), `admin/blog-checks.js`, `data/blog/*.json` | W4 rules | `validateBlogConfig(config)`, `validateBlogPosts(posts, config)` (+ `*Detailed`), `TINTS`, `LAYOUTS`; blog-checks.js UMD `globalThis.MediVascBlogChecks`: `seoChecklist(post, allPosts)`, `claimsCheck(post)` |
| `admin/image-intake.js` | W6a intake | browser ES module `intakeImage(file, opts)` |
| `traffic/**`, tracker tail of `src/site.js`, `admin/traffic.js`, `admin/drafts-api.js` | W6b worker | drafts endpoints + blog page analytics |
| admin Blog tab (`admin/index.html`, `admin/app.js`, `admin/blog-*.js` editor files, `admin/styles.css`) | wave 2 | — |

### `ctx` (built by W1 in build-blog.js, passed to every renderer)
```
{ depth,              // '../' | '../../' | '../../../'
  siteUrl,            // 'https://medivasc.in/'
  blog,               // config.json (name, navLabel, intro, categories, authors…)
  company, films, themeId,
  posts,              // live posts, newest first, each ENRICHED with:
                      //   url (relative to site root, 'blog/<slug>/'), href (depth-prefixed),
                      //   absUrl, categoryObj, authorObj, reviewerObj, readingMinutes,
                      //   published (Date), publishedLabel ('12 Nov 2026'), updatedLabel
  featured,           // enriched posts in config.featured order (live ones only)
  categories, authors,
  related(post),      // → up to 4 enriched posts (manual post.related first, then same
                      //   category, then shared keywords)
  img(src, { sizes, widths, alt, className, loading, fetchpriority }) → '<img …srcset…>' html
  imgData(src) → { src, srcset, width, height }   // depth-prefixed
  contactHref: { whatsapp, call, contact },       // depth-correct hrefs from company.json
  homeHref,           // depth + '' (site root, i.e. '../' etc.)
}
```
`opts` for `renderBlocks`: `{ img: ctx.img, depth, films, references, contactHref }`.

### Page shell — `renderShell(opts)` (W1, template.js)
`{ depth, title, description, canonical, ogImage, ogType, jsonLd: [objects], robots,
   bodyClass, main, extraCss: [paths], extraJs: [paths], lightDefault: true }`
Same header (Blog link included), drawer, footer and chatbot as the homepage, with all
paths depth-prefixed and header anchors pointing at `${depth}#section`. Blog pages
default to the LIGHT theme (localStorage `medivasc-color-scheme` wins; the OS
preference is ignored).

### CSS / JS
Blog pages load the site CSS + one hashed `blog.css` = `blog-landing.css` +
`blog-post.css` + `blog-blocks.css` concatenated in that order (W1), and a hashed
`reader.js` (W2b) after `site.js`. Shared blog primitives live in
`blog-landing.css` (owner W2a): `--tint-*` vars, `.blog-chip[data-tint]`,
`.blog-kicker`, `.blog-meta`. Everyone else consumes them. Reading works with JS off.

## Design bar (all UI lanes)
Owner: "gorgeous", "classy and premium", "no AI slop". Premium = restraint, editorial
typography, generous whitespace, real photography — not decoration. Meridian palette
tokens only (`var(--bg)`, `--surface`, `--ink`, `--muted`, `--line`, `--primary`,
`--accent` …), Fraunces display + Instrument Sans body, motion 200ms
`cubic-bezier(.22,1,.36,1)`, reduced-motion respected, AGENTS.md "Design authority"
ban list binding. Iterate and self-critique on rendered screenshots (1440 and 390,
light and dark) before you report.

## Cross-lane pins (added before spawn)
- `ctx.absImg(src)` → absolute `https://medivasc.in/assets/…` URL of the largest variant
  (W1 provides; W3 uses it for JSON-LD, OG, RSS, image sitemap).
- `MV_BLOG_DATA=/some/dir` overrides `data/blog/` (W1 provides, for fixtures).
- Blog JS = hashed `blog.js` = `src/blog/reader.js` (W2b) + `src/blog/landing.js` (W2a)
  concatenated by W1; each file is its own guarded IIFE that no-ops on pages without its
  elements.
- Lead-in: `renderBlocks` puts `data-first` on the first `paragraph`/`lead` block's `<p>`;
  the post page sets `data-leadin="dropcap|smallcaps|boldwords|none"` on the article body
  wrapper `.post-body` and styles `[data-first]` from that (W2b CSS).
- Citations: number = index in `post.references` + 1. A cite run renders
  `<sup class="cite"><a href="#ref-<id>" id="cite-<id>-<k>">N</a></sup>` (k = 1-based
  occurrence). The references list (W2b) renders `<li id="ref-<id>">` with a back-link to
  `#cite-<id>-1`. Unknown ids render nothing.
- YouTube: `renderBlocks` outputs a no-JS facade `<a class="yt" href="https://www.youtube.com/watch?v=ID" data-yt="ID">` (thumbnail `https://i.ytimg.com/vi/ID/hqdefault.jpg`);
  `reader.js` upgrades it on click to a `youtube-nocookie.com` iframe.
- Body width classes from blocks: `.b-column` (68ch), `.b-wide` (~ 1000px), `.b-full`
  (viewport-bleed). Floats `.b-left`/`.b-right` + `.b-size-S|M|L`. The post page
  (W2b) must let `.b-wide`/`.b-full` break out of the 68ch column (and out from under the
  rail — e.g. full-bleed spans the viewport; wide spans article+rail).

---

# Wave 1.5 + Wave 2 (session 3) — advisor addendum. Same rules: do not edit; report contract bugs.

## File ownership (supersedes the module map above where they overlap)
| Lane | Owns (edit ONLY these) |
|---|---|
| V1 post | `src/blog/render-post.js`, `src/blog/blog-post.css`, `src/blog/reader.js` |
| V2 blocks | `admin/blog-blocks.js`, `src/blog/blog-blocks.css`, `tools/test/blog-blocks.test.js` |
| V3 seo | `src/blog/seo.js`, `src/blog/og.js`, `tools/blog-due.js`, `.github/workflows/blog-schedule.yml`, `tools/test/blog-seo.test.js`, `tools/test/blog-due.test.js` |
| V4 build | `src/build.js`, `src/template.js`, `src/blog/build-blog.js`, `src/blog/admin-preview.js` (new), `.gitignore` |
| V5 rules | `admin/content-rules.js` (blog section), `admin/blog-checks.js`, `data/blog/*.json`, `src/blog/check-refs.js` (new), `tools/test/blog-rules.test.js` |
| V6 landing+site | `src/blog/render-landing.js`, `src/blog/blog-landing.css`, `src/blog/landing.js`, `src/styles.css` |
| W5a admin shell | `admin/blog-tab.js` (new), `admin/blog-admin.css` (new), `admin/index.html`, `admin/app.js`, `admin/page-editor.js` (GATES only), `admin/__harness.html` |
| W5b editor | `admin/blog-editor.js` (new), `admin/blog-editor.css` (new) |
| W5c seo panel | `admin/blog-seo.js` (new), `admin/blog-seo.css` (new) |
| W5d settings | `admin/blog-manage.js` (new), `admin/blog-manage.css` (new), `admin/gh-api.js` (additive methods only) |

Dev-only scratch files are free for anyone if they match `admin/__<lane>*.html` (gitignored) or live
under `/tmp/mv-<lane>/`. Tests in `tools/test/` are plain `node <file>` scripts (no framework),
exit non-zero on failure. **Ports**: V1 8801-8809, V2 8811-, V3 8821-, V4 8831-, V5 8841-,
V6 8851-, W5a 8861- (wrangler 8869), W5b 8871-, W5c 8881-, W5d 8891-. Kill your servers before you report.
**Browser**: `require('/Users/puranjaimendiratta/dev/pi/medivasc-vid/node_modules/puppeteer-core')`
with `executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`.
Build: `MV_DIST=/tmp/mv-<lane>/dist MV_BLOG_SAMPLES=1 node src/build.js` (never the shared `dist/`).

## Pins
- Muted text token is `--ink-muted` (there is no `--muted`).
- Body/dek serif is **Source Serif 4** (blog-post.css @font-face); UI chrome (buttons, credits,
  kickers, meta) stays **Instrument Sans**; display stays Fraunces.
- `render-post.js` and `render-landing.js` stay **pure**: no Node built-ins, only the requires they
  have today (`../../admin/blog-blocks.js`, `../../admin/content-rules.js`, `./render-landing.js`).
  V4 bundles them for the browser (below); a new require breaks the admin preview.
- `headingsOf(blocks)` also returns the takeaways box as `{level: 2, text: <title>, anchor:
  'key-takeaways', kind: 'takeaways'}` when a takeaways block exists (V2); the TOC (V1) shows
  **h2 entries only** (incl. takeaways); h3 stay as in-body anchors.
- `renderOgPng` must never throw on any valid title (V3 shrinks/breaks long words);
  build-blog still wraps it in try/catch and falls back to the site OG (V4).
- `seo.postJsonLd(ctx, post, { ogImage })` — third arg optional absolute URL (V3 adds, V4 passes).
- `src/blog/check-refs.js` (V5): `checkBlogRefs(posts, config, { root, films })` → array of
  `{ postId, field, message }` for: image files missing on disk (`root`-relative `assets/…`),
  internal `blog/<slug>/` links to no live post, `config.featured` ids not in `posts`, video
  `film` srcs not in films. V4 calls it in build-blog and **fails the build** on any error
  (samples included only when MV_BLOG_SAMPLES=1). V4 also passes `films` into validateBlogPosts.
- Sample-only config: `data/blog/samples.config.json` = `{ "featured": [ids] }`, merged over
  config.json ONLY when MV_BLOG_SAMPLES=1 (V5 writes the file + empties `config.featured`;
  V4 does the merge).
- **Admin preview bundle** (V4, `src/blog/admin-preview.js`): `writeAdminPreview(outDir)` writes
  `outDir/blog-render.js` (classic script; render-landing.js + render-post.js wrapped in a tiny
  CommonJS shim whose `require` maps the two admin UMDs to `globalThis.MediVascBlogBlocks` /
  `globalThis.MediVascContentRules`; sets `globalThis.MediVascBlogRender = { renderPost,
  renderPostCard }`) and `outDir/blog-preview.css` (theme CSS for the active theme + site
  styles.css + blog.css, unhashed, font urls rewritten to `../../assets/fonts/…`). The build calls
  it for `dist/admin/preview/`; `node src/blog/admin-preview.js` (CLI) writes `admin/preview/`
  in the source tree for the harness (gitignored). copyAdmin also versions every
  `href="<name>.css"` in index.html, and its bundle hash covers `admin/*.css`.
- **Admin components** — W5a hosts; one in-memory post object is the truth, owned by W5a.
  Every component reads via `getPost()` and writes via `onChange(patch)` (a shallow object of the
  top-level post fields it changed, e.g. `{ blocks }`, `{ seo }`). Components never touch
  `state`, never publish, never call GitHub except W5c revisions through `gh`.
  ```js
  // admin/blog-editor.js (W5b) — the document: title, titleAccent, dek, cover (incl. alt,
  // caption, credit, focal, patient consent), blocks, references, titleSize/bodySize/leadIn.
  export function mountBlockEditor(root, { post, onChange, stageImage, resolveSrc, films, h, icon })
    // → { setPost(post), undo(), redo(), canUndo(), canRedo(), focus(), destroy() }
  // stageImage(file, { purpose: 'cover' | 'block' }) → Promise<{ src, width, height }>
  //   (W5a: intakeImage → drafts asset → src 'draft:<name>'); resolveSrc(src) → displayable URL.
  // admin/blog-seo.js (W5c) — slug, seo.*, about[], related[]; previews; revisions.
  export function mountSeoPanel(root, { getPost, onChange, allPosts, config, h, icon })   // → { refresh(), destroy() }
  export function mountPostPreview(root, { getPost, config, films, resolveSrc })          // → { refresh(), setMode({ device: 'phone'|'desktop', theme: 'light'|'dark' }), destroy() }
  export function mountRevisions(root, { postId, gh, onRestore })                         // → { destroy() }
  // admin/blog-manage.js (W5d) — blog name/intro/SEO, categories, authors, featured order.
  export function mountBlogSettings(root, { getConfig, onChange, posts, stageAsset, h, icon }) // onChange(config) whole config; → { refresh(), destroy() }
  export function mountCalendar(root, { posts, onOpen })                                  // onOpen(postId); → { refresh(posts), destroy() }
  export function mountScheduleAlert(root, { gh })                                        // → { destroy() }
  // admin/gh-api.js additions (W5d) on GhApi:
  //   workflowState(file) → 'active' | 'disabled_inactivity' | 'disabled_manually' | …
  //   enableWorkflow(file) → void            listCommits(path, { perPage = 30 }) → [{ sha, date, message, author }]
  //   getFileAt(path, ref) → string (file text at that commit)
  ```
  `h`/`icon` = app.js helpers (escape + svg icon). Each component loads its own CSS
  (`blog-*.css` linked from index.html by W5a, bare filenames). Draft image src scheme:
  `draft:<name>` (name matches drafts-api `ASSET_NAME`); at publish W5a rewrites to
  `assets/blog/<slug>/<name>` and stages the blob in the same commit. Post list, status,
  publish/schedule/unpublish, slug-change → `previousSlugs`, layout picker, category, author,
  reviewer, publishAt (IST) = W5a.
- Admin rule modules load as `import './content-rules.js'` side effect →
  `globalThis.MediVascContentRules` (same for blog-blocks.js, blog-checks.js).

### Addendum pins (2)
- `mountBlogSettings(root, { …, onMovePosts(fromCategoryId, toCategoryId) })` — W5d calls it when
  a category with posts is deleted; W5a implements it (rewrites `category` on those posts).
- Preview assets are referenced from admin modules ONLY as the exact string literals
  `'./preview/blog-render.js'` and `'./preview/blog-preview.css'` (resolve with
  `new URL(<literal>, import.meta.url)`); V4's copyAdmin versions those literals with `?v=`.

### Addendum pins (3) — wave 2 finish (session 4)
Ownership for this wave (supersedes the table above for these lanes):
| Lane | Owns |
|---|---|
| W5a-1 wire | `admin/app.js`, `admin/index.html`, `admin/page-editor.js` (GATES only), `admin/draft-merge.js` (blog entries only), `admin/blog-tab.js`, `admin/blog-admin.css` (structural skeleton only), `admin/__harness.html` |
| W5b-1 editor | `admin/blog-editor.js`, `admin/blog-editor.css`, `admin/__w5b.html` |
| W5c-v seo | `admin/blog-seo.js`, `admin/blog-seo.css`, `admin/__w5c.html` |
| W5d-v manage | `admin/blog-manage.js`, `admin/blog-manage.css`, `admin/gh-api.js` (additive), `admin/__w5d.html` |
| X polish | `src/site.js`, `src/blog/build-blog.js`, `src/blog/blog-blocks.css`, `src/blog/blog-post.css`, `src/blog/render-post.js` (no new requires), `src/template.js` (noscript box only) |
Only W5a touches `__harness.html`; every other admin lane tests in its own `__w5x.html`.

Optional extras, now pinned (hosts may pass them; components must work without them):
- `mountSeoPanel(root, { …, resolveSrc })` — for `draft:` covers in the share previews.
- `mountPostPreview(root, { …, allPosts, controls })` — `allPosts` fills related/featured cards;
  `controls: false` hides the component's own device/theme switches (host drives `setMode`).
- `mountBlockEditor(root, { …, historyButtons })` — `false` hides built-in undo/redo; root
  dispatches `bed:history` (`detail: { canUndo, canRedo }`) after every history change. Module
  also exports `_internals` (pure helpers, tests only).
- W5d components accept `posts` as an array OR a zero-arg getter returning one.
- Posts that exist only as D1 drafts reach components with `status: 'draft'` (not a posts.json
  status; never written to posts.json).
- Authors referenced by any post cannot be deleted (W5d blocks it, names the posts) — there is
  no `onMoveAuthor`. Deleting a category with posts moves them (`onMovePosts`) AND, if any moved
  post is live, appends `{ from: 'blog/category/<old>/', to: 'blog/category/<target>/' }`. An
  author slug change with live posts appends `blog/author/<old>/` → new, same rules as categories.
- `stageAsset(file, { purpose: 'author' })` → `Promise<{ src }>`; a replaced or removed staged
  author photo is unstaged by the host when W5d calls the optional `unstageAsset(src)`.

### Addendum pins (4) — session 5
- Preview / render ctx `depth` is always RELATIVE (`'../'`, `'../../'`…). blog-blocks `depthOf`
  silently drops an absolute depth (`'/'`), so every depth-prefixed href breaks without an error.
- `mountPostPreview(root, { …, contactHref })` — optional `{ whatsapp, call, contact }` built from
  company.json (same shape as ctx.contactHref). The host passes it; without it CTAs use defaults.
- `titleSize`, `bodySize`, `leadIn` are REQUIRED by validateBlogPosts. A new post carries them
  from creation (blog-tab blankPost); never rely on the editor's first patch to add them.
- Author photos: W5d already resizes the photo (≤800px). The host stages that blob AS-IS (no
  second intakeImage) at `assets/blog/authors/<author-slug>.<webp|jpg>` and returns that
  `assets/` src — never `draft:`, never a random name.
