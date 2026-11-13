// The Journal (/blog/) build: loads data/blog/*.json, validates it, builds every
// referenced photograph's responsive variants, and writes the landing, post,
// category, author, redirect and feed pages into the shared dist through the same
// page shell as the homepage (src/template.js renderShell). Contract: AGENTS.md
// "The blog". Called from src/build.js in two steps: loadBlog() runs
// with the other validators (before dist is wiped, so a content error never
// leaves the site half-built), buildBlog() runs once the site assets exist.
const fs = require('node:fs/promises');
const { statSync } = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const blocks = require('../../admin/blog-blocks.js');
const seo = require('./seo.js');
const og = require('./og.js');

// Responsive widths for every blog photograph (never enlarged past the source).
const BLOG_WIDTHS = [480, 800, 1200, 1600, 2400];
const LIVE_STATUSES = new Set(['published', 'scheduled']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// '12 Nov 2026' in the clinic's time zone (IST), whatever zone the build runs in.
const dateLabel = (date) => {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
};

const readJsonIfPresent = async (file) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    error.message = `${file}: ${error.message}`;
    throw error;
  }
};

const ownerError = (heading, groups) => {
  const count = groups.reduce((total, [, messages]) => total + messages.length, 0);
  const error = new Error(
    [
      heading(count),
      ...groups.map(([file, messages]) => `\n${file}\n${messages.map((message) => `  - ${message}`).join('\n')}`),
    ].join('\n'),
  );
  error.ownerFacing = true;
  return error;
};

