#!/usr/bin/env node
// Wide-cover "fit" treatment on blog landing cards (plain node, no framework).
//   node tools/test/blog-cover-fit.test.js
// Contract: a banner cover (intrinsic aspect >= 1.7) is shown whole over a blurred
// backdrop in the feature + grid cards; a 3:2 cover renders as before (plain crop).
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { renderLanding } = require(path.join(ROOT, 'src/blog/render-landing.js'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Intrinsic dimensions keyed by cover src — stands in for the build's image manifest.
const DIM = {
  wide: { src: 'w.webp', srcset: 'w-800.webp 800w, w-1600.webp 1600w', width: 1600, height: 800 }, // 2:1
  std: { src: 's.webp', srcset: 's-600.webp 600w, s-900.webp 900w', width: 1500, height: 1000 }, // 3:2
};

const mkPost = (id, coverSrc) => ({
  id,
  slug: id,
  href: `blog/${id}/`,
  title: `Post ${id}`,
  publishAt: '2026-11-24T00:00:00.000Z',
  publishedLabel: 'Nov 24, 2026',
  readingMinutes: 5,
  categoryObj: null,
  authorObj: null,
  cover: { src: coverSrc, alt: `cover ${id}`, focal: { x: 0.5, y: 0.5 } },
});

const ctx = {
  depth: '',
  homeHref: '',
  blog: { name: 'Journal', intro: 'x' },
  categories: [],
  // Feature slides (excluded from the grid):
  featured: [mkPost('featWide', 'wide'), mkPost('featStd', 'std')],
  // Four posts total so the two above stay featured and the two below fall to the grid:
  posts: [mkPost('featWide', 'wide'), mkPost('featStd', 'std'), mkPost('gridWide', 'wide'), mkPost('gridStd', 'std')],
  img: (src, opts = {}) => `<img src="${src}" alt="${opts.alt || ''}"${opts.className ? ` class="${opts.className}"` : ''}>`,
  imgData: (src) => DIM[src] || { src, srcset: '', width: undefined, height: undefined },
};

const count = (html, re) => (html.match(re) || []).length;

test('wide covers get fit markup in both feature and grid cards', () => {
  const html = renderLanding(ctx);
  assert.equal(count(html, /blog-feature__media--fit/g), 1, 'exactly one feature card is fit (the 2:1)');
  assert.equal(count(html, /blog-card__media--fit/g), 1, 'exactly one grid card is fit (the 2:1)');
  // One blurred backdrop per fit card:
  assert.equal(count(html, /class="blog-media__backdrop"/g), 2, 'two backdrops: feature + grid');
  assert.ok(/<img class="blog-media__backdrop" alt="" aria-hidden="true"/.test(html), 'backdrop is a decorative img');
  // The backdrop reuses the same responsive srcset as the foreground (one download):
  assert.ok(html.includes('w-1600.webp 1600w'), 'backdrop carries the cover srcset');
});

test('a 3:2 cover does not get fit markup (plain crop as before)', () => {
  const html = renderLanding(ctx);
  // Only the two wide covers are fit; the 3:2 feature + grid cards stay plain.
  assert.equal(count(html, /--fit/g), 2, 'no extra fit frames beyond the two 2:1 covers');
  // The 3:2 cards still carry a focal object-position style, which fit mode drops.
  assert.ok(/blog-feature__media"[^>]*style="--fx:/.test(html) || /blog-card__media"[^>]*style="--fx:/.test(html),
    'a non-fit card keeps the focal --fx/--fy style');
});

test('fit detection degrades safely when imgData is absent', () => {
  const bare = { ...ctx, imgData: undefined };
  const html = renderLanding(bare);
  assert.equal(count(html, /--fit/g), 0, 'no fit markup without a dimensions manifest');
  assert.equal(count(html, /blog-media__backdrop/g), 0, 'no backdrop without a dimensions manifest');
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`not ok - ${name}\n  ${err.message}`);
  }
}
if (failed) {
  console.error(`\n${failed} of ${tests.length} failed`);
  process.exit(1);
}
console.log(`\n${tests.length} passed`);
