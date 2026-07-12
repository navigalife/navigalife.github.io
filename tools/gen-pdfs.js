const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'dist', 'catalogues');
const TEMPLATE_PATH = '/src/templates/catalogue.html';
const SYSTEM_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const startServer = () => new Promise((resolve, reject) => {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const candidate = path.resolve(ROOT, pathname.replace(/^\/+/, ''));
    if (candidate !== ROOT && !candidate.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(candidate, (error, content) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(candidate)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    });
  });
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const browserExecutable = () => {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH];
  try {
    candidates.push(puppeteer.executablePath());
  } catch {
    // Puppeteer reports a missing browser below if no local fallback exists.
  }
  candidates.push(...SYSTEM_CHROME_PATHS);
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
};

const main = async () => {
  const products = JSON.parse(await fsp.readFile(path.join(ROOT, 'data', 'products.json'), 'utf8'));
  const catalogueProducts = products.filter((product) => product.visible && product.catalogue);
  if (!catalogueProducts.length) throw new Error('No visible catalogue products found.');

  await fsp.mkdir(OUTPUT, { recursive: true });
  const server = await startServer();
  const address = server.address();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: browserExecutable(),
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => console.error(`Catalogue page error: ${error.message}`));

    for (const product of catalogueProducts) {
      const url = `http://127.0.0.1:${address.port}${TEMPLATE_PATH}?id=${encodeURIComponent(product.id)}`;
      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.documentElement.dataset.catalogueReady === 'true', {
        timeout: 15000,
      });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMediaType('print');
      await page.pdf({
        path: path.join(OUTPUT, `${product.id}.pdf`),
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    }
  } finally {
    await browser.close();
    await closeServer(server);
  }

  console.log(`Generated ${catalogueProducts.length} catalogues in ${OUTPUT}.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
