#!/usr/bin/env node
// Blog SEO + share-card tests (plain node, no framework; exits non-zero on failure).
//   node tools/test/blog-seo.test.js
//   MV_OG_OUT=/tmp/mv-v3 node tools/test/blog-seo.test.js   # also writes the OG PNGs
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const seo = require(path.join(ROOT, 'src/blog/seo.js'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------------
// Minimal strict XML well-formedness parser (enough for RSS + sitemap entries):
// balanced tags, quoted attributes, no raw < or stray & in text/attributes, only
// the five predefined entities or numeric references. Returns an element tree.
// ---------------------------------------------------------------------------
const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
const decode = (s) => s.replace(ENTITY, (e) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[e]
  || String.fromCodePoint(e[2] === 'x' ? parseInt(e.slice(3, -1), 16) : parseInt(e.slice(2, -1), 10))));
const checkText = (s, where) => {
  if (/</.test(s)) throw new Error(`raw "<" in ${where}`);
  if (/&/.test(s.replace(ENTITY, ''))) throw new Error(`stray "&" in ${where}: ${s.slice(0, 60)}`);
};
const parseXml = (src) => {
  let s = src.replace(/^<\?xml[^?]*\?>\s*/, '');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const NAME = '[A-Za-z_][\\w.:-]*';
  const tag = new RegExp(`^<(/?)(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"]*"|'[^']*'))*)\\s*(/?)>`);
  while (s.length) {
    const lt = s.indexOf('<');
    const chunk = lt < 0 ? s : s.slice(0, lt);
    if (chunk) {
      checkText(chunk, `<${stack[stack.length - 1].name}>`);
      stack[stack.length - 1].text += decode(chunk);
      if (stack.length === 1 && chunk.trim()) throw new Error('text outside the root element');
    }
    if (lt < 0) break;
    s = s.slice(lt);
    const m = tag.exec(s);
    if (!m) throw new Error(`malformed tag near: ${s.slice(0, 60)}`);
    const [whole, close, name, attrSrc, selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`</${name}> closes <${open && open.name}>`);
    } else {
      const attrs = {};
      for (const a of attrSrc.matchAll(new RegExp(`(${NAME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g'))) {
        const value = a[2] !== undefined ? a[2] : a[3];
        checkText(value, `@${a[1]}`);
        if (a[1] in attrs) throw new Error(`duplicate attribute ${a[1]}`);
        attrs[a[1]] = decode(value);
      }
      const el = { name, attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(el);
      if (!selfClose) stack.push(el);
    }
    s = s.slice(whole.length);
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].name}>`);
  if (root.children.length !== 1) throw new Error('expected exactly one root element');
  return root.children[0];
};
const kids = (el, name) => el.children.filter((c) => c.name === name);
const kid = (el, name) => kids(el, name)[0];
// Second opinion from a real parser when python3 is around (CI and the Mac both have it).
const pythonParses = (xmlText) => {
  try {
    execFileSync('python3', ['-I', '-c', 'import sys, xml.dom.minidom as m; m.parseString(sys.stdin.buffer.read())'], { input: xmlText, stdio: ['pipe', 'ignore', 'pipe'] });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`python minidom rejected the XML: ${String(error.stderr || error.message).trim().split('\n').pop()}`);
  }
};

// ---------------------------------------------------------------------------
// Fixtures (shaped like build-blog's enriched ctx)
// ---------------------------------------------------------------------------
const SITE = 'https://medivasc.in/';
const NOW = '2026-11-12T00:00:00Z';
const taxon = (item, kind) => ({ ...item, url: `blog/${kind}/${item.slug}/`, href: `../../blog/${kind}/${item.slug}/`, absUrl: `${SITE}blog/${kind}/${item.slug}/` });
const categories = [
  taxon({ id: 'c_foot', name: 'Diabetic foot', slug: 'diabetic-foot', intro: 'Foot intro.', metaDescription: 'Everything about diabetic feet.', tint: 'teal' }, 'category'),
  taxon({ id: 'c_veins', name: 'Veins & circulation', slug: 'veins', intro: 'Vein intro.', metaDescription: '', tint: 'clay' }, 'category'),
];
const authors = [
  taxon({ id: 'a_team', name: 'MediVasc Care Team', slug: 'medivasc-care-team', role: '', credentials: '', bio: '', photo: '', sameAs: [] }, 'author'),
  taxon({ id: 'a_doc', name: 'Dr. Meera Iyer', slug: 'dr-meera-iyer', role: 'Vascular surgeon', credentials: 'MS, MCh (Vascular Surgery)', bio: 'Treats circulation problems.', photo: 'assets/blog/authors/meera.webp', sameAs: ['https://example.org/meera', 'http://insecure.example.org/meera', 'javascript:alert(1)'] }, 'author'),
  taxon({ id: 'a_staff', name: 'Clinic Staff', slug: 'clinic-staff', role: 'Nurses', credentials: 'RN', bio: '', photo: '', sameAs: [] }, 'author'),
];
const config = {
  name: 'The MediVasc Journal',
  navLabel: 'Blog',
  intro: 'Plain-spoken guidance on diabetic foot, circulation and limb care.',
  seo: { title: '', description: '' },
  featured: [],
  categories,
  authors,
  redirects: [],
};
const enrich = (post) => ({
  ...post,
  url: `blog/${post.slug}/`,
  href: `../../blog/${post.slug}/`,
  absUrl: `${SITE}blog/${post.slug}/`,
  categoryObj: categories.find((c) => c.id === post.category) || null,
  authorObj: authors.find((a) => a.id === post.author) || null,
  reviewerObj: post.reviewer ? authors.find((a) => a.id === post.reviewer) || null : null,
  published: new Date(post.publishAt),
});
const base = {
  lang: 'en', layout: 'editorial', titleSize: 'L', bodySize: 'M', leadIn: 'dropcap',
  previousSlugs: [], related: [], references: [{ id: 'r1', text: 'IWGDF 2023', url: 'https://iwgdfguidelines.org/' }],
};
const p1 = enrich({
  ...base,
  id: 'p_one', slug: 'diabetic-foot-warning-signs', status: 'published',
  publishAt: '2026-11-04T09:00:00+05:30', updatedAt: '2026-11-06T10:15:00+05:30',
  category: 'c_foot', title: 'Seven warning signs your feet need a doctor', titleAccent: 'warning signs',
  dek: 'Most amputations start as a small wound nobody watched.',
  cover: { src: 'assets/blog/diabetic-foot-warning-signs/cover.webp', alt: 'A foot check at the clinic', caption: '', credit: '', focal: { x: 0.5, y: 0.5 }, patient: false },
  author: 'a_team', reviewer: 'a_doc', reviewedAt: '2026-11-05T12:00:00+05:30',
  about: ['Diabetic foot ulcer', 'Peripheral neuropathy', 'Diabetic foot ulcer', ''],
  seo: { title: '', description: '', focusKeyphrase: 'diabetic foot warning signs', keywords: ['foot ulcer', 'neuropathy', 'foot ulcer'] },
  blocks: [
    { type: 'paragraph', text: 'Check your feet every day.' },
    { type: 'image', src: 'assets/blog/diabetic-foot-warning-signs/wound.webp', alt: 'A wound', width: 'column', align: 'center', patient: true },
    { type: 'gallery', images: [{ src: 'assets/blog/diabetic-foot-warning-signs/shoe.webp', alt: 'Shoe' }, { src: 'assets/blog/diabetic-foot-warning-signs/ulcer.webp', alt: 'Ulcer', patient: true }] },
    { type: 'imageText', image: { src: 'assets/blog/diabetic-foot-warning-signs/check.webp', alt: 'Mirror check' }, side: 'left', text: ['Use a mirror.'] },
    { type: 'faq', items: [
      { q: 'How often should I check my feet?', a: [{ t: 'Every ', b: true }, { t: 'single day', hl: true }, { cite: 'r1' }, { t: ' — even when nothing hurts & you feel fine.' }] },
      { q: 'Is a <small> blister serious?', a: 'Yes, if you have diabetes.' },
      { q: 'Empty answer is skipped', a: [] },
    ] },
  ],
});
const p2 = enrich({
  ...base,
  id: 'p_two', slug: 'veins-and-heat', status: 'scheduled', publishAt: '2026-11-08T06:00:00Z',
  category: 'c_veins', title: 'Heat & "heavy" legs: <why> it\'s worse in summer',
  dek: 'Swelling, aching & what helps — "quickly".',
  cover: { src: 'assets/blog/veins-and-heat/cover.webp', alt: 'Legs', patient: true },
  author: 'a_doc', reviewer: null, reviewedAt: null,
  seo: { title: 'Custom SEO title', description: 'Custom search description.', focusKeyphrase: '', keywords: [] },
  blocks: [{ type: 'paragraph', text: 'Body.' }],
});
const p3 = enrich({
  ...base,
  id: 'p_three', slug: 'clinic-staff-notes', status: 'published', publishAt: '2026-10-01T09:00:00+05:30',
  category: 'c_foot', title: 'Notes from the clinic floor', dek: '',
  author: 'a_staff', reviewer: 'a_doc', reviewedAt: null,
  seo: { title: '   ', description: '', focusKeyphrase: '', keywords: [] },
  blocks: [{ type: 'paragraph', text: 'Body.' }],
});
const pFuture = enrich({ ...base, id: 'p_future', slug: 'future-post', status: 'scheduled', publishAt: '2027-01-01T09:00:00+05:30', category: 'c_foot', title: 'Not yet', dek: 'Future.', author: 'a_team', blocks: [] });
const pUnpub = enrich({ ...base, id: 'p_unpub', slug: 'pulled-post', status: 'unpublished', publishAt: '2026-09-01T09:00:00+05:30', category: 'c_foot', title: 'Pulled', dek: 'Gone.', author: 'a_team', blocks: [] });

const makeCtx = (overrides = {}) => ({
  depth: '../../',
  siteUrl: SITE,
  blog: config,
  company: { name: 'MediVasc' },
  now: NOW,
  posts: [p1, pFuture, p3, pUnpub, p2], // deliberately unsorted, with two posts that must not leak
  categories,
  authors,
  // Largest variant, like W1's: proves the builders go through ctx.absImg.
  absImg: (src) => (/^assets\//.test(src) ? `${SITE}${src.replace(/\.webp$/, '-1600.webp')}` : String(src || '')),
  ...overrides,
});
const ctx = makeCtx();
const graphOf = (out) => {
  assert.ok(Array.isArray(out) && out.length === 1, 'one JSON-LD object per page');
  assert.equal(out[0]['@context'], 'https://schema.org');
  JSON.parse(JSON.stringify(out[0])); // serialisable
  return out[0]['@graph'];
};
const node = (graph, type) => graph.find((n) => (Array.isArray(n['@type']) ? n['@type'].includes(type) : n['@type'] === type));
const OG = `${SITE}assets/blog/og/diabetic-foot-warning-signs.0a1b2c3d.png`;

// ---------------------------------------------------------------------------
// postJsonLd
// ---------------------------------------------------------------------------
test('postJsonLd: BlogPosting core fields', () => {
  const graph = graphOf(seo.postJsonLd(ctx, p1, { ogImage: OG }));
  const art = node(graph, 'BlogPosting');
  assert.equal(art.headline, p1.title);
  assert.equal(art.description, p1.dek);
  assert.equal(art.url, `${SITE}blog/diabetic-foot-warning-signs/`);
  assert.equal(art.mainEntityOfPage, `${SITE}blog/diabetic-foot-warning-signs/`, 'mainEntityOfPage = canonical absolute URL');
  assert.equal(art['@id'], `${SITE}blog/diabetic-foot-warning-signs/#article`);
  assert.deepEqual(art.publisher, { '@id': `${SITE}#organization` });
  assert.deepEqual(art.isPartOf, { '@id': `${SITE}blog/#blog` });
  assert.equal(art.articleSection, 'Diabetic foot');
  assert.equal(art.inLanguage, 'en');
});

test('postJsonLd: dates keep their offsets; dateModified falls back to datePublished', () => {
  const art = node(graphOf(seo.postJsonLd(ctx, p1)), 'BlogPosting');
  assert.equal(art.datePublished, '2026-11-04T09:00:00+05:30');
  assert.equal(art.dateModified, '2026-11-06T10:15:00+05:30');
  const art2 = node(graphOf(seo.postJsonLd(ctx, p2)), 'BlogPosting');
  assert.equal(art2.datePublished, '2026-11-08T06:00:00Z');
  assert.equal(art2.dateModified, '2026-11-08T06:00:00Z');
  // No publishAt string, only the enriched Date → UTC ISO.
  const art3 = node(graphOf(seo.postJsonLd(ctx, { ...p3, publishAt: undefined, published: new Date('2026-10-01T03:30:00Z') })), 'BlogPosting');
  assert.equal(art3.datePublished, '2026-10-01T03:30:00.000Z');
});

test('postJsonLd: author Person vs Organization ("Team"/"Staff" bylines)', () => {
  const team = node(graphOf(seo.postJsonLd(ctx, p1)), 'BlogPosting').author;
  assert.equal(team['@type'], 'Organization');
  assert.equal(team.name, 'MediVasc Care Team');
  assert.equal(team.url, `${SITE}blog/author/medivasc-care-team/`);
  assert.deepEqual(team.parentOrganization, { '@id': `${SITE}#organization` });
  const doc = node(graphOf(seo.postJsonLd(ctx, p2)), 'BlogPosting').author;
  assert.equal(doc['@type'], 'Person');
  assert.equal(doc.name, 'Dr. Meera Iyer');
  assert.equal(doc['@id'], `${SITE}blog/author/dr-meera-iyer/#author`);
  const staff = node(graphOf(seo.postJsonLd(ctx, p3)), 'BlogPosting').author;
  assert.equal(staff['@type'], 'Organization');
  // No resolvable author → the clinic itself.
  const orphan = node(graphOf(seo.postJsonLd(ctx, { ...p2, author: 'a_missing', authorObj: null })), 'BlogPosting').author;
  assert.deepEqual(orphan, { '@id': `${SITE}#organization` });
});

test('postJsonLd: reviewedBy/lastReviewed only when set (on the MedicalWebPage)', () => {
  const page1 = node(graphOf(seo.postJsonLd(ctx, p1)), 'MedicalWebPage');
  assert.equal(page1.reviewedBy['@type'], 'Person');
  assert.equal(page1.reviewedBy.name, 'Dr. Meera Iyer');
  assert.equal(page1.lastReviewed, '2026-11-05');
  const page2 = node(graphOf(seo.postJsonLd(ctx, p2)), 'MedicalWebPage');
  assert.ok(!('reviewedBy' in page2) && !('lastReviewed' in page2), 'no reviewer → neither field');
  const page3 = node(graphOf(seo.postJsonLd(ctx, p3)), 'MedicalWebPage');
  assert.equal(page3.reviewedBy.name, 'Dr. Meera Iyer');
  assert.ok(!('lastReviewed' in page3), 'reviewer without reviewedAt → no invented review date');
  const art1 = node(graphOf(seo.postJsonLd(ctx, p1)), 'BlogPosting');
  assert.ok(!('reviewedBy' in art1), 'reviewedBy lives on the WebPage, not the BlogPosting');
});

test('postJsonLd: about → MedicalCondition (deduped, blanks dropped); keywords', () => {
  const art = node(graphOf(seo.postJsonLd(ctx, p1)), 'BlogPosting');
  assert.deepEqual(art.about, [{ '@type': 'MedicalCondition', name: 'Diabetic foot ulcer' }, { '@type': 'MedicalCondition', name: 'Peripheral neuropathy' }]);
  assert.equal(art.keywords, 'diabetic foot warning signs, foot ulcer, neuropathy');
  const art2 = node(graphOf(seo.postJsonLd(ctx, p2)), 'BlogPosting');
  assert.ok(!('about' in art2) && !('keywords' in art2), 'empty about/keywords are omitted');
  assert.equal(art2.description, 'Custom search description.', 'seo.description wins over the dek');
});

test('postJsonLd: image precedence — share card, then cover via ctx.absImg, then site default', () => {
  const coverAbs = `${SITE}assets/blog/diabetic-foot-warning-signs/cover-1600.webp`;
  assert.deepEqual(node(graphOf(seo.postJsonLd(ctx, p1, { ogImage: OG })), 'BlogPosting').image, [OG, coverAbs]);
  assert.deepEqual(node(graphOf(seo.postJsonLd(ctx, p1)), 'BlogPosting').image, [coverAbs]);
  assert.deepEqual(node(graphOf(seo.postJsonLd(ctx, p1, {})), 'BlogPosting').image, [coverAbs]);
  // p3 has no cover; p2's cover is a patient photo (never pushed outward). With no
  // ctx.siteOgImage there is no safe default (the unhashed master 404s) → no image.
  assert.ok(!('image' in node(graphOf(seo.postJsonLd(ctx, p3)), 'BlogPosting')));
  assert.ok(!('image' in node(graphOf(seo.postJsonLd(ctx, p2)), 'BlogPosting')));
  assert.deepEqual(node(graphOf(seo.postJsonLd(ctx, p2, { ogImage: OG })), 'BlogPosting').image, [OG]);
  const withSiteOg = makeCtx({ siteOgImage: `${SITE}assets/brand/og-image.1234abcd.png` });
  assert.deepEqual(node(graphOf(seo.postJsonLd(withSiteOg, p3)), 'BlogPosting').image, [`${SITE}assets/brand/og-image.1234abcd.png`]);
  assert.deepEqual(node(graphOf(seo.postJsonLd(withSiteOg, p2)), 'BlogPosting').image, [`${SITE}assets/brand/og-image.1234abcd.png`]);
  assert.deepEqual(node(graphOf(seo.postJsonLd(withSiteOg, p1)), 'BlogPosting').image, [`${SITE}assets/blog/diabetic-foot-warning-signs/cover-1600.webp`], 'cover beats the site default');
  const page = node(graphOf(seo.postJsonLd(ctx, p1, { ogImage: OG })), 'MedicalWebPage');
  assert.equal(page.primaryImageOfPage.url, coverAbs);
  assert.equal(page.primaryImageOfPage.caption, 'A foot check at the clinic');
  assert.ok(!('primaryImageOfPage' in node(graphOf(seo.postJsonLd(ctx, p2)), 'MedicalWebPage')), 'patient cover is not the primary image');
});

test('postJsonLd: BreadcrumbList', () => {
  const graph = graphOf(seo.postJsonLd(ctx, p1));
  const crumbs = node(graph, 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i) => [i.position, i.name, i.item]), [
    [1, 'MediVasc', SITE],
    [2, 'The MediVasc Journal', `${SITE}blog/`],
    [3, 'Diabetic foot', `${SITE}blog/category/diabetic-foot/`],
    [4, p1.title, `${SITE}blog/diabetic-foot-warning-signs/`],
  ]);
  assert.deepEqual(node(graph, 'MedicalWebPage').breadcrumb, { '@id': crumbs['@id'] });
});

test('postJsonLd: FAQPage only with an faq block; answers are plain text', () => {
  const page = node(graphOf(seo.postJsonLd(ctx, p1)), 'FAQPage');
  assert.deepEqual(page['@type'], ['MedicalWebPage', 'FAQPage']);
  assert.equal(page.mainEntity.length, 2, 'a question with an empty answer is skipped');
  assert.deepEqual(page.mainEntity[0], {
    '@type': 'Question',
    name: 'How often should I check my feet?',
    acceptedAnswer: { '@type': 'Answer', text: 'Every single day — even when nothing hurts & you feel fine.' },
  });
  assert.equal(page.mainEntity[1].name, 'Is a <small> blister serious?');
  for (const q of page.mainEntity) assert.doesNotMatch(q.acceptedAnswer.text, /<[a-z/]/i, 'no HTML in answers');
  const noFaq = graphOf(seo.postJsonLd(ctx, p2));
  assert.equal(node(noFaq, 'FAQPage'), undefined);
  assert.equal(node(noFaq, 'MedicalWebPage')['@type'], 'MedicalWebPage');
  assert.ok(!('mainEntity' in node(noFaq, 'MedicalWebPage')));
});

test('every graph carries the WebSite + MedicalClinic nodes its @id references point at', () => {
  const graphs = [
    graphOf(seo.postJsonLd(ctx, p1)), graphOf(seo.landingJsonLd(ctx)),
    graphOf(seo.categoryJsonLd(ctx, categories[0])), graphOf(seo.authorJsonLd(ctx, authors[1])),
  ];
  for (const graph of graphs) {
    assert.deepEqual(node(graph, 'MedicalClinic'), { '@type': 'MedicalClinic', '@id': `${SITE}#organization`, url: SITE, name: 'MediVasc' });
    assert.equal(node(graph, 'WebSite')['@id'], `${SITE}#website`);
    // Every { '@id' } reference resolves to a node in the same graph.
    const defined = new Set(graph.map((n) => n['@id']));
    const refs = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        if (Object.keys(v).length === 1 && v['@id']) refs.push(v['@id']);
        else Object.values(v).forEach(walk);
      }
    };
    graph.forEach((n) => Object.entries(n).forEach(([k, v]) => k !== '@id' && walk(v)));
    for (const ref of refs) assert.ok(defined.has(ref) || ref.endsWith('#author'), `unresolved @id ${ref}`);
  }
});

