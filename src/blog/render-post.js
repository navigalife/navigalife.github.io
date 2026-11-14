// The Journal post page: renderPost(ctx, post) returns the HTML that sits inside
// <main id="main">. Contract: AGENTS.md "The blog"; styles in
// blog-post.css, progressive behaviour (progress bar, TOC highlight, copy link,
// YouTube facade) in reader.js. Everything here reads fine with JS off.
//
// Four layouts share one skeleton:
//   .post[data-layout]  (container for cqw breakout maths)
//     header.post-head        — breadcrumb+chip, h1, dek, byline, cover
//     .post-layout            — [toc] · article column · [rail]
// Every href/src is depth-relative (the preview is mounted at /changes/); the only
// absolute URLs are the share targets, which must be shareable.
const blocks = require('../../admin/blog-blocks.js');
const { highlightWholeWord } = require('../../admin/content-rules.js');
const { renderPostCard, svg, CONTACT_ICONS, contactCta } = require('./render-landing.js');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LAYOUTS = new Set(['editorial', 'cover', 'split', 'guide']);
const SIZES = new Set(['S', 'M', 'L', 'XL']);
const BODY_SIZES = new Set(['S', 'M', 'L']);
const LEADINS = new Set(['dropcap', 'smallcaps', 'boldwords', 'none']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '12 Nov 2026' in IST, matching build-blog.js publishedLabel.
const dateLabel = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
};
const isoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const ICONS = {
  whatsapp: CONTACT_ICONS.whatsapp,
  x: svg('<path d="M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9Zm-1.3 19.5h2L6.5 3.2H4.3Z"/>', { fill: true }),
  linkedin: svg('<path d="M20.4 20.5h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3ZM5.3 7.4a2.1 2.1 0 1 1 0-4.1 2.1 2.1 0 0 1 0 4.1Zm1.8 13.1H3.6V9h3.5v11.5ZM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0Z"/>', { fill: true }),
  facebook: svg('<path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/>', { fill: true }),
  link: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>'),
  arrow: svg('<path d="M5 12h14M14 6l6 6-6 6"/>'),
};

const pick = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);
const list = (value) => (Array.isArray(value) ? value : []);

const safeExternal = (url) => (typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : '');
const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

const crumbLabel = (ctx) => (/journal/i.test(ctx.blog?.name || '') ? 'Journal' : (ctx.blog?.navLabel || 'Blog'));

const renderCrumbs = (ctx, post, onPhoto) => {
  const cat = post.categoryObj;
  const chip = cat
    ? `<li><a class="blog-chip post-crumbs__chip" data-tint="${esc(cat.tint || 'teal')}" href="${esc(cat.href || `${ctx.depth}blog/category/${cat.slug}/`)}">${esc(cat.name)}</a></li>`
    : '';
  return `<nav class="post-crumbs${onPhoto ? ' post-crumbs--photo' : ''}" aria-label="Breadcrumb"><ol>`
    + `<li><a class="post-crumbs__home" href="${esc(ctx.depth)}blog/">${esc(crumbLabel(ctx))}</a></li>${chip}</ol></nav>`;
};

const renderTitle = (post) => {
  const size = pick(post.titleSize, SIZES, 'L');
  return `<h1 class="post-title post-title--${size}">${highlightWholeWord(post.title || '', post.titleAccent || '', 'em')}</h1>`;
};

const renderDek = (post) => (post.dek ? `<p class="post-dek">${esc(post.dek)}</p>` : '');

const renderByline = (ctx, post) => {
  const author = post.authorObj;
  const reviewer = post.reviewerObj;
  const avatar = author && author.photo
    ? `<span class="post-byline__avatar">${ctx.img(author.photo, { sizes: '48px', alt: '', className: 'post-byline__photo' })}</span>`
    : '';
  const authorHtml = author
    ? `<a href="${esc(author.href || `${ctx.depth}blog/author/${author.slug}/`)}">${esc(author.name)}</a>`
    : '';
  const published = post.published || post.publishAt;
  // "Updated" only from the enriched updatedLabel: the build sets it through
  // seo.js updatedAtOf (a later IST day than the publish day), so the byline can
  // never disagree with dateModified / the sitemap. Never re-derived from updatedAt.
  const updated = post.updatedLabel ? `<span class="post-byline__sep" aria-hidden="true">·</span><span>Updated <time datetime="${esc(isoDate(post.updated || post.updatedAt))}">${esc(post.updatedLabel)}</time></span>` : '';
  const minutes = post.readingMinutes || blocks.readingMinutes(post);
  const review = reviewer
    ? `<p class="post-byline__review">${svg('<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/><path d="m9 12 2 2 4-4"/>')}<span>Medically reviewed by <a href="${esc(reviewer.href || `${ctx.depth}blog/author/${reviewer.slug}/`)}">${esc(reviewer.name)}</a>${post.reviewedAt ? ` <span class="post-byline__sep" aria-hidden="true">·</span> <time datetime="${esc(isoDate(post.reviewedAt))}">${esc(dateLabel(post.reviewedAt))}</time>` : ''}</span></p>`
    : '';
  return `<div class="post-byline">${avatar}<div class="post-byline__text">`
    + (authorHtml ? `<p class="post-byline__by">By ${authorHtml}</p>` : '')
    + `<p class="post-byline__dates"><time datetime="${esc(isoDate(published))}">${esc(post.publishedLabel || dateLabel(published))}</time>${updated}<span class="post-byline__sep" aria-hidden="true">·</span><span>${minutes} min read</span></p>`
    + review
    + '</div></div>';
};

