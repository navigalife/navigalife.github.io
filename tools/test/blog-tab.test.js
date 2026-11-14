#!/usr/bin/env node
// Tests for the pure helpers of admin/blog-tab.js (the `_internals` test seam):
// live/once-live status rules, what a publish / schedule / unpublish / delete would
// commit (planNext, planDelete), and the conflict / failure toast titles.
//   node tools/test/blog-tab.test.js
// prints one line per failure plus one summary line, exits non-zero on failure.
//
// Loading: blog-tab.js is a browser ES module. Its four static imports are only
// used inside createBlogTab, so they are cut from a copy of its current source
// (asserted line by line, so a changed import fails loudly) and the copy is
// imported from a data: URL. The globals it reads at import time are set the
// way the admin page sets them (content-rules / blog-blocks) or stubbed
// (location, matchMedia).
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const FILE = path.join(ROOT, 'admin/blog-tab.js');
const RULES = require(path.join(ROOT, 'admin/content-rules.js'));
const BLOCKS = require(path.join(ROOT, 'admin/blog-blocks.js'));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

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
  "import './blog-blocks.js';",
  "import { ASSET_MAX_BYTES, createDraftsApi } from './drafts-api.js';",
  "import { intakeImage } from './image-intake.js';",
];

const clone = (value) => structuredClone(value);
// Fixed clock, India time (the admin writes +05:30 stamps).
const NOW = Date.parse('2026-11-13T12:00:00+05:30');
const PAST = '2026-10-01T09:00:00+05:30';
const FUTURE = '2026-11-20T09:00:00+05:30';
const MIN = 60 * 1000;
const ist = (ms) => new Date(ms + 330 * MIN).toISOString().slice(0, 19) + '+05:30';

