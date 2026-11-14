const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { statSync } = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { renderPage, renderShell, notFoundPage, contactHrefs, phoneHref } = require('./template');
const { loadBlog, buildBlog } = require('./blog/build-blog');
const { writeAdminPreview } = require('./blog/admin-preview');
// The content rules the admin runs too — one file, so the two cannot drift.
const rules = require('../admin/content-rules.js');

const ROOT = path.resolve(__dirname, '..');
// MV_DIST overrides the output dir (parallel builds, previews).
const DIST = process.env.MV_DIST ? path.resolve(process.env.MV_DIST) : path.join(ROOT, 'dist');
const SITE_URL = 'https://medivasc.in/';

const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.join(ROOT, relativePath), 'utf8'));

const digest = (content) =>
  crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);

const writeHashed = async (directory, stem, extension, content) => {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const filename = `${stem}.${digest(buffer)}.${extension}`;
  await fs.mkdir(path.join(DIST, directory), { recursive: true });
  await fs.writeFile(path.join(DIST, directory, filename), buffer);
  return path.posix.join(directory, filename);
};

// `toWebp` (blog photographs) re-encodes any raster source into the webp
// variants; without it a non-webp source is copied once into assets/brand.
const processImage = async (relativePath, widths = [320, 640], { toWebp = false } = {}) => {
  const sourcePath = path.join(ROOT, relativePath);
  const extension = path.extname(relativePath).slice(1).toLowerCase();
  const stem = path.basename(relativePath, path.extname(relativePath));
  const parent = path.basename(path.dirname(relativePath));
  const variants = {};

  if (extension === 'webp' || toWebp) {
    for (const width of widths) {
      const buffer = await sharp(sourcePath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 84, effort: 5 })
        .toBuffer();
      variants[width] = await writeHashed(
        'assets/images',
        `${parent}-${stem}-${width}`,
        'webp',
        buffer,
      );
    }
    return variants;
  }

  const buffer = await sharp(sourcePath).rotate().toBuffer();
  variants.original = await writeHashed(
    'assets/brand',
    path.basename(relativePath, path.extname(relativePath)),
    extension,
    buffer,
  );
  return variants;
};

const buildImageMap = async (testimonials) => {
  const sources = new Set();
  testimonials.forEach((testimonial) => {
    testimonial.images.forEach((entry) => sources.add(entry.src));
  });
  const entries = await Promise.all(
    [...sources].map(async (source) => [source, await processImage(source)]),
  );
  return Object.fromEntries(entries);
};

// Build responsive variants for an ordered list of gallery sources (solutions,
// feedback), named explicitly by their manifest (data/{solutions,feedback}.json)
// rather than by scanning the directory, so the owner controls order and set
// from the admin. Returns the imageMap entries plus an src-keyed item map. Items
// carry the source's real (already EXIF-rotated) dimensions and the largest
// variant path, so the template can size auto-width rail cards without layout
// shift and open a full-resolution screenshot in the lightbox.
const buildGallery = async (srcs, widths, options) => {
  const items = await Promise.all(
    srcs.map(async (src) => {
      const [variants, meta] = await Promise.all([
        processImage(src, widths, options),
        sharp(path.join(ROOT, src)).metadata(),
      ]);
      const built = Object.keys(variants).map(Number).sort((a, b) => a - b);
      return {
        src,
        variants,
        width: meta.width,
        height: meta.height,
        full: variants[built[built.length - 1]],
      };
    }),
  );
  const map = Object.fromEntries(items.map((item) => [item.src, item.variants]));
  const bySrc = new Map(items.map((item) => [item.src, item]));
  return { map, bySrc };
};

