// Blog landing, category, author pages and the shared post card (W2a).
// Contract: src/blog/CONTRACT.md. Every renderer returns the HTML that goes inside
// <main id="main">; every href is ctx-relative (post.href, category.href, ctx.depth),
// never root-absolute. All text is escaped here — nothing from data is trusted.
//
// Shared primitives defined in blog-landing.css (other lanes consume them):
//   data-tint="teal|clay|sage|ochre|slate|plum"  sets --t / --t-ink on any element
//   .blog-chip[data-tint]   uppercase category pill (tint background, tint-ink text)
//   .blog-kicker            quiet uppercase label with the accent dot
//   .blog-meta              small muted meta row; children separated by .blog-meta__sep
//   .blog-meta__pill        read-time pill inside a meta row
// Exported renderPostCard(ctx, post, variant): 'grid' (default) | 'rail' | 'row'.

const TINTS = ['teal', 'clay', 'sage', 'ochre', 'slate', 'plum'];
const GRID_COUNT = 6; // two rows of three under the carousel; the rest go to the archive

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const tintOf = (category) => (category && TINTS.includes(category.tint) ? category.tint : 'teal');
const blogHref = (ctx) => `${ctx.depth}blog/`;
const taxonHref = (ctx, kind, item) => item.href || `${ctx.depth}blog/${kind}/${item.slug}/`;
const arrow = '<svg class="blog-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M14 6l6 6-6 6"/></svg>';

// Title with the optional whole-word `titleAccent` phrase wrapped in <em>.
const titleHtml = (post) => {
  const title = text(post.title);
  const accent = text(post.titleAccent);
  if (!accent) return esc(title);
  const at = title.toLowerCase().indexOf(accent.toLowerCase());
  const word = /[\p{L}\p{N}]/u;
  if (at < 0 || word.test(title[at - 1] || '') || word.test(title[at + accent.length] || '')) return esc(title);
  return `${esc(title.slice(0, at))}<em>${esc(title.slice(at, at + accent.length))}</em>${esc(title.slice(at + accent.length))}`;
};

const isoOf = (post) => (text(post.publishAt) || (post.published instanceof Date ? post.published.toISOString() : ''));
const timeHtml = (post) => `<time datetime="${esc(isoOf(post))}">${esc(post.publishedLabel)}</time>`;
const minutes = (post) => `${Math.max(1, Number(post.readingMinutes) || 1)} min read`;
const sep = '<span class="blog-meta__sep" aria-hidden="true"></span>';
const paragraphs = (value) => text(value).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

const chip = (ctx, category, tag = 'a') => {
  if (!category) return '';
  const attrs = `class="blog-chip" data-tint="${tintOf(category)}"`;
  return tag === 'a'
    ? `<a ${attrs} href="${esc(taxonHref(ctx, 'category', category))}">${esc(category.name)}</a>`
    : `<span ${attrs}>${esc(category.name)}</span>`;
};

// Cover image with its focal point carried into object-position. Without a cover
// the card shows a quiet tint panel with the diamond marker instead of a hole.
const media = (ctx, post, className, imgOpts) => {
  const cover = post.cover && text(post.cover.src) ? post.cover : null;
  if (!cover) return `<div class="${className} ${className}--empty" aria-hidden="true"><span class="blog-diamond"></span></div>`;
  const fx = Math.round(Math.min(1, Math.max(0, Number(cover.focal && cover.focal.x) || 0.5)) * 100);
  const fy = Math.round(Math.min(1, Math.max(0, Number(cover.focal && cover.focal.y) || 0.5)) * 100);
  const focal = cover.focal ? ` style="--fx:${fx}%;--fy:${fy}%"` : '';
  return `<div class="${className}"${focal}>${ctx.img(cover.src, { alt: text(cover.alt), ...imgOpts })}</div>`;
};

const authorName = (post) => (post.authorObj && text(post.authorObj.name)) || '';

