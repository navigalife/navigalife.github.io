#!/usr/bin/env node
// Tests for admin/blog-blocks.js — the XSS boundary and the one renderer of a
// post body. Plain node, no framework: `node tools/test/blog-blocks.test.js`
// prints one line per failure and exits non-zero if anything failed.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const FILE = path.join(ROOT, 'admin/blog-blocks.js');
const B = require(FILE);
const { renderBlocks, renderInline, headingsOf, plainText, readingMinutes, slugify, BLOCK_TYPES } = B;

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

// ---------- fixtures ----------
const FILMS = [
  { src: 'assets/conditions/severity-b.mp4', poster: 'assets/conditions/severity-b.jpg', caption: 'Recovered in 90 days.' },
];
const REFS = [
  { id: 'r1', text: 'IWGDF 2023', url: 'https://iwgdfguidelines.org/' },
  { id: 'r2', text: 'NICE NG19', url: 'https://www.nice.org.uk/guidance/ng19' },
  { id: 'r3', text: 'Third', url: '' },
];
const CONTACT = {
  whatsapp: 'https://wa.me/919999999999?text=Hi',
  call: 'tel:+919999999999',
  email: 'mailto:care@medivasc.in',
  contact: '../../#contact',
};
const OPTS = { depth: '../../', films: FILMS, references: REFS, contactHref: CONTACT };
const render = (blocks, opts = OPTS) => renderBlocks(blocks, opts);
const one = (block, opts) => render([block], opts);
const count = (hay, needle) => hay.split(needle).length - 1;

// Structural HTML check: every '<' opens a well-formed tag from the renderer's
// vocabulary, every attribute is a bare name or name="value" with no stray quote,
// no attribute is an event handler or style, and no URL attribute carries a
// dangerous scheme. Escaped payload text (inside text or attribute values) is
// inert, so this checks the markup, not the words.
const TAGS = new Set(('p a strong em mark sup span br h2 h3 ul ol li figure figcaption blockquote cite img div aside svg path ' +
  'circle rect hr table thead tbody tr th td video source details summary section').split(' '));
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>"'\/<]+(?:="[^"<>]*")?)*)\s*\/?>/g;
const ATTR_RE = /\s+([^\s=>"'\/<]+)(?:="([^"<>]*)")?/g;
const decode = (v) => v.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const safeHtml = (html) => {
  const problems = [];
  const rest = html.replace(TAG_RE, (tag, name, attrs) => {
    if (!TAGS.has(name.toLowerCase())) problems.push(`tag <${name}>`);
    for (const m of attrs.matchAll(ATTR_RE)) {
      const attr = m[1].toLowerCase();
      const val = decode(m[2] || '');
      if (/^on/.test(attr) || ['style', 'srcdoc', 'formaction'].includes(attr)) problems.push(`attr ${attr} on <${name}>`);
      if (['href', 'src', 'poster', 'srcset', 'action', 'xlink:href'].includes(attr) && /^\s*(?:javascript|vbscript|data|http):|^\s*\/\//i.test(val)) {
        problems.push(`${attr}="${val.slice(0, 40)}"`);
      }
    }
    return '';
  });
  const at = rest.search(/[<>]/);
  if (at !== -1) problems.push(`stray markup: ${rest.slice(Math.max(0, at - 20), at + 40)}`);
  return problems;
};
const assertSafe = (html, label = '') => {
  const problems = safeHtml(html);
  assert.deepEqual(problems, [], `${label} ${problems.join(' | ')}`);
};

// One valid example of every block type.
const IMG = { src: 'assets/blog/x/a.webp', alt: 'A foot' };
const EXAMPLES = {
  paragraph: { type: 'paragraph', text: 'Hello world.' },
  lead: { type: 'lead', text: 'Intro.' },
  heading: { type: 'heading', level: 2, text: 'Warning signs' },
  list: { type: 'list', style: 'bullet', items: ['One', 'Two'] },
  quote: { type: 'quote', text: 'Walk daily.', cite: 'Dr A' },
  pullquote: { type: 'pullquote', text: 'Feet first.', cite: 'Team' },
  image: { type: 'image', ...IMG, caption: 'Cap', credit: 'MediVasc', width: 'column', align: 'center' },
  gallery: { type: 'gallery', images: [IMG, { src: 'assets/blog/x/b.webp', alt: 'B' }, { src: 'assets/blog/x/c.webp', alt: 'C' }], caption: 'Three' },
  imageText: { type: 'imageText', image: IMG, side: 'right', text: ['Para one.', 'Para two.'] },
  callout: { type: 'callout', tone: 'doctor', text: 'See a doctor.' },
  takeaways: { type: 'takeaways', items: ['Check daily.'] },
  divider: { type: 'divider' },
  table: { type: 'table', caption: 'Log', header: ['Day', 'Note'], rows: [['Mon', 'Fine']] },
  video: { type: 'video', source: 'youtube', youtube: 'dQw4w9WgXcQ', caption: 'Watch' },
  faq: { type: 'faq', items: [{ q: 'Why?', a: 'Because.' }] },
  cta: { type: 'cta', kind: 'whatsapp', text: 'Talk to us' },
};
const CLASS_OF = {
  paragraph: 'b-p', lead: 'b-lead', heading: 'b-heading', list: 'b-list', quote: 'b-quote', pullquote: 'b-pullquote',
  image: 'b-image', gallery: 'b-gallery', imageText: 'b-imagetext', callout: 'b-callout', takeaways: 'b-takeaways',
  divider: 'b-divider', table: 'b-table', video: 'b-video', faq: 'b-faq', cta: 'b-cta',
};

// =====================================================================
// API shape
// =====================================================================
test('exports the contract API, frozen', () => {
  for (const k of ['renderBlocks', 'renderInline', 'headingsOf', 'plainText', 'readingMinutes', 'slugify']) assert.equal(typeof B[k], 'function', k);
  assert.ok(Object.isFrozen(B));
  assert.ok(Object.isFrozen(BLOCK_TYPES));
  assert.deepEqual([...BLOCK_TYPES].sort(), Object.keys(EXAMPLES).sort());
});

test('UMD: a classic-script load sets globalThis.MediVascBlogBlocks', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), ctx, { filename: 'blog-blocks.js' });
  const g = vm.runInContext('globalThis.MediVascBlogBlocks', ctx);
  assert.ok(g && typeof g.renderBlocks === 'function');
  assert.equal(g.slugify('Hello World'), 'hello-world');
});