// Resizes a stored lockup and returns its hashed path plus the resized intrinsic
// dimensions. Every lockup variant has its own aspect (the ™ ones are wider — the
// ™ is baked at the 'c' shoulder) and the aspect changed with the Exotc350
// wordmark, so the <img> must carry measured width/height, never a constant, or
// the header/footer take a layout shift on load.
const prepareMarkSized = async (name, width = 512) => {
  const buffer = await sharp(path.join(ROOT, 'assets', 'brand', `${name}.png`))
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  const src = await writeHashed('assets/brand', name, 'png', buffer);
  return { src, width: meta.width, height: meta.height };
};

const copyBrandAssets = async () => {
  const fixedAssets = [
    'favicon.svg',
    'favicon-32.png',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    // Plain lockups (non-hashed) so the admin can reference the owner's real
    // logo directly via ../assets/brand/logo-{ink,paper}.png.
    'logo-ink.png',
    'logo-paper.png',
  ];
  await fs.mkdir(path.join(DIST, 'assets', 'brand'), { recursive: true });
  await Promise.all(
    fixedAssets.map((name) =>
      fs.copyFile(
        path.join(ROOT, 'assets', 'brand', name),
        path.join(DIST, 'assets', 'brand', name),
      ),
    ),
  );
  const [ogImage, ink, paper, inkTm, paperTm, inkTmLg, paperTmLg] = await Promise.all([
    processImage('assets/brand/og-image.png'),
    prepareMarkSized('logo-ink', 512),
    prepareMarkSized('logo-paper', 512),
    prepareMarkSized('logo-ink-tm', 512),
    prepareMarkSized('logo-paper-tm', 512),
    prepareMarkSized('logo-ink-tm-lg', 512),
    prepareMarkSized('logo-paper-tm-lg', 512),
  ]);
  return {
    ogImage: ogImage.original,
    markPaths: { ink, paper },
    // Two footer ™ lockups: '-lg' (larger ™) for desktop's 54px render, the base
    // one for the 64px phone render (see src/styles.css breakpoint swap).
    markPathsTm: { ink: inkTm, paper: paperTm },
    markPathsTmLg: { ink: inkTmLg, paper: paperTmLg },
  };
};

const copyFonts = async () => {
  const source = path.join(ROOT, 'assets', 'fonts');
  const destination = path.join(DIST, 'assets', 'fonts');
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true });
};

// Condition-severity clips (normalized 9:16 H.264 + watermarked posters) are
// copied verbatim — they're pre-processed offline by tools/video/, not by sharp,
// and served straight from assets/conditions/. No-op if the directory is absent.
const copyConditionMedia = async () => {
  const source = path.join(ROOT, 'assets', 'conditions');
  const destination = path.join(DIST, 'assets', 'conditions');
  try {
    await fs.access(source);
  } catch {
    return;
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true });
};

// The theme the site builds with: SITE_THEME (local experiments) or the
// owner's site-config choice. Shared with the admin preview bundle.
const activeTheme = (themes, config) => {
  const themeId = process.env.SITE_THEME || config.theme;
  const theme = themes.find((candidate) => candidate.id === themeId);
  if (!theme) throw new Error(`Unknown theme: ${themeId}`);
  return { theme, themeId };
};

const themeCss = (theme) => {
  const declarations = (tokens) =>
    Object.entries(tokens).map(([key, value]) => `  ${key}: ${value};`).join('\n');
  return `:root {\n${declarations(theme.light)}\n}\n[data-theme="dark"] {\n${declarations(theme.dark)}\n}\n`;
};