test('postJsonLd: null post → []', () => {
  assert.deepEqual(seo.postJsonLd(ctx, null), []);
});

// ---------------------------------------------------------------------------
// Landing / category / author
// ---------------------------------------------------------------------------
test('landingJsonLd: Blog node + breadcrumb', () => {
  const graph = graphOf(seo.landingJsonLd(makeCtx({ posts: [p2, p1, p3] })));
  const blog = node(graph, 'Blog');
  assert.equal(blog['@id'], `${SITE}blog/#blog`);
  assert.equal(blog.url, `${SITE}blog/`);
  assert.equal(blog.name, 'The MediVasc Journal');
  assert.equal(blog.description, config.intro);
  assert.deepEqual(blog.publisher, { '@id': `${SITE}#organization` });
  assert.deepEqual(blog.blogPost.map((p) => p.url), [p2.absUrl, p1.absUrl, p3.absUrl]);
  assert.equal(blog.blogPost[1].datePublished, '2026-11-04T09:00:00+05:30');
  assert.equal(node(graph, 'BreadcrumbList').itemListElement.length, 2);
  const custom = node(graphOf(seo.landingJsonLd(makeCtx({ blog: { ...config, seo: { title: 'T', description: 'Owner text' } } }))), 'Blog');
  assert.equal(custom.description, 'Owner text');
});

