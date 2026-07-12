/**
 * One-off OG image render: assets/brand/og-image.png (1200x630).
 * Uses the real site fonts and the prepared MediVasc mark via puppeteer.
 *
 * Usage: node tools/prepare-og.js
 */
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'brand', 'og-image.png');

const SYSTEM_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const browserExecutable = () => {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH];
  try {
    candidates.push(puppeteer.executablePath());
  } catch {
    // fall through to system Chrome
  }
  candidates.push(...SYSTEM_CHROME_PATHS);
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
};

const asDataUrl = (relativePath, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(ROOT, relativePath)).toString('base64')}`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face{font-family:"Fraunces";font-weight:600;src:url("${asDataUrl('assets/fonts/fraunces-latin-600.woff2', 'font/woff2')}") format("woff2")}
@font-face{font-family:"Instrument Sans";font-weight:400 600;src:url("${asDataUrl('assets/fonts/instrument-sans-latin-400-600.woff2', 'font/woff2')}") format("woff2")}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;display:grid;grid-template-columns:1fr 360px;background:#F5F8F9;color:#132430;font-family:"Instrument Sans",sans-serif;overflow:hidden}
.copy{padding:84px 24px 84px 96px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:18px;margin-bottom:44px}
.brand img{width:64px;height:64px}
.brand span{font-family:"Fraunces",serif;font-size:44px;font-weight:600;letter-spacing:-.03em}
.kicker{color:#0E5F76;font-size:19px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-bottom:22px}
h1{font-family:"Fraunces",serif;font-size:64px;font-weight:600;letter-spacing:-.02em;line-height:1.08;margin-bottom:26px;max-width:14ch}
.sub{color:#48626D;font-size:24px;line-height:1.5;max-width:30ch}
.panel{background:#DEEDF2;display:grid;place-items:center;border-left:1px solid #D5E0E4}
.panel img{width:240px;height:240px;opacity:.92}
</style></head>
<body>
  <div class="copy">
    <div class="brand"><img src="${asDataUrl('assets/brand/mark-ink.png', 'image/png')}" alt=""><span>MediVasc</span></div>
    <div class="kicker">Prevention of foot and leg amputation</div>
    <h1>Amputation is not the only outcome</h1>
    <div class="sub">Customized, affordable home therapy protocols — with documented recoveries.</div>
  </div>
  <div class="panel"><img src="${asDataUrl('assets/brand/mark-ink.png', 'image/png')}" alt=""></div>
</body></html>`;

const run = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: browserExecutable(),
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: OUT, type: 'png' });
    console.log(`OG image written to ${OUT}`);
  } finally {
    await browser.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
