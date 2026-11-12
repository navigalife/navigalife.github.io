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