test('no Node built-ins or imports in the module (it ships to the browser)', () => {
  const src = fs.readFileSync(FILE, 'utf8').replace(/^\s*\/\/.*$/gm, ''); // header comments show usage
  assert.ok(!/\brequire\s*\(/.test(src), 'require(');
  assert.ok(!/^\s*(?:import|export)\s/m.test(src), 'import/export');
});

// =====================================================================
// Every block type renders
// =====================================================================
for (const type of BLOCK_TYPES) {
  test(`block ${type} renders with its class`, () => {
    const html = one(EXAMPLES[type]);
    assert.ok(html.length > 0, 'empty output');
    assert.ok(new RegExp(`class="[^"]*\\b${CLASS_OF[type]}\\b`).test(html), `missing .${CLASS_OF[type]}: ${html.slice(0, 160)}`);
  });
}

test('all block types together render in order, joined by newlines', () => {
  const html = render(BLOCK_TYPES.map((t) => EXAMPLES[t]));
  let at = -1;
  for (const t of BLOCK_TYPES) {
    const i = html.indexOf(CLASS_OF[t], at + 1);
    assert.ok(i > at, `${t} out of order`);
    at = i;
  }
  assert.equal(html.split('\n').length, BLOCK_TYPES.length);
});

test('every sample post renders without throwing; its anchors are unique ids in the page', () => {
  const samples = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/blog/samples.json'), 'utf8'));
  assert.ok(samples.length > 0);
  for (const p of samples) {
    const html = renderBlocks(p.blocks, { depth: '../../', films: FILMS, references: p.references, contactHref: CONTACT });
    assert.ok(html.length > 200, p.slug);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${p.slug}: duplicate ids`);
    for (const h of headingsOf(p.blocks)) assert.ok(ids.includes(h.anchor), `${p.slug}: ${h.anchor} not in page`);
  }
});

// =====================================================================
// Security: escaping
// =====================================================================
test('safeHtml checker flags real injections and passes inert text (guards the guard)', () => {
  assert.deepEqual(safeHtml('<p class="b-p">ok &lt;script&gt;</p><img alt="x onerror=1" src="a">'), []);
  for (const bad of ['<img src=x onerror=alert(1)>', '<img alt="x" onload="y">', '<a href="javascript:x">', '<a href="&#106;avascript:x">',
    '<script>x</script>', '<p title="a"b">', '<p>a < b</p>', '<iframe src="https://x">', '<a href="//evil.com">', '<p style="x">']) {
    assert.ok(safeHtml(bad).length, bad);
  }
});
const EVIL = `<img src=x onerror=alert(1)>"'\`&<script>alert(2)</script>`;
const evilEverywhere = () => {
  const img = { src: 'assets/blog/x/a.webp', alt: EVIL, caption: EVIL, patient: true };
  return [
    { type: 'paragraph', text: EVIL },
    { type: 'paragraph', text: [{ t: EVIL, b: true, i: true, hl: true, href: 'https://example.com/' }] },
    { type: 'lead', text: [EVIL, { t: EVIL }] },
    { type: 'heading', level: 2, text: EVIL, anchor: EVIL },
    { type: 'heading', level: 3, text: EVIL },
    { type: 'list', style: 'number', items: [EVIL, [{ t: EVIL }]] },
    { type: 'quote', text: EVIL, cite: EVIL },
    { type: 'pullquote', text: EVIL, cite: EVIL },
    { type: 'image', ...img, credit: EVIL, width: 'wide', align: 'center' },
    { type: 'image', ...img, credit: EVIL, align: 'left', size: 'S' },
    { type: 'gallery', images: [img, img], caption: EVIL },
    { type: 'imageText', image: img, side: 'left', text: [EVIL, EVIL] },
    { type: 'callout', tone: 'tip', title: EVIL, text: EVIL },
    { type: 'takeaways', title: EVIL, items: [EVIL] },
    { type: 'table', caption: EVIL, header: [EVIL, EVIL], rows: [[EVIL, [{ t: EVIL, href: 'https://example.com/' }]]] },
    { type: 'video', source: 'youtube', youtube: 'dQw4w9WgXcQ', caption: EVIL },
    { type: 'video', source: 'film', src: FILMS[0].src, caption: EVIL },
    { type: 'faq', title: EVIL, items: [{ q: EVIL, a: EVIL }] },
    { type: 'cta', kind: 'call', label: EVIL, text: EVIL },
  ];
};

test('escaping: no raw markup from any field reaches the output', () => {
  const html = render(evilEverywhere());
  assertSafe(html);
  assert.ok(!/<script/i.test(html), '<script');
  assert.ok(!/<img src=x/i.test(html), 'raw <img');
  assert.ok(!html.includes('alert(2)</script>'), 'raw script body');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped text present');
});

test('escaping: every field that renders text carries the escaped payload', () => {
  const blocks = evilEverywhere();
  for (const b of blocks) {
    const html = one(b);
    assert.ok(html.length, `${b.type} rendered nothing`);
    assertSafe(html, b.type);
    assert.ok(html.includes('&lt;script&gt;') || html.includes('&lt;img'), `${b.type}: payload not escaped/present`);
  }
});

test('escaping: & < > " \' ` all become entities in text', () => {
  const html = renderInline('a & b < c > d " e \' f ` g', OPTS);
  assert.equal(html, 'a &amp; b &lt; c &gt; d &quot; e &#39; f &#96; g');
});

test('escaping: author line breaks become <br>, nothing else', () => {
  assert.equal(renderInline('one\r\ntwo\nthree', OPTS), 'one<br>two<br>three');
});

test('attributes: alt text can never close its quoted attribute', () => {
  const html = one({ type: 'image', src: 'assets/blog/x/a.webp', alt: 'x" onload="alert(1)' });
  assertSafe(html);
  const alt = /alt="([^"]*)"/.exec(html);
  assert.ok(alt && !alt[1].includes('"'));
});

test('attributes: a helper img() that ignores escaping still cannot be broken out of', () => {
  const naive = (src, o) => `<img src="${src}" alt="${o.alt}" sizes="${o.sizes}">`;
  const html = one({ type: 'image', src: 'assets/blog/x/a.webp', alt: 'x" onerror="alert(1)' }, { ...OPTS, img: naive });
  assertSafe(html);
  assert.ok(html.includes('alt="x” onerror=”alert(1)"'));
});

test('attributes: an img() helper returning non-<img> markup is ignored (fallback img)', () => {
  const bad = () => '<img src=x><script>alert(1)</script>';
  const html = one({ type: 'image', src: 'assets/blog/x/a.webp', alt: 'A' }, { ...OPTS, img: bad });
  assert.ok(!/<script/.test(html));
  assert.ok(html.includes('src="../../assets/blog/x/a.webp"'));
});

test('heading anchors from author input are slugged (no quotes, no spaces)', () => {
  const html = one({ type: 'heading', text: 'Hi', anchor: '" onclick="x' });
  assert.ok(/id="onclick-x"/.test(html), html);
});

test('inline runs honour only b/i/hl/href/cite (unknown marks are ignored)', () => {
  const html = renderInline([{ t: 'x', style: 'color:red', onclick: 'a()', class: 'evil', html: '<b>' }], OPTS);
  assert.equal(html, 'x');
});

test('inline: an HTML string is not treated as markup even inside an array', () => {
  assert.equal(renderInline(['<em>x</em>'], OPTS), '&lt;em&gt;x&lt;/em&gt;');
});

test('inline: marks render as strong/em/mark with only truthy-true flags', () => {
  assert.equal(renderInline([{ t: 'x', b: true, i: true, hl: true }], OPTS), '<strong><em><mark class="b-hl">x</mark></em></strong>');
  assert.equal(renderInline([{ t: 'x', b: 'yes', i: 1 }], OPTS), 'x');
});

// =====================================================================
// Security: href allowlist
// =====================================================================
const linkOf = (href, depth = '../../') => renderInline([{ t: 'go', href }], { ...OPTS, depth });
const hrefOf = (html) => {
  const m = /<a [^>]*href="([^"]*)"/.exec(html);
  return m ? m[1] : null;
};

