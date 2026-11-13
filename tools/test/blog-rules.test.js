// Blog rules tests — content-rules.js (blog section), admin/blog-checks.js and
// src/blog/check-refs.js, plus the shipped data/blog files.
//   node tools/test/blog-rules.test.js     (exit 1 on any failure)
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const rules = require(path.join(ROOT, 'admin/content-rules.js'));
const checks = require(path.join(ROOT, 'admin/blog-checks.js'));
const { checkBlogRefs } = require(path.join(ROOT, 'src/blog/check-refs.js'));

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push([name, error]);
  }
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const FILMS = [{ src: 'assets/conditions/severity-b.mp4' }, { src: 'assets/conditions/severity-a.mp4' }];

const baseConfig = () => ({
  name: 'The MediVasc Journal',
  navLabel: 'Blog',
  intro: 'Intro.',
  seo: { title: '', description: '' },
  featured: [],
  categories: [
    { id: 'c_foot', name: 'Diabetic foot', slug: 'diabetic-foot', intro: '', metaDescription: '', tint: 'teal' },
    { id: 'c_pad', name: 'Circulation', slug: 'circulation-pad', intro: '', metaDescription: '', tint: 'clay' },
  ],
  authors: [
    { id: 'a_team', name: 'Care Team', slug: 'care-team', role: '', credentials: '', bio: '', photo: '', sameAs: [] },
    { id: 'a_doc', name: 'Dr A', slug: 'dr-a', role: 'Surgeon', credentials: 'MS', bio: '', photo: 'assets/blog/authors/dr-a.webp', sameAs: ['https://example.org/dr-a'] },
  ],
  redirects: [],
});

const basePost = (over = {}) => Object.assign({
  id: 'p_one',
  slug: 'first-post',
  previousSlugs: [],
  status: 'published',
  publishAt: '2026-11-01T09:00:00+05:30',
  lang: 'en',
  layout: 'editorial',
  category: 'c_foot',
  title: 'Seven warning signs your feet need a doctor',
  titleAccent: 'warning signs',
  dek: 'Most problems start small. Here is what to look for.',
  titleSize: 'L',
  bodySize: 'M',
  leadIn: 'dropcap',
  cover: { src: 'assets/blog/first-post/cover.webp', alt: 'A foot being checked', caption: '', credit: '', focal: { x: 0.5, y: 0.5 }, patient: false },
  author: 'a_team',
  reviewer: null,
  reviewedAt: null,
  seo: { title: '', description: '', focusKeyphrase: '', keywords: [] },
  related: [],
  references: [{ id: 'r1', text: 'IWGDF Guidelines 2023', url: 'https://iwgdfguidelines.org/' }],
  blocks: [
    { type: 'lead', text: 'Feet can be hurt without telling you.' },
    { type: 'heading', level: 2, text: 'Signs to watch' },
    { type: 'paragraph', text: [{ t: 'Look daily.' }, { cite: 'r1' }] },
  ],
}, over);

const errs = (posts, config = baseConfig(), films = FILMS) => rules.validateBlogPostsDetailed(posts, config, films);
const cfgErrs = (config) => rules.validateBlogConfigDetailed(config);
const paths = (errors) => errors.map((e) => e.path);
const hasPath = (errors, p) => paths(errors).includes(p);
const expectPath = (errors, p) => assert.ok(hasPath(errors, p), `expected an error at ${p}, got ${JSON.stringify(errors, null, 1)}`);
const expectClean = (errors) => assert.deepStrictEqual(errors, [], `expected no errors, got ${JSON.stringify(errors, null, 1)}`);
const withBlock = (block, over) => basePost(Object.assign({ blocks: [{ type: 'heading', level: 2, text: 'Start' }, block] }, over || {}));
const blockErrs = (block, over) => errs([withBlock(block, over)]);

// ------------------------------------------------------- validateBlogConfig