(async () => {
  let src = fs.readFileSync(FILE, 'utf8');
  for (const line of IMPORTS) {
    assert.ok(src.includes(line + '\n'), `blog-tab.js no longer starts with: ${line}`);
    src = src.replace(line + '\n', '');
  }
  assert.ok(!/^import\s/m.test(src), 'blog-tab.js has a static import this loader does not know');
  src = 'const ASSET_MAX_BYTES = 0; const createDraftsApi = () => ({}); const intakeImage = async () => null;\n' + src;
  globalThis.MediVascContentRules = RULES;
  globalThis.MediVascBlogBlocks = BLOCKS;
  globalThis.location = { hostname: 'test.invalid' };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const { isLiveNow, everLive, hadReaders, shownStatus, notSent, failCopy, planNext, planDelete, stageOf, actionsFor, statusChip } = mod._internals;

  // ------------------------------------------------------------ isLiveNow

  test('isLiveNow: published, due, not due, unpublished, nothing', () => {
    const rows = [
      [{ status: 'published', publishAt: PAST }, true],
      [{ status: 'published' }, true], // published counts even without a date
      [{ status: 'scheduled', publishAt: PAST }, true], // its time has come: the scheduled deploy built it
      [{ status: 'scheduled', publishAt: ist(NOW) }, true], // exactly now is due
      [{ status: 'scheduled', publishAt: ist(NOW + MIN) }, false],
      [{ status: 'scheduled', publishAt: FUTURE }, false],
      [{ status: 'scheduled', publishAt: '' }, false],
      [{ status: 'scheduled', publishAt: 'soon' }, false],
      [{ status: 'scheduled' }, false],
      [{ status: 'unpublished', publishAt: PAST }, false],
      [{ status: 'unpublished', publishAt: '' }, false],
      [null, false],
      [undefined, false],
    ];
    for (const [record, want] of rows) assert.equal(isLiveNow(record, NOW), want, JSON.stringify(record));
  });

  // ------------------------------------------------------------ once live

  test('everLive / shownStatus truth rows (hadReaders: an updated date or an old address)', () => {
    const rows = [
      // record, everLive, shownStatus
      [null, false, 'draft'],
      [{ status: 'published', publishAt: PAST }, true, 'published'],
      [{ status: 'scheduled', publishAt: PAST }, true, 'published'], // due: readers see it
      [{ status: 'scheduled', publishAt: FUTURE }, false, 'scheduled'],
      [{ status: 'scheduled', publishAt: FUTURE, previousSlugs: [] }, false, 'scheduled'],
      [{ status: 'scheduled', publishAt: FUTURE, updatedAt: PAST }, true, 'scheduled'], // rescheduled once-live post
      [{ status: 'scheduled', publishAt: FUTURE, previousSlugs: ['old-name'] }, true, 'scheduled'],
      [{ status: 'scheduled', publishAt: FUTURE, updatedAt: 'not a date' }, false, 'scheduled'],
      [{ status: 'unpublished', publishAt: PAST }, true, 'unpublished'],
      [{ status: 'unpublished', publishAt: FUTURE, updatedAt: PAST }, true, 'unpublished'],
      [{ status: 'unpublished', publishAt: '' }, false, 'draft'], // unscheduled before it ever went live
      [{ status: 'unpublished' }, false, 'draft'],
    ];
    for (const [record, live, shown] of rows) {
      assert.equal(everLive(record), live, 'everLive ' + JSON.stringify(record));
      assert.equal(shownStatus(record), shown, 'shownStatus ' + JSON.stringify(record));
    }
    assert.equal(hadReaders({ updatedAt: PAST }), true);
    assert.equal(hadReaders({ previousSlugs: ['a'] }), true);
    assert.equal(hadReaders({ previousSlugs: [] }), false);
    assert.equal(hadReaders({ previousSlugs: 'a' }), false);
    assert.equal(hadReaders({ updatedAt: '' }), false);
  });

  // ------------------------------------------------------------ planNext

  const LIVE = { id: 'p_a', slug: 'foot-care', previousSlugs: [], status: 'published', publishAt: PAST, title: 'Foot care' };
  const draftOf = (record, over = {}) => ({ id: record.id, post: { ...clone(record), ...over } });

  test('713481f: once live, rescheduled, unscheduled: stays Unpublished, keeps its date, old address redirects', () => {
    // 1. Reschedule the live post for next week, same address.
    const s1 = planNext([LIVE], draftOf(LIVE, { publishAt: FUTURE }), 'schedule', NOW);
    assert.equal(s1.next.status, 'scheduled');
    assert.equal(s1.next.publishAt, FUTURE);
    assert.equal(s1.next.updatedAt, ist(NOW), 'a schedule of a post readers have seen stamps updatedAt');
    assert.deepEqual(s1.next.previousSlugs, []);
    assert.equal(everLive(s1.next), true);
    assert.equal(shownStatus(s1.next), 'scheduled');
    // The site ignores that stamp: it is not a later day than the (new) publish day.
    assert.equal(RULES.updatedAtOf(s1.next), '');
    // 2. Take it off the schedule.
    const s2 = planNext(s1.nextPosts, draftOf(s1.next), 'unpublish', NOW + MIN);
    assert.equal(s2.next.status, 'unpublished');
    assert.equal(s2.next.publishAt, FUTURE, 'keeps publishAt');
    assert.equal(s2.next.updatedAt, ist(NOW));
    assert.equal(shownStatus(s2.next), 'unpublished', 'not a fresh Draft');
    assert.equal(everLive(s2.next), true);
    // 3. Give it a new address and publish again: the old one keeps working.
    const s3 = planNext(s2.nextPosts, draftOf(s2.next, { slug: 'foot-care-daily' }), 'publish', NOW + 2 * MIN);
    assert.equal(s3.next.status, 'published');
    assert.equal(s3.next.slug, 'foot-care-daily');
    assert.deepEqual(s3.next.previousSlugs, ['foot-care']);
    assert.equal(s3.next.publishAt, ist(NOW + 2 * MIN), 'not live when pressed: goes live now');
    assert.ok(!('updatedAt' in s3.next), 'U2: an updated date from before the republish is dropped');
    assert.equal(BLOCKS.postLinks(s3.nextPosts, []).get('foot-care'), 'foot-care-daily');
  });

  test('never live, scheduled then unscheduled: a Draft again; a new address leaves no redirect', () => {
    const sched = { id: 'p_b', slug: 'new-post', previousSlugs: [], status: 'scheduled', publishAt: FUTURE, title: 'New post' };
    const un = planNext([sched], draftOf(sched), 'unpublish', NOW);
    assert.equal(un.next.status, 'unpublished');
    assert.equal(un.next.publishAt, '');
    assert.equal(shownStatus(un.next), 'draft');
    const pub = planNext(un.nextPosts, draftOf(un.next, { slug: 'new-name' }), 'publish', NOW + MIN);
    assert.deepEqual(pub.next.previousSlugs, []);
  });

  test('schedule: updatedAt only for a post readers have seen', () => {
    const stale = { updatedAt: PAST };
    // A brand-new draft (no record yet).
    const fresh = planNext([], { id: 'p_n', post: { slug: 'n', title: 'N', publishAt: FUTURE, ...stale } }, 'schedule', NOW);
    assert.ok(!('updatedAt' in fresh.next));
    assert.equal(fresh.index, 0);
    assert.equal(fresh.nextPosts[0], fresh.next);
    // Rescheduling a not-yet-live scheduled post.
    const sched = { id: 'p_s', slug: 's', previousSlugs: [], status: 'scheduled', publishAt: FUTURE, title: 'S' };
    assert.ok(!('updatedAt' in planNext([sched], draftOf(sched, { publishAt: ist(NOW + 9 * MIN), ...stale }), 'schedule', NOW).next));
    // Unpublished once-live (has a publish date) and due-scheduled posts were seen.
    const off = { id: 'p_o', slug: 'o', previousSlugs: [], status: 'unpublished', publishAt: PAST, title: 'O' };
    assert.equal(planNext([off], draftOf(off, { publishAt: FUTURE }), 'schedule', NOW).next.updatedAt, ist(NOW));
    const due = { ...sched, id: 'p_d', publishAt: PAST };
    assert.equal(planNext([due], draftOf(due, { publishAt: FUTURE }), 'schedule', NOW).next.updatedAt, ist(NOW));
  });

  test('publish: a live post keeps its date and is marked updated; a draft photo moves under its address', () => {
    const changes = planNext([LIVE], draftOf(LIVE, { publishAt: '', cover: { src: 'draft:cover.webp' } }), 'publish', NOW);
    assert.equal(changes.next.publishAt, PAST);
    assert.equal(changes.next.updatedAt, ist(NOW));
    assert.equal(changes.next.cover.src, 'assets/blog/foot-care/cover.webp');
    assert.deepEqual(changes.images, ['cover.webp']);
    assert.equal(changes.before[0], LIVE, 'before is the committed list, untouched');
    assert.equal(LIVE.updatedAt, undefined);
    // A due scheduled post taken off the site keeps its date (it had readers).
    const due = { id: 'p_d', slug: 'd', previousSlugs: [], status: 'scheduled', publishAt: PAST, title: 'D' };
    const off = planNext([due], draftOf(due), 'unpublish', NOW);
    assert.equal(off.next.publishAt, PAST);
    assert.equal(shownStatus(off.next), 'unpublished');
    assert.equal(planNext([], { id: 'x', post: {} }, 'unpublish', NOW), null, 'nothing to take off');
  });

  // ------------------------------------------------------------ toast titles

  test('conflict titles are the failure titles + " yet", for what the post was when pressed', () => {
    const pub = { status: 'published', publishAt: PAST };
    const sched = { status: 'scheduled', publishAt: FUTURE };
    const off = { status: 'unpublished', publishAt: PAST };
    // afterConflict's intent for a delete is 'delete-post'; failCopy's is 'delete'.
    const failIntent = { 'delete-post': 'delete' };
    const want = {
      publish: ['Changes not published yet', 'Not published yet', 'Not published yet', 'Not published yet'],
      schedule: ['Not scheduled yet', 'Not scheduled yet', 'Not scheduled yet', 'Not scheduled yet'],
      unpublish: ['Not taken off the site yet', 'Not taken off the schedule yet', 'Not taken off the schedule yet', 'Not taken off the schedule yet'],
      'delete-post': ['Not deleted yet', 'Not deleted yet', 'Not deleted yet', 'Not deleted yet'],
    };
    for (const [intent, titles] of Object.entries(want)) {
      [pub, sched, off, null].forEach((was, i) => {
        const title = notSent(intent, was);
        assert.equal(title, titles[i], `${intent} / ${JSON.stringify(was)}`);
        assert.equal(title, failCopy(failIntent[intent] || intent, { live: was }).title + ' yet', `${intent} / ${JSON.stringify(was)} matches failCopy`);
        assert.doesNotMatch(title, /—/);
      });
    }
    assert.equal(failCopy('publish', { live: pub }).reassure, 'Nothing changed on the site, and your post is still here.');
    assert.ok(!/try again/i.test(failCopy('publish', { live: pub }).reassure), 'describeApiError says try again once');
  });

  // ------------------------------------------------------------ planDelete

  test('delete: record, unshared photos, related / featured / redirects into it go; nothing else', () => {
    const target = {
      id: 'p_del', slug: 'old-post', previousSlugs: ['older-post'], status: 'unpublished', publishAt: PAST, title: 'Old post',
      cover: { src: 'assets/blog/old-post/cover.webp' },
      blocks: [
        { type: 'image', src: '/assets/blog/old-post/only.webp' },
        { type: 'image', src: 'assets/blog/old-post/shared.webp' },
        { type: 'image', src: 'assets/blog/old-post/in-company.webp' },
        { type: 'image', src: 'assets/blog/old-post/in-draft.webp' },
        { type: 'image', src: 'assets/blog/old-post/in-settings.webp' },
        { type: 'image', src: 'assets/blog/authors/meera.webp' },
        { type: 'image', src: 'assets/blog/old-post/../escape.webp' },
      ],
      related: ['p_keep'],
    };
    const keep = {
      id: 'p_keep', slug: 'keep-post', previousSlugs: [], status: 'published', publishAt: PAST, title: 'Keep post',
      related: ['p_del', 'p_x'],
      blocks: [{ type: 'image', src: 'assets/blog/old-post/shared.webp' }, { type: 'paragraph', text: [{ t: 'See ' }, { t: 'this', href: 'blog/older-post/#top' }] }],
    };
    const other = { id: 'p_x', slug: 'x-post', previousSlugs: [], status: 'published', publishAt: PAST, title: '', related: [], blocks: [{ type: 'paragraph', text: [{ t: 'promo', href: 'blog/promo/' }] }] };
    const unrelated = { id: 'p_y', slug: 'y-post', previousSlugs: [], status: 'published', publishAt: PAST, title: 'Y', related: ['p_x'], blocks: [] };
    const before = [keep, target, other, unrelated];
    const cfg = {
      featured: ['p_del', 'p_keep'],
      redirects: [{ from: 'blog/promo/', to: 'blog/old-post/' }, { from: 'blog/x/', to: 'blog/keep-post/' }, { from: 'blog/z/', to: 'blog/older-post/#a' }],
      categories: [{ id: 'c', cover: 'assets/blog/old-post/in-settings.webp' }],
    };
    const draftData = { blogPosts: before, blogConfig: cfg, company: { logo: 'assets/blog/old-post/in-company.webp' } };
    const otherDrafts = new Map([
      ['p_x', { post: { cover: { src: 'assets/blog/old-post/in-draft.webp' } } }],
      ['p_del', { post: { cover: { src: 'assets/blog/old-post/only.webp' } } }], // its own draft goes with it
    ]);
    const plan = planDelete(before, cfg, { id: 'p_del' }, draftData, otherDrafts);
    assert.deepEqual(plan.nextPosts.map((p) => p.id), ['p_keep', 'p_x', 'p_y']);
    assert.deepEqual(plan.nextPosts[0].related, ['p_x']);
    assert.equal(plan.nextPosts[1], other, 'posts that did not name it are the same objects');
    assert.equal(plan.nextPosts[2], unrelated);
    assert.deepEqual(plan.nextConfig.featured, ['p_keep']);
    assert.deepEqual(plan.nextConfig.redirects, [{ from: 'blog/x/', to: 'blog/keep-post/' }]);
    assert.equal(plan.configChanged, true);
    assert.deepEqual(cfg.featured, ['p_del', 'p_keep'], 'the committed settings are not mutated');
    // Kept: shared (another post), in-company (a data file), in-draft (another
    // post's saved draft), in-settings (the settings that will be committed),
    // the author photo, and a path that climbs out with '..'.
    assert.deepEqual(plan.deletes.sort(), ['assets/blog/old-post/cover.webp', 'assets/blog/old-post/only.webp']);
    assert.equal(plan.before, before);
    // Text links to it (an old address, or an address that redirected to it) are
    // named for the confirm, never rewritten.
    assert.deepEqual(plan.linkedFrom, ['Keep post', 'Untitled post']);
    assert.equal(JSON.stringify(plan.nextPosts[0].blocks), JSON.stringify(keep.blocks));
    assert.ok(!('problems' in plan), 'checks are added by buildDelete');
  });

  test('delete: only an unpublished post; nothing to drop leaves the settings object as it was', () => {
    const rec = (status) => ({ id: 'p', slug: 'p', previousSlugs: [], status, publishAt: PAST, title: 'P', blocks: [] });
    for (const status of ['published', 'scheduled']) assert.equal(planDelete([rec(status)], {}, { id: 'p' }, {}, new Map()), null, status);
    assert.equal(planDelete([], {}, { id: 'p' }, {}, new Map()), null, 'no record');
    const cfg = { featured: ['q'], redirects: [] };
    const plan = planDelete([rec('unpublished')], cfg, { id: 'p' }, {}, new Map());
    assert.equal(plan.nextConfig, cfg);
    assert.equal(plan.configChanged, false);
    assert.deepEqual(plan.nextPosts, []);
    assert.deepEqual(plan.deletes, []);
    assert.deepEqual(plan.linkedFrom, []);
  });

  test('delete: the freed addresses can be used by another post', () => {
    const config = Object.assign(readJson('data/blog/config.json'), readJson('data/blog/samples.config.json'));
    const films = readJson('data/films.json');
    const samples = readJson('data/blog/samples.json');
    const target = { ...clone(samples[1]), status: 'unpublished', previousSlugs: ['old-walking-pain'] };
    const posts = samples.map((p, i) => (i === 1 ? target : p));
    const reuse = (list) => [...list, { ...clone(samples[2]), id: 'p_reuse', slug: target.slug, previousSlugs: ['old-walking-pain'], related: [] }];
    const used = (errors) => errors.filter((e) => /already used by/.test(e.message));
    assert.equal(used(RULES.validateBlogPostsDetailed(reuse(posts), config, films)).length, 2, 'taken while the post exists');
    const plan = planDelete(posts, config, { id: target.id }, { blogPosts: posts, blogConfig: config }, new Map());
    assert.deepEqual(used(RULES.validateBlogPostsDetailed(reuse(plan.nextPosts), plan.nextConfig, films)), []);
  });

  // ------------------------------------------------------------ statusChip

  // The host's HTML escaper is threaded in; a passthrough is enough for these
  // safe inputs. stripTags gives the chip's text content (what a reader hears).
  const esc = (v = '') => String(v);
  const stripTags = (html) => html.replace(/<[^>]*>/g, '');
  // The text inside the one `.bt-status__when` span, if any.
  const whenText = (html) => (/<span class="bt-status__when">([^<]*)</.exec(html) || [])[1];

  test('statusChip: a live row nests the dates in .bt-status__when, "Published" stays outside it', () => {
    const html = statusChip(esc, 'published', PAST, '30 Sep', '2 Nov');
    assert.ok(html.includes('class="bt-status bt-status--dated"'));
    assert.ok(html.includes('data-status="published"'));
    // "Published" is printed before the when span opens, so it is not inside it.
    assert.ok(html.indexOf('Published') < html.indexOf('bt-status__when'), 'Published before the when span');
    assert.ok(!(whenText(html) || '').includes('Published'), '"Published" is not inside .bt-status__when');
    assert.equal(whenText(html), ' 30 Sep · updated 2 Nov');
    assert.equal(stripTags(html), 'Published 30 Sep · updated 2 Nov');
  });
  test('statusChip: a live row with no update date drops the " · updated …" tail', () => {
    const html = statusChip(esc, 'published', PAST, '30 Sep', '');
    assert.equal(stripTags(html), 'Published 30 Sep');
    assert.equal(whenText(html), ' 30 Sep');
  });
  test('statusChip: a plain status (no publishedOn) shows its label; a scheduled one dates the when span', () => {
    assert.equal(stripTags(statusChip(esc, 'draft')), 'Draft');
    assert.ok(statusChip(esc, 'unpublished').includes('data-status="unpublished"'));
    const sched = statusChip(esc, 'scheduled', FUTURE);
    assert.ok(sched.includes('data-status="scheduled"'));
    assert.ok(/bt-status__when">\s*·\s*/.test(sched), 'a valid scheduled time fills the when span');
    // Not a valid time → no when span at all.
    assert.ok(!statusChip(esc, 'scheduled', '').includes('bt-status__when'));
  });

  // ------------------------------------------------------------ actionsFor

  test('actionsFor: a live post with unpublished edits offers "Discard" (not "Delete")', () => {
    const acts = actionsFor({ live: { status: 'published', publishAt: PAST }, hasDraft: true });
    const discard = acts.find(([action]) => action === 'discard');
    assert.ok(discard, 'a discard action is present');
    assert.equal(discard[1], 'Discard');
    assert.ok(!acts.some(([action]) => action === 'delete'), 'no draft-delete for a live post');
  });
  test('actionsFor: a never-live draft deletes the draft, not "Discard"', () => {
    const acts = actionsFor({ live: null, hasDraft: true });
    assert.deepEqual((acts.find(([a]) => a === 'delete') || [])[1], 'Delete draft');
    assert.ok(!acts.some(([action]) => action === 'discard'));
  });
  test('stageOf: published/scheduled-due = live, future scheduled = waiting, off otherwise, none when no record', () => {
    assert.equal(stageOf(null), 'none');
    assert.equal(stageOf({ status: 'published', publishAt: PAST }), 'live');
    assert.equal(stageOf({ status: 'scheduled', publishAt: PAST }), 'live');
    assert.equal(stageOf({ status: 'scheduled', publishAt: FUTURE }), 'waiting');
    assert.equal(stageOf({ status: 'unpublished', publishAt: PAST }), 'off');
  });

  // ------------------------------------------------------------ paintPost markup

  test('the post view carries no data-bt-meta (the single word count lives in the editor bar)', () => {
    const raw = fs.readFileSync(FILE, 'utf8');
    assert.ok(!raw.includes('data-bt-meta'), 'blog-tab.js should not reference data-bt-meta');
  });

  console.log(`blog-tab: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