const ALLOWED = [
  ['https://example.com/', 'https://example.com/'],
  ['https://example.com/a?b=1&c=2#d', 'https://example.com/a?b=1&amp;c=2#d'],
  ['HTTPS://Example.com/x', 'https://Example.com/x'],
  ['mailto:care@medivasc.in', 'mailto:care@medivasc.in'],
  ['mailto:care@medivasc.in?subject=Hi', 'mailto:care@medivasc.in?subject=Hi'],
  ['tel:+919999999999', 'tel:+919999999999'],
  ['tel:011-2345-6789', 'tel:011-2345-6789'],
  ['blog/diabetic-foot-warning-signs/', '../../blog/diabetic-foot-warning-signs/'],
  ['blog/diabetic-foot-warning-signs/#key-takeaways', '../../blog/diabetic-foot-warning-signs/#key-takeaways'],
  ['blog/category/diabetic-foot/', '../../blog/category/diabetic-foot/'],
  ['blog/author/medivasc-care-team/', '../../blog/author/medivasc-care-team/'],
  ['blog/', '../../blog/'],
  ['#key-takeaways', '#key-takeaways'],
  ['  https://example.com/  ', 'https://example.com/'],
  ['https://example.com/\u00a0', 'https://example.com/'], // a pasted NBSP is trimmed, harmlessly
];
for (const [input, out] of ALLOWED) {
  test(`href allowed: ${JSON.stringify(input)}`, () => assert.equal(hrefOf(linkOf(input)), out));
}

const DROPPED = [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', '\tjavascript:alert(1)', 'java\tscript:alert(1)',
  'java\nscript:alert(1)', 'java\u0000script:alert(1)', 'javascript&colon;alert(1)', '&#106;avascript:alert(1)',
  '&#x6A;avascript:alert(1)', 'jav&#x09;ascript:alert(1)', 'javascript%3Aalert(1)', 'vbscript:msgbox(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'data:image/png;base64,AAAA', '//evil.com', '//evil.com/blog/x/',
  '\\\\evil.com', '/\\evil.com', 'http://example.com/', 'HTTP://example.com/', 'ftp://example.com/', 'file:///etc/passwd',
  'https://exa mple.com/', 'https:// example.com', 'https://example.com/\njavascript:x', 'https://example.com/"onmouseover="x',
  "https://example.com/'x", 'https://example.com/<x>', 'https:/example.com', 'https:example.com', 'https://localhost/',
  'https://evil.com\u2028/', '/blog/x/', 'blog/../admin/', 'blog/x/../../admin/', 'blog/Bad_Slug/',
  'blog/x', 'admin/', '../admin/', '#', '#1abc', '# x', '#a"b', 'tel:', 'tel:abc', 'mailto:', 'mailto:no-at-sign',
  'mailto:a@b.com\nbcc:x@y.com', 'mailto:javascript:alert(1)//@x.com', '', '   ',
];
for (const input of DROPPED) {
  test(`href dropped: ${JSON.stringify(input)}`, () => {
    const html = linkOf(input);
    assert.equal(hrefOf(html), null, html);
    assert.equal(html, 'go', 'link text must still render as plain text');
  });
}

