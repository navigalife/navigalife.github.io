const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const { renderPage } = require('./template');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE_URL = 'https://navigalife.github.io/';

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

const processImage = async (relativePath) => {
  const sourcePath = path.join(ROOT, relativePath);
  const extension = path.extname(relativePath).slice(1).toLowerCase();
  const stem = path.basename(relativePath, path.extname(relativePath));
  const parent = path.basename(path.dirname(relativePath));
  const variants = {};

  if (extension === 'webp') {
    for (const width of [320, 640]) {
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

const prepareMark = async (name, width = 128) => {
  const buffer = await sharp(path.join(ROOT, 'assets', 'brand', `${name}.png`))
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return writeHashed('assets/brand', name, 'png', buffer);
};

const copyBrandAssets = async () => {
  const fixedAssets = [
    'favicon.svg',
    'favicon-32.png',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
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
  const [ogImage, ink, paper] = await Promise.all([
    processImage('assets/brand/og-image.png'),
    prepareMark('logo-ink', 512),
    prepareMark('logo-paper', 512),
  ]);
  return { ogImage: ogImage.original, markPaths: { ink, paper } };
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

const criticalCss = (theme) => `${themeCss(theme)}
@font-face{font-family:"Fraunces";font-style:normal;font-weight:600;font-display:swap;src:url("assets/fonts/fraunces-latin-600.woff2") format("woff2")}
@font-face{font-family:"Instrument Sans";font-style:normal;font-weight:400 600;font-display:swap;src:url("assets/fonts/instrument-sans-latin-400-600.woff2") format("woff2")}
*,*::before,*::after{box-sizing:border-box}
html{scroll-padding-top:100px}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Instrument Sans",system-ui,sans-serif;font-size:1.125rem;line-height:1.7}
img{display:block;max-width:100%}
a{color:inherit}
h1,h2,h3,p{margin-top:0}
h1,h2{font-family:"Fraunces",Georgia,serif;font-weight:600;letter-spacing:-.03em;line-height:1.06}
h1{max-width:14ch;margin-bottom:28px;font-size:clamp(2.75rem,6.5vw,4.25rem)}
.container{width:min(100% - 40px,1240px);margin-inline:auto}
.site-header{position:sticky;z-index:50;top:0;border-bottom:1px solid var(--line);background:var(--bg)}
.header-inner{display:grid;grid-template-columns:auto 1fr auto;min-height:84px;align-items:center;gap:32px}
.wordmark{display:inline-flex;min-height:44px;align-items:center;text-decoration:none}
.lockup{display:inline-flex;align-items:center}.lockup img{width:auto;height:62px}.lockup--paper{display:none}
[data-theme="dark"] .lockup--ink{display:none}[data-theme="dark"] .lockup--paper{display:block}
.site-nav{display:flex;align-items:center;justify-content:center;gap:26px}.header-actions{display:flex;align-items:center;gap:12px}.menu-toggle{display:none}
.kicker{margin-bottom:14px;color:var(--accent);font-size:.875rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase}
.hero{padding-block:clamp(3rem,6vw,5.5rem) clamp(3.5rem,7vw,6rem)}
.hero__layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr);align-items:center;gap:clamp(40px,7vw,104px)}
.hero__copy>p:not(.kicker){max-width:52ch;margin-bottom:36px;color:var(--ink-muted);font-size:clamp(1.125rem,1.7vw,1.3125rem)}
.hero__evidence{display:block;padding:20px;border:1px solid var(--line);border-radius:14px;background:var(--surface);text-decoration:none}
.hero__evidence-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.evidence__image{position:relative;aspect-ratio:4/5;overflow:hidden;border-radius:10px;background:var(--surface-2)}
.evidence__image>img{position:relative;z-index:1;width:100%;height:100%;object-fit:contain}
@media(max-width:1000px){.menu-toggle{display:grid}.site-nav{display:none}.hero__layout{grid-template-columns:1fr;gap:44px}.hero__evidence{max-width:640px}}
@media(max-width:760px){.container{width:min(100% - 32px,1240px)}.header-inner{min-height:72px;gap:16px}.header-cta{display:none}.hero{padding-top:44px}}
`;

const validate = ({ products, protocols, testimonials, themes, config }) => {
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
    if (!testimonial.name || !testimonial.location || !testimonial.condition) {
      throw new Error(`Testimonial ${label} requires name, location, and condition.`);
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
      if (images.length < 2) {
        throw new Error(`Testimonial ${label}: featured stories need at least 2 images.`);
      }
    }
  }
  if (featuredCount > 1) throw new Error('At most one featured testimonial.');

  return { theme, themeId, visibleProtocols };
};

const copyAdmin = async () => {
  const source = path.join(ROOT, 'admin');
  try {
    await fs.access(source);
    await fs.cp(source, path.join(DIST, 'admin'), { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const build = async () => {
  const [company, products, protocols, testimonials, themes, config, baseCss, clientJs] =
    await Promise.all([
      readJson('data/company.json'),
      readJson('data/products.json'),
      readJson('data/protocols.json'),
      readJson('data/testimonials.json'),
      readJson('data/themes.json'),
      readJson('data/site-config.json'),
      fs.readFile(path.join(__dirname, 'styles.css'), 'utf8'),
      fs.readFile(path.join(__dirname, 'site.js'), 'utf8'),
    ]);

  const { theme, themeId, visibleProtocols } = validate({
    products,
    protocols,
    testimonials,
    themes,
    config,
  });
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const [imageMap, brand] = await Promise.all([
    buildImageMap(testimonials),
    copyBrandAssets(),
  ]);
  const cssPath = await writeHashed('assets', 'site', 'css', `${themeCss(theme)}\n${baseCss}`);
  const jsPath = await writeHashed('assets', 'site', 'js', clientJs);
  const html = renderPage({
    company,
    protocols: visibleProtocols,
    testimonials,
    config,
    themeId,
    imageMap,
    markPaths: brand.markPaths,
    cssPath,
    jsPath,
    ogImage: brand.ogImage,
    siteUrl: SITE_URL,
    criticalCss: criticalCss(theme),
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
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>\n`,
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