// Every photograph a post or the blog settings point at, in a stable order.
const postImageSrcs = (post) => {
  const srcs = [];
  if (post.cover && post.cover.src) srcs.push(post.cover.src);
  for (const block of list(post.blocks)) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'image' && block.src) srcs.push(block.src);
    if (block.type === 'gallery') list(block.images).forEach((image) => image && image.src && srcs.push(image.src));
    if (block.type === 'imageText' && block.image && block.image.src) srcs.push(block.image.src);
  }
  return srcs;
};
const isLocalAsset = (src) => typeof src === 'string' && /^assets\/[^?#]+$/.test(src) && !src.includes('..');

// Load + validate. Returns null when the blog has no settings file (no blog at
// all), else { config, posts (every post), live (published/scheduled, due) }.
// Throws owner-facing errors (same shape as build.js validate()) on bad content.
// The cross-reference check (src/blog/check-refs.js) — null until it exists.
const loadRefChecker = () => {
  const file = path.join(__dirname, 'check-refs.js');
  try {
    statSync(file);
  } catch {
    return null;
  }
  const { checkBlogRefs } = require(file);
  return typeof checkBlogRefs === 'function' ? checkBlogRefs : null;
};

const loadBlog = async ({ root, rules, films = [], now = new Date(), env = process.env }) => {
  const dataDir = env.MV_BLOG_DATA ? path.resolve(env.MV_BLOG_DATA) : path.join(root, 'data', 'blog');
  const siteConfig = await readJsonIfPresent(path.join(dataDir, 'config.json'));
  if (siteConfig === undefined) return null;
  const withSamples = env.MV_BLOG_SAMPLES === '1';
  const published = list(await readJsonIfPresent(path.join(dataDir, 'posts.json')));
  const samples = withSamples ? list(await readJsonIfPresent(path.join(dataDir, 'samples.json'))) : [];
  // Sample-only settings (e.g. a featured list of sample posts) never reach the
  // shipped config: merged over it only for a samples build.
  const samplesConfig = withSamples ? await readJsonIfPresent(path.join(dataDir, 'samples.config.json')) : undefined;
  const config = samplesConfig && typeof samplesConfig === 'object' && !Array.isArray(samplesConfig)
    ? { ...siteConfig, ...samplesConfig }
    : siteConfig;
  const posts = [...published, ...samples];
  const label = (file) => path.relative(root, path.join(dataDir, file)) || file;

  const groups = [];
  if (typeof rules.validateBlogConfig === 'function') {
    groups.push([
      config === siteConfig ? label('config.json') : `${label('config.json')} + ${label('samples.config.json')}`,
      list(rules.validateBlogConfig(config)),
    ]);
  }
  if (typeof rules.validateBlogPosts === 'function') {
    groups.push([
      samples.length ? `${label('posts.json')} + ${label('samples.json')}` : label('posts.json'),
      list(rules.validateBlogPosts(posts, config, films)),
    ]);
  }
  // Files on disk, links between posts, the featured list, the site's videos.
  const checkBlogRefs = loadRefChecker();
  if (checkBlogRefs) {
    groups.push(['Blog links and files', list(checkBlogRefs(posts, config, { root, films, now })).map((problem) => problem.message)]);
  } else {
    console.warn('Blog: src/blog/check-refs.js is missing; image, link and video references were not checked.');
  }

  const live = posts.filter((post) => {
    if (!post || !LIVE_STATUSES.has(post.status)) return false;
    const at = new Date(post.publishAt);
    if (Number.isNaN(at.getTime())) {
      console.warn(`Blog: "${post.title || post.id}" has no valid publish time; it is not published.`);
      return false;
    }
    return at.getTime() <= now.getTime();
  });

  // Build-level invariants (two posts writing one URL; a missing photograph) —
  // independent of the content rules so a stale validator cannot ship a broken page.
  const buildProblems = [];
  const slugs = new Map();
  for (const post of live) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(post.slug || ''))) {
      buildProblems.push(`"${post.title || post.id}" has an invalid web address (${post.slug || 'empty'}).`);
    } else if (slugs.has(post.slug)) {
      buildProblems.push(`"${post.title}" and "${slugs.get(post.slug)}" share the web address blog/${post.slug}/.`);
    } else slugs.set(post.slug, post.title);
  }
  const missing = (src) => {
    try {
      return !statSync(path.join(root, src)).isFile();
    } catch {
      return true;
    }
  };
  const imageRefs = [
    ...live.flatMap((post) => postImageSrcs(post).map((src) => [src, `"${post.title || post.id}"`])),
    ...list(config.authors).filter((a) => a && text(a.photo)).map((a) => [a.photo, `Author ${a.name || a.id}'s photo`]),
  ];
  // check-refs.js reports missing photos itself (same files); this stays the
  // backstop only while it is absent, so the owner never reads one problem twice.
  for (const [src, owner] of checkBlogRefs ? [] : imageRefs) {
    if (isLocalAsset(src) && missing(src)) {
      buildProblems.push(`${owner}: the photo ${src} is not in the site files. Upload it again or remove it.`);
    }
  }
  groups.push(['Blog build', buildProblems]);

  const failing = groups.filter(([, messages]) => messages.length);
  if (failing.length) {
    throw ownerError(
      (count) => `The blog has ${count} problem${count === 1 ? '' : 's'} — fix ${count === 1 ? 'it' : 'them'} and build again:`,
      failing,
    );
  }
  return { config, posts, live };
};

