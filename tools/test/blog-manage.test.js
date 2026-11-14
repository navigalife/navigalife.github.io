#!/usr/bin/env node
// Tests for the pure helpers of admin/blog-manage.js (the `_internals` test seam):
// the blog-settings row address label and the "a slug follows a missing name"
// inline-error suppression.
//   node tools/test/blog-manage.test.js
// prints one line per failure plus one summary line, exits non-zero on failure.
//
// Loading: blog-manage.js is a browser ES module. Its two static imports
// (content-rules.js for the global it reads, image-intake.js for intakeImage) are
// only used inside the mount functions, so they are cut from a copy of its current
// source (asserted line by line, so a changed import fails loudly) and the copy is
// imported from a data: URL. The one global it reads (MediVascContentRules) is set
// the way the admin page sets it. No DOM is touched at import or by these helpers.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const FILE = path.join(ROOT, 'admin/blog-manage.js');
const RULES = require(path.join(ROOT, 'admin/content-rules.js'));

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${String(err && err.message).split('\n').join('\n     ')}`);
  }
};

const IMPORTS = [
  "import './content-rules.js';",
  "import { intakeImage } from './image-intake.js';",
];

(async () => {
  let src = fs.readFileSync(FILE, 'utf8');
  for (const line of IMPORTS) {
    assert.ok(src.includes(line + '\n'), `blog-manage.js no longer starts with: ${line}`);
    src = src.replace(line + '\n', '');
  }
  assert.ok(!/^import\s/m.test(src), 'blog-manage.js has a static import this loader does not know');
  src = 'const intakeImage = async () => null;\n' + src;
  globalThis.MediVascContentRules = RULES;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const { addrLabel, missingNames, slugFollowsMissingName } = mod._internals;

  // ------------------------------------------------------------ addrLabel

  test('addrLabel: a slug becomes blog/<kind>/<slug>/', () => {
    assert.equal(addrLabel('category', 'foot-care'), 'blog/category/foot-care/');
    assert.equal(addrLabel('author', 'dr-smith'), 'blog/author/dr-smith/');
  });
  test('addrLabel: an empty slug reads "No web address yet", never "blog/category//"', () => {
    assert.equal(addrLabel('category', ''), 'No web address yet');
    assert.equal(addrLabel('author', ''), 'No web address yet');
    assert.equal(addrLabel('category', undefined), 'No web address yet');
    assert.equal(addrLabel('author', null), 'No web address yet');
  });

  // ------------------------------------------------------------ missingNames

  test('missingNames: the ids of items whose .name error is present (slug/other paths ignored)', () => {
    const errors = [
      { path: 'categories.0.name' },
      { path: 'authors.2.name' },
      { path: 'categories.0.slug' }, // a slug error is not a missing name
      { path: 'name' },              // the blog's own name, not an item
      { path: 'categories.1.slug' },
    ];
    const set = missingNames(errors);
    assert.ok(set instanceof Set);
    assert.deepEqual([...set].sort(), ['authors.2', 'categories.0']);
    assert.equal(missingNames([]).size, 0);
  });

  // ------------------------------------------------- slugFollowsMissingName

  const cfg = { categories: [{ id: 'c0', name: '', slug: '' }], authors: [{ id: 'a0' }, { id: 'a1', name: '', slug: '' }] };

  test('slugFollowsMissingName: suppress only when the item name is missing AND the slug follows it', () => {
    const calls = [];
    const followsYes = (list, item) => { calls.push([list, item]); return true; };
    const followsNo = () => false;
    const nameMissing = new Set(['categories.0', 'authors.1']);

    // name missing + follows the name → suppress
    assert.equal(slugFollowsMissingName('categories.0.slug', nameMissing, cfg, followsYes), true);
    assert.deepEqual(calls[0], ['categories', cfg.categories[0]]); // called with (list, the config item)

    // name missing but the slug does not follow the name → show the slug error
    assert.equal(slugFollowsMissingName('categories.0.slug', nameMissing, cfg, followsNo), false);

    // the author path resolves against config.authors[1]
    calls.length = 0;
    assert.equal(slugFollowsMissingName('authors.1.slug', nameMissing, cfg, followsYes), true);
    assert.deepEqual(calls[0], ['authors', cfg.authors[1]]);
  });

  test('slugFollowsMissingName: name present, or a non-slug path → never suppressed (predicate not consulted)', () => {
    const nameMissing = new Set(['categories.0']);
    const boom = () => { throw new Error('followsName must not run when there is nothing to suppress'); };
    // name not in the missing set → item null, predicate skipped
    assert.equal(slugFollowsMissingName('authors.0.slug', nameMissing, cfg, boom), false);
    // not a slug path at all
    assert.equal(slugFollowsMissingName('categories.0.name', nameMissing, cfg, boom), false);
    assert.equal(slugFollowsMissingName('categories.0.tint', nameMissing, cfg, boom), false);
    assert.equal(slugFollowsMissingName('', nameMissing, cfg, boom), false);
  });

  console.log(`blog-manage helpers: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((err) => { console.error(err); process.exit(1); });