// --- Post card -----------------------------------------------------------------

// `dek` is only rendered for a lone card (blog-grid--n1), which lays out as a wide split;
// `showAuthor` is off on the author's own page, where the byline would repeat.
const gridCard = (ctx, post, { eager = false, showChip = true, showAuthor = true, dek = false } = {}) => `
<article class="blog-card" data-tint="${tintOf(post.categoryObj)}">
  ${media(ctx, post, 'blog-card__media', {
    sizes: '(max-width: 760px) calc(100vw - 40px), (max-width: 1000px) calc(50vw - 40px), 400px',
    loading: eager ? 'eager' : 'lazy',
  })}
  <div class="blog-card__body">
    ${showChip ? chip(ctx, post.categoryObj) : ''}
    <h3 class="blog-card__title"><a class="blog-card__link" href="${esc(post.href)}">${titleHtml(post)}</a></h3>
    ${dek && text(post.dek) ? `<p class="blog-card__dek">${esc(post.dek)}</p>` : ''}
    <p class="blog-meta">${showAuthor && authorName(post) ? `<span>${esc(authorName(post))}</span>${sep}` : ''}${timeHtml(post)}<span class="blog-meta__pill">${minutes(post)}</span></p>
  </div>
</article>`;

const railCard = (ctx, post) => `
<article class="blog-rail-card">
  ${media(ctx, post, 'blog-rail-card__media', { sizes: '88px', widths: [480] })}
  <div class="blog-rail-card__body">
    <h3 class="blog-rail-card__title"><a class="blog-card__link" href="${esc(post.href)}">${titleHtml(post)}</a></h3>
    <p class="blog-meta">${timeHtml(post)}${sep}<span>${minutes(post)}</span></p>
  </div>
</article>`;

const rowCard = (ctx, post) => `
<article class="blog-row">
  <h3 class="blog-row__title"><a class="blog-card__link" href="${esc(post.href)}">${titleHtml(post)}</a></h3>
  <div class="blog-row__meta">${chip(ctx, post.categoryObj)}${timeHtml(post)}</div>
  <span class="blog-row__arrow" aria-hidden="true">${arrow}</span>
</article>`;

const renderPostCard = (ctx, post, variant = 'grid') => {
  if (variant === 'rail') return railCard(ctx, post);
  if (variant === 'row') return rowCard(ctx, post);
  return gridCard(ctx, post);
};

// --- Featured carousel ---------------------------------------------------------

const featureSlide = (ctx, post, index, total) => `
<article class="blog-feature" data-tint="${tintOf(post.categoryObj)}"${total > 1 ? ` aria-label="${index + 1} of ${total}"` : ''} data-bf-slide>
  <div class="blog-feature__panel">
    <div class="blog-feature__chips">${chip(ctx, post.categoryObj)}</div>
    <div class="blog-feature__copy">
      <h3 class="blog-feature__title"><a class="blog-card__link" href="${esc(post.href)}">${titleHtml(post)}</a></h3>
      ${text(post.dek) ? `<p class="blog-feature__dek">${esc(post.dek)}</p>` : ''}
      <p class="blog-meta">${timeHtml(post)}<span class="blog-meta__pill">${minutes(post)}</span></p>
    </div>
  </div>
  ${media(ctx, post, 'blog-feature__media', {
    sizes: '(max-width: 760px) calc(100vw - 64px), (max-width: 1240px) 50vw, 600px',
    loading: index === 0 ? 'eager' : 'lazy',
    fetchpriority: index === 0 ? 'high' : undefined,
  })}
</article>`;