// Owner-editable copy and lists (content/treatment/films, site-config seo/hero/
// eligibility, company location):
// every problem at once, grouped by file, worded for the owner — the same
// messages the admin shows before it lets a publish through.
const validateContentRules = ({ company, config, content, treatment, films }) => {
  const groups = [
    ['data/content.json', rules.validateContent(content)],
    ['data/treatment.json', rules.validateTreatment(treatment)],
    ['data/films.json', rules.validateFilms(films)],
    ['data/site-config.json (seo)', rules.validateSeo(config.seo)],
    ['data/site-config.json (hero)', rules.validateHero(config)],
    // Eligibility notice: heading and text both or neither (Page tab).
    ['data/site-config.json (eligibility)', rules.validateEligibility(config)],
    // Names, address, phone and WhatsApp, then the JSON-LD location fields.
    ['data/company.json', [...rules.validateCompany(company), ...rules.validateCompanyLocation(company)]],
  ].filter(([, messages]) => messages.length);
  if (!groups.length) return;
  const count = groups.reduce((total, [, messages]) => total + messages.length, 0);
  const error = new Error(
    [
      `Site content has ${count} problem${count === 1 ? '' : 's'} — fix ${count === 1 ? 'it' : 'them'} and build again:`,
      ...groups.map(([file, messages]) => `\n${file}\n${messages.map((message) => `  - ${message}`).join('\n')}`),
    ].join('\n'),
  );
  error.ownerFacing = true; // printed as-is: the message is the whole story
  throw error;
};

// Every media file the data files point at must be on disk, or the site ships a
// broken tile (videos are copied, not processed, so nothing else would notice).
// All missing files at once, grouped by file, in the owner's words.
const validateAssets = ({ testimonials, solutions, feedback, treatment, films }) => {
  const missing = (src) => {
    try {
      return !statSync(path.join(ROOT, src)).isFile();
    } catch {
      return true;
    }
  };
  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value) => typeof value === 'string' && value !== '';
  const groups = [
    ['data/films.json', list(films).flatMap((film, i) => [
      [film && film.src, `Videos: video ${i + 1}'s clip`],
      [film && film.poster, `Videos: video ${i + 1}'s poster`],
    ])],
    ['data/treatment.json', list(treatment).flatMap((patient, i) => list(patient && patient.photos).map((photo, j) => [
      photo, `In therapy: patient ${i + 1}, photo ${j + 1}`,
    ]))],
    ['data/testimonials.json', list(testimonials).flatMap((story, i) => list(story && story.images).map((image, j) => [
      image && image.src, `Recoveries: story ${i + 1}, ${image && image.stage ? `the ${image.stage} photo` : `photo ${j + 1}`}`,
    ]))],
    ['data/solutions.json', list(solutions).flatMap((card) => list(card && card.images).map((image, j) => [
      image && image.src, `Solutions: ${(card && (card.title || card.id)) || 'a card'}, photo ${j + 1}`,
    ]))],
    ['data/feedback.json', list(feedback).map((item, i) => [item && item.src, `Voices: screenshot ${i + 1}`])],
  ]
    .map(([file, refs]) => [file, refs.filter(([src]) => text(src) && missing(src)).map(([src, what]) => `${what} is missing (${src} is not in the site files). Upload it again or remove it.`)])
    .filter(([, messages]) => messages.length);
  if (!groups.length) return;
  const count = groups.reduce((total, [, messages]) => total + messages.length, 0);
  const error = new Error(
    [
      `${count} media file${count === 1 ? ' is' : 's are'} missing — the site would show ${count === 1 ? 'a broken tile' : 'broken tiles'}:`,
      ...groups.map(([file, messages]) => `\n${file}\n${messages.map((message) => `  - ${message}`).join('\n')}`),
    ].join('\n'),
  );
  error.ownerFacing = true;
  throw error;
};