test('categoryJsonLd: CollectionPage with its posts', () => {
  const graph = graphOf(seo.categoryJsonLd(makeCtx({ posts: [p2, p1, p3] }), categories[0]));
  const page = node(graph, 'CollectionPage');
  assert.equal(page.url, `${SITE}blog/category/diabetic-foot/`);
  assert.equal(page.description, 'Everything about diabetic feet.');
  assert.deepEqual(page.mainEntity.itemListElement.map((i) => [i.position, i.url]), [[1, p1.absUrl], [2, p3.absUrl]]);
  assert.equal(node(graph, 'BreadcrumbList').itemListElement.length, 3);
  const veins = node(graphOf(seo.categoryJsonLd(makeCtx({ posts: [p2] }), categories[1])), 'CollectionPage');
  assert.equal(veins.description, 'Vein intro.', 'empty metaDescription falls back to intro');
  assert.deepEqual(seo.categoryJsonLd(ctx, null), []);
});

test('authorJsonLd: ProfilePage + Person (credentials, https-only sameAs) / Organization', () => {
  const graph = graphOf(seo.authorJsonLd(makeCtx({ posts: [p2, p1, p3] }), authors[1]));
  const page = node(graph, 'ProfilePage');
  const person = node(graph, 'Person');
  assert.deepEqual(page.mainEntity, { '@id': person['@id'] });
  assert.equal(person.jobTitle, 'Vascular surgeon');
  assert.equal(person.hasCredential.name, 'MS, MCh (Vascular Surgery)');
  assert.deepEqual(person.worksFor, { '@id': `${SITE}#organization` });
  assert.deepEqual(person.sameAs, ['https://example.org/meera']);
  assert.equal(person.image, `${SITE}assets/blog/authors/meera-1600.webp`);
  assert.deepEqual(person.knowsAbout, ['Veins & circulation', 'Diabetic foot']);
  const team = graphOf(seo.authorJsonLd(makeCtx({ posts: [p1] }), authors[0]));
  const org = node(team, 'Organization');
  assert.ok(org && !node(team, 'Person'));
  assert.ok(!('jobTitle' in org) && !('worksFor' in org) && !('hasCredential' in org));
  assert.deepEqual(seo.authorJsonLd(ctx, { id: 'x', name: '' }), []);
});