// A src/blog/ source file, '' while a lane has not written it yet.
const readOptional = async (file) => {
  try {
    return await fs.readFile(path.join(__dirname, file), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

// The one blog stylesheet: landing + post + blocks, in that
// order. Shared by the hashed assets/blog.css and the admin preview bundle.
const BLOG_CSS_FILES = ['blog-landing.css', 'blog-post.css', 'blog-blocks.css'];
const blogCssSource = async () => (await Promise.all(BLOG_CSS_FILES.map(readOptional))).join('\n');

// Responsive variants for every blog photograph, sized per source so a 1000px
// photo never claims 1200w/1600w/2400w candidates.
const buildBlogImages = async (srcs, { root, buildGallery }) => {
  const unique = [...new Set(srcs.filter(isLocalAsset))];
  const entries = await Promise.all(unique.map(async (src) => {
    const meta = await sharp(path.join(root, src)).metadata();
    const rotated = (meta.orientation || 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    const top = Math.min(width, BLOG_WIDTHS[BLOG_WIDTHS.length - 1]);
    const widths = BLOG_WIDTHS.filter((w) => w <= top);
    if (!widths.includes(top)) widths.push(top);
    const gallery = await buildGallery([src], widths, { toWebp: true });
    const item = gallery.bySrc.get(src);
    const built = Object.keys(item.variants).map(Number).sort((a, b) => a - b);
    return [src, { src, width, height, widths: built, variants: item.variants, full: item.variants[built[built.length - 1]] }];
  }));
  return new Map(entries);
};

const buildBlog = async (blog, {
  root,
  dist,
  siteUrl,
  site,           // renderShell site object (company, content, config, theme ids, asset paths, lockups, blogNav)
  theme,
  films,
  siteOgImage,    // root-relative path of the site's default og image
  buildGallery,
  writeHashed,
  renderShell,
  contactHrefs,
}) => {
  const { config, live } = blog;
  const { company, content, themeId } = site;
  // Renderers are required lazily: the other lanes replace them while we build.
  const { renderLanding, renderCategoryPage, renderAuthorPage, renderComingSoon } = require('./render-landing.js');
  const { renderPost } = require('./render-post.js');

  // The one hashed blog stylesheet (landing + post + blocks). Every blog page
  // links it, including the placeholder below, so it is built before the branch.
  const blogCss = await writeHashed('assets', 'blog', 'css', await blogCssSource());

  // No live post yet: /blog/ is a quiet "coming soon" placeholder on the same
  // page shell — noindex, and OUT of the sitemap, feed and llms.txt (nothing is
  // returned for those here, and build.js only wires them from a live journal).
  // A scheduled-but-not-yet-due post sits in posts.json but never reaches `live`,
  // so it cannot show or leak. The normal landing replaces this the moment a post
  // goes live, with no other change.
  if (!live.length) {
    const depth = '../';
    const ctx = {
      depth,
      blog: config,
      company,
      content,
      contactHref: contactHrefs(company, content, depth),
      homeHref: depth,
    };
    const html = renderShell({
      site,
      depth,
      title: text(config.seo && config.seo.title) || text(config.name),
      description: text(config.seo && config.seo.description) || text(config.intro),
      canonical: `${siteUrl}blog/`,
      ogImage: `${siteUrl}${siteOgImage}`,
      ogImageAlt: site.config.seo.imageAlt,
      jsonLd: [],
      robots: 'noindex',
      bodyClass: 'page-blog page-blog--soon',
      main: renderComingSoon(ctx),
      extraCss: [blogCss],
      lightDefault: true,
      blogCurrent: true,
      noscript: '',
    });
    const dir = path.join(dist, 'blog');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), html);
    return { sitemapEntries: [], llmsSection: '', pages: 1, posts: 0 };
  }

  const images = await buildBlogImages(
    [...live.flatMap(postImageSrcs), ...list(config.authors).map((a) => a && a.photo).filter(Boolean)],
    { root, buildGallery },
  );

  // Hashed blog script (reader + landing), only where there are posts to drive.
  const [readerJs, landingJs] = await Promise.all([readOptional('reader.js'), readOptional('landing.js')]);
  const jsSource = [readerJs, landingJs].filter((source) => source.trim()).join('\n;\n');
  const blogJs = jsSource ? await writeHashed('assets', 'blog', 'js', jsSource) : '';

  const published = (post) => new Date(post.publishAt);
  const ordered = [...live].sort((a, b) => published(b) - published(a) || String(a.title).localeCompare(String(b.title)));
  const byId = (items) => new Map(list(items).filter(Boolean).map((item) => [item.id, item]));
  const categoriesById = byId(config.categories);
  const authorsById = byId(config.authors);
  const liveCategoryIds = new Set(ordered.map((post) => post.category));
  const liveAuthorIds = new Set(ordered.flatMap((post) => [post.author, post.reviewer]).filter(Boolean));
  const countBy = (key) => ordered.reduce((counts, post) => counts.set(post[key], (counts.get(post[key]) || 0) + 1), new Map());
  const categoryCounts = countBy('category');
  const authorCounts = countBy('author');

  // One ctx per depth: every href in it is depth-prefixed.
  const ctxCache = new Map();
  const ctxFor = (depth) => {
    if (ctxCache.has(depth)) return ctxCache.get(depth);
    const imgData = (src) => {
      const item = images.get(src);
      if (!item) {
        const plain = isLocalAsset(src) ? `${depth}${src}` : String(src || '');
        return { src: plain, srcset: '', width: undefined, height: undefined };
      }
      const fallback = item.widths.filter((w) => w <= 1200).pop() || item.widths[0];
      return {
        src: `${depth}${item.variants[fallback]}`,
        srcset: item.widths.map((w) => `${depth}${item.variants[w]} ${w}w`).join(', '),
        width: item.width,
        height: item.height,
      };
    };
    const img = (src, { sizes = '100vw', widths, alt = '', className = '', loading = 'lazy', fetchpriority } = {}) => {
      const item = images.get(src);
      const data = imgData(src);
      let { srcset } = data;
      if (item && Array.isArray(widths) && widths.length) {
        const wanted = item.widths.filter((w) => widths.includes(w));
        if (wanted.length) srcset = wanted.map((w) => `${depth}${item.variants[w]} ${w}w`).join(', ');
      }
      return `<img src="${esc(data.src)}"${srcset ? ` srcset="${esc(srcset)}" sizes="${esc(sizes)}"` : ''}${data.width ? ` width="${data.width}" height="${data.height}"` : ''} alt="${esc(alt)}"${className ? ` class="${esc(className)}"` : ''} loading="${esc(loading)}" decoding="async"${fetchpriority ? ` fetchpriority="${esc(fetchpriority)}"` : ''}>`;
    };
    const absImg = (src) => {
      const item = images.get(src);
      if (item) return `${siteUrl}${item.full}`;
      return isLocalAsset(src) ? `${siteUrl}${src}` : String(src || '');
    };
    const enrichTaxon = (item, kind, counts) => item && {
      ...item,
      url: `blog/${kind}/${item.slug}/`,
      href: `${depth}blog/${kind}/${item.slug}/`,
      absUrl: `${siteUrl}blog/${kind}/${item.slug}/`,
      count: counts.get(item.id) || 0,
    };
    const categories = list(config.categories).filter((c) => c && liveCategoryIds.has(c.id)).map((c) => enrichTaxon(c, 'category', categoryCounts));
    const authors = list(config.authors).filter((a) => a && liveAuthorIds.has(a.id)).map((a) => enrichTaxon(a, 'author', authorCounts));
    const categoryObj = new Map(categories.map((c) => [c.id, c]));
    const authorObj = new Map(authors.map((a) => [a.id, a]));
    const posts = ordered.map((post) => {
      const at = published(post);
      const updated = post.updatedAt ? new Date(post.updatedAt) : null;
      const updatedValid = updated && !Number.isNaN(updated.getTime()) && dateLabel(updated) !== dateLabel(at);
      return {
        ...post,
        url: `blog/${post.slug}/`,
        href: `${depth}blog/${post.slug}/`,
        absUrl: `${siteUrl}blog/${post.slug}/`,
        categoryObj: categoryObj.get(post.category) || enrichTaxon(categoriesById.get(post.category), 'category', categoryCounts) || null,
        authorObj: authorObj.get(post.author) || null,
        reviewerObj: post.reviewer ? authorObj.get(post.reviewer) || null : null,
        readingMinutes: blocks.readingMinutes(post),
        published: at,
        publishedLabel: dateLabel(at),
        updated: updatedValid ? updated : null,
        updatedLabel: updatedValid ? dateLabel(updated) : '',
      };
    });
    const postById = new Map(posts.map((post) => [post.id, post]));
    const keywordsOf = (post) => new Set(
      [text(post.seo && post.seo.focusKeyphrase), ...list(post.seo && post.seo.keywords).map(text)]
        .filter(Boolean)
        .map((k) => k.toLowerCase()),
    );
    // Up to 4: the owner's manual picks, then same category, then shared keywords.
    const related = (post) => {
      const picked = [];
      const add = (candidate) => {
        if (candidate && candidate.id !== post.id && !picked.includes(candidate) && picked.length < 4) picked.push(candidate);
      };
      list(post.related).forEach((id) => add(postById.get(id)));
      posts.filter((p) => p.category === post.category).forEach(add);
      const mine = keywordsOf(post);
      if (mine.size) {
        posts
          .map((p) => [p, [...keywordsOf(p)].filter((k) => mine.has(k)).length])
          .filter(([, shared]) => shared > 0)
          .sort((a, b) => b[1] - a[1])
          .forEach(([p]) => add(p));
      }
      return picked;
    };
    const ctx = {
      depth,
      siteUrl,
      // Absolute URL of the site's default share image: seo.js uses it as the
      // JSON-LD image fallback when a post has neither a share card nor a cover.
      siteOgImage: siteOgImage ? `${siteUrl}${siteOgImage}` : '',
      blog: config,
      company,
      content,
      films,
      themeId,
      posts,
      featured: list(config.featured).map((id) => postById.get(id)).filter(Boolean),
      categories,
      authors,
      related,
      img,
      imgData,
      absImg,
      contactHref: contactHrefs(company, content, depth),
      homeHref: depth,
    };
    ctxCache.set(depth, ctx);
    return ctx;
  };

  const rootCtx = ctxFor('../');
  const feedXml = text(seo.rssFeed(rootCtx)) ? seo.rssFeed(rootCtx) : '';
  const siteOgAbs = `${siteUrl}${siteOgImage}`;
  const siteOgAlt = site.config.seo.imageAlt;
  const written = new Set();
  const writePage = async (relDir, html) => {
    const dir = path.join(dist, relDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), html);
    written.add(relDir.replace(/\/?$/, '/'));
  };
  const metaOf = (ctx, page, fallback) => {
    const meta = seo.metaFor(ctx, page) || {};
    return {
      title: text(meta.title) || fallback.title,
      description: text(meta.description) || fallback.description,
    };
  };
  const shell = (ctx, { meta, url, main, kind, jsonLd, ogImage, ogImageAlt, ogType, lang, headExtra = '' }) => renderShell({
    site,
    depth: ctx.depth,
    lang,
    title: meta.title,
    description: meta.description,
    canonical: `${siteUrl}${url}`,
    ogImage: ogImage || siteOgAbs,
    ogImageAlt: ogImage ? ogImageAlt : siteOgAlt,
    ogType,
    jsonLd: list(jsonLd),
    robots: 'index,follow,max-image-preview:large',
    headExtra: `${headExtra}${feedXml ? `  <link rel="alternate" type="application/rss+xml" title="${esc(config.name)}" href="${ctx.depth}blog/feed.xml">\n` : ''}`,
    bodyClass: `page-blog page-blog--${kind}`,
    main,
    extraCss: [blogCss],
    extraJs: blogJs ? [blogJs] : [],
    lightDefault: true,
    blogCurrent: true,
    // No no-JS notice on blog pages: every page reads in full without JS, and the
    // site's fixed notice card sat over the article's bottom-right corner.
    noscript: '',
  });

  // Landing.
  await writePage('blog', shell(rootCtx, {
    kind: 'landing',
    url: 'blog/',
    meta: metaOf(rootCtx, { kind: 'landing' }, {
      title: text(config.seo && config.seo.title) || text(config.name),
      description: text(config.seo && config.seo.description) || text(config.intro),
    }),
    jsonLd: seo.landingJsonLd(rootCtx),
    main: renderLanding(rootCtx),
  }));

  // Posts (+ their share images).
  const postCtx = ctxFor('../../');
  for (const post of postCtx.posts) {
    // A share card that fails to draw never fails the build: the post falls back
    // to the site's own share image (shell + JSON-LD), with a warning.
    let png = null;
    try {
      png = await og.renderOgPng(post, {
        blogName: config.name,
        category: post.categoryObj,
        lockupPath: path.join(root, 'assets', 'brand', 'logo-ink.png'),
        theme,
        root,
      });
    } catch (error) {
      console.warn(`Blog: the share image for "${post.title || post.id}" could not be drawn (${error.message}); using the site's share image.`);
    }
    const ogImage = Buffer.isBuffer(png) ? `${siteUrl}${await writeHashed('assets/blog/og', post.slug, 'png', png)}` : '';
    const times = [
      `  <meta property="article:published_time" content="${esc(post.published.toISOString())}">\n`,
      post.updated ? `  <meta property="article:modified_time" content="${esc(post.updated.toISOString())}">\n` : '',
    ].join('');
    await writePage(path.posix.join('blog', post.slug), shell(postCtx, {
      kind: 'post',
      url: post.url,
      lang: post.lang || 'en',
      meta: metaOf(postCtx, { kind: 'post', post }, {
        title: text(post.seo && post.seo.title) || text(post.title),
        description: text(post.seo && post.seo.description) || text(post.dek),
      }),
      // Only a card that was actually drawn goes in as the post's share image;
      // the site default is seo.js's fallback (ctx.siteOgImage), never first.
      jsonLd: seo.postJsonLd(postCtx, post, ogImage ? { ogImage } : {}),
      ogImage,
      ogImageAlt: post.title,
      ogType: 'article',
      headExtra: times,
      main: renderPost(postCtx, post),
    }));
  }

  // Category + author archives (only those with ≥1 live post).
  const archiveCtx = ctxFor('../../../');
  for (const category of archiveCtx.categories) {
    await writePage(path.posix.join('blog', 'category', category.slug), shell(archiveCtx, {
      kind: 'category',
      url: category.url,
      meta: metaOf(archiveCtx, { kind: 'category', category }, {
        title: `${text(category.name)} — ${text(config.name)}`,
        description: text(category.metaDescription) || text(category.intro) || text(config.intro),
      }),
      jsonLd: seo.categoryJsonLd(archiveCtx, category),
      main: renderCategoryPage(archiveCtx, category),
    }));
  }
  for (const author of archiveCtx.authors) {
    await writePage(path.posix.join('blog', 'author', author.slug), shell(archiveCtx, {
      kind: 'author',
      url: author.url,
      meta: metaOf(archiveCtx, { kind: 'author', author }, {
        title: `${text(author.name)} — ${text(config.name)}`,
        description: text(author.bio) || text(config.intro),
      }),
      jsonLd: seo.authorJsonLd(archiveCtx, author),
      main: renderAuthorPage(archiveCtx, author),
    }));
  }

  // Redirect stubs: a post's previous slugs, then the owner's redirects. Never
  // over a live page, never outside blog/.
  const stubs = [
    ...postCtx.posts.flatMap((post) => list(post.previousSlugs).map((slug) => ({ from: `blog/${slug}/`, to: post.url }))),
    ...list(config.redirects).map((r) => r && { from: text(r.from).replace(/^\/+/, '').replace(/\/?$/, '/'), to: text(r.to).replace(/^\/+/, '') }),
  ].filter(Boolean);
  for (const { from, to } of stubs) {
    if (!/^blog\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/$/.test(from) || !to) {
      console.warn(`Blog: skipped redirect ${from || '(empty)'} → ${to || '(empty)'} (not a blog/ address).`);
      continue;
    }
    if (written.has(from)) {
      console.warn(`Blog: skipped redirect ${from} → ${to}: a live page already uses ${from}.`);
      continue;
    }
    const fromDepth = '../'.repeat(from.split('/').filter(Boolean).length);
    const target = /^https:\/\//.test(to) ? to : `${fromDepth}${to}`;
    const html = text(seo.redirectStub({ fromDepth, to, siteUrl }))
      ? seo.redirectStub({ fromDepth, to, siteUrl })
      : `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Moved</title>\n  <meta name="robots" content="noindex">\n  <link rel="canonical" href="${esc(/^https:\/\//.test(to) ? to : `${siteUrl}${to}`)}">\n  <meta http-equiv="refresh" content="0; url=${esc(target)}">\n</head>\n<body>\n  <p><a href="${esc(target)}">This page has moved.</a></p>\n</body>\n</html>\n`;
    await writePage(from.replace(/\/$/, ''), html);
  }

  if (feedXml) await fs.writeFile(path.join(dist, 'blog', 'feed.xml'), feedXml);

  return {
    sitemapEntries: list(seo.sitemapEntries(rootCtx)),
    llmsSection: text(seo.llmsSection(rootCtx)),
    pages: written.size,
    posts: postCtx.posts.length,
  };
};

module.exports = { loadBlog, buildBlog, blogCssSource, BLOG_WIDTHS };
