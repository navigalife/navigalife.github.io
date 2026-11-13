// Blog cross-reference check — the things the content rules cannot see from
// the JSON alone: files on disk, links between posts, the featured list and
// the site's videos. build-blog.js runs it and fails the build on any result.
//
//   const { checkBlogRefs } = require('./check-refs.js');
//   checkBlogRefs(posts, config, { root, films, now })
//     → [{ postId, field, message }]   (empty = all good)
//
// posts   every post the build loaded (posts.json, + samples.json with
//         MV_BLOG_SAMPLES=1). Unpublished posts are never rendered, so only
//         published/scheduled posts are checked for images, links and videos.
// config  data/blog/config.json (after the samples.config.json merge).
// root    the site's source folder; image srcs are root-relative (assets/…).
// films   data/films.json (array of { src } or of src strings).
// now     optional Date (tests); defaults to the current time.
//
// postId is null for problems in the blog settings (featured list, author
// photos). field is a dotted path inside the post (or the settings), e.g.
// "blocks.4.text.2.href". Messages are written for the site owner.

'use strict';

const fs = require('fs');
const path = require('path');

const LIVE_STATUSES = new Set(['published', 'scheduled']);
const INTERNAL = /^blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(?:#.*)?$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

const shortTitle = (title) => {
  const t = text(title);
  return t.length > 60 ? `${t.slice(0, 58).replace(/\s+\S*$/, '')}…` : t;
};
const nameOf = (post, i) =>
  (text(post.title) ? `Blog post “${shortTitle(post.title)}”` : `Blog post ${i + 1}${text(post.id) ? ` (${post.id})` : ''}`);
const timeOf = (post) => {
  const at = Date.parse(post.publishAt);
  return Number.isNaN(at) ? null : at;
};

// Exact-case existence check: macOS disks ignore letter case, the live host
// does not, so "Cover.webp" vs "cover.webp" must fail here too.
const makeFileCheck = (root) => {
  const listings = new Map();
  const entries = (dir) => {
    if (!listings.has(dir)) {
      let names = null;
      try {
        names = new Set(fs.readdirSync(dir));
      } catch {
        names = null;
      }
      listings.set(dir, names);
    }
    return listings.get(dir);
  };
  const base = path.resolve(root);
  return (src) => {
    const full = path.resolve(base, src);
    if (full !== base && !full.startsWith(base + path.sep)) return false;
    const parts = path.relative(base, full).split(path.sep);
    let dir = base;
    for (const part of parts) {
      const names = entries(dir);
      if (!names || !names.has(part)) return false;
      dir = path.join(dir, part);
    }
    try {
      return fs.statSync(dir).isFile();
    } catch {
      return false;
    }
  };
};

// Every image a post shows: [field, src, what].
const postImages = (post) => {
  const out = [];
  if (isObject(post.cover)) out.push(['cover.src', post.cover.src, 'the cover image']);
  list(post.blocks).forEach((block, j) => {
    if (!isObject(block)) return;
    const at = `blocks.${j}`;
    const what = `the image in block ${j + 1}`;
    if (block.type === 'image') out.push([`${at}.src`, block.src, what]);
    if (block.type === 'gallery') {
      list(block.images).forEach((img, k) => {
        if (isObject(img)) out.push([`${at}.images.${k}.src`, img.src, `image ${k + 1} of the gallery in block ${j + 1}`]);
      });
    }
    if (block.type === 'imageText' && isObject(block.image)) out.push([`${at}.image.src`, block.image.src, what]);
  });
  return out;
};

// Every inline link inside a value: [field, href, linkText].
const linksIn = (value, at, out) => {
  if (Array.isArray(value)) value.forEach((v, k) => linksIn(v, `${at}.${k}`, out));
  else if (isObject(value)) {
    if (typeof value.href === 'string') out.push([`${at}.href`, value.href, typeof value.t === 'string' ? value.t : '']);
    for (const [key, v] of Object.entries(value)) {
      if (key !== 'href' && v && typeof v === 'object') linksIn(v, at ? `${at}.${key}` : key, out);
    }
  }
  return out;
};

const checkBlogRefs = (posts, config, { root, films, now } = {}) => {
  const problems = [];
  const add = (postId, field, message) => problems.push({ postId, field, message });
  const all = list(posts).filter(isObject);
  const cfg = isObject(config) ? config : {};
  const nowMs = (now instanceof Date ? now : new Date()).getTime();
  const fileExists = root ? makeFileCheck(root) : null;
  const shown = (post) => LIVE_STATUSES.has(post.status);

  // Address → the post it opens (current slug or an old one).
  const bySlug = new Map();
  for (const post of all) {
    if (typeof post.slug === 'string' && !bySlug.has(post.slug)) bySlug.set(post.slug, post);
    for (const old of list(post.previousSlugs)) if (typeof old === 'string' && !bySlug.has(old)) bySlug.set(old, post);
  }
  // Settings redirects (blog/a/ → blog/b/) also keep an old address working.
  const redirects = new Map();
  for (const r of list(cfg.redirects)) {
    const from = isObject(r) && typeof r.from === 'string' ? INTERNAL.exec(r.from) : null;
    const to = isObject(r) && typeof r.to === 'string' ? INTERNAL.exec(r.to) : null;
    if (from && to) redirects.set(from[1], to[1]);
  }
  const resolve = (slug) => bySlug.get(slug) || (redirects.has(slug) ? bySlug.get(redirects.get(slug)) : undefined);

  const filmSrcs = Array.isArray(films)
    ? new Set(films.map((f) => (isObject(f) ? f.src : f)).filter((s) => typeof s === 'string'))
    : null;

  all.forEach((post, i) => {
    if (!shown(post)) return;
    const who = nameOf(post, i);
    const postId = typeof post.id === 'string' ? post.id : null;

    // Images on disk.
    if (fileExists) {
      for (const [field, src, what] of postImages(post)) {
        if (typeof src !== 'string' || !/^assets\//.test(src)) continue; // shape errors belong to content-rules
        if (!fileExists(src)) {
          add(postId, field, `${who}: ${what} (${src}) is not in the site files. Upload it again, or choose another picture.`);
        }
      }
    }

    // Links to other posts. A post going live at time T needs its target live by T.
    const goesLive = Math.max(nowMs, timeOf(post) ?? nowMs);
    const links = [];
    if (isObject(post.cover)) linksIn(post.cover, 'cover', links);
    linksIn(list(post.blocks), 'blocks', links);
    for (const [field, href, linkText] of links) {
      const m = INTERNAL.exec(href);
      if (!m) continue;
      const label = linkText.trim() ? `the link “${linkText.trim().slice(0, 50)}”` : 'a link';
      const target = resolve(m[1]);
      if (!target) {
        add(postId, field, `${who}: ${label} goes to blog/${m[1]}/, but there is no post at that address. Check the address, or link to another post.`);
        continue;
      }
      if (target === post) continue;
      const targetName = text(target.title) ? `“${shortTitle(target.title)}”` : `blog/${m[1]}/`;
      const targetAt = timeOf(target);
      if (!shown(target)) {
        add(postId, field, `${who}: ${label} goes to ${targetName}, which is not published. Publish that post first, or remove the link.`);
      } else if (targetAt === null || targetAt > goesLive) {
        const when = timeOf(post) !== null && timeOf(post) > nowMs ? ' by the time this post goes live' : ' yet';
        add(postId, field, `${who}: ${label} goes to ${targetName}, which is not live${when} (it is scheduled for later). Move its date earlier, or remove the link for now.`);
      }
    }

    // The site's own videos.
    if (filmSrcs) {
      list(post.blocks).forEach((block, j) => {
        if (!isObject(block) || block.type !== 'video' || block.source !== 'film') return;
        if (typeof block.src === 'string' && block.src && !filmSrcs.has(block.src)) {
          add(postId, `blocks.${j}.src`, `${who}: the video in block ${j + 1} (${block.src}) is no longer one of the site's videos. Choose one from the Videos tab, or remove the block.`);
        }
      });
    }
  });

  // Settings: featured posts and author photos.
  const ids = new Set(all.map((p) => p.id).filter((id) => typeof id === 'string'));
  list(cfg.featured).forEach((id, k) => {
    if (!ids.has(id)) {
      add(null, `featured.${k}`, `Blog settings: featured post “${String(id)}” does not exist any more. Remove it from the featured list.`);
    }
  });
  if (fileExists) {
    list(cfg.authors).forEach((author, k) => {
      if (!isObject(author) || typeof author.photo !== 'string' || !/^assets\//.test(author.photo)) return;
      if (!fileExists(author.photo)) {
        const name = text(author.name) || `author ${k + 1}`;
        add(null, `authors.${k}.photo`, `Blog settings: ${name}'s photo (${author.photo}) is not in the site files. Upload it again, or remove the photo.`);
      }
    });
  }

  return problems;
};

module.exports = { checkBlogRefs };
