// Blog block renderer — the ONE renderer for a post's body. Both sides run this
// same file, so the published page and the admin preview cannot drift apart:
//
//   build (Node 22):  const blocks = require('../admin/blog-blocks.js');
//   admin (browser):  import './blog-blocks.js';   // side-effect import
//                     const blocks = globalThis.MediVascBlogBlocks;
//
// A classic script on purpose (no import/export, no Node APIs, no deps), like
// content-rules.js. Data shapes: src/blog/CONTRACT.md "Inline text" + "Blocks".
//
// This file is the XSS boundary for post bodies. Post text is never HTML: every
// text and attribute value is escaped here; inline runs honour only b/i/hl/href/
// cite; hrefs pass an allowlist (https:, mailto:, tel:, blog/<slug>/, #anchor) or
// the run renders as plain text; image/film paths must be repo-relative assets;
// YouTube ids must be 11 safe chars; films must be listed in opts.films; unknown
// block types render nothing.
//
// API
//   renderBlocks(blocks, opts) → html     opts = { img, depth, films, references, contactHref }
//   renderInline(inline, opts) → html
//   headingsOf(blocks) → [{ level, text, anchor, kind }]   (the ids renderBlocks
//                        emits; kind = heading | faq | takeaways, document order)
//   plainText(post) → string             (title + dek + every block's text)
//   readingMinutes(post) → integer ≥ 1   (~220 wpm)
//   slugify(text) → string
//   BLOCK_TYPES                          (frozen list of known block types)
//
// opts.img(src, { sizes, alt, className, loading }) returns an <img> html string
// (the build passes ctx.img; the admin may pass a function that maps a staged
// upload to a blob: URL). It receives a validated `assets/...` path and an alt
// whose quote characters are already typographic, so an attribute can never be
// broken out of even if the helper forgets to escape. Without opts.img a plain
// depth-prefixed <img> is emitted.
(function (root) {
  'use strict';

  const BLOCK_TYPES = Object.freeze([
    'paragraph', 'lead', 'heading', 'list', 'quote', 'pullquote', 'image', 'gallery',
    'imageText', 'callout', 'takeaways', 'divider', 'table', 'video', 'faq', 'cta',
  ]);

  const hasOwn = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const field = (obj, key) => (isObj(obj) && hasOwn(obj, key) ? obj[key] : undefined);
  const list = (v) => (Array.isArray(v) ? v : []);

  const esc = (value) =>
    str(value).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
  // Escaped text with author line breaks kept.
  const escText = (value) => esc(value).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  // Typographic quotes: an alt/caption handed to a helper we do not own can then
  // never terminate a quoted attribute, escaped or not.
  const softQuotes = (value) => str(value).replace(/"/g, '\u201d').replace(/'/g, '\u2019').replace(/`/g, '\u2018');

  // ---------- slugs + heading anchors ----------
  const slugify = (text) => {
    let s = str(text);
    if (typeof s.normalize === 'function') s = s.normalize('NFKD');
    s = s
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (s.length > 64) s = s.slice(0, 64).replace(/-[^-]*$/, '') || s.slice(0, 64);
    return s;
  };

  // Ids the post page itself uses, plus the citation namespaces, are never
  // handed to a heading.
  const RESERVED_IDS = ['main', 'top', 'toc', 'contents', 'references', 'related', 'comments', 'contact'];

  const headingLevel = (b) => (Number(field(b, 'level')) === 3 ? 3 : 2);
  const faqTitle = (b) => str(field(b, 'title')).trim() || 'Questions people ask';
  const takeawaysTitle = (b) => str(field(b, 'title')).trim() || 'Key takeaways';
  const validTakeaway = (it) => plainInline(it).trim() !== '';
  const TAKEAWAYS_ID = 'key-takeaways';

  // One walk shared by headingsOf and renderBlocks, so the TOC and the page can
  // never disagree: Map(block index → { level, text, anchor, kind }), in document
  // order. The first takeaways box always owns the fixed id `key-takeaways` (the
  // TOC and any "jump to the summary" link can rely on it): the id is reserved
  // before headings are slugged, so a heading that would also claim it (an explicit
  // anchor, or the text "Key takeaways") takes the -2 suffix instead. A second
  // takeaways box gets key-takeaways-2, -3 … like any other duplicate.
  const planAnchors = (blocks) => {
    const arr = list(blocks);
    const used = new Set(RESERVED_IDS);
    const firstTakeaways = arr.findIndex((b) => isObj(b) && field(b, 'type') === 'takeaways' && list(field(b, 'items')).some(validTakeaway));
    if (firstTakeaways !== -1) used.add(TAKEAWAYS_ID);
    const plan = new Map();
    arr.forEach((b, index) => {
      if (!isObj(b)) return;
      const type = field(b, 'type');
      let level = 2;
      let text;
      let kind = type;
      if (type === 'heading') {
        text = plainInline(field(b, 'text')).trim();
        level = headingLevel(b);
      } else if (type === 'faq' && list(field(b, 'items')).some(validFaqItem)) {
        text = faqTitle(b);
      } else if (type === 'takeaways' && list(field(b, 'items')).some(validTakeaway)) {
        text = takeawaysTitle(b);
        if (index === firstTakeaways) {
          plan.set(index, { level, text, anchor: TAKEAWAYS_ID, kind });
          return;
        }
      } else return;
      if (!text) return;
      let base = type === 'takeaways' ? TAKEAWAYS_ID : slugify(field(b, 'anchor')) || slugify(text) || 'section';
      if (/^(?:ref|cite)-/.test(base) || /^\d/.test(base)) base = `s-${base}`;
      let anchor = base;
      for (let n = 2; used.has(anchor); n += 1) anchor = `${base}-${n}`;
      used.add(anchor);
      plan.set(index, { level, text, anchor, kind });
    });
    return plan;
  };

  const headingsOf = (blocks) => Array.from(planAnchors(blocks).values()).map((h) => ({ ...h }));

  // ---------- URLs ----------
  const DEPTH_RE = /^(?:\.\.\/)*$/;
  const depthOf = (opts) => {
    const d = str(field(opts, 'depth'));
    return DEPTH_RE.test(d) ? d : '';
  };

  const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
  const FRAG = '(?:#[A-Za-z0-9][A-Za-z0-9_-]*)?';
  const INTERNAL_RE = new RegExp(`^blog\\/(?:(?:category|author)\\/${SLUG}\\/|${SLUG}\\/)?${FRAG}$`);
  const ANCHOR_RE = /^#[A-Za-z][A-Za-z0-9_-]*$/;
  const HTTPS_RE = /^https:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?::\d{2,5})?(?:[/?#][^\s<>"'`\\]*)?$/i;
  const MAILTO_RE = /^mailto:[^\s<>"'`\\:/]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\?[^\s<>"'`\\]*)?$/i;
  const TEL_RE = /^tel:\+?[0-9][0-9().-]{2,24}$/i;
  const OWN_HOST_RE = /^(?:www\.)?medivasc\.in$/i;

  // → { href, external } or null. Anything not on the allowlist is null, and the
  // run renders as plain text.
  const resolveHref = (raw, depth) => {
    if (typeof raw !== 'string') return null;
    const href = raw.trim();
    if (!href || href.length > 2048 || /[\u0000- \u007f-\u009f]/.test(href)) return null;
    if (ANCHOR_RE.test(href)) return { href, external: false };
    if (INTERNAL_RE.test(href)) return { href: depth + href, external: false };
    if (TEL_RE.test(href)) return { href: href.replace(/^tel:/i, 'tel:'), external: false };
    if (MAILTO_RE.test(href)) return { href: href.replace(/^mailto:/i, 'mailto:'), external: false };
    const m = HTTPS_RE.exec(href);
    if (m) return { href: href.replace(/^https:/i, 'https:'), external: !OWN_HOST_RE.test(m[1]) };
    return null;
  };

  // Hrefs supplied by the build (ctx.contactHref) rather than the author: allow
  // the same schemes plus a depth-prefixed site-relative path.
  const trustedHref = (raw) => {
    if (typeof raw !== 'string') return null;
    const href = raw.trim();
    if (!href || /[\u0000- \u007f-\u009f<>"'`\\]/.test(href)) return null;
    if (/^https:\/\//i.test(href)) return { href, external: !/^https:\/\/(?:www\.)?medivasc\.in(?:[/?#]|$)/i.test(href) };
    if (/^(?:mailto|tel):[^/]/i.test(href)) return { href, external: false };
    if (/^(?:\.\.\/)*(?:[A-Za-z0-9_-][A-Za-z0-9._/-]*)?(?:#[A-Za-z0-9_-]*)?$/.test(href) && !/(?:^|\/)\.\.?(?:\/|$)/.test(href.replace(/^(?:\.\.\/)+/, ''))) {
      return { href, external: false };
    }
    return null;
  };

  // Repo-relative asset paths only (no scheme, no traversal, no query).
  const ASSET_RE = /^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:webp|avif|jpe?g|png|gif)$/i;
  const VIDEO_RE = /^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:mp4|webm|m4v)$/i;
  const safeAsset = (src, re) => {
    const s = str(src).trim();
    return re.test(s) && !/\.\./.test(s) ? s : '';
  };
  const YT_RE = /^[A-Za-z0-9_-]{11}$/;

  // ---------- inline ----------
  const plainInline = (inline) => {
    if (typeof inline === 'string') return inline;
    return list(inline)
      .map((run) => (typeof run === 'string' ? run : isObj(run) && !hasOwn(run, 'cite') ? str(field(run, 't')) : ''))
      .join('');
  };

  const newState = (opts) => {
    const refs = new Map();
    list(field(opts, 'references')).forEach((r, i) => {
      const id = str(field(r, 'id'));
      if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !refs.has(id)) refs.set(id, i + 1);
    });
    return { depth: depthOf(opts), refs, cites: new Map() };
  };

  const citeHtml = (id, state) => {
    if (typeof id !== 'string' || !state.refs.has(id)) return '';
    const n = state.refs.get(id);
    const k = (state.cites.get(id) || 0) + 1;
    state.cites.set(id, k);
    const safe = esc(id);
    return `<sup class="cite"><a href="#ref-${safe}" id="cite-${safe}-${k}" aria-label="Reference ${n}">${n}</a></sup>`;
  };

  const runHtml = (run) => {
    let html = escText(typeof run === 'string' ? run : field(run, 't'));
    if (!html || typeof run === 'string') return html;
    if (field(run, 'hl') === true) html = `<mark class="b-hl">${html}</mark>`;
    if (field(run, 'i') === true) html = `<em>${html}</em>`;
    if (field(run, 'b') === true) html = `<strong>${html}</strong>`;
    return html;
  };

  const linkOpen = (link) =>
    link.external
      ? `<a class="b-a" href="${esc(link.href)}" rel="noopener noreferrer" target="_blank">`
      : `<a class="b-a" href="${esc(link.href)}">`;
  const NEW_TAB = '<span class="sr-only"> (opens in a new tab)</span>';

  const inlineHtml = (inline, state) => {
    if (typeof inline === 'string') return escText(inline);
    const out = [];
    let open = null; // the link currently open, so adjacent runs share one <a>
    let lastCite = false;
    const close = () => {
      if (open) out.push(`${open.external ? NEW_TAB : ''}</a>`);
      open = null;
    };
    list(inline).forEach((run) => {
      if (!(typeof run === 'string' || isObj(run))) return;
      if (isObj(run) && hasOwn(run, 'cite')) {
        const cite = citeHtml(run.cite, state);
        if (!cite) return;
        close();
        if (lastCite) out.push('<sup class="cite-sep" aria-hidden="true">,</sup>');
        out.push(cite);
        lastCite = true;
        return;
      }
      const html = runHtml(run);
      if (!html) return;
      lastCite = false;
      const link = isObj(run) ? resolveHref(field(run, 'href'), state.depth) : null;
      if (!link || !open || open.href !== link.href) close();
      if (link && !open) {
        out.push(linkOpen(link));
        open = link;
      }
      out.push(html);
    });
    close();
    return out.join('');
  };

  const renderInline = (inline, opts) => inlineHtml(inline, newState(opts));

  // ---------- icons (stroked, 24-grid, currentColor; matches the site set) ----------
  const svg = (paths, cls = 'b-icon') =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const ICONS = {
    doctor: '<path d="M6 3.5H5a1.5 1.5 0 0 0-1.5 1.5v4a5 5 0 0 0 10 0V5A1.5 1.5 0 0 0 12 3.5h-1"/><path d="M8.5 14v1.5a5.5 5.5 0 0 0 11 0V13"/><circle cx="19.5" cy="11" r="2"/>',
    tip: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.8.7 1.2 1.4 1.2 2.3h5c0-.9.4-1.6 1.2-2.3A6 6 0 0 0 12 3Z"/>',
    note: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5h.01" stroke-width="2.2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    call: '<path d="M7.4 3.5 10 8 7.8 9.7c1.2 2.6 3.3 4.7 5.9 5.9l1.7-2.2 4.6 2.5-.8 4a2 2 0 0 1-2 1.6C9.1 20.7 3.3 14.9 2.5 6.8a2 2 0 0 1 1.6-2l3.3-.7Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    arrow: '<path d="M5 12h14M14 6l6 6-6 6"/>',
  };
  const WHATSAPP = '<svg class="b-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></svg>';

  // ---------- images ----------
  // `sizes` per layout: column ≈ 68ch (~700px), wide ≈ 1040px, full = viewport;
  // floats and phones collapse to the column (20px gutters).
  const PHONE = '(max-width: 760px) calc(100vw - 40px)';
  const SIZES = {
    column: `${PHONE}, 720px`,
    wide: '(max-width: 1100px) calc(100vw - 40px), 1040px',
    full: '100vw',
    S: `${PHONE}, 240px`,
    M: `${PHONE}, 300px`,
    L: `${PHONE}, 360px`,
    gallery2: '(max-width: 760px) calc(50vw - 26px), 360px',
    gallery3: '(max-width: 760px) calc(50vw - 26px), 345px',
    gallery3lead: '(max-width: 760px) calc(100vw - 40px), 345px',
    imageText: `${PHONE}, 320px`,
  };

  const imgHtml = (state, opts, image, sizes, className) => {
    const src = safeAsset(field(image, 'src'), ASSET_RE);
    if (!src) return '';
    const alt = softQuotes(field(image, 'alt'));
    const fn = field(opts, 'img');
    if (typeof fn === 'function') {
      const html = fn(src, { sizes, alt, className, loading: 'lazy' });
      if (typeof html === 'string' && /^\s*<img\s[^<]*>\s*$/i.test(html)) return html.trim();
    }
    return `<img class="${esc(className)}" src="${esc(state.depth + src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  };

  const patientAttr = (image) => (field(image, 'patient') === true ? ' data-patient' : '');

  const captionHtml = (caption, credit, state) => {
    const cap = inlineHtml(caption, state);
    const cred = escText(str(credit).trim());
    if (!cap && !cred) return '';
    return `<figcaption>${cap ? `<span class="b-caption">${cap}</span>` : ''}${cred ? `<span class="b-credit">${cred}</span>` : ''}</figcaption>`;
  };

  // ---------- blocks ----------
  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

  const R = Object.create(null);

  R.paragraph = (b, s) => {
    const html = inlineHtml(field(b, 'text'), s);
    if (!html) return '';
    const first = s.firstDone ? '' : ' data-first';
    s.firstDone = true;
    return `<p class="b-p"${first}>${html}</p>`;
  };

  R.lead = (b, s) => {
    const html = inlineHtml(field(b, 'text'), s);
    if (!html) return '';
    const first = s.firstDone ? '' : ' data-first';
    s.firstDone = true;
    return `<p class="b-lead"${first}>${html}</p>`;
  };

  R.heading = (b, s, i) => {
    const h = s.anchors.get(i);
    if (!h) return '';
    const size = oneOf(field(b, 'size'), ['S', 'M', 'L'], 'M');
    const id = esc(h.anchor);
    return `<h${h.level} class="b-heading b-h${h.level} b-h--${size}" id="${id}">${esc(h.text)}<a class="b-anchor" href="#${id}" aria-hidden="true" tabindex="-1">${svg(ICONS.link)}</a></h${h.level}>`;
  };

  R.list = (b, s) => {
    const items = list(field(b, 'items')).map((it) => inlineHtml(it, s)).filter(Boolean);
    if (!items.length) return '';
    const tag = field(b, 'style') === 'number' ? 'ol' : 'ul';
    const cls = tag === 'ol' ? 'b-list b-list--number' : 'b-list b-list--bullet';
    return `<${tag} class="${cls}">${items.map((li) => `<li>${li}</li>`).join('')}</${tag}>`;
  };

  R.quote = (b, s) => {
    const html = inlineHtml(field(b, 'text'), s);
    if (!html) return '';
    const cite = str(field(b, 'cite')).trim();
    return `<figure class="b-quote b-column"><blockquote><p>${html}</p></blockquote>${cite ? `<figcaption><cite>${esc(cite)}</cite></figcaption>` : ''}</figure>`;
  };

  R.pullquote = (b) => {
    // Our own curly quotes replace any the author typed; the opening one hangs.
    const text = str(field(b, 'text')).trim().replace(/^["'\u201c\u201d\u2018\u2019\u00ab\u00bb]+|["'\u201c\u201d\u2018\u2019\u00ab\u00bb]+$/g, '').trim();
    if (!text) return '';
    const cite = str(field(b, 'cite')).trim();
    return `<figure class="b-pullquote b-column"><blockquote><p><span class="b-hang" aria-hidden="true">\u201c</span>${escText(text)}<span aria-hidden="true">\u201d</span></p></blockquote>${cite ? `<figcaption><cite>${esc(cite)}</cite></figcaption>` : ''}</figure>`;
  };

  R.image = (b, s) => {
    const align = oneOf(field(b, 'align'), ['center', 'left', 'right'], 'center');
    const float = align !== 'center';
    const width = float ? 'column' : oneOf(field(b, 'width'), ['column', 'wide', 'full'], 'column');
    const size = oneOf(field(b, 'size'), ['S', 'M', 'L'], 'M');
    const img = imgHtml(s, s.opts, b, float ? SIZES[size] : SIZES[width], 'b-img');
    if (!img) return '';
    const cls = ['b-image', `b-${width}`];
    if (float) cls.push(`b-${align}`, `b-size-${size}`);
    return `<figure class="${cls.join(' ')}"${patientAttr(b)}>${img}${captionHtml(field(b, 'caption'), field(b, 'credit'), s)}</figure>`;
  };

  R.gallery = (b, s) => {
    const images = list(field(b, 'images')).filter((im) => isObj(im) && safeAsset(field(im, 'src'), ASSET_RE)).slice(0, 3);
    if (!images.length) return '';
    const n = images.length;
    const items = images.map((im, k) => {
      const sizes = n === 1 ? SIZES.column : n === 2 ? SIZES.gallery2 : k === 0 ? SIZES.gallery3lead : SIZES.gallery3;
      const cap = inlineHtml(field(im, 'caption'), s);
      return `<figure class="b-gallery__item"${patientAttr(im)}>${imgHtml(s, s.opts, im, sizes, 'b-img')}${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
    });
    // data-n, never data-count: site.js animates every [data-count] (homepage
    // stats) by overwriting its textContent, which would wipe the gallery.
    return `<figure class="b-gallery ${n === 3 ? 'b-wide' : 'b-column'}" data-n="${n}"><div class="b-gallery__grid">${items.join('')}</div>${captionHtml(field(b, 'caption'), '', s)}</figure>`;
  };

  R.imageText = (b, s) => {
    const image = field(b, 'image');
    const img = isObj(image) ? imgHtml(s, s.opts, image, SIZES.imageText, 'b-img') : '';
    const paras = list(field(b, 'text')).map((t) => inlineHtml(t, s)).filter(Boolean);
    if (!img) return paras.map((p) => `<p class="b-p">${p}</p>`).join('');
    const side = field(b, 'side') === 'right' ? 'right' : 'left';
    const media = `<figure class="b-imagetext__media"${patientAttr(image)}>${img}${captionHtml(field(image, 'caption'), '', s)}</figure>`;
    return `<div class="b-imagetext b-column" data-side="${side}">${media}<div class="b-imagetext__text">${paras.map((p) => `<p>${p}</p>`).join('')}</div></div>`;
  };

  const CALLOUT_TITLES = { doctor: 'When to see a doctor', tip: 'Tip', note: 'Note' };
  R.callout = (b, s) => {
    const tone = oneOf(field(b, 'tone'), ['doctor', 'tip', 'note'], 'note');
    const html = inlineHtml(field(b, 'text'), s);
    if (!html) return '';
    const title = str(field(b, 'title')).trim() || CALLOUT_TITLES[tone];
    return `<aside class="b-callout b-callout--${tone} b-column" aria-label="${esc(title)}"><span class="b-callout__icon">${svg(ICONS[tone])}</span><p class="b-callout__title">${esc(title)}</p><p class="b-callout__text">${html}</p></aside>`;
  };

  R.takeaways = (b, s, i) => {
    const h = s.anchors.get(i);
    if (!h) return '';
    const items = list(field(b, 'items')).filter(validTakeaway).map((it) => inlineHtml(it, s)).filter(Boolean);
    if (!items.length) return '';
    return `<aside class="b-takeaways b-column" id="${esc(h.anchor)}" aria-label="${esc(h.text)}"><p class="b-takeaways__title">${esc(h.text)}</p><ul class="b-takeaways__list">${items.map((li) => `<li>${li}</li>`).join('')}</ul></aside>`;
  };

  R.divider = () => '<hr class="b-divider b-column">';

  R.table = (b, s) => {
    const header = list(field(b, 'header')).map((h) => esc(plainInline(h)));
    const rows = list(field(b, 'rows')).filter(Array.isArray).map((row) => row.map((c) => inlineHtml(c, s)));
    if (!rows.length && !header.some(Boolean)) return '';
    const caption = str(field(b, 'caption')).trim();
    const thead = header.some(Boolean) ? `<thead><tr>${header.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>` : '';
    const tbody = rows.length ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>` : '';
    const label = caption ? ` aria-label="${esc(caption)}"` : ' aria-label="Table"';
    // The caption sits outside the scroll region so it wraps to the frame on a
    // phone instead of scrolling away with a wide table.
    const tag = caption ? 'figure' : 'div';
    return `<${tag} class="b-table b-column">${caption ? `<figcaption class="b-table__caption">${esc(caption)}</figcaption>` : ''}<div class="b-table__scroll" role="region" tabindex="0"${label}><table>${thead}${tbody}</table></div></${tag}>`;
  };

  R.video = (b, s) => {
    const source = field(b, 'source');
    if (source === 'youtube') {
      const id = field(b, 'youtube');
      if (typeof id !== 'string') return '';
      if (!YT_RE.test(id)) return '';
      const cap = inlineHtml(field(b, 'caption'), s);
      const name = plainInline(field(b, 'caption')).trim();
      return `<figure class="b-video b-video--youtube b-column"><a class="yt" href="https://www.youtube.com/watch?v=${id}" data-yt="${id}" rel="noopener noreferrer" target="_blank"><img class="yt__thumb" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" decoding="async" width="480" height="360"><span class="yt__play" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8.5 5.8v12.4L18.6 12z" fill="currentColor"/></svg></span><span class="sr-only">Play video${name ? `: ${esc(name)}` : ''} (YouTube)</span></a>${cap ? `<figcaption><span class="b-caption">${cap}</span></figcaption>` : ''}</figure>`;
    }
    if (source === 'film') {
      const src = safeAsset(field(b, 'src'), VIDEO_RE);
      const film = src ? list(field(s.opts, 'films')).find((f) => isObj(f) && field(f, 'src') === src) : null;
      if (!film) return '';
      const poster = safeAsset(field(film, 'poster'), ASSET_RE);
      const cap = inlineHtml(field(b, 'caption'), s) || escText(str(field(film, 'caption')).trim());
      const type = /\.webm$/i.test(src) ? 'video/webm' : 'video/mp4';
      return `<figure class="b-video b-video--film b-column"><video controls preload="none" playsinline${poster ? ` poster="${esc(s.depth + poster)}"` : ''}><source src="${esc(s.depth + src)}" type="${type}"></video>${cap ? `<figcaption><span class="b-caption">${cap}</span></figcaption>` : ''}</figure>`;
    }
    return '';
  };

  const validFaqItem = (it) => isObj(it) && str(field(it, 'q')).trim() && plainInline(field(it, 'a')).trim();
  R.faq = (b, s, i) => {
    const items = list(field(b, 'items')).filter(validFaqItem);
    if (!items.length) return '';
    const h = s.anchors.get(i);
    const title = h ? `<h2 class="b-faq__title" id="${esc(h.anchor)}">${esc(h.text)}</h2>` : '';
    const body = items
      .map((it) => `<details class="b-faq__item"><summary><span class="b-faq__q">${esc(str(field(it, 'q')).trim())}</span><span class="b-faq__mark" aria-hidden="true"></span></summary><div class="b-faq__a"><p>${inlineHtml(field(it, 'a'), s)}</p></div></details>`)
      .join('');
    return `<section class="b-faq b-column"${h ? ` aria-labelledby="${esc(h.anchor)}"` : ''}>${title}<div class="b-faq__list">${body}</div></section>`;
  };

  // A route the author asked for that has no number on record degrades the
  // same way the homepage CTAs do (Lesson 18): WhatsApp → email → contact.
  const CTA_ROUTES = {
    whatsapp: ['whatsapp', 'email', 'contact'],
    call: ['call', 'whatsapp', 'email', 'contact'],
    contact: ['contact', 'email'],
  };
  const CTA_LABELS = { whatsapp: 'Message us on WhatsApp', call: 'Call the clinic', email: 'Email us', contact: 'Contact us' };
  const CTA_ICONS = { whatsapp: WHATSAPP, call: svg(ICONS.call), email: svg(ICONS.mail), contact: svg(ICONS.arrow) };
  R.cta = (b, s) => {
    const kind = oneOf(field(b, 'kind'), ['whatsapp', 'call', 'contact'], 'contact');
    const hrefs = field(s.opts, 'contactHref');
    let route = null;
    let link = null;
    for (const r of CTA_ROUTES[kind]) {
      link = trustedHref(field(hrefs, r));
      if (link) {
        route = r;
        break;
      }
    }
    if (!link) return '';
    const label = (route === kind && str(field(b, 'label')).trim()) || CTA_LABELS[route];
    const text = str(field(b, 'text')).trim();
    const ext = link.external ? ' rel="noopener noreferrer" target="_blank"' : '';
    const icon = route === 'contact' ? '' : CTA_ICONS[route];
    const trail = route === 'contact' ? CTA_ICONS.contact : '';
    return `<aside class="b-cta b-column" data-kind="${route}"${text ? '' : ' data-bare'}>${text ? `<p class="b-cta__text">${escText(text)}</p>` : ''}<a class="b-cta__button" href="${esc(link.href)}"${ext}>${icon}<span>${esc(label)}</span>${trail}${link.external ? NEW_TAB : ''}</a></aside>`;
  };

  const renderBlocks = (blocks, opts) => {
    const arr = list(blocks);
    const state = newState(opts);
    state.opts = isObj(opts) ? opts : {};
    state.anchors = planAnchors(arr);
    state.firstDone = false;
    const out = [];
    arr.forEach((b, i) => {
      if (!isObj(b)) return;
      const type = field(b, 'type');
      if (typeof type !== 'string' || !hasOwn(R, type)) return;
      let html = '';
      try {
        html = R[type](b, state, i);
      } catch (err) {
        html = ''; // a malformed block never takes the page down with it
      }
      if (html) out.push(html);
    });
    return out.join('\n');
  };

  // ---------- plain text + reading time ----------
  const blockText = (b) => {
    if (!isObj(b)) return [];
    const t = (v) => plainInline(v);
    const F = (k) => field(b, k);
    switch (F('type')) {
      case 'paragraph': case 'lead': return [t(F('text'))];
      case 'heading': return [t(F('text'))];
      case 'list': return list(F('items')).map(t);
      case 'quote': case 'pullquote': return [t(F('text')), str(F('cite'))];
      case 'image': return [t(F('caption'))];
      case 'gallery': return [...list(F('images')).map((im) => t(field(im, 'caption'))), t(F('caption'))];
      case 'imageText': return [t(field(F('image'), 'caption')), ...list(F('text')).map(t)];
      case 'callout': return [str(F('title')), t(F('text'))];
      case 'takeaways': return [str(F('title')), ...list(F('items')).map(t)];
      case 'table': return [str(F('caption')), ...list(F('header')).map(t), ...list(F('rows')).flatMap((r) => list(r).map(t))];
      case 'video': return [t(F('caption'))];
      case 'faq': return [str(F('title')), ...list(F('items')).flatMap((it) => [str(field(it, 'q')), t(field(it, 'a'))])];
      case 'cta': return [str(F('label')), str(F('text'))];
      default: return [];
    }
  };

  const plainText = (post) => {
    if (!isObj(post)) return '';
    const parts = [str(field(post, 'title')), str(field(post, 'dek'))];
    list(field(post, 'blocks')).forEach((b) => parts.push(...blockText(b)));
    return parts.map((p) => p.trim()).filter(Boolean).join('\n');
  };

  const readingMinutes = (post) => {
    const words = (plainText(post).match(/\S+/g) || []).length;
    return Math.max(1, Math.round(words / 220));
  };

  const api = Object.freeze({ renderBlocks, renderInline, headingsOf, plainText, readingMinutes, slugify, BLOCK_TYPES });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MediVascBlogBlocks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