// ---------------------------------------------------------------------------
// The company as its own byline (author name = ctx.company.name, case/space-insensitive)
// ---------------------------------------------------------------------------
const ORG_ID = `${SITE}#organization`;
const companyAuthors = [
  taxon({ id: 'a_co', name: 'MediVasc', slug: 'medivasc', role: '', credentials: '', bio: '', photo: '', sameAs: [] }, 'author'),
  taxon({ id: 'a_co_loose', name: ' medivasc ', slug: 'medivasc', role: '', credentials: '', bio: '', photo: '', sameAs: [] }, 'author'),
];
// No reviewer, so any Person in the graph could only have come from the byline.
const companyPost = (a) => ({ ...p2, id: `p_${a.id}`, author: a.id, authorObj: a, reviewer: null, reviewerObj: null, reviewedAt: null });
const companyCtx = (a) => makeCtx({ authors: [...authors, ...companyAuthors], posts: [companyPost(a)] });
const deepFind = (value, pred, out = []) => {
  if (Array.isArray(value)) value.forEach((v) => deepFind(v, pred, out));
  else if (value && typeof value === 'object') {
    if (pred(value)) out.push(value);
    Object.values(value).forEach((v) => deepFind(v, pred, out));
  }
  return out;
};
const hasType = (o, type) => (Array.isArray(o['@type']) ? o['@type'].includes(type) : o['@type'] === type);