test('href: non-string values are dropped', () => {
  for (const v of [null, 1, true, {}, ['https://x.com/'], { toString: () => 'https://x.com/' }]) {
    assert.equal(renderInline([{ t: 'go', href: v }], OPTS), 'go');
  }
});

test('href: over-long URLs are dropped', () => {
  assert.equal(linkOf(`https://example.com/${'a'.repeat(2100)}`), 'go');
});

test('href: internal links take the page depth; a bad depth collapses to ""', () => {
  assert.equal(hrefOf(linkOf('blog/x/', '../')), '../blog/x/');
  assert.equal(hrefOf(linkOf('blog/x/', '../../../')), '../../../blog/x/');
  assert.equal(hrefOf(linkOf('blog/x/', 'https://evil.com/')), 'blog/x/');
  assert.equal(hrefOf(linkOf('blog/x/', '/')), 'blog/x/');
});

test('external links get rel=noopener + target=_blank + an sr-only new-tab note', () => {
  const html = linkOf('https://example.com/');
  assert.ok(/rel="[^"]*\bnoopener\b[^"]*"/.test(html), html);
  assert.ok(/target="_blank"/.test(html));
  assert.ok(html.includes('(opens in a new tab)'));
});

test('own-site https, internal, anchor, mailto and tel links open in place', () => {
  for (const h of ['https://medivasc.in/blog/', 'https://www.medivasc.in/', 'blog/x/', '#a', 'mailto:a@b.co', 'tel:+911234567']) {
    const html = linkOf(h);
    assert.ok(hrefOf(html), h);
    assert.ok(!/target=/.test(html) && !/rel=/.test(html), `${h}: ${html}`);
  }
});

test('a look-alike of our host is still external', () => {
  assert.ok(/target="_blank"/.test(linkOf('https://medivasc.in.evil.com/')));
  assert.ok(/target="_blank"/.test(linkOf('https://notmedivasc.in/')));
});

test('adjacent runs with the same href share one <a>; different hrefs split', () => {
  const same = renderInline([{ t: 'a', href: 'blog/x/' }, { t: 'b', b: true, href: 'blog/x/' }], OPTS);
  assert.equal(count(same, '<a '), 1);
  assert.equal(same, '<a class="b-a" href="../../blog/x/">a<strong>b</strong></a>');
  const diff = renderInline([{ t: 'a', href: 'blog/x/' }, { t: 'b', href: 'blog/y/' }], OPTS);
  assert.equal(count(diff, '<a '), 2);
});

test('CTA: build-supplied contact hrefs are checked too (bad route falls back)', () => {
  const html = one({ type: 'cta', kind: 'whatsapp' }, { ...OPTS, contactHref: { whatsapp: 'javascript:alert(1)', email: 'mailto:care@medivasc.in', contact: '../../#contact' } });
  assert.ok(!/javascript:/i.test(html));
  assert.ok(html.includes('href="mailto:care@medivasc.in"'));
  assert.ok(html.includes('data-kind="email"'));
  const none = one({ type: 'cta', kind: 'contact' }, { ...OPTS, contactHref: { contact: '//evil.com', email: 'data:text/html,x' } });
  assert.equal(none, '');
});

test('CTA: an external route gets rel/target; the custom label only applies to the asked-for route', () => {
  const wa = one({ type: 'cta', kind: 'whatsapp', label: 'Chat now' });
  assert.ok(/rel="[^"]*noopener/.test(wa) && /target="_blank"/.test(wa));
  assert.ok(wa.includes('<span>Chat now</span>'));
  const fallback = one({ type: 'cta', kind: 'call', label: 'Ring us' }, { ...OPTS, contactHref: { whatsapp: CONTACT.whatsapp } });
  assert.ok(fallback.includes('data-kind="whatsapp"') && !fallback.includes('Ring us'));
});

test('CTA: data-bare when there is no text', () => {
  assert.ok(one({ type: 'cta', kind: 'call' }).includes('data-bare'));
  assert.ok(!one({ type: 'cta', kind: 'call', text: 'Hi' }).includes('data-bare'));
});

// =====================================================================
// Security: media sources
// =====================================================================
test('image src must be a repo-relative assets/ image path', () => {
  const ok = one({ type: 'image', src: 'assets/blog/x/a.webp', alt: 'a' });
  assert.ok(ok.includes('src="../../assets/blog/x/a.webp"'));
  for (const src of ['https://evil.com/a.webp', '/assets/a.webp', '../assets/a.webp', 'assets/../admin/a.webp', 'assets/a.webp?x=1',
    'assets/a.svg', 'assets/a.html', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'assets/a b.webp', 'assets/"x.webp', 'draft:abc.webp']) {
    assert.equal(one({ type: 'image', src, alt: 'a' }), '', src);
  }
});

test('gallery drops invalid images and caps at three', () => {
  const html = one({ type: 'gallery', images: [IMG, { src: 'https://evil.com/x.webp' }, IMG, IMG, IMG] });
  assert.equal(count(html, '<img'), 3);
  assert.ok(html.includes('data-n="3"'));
  assert.equal(one({ type: 'gallery', images: [{ src: 'javascript:x' }] }), '');
});

