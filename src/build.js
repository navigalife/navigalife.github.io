const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const { renderPage } = require('./template');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
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

const processImage = async (relativePath, widths = [320, 640]) => {
  const sourcePath = path.join(ROOT, relativePath);
  const extension = path.extname(relativePath).slice(1).toLowerCase();
  const stem = path.basename(relativePath, path.extname(relativePath));
  const parent = path.basename(path.dirname(relativePath));
  const variants = {};

  if (extension === 'webp') {
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
const buildGallery = async (srcs, widths) => {
  const items = await Promise.all(
    srcs.map(async (src) => {
      const [variants, meta] = await Promise.all([
        processImage(src, widths),
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

const prepareMark = async (name, width = 128) => {
  const buffer = await sharp(path.join(ROOT, 'assets', 'brand', `${name}.png`))
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return writeHashed('assets/brand', name, 'png', buffer);
};

// Like prepareMark but also returns the resized intrinsic dimensions. Used for the
// footer ™ lockup, whose canvas is wider than the plain mark (the ™ is baked at the
// 'c' shoulder), so the <img> needs its own width/height to avoid a layout shift.
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
    prepareMark('logo-ink', 512),
    prepareMark('logo-paper', 512),
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

const themeCss = (theme) => {
  const declarations = (tokens) =>
    Object.entries(tokens).map(([key, value]) => `  ${key}: ${value};`).join('\n');
  return `:root {\n${declarations(theme.light)}\n}\n[data-theme="dark"] {\n${declarations(theme.dark)}\n}\n`;
};

const validate = ({ products, protocols, testimonials, themes, config, solutions, feedback }) => {
  const themeId = process.env.SITE_THEME || config.theme;
  const theme = themes.find((candidate) => candidate.id === themeId);
  if (!theme) throw new Error(`Unknown theme: ${themeId}`);

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

const copyAdmin = async () => {
  const source = path.join(ROOT, 'admin');
  const target = path.join(DIST, 'admin');
  try {
    await fs.access(source);
    await fs.cp(source, target, { recursive: true });
    // Cache-bust the admin bundle. The admin ships static filenames (app.js and
    // its relative imports, styles.css); with no version query a browser can pair
    // a freshly deployed index.html with a stale, cached app.js. That is exactly
    // how new nav tabs (Solutions, Voices) ended up falling through to the
    // Appearance renderer for people whose browser still held the old app.js.
    // The version is a content hash of the bundle, so it only changes when the
    // code changes and otherwise leaves the browser cache intact.
    const bundle = ['app.js', 'gh-api.js', 'image-tools.js', 'vault.js', 'styles.css'];
    const hash = crypto.createHash('sha256');
    for (const file of bundle) hash.update(await fs.readFile(path.join(source, file)));
    const v = hash.digest('hex').slice(0, 8);
    const rewrite = async (file, replacer) => {
      const filePath = path.join(target, file);
      await fs.writeFile(filePath, replacer(await fs.readFile(filePath, 'utf8')));
    };
    // index.html references the entry script and stylesheet by bare filename.
    await rewrite('index.html', (html) => html
      .replace('src="app.js"', `src="app.js?v=${v}"`)
      .replace('href="styles.css"', `href="styles.css?v=${v}"`));
    // app.js imports its siblings by relative path; version those too.
    await rewrite('app.js', (js) => js
      .replace(/(['"])(\.\/(?:gh-api|image-tools|vault)\.js)\1/g, `$1$2?v=${v}$1`));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const build = async () => {
  const [company, products, protocols, testimonials, themes, config, solutionsData, feedbackData, baseCss, clientJs] =
    await Promise.all([
      readJson('data/company.json'),
      readJson('data/products.json'),
      readJson('data/protocols.json'),
      readJson('data/testimonials.json'),
      readJson('data/themes.json'),
      readJson('data/site-config.json'),
      readJson('data/solutions.json'),
      readJson('data/feedback.json'),
      fs.readFile(path.join(__dirname, 'styles.css'), 'utf8'),
      fs.readFile(path.join(__dirname, 'site.js'), 'utf8'),
    ]);

  const { theme, themeId, visibleProtocols } = validate({
    products,
    protocols,
    testimonials,
    themes,
    config,
    solutions: solutionsData,
    feedback: feedbackData,
  });
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const solutionSrcs = solutionsData.flatMap((card) => (card.images || []).map((image) => image.src));
  const feedbackSrcs = feedbackData.map((item) => item.src);
  const [imageMap, brand, solutions, feedback] = await Promise.all([
    buildImageMap(testimonials),
    copyBrandAssets(),
    // Condition carousels: crisp up to ~600px card width (1024 covers hi-dpi).
    buildGallery(solutionSrcs, [320, 640, 1024]),
    // Patient messages: 1600 so the lightbox stays readable on large screens.
    buildGallery(feedbackSrcs, [320, 640, 1024, 1600]),
  ]);
  Object.assign(imageMap, solutions.map, feedback.map);
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
  const html = renderPage({
    company,
    protocols: visibleProtocols,
    testimonials,
    config,
    themeId,
    imageMap,
    solutions: solutionCards,
    feedbackImages,
    markPaths: brand.markPaths,
    markPathsTm: brand.markPathsTm,
    markPathsTmLg: brand.markPathsTmLg,
    cssPath,
    jsPath,
    ogImage: brand.ogImage,
    siteUrl: SITE_URL,
    themeBg: theme.light['--bg'],
  });

  await Promise.all([
    fs.writeFile(path.join(DIST, 'index.html'), html),
    fs.writeFile(path.join(DIST, '404.html'), html),
    fs.writeFile(
      path.join(DIST, 'robots.txt'),
      `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`,
    ),
    fs.writeFile(
      path.join(DIST, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>\n`,
    ),
    fs.writeFile(path.join(DIST, '.nojekyll'), ''),
    copyFonts(),
    copyAdmin(),
  ]);

  const jsBytes = Buffer.byteLength(clientJs);
  console.log(
    `Built MediVasc landing: ${testimonials.length} recovery stories, ${visibleProtocols.length} protocols, theme ${themeId}.`,
  );
  console.log(`Client JavaScript: ${jsBytes} bytes (${(jsBytes / 1024).toFixed(2)} KB).`);
  console.log(`Output: ${DIST}`);
};

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