const validate = ({
  company,
  products,
  protocols,
  testimonials,
  themes,
  config,
  solutions,
  feedback,
  content,
  treatment,
  films,
}) => {
  validateContentRules({ company, config, content, treatment, films });
  validateAssets({ testimonials, solutions, feedback, treatment, films });

  const { theme, themeId } = activeTheme(themes, config);

  if (config.productsEnabled) {
    throw new Error(
      'productsEnabled=true requires restoring the product render path (archived in run 1 history).',
    );
  }

  const protocolIds = new Set();
  const visibleProtocols = protocols.filter((protocol) => protocol.visible && !protocol.draft);
  for (const protocol of visibleProtocols) {
    if (!protocol.id || protocolIds.has(protocol.id)) {
      throw new Error(`Invalid protocol id: ${protocol.id}`);
    }
    if (!['disease', 'elderly'].includes(protocol.audience)) {
      throw new Error(`Invalid protocol audience: ${protocol.id}`);
    }
    if (!protocol.condition) throw new Error(`Incomplete protocol: ${protocol.id}`);
    protocolIds.add(protocol.id);
  }

  const stages = new Set(['Before therapy', 'During therapy', 'After therapy']);
  let featuredCount = 0;
  const testimonialIds = new Set();
  for (const testimonial of testimonials) {
    const label = testimonial.id || '(missing id)';
    if (!testimonial.id || testimonialIds.has(testimonial.id)) {
      throw new Error(`Invalid testimonial id: ${label}`);
    }
    testimonialIds.add(testimonial.id);
    if (!testimonial.location || !testimonial.condition) {
      throw new Error(`Testimonial ${label} requires location and condition.`);
    }
    const images = testimonial.images || [];
    if (images.length === 1) {
      throw new Error(`Testimonial ${label}: a single photo is not evidence of change (need 0, 2, or 3).`);
    }
    if (images.length > 3) {
      throw new Error(`Testimonial ${label}: at most 3 stage images.`);
    }
    for (const entry of images) {
      if (!entry.src || !stages.has(entry.stage)) {
        throw new Error(`Testimonial ${label}: each image needs src and a valid stage.`);
      }
    }
    if (!images.length && !testimonial.quote) {
      throw new Error(`Testimonial ${label}: without images a quote is required.`);
    }
    if (images.length && !testimonial.remark) {
      throw new Error(`Testimonial ${label}: with images a clinical remark is required.`);
    }
    if (testimonial.featured) {
      featuredCount += 1;
      if (images.length !== 3) {
        throw new Error(
          `Testimonial ${label}: the featured story fills the hero's three-up strip, so it needs exactly 3 stage images (has ${images.length}).`,
        );
      }
    }
  }
  if (featuredCount !== 1) {
    throw new Error(
      `Exactly one featured testimonial is required (found ${featuredCount}); it anchors the hero panel and the lead recovery journey.`,
    );
  }

  // Condition-solution galleries (data/solutions.json). Each card's photographs
  // must live under assets/solutions/<id>-*, which ties image ownership to the
  // card and is the invariant the admin's uploader also honours.
  const SLUG = /^[a-z0-9-]+$/;
  const solutionIds = new Set();
  for (const card of solutions || []) {
    const label = card.id || '(missing id)';
    if (!card.id || !SLUG.test(card.id) || solutionIds.has(card.id)) {
      throw new Error(`Invalid solution id: ${label}`);
    }
    solutionIds.add(card.id);
    if (!card.title || !card.condition) {
      throw new Error(`Solution ${label} requires a title and condition.`);
    }
    if (!card.cta || !card.cta.label || !card.cta.message) {
      throw new Error(`Solution ${label} requires a CTA label and prefilled message.`);
    }
    const body = card.body || [];
    if (!body.length || body.some((paragraph) => !paragraph.text)) {
      throw new Error(`Solution ${label} needs at least one non-empty body paragraph.`);
    }
    const images = card.images || [];
    if (card.visible !== false && !images.length) {
      throw new Error(`Solution ${label} is visible but has no photographs.`);
    }
    for (const image of images) {
      if (!image.src || !image.src.startsWith(`assets/solutions/${card.id}-`)) {
        throw new Error(`Solution ${label}: image src must be assets/solutions/${card.id}-*.webp (got ${image.src || '(missing)'}).`);
      }
    }
  }

  // Patient-voices rail (data/feedback.json): an ordered list of chat-screenshot
  // sources, identity already redacted at upload. Just shape + uniqueness here.
  const feedbackSeen = new Set();
  for (const item of feedback || []) {
    if (!item.src || !item.src.startsWith('assets/feedback/')) {
      throw new Error(`Feedback item requires an src under assets/feedback/ (got ${item.src || '(missing)'}).`);
    }
    if (feedbackSeen.has(item.src)) throw new Error(`Duplicate feedback src: ${item.src}`);
    feedbackSeen.add(item.src);
  }

  return { theme, themeId, visibleProtocols };
};