test('YouTube id is strictly 11 chars of [A-Za-z0-9_-]', () => {
  const ok = one({ type: 'video', source: 'youtube', youtube: 'a-B_c1D2e3F' });
  assert.ok(ok.includes('href="https://www.youtube.com/watch?v=a-B_c1D2e3F"'));
  assert.ok(ok.includes('data-yt="a-B_c1D2e3F"'));
  assert.ok(ok.includes('src="https://i.ytimg.com/vi/a-B_c1D2e3F/hqdefault.jpg"'));
  for (const id of ['dQw4w9WgXc', 'dQw4w9WgXcQQ', 'dQw4w9WgXc"', 'dQw4w9WgX<Q', 'dQw4w9 gXcQ', '../../../xx', 'dQw4w9WgXcQ\n',
    ' dQw4w9WgXcQ', 'dQw4w9WgXc.', 'dQw4w9WgXc%', 'dQw4w9WgXcé', '', null, 12345678901, ['dQw4w9WgXcQ']]) {
    assert.equal(one({ type: 'video', source: 'youtube', youtube: id }), '', JSON.stringify(id));
  }
});

test('YouTube facade is the no-JS link the contract pins (thumbnail, external)', () => {
  const html = one({ type: 'video', source: 'youtube', youtube: 'dQw4w9WgXcQ', caption: 'Walking test' });
  assert.ok(/<a class="yt" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ" data-yt="dQw4w9WgXcQ"/.test(html), html);
  assert.ok(/rel="[^"]*noopener/.test(html) && /target="_blank"/.test(html));
  assert.ok(html.includes('Play video: Walking test (YouTube)'));
  assert.ok(!/<iframe/.test(html), 'no iframe before a click');
});

test('film video renders only for a src listed in films, depth-prefixed, with its poster', () => {
  const html = one({ type: 'video', source: 'film', src: FILMS[0].src });
  assert.ok(html.includes('<source src="../../assets/conditions/severity-b.mp4" type="video/mp4">'), html);
  assert.ok(html.includes('poster="../../assets/conditions/severity-b.jpg"'));
  assert.ok(/<video controls preload="none" playsinline/.test(html));
  assert.ok(html.includes('Recovered in 90 days.'), 'falls back to the film caption');
  assert.ok(one({ type: 'video', source: 'film', src: FILMS[0].src, caption: 'Own' }).includes('>Own<'));
  for (const src of ['assets/conditions/other.mp4', 'https://evil.com/a.mp4', '../assets/conditions/severity-b.mp4', 'assets/conditions/severity-b.mp4?x', '']) {
    assert.equal(one({ type: 'video', source: 'film', src }), '', src);
  }
  assert.equal(one({ type: 'video', source: 'film', src: FILMS[0].src }, { ...OPTS, films: undefined }), '');
});

test('video with an unknown source renders nothing', () => {
  assert.equal(one({ type: 'video', source: 'vimeo', src: 'x' }), '');
  assert.equal(one({ type: 'video' }), '');
});

// =====================================================================
// Unknown / malformed input is skipped safely
// =====================================================================
test('unknown block types are skipped; neighbours still render', () => {
  const html = render([
    { type: 'script', text: '<script>x</script>' }, { type: 'html', html: '<b>x</b>' }, { type: '__proto__' },
    { type: 'constructor' }, { type: 'toString' }, { type: 'hasOwnProperty' }, { type: 'Paragraph', text: 'x' },
    { type: 1 }, { type: null }, {}, null, undefined, 'paragraph', 42, ['paragraph'],
    EXAMPLES.paragraph,
  ]);
  assert.equal(html, '<p class="b-p" data-first>Hello world.</p>');
});

test('non-array blocks / missing opts never throw', () => {
  for (const v of [undefined, null, {}, 'x', 1, { length: 2 }]) assert.equal(renderBlocks(v, OPTS), '');
  assert.ok(renderBlocks([EXAMPLES.paragraph]).includes('Hello world.'));
  assert.ok(renderBlocks([EXAMPLES.paragraph], null).includes('Hello world.'));
  assert.deepEqual(headingsOf(null), []);
  assert.equal(renderInline(null), '');
  assert.equal(renderInline(42), '');
});

test('malformed fields inside known blocks degrade to nothing, not a throw', () => {
  const blocks = BLOCK_TYPES.map((type) => ({ type, text: { evil: 1 }, items: 'x', images: 5, image: 'x', rows: [5, null, 'x'], header: 'x', level: '__proto__', style: {}, tone: 'evil', kind: 'evil', source: {}, youtube: {}, caption: 7, title: {}, cite: [] }));
  assert.doesNotThrow(() => render(blocks));
  const getter = { type: 'paragraph' };
  Object.defineProperty(getter, 'text', { get() { throw new Error('boom'); }, enumerable: true });
  assert.ok(render([getter, EXAMPLES.lead]).includes('Intro.'), 'a throwing block does not take the page down');
});

test('prototype pollution keys in runs are inert', () => {
  const run = JSON.parse('{"t":"x","__proto__":{"b":true,"href":"javascript:alert(1)"}}');
  assert.equal(renderInline([run], OPTS), 'x');
});

// =====================================================================
// Citations
// =====================================================================
test('cites number by reference index and count occurrences per id', () => {
  const html = render([
    { type: 'paragraph', text: ['A', { cite: 'r2' }, ' B', { cite: 'r1' }] },
    { type: 'paragraph', text: ['C', { cite: 'r2' }] },
    { type: 'list', items: [['D', { cite: 'r2' }, { cite: 'r3' }]] },
  ]);
  assert.ok(html.includes('<sup class="cite"><a href="#ref-r2" id="cite-r2-1" aria-label="Reference 2">2</a></sup>'), html);
  assert.ok(html.includes('<a href="#ref-r1" id="cite-r1-1" aria-label="Reference 1">1</a>'));
  assert.ok(html.includes('id="cite-r2-2"'));
  assert.ok(html.includes('id="cite-r2-3"'));
  assert.ok(html.includes('id="cite-r3-1" aria-label="Reference 3">3</a>'));
  assert.ok(!html.includes('cite-r2-4'));
});