for (const a of companyAuthors) {
  const label = JSON.stringify(a.name);
  test(`postJsonLd: company byline ${label} → author IS the site MedicalClinic`, () => {
    const art = node(graphOf(seo.postJsonLd(companyCtx(a), companyPost(a))), 'BlogPosting');
    assert.deepEqual(art.author, { '@type': 'MedicalClinic', '@id': ORG_ID, name: 'MediVasc', url: SITE });
  });
  test(`postJsonLd: company byline ${label} → no Person anywhere in the post JSON-LD`, () => {
    const out = seo.postJsonLd(companyCtx(a), companyPost(a));
    const people = deepFind(out, (o) => hasType(o, 'Person'));
    assert.deepEqual(people, [], 'no @type Person at any depth');
  });
  test(`authorJsonLd: company byline ${label} → ProfilePage is about the org; one org node`, () => {
    const graph = graphOf(seo.authorJsonLd(companyCtx(a), a));
    assert.deepEqual(node(graph, 'ProfilePage').mainEntity, { '@id': ORG_ID });
    assert.equal(graph.filter((n) => n['@id'] === ORG_ID).length, 1, 'exactly one node carries the org @id');
  });
}

test('postJsonLd: "MediVasc Care Team" byline still renders as its own Organization (regression)', () => {
  const art = node(graphOf(seo.postJsonLd(ctx, p1)), 'BlogPosting');
  assert.deepEqual(art.author, {
    '@type': 'Organization',
    '@id': `${SITE}blog/author/medivasc-care-team/#author`,
    name: 'MediVasc Care Team',
    url: `${SITE}blog/author/medivasc-care-team/`,
    parentOrganization: { '@id': ORG_ID },
  });
});

test('postJsonLd: a named clinician byline ("Dr A Sharma") still renders as a Person (regression)', () => {
  const sharma = taxon({ id: 'a_sharma', name: 'Dr A Sharma', slug: 'dr-a-sharma', role: '', credentials: '', bio: '', photo: '', sameAs: [] }, 'author');
  const art = node(graphOf(seo.postJsonLd(ctx, { ...p2, author: 'a_sharma', authorObj: sharma })), 'BlogPosting');
  assert.deepEqual(art.author, {
    '@type': 'Person',
    '@id': `${SITE}blog/author/dr-a-sharma/#author`,
    name: 'Dr A Sharma',
    url: `${SITE}blog/author/dr-a-sharma/`,
  });
});

test('postJsonLd: reviewer null or absent → no reviewedBy key at any depth', () => {
  const absent = { ...p2 };
  delete absent.reviewer;
  delete absent.reviewerObj;
  for (const [label, post] of [['null', p2], ['absent', absent], ['company byline', companyPost(companyAuthors[0])]]) {
    const out = seo.postJsonLd(ctx, post);
    assert.deepEqual(deepFind(out, (o) => 'reviewedBy' in o), [], `reviewer ${label}: no reviewedBy anywhere`);
  }
});

