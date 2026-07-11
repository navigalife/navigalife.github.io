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

const imageWidths = (source) =>
  source.includes('/testimonials/') ? [320, 640] : [640, 1200];

const processImage = async (relativePath) => {
  const sourcePath = path.join(ROOT, relativePath);
  const extension = path.extname(relativePath).slice(1).toLowerCase();
  const stem = path.basename(relativePath, path.extname(relativePath));
  const parent = path.basename(path.dirname(relativePath));
  const variants = {};

  if (extension === 'webp') {
    for (const width of imageWidths(relativePath)) {
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

const buildImageMap = async (products, testimonials) => {
  const sources = new Set();
  products.forEach((product) => product.images.forEach((image) => sources.add(image)));
  testimonials.forEach((testimonial) => {
    if (testimonial.beforeImage) sources.add(testimonial.beforeImage);
    if (testimonial.afterImage) sources.add(testimonial.afterImage);
  });

  const entries = await Promise.all(
    [...sources].map(async (source) => [source, await processImage(source)]),
  );
  return Object.fromEntries(entries);
};

const copyBrandAssets = async () => {
  const fixedAssets = [
    'favicon.svg',
    'favicon-32.png',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'logo.svg',
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
  return processImage('assets/brand/og-image.png');
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

const validate = ({ products, protocols, testimonials, themes, config }) => {
  const themeId = process.env.SITE_THEME || config.theme;
  const theme = themes.find((candidate) => candidate.id === themeId);
  if (!theme) throw new Error(`Unknown theme: ${themeId}`);

  const visibleProducts = products.filter((product) => product.visible);
  if (!visibleProducts.length) throw new Error('At least one visible product is required.');
  const ids = new Set();
  for (const product of visibleProducts) {
    if (!product.id || ids.has(product.id)) throw new Error(`Invalid product id: ${product.id}`);
    if (!product.name || !product.images?.length) throw new Error(`Incomplete product: ${product.id}`);
    ids.add(product.id);
  }

  const protocolIds = new Set();
  const visibleProtocols = protocols.filter((protocol) => protocol.visible);
  for (const protocol of visibleProtocols) {
    if (!protocol.id || protocolIds.has(protocol.id)) {
      throw new Error(`Invalid protocol id: ${protocol.id}`);
    }
    if (!['disease', 'wellbeing', 'sports'].includes(protocol.audience)) {
      throw new Error(`Invalid protocol audience: ${protocol.id}`);
    }
    if (!protocol.condition || !protocol.summary || !protocol.engagement?.length) {
      throw new Error(`Incomplete protocol: ${protocol.id}`);
    }
    for (const deviceId of protocol.deviceIds || []) {
      if (!ids.has(deviceId)) throw new Error(`Protocol ${protocol.id} links unknown device: ${deviceId}`);
    }
    protocolIds.add(protocol.id);
  }

  for (const testimonial of testimonials) {
    if (!['quote', 'before-after'].includes(testimonial.type)) {
      throw new Error(`Invalid testimonial type: ${testimonial.id}`);
    }
    if (!testimonial.id || !testimonial.name || !testimonial.location || !testimonial.quote || !testimonial.context) {
      throw new Error(`Incomplete testimonial: ${testimonial.id}`);
    }
    if (typeof testimonial.placeholder !== 'boolean') {
      throw new Error(`Testimonial ${testimonial.id} must declare placeholder as a boolean.`);
    }
    if (testimonial.type === 'before-after') {
      if (testimonial.placeholder || !testimonial.beforeImage || !testimonial.afterImage) {
        throw new Error(`Before/after testimonial ${testimonial.id} requires a real, non-placeholder image pair.`);
      }
    } else if (testimonial.beforeImage || testimonial.afterImage) {
      throw new Error(`Quote testimonial ${testimonial.id} cannot include before/after images.`);
    }
  }
  return { theme, themeId, visibleProducts, visibleProtocols };
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

  const { theme, themeId, visibleProducts, visibleProtocols } = validate({
    products,
    protocols,
    testimonials,
    themes,
    config,
  });
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const [imageMap, ogImage] = await Promise.all([
    buildImageMap(visibleProducts, testimonials),
    copyBrandAssets(),
  ]);
  const cssPath = await writeHashed('assets', 'site', 'css', `${themeCss(theme)}\n${baseCss}`);
  const jsPath = await writeHashed('assets', 'site', 'js', clientJs);
  const html = renderPage({
    company,
    products: visibleProducts,
    protocols: visibleProtocols,
    testimonials,
    config,
    themeId,
    imageMap,
    cssPath,
    jsPath,
    ogImage: ogImage.original,
    siteUrl: SITE_URL,
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
  console.log(`Built ${visibleProducts.length} products with theme ${themeId}.`);
  console.log(`Client JavaScript: ${jsBytes} bytes (${(jsBytes / 1024).toFixed(2)} KB).`);
  console.log(`Output: ${DIST}`);
};

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