test('adjacent cites get a separator; a cite after text does not', () => {
  const html = renderInline(['x', { cite: 'r1' }, { cite: 'r2' }], OPTS);
  assert.equal(count(html, 'cite-sep'), 1);
  assert.ok(html.indexOf('cite-sep') > html.indexOf('cite-r1-1') && html.indexOf('cite-sep') < html.indexOf('cite-r2-1'));
});

test('unknown / malformed cite ids render nothing (and do not count)', () => {
  assert.equal(renderInline(['x', { cite: 'r9' }, { cite: 7 }, { cite: null }, { cite: '"><script>' }], OPTS), 'x');
  assert.equal(renderInline([{ cite: 'r1' }], { depth: '' }), '', 'no references → nothing');
  const html = renderInline([{ cite: 'r9' }, { cite: 'r1' }, { cite: 'r9' }, { cite: 'r1' }], OPTS);
  assert.ok(html.includes('cite-r1-2') && !html.includes('r9'));
});

test('references with duplicate or unsafe ids keep the first, skip the unsafe', () => {
  const refs = [{ id: 'a' }, { id: 'a' }, { id: 'b"x' }, { id: 'c' }];
  const html = renderInline([{ cite: 'a' }, { cite: 'c' }, { cite: 'b"x' }], { references: refs });
  assert.ok(html.includes('aria-label="Reference 1">1<'));
  assert.ok(html.includes('aria-label="Reference 4">4<'), 'number stays the list index');
  assert.ok(!html.includes('b&quot;x') && !html.includes('b"x'));
});

test('cite runs are excluded from plain text and heading text', () => {
  assert.equal(plainText({ blocks: [{ type: 'paragraph', text: ['Walk', { cite: 'r1' }, ' daily'] }] }), 'Walk daily');
});

// =====================================================================
// data-first (lead-in)
// =====================================================================
test('data-first lands on the first paragraph or lead only', () => {
  const html = render([EXAMPLES.heading, EXAMPLES.image, EXAMPLES.lead, EXAMPLES.paragraph, EXAMPLES.paragraph]);
  assert.equal(count(html, 'data-first'), 1);
  assert.ok(/<p class="b-lead" data-first>/.test(html));
  const p = render([EXAMPLES.quote, EXAMPLES.paragraph, EXAMPLES.lead]);
  assert.ok(/<p class="b-p" data-first>/.test(p) && count(p, 'data-first') === 1);
});

test('an empty first paragraph does not swallow data-first', () => {
  const html = render([{ type: 'paragraph', text: '' }, { type: 'paragraph', text: [{ cite: 'r9' }] }, EXAMPLES.paragraph]);
  assert.equal(html, '<p class="b-p" data-first>Hello world.</p>');
});

test('paragraph-like text in other blocks never gets data-first', () => {
  const html = render([EXAMPLES.imageText, EXAMPLES.callout, EXAMPLES.quote, EXAMPLES.faq]);
  assert.equal(count(html, 'data-first'), 0);
});

// =====================================================================
// Anchors: headingsOf, dedupe, takeaways
// =====================================================================
test('headingsOf returns h2/h3, FAQ and takeaways in document order, matching rendered ids', () => {
  const blocks = [
    { type: 'heading', level: 2, text: 'Signs' },
    { type: 'heading', level: 3, text: 'Colour' },
    { type: 'takeaways', title: 'In short', items: ['x'] },
    { type: 'faq', items: [{ q: 'q', a: 'a' }] },
    { type: 'heading', level: 2, text: 'Next' },
  ];
  const hs = headingsOf(blocks);
  assert.deepEqual(hs, [
    { level: 2, text: 'Signs', anchor: 'signs', kind: 'heading' },
    { level: 3, text: 'Colour', anchor: 'colour', kind: 'heading' },
    { level: 2, text: 'In short', anchor: 'key-takeaways', kind: 'takeaways' },
    { level: 2, text: 'Questions people ask', anchor: 'questions-people-ask', kind: 'faq' },
    { level: 2, text: 'Next', anchor: 'next', kind: 'heading' },
  ]);
  const html = render(blocks);
  for (const h of hs) assert.ok(html.includes(`id="${h.anchor}"`), h.anchor);
});

test('takeaways renders as <aside id="key-takeaways"> with the default title', () => {
  const html = one({ type: 'takeaways', items: ['a', 'b'] });
  assert.ok(html.startsWith('<aside class="b-takeaways b-column" id="key-takeaways" aria-label="Key takeaways">'), html);
  assert.ok(html.includes('<p class="b-takeaways__title">Key takeaways</p>'));
  assert.equal(count(html, '<li>'), 2);
  assert.deepEqual(headingsOf([{ type: 'takeaways', items: ['a'] }]), [{ level: 2, text: 'Key takeaways', anchor: 'key-takeaways', kind: 'takeaways' }]);
});

test('takeaways keeps key-takeaways even when a heading claims it first (heading gets -2)', () => {
  const blocks = [
    { type: 'heading', text: 'Key takeaways' },
    { type: 'heading', text: 'Other', anchor: 'key-takeaways' },
    { type: 'takeaways', items: ['a'] },
    { type: 'takeaways', title: 'Again', items: ['b'] },
  ];
  assert.deepEqual(headingsOf(blocks).map((h) => h.anchor), ['key-takeaways-2', 'key-takeaways-3', 'key-takeaways', 'key-takeaways-4']);
  const html = render(blocks);
  assert.ok(/<aside class="b-takeaways b-column" id="key-takeaways"/.test(html));
  assert.ok(/<h2[^>]* id="key-takeaways-2"/.test(html));
});

test('empty takeaways (no text items) is neither rendered nor listed, and frees the id', () => {
  const blocks = [{ type: 'takeaways', items: ['', [{ cite: 'r1' }], '  '] }, { type: 'heading', text: 'Key takeaways' }];
  assert.equal(render(blocks).includes('b-takeaways'), false);
  assert.deepEqual(headingsOf(blocks).map((h) => h.anchor), ['key-takeaways']);
});