test('config: the base config is valid', () => expectClean(cfgErrs(baseConfig())));
test('config: not an object', () => expectPath(cfgErrs(null), ''));
test('config: name and menu label required', () => {
  const c = baseConfig();
  c.name = ' ';
  c.navLabel = '';
  const e = cfgErrs(c);
  expectPath(e, 'name');
  expectPath(e, 'navLabel');
});
test('config: every tint in TINTS is accepted', () => {
  for (const tint of rules.TINTS) {
    const c = baseConfig();
    c.categories[0].tint = tint;
    expectClean(cfgErrs(c));
  }
  assert.deepStrictEqual([...rules.TINTS], ['teal', 'clay', 'sage', 'ochre', 'slate', 'plum']);
});
test('config: unknown or missing tint', () => {
  const c = baseConfig();
  c.categories[0].tint = 'red';
  delete c.categories[1].tint;
  const e = cfgErrs(c);
  expectPath(e, 'categories.0.tint');
  expectPath(e, 'categories.1.tint');
});
test('config: category and author slugs must be lowercase-hyphen', () => {
  for (const bad of ['Diabetic-Foot', 'diabetic foot', 'diabetic--foot', '-foot', 'foot-', '', 7]) {
    const c = baseConfig();
    c.categories[0].slug = bad;
    c.authors[0].slug = bad;
    const e = cfgErrs(c);
    expectPath(e, 'categories.0.slug');
    expectPath(e, 'authors.0.slug');
  }
});
test('config: duplicate category ids and slugs', () => {
  const c = baseConfig();
  c.categories[1].id = 'c_foot';
  c.categories[1].slug = 'diabetic-foot';
  const e = cfgErrs(c);
  expectPath(e, 'categories.1.id');
  expectPath(e, 'categories.1.slug');
});
test('config: duplicate author ids and slugs', () => {
  const c = baseConfig();
  c.authors[1].id = 'a_team';
  c.authors[1].slug = 'care-team';
  const e = cfgErrs(c);
  expectPath(e, 'authors.1.id');
  expectPath(e, 'authors.1.slug');
});
test('config: at least one category and one author', () => {
  const c = baseConfig();
  c.categories = [];
  c.authors = 'x';
  const e = cfgErrs(c);
  expectPath(e, 'categories');
  expectPath(e, 'authors');
});
test('config: author photo inside assets/, profile links https', () => {
  const c = baseConfig();
  c.authors[1].photo = 'https://cdn.example.org/dr.jpg';
  c.authors[1].sameAs = ['http://example.org/', 'https://ok.example.org/'];
  const e = cfgErrs(c);
  expectPath(e, 'authors.1.photo');
  expectPath(e, 'authors.1.sameAs.0');
  assert.ok(!hasPath(e, 'authors.1.sameAs.1'));
});
test('config: featured must be a list without repeats', () => {
  const c = baseConfig();
  c.featured = 'p_one';
  expectPath(cfgErrs(c), 'featured');
  c.featured = ['p_one', 'p_one', ''];
  const e = cfgErrs(c);
  expectPath(e, 'featured.1');
  expectPath(e, 'featured.2');
});
test('config: redirects shape', () => {
  const c = baseConfig();
  c.redirects = [{ from: 'blog/old/', to: 'blog/new/' }];
  expectClean(cfgErrs(c));
  c.redirects = 'blog/old/';
  expectPath(cfgErrs(c), 'redirects');
  c.redirects = [
    { from: '/blog/old/', to: 'blog/new' },
    { from: 'blog/same/', to: 'blog/same/' },
    { from: 'blog/a/', to: 'blog/b/' },
    { from: 'blog/a/', to: 'blog/c/' },
    'nope',
  ];
  const e = cfgErrs(c);
  expectPath(e, 'redirects.0.from');
  expectPath(e, 'redirects.0.to');
  expectPath(e, 'redirects.1');
  expectPath(e, 'redirects.3.from');
  expectPath(e, 'redirects.4');
});
test('config: redirect address forms (post, category, author)', () => {
  const c = baseConfig();
  c.redirects = [
    { from: 'blog/old-post/', to: 'blog/new-post/' },
    { from: 'blog/category/old-name/', to: 'blog/category/new-name/' },
    { from: 'blog/author/old-name/', to: 'blog/author/new-name/' },
    { from: 'blog/retired-post/', to: 'blog/category/diabetic-foot/' },
  ];
  expectClean(cfgErrs(c));
  const bad = [
    'blog/category/old/extra/', // 4 segments
    'blog/a/b/c/',
    'blog/tag/old/', // unknown section
    'blog/category/', // the bare section is not a page
    'blog/author/',
    '../blog/old/',
    'blog/../old/',
    'blog/category/../old/',
    'blog/category/Old-Name/',
    'blog/category/old',
    '/blog/category/old/',
  ];
  for (const url of bad) {
    c.redirects = [{ from: url, to: 'blog/new-post/' }, { from: 'blog/x-post/', to: url }];
    const e = cfgErrs(c);
    expectPath(e, 'redirects.0.from');
    expectPath(e, 'redirects.1.to');
    assert.ok(/blog\/category\/category-address\//.test(e.find((x) => x.path === 'redirects.0.from').message));
  }
  c.redirects = [{ from: 'blog/category/a/', to: 'blog/category/a/' }];
  expectPath(cfgErrs(c), 'redirects.0');
});

// -------------------------------------------------------- validateBlogPosts

test('posts: the base post is valid', () => expectClean(errs([basePost()])));
test('posts: not a list', () => expectPath(errs({}), ''));
test('posts: status must be one of published/scheduled/unpublished', () => {
  for (const s of ['published', 'scheduled', 'unpublished']) expectClean(errs([basePost({ status: s })]));
  expectPath(errs([basePost({ status: 'draft' })]), '0.status');
  expectPath(errs([basePost({ status: undefined })]), '0.status');
});
test('posts: published and scheduled need publishAt with a time zone', () => {
  for (const status of ['published', 'scheduled']) {
    for (const bad of [undefined, '', '2026-11-20T09:00:00', '2026-11-20', '20 Nov 2026', '2026-13-01T09:00:00+05:30']) {
      expectPath(errs([basePost({ status, publishAt: bad })]), '0.publishAt');
    }
    for (const ok of ['2026-11-20T09:00:00+05:30', '2026-11-20T03:30:00Z', '2026-11-20T09:00+05:30', '2026-11-20T09:00:00.250-04:00']) {
      expectClean(errs([basePost({ status, publishAt: ok })]));
    }
  }
});
test('posts: unpublished may omit publishAt but not hold a bad one', () => {
  expectClean(errs([basePost({ status: 'unpublished', publishAt: undefined })]));
  expectClean(errs([basePost({ status: 'unpublished', publishAt: '' })]));
  expectPath(errs([basePost({ status: 'unpublished', publishAt: 'tomorrow' })]), '0.publishAt');
});
test('posts: updatedAt and reviewedAt dates', () => {
  expectPath(errs([basePost({ updatedAt: '2026-11-21' })]), '0.updatedAt');
  expectClean(errs([basePost({ updatedAt: '2026-11-21T10:00:00+05:30', reviewedAt: '2026-11-21' })]));
  expectPath(errs([basePost({ reviewedAt: '21/11/2026' })]), '0.reviewedAt');
});
test('posts: layouts', () => {
  for (const layout of ['editorial', 'cover', 'split']) expectClean(errs([basePost({ layout })]));
  expectPath(errs([basePost({ layout: 'magazine' })]), '0.layout');
  expectPath(errs([basePost({ layout: undefined })]), '0.layout');
  assert.deepStrictEqual([...rules.LAYOUTS], ['editorial', 'cover', 'split', 'guide']);
});
test('posts: guide layout needs two main headings', () => {
  expectPath(errs([basePost({ layout: 'guide' })]), '0.layout');
  const post = basePost({ layout: 'guide' });
  post.blocks.push({ type: 'heading', level: 2, text: 'Second' });
  expectClean(errs([post]));
});
test('posts: size presets and lead-in', () => {
  for (const t of ['S', 'M', 'L', 'XL']) expectClean(errs([basePost({ titleSize: t })]));
  for (const b of ['S', 'M', 'L']) expectClean(errs([basePost({ bodySize: b })]));
  for (const l of ['dropcap', 'smallcaps', 'boldwords', 'none']) expectClean(errs([basePost({ leadIn: l })]));
  expectPath(errs([basePost({ titleSize: 'XXL' })]), '0.titleSize');
  expectPath(errs([basePost({ titleSize: '48px' })]), '0.titleSize');
  expectPath(errs([basePost({ bodySize: 'XL' })]), '0.bodySize');
  expectPath(errs([basePost({ leadIn: 'fancy' })]), '0.leadIn');
});
test('posts: ids, title, dek, accent, lang', () => {
  expectPath(errs([basePost({ id: 'p one' })]), '0.id');
  expectPath(errs([basePost(), basePost({ slug: 'second' })]), '1.id');
  expectPath(errs([basePost({ title: '' })]), '0.title');
  expectPath(errs([basePost({ title: 'Signs <b>now</b>', titleAccent: '' })]), '0.title');
  expectPath(errs([basePost({ dek: '' })]), '0.dek');
  expectPath(errs([basePost({ titleAccent: 'warning sig' })]), '0.titleAccent');
  expectPath(errs([basePost({ lang: 'english' })]), '0.lang');
});
test('posts: category, author and reviewer must exist', () => {
  const e = errs([basePost({ category: 'c_gone', author: 'a_gone', reviewer: 'a_gone' })]);
  expectPath(e, '0.category');
  expectPath(e, '0.author');
  expectPath(e, '0.reviewer');
  expectClean(errs([basePost({ reviewer: 'a_doc' })]));
  expectPath(errs([basePost({ category: '' })]), '0.category');
});
test('posts: cover required, with alt text and a focus point in 0..1', () => {
  expectPath(errs([basePost({ cover: undefined })]), '0.cover');
  const noAlt = basePost();
  noAlt.cover.alt = ' ';
  expectPath(errs([noAlt]), '0.cover.alt');
  const badFocal = basePost();
  badFocal.cover.focal = { x: 1.2, y: 0.5 };
  expectPath(errs([badFocal]), '0.cover.focal');
});
test('posts: image src must be an image file inside assets/', () => {
  for (const bad of ['https://cdn.example.org/a.webp', 'draft:cover.webp', '/assets/blog/a.webp', 'assets/../secret.webp', 'assets/blog/a.gif', 'assets/blog/.hidden.webp']) {
    const post = basePost();
    post.cover.src = bad;
    expectPath(errs([post]), '0.cover.src');
  }
  for (const ok of ['assets/blog/a/cover.webp', 'assets/blog/a/c.JPG', 'assets/x.jpeg', 'assets/a/b/c.png', 'assets/a.avif']) {
    const post = basePost();
    post.cover.src = ok;
    expectClean(errs([post]));
  }
});
test('posts: unique slugs, including old addresses', () => {
  expectPath(errs([basePost(), basePost({ id: 'p_two' })]), '1.slug');
  expectPath(errs([basePost(), basePost({ id: 'p_two', slug: 'second', previousSlugs: ['first-post'] })]), '1.previousSlugs.0');
  expectPath(errs([basePost({ previousSlugs: ['old-one'] }), basePost({ id: 'p_two', slug: 'old-one' })]), '1.slug');
  expectPath(errs([basePost({ previousSlugs: ['first-post'] })]), '0.previousSlugs.0');
  expectPath(errs([basePost({ previousSlugs: 'old' })]), '0.previousSlugs');
  expectPath(errs([basePost({ previousSlugs: ['Old Address'] })]), '0.previousSlugs.0');
  expectClean(errs([basePost({ previousSlugs: ['old-one'] }), basePost({ id: 'p_two', slug: 'second', previousSlugs: ['older-two'] })]));
});
test('posts: slug shape and reserved addresses', () => {
  for (const bad of ['First-Post', 'first post', 'first_post', '', undefined]) expectPath(errs([basePost({ slug: bad })]), '0.slug');
  for (const reserved of ['category', 'author']) expectPath(errs([basePost({ slug: reserved })]), '0.slug');
});
test('posts: related ids must exist and not be the post itself', () => {
  const e = errs([basePost({ related: ['p_one', 'p_ghost'] })]);
  expectPath(e, '0.related.0');
  expectPath(e, '0.related.1');
  expectClean(errs([basePost({ related: ['p_two'] }), basePost({ id: 'p_two', slug: 'second' })]));
});
test('posts: featured ids must name a post in the list', () => {
  const config = baseConfig();
  config.featured = ['p_one', 'p_ghost'];
  const e = errs([basePost()], config);
  expectPath(e, 'config.featured.1');
  assert.ok(!hasPath(e, 'config.featured.0'));
  config.featured = ['p_one'];
  expectClean(errs([basePost({ status: 'scheduled', publishAt: '2099-01-01T09:00:00+05:30' })], config));
});
test('posts: no content', () => {
  expectPath(errs([basePost({ blocks: [] })]), '0.blocks');
  expectPath(errs([basePost({ blocks: undefined })]), '0.blocks');
});
test('posts: references', () => {
  const post = basePost({ references: [{ id: 'r1', text: 'A', url: 'http://x.org' }, { id: 'r1', text: '' }] });
  const e = errs([post]);
  expectPath(e, '0.references.0.url');
  expectPath(e, '0.references.1.id');
  expectPath(e, '0.references.1.text');
});

// Inline text.
test('inline: href allowlist', () => {
  const allowed = ['https://www.iwgdf.org/x?y=1', 'mailto:care@medivasc.in', 'tel:+91 98765 43210', 'tel:011-2345-6789', 'blog/first-post/', 'blog/first-post/#signs', '#signs'];
  const blocked = ['http://example.org/', 'javascript:alert(1)', '/blog/first-post/', '../first-post/', 'blog/First-Post/', 'blog/first-post', 'mailto:nobody', 'tel:call-us', 'www.example.org', '#', 'data:text/html,x', 'https://exa mple.org'];
  for (const href of allowed) assert.ok(rules.blogHrefAllowed(href), `should allow ${href}`);
  for (const href of blocked) assert.ok(!rules.blogHrefAllowed(href), `should block ${href}`);
  expectPath(blockErrs({ type: 'paragraph', text: [{ t: 'Read ', href: 'javascript:alert(1)' }] }), '0.blocks.1.text.0.href');
  expectClean(blockErrs({ type: 'paragraph', text: [{ t: 'Read', href: 'blog/other-post/' }] }));
});
test('inline: runs, marks, HTML and citations', () => {
  expectPath(blockErrs({ type: 'paragraph', text: 'Use <b>bold</b>' }), '0.blocks.1.text');
  expectPath(blockErrs({ type: 'paragraph', text: [{ t: 'a', u: true }] }), '0.blocks.1.text.0');
  expectPath(blockErrs({ type: 'paragraph', text: [{ t: 'a', b: 'yes' }] }), '0.blocks.1.text.0.b');
  expectPath(blockErrs({ type: 'paragraph', text: [{ t: 7 }] }), '0.blocks.1.text.0.t');
  expectPath(blockErrs({ type: 'paragraph', text: [{ t: 'x' }, { cite: 'r9' }] }), '0.blocks.1.text.1.cite');
  expectPath(blockErrs({ type: 'paragraph', text: [{ t: 'x' }, { cite: 'r1', b: true }] }), '0.blocks.1.text.1');
  expectPath(blockErrs({ type: 'paragraph', text: [{ cite: 'r1' }] }), '0.blocks.1.text');
  expectPath(blockErrs({ type: 'paragraph', text: [{ t: '   ' }] }), '0.blocks.1.text');
  expectPath(blockErrs({ type: 'paragraph', text: 42 }), '0.blocks.1.text');
  expectClean(blockErrs({ type: 'paragraph', text: [{ t: 'Bold', b: true, i: true, hl: true }, { cite: 'r1' }] }));
});

// Every block type.
const VALID_BLOCKS = {
  paragraph: { type: 'paragraph', text: 'Text.' },
  lead: { type: 'lead', text: [{ t: 'Intro.' }] },
  heading: { type: 'heading', level: 3, text: 'Sub', size: 'S', anchor: 'sub-1' },
  list: { type: 'list', style: 'number', items: ['One', [{ t: 'Two', b: true }]] },
  quote: { type: 'quote', text: 'Said.', cite: 'A patient' },
  pullquote: { type: 'pullquote', text: 'Pulled.', cite: '' },
  image: { type: 'image', src: 'assets/blog/a/i.webp', alt: 'Alt', caption: [{ t: 'Cap' }], credit: 'Me', width: 'column', align: 'left', size: 'M', patient: true },
  gallery: { type: 'gallery', images: [{ src: 'assets/a.webp', alt: 'A' }, { src: 'assets/b.webp', alt: 'B', caption: 'b', patient: false }], caption: 'Both' },
  imageText: { type: 'imageText', image: { src: 'assets/a.webp', alt: 'A' }, side: 'right', text: ['One.', [{ t: 'Two.' }]] },
  callout: { type: 'callout', tone: 'doctor', text: 'See a doctor today if…' },
  takeaways: { type: 'takeaways', items: ['Check daily.'] },
  divider: { type: 'divider' },
  table: { type: 'table', caption: 'T', header: ['A', 'B'], rows: [['1', [{ t: '2' }]]] },
  video: { type: 'video', source: 'film', src: 'assets/conditions/severity-b.mp4', caption: 'Shared with consent.' },
  faq: { type: 'faq', items: [{ q: 'Why?', a: 'Because.' }] },
  cta: { type: 'cta', kind: 'whatsapp', label: 'Message us', text: 'We reply.' },
};
test('blocks: one valid example of every block type', () => {
  assert.deepStrictEqual(Object.keys(VALID_BLOCKS).sort(), [...rules.BLOCK_TYPES].sort());
  for (const block of Object.values(VALID_BLOCKS)) expectClean(blockErrs(clone(block)));
  expectClean(blockErrs({ type: 'video', source: 'youtube', youtube: 'dQw4w9WgXcQ' }));
});
test('blocks: unknown type', () => expectPath(blockErrs({ type: 'html', html: '<p>' }), '0.blocks.1.type'));
const missing = (type, field, mutate) => {
  const block = clone(VALID_BLOCKS[type]);
  mutate(block);
  expectPath(blockErrs(block), `0.blocks.1.${field}`);
};
test('blocks: required fields per type', () => {
  missing('paragraph', 'text', (b) => { delete b.text; });
  missing('lead', 'text', (b) => { b.text = ''; });
  missing('heading', 'text', (b) => { b.text = ''; });
  missing('heading', 'level', (b) => { b.level = 4; });
  missing('heading', 'size', (b) => { b.size = 'XL'; });
  missing('heading', 'anchor', (b) => { b.anchor = 'has space'; });
  missing('list', 'style', (b) => { delete b.style; });
  missing('list', 'items', (b) => { b.items = []; });
  missing('list', 'items.0', (b) => { b.items = ['']; });
  missing('quote', 'text', (b) => { delete b.text; });
  missing('quote', 'cite', (b) => { b.cite = 5; });
  missing('pullquote', 'text', (b) => { b.text = [{ t: 'runs are not allowed' }]; });
  missing('image', 'src', (b) => { delete b.src; });
  missing('image', 'alt', (b) => { b.alt = ''; });
  missing('image', 'width', (b) => { b.width = 'half'; });
  missing('image', 'align', (b) => { delete b.align; });
  missing('image', 'size', (b) => { b.size = 'XL'; });
  missing('image', 'patient', (b) => { b.patient = 'yes'; });
  missing('gallery', 'images.1.alt', (b) => { b.images[1].alt = ''; });
  missing('imageText', 'image', (b) => { delete b.image; });
  missing('imageText', 'image.alt', (b) => { delete b.image.alt; });
  missing('imageText', 'side', (b) => { b.side = 'top'; });
  missing('imageText', 'text', (b) => { b.text = []; });
  missing('callout', 'tone', (b) => { b.tone = 'warning'; });
  missing('callout', 'text', (b) => { delete b.text; });
  missing('takeaways', 'items', (b) => { delete b.items; });
  missing('table', 'header', (b) => { b.header = []; });
  missing('table', 'header.1', (b) => { b.header[1] = ''; });
  missing('table', 'rows', (b) => { b.rows = []; });
  missing('table', 'rows.0', (b) => { b.rows[0] = ['only one']; });
  missing('video', 'source', (b) => { delete b.source; });
  missing('video', 'src', (b) => { delete b.src; });
  missing('faq', 'items', (b) => { b.items = []; });
  missing('faq', 'items.0.q', (b) => { b.items[0].q = ''; });
  missing('faq', 'items.0.a', (b) => { delete b.items[0].a; });
  missing('cta', 'kind', (b) => { b.kind = 'email'; });
});
test('blocks: a wide or full image cannot float', () => {
  missing('image', 'align', (b) => { b.width = 'wide'; b.align = 'right'; });
  const ok = clone(VALID_BLOCKS.image);
  ok.width = 'full';
  ok.align = 'center';
  expectClean(blockErrs(ok));
});
test('blocks: gallery holds 2 or 3 images', () => {
  const img = { src: 'assets/a.webp', alt: 'A' };
  for (const n of [0, 1, 4]) expectPath(blockErrs({ type: 'gallery', images: Array(n).fill(img) }), '0.blocks.1.images');
  for (const n of [2, 3]) expectClean(blockErrs({ type: 'gallery', images: Array(n).fill(img) }));
});
test('blocks: video sources', () => {
  for (const bad of ['short', 'dQw4w9WgXcQ1', 'https://youtu.be/dQw4w9WgXcQ', undefined]) {
    expectPath(blockErrs({ type: 'video', source: 'youtube', youtube: bad }), '0.blocks.1.youtube');
  }
  expectPath(blockErrs({ type: 'video', source: 'vimeo' }), '0.blocks.1.source');
});
test('blocks: film srcs are checked against the films passed in', () => {
  const block = { type: 'video', source: 'film', src: 'assets/conditions/gone.mp4' };
  expectPath(errs([withBlock(block)]), '0.blocks.1.src');
  expectClean(errs([withBlock(block)], baseConfig(), [{ src: 'assets/conditions/gone.mp4' }]));
  expectClean(errs([withBlock(block)], baseConfig(), ['assets/conditions/gone.mp4']));
  // Without a films list the membership check is skipped (shape still checked).
  expectClean(rules.validateBlogPostsDetailed([withBlock(block)], baseConfig()));
  // The plain-message API takes films as its third argument too.
  const messages = rules.validateBlogPosts([withBlock(block)], baseConfig(), FILMS);
  assert.strictEqual(messages.length, 1);
  assert.ok(/not one of the site's videos/.test(messages[0]), messages[0]);
  assert.deepStrictEqual(rules.validateBlogPosts([withBlock(block)], baseConfig()), []);
});
test('headings: levels 2|3 and no H3 before the first H2', () => {
  expectPath(errs([basePost({ blocks: [{ type: 'heading', level: 3, text: 'Early' }, { type: 'heading', level: 2, text: 'Main' }] })]), '0.blocks.0.level');
  expectClean(errs([basePost({ blocks: [{ type: 'paragraph', text: 'x' }, { type: 'heading', level: 2, text: 'Main' }, { type: 'heading', level: 3, text: 'Sub' }, { type: 'heading', level: 3, text: 'Sub 2' }, { type: 'heading', level: 2, text: 'Main 2' }] })]));
  expectPath(errs([basePost({ blocks: [{ type: 'heading', level: 1, text: 'Title' }] })]), '0.blocks.0.level');
  expectPath(errs([basePost({ blocks: [{ type: 'heading', level: '2', text: 'Title' }] })]), '0.blocks.0.level');
});
test('headings: section link names unique within a post', () => {
  const e = errs([basePost({ blocks: [{ type: 'heading', level: 2, text: 'A', anchor: 'same' }, { type: 'heading', level: 2, text: 'B', anchor: 'same' }] })]);
  expectPath(e, '0.blocks.1.anchor');
  assert.ok(!hasPath(e, '0.blocks.0.anchor'));
});
test('messages are plain words (no raw paths or code words)', () => {
  const e = errs([basePost({ status: 'draft', layout: 'x', blocks: [{ type: 'image', src: 'x', alt: '' }] })]);
  assert.ok(e.length >= 4);
  for (const { message } of e) {
    assert.ok(/^Blog post “/.test(message), message);
    assert.ok(!/undefined|null|\[object/.test(message), message);
  }
});

// ------------------------------------------------------------- seoChecklist

const LONG_WORDS = (n) => Array.from({ length: n }, (_, i) => (i % 12 === 11 ? 'care.' : 'care')).join(' ');
const seoPost = (over = {}) => basePost(Object.assign({
  slug: 'diabetic-foot-warning-signs',
  title: 'Diabetic foot warning signs to never ignore',
  titleAccent: '',
  dek: 'Short dek.',
  seo: {
    title: '',
    description: 'The diabetic foot warning signs that need a doctor — wounds that will not heal, colour change, numbness and what to do next.',
    focusKeyphrase: 'diabetic foot warning signs',
    keywords: [],
  },
  cover: { src: 'assets/blog/a/cover.webp', alt: 'Diabetic foot warning signs being checked by a nurse' },
  blocks: [
    { type: 'lead', text: 'These diabetic foot warning signs matter. Check every day.' },
    { type: 'heading', level: 2, text: 'Diabetic foot warning signs' },
    { type: 'paragraph', text: [{ t: LONG_WORDS(620) }, { t: ' Read more', href: 'blog/other-post/' }] },
  ],
}, over));
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
const status = (post, id, all) => {
  const item = byId(checks.seoChecklist(post, all || [post]))[id];
  assert.ok(item, `no ${id} item`);
  assert.ok(typeof item.message === 'string' && item.message.length > 10);
  return item.status;
};
const IDS = ['keyphrase', 'keyphrase-title', 'keyphrase-slug', 'keyphrase-intro', 'keyphrase-heading', 'keyphrase-description', 'keyphrase-alt', 'keyphrase-unique', 'title-length', 'description-length', 'length', 'readability', 'internal-link', 'alt-text'];

test('seo: a well-optimised post is green on every check', () => {
  const items = checks.seoChecklist(seoPost(), [seoPost()]);
  assert.deepStrictEqual(items.map((i) => i.id).sort(), [...IDS].sort());
  for (const item of items) assert.strictEqual(item.status, 'good', `${item.id}: ${item.message}`);
});
test('seo: no keyphrase → only the keyphrase prompt, no placement checks', () => {
  const post = seoPost();
  post.seo.focusKeyphrase = '  ';
  const items = byId(checks.seoChecklist(post, [post]));
  assert.strictEqual(items.keyphrase.status, 'warn');
  assert.ok(!items['keyphrase-title'] && !items['keyphrase-unique']);
});
test('seo: keyphrase placement warns', () => {
  assert.strictEqual(status(seoPost({ title: 'What to look for on your feet' }), 'keyphrase-title'), 'warn');
  assert.strictEqual(status(seoPost({ slug: 'seven-signs' }), 'keyphrase-slug'), 'warn');
  const intro = seoPost();
  intro.blocks[0].text = 'Check every day.';
  assert.strictEqual(status(intro, 'keyphrase-intro'), 'warn');
  const heading = seoPost();
  heading.blocks[1].text = 'What to look for';
  assert.strictEqual(status(heading, 'keyphrase-heading'), 'warn');
  const h3 = seoPost();
  h3.blocks.push({ type: 'heading', level: 3, text: 'Diabetic foot warning signs' });
  h3.blocks[1].text = 'What to look for';
  assert.strictEqual(status(h3, 'keyphrase-heading'), 'warn', 'only H2s count');
  const desc = seoPost();
  desc.seo.description = 'A guide to what to look for. '.repeat(5).trim();
  assert.strictEqual(status(desc, 'keyphrase-description'), 'warn');
  const alt = seoPost();
  alt.cover.alt = 'A nurse checks a foot';
  assert.strictEqual(status(alt, 'keyphrase-alt'), 'warn');
});
test('seo: keyphrase words in any order count, hyphens and case ignored', () => {
  const post = seoPost({ title: 'Warning signs of a diabetic foot' });
  assert.strictEqual(status(post, 'keyphrase-title'), 'good');
  assert.ok(/different order/.test(byId(checks.seoChecklist(post, [post]))['keyphrase-title'].message));
  assert.strictEqual(status(seoPost({ title: 'DIABETIC-FOOT warning signs' }), 'keyphrase-title'), 'good');
});
test('seo: cannibalisation across posts', () => {
  const a = seoPost();
  const b = seoPost({ id: 'p_two', slug: 'other', title: 'Another' });
  b.seo = Object.assign({}, b.seo, { focusKeyphrase: 'Diabetic  foot warning-signs' });
  assert.strictEqual(status(a, 'keyphrase-unique', [a, b]), 'warn');
  assert.ok(/“Another”/.test(byId(checks.seoChecklist(a, [a, b]))['keyphrase-unique'].message));
  // The same post (same id, e.g. an edited copy) is not a competitor.
  assert.strictEqual(status(a, 'keyphrase-unique', [a, clone(a)]), 'good');
  b.seo.focusKeyphrase = 'diabetic foot care';
  assert.strictEqual(status(a, 'keyphrase-unique', [a, b]), 'good');
});
test('seo: title length (search title wins over title)', () => {
  assert.strictEqual(status(seoPost({ title: `Diabetic foot warning signs ${'x'.repeat(40)}` }), 'title-length'), 'warn');
  const post = seoPost({ title: `Diabetic foot warning signs ${'x'.repeat(40)}` });
  post.seo.title = 'Diabetic foot warning signs';
  assert.strictEqual(status(post, 'title-length'), 'good');
  assert.strictEqual(status(seoPost({ title: 'x'.repeat(60) }), 'title-length'), 'good');
});
test('seo: description length 120–160 (falls back to the dek)', () => {
  const mk = (n) => {
    const post = seoPost();
    post.seo.description = `diabetic foot warning signs ${'a'.repeat(n - 28)}`;
    return post;
  };
  assert.strictEqual(status(mk(119), 'description-length'), 'warn');
  assert.strictEqual(status(mk(120), 'description-length'), 'good');
  assert.strictEqual(status(mk(160), 'description-length'), 'good');
  assert.strictEqual(status(mk(161), 'description-length'), 'warn');
  const fallback = seoPost({ dek: 'd'.repeat(130) });
  fallback.seo.description = '';
  assert.strictEqual(status(fallback, 'description-length'), 'good');
  assert.ok(/summary/.test(byId(checks.seoChecklist(fallback, [fallback]))['description-length'].message));
});
test('seo: word count', () => {
  const mk = (n) => {
    const post = seoPost();
    post.blocks[2].text = [{ t: LONG_WORDS(n) }, { t: ' x', href: 'blog/other-post/' }];
    return post;
  };
  assert.strictEqual(status(mk(700), 'length'), 'good');
  assert.strictEqual(status(mk(400), 'length'), 'warn');
  assert.strictEqual(status(mk(100), 'length'), 'warn');
});
test('seo: readability', () => {
  const post = seoPost();
  post.blocks[2].text = `${LONG_WORDS(40).replace(/\./g, '')}. `.repeat(20);
  assert.strictEqual(status(post, 'readability'), 'warn');
});
test('seo: internal links anywhere in the body count (captions included)', () => {
  const none = seoPost();
  none.blocks[2].text = LONG_WORDS(620);
  assert.strictEqual(status(none, 'internal-link'), 'warn');
  const external = clone(none);
  external.blocks.push({ type: 'paragraph', text: [{ t: 'IWGDF', href: 'https://iwgdf.org/' }] });
  assert.strictEqual(status(external, 'internal-link'), 'warn');
  const viaGallery = clone(none);
  viaGallery.blocks.push({ type: 'gallery', images: [{ src: 'assets/a.webp', alt: 'A', caption: [{ t: 'see', href: 'blog/x/' }] }, { src: 'assets/b.webp', alt: 'B' }] });
  assert.strictEqual(status(viaGallery, 'internal-link'), 'good');
  const viaFaq = clone(none);
  viaFaq.blocks.push({ type: 'faq', items: [{ q: 'Q?', a: [{ t: 'see', href: 'blog/x/#a' }] }] });
  assert.strictEqual(status(viaFaq, 'internal-link'), 'good');
  const viaTable = clone(none);
  viaTable.blocks.push({ type: 'table', header: ['A'], rows: [[[{ t: 'see', href: 'blog/x/' }]]] });
  assert.strictEqual(status(viaTable, 'internal-link'), 'good');
});
test('seo: alt text on every image', () => {
  const post = seoPost();
  post.blocks.push({ type: 'image', src: 'assets/a.webp', alt: '', width: 'column', align: 'center' });
  assert.strictEqual(status(post, 'alt-text'), 'warn');
  assert.ok(/1 of 2 images/.test(byId(checks.seoChecklist(post, [post]))['alt-text'].message));
  assert.strictEqual(status(seoPost({ cover: undefined }), 'alt-text'), 'warn');
});
test('seo: bad input never throws', () => {
  assert.deepStrictEqual(checks.seoChecklist(null, []), []);
  checks.seoChecklist({ blocks: [null, 7, { type: 'list' }] }, null);
  checks.seoChecklist({ title: 5, seo: 'x', blocks: 'x' });
});

// --------------------------------------------------------------- claimsCheck

const claimPost = (sentence) => basePost({ blocks: [{ type: 'paragraph', text: sentence }] });
const flagged = (sentence) => checks.claimsCheck(claimPost(sentence)).filter((i) => i.status === 'warn');
// "जड़ से खत्म" with the nukta letter written both ways (precomposed ड़ and ड + ़).
const JAD_PRE = `ज${String.fromCharCode(0x095c)} से खत्म`;
const JAD_DECOMP = `ज${String.fromCharCode(0x0921, 0x093c)} से ख${String.fromCharCode(0x093c)}त्म`;
const RISKY = [
  'We cure diabetic foot ulcers.', 'This wound is curable at home.', 'Results are guaranteed.', 'A 100% success rate.',
  'Results 100 percent of the time.', 'A permanent cure for swelling.', 'It is a permanent solution.', 'Swelling gone forever.',
  'A miracle treatment.', 'This magic oil works.', 'No amputation ever.', 'You will never need an amputation.',
  'Our care prevents amputation.', 'We save your leg.', 'Reverse diabetes in weeks.', 'Live diabetes-free.',
  'Get rid of diabetes.', 'Treatment without surgery.', 'No side effects.', 'It is completely safe.', 'A risk-free option.',
  'Instant relief.', 'Wounds healed in 3 weeks.', 'Walking again within two months.', 'Fully healed.',
  'The best doctor in Delhi.', 'Top specialists.', "India's best clinic.", 'The only treatment that works.', 'Clinically proven.',
  'See our before and after photos.', 'Before/after pictures.', 'Pakka ilaj milega.', 'Sugar jad se khatam.', 'Chamatkari dawa.',
  'गारंटी के साथ', 'चमत्कारी इलाज', 'पक्का इलाज', JAD_PRE, JAD_DECOMP, 'Number one clinic.', 'Guarantee milegi, 100% ilaj.',
];
const SAFE = [
  'There is no cure for diabetes, but it can be managed well.', 'Neuropathy cannot be cured, but pain can be eased.',
  'Lymphoedema is not curable; it is controllable.', 'There is no known cure yet.', 'An incurable fear of doctors.',
  'Wash your hands before and after touching the wound.', 'Good care can help prevent amputation.', 'Care that helps save the leg.',
  'Nerve damage can be permanent.', 'The best way to check your feet is daily.', 'Keep your shoes secure.',
  'Healing takes weeks and differs for everyone.', 'Ask your doctor about the risks and side effects.',
  'Most people heal well with steady care.',
];
test('claims: every risky phrase is flagged', () => {
  for (const s of RISKY) assert.ok(flagged(s).length >= 1, `not flagged: ${s}`);
});
test('claims: honest wording is not flagged', () => {
  for (const s of SAFE) assert.deepStrictEqual(flagged(s).map((i) => i.phrase), [], `false alarm: ${s}`);
});
test('claims: item shape, plain message, and the not-legal-advice note', () => {
  const [item] = flagged('We cure ulcers.');
  assert.deepStrictEqual(Object.keys(item).sort(), ['id', 'message', 'phrase', 'status', 'where']);
  assert.strictEqual(item.phrase, 'cure');
  assert.strictEqual(item.where, 'block 1 (Paragraph)');
  assert.ok(/^In block 1 \(Paragraph\): “cure”\. Avoid promising a cure\./.test(item.message), item.message);
  const clear = checks.claimsCheck(claimPost('Check your feet daily.'));
  assert.strictEqual(clear.length, 1);
  assert.strictEqual(clear[0].status, 'good');
  assert.ok(clear[0].message.includes(checks.CLAIMS_NOTE));
  assert.ok(/not legal advice/.test(checks.CLAIMS_NOTE));
});
test('claims: scans title, dek, captions, alt text, FAQs, tables and buttons', () => {
  const post = basePost({ title: 'A miracle for feet', dek: 'Guaranteed.' });
  post.cover.alt = 'Before and after photos';
  post.blocks = [
    { type: 'faq', items: [{ q: 'Is it 100% safe?', a: 'Yes' }] },
    { type: 'table', header: ['Result'], rows: [['Permanent relief']] },
    { type: 'cta', kind: 'call', label: 'Book the best doctor' },
    { type: 'gallery', images: [{ src: 'assets/a.webp', alt: 'A', caption: 'Fully healed' }, { src: 'assets/b.webp', alt: 'B' }] },
  ];
  const where = checks.claimsCheck(post).map((i) => i.where);
  for (const w of ['the title', 'the summary under the title', 'the cover image alt text', 'block 1 (Questions)', 'block 2 (Table)', 'block 3 (Contact button)', 'block 4 (Gallery), image 1 caption']) {
    assert.ok(where.includes(w), `nothing found in ${w}: ${JSON.stringify(where)}`);
  }
});
test('claims: one item per phrase per place, ids unique', () => {
  const items = flagged('We cure. We cure. We CURE.');
  assert.strictEqual(items.length, 1);
  const many = checks.claimsCheck(basePost({ title: 'Cure', dek: 'Cure' }));
  assert.strictEqual(new Set(many.map((i) => i.id)).size, many.length);
  assert.deepStrictEqual(checks.claimsCheck(null).map((i) => i.id), ['claims-clear']);
});

// ------------------------------------------------------------ checkBlogRefs

const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-blog-refs-'));
  for (const file of ['assets/blog/one/cover.webp', 'assets/blog/one/a.webp', 'assets/blog/one/b.webp', 'assets/blog/two/cover.webp', 'assets/blog/authors/dr-a.webp']) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'x');
  }
  return dir;
};
const NOW = new Date('2026-11-12T12:00:00+05:30');
const refPosts = () => [
  basePost({
    id: 'p_one',
    slug: 'one',
    cover: { src: 'assets/blog/one/cover.webp', alt: 'c' },
    blocks: [
      { type: 'paragraph', text: [{ t: 'See ' }, { t: 'two', href: 'blog/two/' }, { t: ' and ', href: 'blog/two/#part' }] },
      { type: 'gallery', images: [{ src: 'assets/blog/one/a.webp', alt: 'a' }, { src: 'assets/blog/one/b.webp', alt: 'b' }] },
      { type: 'video', source: 'film', src: 'assets/conditions/severity-b.mp4' },
      { type: 'paragraph', text: [{ t: 'external', href: 'https://example.org/' }, { t: 'self', href: 'blog/one/' }] },
    ],
  }),
  basePost({ id: 'p_two', slug: 'two', previousSlugs: ['two-old'], cover: { src: 'assets/blog/two/cover.webp', alt: 'c' } }),
];
const refConfig = () => Object.assign(baseConfig(), { featured: ['p_two', 'p_one'] });
const refs = (dir, posts, config, opts) => checkBlogRefs(posts, config || refConfig(), Object.assign({ root: dir, films: FILMS, now: NOW }, opts || {}));
const fields = (problems) => problems.map((p) => `${p.postId}:${p.field}`);

