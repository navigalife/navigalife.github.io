#!/usr/bin/env node
// Tests for the pure helpers of admin/blog-editor.js (the `_internals` test seam,
// AGENTS.md "The blog"). Plain node, no framework, no DOM:
//   node tools/test/blog-editor.test.js
// prints one line per failure plus one summary line, exits non-zero on failure.
// MV_TEST_AREAS=1 also prints the per-area test counts to stderr.
//
// Loading: blog-editor.js is a browser ES module with no imports and no
// import-time DOM access, so it is imported from a data: URL of its current
// source (no Node "typeless module" warning, no shim). The only global set is
// the one the admin page sets too: content-rules.js → globalThis.MediVascContentRules.
//
// Out of scope here (need a real DOM): sanitizeHtml (DOMParser), domToRuns,
// runsToDom (incl. the adjacent-citation "1,2" flag), getOffsets/setOffsets.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const FILE = path.join(ROOT, 'admin/blog-editor.js');
const RULES = require(path.join(ROOT, 'admin/content-rules.js'));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

let passed = 0;
let failed = 0;
const areas = new Map();
const test = (area, name, fn) => {
  areas.set(area, (areas.get(area) || 0) + 1);
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL [${area}] ${name}\n     ${String(err && err.message).split('\n').join('\n     ')}`);
  }
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/; // content-rules.js: video `youtube?` (11-char id)
const E = RULES.BLOG_ENUMS;

(async () => {
  globalThis.MediVascContentRules = RULES;
  const src = fs.readFileSync(FILE, 'utf8');
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const I = mod._internals;
  const {
    toInline, normRuns, trimRuns, applyMark, markState, splitRuns, normalizeHref, parseYouTube,
    wholeWordMatch, citeCounts, mapRunArrays, newBlock, piecesFromText,
  } = I;

  // Contract Inline: a string is one unmarked run ('' is no runs).
  const asRuns = (v) => (typeof v === 'string' ? (v ? [{ t: v }] : []) : v);
  // The editor's rich-field commit path minus the DOM walk: toInline(trimRuns(domToRuns(f))).
  const commit = (v) => toInline(trimRuns(asRuns(v)));
  const textOf = (runs) => runs.map((r) => (r.cite !== undefined ? '' : r.t)).join('');

  // Every Inline-typed field of a post body, per content-rules.js validateBlogPosts.
  const inlineFields = (blocks) => {
    const out = [];
    const add = (p, v) => { if (v !== undefined) out.push({ path: p, value: v }); };
    blocks.forEach((b, k) => {
      const p = `blocks.${k}`;
      switch (b.type) {
        case 'paragraph': case 'lead': case 'quote': case 'callout': add(`${p}.text`, b.text); break;
        case 'list': case 'takeaways': b.items.forEach((v, j) => add(`${p}.items.${j}`, v)); break;
        case 'image': case 'video': add(`${p}.caption`, b.caption); break;
        case 'gallery':
          add(`${p}.caption`, b.caption);
          b.images.forEach((im, j) => add(`${p}.images.${j}.caption`, im.caption));
          break;
        case 'imageText':
          add(`${p}.image.caption`, b.image.caption);
          b.text.forEach((v, j) => add(`${p}.text.${j}`, v));
          break;
        case 'table': b.rows.forEach((row, r) => row.forEach((v, c) => add(`${p}.rows.${r}.${c}`, v))); break;
        case 'faq': b.items.forEach((it, j) => add(`${p}.items.${j}.a`, it.a)); break;
        default: break;
      }
    });
    return out;
  };

  test('seam', '_internals exposes the helpers this suite pins', () => {
    for (const k of ['toInline', 'normRuns', 'trimRuns', 'applyMark', 'markState', 'splitRuns', 'normalizeHref',
      'parseYouTube', 'wholeWordMatch', 'citeCounts', 'mapRunArrays', 'newBlock', 'piecesFromText']) {
      assert.equal(typeof I[k], 'function', `_internals.${k}`);
    }
  });

  // ================================================== 1. sample round-trip
  const samples = readJson('data/blog/samples.json');
  test('roundtrip', 'samples.json has posts to round-trip', () => assert.ok(samples.length >= 6));
  for (const post of samples) {
    const fields = inlineFields(post.blocks);
    test('roundtrip', `${post.id}: every Inline survives the editor commit path unchanged`, () => {
      assert.ok(fields.length > 0);
      for (const { path: p, value } of fields) assert.deepStrictEqual(commit(value), value, `${post.id} ${p}`);
    });
    test('roundtrip', `${post.id}: mapRunArrays(blocks, commit) is identical to blocks`, () => {
      const before = JSON.stringify(post.blocks);
      assert.deepStrictEqual(mapRunArrays(post.blocks, (runs) => toInline(trimRuns(runs))), post.blocks);
      assert.equal(JSON.stringify(post.blocks), before, 'input untouched');
    });
    test('roundtrip', `${post.id}: mapRunArrays visits exactly the contract's run arrays`, () => {
      const expected = fields.filter((f) => Array.isArray(f.value) && f.value.length).map((f) => JSON.stringify(f.value));
      const seen = [];
      mapRunArrays(post.blocks, (runs) => { seen.push(JSON.stringify(runs)); return runs; });
      assert.deepStrictEqual(seen.sort(), expected.sort());
    });
    test('roundtrip', `${post.id}: citeCounts matches the cites in the contract fields, all resolving`, () => {
      const want = new Map();
      for (const { value } of fields) {
        for (const r of asRuns(value)) if (r.cite !== undefined) want.set(r.cite, (want.get(r.cite) || 0) + 1);
      }
      assert.deepStrictEqual([...citeCounts(post.blocks)].sort(), [...want].sort());
      const ids = new Set((post.references || []).map((r) => r.id));
      for (const id of want.keys()) assert.ok(ids.has(id), `${post.id} cites ${id}`);
    });
  }
  test('roundtrip', 'samples exercise cites, links, highlight and every Inline-bearing block', () => {
    const all = samples.flatMap((p) => inlineFields(p.blocks).map((f) => asRuns(f.value))).flat();
    assert.ok(all.some((r) => r.cite !== undefined));
    assert.ok(all.some((r) => r.href));
    assert.ok(all.some((r) => r.hl));
    const types = new Set(samples.flatMap((p) => p.blocks.map((b) => b.type)));
    for (const t of ['paragraph', 'lead', 'list', 'quote', 'callout', 'takeaways', 'image', 'gallery', 'imageText',
      'table', 'video', 'faq']) assert.ok(types.has(t), t);
  });

  // ==================================================== 2. inline marks
  // Fixtures are factories: applyMark mutates its input (see FINDING below), so a shared array would leak.
  const hw = () => [{ t: 'Hello world' }];
  const L = 'https://iwgdfguidelines.org/';
  const L2 = 'https://www.nice.org.uk/guidance/ng19';
  test('marks', 'bold a word splits the run', () => {
    assert.deepStrictEqual(applyMark(hw(), 0, 5, 'b'), [{ t: 'Hello', b: true }, { t: ' world' }]);
  });
  test('marks', 'toggling bold twice restores the plain string', () => {
    const once = applyMark(hw(), 0, 5, 'b');
    const twice = applyMark(once, 0, 5, 'b');
    assert.deepStrictEqual(twice, [{ t: 'Hello world' }]);
    assert.equal(toInline(twice), 'Hello world');
  });
  test('marks', 'toggle over a partly-bold range turns it all on, merged', () => {
    const r = applyMark(applyMark(hw(), 0, 5, 'b'), 0, 11, 'b');
    assert.deepStrictEqual(r, [{ t: 'Hello world', b: true }]);
  });
  test('marks', 'adjacent identical marks merge into one run', () => {
    const r = applyMark(applyMark(hw(), 0, 3, 'b'), 3, 5, 'b');
    assert.deepStrictEqual(r, [{ t: 'Hello', b: true }, { t: ' world' }]);
  });
  test('marks', 'overlapping bold + italic split at every boundary', () => {
    const r = applyMark(applyMark(hw(), 0, 5, 'b'), 3, 8, 'i');
    assert.deepStrictEqual(r, [{ t: 'Hel', b: true }, { t: 'lo', b: true, i: true }, { t: ' wo', i: true }, { t: 'rld' }]);
  });
  test('marks', 'explicit false removes the mark everywhere in range', () => {
    const r = applyMark(applyMark(applyMark(hw(), 0, 2, 'b'), 6, 9, 'b'), 0, 11, 'b', false);
    assert.deepStrictEqual(r, [{ t: 'Hello world' }]);
  });
  test('marks', 'explicit true on already-bold text is a no-op', () => {
    const bold = [{ t: 'Hello', b: true }, { t: ' world' }];
    assert.deepStrictEqual(applyMark(bold, 1, 4, 'b', true), bold);
  });
  test('marks', 'highlight (hl) applies like the other marks', () => {
    assert.deepStrictEqual(applyMark(hw(), 6, 11, 'hl'), [{ t: 'Hello ' }, { t: 'world', hl: true }]);
  });
  test('marks', 'empty range changes nothing and reports no mark', () => {
    assert.deepStrictEqual(applyMark(hw(), 3, 3, 'b'), hw());
    assert.equal(markState(hw(), 3, 3, 'b'), false);
    assert.equal(markState(hw(), 3, 3, 'href'), '');
  });
  test('marks', 'markState: true only when every character carries the mark', () => {
    const r = [{ t: 'Hello', b: true }, { t: ' world' }];
    assert.equal(markState(r, 0, 5, 'b'), true);
    assert.equal(markState(r, 1, 3, 'b'), true);
    assert.equal(markState(r, 0, 6, 'b'), false);
    assert.equal(markState(r, 0, 5, 'i'), false);
  });
  test('marks', 'link applies an href and markState returns it', () => {
    const r = applyMark(hw(), 6, 11, 'href', L);
    assert.deepStrictEqual(r, [{ t: 'Hello ' }, { t: 'world', href: L }]);
    assert.equal(markState(r, 6, 11, 'href'), L);
    assert.equal(markState(r, 0, 11, 'href'), '', 'partly linked → no shared href');
  });
  test('marks', 'link with false removes it and re-merges', () => {
    const r = applyMark(applyMark(hw(), 6, 11, 'href', L), 6, 11, 'href', false);
    assert.deepStrictEqual(r, [{ t: 'Hello world' }]);
  });
  test('marks', 'relinking a range replaces the href', () => {
    const r = applyMark(applyMark(hw(), 0, 11, 'href', L), 0, 11, 'href', L2);
    assert.deepStrictEqual(r, [{ t: 'Hello world', href: L2 }]);
  });
  test('marks', 'different hrefs never merge; markState over both is ""', () => {
    const r = applyMark(applyMark(hw(), 0, 5, 'href', L), 5, 11, 'href', L2);
    assert.deepStrictEqual(r, [{ t: 'Hello', href: L }, { t: ' world', href: L2 }]);
    assert.equal(markState(r, 0, 11, 'href'), '');
  });
  test('marks', 'same href on adjacent ranges merges', () => {
    const r = applyMark(applyMark(hw(), 0, 5, 'href', L), 5, 11, 'href', L);
    assert.deepStrictEqual(r, [{ t: 'Hello world', href: L }]);
  });
  test('marks', 'link and bold coexist on one run', () => {
    const r = applyMark(applyMark(hw(), 0, 5, 'href', L), 0, 5, 'b');
    assert.deepStrictEqual(r, [{ t: 'Hello', href: L, b: true }, { t: ' world' }]);
  });
  const cited = () => [{ t: 'Foot ulcers heal' }, { cite: 'r1' }, { cite: 'r2' }, { t: ' slowly.' }]; // length 26
  test('marks', 'a citation counts as one character of offset', () => {
    const [a, b] = splitRuns(cited(), 17);
    assert.deepStrictEqual(a, [{ t: 'Foot ulcers heal' }, { cite: 'r1' }]);
    assert.deepStrictEqual(b, [{ cite: 'r2' }, { t: ' slowly.' }]);
  });
  test('marks', 'marks across a range skip citations (a cite carries no formatting)', () => {
    const r = applyMark(cited(), 0, 26, 'b');
    assert.deepStrictEqual(r, [{ t: 'Foot ulcers heal', b: true }, { cite: 'r1' }, { cite: 'r2' }, { t: ' slowly.', b: true }]);
    assert.equal(markState(r, 0, 26, 'b'), true, 'cites do not make the range "mixed"');
  });
  test('marks', 'links across a range skip citations', () => {
    const r = applyMark(cited(), 10, 20, 'href', L);
    for (const run of r) if (run.cite !== undefined) assert.deepStrictEqual(Object.keys(run), ['cite']);
    assert.equal(textOf(r), textOf(cited()));
  });
  test('marks', 'a cite-only range has no mark and toggling it changes nothing', () => {
    assert.equal(markState(cited(), 16, 17, 'b'), false);
    assert.deepStrictEqual(applyMark(cited(), 16, 17, 'b'), cited());
  });
  test('marks', 'mark ops never change the text or drop a citation', () => {
    for (const [s, e] of [[0, 4], [3, 18], [16, 18], [17, 26], [0, 26], [25, 26]]) {
      for (const m of ['b', 'i', 'hl']) {
        const r = applyMark(cited(), s, e, m);
        assert.equal(textOf(r), textOf(cited()), `${m} ${s}-${e}`);
        assert.deepStrictEqual(r.filter((x) => x.cite !== undefined), [{ cite: 'r1' }, { cite: 'r2' }]);
      }
    }
  });
  // Was a FINDING (applyMark mutated its input runs); fixed in blog-editor.js applyMark.
  test('marks', 'applyMark leaves its input untouched', () => {
    const r = [{ t: 'Hello world' }]; applyMark(r, 0, 11, 'b'); assert.deepStrictEqual(r, [{ t: 'Hello world' }]);
    const s = [{ t: 'Hi', b: true }, { t: ' there' }]; applyMark(s, 0, 8, 'b'); assert.deepStrictEqual(s, [{ t: 'Hi', b: true }, { t: ' there' }]);
  });
  test('marks', 'markState leaves its input untouched', () => {
    const r = [{ t: 'Hello', b: true }, { t: ' world' }];
    const before = JSON.stringify(r);
    markState(r, 0, 11, 'b');
    markState(r, 2, 8, 'href');
    assert.equal(JSON.stringify(r), before);
  });

  test('marks', 'splitRuns mid-run keeps marks on both halves', () => {
    const [a, b] = splitRuns([{ t: 'Hello', b: true }, { t: ' world' }], 3);
    assert.deepStrictEqual(a, [{ t: 'Hel', b: true }]);
    assert.deepStrictEqual(b, [{ t: 'lo', b: true }, { t: ' world' }]);
  });
  test('marks', 'splitRuns at 0 / at a boundary / at the end', () => {
    const r = [{ t: 'Hello', b: true }, { t: ' world' }];
    assert.deepStrictEqual(splitRuns(r, 0), [[], r]);
    assert.deepStrictEqual(splitRuns(r, 5), [[r[0]], [r[1]]]);
    assert.deepStrictEqual(splitRuns(r, 11), [r, []]);
  });
  test('marks', 'splitRuns at every offset: halves concatenate back to the original', () => {
    for (let k = 0; k <= 26; k++) {
      const [a, b] = splitRuns(cited(), k);
      assert.equal(textOf(a).length + a.filter((x) => x.cite !== undefined).length, k, `left length at ${k}`);
      assert.deepStrictEqual(normRuns([...a, ...b]), normRuns(cited()), `rejoin at ${k}`);
    }
  });

  test('marks', 'normRuns merges same-mark neighbours and drops empty text runs', () => {
    assert.deepStrictEqual(normRuns([{ t: '' }, { t: 'a' }, { t: 'b' }, { t: '', b: true }]), [{ t: 'ab' }]);
    assert.deepStrictEqual(normRuns([{ t: 'a', b: true, i: true }, { t: 'b', i: true, b: true }]), [{ t: 'ab', b: true, i: true }]);
  });
  test('marks', 'normRuns keeps only contract keys (t b i hl href | cite), drops false marks', () => {
    assert.deepStrictEqual(normRuns([{ t: 'a', b: false, i: false, u: true, style: 'color:red', class: 'x' }]), [{ t: 'a' }]);
    assert.deepStrictEqual(normRuns([{ cite: 'r1', b: true, t: 'x' }]), [{ cite: 'r1' }]);
  });
  test('marks', 'normRuns never merges across or between citations', () => {
    assert.deepStrictEqual(normRuns([{ cite: 'r1' }, { cite: 'r2' }]), [{ cite: 'r1' }, { cite: 'r2' }]);
    assert.deepStrictEqual(normRuns([{ cite: 'r1' }, { cite: 'r1' }]), [{ cite: 'r1' }, { cite: 'r1' }]);
    assert.deepStrictEqual(normRuns([{ t: 'a', b: true }, { cite: 'r1' }, { t: 'b', b: true }]),
      [{ t: 'a', b: true }, { cite: 'r1' }, { t: 'b', b: true }]);
  });
  test('marks', 'normRuns does not mutate its input', () => {
    const r = [{ t: 'a' }, { t: 'b' }];
    normRuns(r);
    assert.deepStrictEqual(r, [{ t: 'a' }, { t: 'b' }]);
  });
  test('marks', 'trimRuns trims outer whitespace across runs, keeps inner', () => {
    assert.deepStrictEqual(trimRuns([{ t: '  Hello' }, { t: ' world  ', b: true }]), [{ t: 'Hello' }, { t: ' world', b: true }]);
    assert.deepStrictEqual(trimRuns([{ t: ' ', b: true }, { t: 'x' }, { t: '  ', i: true }]), [{ t: 'x' }]);
    assert.deepStrictEqual(trimRuns([{ t: '  \n ' }]), []);
  });
  test('marks', 'trimRuns stops at an edge citation', () => {
    assert.deepStrictEqual(trimRuns([{ cite: 'r1' }, { t: ' x ' }]), [{ cite: 'r1' }, { t: ' x' }]);
    assert.deepStrictEqual(trimRuns([{ t: ' x ' }, { cite: 'r1' }]), [{ t: 'x ' }, { cite: 'r1' }]);
  });
  test('marks', 'toInline: plain → string, marked/cited → runs, empty → ""', () => {
    assert.equal(toInline([]), '');
    assert.equal(toInline([{ t: '' }]), '');
    assert.equal(toInline([{ t: 'x' }]), 'x');
    assert.equal(toInline([{ t: 'a' }, { t: 'b' }]), 'ab');
    assert.deepStrictEqual(toInline([{ t: 'x', b: true }]), [{ t: 'x', b: true }]);
    assert.deepStrictEqual(toInline([{ cite: 'r1' }]), [{ cite: 'r1' }]);
    assert.deepStrictEqual(toInline([{ t: 'x', href: L }]), [{ t: 'x', href: L }]);
  });
  test('marks', 'mark results pass the content-rules Inline validator (and a bad href does not)', () => {
    const config = readJson('data/blog/config.json');
    const films = readJson('data/films.json');
    const blockErrs = (text) => {
      const post = JSON.parse(JSON.stringify(samples[0]));
      post.blocks = [{ type: 'paragraph', text }];
      post.references = [{ id: 'r1', text: 'One', url: '' }, { id: 'r2', text: 'Two', url: '' }];
      return RULES.validateBlogPostsDetailed([post], config, films).filter((e) => /blocks/.test(e.path)).map((e) => e.message);
    };
    const rich = applyMark(applyMark(applyMark(cited(), 0, 4, 'b'), 5, 11, 'i'), 18, 25, 'href', L);
    assert.deepStrictEqual(blockErrs(toInline(rich)), []);
    assert.ok(blockErrs([{ t: 'x', href: 'javascript:alert(1)' }]).length > 0, 'validator check is live');
  });

  // ================================================= 3. link normalisation
  const HREF_OK = [
    ['https://iwgdfguidelines.org/', 'https://iwgdfguidelines.org/'],
    ['  https://example.com/a?b=1#c  ', 'https://example.com/a?b=1#c'],
    ['iwgdfguidelines.org', 'https://iwgdfguidelines.org'],
    ['www.nice.org.uk/guidance/ng19', 'https://www.nice.org.uk/guidance/ng19'],
    ['care@medivasc.in', 'mailto:care@medivasc.in'],
    ['mailto:care@medivasc.in', 'mailto:care@medivasc.in'],
    ['+91 99999 99999', 'tel:+91 99999 99999'],
    ['tel:+919999999999', 'tel:+919999999999'],
    ['blog/diabetic-foot-warning-signs/', 'blog/diabetic-foot-warning-signs/'],
    ['/blog/diabetic-foot-warning-signs', 'blog/diabetic-foot-warning-signs/'],
    ['blog/foot-care#signs', 'blog/foot-care/#signs'],
    ['blog/foot-care/#signs', 'blog/foot-care/#signs'],
    ['#key-takeaways', '#key-takeaways'],
  ];
  const HREF_BAD = ['', '   ', null, undefined, 'http://example.com', 'HTTP://example.com', 'javascript:alert(1)',
    'JavaScript:alert(1)', '  javascript:alert(1)', 'javascript://example.com/%0Aalert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)', 'file:///etc/passwd', 'blob:https://example.com/x', 'ftp://example.com/', '//evil.example.com/',
    'https://exa mple.com', 'https://example.com/"onmouseover="x', 'https://example.com/<script>', 'blog/Bad_Slug/',
    '../secret', '#', '#bad anchor', 'mailto:', 'tel:abc'];
  const hrefCases = (tag) => {
    for (const [input, want] of HREF_OK) {
      test('links', `${tag}: normalizeHref(${JSON.stringify(input)}) → ${want}`, () => {
        const r = normalizeHref(input);
        assert.deepStrictEqual(r, { href: want });
        assert.ok(RULES.blogHrefAllowed(r.href), 'result passes content-rules blogHrefAllowed');
      });
    }
    test('links', `${tag}: ${HREF_BAD.length} unsafe/invalid inputs → { error } and no href`, () => {
      for (const input of HREF_BAD) {
        const r = normalizeHref(input);
        assert.equal(typeof r.error, 'string', JSON.stringify(input));
        assert.ok(r.error.length > 0);
        assert.ok(!('href' in r), JSON.stringify(input));
      }
    });
  };
  hrefCases('content-rules loaded');
  // The editor's LOCAL_HREFS fallback (no content-rules on the page) must match the contract too.
  delete globalThis.MediVascContentRules;
  hrefCases('fallback list');
  globalThis.MediVascContentRules = RULES;

  // ======================================================= 4. YouTube ids
  const ID = 'dQw4w9WgXcQ';
  const YT_OK = [
    ID, `  ${ID}  `, 'a-b_c-d_e-f',
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s`,
    `https://youtube.com/watch?feature=share&v=${ID}`,
    `https://www.youtube.com/watch?app=desktop&list=PL1&v=${ID}&t=1m2s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=AbCdEf123_x&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}?start=5`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?si=xyz`,
  ];
  for (const input of YT_OK) {
    test('youtube', `parseYouTube(${JSON.stringify(input)})`, () => {
      const want = input.trim() === 'a-b_c-d_e-f' ? 'a-b_c-d_e-f' : ID;
      const got = parseYouTube(input);
      assert.equal(got, want);
      assert.match(got, YOUTUBE_ID);
    });
  }
  test('youtube', 'invalid input → "" (which the validator rejects)', () => {
    for (const input of ['', null, undefined, 'dQw4w9WgXc', `${ID}X`, `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/watch?v=${ID}X`, 'https://vimeo.com/76979871', 'https://www.youtube.com/watch?list=PLabc',
      'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw', `https://www.youtube.com/watch?xv=${ID}`]) {
      assert.equal(parseYouTube(input), '', JSON.stringify(input));
    }
  });

  // ==================================================== 5. titleAccent match
  const T = 'Seven warning signs your feet need a doctor';
  const WW = [
    [T, 'warning signs', 6, 13],
    [T, 'WARNING SIGNS', 6, 13],
    [T, 'warn', null],
    [T, 'doctor', 37, 6],
    ['Footcare basics', 'foot', null],
    ['Café culture', 'café', 0, 4],
    ['Visit the cafés', 'café', null],
    ['Care for the over 60+ crowd', '60+', 18, 3],
    ['Healing starts today!', 'today!', 15, 6],
    ['The patients’ guide', 'patients’', 4, 9],
    ['Q&A (FAQ) for feet', 'Q&A (FAQ)', 0, 9],
    ['Pied diabétique', 'diabétique', 5, 10],
    ['Diabetes_type 2', 'Diabetes', null],
    [T, '', null],
  ];
  for (const [text, word, index, length] of WW) {
    test('accent', `wholeWordMatch(${JSON.stringify(text)}, ${JSON.stringify(word)})`, () => {
      const got = wholeWordMatch(text, word);
      assert.deepStrictEqual(got, index === null ? null : { index, length });
      assert.equal(got !== null, RULES.accentMatches(text, word), 'agrees with content-rules accentMatches');
    });
  }

  // ===================================================== 6. plain-text paste
  const P = (t) => ({ kind: 'p', runs: [{ t }] });
  const LI = (style, t) => ({ kind: 'li', style, runs: [{ t }] });
  const TXT = [
    ['blank line separates paragraphs', 'First para.\n\nSecond para.', [P('First para.'), P('Second para.')]],
    ['single newline joins with a space', 'Line one\nline two', [P('Line one line two')]],
    ['CRLF / CR line endings', 'A\r\n\r\nB\rC', [P('A'), P('B C')]],
    ['whitespace-only line is a blank line', 'A\n \t \nB', [P('A'), P('B')]],
    ['tabs and runs of spaces collapse', '  a \t  b  ', [P('a b')]],
    ['nothing but whitespace → no pieces', '\n\n  \n\t', []],
    ['dash/star bullets → bullet items', '- one\n* two\n• three', [LI('bullet', 'one'), LI('bullet', 'two'), LI('bullet', 'three')]],
    ['numbered lines → number items', '1. one\n2) two\n10. ten', [LI('number', 'one'), LI('number', 'two'), LI('number', 'ten')]],
    ['a decimal is not a list marker', 'Take 1.5 mg daily', [P('Take 1.5 mg daily')]],
    ['markup in plain text stays literal text, never marks', '<b>hi</b> <a href="javascript:x">y</a>',
      [P('<b>hi</b> <a href="javascript:x">y</a>')]],
  ];
  for (const [name, input, want] of TXT) {
    test('paste-text', name, () => {
      const got = piecesFromText(input);
      assert.deepStrictEqual(got.map((p) => (p.kind === 'li' ? p : { kind: p.kind, runs: p.runs })), want);
    });
  }
  test('paste-text', 'null/undefined → no pieces', () => {
    assert.deepStrictEqual(piecesFromText(null), []);
    assert.deepStrictEqual(piecesFromText(undefined), []);
  });
  test('paste-text', 'every piece converts to a plain-string Inline', () => {
    for (const p of piecesFromText('A b\n\n- c\n- d\n\n3. e')) assert.equal(typeof toInline(p.runs), 'string');
  });
  // A chunk that mixes prose lines and list lines (no blank line between them) splits
  // at the boundary: prose → paragraph, consecutive marker lines → list items.
  const MIXED = [
    ['lead-in line then bullets → paragraph + bullet list', 'Intro:\n- a\n- b',
      [P('Intro:'), LI('bullet', 'a'), LI('bullet', 'b')]],
    ['lead-in line then "1." items → paragraph + numbered list', 'Steps:\n1. one\n2. two',
      [P('Steps:'), LI('number', 'one'), LI('number', 'two')]],
    ['lead-in line then "1)" items → paragraph + numbered list', 'Steps:\n1) one\n2) two',
      [P('Steps:'), LI('number', 'one'), LI('number', 'two')]],
    ['bullets only → exactly one bulleted list, nothing else', '- a\n- b',
      [LI('bullet', 'a'), LI('bullet', 'b')]],
    ['bullets then a trailing prose line → bullet list + paragraph', '- a\n- b\nAfter',
      [LI('bullet', 'a'), LI('bullet', 'b'), P('After')]],
    ['lead-in, blank line, bullet → paragraph + list (unchanged)', 'Intro:\n\n- a',
      [P('Intro:'), LI('bullet', 'a')]],
    ['no list lines → one joined paragraph (regression, as before the split)', 'Just a line\nanother line',
      [P('Just a line another line')]],
  ];
  for (const [name, input, want] of MIXED) {
    test('paste-text', `mixed chunk: ${name}`, () => {
      const got = piecesFromText(input);
      assert.deepStrictEqual(got.map((p) => (p.kind === 'li' ? p : { kind: p.kind, runs: p.runs })), want);
    });
  }

  // ======================================================== 7. new blocks
  const SHAPES = {
    paragraph: ['text'], lead: ['text'], quote: ['text', 'cite'], pullquote: ['text', 'cite'],
    heading: ['level', 'text', 'size', 'anchor'], list: ['style', 'items'],
    image: ['src', 'alt', 'caption', 'credit', 'width', 'align', 'size', 'patient'], gallery: ['images', 'caption'],
    imageText: ['image', 'side', 'text'], callout: ['tone', 'title', 'text'], takeaways: ['title', 'items'],
    divider: [], table: ['caption', 'header', 'rows'], video: ['source', 'src', 'youtube', 'caption'],
    faq: ['title', 'items'], cta: ['kind', 'label', 'text'],
  };
  const isInline = (v) => typeof v === 'string' || Array.isArray(v);
  test('blocks', 'the contract table and content-rules agree on the 16 block types', () => {
    assert.deepStrictEqual([...RULES.BLOCK_TYPES].sort(), Object.keys(SHAPES).sort());
  });
  for (const type of RULES.BLOCK_TYPES) {
    test('blocks', `newBlock('${type}') has its type and only contract fields`, () => {
      const b = newBlock(type, []);
      assert.equal(b.type, type);
      for (const k of Object.keys(b)) if (k !== 'type') assert.ok(SHAPES[type].includes(k), `${type}.${k}`);
    });
  }
  test('blocks', 'newBlock field shapes and enums match the contract', () => {
    const b = (t) => newBlock(t, []);
    for (const t of ['paragraph', 'lead', 'quote', 'callout']) assert.ok(isInline(b(t).text), t);
    assert.equal(typeof b('pullquote').text, 'string');
    assert.ok([2, 3].includes(b('heading').level));
    assert.equal(typeof b('heading').text, 'string');
    assert.ok(E.listStyle.includes(b('list').style));
    assert.ok(b('list').items.length >= 1 && b('list').items.every(isInline));
    assert.ok(b('takeaways').items.length >= 1 && b('takeaways').items.every(isInline));
    const img = b('image');
    assert.ok(typeof img.src === 'string' && typeof img.alt === 'string');
    assert.ok(E.imageWidth.includes(img.width) && E.imageAlign.includes(img.align));
    const g = b('gallery');
    assert.ok(g.images.length >= 2 && g.images.length <= 3);
    for (const im of g.images) assert.ok(typeof im.src === 'string' && typeof im.alt === 'string');
    const it = b('imageText');
    assert.ok(typeof it.image.src === 'string' && E.side.includes(it.side) && Array.isArray(it.text) && it.text.every(isInline));
    assert.ok(E.calloutTone.includes(b('callout').tone));
    const tb = b('table');
    assert.ok(tb.header.length >= 1 && tb.header.every((h) => typeof h === 'string'));
    assert.ok(tb.rows.length >= 1 && tb.rows.every((r) => r.length === tb.header.length && r.every(isInline)));
    const f = b('faq');
    assert.ok(f.items.length >= 1 && f.items.every((x) => typeof x.q === 'string' && isInline(x.a)));
    assert.ok(E.ctaKind.includes(b('cta').kind));
    assert.deepStrictEqual(b('divider'), { type: 'divider' });
  });
  test('blocks', 'newBlock video: site film when films exist, else YouTube', () => {
    const films = readJson('data/films.json');
    const withFilms = newBlock('video', Array.isArray(films) ? films : [{ src: 'x' }]);
    assert.equal(withFilms.source, 'film');
    assert.equal(typeof withFilms.src, 'string');
    for (const none of [[], undefined, null]) {
      const v = newBlock('video', none);
      assert.equal(v.source, 'youtube');
      assert.equal(typeof v.youtube, 'string');
    }
  });
  test('blocks', 'newBlock(unknown) falls back to an empty paragraph', () => {
    assert.deepStrictEqual(newBlock('marquee'), { type: 'paragraph', text: '' });
    assert.deepStrictEqual(newBlock(undefined), { type: 'paragraph', text: '' });
  });
  test('blocks', 'newBlock returns fresh objects (no shared arrays between blocks)', () => {
    for (const type of RULES.BLOCK_TYPES) {
      const a = newBlock(type, []);
      const b = newBlock(type, []);
      assert.notStrictEqual(a, b);
      for (const k of Object.keys(a)) if (a[k] && typeof a[k] === 'object') assert.notStrictEqual(a[k], b[k], `${type}.${k}`);
    }
    const t1 = newBlock('table');
    t1.rows[0][0] = 'x';
    t1.header.push('h');
    assert.deepStrictEqual(newBlock('table'), { type: 'table', header: ['', ''], rows: [['', ''], ['', '']] });
  });

  // ============================================ 8. cites / run-array walking
  const NESTED = [
    { type: 'paragraph', text: [{ t: 'a' }, { cite: 'r1' }] },
    { type: 'heading', level: 2, text: 'Plain heading' },
    { type: 'list', style: 'bullet', items: ['plain', [{ t: 'b' }, { cite: 'r2' }, { cite: 'r1' }]] },
    { type: 'table', header: ['A', 'B'], rows: [['x', [{ t: 'y' }, { cite: 'r3' }]]] },
    { type: 'faq', items: [{ q: 'Q?', a: [{ cite: 'r1' }] }] },
    { type: 'imageText', image: { src: 'a.webp', alt: 'A' }, side: 'left', text: [[{ t: 'p', b: true }, { cite: 'r2' }], 'q'] },
    { type: 'gallery', images: [{ src: 'a', alt: 'A' }, { src: 'b', alt: 'B' }], caption: [{ cite: 'r3' }] },
    { type: 'video', source: 'youtube', youtube: ID, caption: [{ t: 'c' }, { cite: 'r1' }] },
  ];
  test('cites', 'citeCounts counts cites at every nesting depth', () => {
    assert.deepStrictEqual(Object.fromEntries(citeCounts(NESTED)), { r1: 4, r2: 2, r3: 2 });
  });
  test('cites', 'citeCounts of blocks without cites is empty', () => {
    assert.equal(citeCounts([{ type: 'paragraph', text: 'x' }, { type: 'divider' }]).size, 0);
    assert.equal(citeCounts([]).size, 0);
  });
  test('cites', 'adjacent citations stay two separate runs (rendered "1,2")', () => {
    const r = toInline(normRuns([{ t: 'Heal' }, { cite: 'r1' }, { cite: 'r2' }]));
    assert.deepStrictEqual(r, [{ t: 'Heal' }, { cite: 'r1' }, { cite: 'r2' }]);
  });
  test('cites', 'mapRunArrays rewrites run arrays only; strings and other arrays pass through', () => {
    const seen = [];
    const out = mapRunArrays(NESTED, (runs) => { seen.push(runs.length); return 'R'; });
    assert.equal(seen.length, 7);
    assert.equal(out[0].text, 'R');
    assert.equal(out[1].text, 'Plain heading');
    assert.deepStrictEqual(out[2].items, ['plain', 'R']);
    assert.deepStrictEqual(out[3].header, ['A', 'B']);
    assert.deepStrictEqual(out[3].rows, [['x', 'R']]);
    assert.equal(out[4].items[0].q, 'Q?');
    assert.deepStrictEqual(out[5].image, { src: 'a.webp', alt: 'A' });
    assert.deepStrictEqual(out[6].images, NESTED[6].images);
  });
  test('cites', 'removing a reference via mapRunArrays drops only that cite', () => {
    const out = mapRunArrays(NESTED, (runs) => toInline(runs.filter((r) => !(r.cite === 'r1'))));
    assert.equal(citeCounts(out).get('r1'), undefined);
    assert.equal(citeCounts(out).get('r2'), 2);
    assert.equal(out[0].text, 'a');
    assert.deepStrictEqual(out[4].items[0].a, '');
  });
  test('cites', 'mapRunArrays does not mutate its input', () => {
    const before = JSON.stringify(NESTED);
    mapRunArrays(NESTED, () => []);
    assert.equal(JSON.stringify(NESTED), before);
  });

  // ------------------------------------------------------------ summary
  if (process.env.MV_TEST_AREAS) console.error([...areas].map(([a, n]) => `${a}=${n}`).join(' '));
  console.log(`blog-editor: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(`blog-editor: could not load admin/blog-editor.js — ${err && err.stack}`);
  console.log('blog-editor: 0 passed, 1 failed');
  process.exit(1);
});