test('duplicate headings dedupe with -2, -3; FAQ titles join the same set', () => {
  const blocks = [
    { type: 'heading', text: 'Care' }, { type: 'heading', level: 3, text: 'Care' }, { type: 'heading', text: 'Care', anchor: 'care' },
    { type: 'faq', title: 'Care', items: [{ q: 'q', a: 'a' }] },
  ];
  assert.deepEqual(headingsOf(blocks).map((h) => h.anchor), ['care', 'care-2', 'care-3', 'care-4']);
});

test('reserved page ids and the ref-/cite- namespaces are never handed to a heading', () => {
  const hs = headingsOf(['References', 'Main', 'Top', 'Contact', 'Ref 1', 'Cite this', '2024 update'].map((text) => ({ type: 'heading', text })));
  assert.deepEqual(hs.map((h) => h.anchor), ['references-2', 'main-2', 'top-2', 'contact-2', 's-ref-1', 's-cite-this', 's-2024-update']);
});

test('headings with no text are skipped; symbol-only text falls back to "section"', () => {
  assert.deepEqual(headingsOf([{ type: 'heading', text: '' }, { type: 'heading', text: '   ' }]), []);
  assert.deepEqual(headingsOf([{ type: 'heading', text: '!!!' }, { type: 'heading', text: '???' }]).map((h) => h.anchor), ['section', 'section-2']);
});

test('heading level is 2 unless exactly 3; size is S|M|L with M default', () => {
  assert.ok(one({ type: 'heading', level: 3, text: 'x' }).startsWith('<h3 class="b-heading b-h3 b-h--M"'));
  assert.ok(one({ type: 'heading', level: 1, text: 'x' }).startsWith('<h2 '));
  assert.ok(one({ type: 'heading', level: 4, text: 'x', size: 'XL' }).startsWith('<h2 class="b-heading b-h2 b-h--M"'));
  assert.ok(one({ type: 'heading', text: 'x', size: 'L' }).includes('b-h--L'));
});

test('FAQ without a valid item is not rendered and not listed', () => {
  const b = { type: 'faq', items: [{ q: '', a: 'x' }, { q: 'x', a: '' }] };
  assert.equal(one(b), '');
  assert.deepEqual(headingsOf([b]), []);
});

test('FAQ renders native details/summary under an h2 that labels the section', () => {
  const html = one({ type: 'faq', items: [{ q: 'Why?', a: 'Because.' }, { q: 'How?', a: [{ t: 'See ', b: true }, { t: 'this', href: 'blog/x/' }] }] });
  assert.ok(/<section class="b-faq b-column" aria-labelledby="questions-people-ask"><h2 class="b-faq__title" id="questions-people-ask">/.test(html), html);
  assert.equal(count(html, '<details class="b-faq__item">'), 2);
  assert.ok(html.includes('<summary><span class="b-faq__q">Why?</span>'));
  assert.ok(html.includes('<a class="b-a" href="../../blog/x/">this</a>'));
});

// =====================================================================
// Layout classes the post page relies on
// =====================================================================
test('image width/float classes', () => {
  assert.ok(one({ type: 'image', ...IMG, width: 'full' }).startsWith('<figure class="b-image b-full"'));
  assert.ok(one({ type: 'image', ...IMG, width: 'wide' }).startsWith('<figure class="b-image b-wide"'));
  assert.ok(one({ type: 'image', ...IMG, width: 'nope' }).startsWith('<figure class="b-image b-column"'));
  assert.ok(one({ type: 'image', ...IMG, width: 'full', align: 'right', size: 'L' }).startsWith('<figure class="b-image b-column b-right b-size-L"'), 'floats are column-only');
  assert.ok(one({ type: 'image', ...IMG, align: 'left' }).includes('b-left b-size-M'));
});

test('patient photos are flagged data-patient (image, gallery item, imageText)', () => {
  const p = { ...IMG, patient: true };
  assert.ok(one({ type: 'image', ...p }).includes('<figure class="b-image b-column" data-patient>'));
  assert.ok(one({ type: 'gallery', images: [p, IMG] }).includes('<figure class="b-gallery__item" data-patient>'));
  assert.ok(one({ type: 'imageText', image: p, text: ['x'] }).includes('b-imagetext__media" data-patient'));
  assert.ok(!one({ type: 'image', ...IMG, patient: 'true' }).includes('data-patient'));
});

test('no block emits data-count (site.js rewrites the textContent of every [data-count])', () => {
  assert.ok(!/data-count/.test(render(BLOCK_TYPES.map((t) => EXAMPLES[t]))));
});

test('gallery: 3 images go wide, 2 stay in the column', () => {
  assert.ok(one(EXAMPLES.gallery).startsWith('<figure class="b-gallery b-wide" data-n="3">'));
  assert.ok(one({ type: 'gallery', images: [IMG, IMG] }).startsWith('<figure class="b-gallery b-column" data-n="2">'));
});

test('caption and credit render in figcaption; credit alone works', () => {
  const html = one({ type: 'image', ...IMG, caption: [{ t: 'Cap', i: true }], credit: 'Photo: X' });
  assert.ok(html.includes('<figcaption><span class="b-caption"><em>Cap</em></span><span class="b-credit">Photo: X</span></figcaption>'));
  assert.ok(one({ type: 'image', ...IMG, credit: 'X' }).includes('<figcaption><span class="b-credit">X</span></figcaption>'));
  assert.ok(!one({ type: 'image', ...IMG }).includes('figcaption'));
});

test('imageText without a valid image degrades to plain paragraphs', () => {
  assert.equal(one({ type: 'imageText', image: { src: 'https://x.com/a.webp' }, text: ['a', 'b'] }), '<p class="b-p">a</p><p class="b-p">b</p>');
});