test('refs: a clean fixture has no problems', () => {
  const dir = fixture();
  try {
    expectClean(refs(dir, refPosts()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: missing images (cover, gallery, image, imageText, author photo, wrong letter case)', () => {
  const dir = fixture();
  try {
    const posts = refPosts();
    posts[0].cover.src = 'assets/blog/one/Cover.webp';
    posts[0].blocks[1].images[1].src = 'assets/blog/one/gone.webp';
    posts[0].blocks.push({ type: 'image', src: 'assets/blog/one/nope.webp', alt: 'x', width: 'column', align: 'center' });
    posts[0].blocks.push({ type: 'imageText', image: { src: 'assets/../../etc/hosts', alt: 'x' }, side: 'left', text: ['x'] });
    const config = refConfig();
    config.authors[1].photo = 'assets/blog/authors/missing.webp';
    const problems = refs(dir, posts, config);
    assert.deepStrictEqual(fields(problems).sort(), [
      'null:authors.1.photo', 'p_one:blocks.1.images.1.src', 'p_one:blocks.4.src', 'p_one:blocks.5.image.src', 'p_one:cover.src',
    ]);
    const cover = problems.find((p) => p.field === 'cover.src');
    assert.ok(/^Blog post “.+”: the cover image \(assets\/blog\/one\/Cover\.webp\) is not in the site files\. Upload it again/.test(cover.message), cover.message);
    assert.ok(/Care Team|Dr A/.test(problems.find((p) => p.field === 'authors.1.photo').message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: dead internal links', () => {
  const dir = fixture();
  try {
    const posts = refPosts();
    posts[0].blocks[0].text[1].href = 'blog/three/';
    posts[1].blocks = [{ type: 'faq', items: [{ q: 'Q', a: [{ t: 'see', href: 'blog/nowhere/#x' }] }] }];
    posts[1].cover.caption = [{ t: 'cap', href: 'blog/ghost/' }];
    const problems = refs(dir, posts);
    assert.deepStrictEqual(fields(problems).sort(), ['p_one:blocks.0.text.1.href', 'p_two:blocks.0.items.0.a.0.href', 'p_two:cover.caption.0.href']);
    const msg = problems.find((p) => p.field === 'blocks.0.text.1.href').message;
    assert.ok(/the link “two” goes to blog\/three\/, but there is no post at that address/.test(msg), msg);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: old addresses and settings redirects still resolve', () => {
  const dir = fixture();
  try {
    const posts = refPosts();
    posts[0].blocks[0].text[1].href = 'blog/two-old/';
    posts[0].blocks[0].text[2].href = 'blog/moved/';
    const config = refConfig();
    config.redirects = [{ from: 'blog/moved/', to: 'blog/two/' }];
    expectClean(refs(dir, posts, config));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: links to posts that are unpublished or not live yet', () => {
  const dir = fixture();
  try {
    const posts = refPosts();
    posts[1].status = 'unpublished';
    let problems = refs(dir, posts);
    assert.deepStrictEqual(fields(problems), ['p_one:blocks.0.text.1.href', 'p_one:blocks.0.text.2.href']);
    assert.ok(/not published/.test(problems[0].message));
    posts[1].status = 'scheduled';
    posts[1].publishAt = '2026-12-01T09:00:00+05:30';
    problems = refs(dir, posts);
    assert.strictEqual(problems.length, 2);
    assert.ok(/not live yet/.test(problems[0].message), problems[0].message);
    // A post that itself goes live later only needs its target live by then.
    posts[0].status = 'scheduled';
    posts[0].publishAt = '2026-12-02T09:00:00+05:30';
    expectClean(refs(dir, posts));
    posts[0].publishAt = '2026-11-30T09:00:00+05:30';
    assert.ok(/by the time this post goes live/.test(refs(dir, posts)[0].message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: unpublished posts are not checked', () => {
  const dir = fixture();
  try {
    const posts = refPosts();
    posts[0].status = 'unpublished';
    posts[0].cover.src = 'assets/blog/one/gone.webp';
    posts[0].blocks[0].text[1].href = 'blog/ghost/';
    posts[0].blocks[2].src = 'assets/conditions/gone.mp4';
    expectClean(refs(dir, posts));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: featured ids must be in the posts', () => {
  const dir = fixture();
  try {
    const config = refConfig();
    config.featured = ['p_two', 'p_s01', 'p_one'];
    const problems = refs(dir, refPosts(), config);
    assert.deepStrictEqual(problems.map((p) => [p.postId, p.field]), [[null, 'featured.1']]);
    assert.ok(/featured post “p_s01” does not exist/.test(problems[0].message));
    // A featured post that is scheduled for later is fine (the build skips it).
    const posts = refPosts();
    posts[1].status = 'scheduled';
    posts[1].publishAt = '2027-01-01T09:00:00+05:30';
    posts[0].blocks[0].text = 'no links';
    expectClean(refs(dir, posts));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: film srcs must be site videos (films as objects or strings)', () => {
  const dir = fixture();
  try {
    const posts = refPosts();
    posts[0].blocks[2].src = 'assets/conditions/old.mp4';
    assert.deepStrictEqual(fields(refs(dir, posts)), ['p_one:blocks.2.src']);
    assert.deepStrictEqual(fields(refs(dir, posts, null, { films: ['assets/conditions/old.mp4'] })), []);
    assert.deepStrictEqual(fields(refs(dir, posts, null, { films: undefined })), [], 'no films list → skipped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('refs: odd input never throws', () => {
  assert.deepStrictEqual(checkBlogRefs(null, null, {}), []);
  assert.deepStrictEqual(checkBlogRefs([null, 3, { status: 'published', blocks: 'x', cover: 'x' }], {}, { root: os.tmpdir() }), []);
});

// --------------------------------------------------------- the shipped data

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
test('data: shipped config is valid and features no sample posts', () => {
  const config = readJson('data/blog/config.json');
  const posts = readJson('data/blog/posts.json');
  expectClean(cfgErrs(config));
  const ids = new Set(posts.map((p) => p.id));
  for (const id of config.featured) assert.ok(ids.has(id), `config.json features ${id}, which is not in posts.json`);
  expectClean(errs(posts, config, readJson('data/films.json')));
  expectClean(checkBlogRefs(posts, config, { root: ROOT, films: readJson('data/films.json') }));
});
test('data: samples (+ samples.config.json) are valid and all refs resolve', () => {
  const config = Object.assign(readJson('data/blog/config.json'), readJson('data/blog/samples.config.json'));
  const samples = readJson('data/blog/samples.json');
  const posts = [...readJson('data/blog/posts.json'), ...samples];
  const films = readJson('data/films.json');
  assert.ok(samples.every((p) => p.sample === true), 'every sample has sample: true');
  assert.ok(config.featured.length > 0);
  expectClean(cfgErrs(config));
  expectClean(errs(posts, config, films));
  expectClean(checkBlogRefs(posts, config, { root: ROOT, films }));
  const youtube = JSON.stringify(samples).match(/"youtube":\s*"[^"]*"/g);
  assert.strictEqual(youtube, null, 'samples use the site videos, not a placeholder YouTube id');
});

// ------------------------------------------------------------------ report

for (const [name, error] of failures) {
  console.error(`FAIL ${name}\n  ${String(error && error.message).split('\n').join('\n  ')}`);
}
console.log(`blog-rules: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