// ---------------------------------------------------------------------------
// RSS
// ---------------------------------------------------------------------------
test('rssFeed: well-formed, escaped, absolute, newest first, live posts only', () => {
  const out = seo.rssFeed(ctx);
  const rss = parseXml(out);
  assert.equal(pythonParses(out) !== false, true);
  assert.equal(rss.name, 'rss');
  assert.equal(rss.attrs.version, '2.0');
  const channel = kid(rss, 'channel');
  assert.equal(kid(channel, 'title').text, 'The MediVasc Journal');
  assert.equal(kid(channel, 'link').text, `${SITE}blog/`);
  assert.equal(kid(channel, 'atom:link').attrs.href, `${SITE}blog/feed.xml`);
  assert.equal(kid(channel, 'lastBuildDate').text, new Date('2026-11-08T06:00:00Z').toUTCString());
  const items = kids(channel, 'item');
  assert.deepEqual(items.map((i) => kid(i, 'link').text), [p2.absUrl, p1.absUrl, p3.absUrl], 'newest first; future + unpublished excluded');
  assert.doesNotMatch(out, /future-post|pulled-post/);
  // Escaping: & < > " ' survive a round trip, and the raw XML carries entities.
  assert.equal(kid(items[0], 'title').text, p2.title);
  assert.equal(kid(items[0], 'description').text, p2.dek);
  assert.match(out, /Heat &amp; &quot;heavy&quot; legs: &lt;why&gt; it&apos;s worse/);
  assert.equal(kid(items[0], 'category').text, 'Veins & circulation');
  for (const item of items) {
    assert.match(kid(item, 'link').text, /^https:\/\/medivasc\.in\/blog\/[a-z0-9-]+\/$/);
    assert.equal(kid(item, 'guid').attrs.isPermaLink, 'true');
    assert.equal(kid(item, 'guid').text, kid(item, 'link').text);
    assert.ok(!Number.isNaN(Date.parse(kid(item, 'pubDate').text)));
  }
  assert.equal(kid(items[1], 'pubDate').text, 'Wed, 04 Nov 2026 03:30:00 GMT');
  assert.equal(kid(items[1], 'dc:creator').text, 'MediVasc Care Team');
  const media = kid(items[1], 'media:content');
  assert.equal(media.attrs.url, `${SITE}assets/blog/diabetic-foot-warning-signs/cover-1600.webp`);
  assert.equal(media.attrs.type, 'image/webp');
  assert.equal(kid(items[0], 'media:content'), undefined, 'patient cover stays out of the feed');
  assert.equal(kid(items[2], 'description'), undefined, 'empty dek → no description');
});