test('table: caption sits outside the scroll region; region is focusable and named', () => {
  const html = one({ type: 'table', caption: 'Weekly log', header: ['Day', 'Sugar'], rows: [['Mon', '128'], ['Tue', [{ t: '121', b: true }]]] });
  assert.ok(html.startsWith('<figure class="b-table b-column"><figcaption class="b-table__caption">Weekly log</figcaption><div class="b-table__scroll" role="region" tabindex="0" aria-label="Weekly log"><table>'), html);
  assert.equal(count(html, '<th scope="col">'), 2);
  assert.ok(html.includes('<td><strong>121</strong></td>'));
  const bare = one({ type: 'table', header: ['A'], rows: [['1']] });
  assert.ok(bare.startsWith('<div class="b-table b-column"><div class="b-table__scroll" role="region" tabindex="0" aria-label="Table">'));
  assert.equal(one({ type: 'table', header: [], rows: [] }), '');
});

test('callout tones and default titles', () => {
  assert.ok(one({ type: 'callout', tone: 'doctor', text: 'x' }).includes('>When to see a doctor<'));
  assert.ok(one({ type: 'callout', tone: 'tip', text: 'x' }).includes('b-callout--tip'));
  assert.ok(one({ type: 'callout', tone: 'evil', text: 'x' }).includes('b-callout--note'));
  assert.ok(one({ type: 'callout', tone: 'tip', title: 'Own', text: 'x' }).includes('aria-label="Own"'));
  assert.equal(one({ type: 'callout', tone: 'tip', text: '' }), '');
});

test('pullquote strips author quote marks and supplies its own', () => {
  const html = one({ type: 'pullquote', text: '"Feet first."' });
  assert.ok(html.includes('<span class="b-hang" aria-hidden="true">“</span>Feet first.<span aria-hidden="true">”</span>'), html);
});

test('list style number → ol, anything else → ul; empty items dropped', () => {
  assert.ok(one({ type: 'list', style: 'number', items: ['a'] }).startsWith('<ol class="b-list b-list--number">'));
  assert.ok(one({ type: 'list', style: 'x', items: ['a', '', 'b'] }).startsWith('<ul class="b-list b-list--bullet"><li>a</li><li>b</li></ul>'));
  assert.equal(one({ type: 'list', items: [] }), '');
});

// =====================================================================
// slugify / plainText / readingMinutes
// =====================================================================
test('slugify', () => {
  const cases = [
    ['Hello World', 'hello-world'],
    ['  Leading & trailing  ', 'leading-and-trailing'],
    ["Don't wait", 'dont-wait'],
    ['Don’t wait', 'dont-wait'],
    ['Café São Paulo', 'cafe-sao-paulo'],
    ['Diabetic foot: 7 signs!', 'diabetic-foot-7-signs'],
    ['a---b___c', 'a-b-c'],
    ['UPPER lower', 'upper-lower'],
    ['', ''],
    ['!!!', ''],
    [null, ''],
    [42, '42'],
    ['मधुमेह', ''],
  ];
  for (const [input, out] of cases) assert.equal(slugify(input), out, JSON.stringify(input));
});

test('slugify caps at 64 chars on a word boundary', () => {
  const s = slugify('word '.repeat(30));
  assert.ok(s.length <= 64 && !s.endsWith('-'), s);
  assert.ok(/^(word-)*word$/.test(s));
  const long = slugify('a'.repeat(100));
  assert.equal(long.length, 64);
});

test('plainText: title + dek + every block text, no markup, cites/links reduced to text', () => {
  const post = {
    title: 'T', dek: 'D',
    blocks: [
      { type: 'paragraph', text: [{ t: 'P', b: true, href: 'https://x.com/' }, { cite: 'r1' }] },
      { type: 'heading', text: 'H' },
      { type: 'list', items: ['L1', 'L2'] },
      { type: 'quote', text: 'Q', cite: 'QC' },
      { type: 'image', ...IMG, caption: 'IC' },
      { type: 'gallery', images: [{ ...IMG, caption: 'G1' }], caption: 'GC' },
      { type: 'imageText', image: { ...IMG, caption: 'ITC' }, text: ['IT'] },
      { type: 'callout', title: 'CT', text: 'C' },
      { type: 'takeaways', title: 'KT', items: ['K'] },
      { type: 'table', caption: 'TC', header: ['TH'], rows: [['TD']] },
      { type: 'video', source: 'youtube', youtube: 'dQw4w9WgXcQ', caption: 'V' },
      { type: 'faq', title: 'FT', items: [{ q: 'FQ', a: 'FA' }] },
      { type: 'cta', label: 'CL', text: 'CX' },
      { type: 'divider' }, { type: 'unknown', text: 'NO' },
    ],
  };
  assert.equal(plainText(post), 'T D P H L1 L2 Q QC IC G1 GC ITC IT CT C KT K TC TH TD V FT FQ FA CL CX'.split(' ').join('\n'));
  assert.equal(plainText({ title: '<b>x</b>' }), '<b>x</b>', 'plain text is raw text (callers escape)');
  assert.equal(plainText(null), '');
  assert.equal(plainText({}), '');
});

test('readingMinutes: ≥1, ~220 wpm, rounded', () => {
  const words = (n) => ({ blocks: [{ type: 'paragraph', text: Array(n).fill('word').join(' ') }] });
  assert.equal(readingMinutes({}), 1);
  assert.equal(readingMinutes(null), 1);
  assert.equal(readingMinutes(words(100)), 1);
  assert.equal(readingMinutes(words(440)), 2);
  assert.equal(readingMinutes(words(2200)), 10);
  assert.equal(readingMinutes(words(549)), 2);
  assert.equal(readingMinutes(words(551)), 3);
});

// ---------- summary ----------
console.log(`blog-blocks: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
