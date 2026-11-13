// Blog SEO: JSON-LD graphs, <title>/description, RSS, sitemap entries, llms.txt
// section and redirect stubs. See src/blog/CONTRACT.md. All functions are pure.
//
// JSON-LD builders return ONE `@graph` object per page (W1 serialises it). The graph
// reuses the homepage's node ids — `<site>#website` (WebSite) and
// `<site>#organization` (MedicalClinic) — so Google joins every article to the
// same publisher entity, and the journal itself is `<site>blog/#blog`.
'use strict';

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
const unique = (values) => [...new Set(values.filter(Boolean))];

// Inline (string | runs) → plain text; citation runs vanish.
const inlineText = (inline) => (typeof inline === 'string' ? inline
  : list(inline).map((run) => (run && typeof run.t === 'string' ? run.t : '')).join('')).replace(/\s+/g, ' ').trim();

// ISO 8601 with an offset is already a valid schema.org/W3C datetime; keep it as
// typed (the owner's +05:30). Anything else parseable becomes UTC ISO; junk → ''.
const W3C = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const dateOf = (value) => {
  const date = value instanceof Date ? value : new Date(text(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
const w3c = (value) => {
  if (typeof value === 'string' && W3C.test(value.trim()) && dateOf(value)) return value.trim();
  const date = dateOf(value);
  return date ? date.toISOString() : '';
};
const dayOf = (value) => {
  const iso = w3c(value);
  return iso ? iso.slice(0, 10) : '';
};

const siteOf = (ctx) => text(ctx && ctx.siteUrl) || 'https://medivasc.in/';
const ids = (ctx) => {
  const site = siteOf(ctx);
  return { site, website: `${site}#website`, org: `${site}#organization`, blog: `${site}blog/#blog`, blogUrl: `${site}blog/` };
};
const blogName = (ctx) => text(ctx && ctx.blog && ctx.blog.name) || 'Journal';
const siteName = (ctx) => text(ctx && ctx.company && ctx.company.name) || 'MediVasc';

const absImg = (ctx, src) => {
  const value = text(src);
  if (!value) return '';
  const abs = ctx && typeof ctx.absImg === 'function' ? text(ctx.absImg(value)) : '';
  if (abs) return abs;
  return /^https:\/\//.test(value) ? value : `${siteOf(ctx)}${value.replace(/^\/+/, '')}`;
};

const postUrl = (ctx, post) => text(post.absUrl) || `${siteOf(ctx)}blog/${text(post.slug)}/`;
const categoryOf = (ctx, post) => post.categoryObj
  || list(ctx.categories).find((c) => c && c.id === post.category)
  || list(ctx.blog && ctx.blog.categories).find((c) => c && c.id === post.category)
  || null;
const authorById = (ctx, id) => (id ? list(ctx.authors).find((a) => a && a.id === id)
  || list(ctx.blog && ctx.blog.authors).find((a) => a && a.id === id) || null : null);
const taxonUrl = (ctx, item, kind) => text(item && item.absUrl) || `${siteOf(ctx)}blog/${kind}/${text(item && item.slug)}/`;

// A team/desk byline is an Organization; a named clinician is a Person.
const isOrgAuthor = (author) => /^organi[sz]ation$/i.test(text(author.type || author.kind))
  || /\b(team|staff|desk|editors?|editorial)\b/i.test(text(author.name));
const authorRef = (ctx, author) => {
  if (!author || !text(author.name)) return null;
  const url = taxonUrl(ctx, author, 'author');
  return isOrgAuthor(author)
    ? { '@type': 'Organization', '@id': `${url}#author`, name: text(author.name), url, parentOrganization: { '@id': ids(ctx).org } }
    : { '@type': 'Person', '@id': `${url}#author`, name: text(author.name), url };
};

const breadcrumb = (id, crumbs) => ({
  '@type': 'BreadcrumbList',
  '@id': id,
  itemListElement: crumbs.map(([name, item], index) => ({ '@type': 'ListItem', position: index + 1, name, item })),
});
const journalCrumbs = (ctx) => [[siteName(ctx), ids(ctx).site], [blogName(ctx), ids(ctx).blogUrl]];

// Every image a post shows, cover first. Patient photos are left out of the image
// sitemap: they stay on the page, but we don't push them into image search.
const postImages = (post, { includePatient = true } = {}) => {
  const keep = (image) => image && text(image.src) && (includePatient || !image.patient);
  const found = [];
  if (keep(post.cover)) found.push(post.cover.src);
  for (const block of list(post.blocks)) {
    if (!block) continue;
    if (block.type === 'image' && keep(block)) found.push(block.src);
    if (block.type === 'gallery') list(block.images).filter(keep).forEach((image) => found.push(image.src));
    if (block.type === 'imageText' && keep(block.image)) found.push(block.image.src);
  }
  return unique(found.map(text));
};

const wordCount = (post) => {
  try {
    // W2c's shared block module (also used by the admin); optional at build time.
    const blocks = require('../../admin/blog-blocks.js');
    const plain = typeof blocks.plainText === 'function' ? text(blocks.plainText(post)) : '';
    return plain ? plain.split(' ').length : undefined;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------
const postJsonLd = (ctx, post) => {
  if (!post) return [];
  const id = ids(ctx);
  const url = postUrl(ctx, post);
  const title = text(post.title);
  const description = text(post.seo && post.seo.description) || text(post.dek);
  const category = categoryOf(ctx, post);
  const author = authorRef(ctx, post.authorObj || authorById(ctx, post.author));
  const reviewer = post.reviewer ? authorRef(ctx, post.reviewerObj || authorById(ctx, post.reviewer)) : null;
  const published = w3c(post.publishAt) || w3c(post.published);
  const modified = w3c(post.updatedAt) || w3c(post.updated) || published;
  const cover = post.cover && text(post.cover.src) ? absImg(ctx, post.cover.src) : '';
  const ogImage = text(post.ogImage) || text(post.ogImageUrl);
  const keywords = unique([text(post.seo && post.seo.focusKeyphrase), ...list(post.seo && post.seo.keywords).map(text)]);
  const faqs = list(post.blocks).filter((b) => b && b.type === 'faq').flatMap((b) => list(b.items))
    .map((item) => item && { q: text(item.q), a: inlineText(item.a) })
    .filter((item) => item && item.q && item.a);
  const lang = text(post.lang) || 'en';

  const pageId = `${url}#webpage`;
  const crumbsId = `${url}#breadcrumb`;
  // The page is a MedicalWebPage (reviewedBy/lastReviewed live on WebPage, not on
  // the article); a visible FAQ block makes it an FAQPage too (Yoast-style multi-type).
  const page = compact({
    '@type': faqs.length ? ['MedicalWebPage', 'FAQPage'] : 'MedicalWebPage',
    '@id': pageId,
    url,
    name: title,
    description,
    inLanguage: lang,
    isPartOf: { '@id': id.website },
    breadcrumb: { '@id': crumbsId },
    primaryImageOfPage: cover ? compact({ '@type': 'ImageObject', url: cover, contentUrl: cover, caption: text(post.cover.alt) }) : undefined,
    datePublished: published,
    dateModified: modified,
    reviewedBy: reviewer || undefined,
    lastReviewed: reviewer ? dayOf(post.reviewedAt) || dayOf(post.updatedAt) || dayOf(post.publishAt) : undefined,
    mainEntity: faqs.length
      ? faqs.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } }))
      : undefined,
  });
  const article = compact({
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: title,
    description,
    url,
    image: unique([cover, ogImage]),
    datePublished: published,
    dateModified: modified,
    author: author || { '@id': id.org },
    publisher: { '@id': id.org },
    mainEntityOfPage: { '@id': pageId },
    isPartOf: { '@id': id.blog },
    inLanguage: lang,
    articleSection: category ? text(category.name) : undefined,
    keywords: keywords.length ? keywords.join(', ') : undefined,
    about: unique(list(post.about).map(text)).map((name) => ({ '@type': 'MedicalCondition', name })),
    wordCount: wordCount(post),
  });
  const crumbs = breadcrumb(crumbsId, [
    ...journalCrumbs(ctx),
    ...(category ? [[text(category.name), taxonUrl(ctx, category, 'category')]] : []),
    [title, url],
  ]);
  return [{ '@context': 'https://schema.org', '@graph': [article, page, crumbs] }];
};

const landingJsonLd = (ctx) => {
  const id = ids(ctx);
  const blog = (ctx && ctx.blog) || {};
  const blogNode = compact({
    '@type': 'Blog',
    '@id': id.blog,
    url: id.blogUrl,
    name: blogName(ctx),
    description: text(blog.seo && blog.seo.description) || text(blog.intro),
    inLanguage: 'en',
    publisher: { '@id': id.org },
    isPartOf: { '@id': id.website },
    blogPost: list(ctx && ctx.posts).slice(0, 20).map((post) => compact({
      '@type': 'BlogPosting',
      '@id': `${postUrl(ctx, post)}#article`,
      headline: text(post.title),
      url: postUrl(ctx, post),
      datePublished: w3c(post.publishAt) || w3c(post.published),
    })),
  });
  return [{ '@context': 'https://schema.org', '@graph': [blogNode, breadcrumb(`${id.blogUrl}#breadcrumb`, journalCrumbs(ctx))] }];
};

const categoryJsonLd = (ctx, category) => {
  if (!category) return [];
  const id = ids(ctx);
  const url = taxonUrl(ctx, category, 'category');
  const posts = list(ctx.posts).filter((post) => post.category === category.id);
  const page = compact({
    '@type': 'CollectionPage',
    '@id': `${url}#webpage`,
    url,
    name: `${text(category.name)} — ${blogName(ctx)}`,
    description: text(category.metaDescription) || text(category.intro),
    inLanguage: 'en',
    isPartOf: { '@id': id.blog },
    breadcrumb: { '@id': `${url}#breadcrumb` },
    mainEntity: posts.length ? {
      '@type': 'ItemList',
      itemListElement: posts.map((post, index) => ({ '@type': 'ListItem', position: index + 1, url: postUrl(ctx, post), name: text(post.title) })),
    } : undefined,
  });
  const crumbs = breadcrumb(`${url}#breadcrumb`, [...journalCrumbs(ctx), [text(category.name), url]]);
  return [{ '@context': 'https://schema.org', '@graph': [page, crumbs] }];
};

const authorJsonLd = (ctx, author) => {
  if (!author || !text(author.name)) return [];
  const id = ids(ctx);
  const url = taxonUrl(ctx, author, 'author');
  const ref = authorRef(ctx, author);
  const sameAs = unique(list(author.sameAs).map(text).filter((u) => /^https:\/\//.test(u)));
  const topics = unique(list(ctx.posts)
    .filter((post) => post.author === author.id || post.reviewer === author.id)
    .map((post) => { const c = categoryOf(ctx, post); return c ? text(c.name) : ''; }));
  const entity = compact({
    ...ref,
    description: text(author.bio),
    image: text(author.photo) ? absImg(ctx, author.photo) : undefined,
    jobTitle: ref['@type'] === 'Person' ? text(author.role) : undefined,
    hasCredential: text(author.credentials) && ref['@type'] === 'Person'
      ? { '@type': 'EducationalOccupationalCredential', name: text(author.credentials) }
      : undefined,
    worksFor: ref['@type'] === 'Person' ? { '@id': id.org } : undefined,
    knowsAbout: topics,
    sameAs,
  });
  const page = {
    '@type': 'ProfilePage',
    '@id': `${url}#webpage`,
    url,
    name: `${text(author.name)} — ${blogName(ctx)}`,
    inLanguage: 'en',
    isPartOf: { '@id': id.website },
    breadcrumb: { '@id': `${url}#breadcrumb` },
    mainEntity: { '@id': ref['@id'] },
  };
  const crumbs = breadcrumb(`${url}#breadcrumb`, [...journalCrumbs(ctx), [text(author.name), url]]);
  return [{ '@context': 'https://schema.org', '@graph': [page, entity, crumbs] }];
};

// ---------------------------------------------------------------------------
// <title> / description
// ---------------------------------------------------------------------------
// "<base> | <journal>" when it fits ~60 chars, else "<base> | <site>", else the
// base alone — never cut mid-word.
const TITLE_MAX = 60;
const withSuffix = (ctx, base) => {
  for (const suffix of [blogName(ctx), siteName(ctx)]) {
    const candidate = `${base} | ${suffix}`;
    if (suffix && candidate.length <= TITLE_MAX) return candidate;
  }
  return base;
};

const metaFor = (ctx, page) => {
  const blog = (ctx && ctx.blog) || {};
  const kind = page && page.kind;
  if (kind === 'post' && page.post) {
    const { post } = page;
    const base = text(post.seo && post.seo.title) || text(post.title);
    return {
      title: withSuffix(ctx, base),
      description: text(post.seo && post.seo.description) || text(post.dek),
      ogImageAlt: text(post.title),
    };
  }
  if (kind === 'category' && page.category) {
    const { category } = page;
    return {
      title: withSuffix(ctx, text(category.name)),
      description: text(category.metaDescription) || text(category.intro) || text(blog.intro),
      ogImageAlt: '',
    };
  }
  if (kind === 'author' && page.author) {
    const { author } = page;
    return {
      title: withSuffix(ctx, text(author.name)),
      description: text(author.bio) || `Articles by ${text(author.name)} in ${blogName(ctx)}.`,
      ogImageAlt: '',
    };
  }
  // Landing: the journal name already carries the brand; the owner may override.
  return {
    title: text(blog.seo && blog.seo.title) || blogName(ctx),
    description: text(blog.seo && blog.seo.description) || text(blog.intro),
    ogImageAlt: '',
  };
};

// ---------------------------------------------------------------------------
// RSS 2.0 (/blog/feed.xml)
// ---------------------------------------------------------------------------
// XML 1.0 forbids most C0 controls even when escaped.
const xml = (value) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const imageType = (url) => {
  const ext = (/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url) || [])[1];
  return { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', avif: 'image/avif', gif: 'image/gif' }[String(ext).toLowerCase()] || '';
};
const rfc822 = (value) => { const date = dateOf(value); return date ? date.toUTCString() : ''; };

const rssFeed = (ctx) => {
  const id = ids(ctx);
  const blog = (ctx && ctx.blog) || {};
  const posts = list(ctx && ctx.posts)
    .filter((post) => post && dateOf(post.publishAt || post.published))
    .sort((a, b) => dateOf(b.publishAt || b.published) - dateOf(a.publishAt || a.published))
    .slice(0, 30);
  // Deterministic: the feed's dates come from the posts, never from the clock.
  const newest = posts
    .map((post) => dateOf(post.updatedAt || post.updated || post.publishAt || post.published))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  const items = posts.map((post) => {
    const url = postUrl(ctx, post);
    const category = categoryOf(ctx, post);
    const author = post.authorObj || authorById(ctx, post.author);
    const cover = post.cover && text(post.cover.src) ? absImg(ctx, post.cover.src) : '';
    const type = cover ? imageType(cover) : '';
    return [
      '    <item>',
      `      <title>${xml(text(post.title))}</title>`,
      `      <link>${xml(url)}</link>`,
      `      <guid isPermaLink="true">${xml(url)}</guid>`,
      `      <pubDate>${rfc822(post.publishAt || post.published)}</pubDate>`,
      text(post.dek) ? `      <description>${xml(text(post.dek))}</description>` : '',
      category ? `      <category>${xml(text(category.name))}</category>` : '',
      author && text(author.name) ? `      <dc:creator>${xml(text(author.name))}</dc:creator>` : '',
      cover ? `      <media:content url="${xml(cover)}" medium="image"${type ? ` type="${type}"` : ''}>${text(post.cover.alt) ? `<media:description type="plain">${xml(text(post.cover.alt))}</media:description>` : ''}</media:content>` : '',
      '    </item>',
    ].filter(Boolean).join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">',
    '  <channel>',
    `    <title>${xml(blogName(ctx))}</title>`,
    `    <link>${xml(id.blogUrl)}</link>`,
    `    <atom:link href="${xml(`${id.blogUrl}feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `    <description>${xml(text(blog.seo && blog.seo.description) || text(blog.intro) || blogName(ctx))}</description>`,
    '    <language>en</language>',
    `    <copyright>${xml(`© ${siteName(ctx)}`)}</copyright>`,
    newest ? `    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : '',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].filter((line) => line !== '').join('\n') + '\n';
};

// ---------------------------------------------------------------------------
// Sitemap entries (W1 adds xmlns:image to the root <urlset>)
// ---------------------------------------------------------------------------
const latest = (posts) => posts
  .map((post) => ({ iso: w3c(post.updatedAt || post.updated) || w3c(post.publishAt || post.published), at: dateOf(post.updatedAt || post.updated || post.publishAt || post.published) }))
  .filter((entry) => entry.iso && entry.at)
  .sort((a, b) => b.at - a.at)[0];

const urlEntry = (loc, lastmod, images = []) => `<url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ''}${images.map((src) => `<image:image><image:loc>${xml(src)}</image:loc></image:image>`).join('')}</url>`;

const sitemapEntries = (ctx) => {
  const posts = list(ctx && ctx.posts);
  if (!posts.length) return [];
  const id = ids(ctx);
  const entries = [urlEntry(id.blogUrl, (latest(posts) || {}).iso)];
  for (const post of posts) {
    const images = unique(postImages(post, { includePatient: false }).map((src) => absImg(ctx, src)).filter((u) => /^https:\/\//.test(u)));
    entries.push(urlEntry(postUrl(ctx, post), w3c(post.updatedAt || post.updated) || w3c(post.publishAt || post.published), images));
  }
  const categories = list(ctx.categories).length ? list(ctx.categories) : list(ctx.blog && ctx.blog.categories);
  for (const category of categories) {
    const mine = posts.filter((post) => post.category === category.id);
    if (mine.length) entries.push(urlEntry(taxonUrl(ctx, category, 'category'), (latest(mine) || {}).iso));
  }
  const authors = list(ctx.authors).length ? list(ctx.authors) : list(ctx.blog && ctx.blog.authors);
  for (const author of authors) {
    const mine = posts.filter((post) => post.author === author.id || post.reviewer === author.id);
    if (mine.length) entries.push(urlEntry(taxonUrl(ctx, author, 'author'), (latest(mine) || {}).iso));
  }
  return entries;
};

// ---------------------------------------------------------------------------
// llms.txt "## Journal" section
// ---------------------------------------------------------------------------
const llmsSection = (ctx) => {
  const posts = list(ctx && ctx.posts);
  if (!posts.length) return '';
  const id = ids(ctx);
  const blog = (ctx && ctx.blog) || {};
  const line = (post) => `- [${text(post.title)}](${postUrl(ctx, post)})${text(post.dek) ? `: ${text(post.dek)}` : ''}`;
  const configured = list(blog.categories);
  const groups = configured
    .map((category) => [text(category.name), posts.filter((post) => post.category === category.id)])
    .filter(([, mine]) => mine.length);
  const loose = posts.filter((post) => !configured.some((c) => c.id === post.category));
  if (loose.length) groups.push(['More articles', loose]);
  return [
    '## Journal',
    '',
    `[${blogName(ctx)}](${id.blogUrl})${text(blog.intro) ? `: ${text(blog.intro)}` : ''} RSS: ${id.blogUrl}feed.xml`,
    ...groups.flatMap(([name, mine]) => ['', `### ${name}`, '', ...mine.map(line)]),
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Redirect stub for a moved post / owner redirect
// ---------------------------------------------------------------------------
// `fromDepth`: '../../' (or a number of levels) from the OLD address back to the
// site root; `to`: 'blog/new-slug/' (site-relative) or an absolute https URL.
// The refresh target is relative (the preview is mounted at /changes/); only the
// canonical is absolute.
const redirectStub = ({ fromDepth, to, siteUrl }) => {
  const site = text(siteUrl) || 'https://medivasc.in/';
  const depth = typeof fromDepth === 'number' ? '../'.repeat(Math.max(0, fromDepth)) : text(fromDepth);
  if (!/^(?:\.\.\/)*$/.test(depth)) throw new Error(`redirectStub: fromDepth must be "../" repeated, got "${fromDepth}"`);
  const target = text(to);
  if (!target) throw new Error('redirectStub: empty target');
  const external = /^https:\/\//.test(target);
  const path = target.replace(/^\/+/, '');
  const relative = external ? target : `${depth}${path}`;
  const canonical = external ? target : `${site}${path}`;
  const attr = xml;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>This page has moved</title>
  <meta name="robots" content="noindex,follow">
  <link rel="canonical" href="${attr(canonical)}">
  <meta http-equiv="refresh" content="0; url=${attr(relative)}">
  <script>location.replace(${JSON.stringify(relative).replace(/</g, '\\u003c')} + location.hash);</script>
</head>
<body>
  <p>This page has moved. <a href="${attr(relative)}">Continue to the new page</a>.</p>
</body>
</html>
`;
};

module.exports = { postJsonLd, landingJsonLd, categoryJsonLd, authorJsonLd, rssFeed, sitemapEntries, llmsSection, redirectStub, metaFor };