// Is `child` the same path as, or inside, `parent`? Both already realpath'd.
const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);

// realpath of a path that may not exist yet: its deepest existing ancestor,
// resolved through any symlinks, plus the rest of the path.
const realpathLoose = async (target) => {
  const rest = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...rest);
    } catch (error) {
      const parent = path.dirname(current);
      if (error.code !== 'ENOENT' || parent === current) throw error;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
};

// The build wipes DIST and copyAdmin rewrites files in DIST/admin. Neither may
// ever resolve into the admin source: a scratch tree whose admin/ was a symlink
// to the real admin once let the ?v= rewrite land in SOURCE files.
const assertNotAdminSource = async (target, what) => {
  const source = path.join(ROOT, 'admin');
  let realSource;
  try {
    realSource = await fs.realpath(source);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const real = await realpathLoose(target);
  if (within(real, realSource) || within(realSource, real)) {
    throw new Error(
      `Refusing to ${what}: ${target} resolves to ${real}, which overlaps the admin source ${realSource}. `
      + 'Writing there would edit source files. Build into a real directory outside admin/ '
      + '(check MV_DIST and any symlinked admin/ in this tree).',
    );
  }
};

const copyAdmin = async ({ theme } = {}) => {
  const source = path.join(ROOT, 'admin');
  const target = path.join(DIST, 'admin');
  try {
    await fs.access(source);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  // Before the copy (it would write into the source) and after it: a symlinked
  // admin/ is copied as a symlink, so only the resolved target tells.
  await assertNotAdminSource(target, 'copy the admin bundle');
  // admin/preview/ in the source tree is the harness copy (CLI); the shipped one
  // is regenerated below.
  const localPreview = path.join(source, 'preview');
  await fs.cp(source, target, { recursive: true, filter: (from) => from !== localPreview });
  await assertNotAdminSource(target, 'version the admin bundle');
  const realTarget = await fs.realpath(target);
  // The admin preview bundle.
  const preview = await writeAdminPreview(path.join(target, 'preview'), { theme });

  // Cache-bust the admin bundle. The admin ships static filenames (app.js and
  // its relative imports, styles.css); with no version query a browser can pair
  // a freshly deployed index.html with a stale, cached app.js. That is exactly
  // how new nav tabs (Solutions, Voices) ended up falling through to the
  // Appearance renderer for people whose browser still held the old app.js.
  // The version is a content hash of the bundle, so it only changes when the
  // code changes and otherwise leaves the browser cache intact.
  // The bundle is every shipped admin module (local __*.html harnesses are
  // never deployed code) plus every stylesheet — derived, not listed, so a new
  // file can't be forgotten and paired stale.
  const files = (await fs.readdir(source)).sort();
  const modules = files.filter((file) => /^[a-z][a-z0-9-]*\.js$/.test(file));
  const styles = files.filter((file) => /^[a-z][a-z0-9-]*\.css$/.test(file));
  const bundle = new Set([...modules, ...styles]);
  const hash = crypto.createHash('sha256');
  for (const file of bundle) hash.update(await fs.readFile(path.join(source, file)));
  const v = hash.digest('hex').slice(0, 8);
  // The preview files are generated from src/blog/, so each carries its own hash.
  const previewV = {};
  for (const file of Object.values(preview)) previewV[path.basename(file)] = digest(await fs.readFile(file));
  const rewrite = async (file, replacer) => {
    const filePath = path.join(target, file);
    const real = await fs.realpath(filePath);
    if (!within(real, realTarget)) {
      throw new Error(`Refusing to version admin/${file}: it resolves outside ${realTarget} (${real}), a symlink into source files.`);
    }
    await fs.writeFile(filePath, replacer(await fs.readFile(filePath, 'utf8')));
  };
  // index.html references the entry script and every stylesheet by bare filename.
  await rewrite('index.html', (html) => html.replace(
    /\b(src|href)="([a-z][a-z0-9-]*\.(?:js|css))"/g,
    (whole, attr, file) => (bundle.has(file) ? `${attr}="${file}?v=${v}"` : whole),
  ));
  // Modules import their siblings by relative path ('./gh-api.js'); version
  // every such import in every module, so one URL per file and none stale. The
  // preview assets are referenced only as the literals './preview/blog-render.js'
  // and './preview/blog-preview.css'.
  const sibling = new RegExp(`(['"])(\\./(?:${modules.map((m) => m.slice(0, -3)).join('|')})\\.js)\\1`, 'g');
  const previewRef = /(['"])\.\/preview\/(blog-render\.js|blog-preview\.css)\1/g;
  for (const file of modules) {
    await rewrite(file, (js) => js
      .replace(sibling, `$1$2?v=${v}$1`)
      .replace(previewRef, (whole, quote, name) => `${quote}./preview/${name}?v=${previewV[name]}${quote}`));
  }
};

// The owner's private strategy page ships pre-encrypted (plaintext + encryptor
// live in the advisor workspace, tools/strategy/): a static file copied through
// unchanged. It is noindexed and robots-disallowed; never add it to the sitemap.
const copyStrategy = async () => {
  const source = path.join(ROOT, 'strategy');
  try {
    await fs.access(source);
    await fs.cp(source, path.join(DIST, 'strategy'), { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

// Plain-language site summary for AI assistants/crawlers (llms.txt), built only
// from the same data as the page so it can never drift from what the owner set
// in the admin. A line whose value is blank is left out. Protocols list their
// condition names only: the admin keeps summaries internal.
const llmsTxt = ({ company, config, content, protocols }) => {
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const sentence = (value) => {
    const text = clean(value).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '');
    return text && !/[.!?]$/.test(text) ? `${text}.` : text;
  };
  // "+91 8130981199" for an Indian number however it was typed, else "+<digits>".
  const phone = (number) => {
    if (!clean(number).replace(/\D/g, '')) return '';
    const href = phoneHref(number);
    return /^\+91\d{10}$/.test(href) ? `+91 ${href.slice(3)}` : href;
  };
  const seo = config.seo || {};
  const intro = [clean(seo.description), sentence(config.heroHeadline)].filter(Boolean).join(' ');
  const about = String(company.about || '').split(/\n\s*\n/).map(clean).filter(Boolean);
  const areas = (seo.areaServed || []).map(clean).filter(Boolean);
  const languages = rules.languagesOf(company);
  const contact = [
    ['Phone', phone(company.phone)],
    ['WhatsApp', phone(company.whatsapp)],
    ['Email', clean(company.email)],
    ['Website', SITE_URL],
    ['Location', clean(company.address)],
    ['Map', clean(company.mapsUrl)],
    ['Areas served', areas.join(', ')],
    ['Languages', languages.join(', ')],
  ].filter(([, value]) => value);
  const section = (heading, body) => (body ? `\n## ${clean(heading)}\n\n${body}\n` : '');
  return [
    `# ${clean(company.name)}\n`,
    clean(company.tagline) ? `\n> ${clean(company.tagline)}\n` : '',
    intro ? `\n${intro}\n` : '',
    section(content.about?.heading || `About ${clean(company.name)}`, about.join('\n\n')),
    section(content.conditions?.heading || 'Conditions', protocols.map((p) => `- ${clean(p.condition)}`).join('\n')),
    section('Contact', contact.map(([label, value]) => `- ${label}: ${value}`).join('\n')),
  ].join('');
};

const build = async () => {
  const [
    company,
    products,
    protocols,
    testimonials,
    themes,
    config,
    solutionsData,
    feedbackData,
    content,
    treatmentData,
    filmsData,
    baseCss,
    clientJs,
  ] = await Promise.all([
    readJson('data/company.json'),
    readJson('data/products.json'),
    readJson('data/protocols.json'),
    readJson('data/testimonials.json'),
    readJson('data/themes.json'),
    readJson('data/site-config.json'),
    readJson('data/solutions.json'),
    readJson('data/feedback.json'),
    readJson('data/content.json'),
    readJson('data/treatment.json'),
    readJson('data/films.json'),
    fs.readFile(path.join(__dirname, 'styles.css'), 'utf8'),
    fs.readFile(path.join(__dirname, 'site.js'), 'utf8'),
  ]);

  // src/site.js ships standalone, so it carries its own copy of the admin's
  // wholeWordMatch (the chatbot bolds exactly what accentMatches() accepts).
  // Fail the build if the two copies ever drift apart.
  const fnSource = (source, file) => {
    const match = source.match(/^( *)const wholeWordMatch = \(text, word\) => \{\n[\s\S]*?^\1\};$/m);
    if (!match) throw new Error(file + ': wholeWordMatch not found (the drift check looks for it).');
    return match[0].split('\n').map((line) => line.trim()).join('\n');
  };
  const rulesSource = await fs.readFile(path.join(__dirname, '..', 'admin', 'content-rules.js'), 'utf8');
  if (fnSource(clientJs, 'src/site.js') !== fnSource(rulesSource, 'admin/content-rules.js')) {
    throw new Error('src/site.js wholeWordMatch differs from admin/content-rules.js wholeWordMatch: change both together.');
  }

  const { theme, themeId, visibleProtocols } = validate({
    company,
    products,
    protocols,
    testimonials,
    themes,
    config,
    solutions: solutionsData,
    feedback: feedbackData,
    content,
    treatment: treatmentData,
    films: filmsData,
  });
  // The Journal (data/blog/): validated here with the rest of the content, so a
  // blog problem stops the build before dist is wiped. null = no blog settings.
  const blog = await loadBlog({ root: ROOT, rules, films: filmsData });
  // The Blog link is always in the nav/footer once a blog exists (owner call
  // 2026-11-13): with 0 live posts /blog/ is a coming-soon placeholder, so the
  // link still has a page to land on. null only when there is no blog at all.
  const blogNav = blog ? { label: blog.config.navLabel || 'Blog' } : null;
  await assertNotAdminSource(DIST, 'wipe the build output');
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const solutionSrcs = solutionsData.flatMap((card) => (card.images || []).map((image) => image.src));
  const feedbackSrcs = feedbackData.map((item) => item.src);
  // In-therapy photographs (#treatment, data/treatment.json): the same variant
  // pipeline as every gallery.
  const treatmentSrcs = treatmentData.flatMap((patient) => patient.photos);
  const [imageMap, brand, solutions, feedback, treatment] = await Promise.all([
    buildImageMap(testimonials),
    copyBrandAssets(),
    // Condition carousels: crisp up to ~600px card width (1024 covers hi-dpi).
    buildGallery(solutionSrcs, [320, 640, 1024]),
    // Patient messages: 1600 so the lightbox stays readable on large screens.
    buildGallery(feedbackSrcs, [320, 640, 1024, 1600]),
    // In-therapy photos render at recovery pair-story scale (~200px), same widths.
    buildGallery(treatmentSrcs, [320, 640]),
  ]);
  Object.assign(imageMap, solutions.map, feedback.map, treatment.map);
  // Resolve each card's manifest image list to processed items (order preserved),
  // dropping hidden cards and any left with no usable photographs.
  const solutionCards = solutionsData
    .filter((card) => card.visible !== false)
    .map((card) => ({
      ...card,
      images: (card.images || []).map((image) => solutions.bySrc.get(image.src)).filter(Boolean),
    }))
    .filter((card) => card.images.length);
  const feedbackImages = feedbackData
    .map((item) => feedback.bySrc.get(item.src))
    .filter(Boolean);
  const cssPath = await writeHashed('assets', 'site', 'css', `${themeCss(theme)}\n${baseCss}`);
  const jsPath = await writeHashed('assets', 'site', 'js', clientJs);
  const site = {
    company,
    content,
    config,
    themeId,
    themeBg: theme.light['--bg'],
    siteUrl: SITE_URL,
    cssPath,
    jsPath,
    markPaths: brand.markPaths,
    markPathsTm: brand.markPathsTm,
    markPathsTmLg: brand.markPathsTmLg,
    blogNav,
  };
  const html = renderPage({
    company,
    protocols: visibleProtocols,
    testimonials,
    config,
    themeId,
    imageMap,
    solutions: solutionCards,
    feedbackImages,
    content,
    treatment: treatmentData,
    films: filmsData,
    markPaths: brand.markPaths,
    markPathsTm: brand.markPathsTm,
    markPathsTmLg: brand.markPathsTmLg,
    cssPath,
    jsPath,
    ogImage: brand.ogImage,
    siteUrl: SITE_URL,
    themeBg: theme.light['--bg'],
    blogNav,
  });
  const journal = blogNav
    ? await buildBlog(blog, {
      root: ROOT,
      dist: DIST,
      siteUrl: SITE_URL,
      site,
      theme,
      films: filmsData,
      siteOgImage: brand.ogImage,
      buildGallery,
      writeHashed,
      renderShell,
      contactHrefs,
    })
    : null;
  // Blog URLs (with <image:image> entries) join the root sitemap; the image
  // namespace is declared only when there is an entry that can use it.
  const sitemapEntries = journal ? journal.sitemapEntries : [];
  const llmsJournal = journal && journal.llmsSection ? `\n${journal.llmsSection}\n` : '';

  await Promise.all([
    fs.writeFile(path.join(DIST, 'index.html'), html),
    fs.writeFile(path.join(DIST, '404.html'), notFoundPage(html, { blog: Boolean(blogNav) })),
    fs.writeFile(
      path.join(DIST, 'robots.txt'),
      `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /strategy/\nDisallow: /changes/\nSitemap: ${SITE_URL}sitemap.xml\n`,
    ),
    fs.writeFile(
      path.join(DIST, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${sitemapEntries.length ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''}><url><loc>${SITE_URL}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>${sitemapEntries.join('')}</urlset>\n`,
    ),
    fs.writeFile(path.join(DIST, 'llms.txt'), llmsTxt({ company, config, content, protocols: visibleProtocols }) + llmsJournal),
    fs.writeFile(path.join(DIST, '.nojekyll'), ''),
    copyFonts(),
    copyConditionMedia(),
    copyAdmin({ theme }),
    copyStrategy(),
  ]);

  const jsBytes = Buffer.byteLength(clientJs);
  console.log(
    `Built MediVasc landing: ${testimonials.length} recovery stories, ${visibleProtocols.length} protocols, theme ${themeId}.`,
  );
  if (journal) console.log(`Journal: ${journal.posts} post${journal.posts === 1 ? '' : 's'}, ${journal.pages} blog pages.`);
  console.log(`Client JavaScript: ${jsBytes} bytes (${(jsBytes / 1024).toFixed(2)} KB).`);
  console.log(`Output: ${DIST}`);
};

// themeCss/activeTheme are shared with src/blog/admin-preview.js; requiring this
// file never builds.
module.exports = { themeCss, activeTheme };

if (require.main === module) {
  build().catch((error) => {
    console.error(error.ownerFacing ? error.message : error);
    process.exitCode = 1;
  });
}