const featuredSection = (ctx, posts) => {
  if (!posts.length) return '';
  const many = posts.length > 1;
  const slides = posts.map((post, i) => featureSlide(ctx, post, i, posts.length)).join('');
  const pad = (n) => String(n).padStart(2, '0');
  return `
<section class="blog-featured${many ? '' : ' blog-featured--single'}" aria-labelledby="blog-featured-title"${many ? ' data-blog-featured' : ''}>
  <h2 id="blog-featured-title" class="sr-only">Featured</h2>
  <div class="blog-featured__track" data-bf-track${many ? ' role="group" aria-roledescription="carousel" aria-label="Featured articles"' : ''}>${slides}</div>
  ${many ? `<div class="blog-featured__pager container" data-bf-pager>
    <button type="button" class="blog-featured__arrow blog-featured__arrow--prev" data-bf-prev aria-label="Previous featured article">${arrow}</button>
    <div class="blog-featured__bar" aria-hidden="true"><span data-bf-thumb style="--n:${posts.length}"></span></div>
    <span class="blog-featured__count" aria-live="polite"><span data-bf-index>01</span> / ${pad(posts.length)}</span>
    <button type="button" class="blog-featured__arrow" data-bf-next aria-label="Next featured article">${arrow}</button>
  </div>` : ''}
</section>`;
};

// --- Shared page pieces --------------------------------------------------------

const topicNav = (ctx, currentId) => {
  const cats = list(ctx.categories);
  if (!cats.length) return '';
  const pill = (href, label, current, tint) => `<li><a class="blog-topic" href="${esc(href)}"${current ? ' aria-current="page"' : ''}${tint ? ` data-tint="${tint}"` : ''}>${tint ? '<span class="blog-topic__dot" aria-hidden="true"></span>' : ''}${esc(label)}</a></li>`;
  return `
<nav class="blog-topics" aria-label="Topics">
  <ul class="blog-topics__list">
    ${pill(blogHref(ctx), 'All', !currentId)}
    ${cats.map((c) => pill(taxonHref(ctx, 'category', c), c.name, c.id === currentId, tintOf(c))).join('\n    ')}
  </ul>
</nav>`;
};

const crumbs = (ctx, label) => `
<nav class="blog-crumbs" aria-label="Breadcrumb">
  <ol>
    <li><a href="${esc(ctx.homeHref || ctx.depth)}">Home</a></li>
    <li><a href="${esc(blogHref(ctx))}">${esc(ctx.blog.name)}</a></li>
    <li><span aria-current="page">${esc(label)}</span></li>
  </ol>
</nav>`;

// One or two posts (the launch reality for most categories) get their own layouts:
// n1 = a wide image/text split, n2 = a centred pair, instead of a ragged 3-up row.
const gridSection = (ctx, id, title, posts, { label = '', showChip = true, showAuthor = true } = {}) => {
  if (!posts.length) return '';
  const n = posts.length < 3 ? ` blog-grid--n${posts.length}` : '';
  const dek = posts.length === 1;
  return `
<section class="blog-section container" aria-labelledby="${id}">
  <header class="blog-section__head">
    <h2 class="blog-section__title" id="${id}">${esc(title)}</h2>
    ${label ? `<p class="blog-section__label">${esc(label)}</p>` : ''}
  </header>
  <div class="blog-grid${n}">${posts.map((p) => gridCard(ctx, p, { showChip, showAuthor, dek })).join('')}</div>
</section>`;
};

const count = (n) => `${n} ${n === 1 ? 'article' : 'articles'}`;

// --- Landing -------------------------------------------------------------------