const focalStyle = (cover) => {
  const f = cover && cover.focal;
  const pct = (n) => `${Math.round(Math.min(1, Math.max(0, Number.isFinite(+n) ? +n : 0.5)) * 100)}%`;
  return f ? ` style="--fx:${pct(f.x)};--fy:${pct(f.y)}"` : '';
};

// The caption is inline content (plain text, or runs with bold/links) like every
// block caption, so it goes through the same inline renderer.
const coverCaption = (ctx, post, cover) => {
  if (!cover) return '';
  const caption = cover.caption ? blocks.renderInline(cover.caption, { depth: ctx.depth, references: post.references, postLinks: ctx.postLinks }) : '';
  if (!caption && !cover.credit) return '';
  return `<figcaption class="post-cover__caption">${caption ? `<span>${caption}</span>` : ''}`
    + `${cover.credit ? `<span class="post-cover__credit">${esc(cover.credit)}</span>` : ''}</figcaption>`;
};

const coverImg = (ctx, cover, sizes) => ctx.img(cover.src, {
  sizes, alt: cover.alt || '', className: 'post-cover__img', loading: 'eager', fetchpriority: 'high',
});

const renderHeader = (ctx, post, layout) => {
  const cover = post.cover && post.cover.src ? post.cover : null;
  if (layout === 'cover' && cover) {
    return `<header class="post-head post-head--cover">`
      + `<div class="post-hero"${focalStyle(cover)}>${coverImg(ctx, cover, '100vw')}<div class="post-hero__scrim" aria-hidden="true"></div>`
      + `<div class="post-hero__content">${renderCrumbs(ctx, post, true)}${renderTitle(post)}${renderDek(post)}${renderByline(ctx, post)}</div></div>`
      + (coverCaption(ctx, post, cover) ? `<figure class="post-hero__fig">${coverCaption(ctx, post, cover)}</figure>` : '')
      + '</header>';
  }
  if (layout === 'split' && cover) {
    return `<header class="post-head post-head--split"><div class="post-split">`
      + `<div class="post-split__text">${renderCrumbs(ctx, post)}${renderTitle(post)}${renderDek(post)}${renderByline(ctx, post)}</div>`
      + `<figure class="post-cover post-cover--split"><div class="post-cover__frame"${focalStyle(cover)}>${coverImg(ctx, cover, '(max-width: 1000px) 100vw, 46vw')}</div>${coverCaption(ctx, post, cover)}</figure>`
      + '</div></header>';
  }
  const effective = layout === 'cover' || layout === 'split' ? 'editorial' : layout;
  const figure = cover
    ? `<figure class="post-cover"><div class="post-cover__frame"${focalStyle(cover)}>${coverImg(ctx, cover, '(max-width: 1240px) 100vw, 1180px')}</div>${coverCaption(ctx, post, cover)}</figure>`
    : '';
  return `<header class="post-head post-head--${effective}"><div class="post-head__text">`
    + `${renderCrumbs(ctx, post)}${renderTitle(post)}${renderDek(post)}${renderByline(ctx, post)}</div>${figure}</header>`;
};

// Guide table of contents: h2-level entries only (headings, the takeaways box and
// the FAQ title, in document order, as headingsOf reports them); h3s stay in-body
// anchors. An entry is kept only when its id really is in the rendered body, so the
// TOC never links to nothing whichever blocks version is loaded. Rendered twice from
// one list — a sticky left nav on wide screens and a collapsible "On this page" in
// the column on narrow ones; CSS shows exactly one.
const tocItems = (post, bodyHtml) => list(blocks.headingsOf(post.blocks)).filter((h) => h && h.level === 2
  && typeof h.anchor === 'string' && h.anchor && h.text && bodyHtml.includes(` id="${esc(h.anchor)}"`));