test('rssFeed: empty journal is still a valid feed; output is deterministic', () => {
  const empty = seo.rssFeed(makeCtx({ posts: [] }));
  const rss = parseXml(empty);
  assert.equal(kids(kid(rss, 'channel'), 'item').length, 0);
  assert.equal(seo.rssFeed(ctx), seo.rssFeed(ctx));
});

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------
test('sitemapEntries: blog URLs + image:image, patient photos excluded', () => {
  const entries = seo.sitemapEntries(ctx);
  const doc = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.join('')}</urlset>`;
  const urlset = parseXml(doc);
  assert.equal(pythonParses(doc) !== false, true);
  const urls = kids(urlset, 'url');
  const byLoc = new Map(urls.map((u) => [kid(u, 'loc').text, u]));
  assert.equal(kid(urls[0], 'loc').text, `${SITE}blog/`);
  assert.equal(kid(urls[0], 'lastmod').text, '2026-11-08T06:00:00Z');
  for (const post of [p1, p2, p3]) assert.ok(byLoc.has(post.absUrl), `${post.slug} listed`);
  assert.doesNotMatch(entries.join(''), /future-post|pulled-post/);
  const one = byLoc.get(p1.absUrl);
  assert.equal(kid(one, 'lastmod').text, '2026-11-06T10:15:00+05:30');
  assert.deepEqual(kids(one, 'image:image').map((i) => kid(i, 'image:loc').text), [
    `${SITE}assets/blog/diabetic-foot-warning-signs/cover-1600.webp`,
    `${SITE}assets/blog/diabetic-foot-warning-signs/shoe-1600.webp`,
    `${SITE}assets/blog/diabetic-foot-warning-signs/check-1600.webp`,
  ]);
  assert.doesNotMatch(entries.join(''), /wound|ulcer-1600|veins-and-heat\/cover/, 'patient photos are not in the image sitemap');
  assert.ok(byLoc.has(`${SITE}blog/category/diabetic-foot/`));
  assert.ok(byLoc.has(`${SITE}blog/category/veins/`));
  assert.ok(byLoc.has(`${SITE}blog/author/dr-meera-iyer/`));
  assert.ok(byLoc.has(`${SITE}blog/author/clinic-staff/`));
  for (const loc of byLoc.keys()) assert.match(loc, /^https:\/\/medivasc\.in\/blog\//);
  assert.deepEqual(seo.sitemapEntries(makeCtx({ posts: [] })), []);
});

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------
test('llmsSection: grouped by category, absolute links, live posts only', () => {
  const out = seo.llmsSection(ctx);
  assert.match(out, /^## Journal\n\n\[The MediVasc Journal\]\(https:\/\/medivasc\.in\/blog\/\): Plain-spoken/);
  assert.match(out, /RSS: https:\/\/medivasc\.in\/blog\/feed\.xml/);
  assert.match(out, /\n### Diabetic foot\n\n- \[Seven warning signs your feet need a doctor\]\(https:\/\/medivasc\.in\/blog\/diabetic-foot-warning-signs\/\): Most amputations/);
  assert.match(out, /\n- \[Notes from the clinic floor\]\(https:\/\/medivasc\.in\/blog\/clinic-staff-notes\/\)\n/);
  assert.match(out, /\n### Veins & circulation\n/);
  assert.doesNotMatch(out, /Not yet|Pulled/);
  assert.equal(seo.llmsSection(makeCtx({ posts: [] })), '');
  const loose = seo.llmsSection(makeCtx({ posts: [{ ...p2, category: 'c_gone' }] }));
  assert.match(loose, /### More articles/);
});

// ---------------------------------------------------------------------------
// Redirect stubs
// ---------------------------------------------------------------------------
test('redirectStub: meta refresh + canonical + noindex, relative-safe under /changes/', () => {
  const html = seo.redirectStub({ fromDepth: '../../', to: 'blog/new-slug/', siteUrl: SITE });
  assert.match(html, /<meta http-equiv="refresh" content="0; url=\.\.\/\.\.\/blog\/new-slug\/">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/medivasc\.in\/blog\/new-slug\/">/);
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.doesNotMatch(html, /(?:href|src)="\/|url=\//, 'no root-absolute paths');
  const target = /url=([^"]+)"/.exec(html)[1];
  assert.equal(new URL(target, 'https://medivasc.in/changes/blog/old-slug/').href, 'https://medivasc.in/changes/blog/new-slug/');
  assert.equal(new URL(target, 'https://medivasc.in/blog/old-slug/').href, 'https://medivasc.in/blog/new-slug/');
  assert.match(html, /<a href="\.\.\/\.\.\/blog\/new-slug\/">/);
  // Numeric depth (a nested old address) and an external target.
  const deep = seo.redirectStub({ fromDepth: 3, to: '/blog/x/', siteUrl: SITE });
  assert.match(deep, /url=\.\.\/\.\.\/\.\.\/blog\/x\//);
  const ext = seo.redirectStub({ fromDepth: '../../', to: 'https://example.org/a?b=1&c=2', siteUrl: SITE });
  assert.match(ext, /url=https:\/\/example\.org\/a\?b=1&amp;c=2"/);
  assert.match(ext, /rel="canonical" href="https:\/\/example\.org\/a\?b=1&amp;c=2"/);
  // The inline script cannot be broken out of.
  const tricky = seo.redirectStub({ fromDepth: '../../', to: 'blog/a"</script><script>x/', siteUrl: SITE });
  assert.doesNotMatch(tricky, /<\/script><script>x/);
  assert.throws(() => seo.redirectStub({ fromDepth: '../x/', to: 'blog/a/', siteUrl: SITE }));
  assert.throws(() => seo.redirectStub({ fromDepth: '../../', to: '', siteUrl: SITE }));
});

// ---------------------------------------------------------------------------
// <title> / description
// ---------------------------------------------------------------------------
test('metaFor: post fallbacks and the title suffix', () => {
  const m1 = seo.metaFor(ctx, { kind: 'post', post: p1 });
  assert.equal(m1.title, 'Seven warning signs your feet need a doctor | MediVasc', 'journal suffix would pass 60 chars → site suffix');
  assert.equal(m1.description, p1.dek, 'empty seo.description → dek');
  const m2 = seo.metaFor(ctx, { kind: 'post', post: p2 });
  assert.equal(m2.title, 'Custom SEO title | The MediVasc Journal');
  assert.equal(m2.description, 'Custom search description.');
  const m3 = seo.metaFor(ctx, { kind: 'post', post: p3 });
  assert.equal(m3.title, 'Notes from the clinic floor | The MediVasc Journal', 'whitespace seo.title → title');
  const long = 'An unusually long article title that already fills the whole search line';
  assert.equal(seo.metaFor(ctx, { kind: 'post', post: { ...p1, title: long } }).title, long);
  for (const m of [m1, m2, m3]) assert.ok(m.title.length <= 60 || m.title === long);
});

test('metaFor: category / author / landing fallbacks', () => {
  assert.deepEqual(seo.metaFor(ctx, { kind: 'category', category: categories[0] }), { title: 'Diabetic foot | The MediVasc Journal', description: 'Everything about diabetic feet.', ogImageAlt: '' });
  assert.equal(seo.metaFor(ctx, { kind: 'category', category: categories[1] }).description, 'Vein intro.');
  assert.equal(seo.metaFor(ctx, { kind: 'author', author: authors[0] }).description, 'Articles by MediVasc Care Team in The MediVasc Journal.');
  assert.equal(seo.metaFor(ctx, { kind: 'author', author: authors[1] }).description, 'Treats circulation problems.');
  assert.deepEqual(seo.metaFor(ctx, { kind: 'landing' }), { title: 'The MediVasc Journal', description: config.intro, ogImageAlt: '' });
  const owner = makeCtx({ blog: { ...config, seo: { title: 'Owner title', description: 'Owner description' } } });
  assert.equal(seo.metaFor(owner, { kind: 'landing' }).title, 'Owner title');
  assert.equal(seo.metaFor(owner, { kind: 'landing' }).description, 'Owner description');
});

// ---------------------------------------------------------------------------
// Share card (og.js): never throws on a title the validators accept
// ---------------------------------------------------------------------------
const OG_OUT = process.env.MV_OG_OUT ? path.resolve(process.env.MV_OG_OUT) : '';
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosisandhypercalcaemia'; // 62 chars
const T120 = 'What every person living with diabetes should know about foot ulcers, circulation, footwear, wound care and when to see us';
const ogCases = [
  ['og-longword', { title: `Understanding ${LONG_WORD} risk` }],
  ['og-longword-only', { title: LONG_WORD, titleAccent: LONG_WORD }],
  ['og-longword-cover', { title: `Understanding ${LONG_WORD} risk`, cover: { src: 'assets/treatment/treatment-02.webp', alt: '' } }],
  ['og-120', { title: T120, titleAccent: 'foot ulcers' }],
  ['og-120-cover', { title: T120, cover: { src: 'assets/treatment/treatment-02.webp', alt: '' } }],
  ['og-absurd', { title: `${T120} `.repeat(5).trim() }],
  ['og-long-category', { title: 'Seven warning signs your feet need a doctor', category: 'Diabetic foot care, wound healing and limb preservation for everyone' }],
];
for (const [slug, extra] of ogCases) {
  test(`renderOgPng: ${slug} (${extra.title.length} chars) renders a 1200x630 PNG`, async () => {
    const og = require(path.join(ROOT, 'src/blog/og.js'));
    const sharp = require('sharp');
    const warn = console.warn;
    console.warn = () => {};
    let png;
    try {
      png = await og.renderOgPng({ slug, ...extra }, { blogName: 'The MediVasc Journal', category: { name: extra.category || 'Diabetic foot' }, root: ROOT });
    } finally {
      console.warn = warn;
    }
    assert.ok(Buffer.isBuffer(png), 'a PNG buffer, not null');
    const meta = await sharp(png).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', 1200, 630]);
    if (OG_OUT) { fs.mkdirSync(OG_OUT, { recursive: true }); fs.writeFileSync(path.join(OG_OUT, `${slug}.png`), png); }
  });
}

test('og internals: a hyphen-broken word fits, ends pieces in "-", keeps every letter', () => {
  const og = require(path.join(ROOT, 'src/blog/og.js'));
  const { hyphenateWord, titleLayouts, titleWords } = og._internals;
  const word = titleWords(LONG_WORD, '')[0];
  const pieces = hyphenateWord(word, 32, 630, -0.02);
  assert.ok(pieces.length >= 2);
  const textOf = (w) => w.map((s) => s.text).join('');
  pieces.slice(0, -1).forEach((p) => assert.match(textOf(p), /-$/));
  assert.equal(pieces.map(textOf).join('').replace(/-/g, ''), LONG_WORD);
  assert.ok(pieces.slice(1).every((p) => p.joinPrev === true));
  // An existing dash is a break point; no doubled hyphen.
  const compound = titleWords('non-insulin-dependent-diabetes-mellitus-peripheral-arterial-disease', '')[0];
  assert.doesNotMatch(hyphenateWord(compound, 60, 630, -0.02).map(textOf).join('|'), /--/);
  // Every candidate layout fits its box width.
  const first = titleLayouts(titleWords(`Understanding ${LONG_WORD} risk`, ''), 630, 316).next().value;
  assert.ok(first && first.lines.every((l) => l.width <= 630));
  assert.ok(first.breaks >= 1);
});

// ---------------------------------------------------------------------------
// Blog integration pins (713481f cover caption; U1/U2 "updated" rule; E1 fail-closed)
// ---------------------------------------------------------------------------
test('updatedAtOf (U1/U2): only an updatedAt on a later India day than the publish day counts', () => {
  const at = (publishAt, updatedAt) => seo.updatedAtOf({ publishAt, updatedAt });
  const PUB = '2026-11-04T09:00:00+05:30';
  assert.equal(seo.updatedAtOf, require(path.join(ROOT, 'admin/content-rules.js')).updatedAtOf, 'one rule');
  assert.equal(at(PUB, '2026-11-04T23:30:00+05:30'), '', 'same-day republish');
  assert.equal(at(PUB, PUB), '');
  assert.equal(at(PUB, '2026-11-03T10:00:00+05:30'), '', 'earlier than the publish (left from before a reschedule)');
  assert.equal(at('2026-11-20T09:00:00+05:30', '2026-11-13T12:00:00+05:30'), '', 'a rescheduled once-live post');
  assert.equal(at(PUB, '2026-11-05T00:10:00+05:30'), '2026-11-05T00:10:00+05:30', 'next India day, offset kept');
  assert.equal(at(PUB, '2026-11-04T19:00:00Z'), '2026-11-04T19:00:00Z', 'UTC same day, India next day');
  assert.equal(at('2026-11-04T20:00:00Z', '2026-11-05T10:00:00+05:30'), '', 'UTC next day, India same day');
  assert.equal(at(PUB, ''), '');
  assert.equal(at(PUB, 'not a date'), '');
  assert.equal(at('', '2026-11-06T10:00:00+05:30'), '', 'no publish date');
  assert.equal(seo.updatedAtOf(null), '');
  // The outputs agree: no dateModified / lastmod from an ignored stamp.
  const same = { ...p1, updatedAt: '2026-11-04T22:00:00+05:30' };
  assert.equal(node(graphOf(seo.postJsonLd(ctx, same)), 'BlogPosting').dateModified, same.publishAt);
  const entry = seo.sitemapEntries(makeCtx({ posts: [same] })).find((e) => e.includes(same.absUrl + '<'));
  assert.ok(entry && entry.includes(`<lastmod>${same.publishAt}</lastmod>`), entry);
});

test('713481f: a cover caption stored as inline runs renders as text in every layout', () => {
  const { renderPost } = require(path.join(ROOT, 'src/blog/render-post.js'));
  const rctx = { depth: '../../', img: (src) => `<img src="${src}">`, films: [], contactHref: {}, postLinks: new Map(), blog: config, related: () => [], featured: [] };
  const caption = (layout, cover) => {
    const html = renderPost(rctx, { ...p1, layout, related: [], cover: { ...p1.cover, ...cover } });
    assert.doesNotMatch(html, /\[object Object\]/, layout);
    return (html.match(/<figcaption class="post-cover__caption">[\s\S]*?<\/figcaption>/) || [''])[0];
  };
  for (const layout of ['editorial', 'cover', 'split', 'guide']) {
    assert.equal(caption(layout, { caption: [{ t: 'Checked at the ' }, { t: 'clinic', b: true }, { t: ' & home' }], credit: 'Photo: R' }),
      '<figcaption class="post-cover__caption"><span>Checked at the <strong>clinic</strong> &amp; home</span><span class="post-cover__credit">Photo: R</span></figcaption>', layout);
    assert.match(caption(layout, { caption: 'Plain <words>', credit: '' }), /<span>Plain &(?:lt|#60);words&(?:gt|#62);<\/span><\/figcaption>$/, layout);
    assert.equal(caption(layout, { caption: [], credit: '' }), '', `${layout}: an empty caption and no credit: no caption at all`);
  }
});

test('E1: a patient photo still waiting for the consent tick never goes outward', () => {
  const pending = enrich({
    ...base, id: 'p_pend', slug: 'pending-consent', status: 'published', publishAt: '2026-11-02T09:00:00+05:30',
    category: 'c_foot', title: 'Pending', dek: 'Pending.', author: 'a_team',
    cover: { src: 'assets/blog/pending-consent/cover.webp', alt: 'A wound', caption: '', credit: '', focal: { x: 0.5, y: 0.5 }, patient: true, consent: false },
    blocks: [{ type: 'image', src: 'assets/blog/pending-consent/heel.webp', alt: 'Heel', width: 'column', align: 'center', patient: true, consent: false }],
  });
  const out = seo.sitemapEntries(makeCtx({ posts: [pending] })).join('');
  assert.ok(out.includes(pending.absUrl), 'the post itself is listed');
  assert.doesNotMatch(out, /pending-consent\/(cover|heel)/);
  assert.doesNotMatch(JSON.stringify(seo.postJsonLd(ctx, pending)), /pending-consent\/cover/);
  assert.doesNotMatch(JSON.stringify(seo.metaFor(ctx, { kind: 'post', post: pending })), /pending-consent\/cover/);
});

// ---------------------------------------------------------------------------
(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