const renderLanding = (ctx) => {
  const posts = list(ctx.posts);
  const featured = list(ctx.featured).length
    ? list(ctx.featured)
    : posts.slice(0, posts.length > 4 ? 3 : Math.min(1, posts.length));
  const featuredIds = new Set(featured.map((p) => p.id));
  const rest = posts.filter((p) => !featuredIds.has(p.id));
  const grid = rest.slice(0, GRID_COUNT);
  const archive = rest.slice(GRID_COUNT);
  const latest = posts[0];
  return `
<div class="blog-landing">
  <header class="blog-masthead container">
    ${latest ? `<p class="blog-kicker">Updated <time datetime="${esc(isoOf(latest))}">${esc(latest.publishedLabel)}</time></p>` : ''}
    <h1 class="blog-masthead__title">${esc(ctx.blog.name)}</h1>
    ${text(ctx.blog.intro) ? `<p class="blog-masthead__intro">${esc(ctx.blog.intro)}</p>` : ''}
  </header>
  ${topicNav(ctx, null)}
  ${featuredSection(ctx, featured)}
  ${gridSection(ctx, 'blog-latest-title', 'Latest', grid)}
  ${posts.length ? '' : '<p class="blog-empty container">The first articles are on the way.</p>'}
  ${archive.length ? `
  <section class="blog-section blog-archive container" aria-labelledby="blog-archive-title" data-blog-archive>
    <header class="blog-section__head">
      <h2 class="blog-section__title" id="blog-archive-title">Archive</h2>
      <p class="blog-section__label">${count(archive.length)}</p>
    </header>
    <div class="blog-archive__rows" data-archive-rows>${archive.map((p) => rowCard(ctx, p)).join('')}</div>
    <div class="blog-archive__more"><button type="button" class="button button--outline" data-archive-more hidden>Load more</button></div>
  </section>` : ''}
</div>`;
};

// --- Category ------------------------------------------------------------------

const renderCategoryPage = (ctx, category) => {
  const posts = list(ctx.posts).filter((p) => p.category === category.id);
  const intro = paragraphs(category.intro);
  return `
<div class="blog-landing blog-landing--taxon" data-tint="${tintOf(category)}">
  <header class="blog-masthead blog-masthead--taxon container">
    ${crumbs(ctx, category.name)}
    ${posts.length ? `<p class="blog-kicker blog-kicker--tint">${count(posts.length)}</p>` : ''}
    <h1 class="blog-masthead__title">${esc(category.name)}</h1>
    ${intro.map((p) => `<p class="blog-masthead__intro">${esc(p)}</p>`).join('')}
  </header>
  ${topicNav(ctx, category.id)}
  ${posts.length
    ? gridSection(ctx, 'blog-category-posts', 'Articles', posts, { showChip: false })
    : '<p class="blog-empty container">New articles on this topic are on the way.</p>'}
</div>`;
};

// --- Author --------------------------------------------------------------------

const renderAuthorPage = (ctx, author) => {
  const all = list(ctx.posts);
  const written = all.filter((p) => p.author === author.id);
  const reviewed = all.filter((p) => p.reviewer === author.id && p.author !== author.id);
  const role = [text(author.role), text(author.credentials)].filter(Boolean).join(', ');
  const bio = paragraphs(author.bio);
  const kicker = written.length ? count(written.length) : reviewed.length ? 'Medical reviewer' : '';
  const photo = text(author.photo)
    ? `<div class="blog-author__photo">${ctx.img(author.photo, { alt: text(author.name), sizes: '144px', widths: [480], loading: 'eager' })}</div>`
    : '';
  return `
<div class="blog-landing blog-landing--taxon">
  <header class="blog-masthead blog-masthead--taxon blog-author container">
    ${crumbs(ctx, author.name)}
    ${photo}
    ${kicker ? `<p class="blog-kicker">${kicker}</p>` : ''}
    <h1 class="blog-masthead__title">${esc(author.name)}</h1>
    ${role ? `<p class="blog-author__role">${esc(role)}</p>` : ''}
    ${bio.map((p) => `<p class="blog-masthead__intro">${esc(p)}</p>`).join('')}
  </header>
  ${gridSection(ctx, 'blog-author-posts', 'Articles', written, { showAuthor: false })}
  ${gridSection(ctx, 'blog-author-reviewed', 'Medically reviewed', reviewed)}
  ${written.length || reviewed.length ? '' : `<p class="blog-empty container">Articles by ${esc(author.name)} are on the way.</p>`}
</div>`;
};

module.exports = { renderLanding, renderCategoryPage, renderAuthorPage, renderPostCard };