const tocList = (items) => `<ol class="post-toc__list">${items.map((h) => `<li class="post-toc__item${h.kind && h.kind !== 'heading' ? ` post-toc__item--${esc(h.kind)}` : ''}"><a href="#${esc(h.anchor)}">${esc(h.text)}</a></li>`).join('')}</ol>`;
const renderToc = (items) => `<nav class="post-toc" aria-label="On this page"><div class="post-toc__inner"><p class="post-toc__title">On this page</p>${tocList(items)}</div></nav>`;
const renderTocMobile = (items) => `<details class="post-toc-m"><summary><span>On this page</span><span class="post-toc-m__count">${items.length} sections</span></summary><nav aria-label="On this page">${tocList(items)}</nav></details>`;

// Page-level ids use underscores: slugify() never emits one, so no heading anchor
// can ever collide with them.
const renderReferences = (post, bodyHtml) => {
  // The number is the index in post.references + 1, so each
  // item carries an explicit value — a skipped entry never shifts the numbering.
  const refs = list(post.references).map((r, i) => ({ r, n: i + 1 })).filter(({ r }) => r && r.id && r.text);
  if (!refs.length) return '';
  return `<section class="post-refs" aria-labelledby="post_refs_title"><h2 class="post-endhead" id="post_refs_title">References</h2><ol class="post-refs__list">`
    + refs.map(({ r, n }) => {
      const url = safeExternal(r.url);
      const link = url ? ` <a class="post-refs__link" href="${esc(url)}" rel="noopener" target="_blank">${esc(hostOf(url) || 'Source')}<span class="sr-only"> (opens in a new tab)</span></a>` : '';
      // ↩ only when the body really rendered the #cite-<id>-1 anchor.
      const back = bodyHtml.includes(` id="cite-${esc(r.id)}-1"`) ? ` <a class="post-refs__back" href="#cite-${esc(r.id)}-1" aria-label="Back to reference ${n} in the text">↩</a>` : '';
      return `<li id="ref-${esc(r.id)}" value="${n}"><span class="post-refs__text">${esc(r.text)}</span>${link}${back}</li>`;
    }).join('')
    + '</ol></section>';
};

const renderShare = (post) => {
  const url = post.absUrl || '';
  const title = post.title || '';
  const enc = encodeURIComponent;
  const targets = [
    ['whatsapp', 'WhatsApp', `https://wa.me/?text=${enc(`${title} ${url}`)}`],
    ['x', 'X', `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`],
    ['linkedin', 'LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`],
    ['facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
  ];
  const link = ([key, label, href]) => `<li><a class="post-share__btn post-share__btn--${key}" href="${esc(href)}" rel="noopener" target="_blank">${ICONS[key]}<span${key === 'whatsapp' ? '' : ' class="sr-only"'}>${key === 'whatsapp' ? 'Share on WhatsApp' : `Share on ${label}`}</span></a></li>`;
  return `<div class="post-share"><p class="post-share__label">Share this article</p><ul class="post-share__list">`
    + link(targets[0])
    + `<li class="post-share__copy-item"><button class="post-share__btn post-share__copy" type="button" data-copy-url="${esc(url)}">${ICONS.link}<span>Copy link</span></button></li>`
    + targets.slice(1).map(link).join('')
    + '</ul></div>';
};

// The shared care-team CTA (render-landing.js contactCta, also on the coming-soon page).
const renderCta = (ctx) => contactCta(ctx, {
  id: 'post_cta_title',
  title: 'Worried about a foot or a leg <em>right now</em>?',
  text: 'Message us on WhatsApp. Tell us what you are seeing, add a photo if you can, and our team will tell you what to do next.',
});

const renderAuthorCard = (ctx, post) => {
  const author = post.authorObj;
  if (!author) return '';
  const href = author.href || `${ctx.depth}blog/author/${author.slug}/`;
  const photo = author.photo
    ? `<span class="post-author__photo">${ctx.img(author.photo, { sizes: '72px', alt: '', className: '' })}</span>`
    : `<span class="post-author__photo post-author__photo--mono" aria-hidden="true">${esc((author.name || '?').trim().charAt(0))}</span>`;
  const role = [author.role, author.credentials].filter((v) => typeof v === 'string' && v.trim()).join(', ');
  return `<aside class="post-author" aria-label="About the author">${photo}<div class="post-author__text">`
    + `<p class="post-author__kicker">Written by</p>`
    + `<p class="post-author__name"><a href="${esc(href)}">${esc(author.name)}</a></p>`
    + (role ? `<p class="post-author__role">${esc(role)}</p>` : '')
    + (author.bio ? `<p class="post-author__bio">${esc(author.bio)}</p>` : '')
    + `<a class="post-author__more" href="${esc(href)}">More from ${esc(author.name)}${ICONS.arrow}</a>`
    + '</div></aside>';
};

const railPosts = (ctx, post) => {
  const seen = new Set([post.id]);
  const take = (items, max) => {
    const out = [];
    for (const p of list(items)) {
      if (!p || seen.has(p.id) || out.length >= max) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  };
  const related = take(typeof ctx.related === 'function' ? ctx.related(post) : [], 3);
  const featured = take(ctx.featured, 2);
  return { featured, related };
};

const renderRail = (ctx, post) => {
  const { featured, related } = railPosts(ctx, post);
  if (!featured.length && !related.length) return '';
  const group = (id, title, items) => (items.length
    ? `<section class="post-rail__group" aria-labelledby="${id}"><h2 class="post-rail__title" id="${id}">${title}</h2><div class="post-rail__cards">${items.map((p) => renderPostCard(ctx, p, 'rail')).join('')}</div></section>`
    : '');
  return `<aside class="post-rail" aria-label="More from the ${esc(crumbLabel(ctx))}"><div class="post-rail__inner">`
    + group('post_rail_related', 'Related reading', related)
    + group('post_rail_featured', 'Featured', featured)
    + '</div></aside>';
};

// Lead-in words: the first few words of renderBlocks' [data-first] paragraph get a
// .leadin span (small caps after a drop cap, or bold). Only the leading plain-text
// run is touched — a paragraph that opens with a link or mark is left alone and
// the CSS falls back to ::first-line.
const LEADIN_WORDS = { dropcap: 4, boldwords: 5 };
const wrapLeadIn = (html, leadIn) => {
  const count = LEADIN_WORDS[leadIn];
  if (!count) return html;
  return html.replace(/(<p\b[^>]*\sdata-first\b[^>]*>)([^<]+)/, (all, open, text) => {
    const match = text.match(new RegExp(`^\\s*\\S+(?:\\s+\\S+){0,${count - 1}}`));
    if (!match) return all;
    return `${open}<span class="leadin">${match[0]}</span>${text.slice(match[0].length)}`;
  });
};

const DISCLAIMER = 'General information, not a diagnosis. Every foot and every wound is different; for advice about your own care, please see a doctor.';

const renderPost = (ctx, post) => {
  const layout = pick(post.layout, LAYOUTS, 'editorial');
  const bodySize = pick(post.bodySize, BODY_SIZES, 'M');
  const leadIn = pick(post.leadIn, LEADINS, 'dropcap');
  const body = wrapLeadIn(blocks.renderBlocks(post.blocks, {
    img: ctx.img, depth: ctx.depth, films: ctx.films, references: post.references, contactHref: ctx.contactHref, postLinks: ctx.postLinks,
  }), leadIn);
  const toc = layout === 'guide' ? tocItems(post, body) : [];
  const hasToc = toc.length >= 2;
  const rail = renderRail(ctx, post);
  // The closing CTA steps aside when the author already ended the body on one.
  const endsOnCta = list(post.blocks).slice(-3).some((b) => b && b.type === 'cta');
  const classes = ['post', `post--${layout}`, `post--body-${bodySize}`, rail ? 'post--rail' : 'post--norail', hasToc ? 'post--toc' : ''].filter(Boolean).join(' ');
  return `<div class="post-progress" aria-hidden="true"><span class="post-progress__bar"></span></div>`
    + `<article class="${classes}" data-layout="${layout}">`
    + renderHeader(ctx, post, layout)
    + '<div class="post-layout">'
    + (hasToc ? renderToc(toc) : '')
    + '<div class="post-main">'
    + (hasToc ? renderTocMobile(toc) : '')
    + `<div class="post-body post-body--${bodySize}" data-leadin="${leadIn}">${body}</div>`
    + '<footer class="post-end">'
    + `<p class="post-disclaimer">${esc(DISCLAIMER)}</p>`
    + renderShare(post)
    + renderReferences(post, body)
    + renderAuthorCard(ctx, post)
    + (endsOnCta ? '' : renderCta(ctx))
    + '</footer></div>'
    + rail
    + '</div></article>';
};

module.exports = { renderPost };
