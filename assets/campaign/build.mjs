// MediVasc campaign asset build.
//
// Renders three campaign directions across five delivery formats from a single
// layout engine. Everything that can drift from the live site is read from the
// site's own data files rather than retyped here: the palette comes from the
// active theme in data/themes.json, the headline from data/site-config.json,
// and the contact details from data/company.json.
//
//   node assets/campaign/build.mjs            # render everything
//   node assets/campaign/build.mjs --only 01  # render one direction
//
// The build fails loudly rather than shipping a broken asset: `verify.mjs`
// checks every laid-out block against the canvas safe area, the reserved
// artwork zone, and a WCAG contrast floor before a single PNG is written.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as qr from './qr.mjs';
import { loadFonts, wrap, wrapRuns, balanceRuns, renderLines, blockBox, blockHeight, advance, escapeXml } from './text.mjs';
import { verifyLayout, reportVerification } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = here;

const readJson = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));

// ---------------------------------------------------------------------------
// Brand inputs — sourced from the site, not restated
// ---------------------------------------------------------------------------

const [company, siteConfig, themes] = await Promise.all([
  readJson('data/company.json'),
  readJson('data/site-config.json'),
  readJson('data/themes.json'),
]);

const theme = themes.find((t) => t.id === siteConfig.theme);
if (!theme) {
  throw new Error(`campaign: site-config.json selects theme "${siteConfig.theme}", which is not in themes.json`);
}

const light = theme.light;
const dark = theme.dark;

/** 7428028708 -> "+91 74280 28708" */
function formatIndianMobile(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) throw new Error(`campaign: company.whatsapp is not a 10-digit number: ${raw}`);
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

const whatsappDigits = String(company.whatsapp).replace(/\D/g, '').slice(-10);
const copy = {
  kicker: 'FOOT & LEG AMPUTATION PREVENTION',
  headline: siteConfig.heroHeadline,
  accent: siteConfig.heroAccent,
  body: 'Customized, affordable home therapy protocols with regular guidance and follow-up until the desired result.',
  conditions: ['LYMPHEDEMA', 'DIABETIC FOOT', 'VENOUS ULCERS', 'DVT PREVENTION'],
  phone: formatIndianMobile(company.whatsapp),
  waLink: `https://wa.me/91${whatsappDigits}`,
  site: 'medivasc.in',
  email: company.email,
  city: company.address,
};

// The headline is split into runs so the accent word can be italic without a
// hand-written line break. Matching is on the word, not an index, so an admin
// edit to heroHeadline/heroAccent flows through.
function headlineRuns(accentFill) {
  const words = copy.headline.split(/\s+/);
  const target = copy.accent.trim().toLowerCase();
  const runs = [];
  for (const word of words) {
    const isAccent = word.replace(/[^a-z]/gi, '').toLowerCase() === target;
    runs.push({ text: word, family: isAccent ? 'serifItalic' : 'serif', fill: isAccent ? accentFill : undefined });
  }
  if (!runs.some((r) => r.family === 'serifItalic')) {
    throw new Error(`campaign: heroAccent "${copy.accent}" does not occur in heroHeadline "${copy.headline}"`);
  }
  return runs;
}


// The ground line under the contact block. It is anchored to the divider rather
// than a fixed canvas fraction so it settles behind the contact row in every
// aspect ratio instead of slicing through the QR code or the pill.
function wave(f, fill, stroke, strokeOpacity = 1) {
  const y = (f.waveY ?? 0.74) * f.h + f.u * 92;
  const dip = f.u * 30;
  const c = (t) => y + dip * t;
  return (
    `<path d="M0 ${c(0)}C${f.w * 0.24} ${c(-1.2)} ${f.w * 0.47} ${c(-0.7)} ${f.w * 0.68} ${c(1.4)}` +
    `C${f.w * 0.82} ${c(2.7)} ${f.w * 0.92} ${c(2.6)} ${f.w} ${c(1.3)}V${f.h}H0Z" fill="${fill}"/>` +
    `<path d="M0 ${c(1.5)}C${f.w * 0.23} ${c(0.3)} ${f.w * 0.46} ${c(0.9)} ${f.w * 0.67} ${c(2.9)}` +
    `C${f.w * 0.81} ${c(4.2)} ${f.w * 0.92} ${c(4.1)} ${f.w} ${c(2.8)}" fill="none" stroke="${stroke}" ` +
    `stroke-width="${Math.max(1.5, f.u * 2.2)}" opacity="${strokeOpacity}"/>`
  );
}

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

const directions = [
  {
    id: '01-protective',
    label: 'PROTECTIVE',
    art: 'protective-shield.png',
    fade: { top: 0.16 },
    logo: 'logo-ink-tm-lg.png',
    ink: light['--ink'],
    muted: light['--ink-muted'],
    accent: light['--accent'],
    base: light['--bg'],
    rule: light['--line'],
    cta: { fill: light['--primary'], text: light['--primary-ink'] },
    qr: { dark: light['--ink'], light: light['--surface'] },
    background: (f) => `
      <rect width="${f.w}" height="${f.h}" fill="${light['--bg']}"/>
      <circle cx="${f.art.cx}" cy="${f.art.cy}" r="${f.art.r}" fill="${light['--primary-soft']}"/>
      <circle cx="${f.art.cx}" cy="${f.art.cy}" r="${f.art.r * 0.78}" fill="none" stroke="${light['--surface']}" stroke-width="${Math.max(2, f.u * 3)}"/>
      <rect x="0" y="0" width="${Math.max(10, f.u * 14)}" height="${f.h}" fill="${light['--accent']}"/>
      ${wave(f, light['--surface-2'], light['--line'])}`,
  },
  {
    id: '02-standing-ground',
    label: 'STANDING GROUND',
    art: 'say-no-emblem.png',
    // The emblem is a protective cradle. The previous build stroked a
    // prohibition slash across it, which read as a blade through the limb and
    // inverted the whole message — nothing is drawn over the artwork now.
    fade: { top: 0.10 },
    logo: 'logo-paper-tm-lg.png',
    ink: dark['--ink'],
    muted: dark['--ink-muted'],
    accent: dark['--accent'],
    base: dark['--bg'],
    rule: dark['--line'],
    cta: { fill: dark['--ink'], text: dark['--bg'] },
    qr: { dark: dark['--bg'], light: dark['--ink'] },
    background: (f) => `
      <rect width="${f.w}" height="${f.h}" fill="${dark['--bg']}"/>
      <circle cx="${f.art.cx}" cy="${f.art.cy}" r="${f.art.r}" fill="${dark['--surface-2']}"/>
      <circle cx="${f.art.cx}" cy="${f.art.cy}" r="${f.art.r * 1.06}" fill="none" stroke="${dark['--primary-soft']}" stroke-width="${Math.max(2, f.u * 2.5)}"/>
      <rect x="0" y="0" width="${Math.max(10, f.u * 14)}" height="${f.h}" fill="${dark['--accent']}"/>
      ${wave(f, dark['--surface'], dark['--line'])}`,
  },
  {
    id: '03-every-step',
    label: 'EVERY STEP',
    art: 'every-step.png',
    fade: { top: 0.14 },
    logo: 'logo-paper-tm-lg.png',
    ink: '#F4FAF8',
    muted: '#BBD6D0',
    accent: dark['--accent'],
    base: '#0C4A45',
    rule: '#2C6F68',
    cta: { fill: '#F4FAF8', text: '#0B3A36' },
    qr: { dark: '#0B3A36', light: '#F4FAF8' },
    background: (f) => `
      <rect width="${f.w}" height="${f.h}" fill="url(#pine)"/>
      <circle cx="${f.art.cx}" cy="${f.art.cy}" r="${f.art.r}" fill="#0A3E3A" opacity=".85"/>
      <circle cx="${f.art.cx}" cy="${f.art.cy}" r="${f.art.r * 1.08}" fill="none" stroke="#2C6F68" stroke-width="${Math.max(2, f.u * 2)}" opacity=".6"/>
      <rect x="0" y="0" width="${Math.max(10, f.u * 14)}" height="${f.h}" fill="${dark['--accent']}"/>
      ${wave(f, '#0A3E3A', dark['--accent'], 0.55)}`,
  },
];

// ---------------------------------------------------------------------------
// Formats
//
// `pad` is the safe area. `bleed` is trim overflow for print only. `art.x` is
// the left edge of the reserved artwork column as a fraction of the canvas —
// text columns are narrowed to clear it, which is what makes overlap
// structurally impossible rather than a thing to eyeball.
// ---------------------------------------------------------------------------

const FORMATS = {
  'x-header': {
    w: 1500, h: 500, dpi: 72, layout: 'landscape',
    pad: { x: 68, top: 52, bottom: 46 },
    type: { kicker: 16, headline: 54, body: 21, cond: 13, cta: 21, fine: 14 },
    art: { x: 0.66, w: 0.30 },
    // The avatar is drawn over the bottom-left of the header at roughly a
    // fifth of the canvas width; content underneath it is never seen.
    obstructions: [{ name: 'X profile avatar', rect: { x: 0, y: 330, w: 310, h: 170 } }],
    note: 'X / Twitter profile header',
  },
  portrait: {
    w: 1080, h: 1350, dpi: 72, layout: 'stack',
    pad: { x: 76, top: 72, bottom: 72 },
    type: { kicker: 21, headline: 82, body: 32, cond: 18, cta: 31, fine: 17 },
    art: { x: 0.50, w: 0.56 },
    qrSize: 168,
    note: 'WhatsApp / Instagram feed',
  },
  square: {
    w: 1080, h: 1080, dpi: 72, layout: 'stack',
    pad: { x: 72, top: 64, bottom: 64 },
    type: { kicker: 19, headline: 68, body: 28, cond: 17, cta: 28, fine: 16 },
    art: { x: 0.55, w: 0.52 },
    density: 0.8,
    qrSize: 148,
    note: 'Instagram / Facebook feed',
  },
  story: {
    w: 1080, h: 1920, dpi: 72, layout: 'stack',
    pad: { x: 84, top: 220, bottom: 240 },
    type: { kicker: 22, headline: 88, body: 34, cond: 19, cta: 33, fine: 18 },
    art: { mode: 'band' },
    qrSize: 184,
    note: 'WhatsApp Status / Instagram Story (UI-safe top and bottom insets)',
  },
  'a5-print': {
    w: 1783, h: 2516, dpi: 300, layout: 'stack', bleed: 35,
    pad: { x: 190, top: 190, bottom: 190 },
    type: { kicker: 32, headline: 126, body: 48, cond: 27, cta: 46, fine: 25 },
    art: { x: 0.50, w: 0.56 },
    qrSize: 300,
    note: 'A5 handout, 300 dpi, 3 mm bleed',
  },
};

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const fontCss = await loadFonts(root);

/**
 * Trim an illustration and dissolve its cut edge.
 *
 * Each illustration is a limb that ends in a hard horizontal crop. On an
 * amputation-prevention flyer a flat-cut limb reads as a stump, so the top edge
 * is faded out instead of terminating.
 */
async function prepareArt(direction, width, height) {
  const source = path.join(here, 'artwork', direction.art);
  const meta = await sharp(source).metadata();
  // Two passes: sharp will not reorder extract-then-trim within one pipeline,
  // and the inset strips the 4px of encoder fringe around each illustration.
  const inset = await sharp(source)
    .extract({ left: 4, top: 4, width: meta.width - 8, height: meta.height - 8 })
    .png()
    .toBuffer();
  const trimmed = await sharp(inset)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .png()
    .toBuffer();

  const fitted = await sharp(trimmed)
    .resize({ width: Math.round(width), height: Math.round(height), fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const fade = direction.fade?.top ?? 0;
  if (!fade) return fitted;

  const { width: fw, height: fh } = await sharp(fitted).metadata();
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fw}" height="${fh}">` +
      `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
      `<stop offset="${fade}" stop-color="#fff" stop-opacity="1"/></linearGradient></defs>` +
      `<rect width="${fw}" height="${fh}" fill="url(#f)"/></svg>`,
  );
  return sharp(fitted).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function logoBuffer(direction, width) {
  return sharp(path.join(root, 'assets/brand', direction.logo))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize({ width: Math.round(width) })
    .png()
    .toBuffer();
}

// A speech bubble with a handset — the WhatsApp affordance, drawn in our own
// palette rather than pasting the platform's trademarked mark.
function whatsappGlyph(x, y, size, fill) {
  const s = size / 24;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}">` +
    `<path d="M12 1.6A10.2 10.2 0 0 0 3.2 17L1.8 22.2l5.35-1.4A10.2 10.2 0 1 0 12 1.6Zm0 1.9a8.3 8.3 0 1 1-4.32 15.4l-.36-.22-3.03.79.8-2.95-.24-.38A8.3 8.3 0 0 1 12 3.5Z"/>` +
    `<path d="M8.9 7.1c.2-.02.42-.02.6.02.2.05.38.34.5.63.14.33.5 1.2.55 1.29.05.1.08.2.02.33-.06.13-.1.2-.2.32l-.3.35c-.1.1-.2.21-.09.41.12.2.53.87 1.14 1.41.78.7 1.44.92 1.64 1.02.2.1.32.09.44-.05.12-.14.5-.59.64-.79.13-.2.27-.16.45-.1.18.07 1.15.55 1.35.65.2.1.33.15.38.23.05.09.05.5-.12.98-.17.48-.99.94-1.37.99-.35.05-.78.07-1.26-.08a11.4 11.4 0 0 1-1.14-.43c-2-.88-3.32-2.93-3.42-3.07-.1-.13-.83-1.11-.83-2.12s.53-1.5.72-1.71c.19-.2.41-.25.55-.28Z"/>` +
    `</g>`
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Build the full drawing plan for one direction in one format.
 *
 * Returns `{ blocks, art, svgBody }` where `blocks` is the list of laid-out
 * rectangles the verifier checks. No PNG is written until verification passes.
 */
async function composeStack(direction, format, fmt) {
  const { w, h, pad, type } = fmt;
  const u = w / 1080;
  // `density` opens or tightens the vertical rhythm for aspect ratios that give
  // the stack more (story) or less (square) room than the portrait default.
  const g = (n) => n * u * (fmt.density ?? 1);
  const contentW = w - pad.x * 2;
  const band = fmt.art.mode === 'band';
  const artLeft = band ? pad.x : fmt.art.x * w;
  const narrowW = band ? contentW : artLeft - pad.x - 28 * u;

  const blocks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  // -------------------------------------------------------------------------
  // Bottom stack. Laid out first and anchored to the bottom pad, because the
  // top stack is then justified into whatever room is left over — that is what
  // stops the portrait and print sizes from pooling dead space above the fold.
  // -------------------------------------------------------------------------

  const bottom = [];
  let by = h - pad.bottom;

  const fineStyle = { family: 'sans', size: type.fine, weight: 600, tracking: type.fine * 0.11, fill: direction.muted };
  const fineText = `${copy.city.toUpperCase()}  ·  ${copy.email.toUpperCase()}`;
  const fineLines = await wrap(fineText, contentW, fineStyle);
  by -= blockHeight(fineLines, type.fine * 1.5, fineStyle);
  const fineOpts = { x: pad.x, baseline: by + type.fine * 0.82, lineHeight: type.fine * 1.5, style: fineStyle };
  bottom.push(renderLines(fineLines, fineOpts));
  track('fineprint', blockBox(fineLines, fineOpts));
  by -= g(38);

  // Contact row: site + WhatsApp pill on the left, scan block on the right,
  // both vertically centred on the row so the two groups read as one band.
  const qrSize = fmt.qrSize;
  const qrLabelStyle = { family: 'sans', size: type.fine, weight: 600, tracking: type.fine * 0.08, fill: direction.muted };
  // Right-aligned to the QR's right edge: the code sits flush to the safe area,
  // so a centred label wider than the code would hang off the canvas.
  const qrLabelLines = await wrap('SCAN TO WHATSAPP US', qrSize * 1.7, qrLabelStyle);
  const qrLabelH = blockHeight(qrLabelLines, type.fine * 1.4, qrLabelStyle);
  const rightH = qrLabelH + g(12) + qrSize;

  const siteStyle = { family: 'sans', size: type.cta * 0.9, weight: 600, tracking: 0, fill: direction.ink };
  const siteLines = await wrap(copy.site, contentW, siteStyle);
  const siteH = blockHeight(siteLines, siteStyle.size * 1.3, siteStyle);
  const ctaH = Math.round(type.cta * 2.72);
  const leftH = siteH + g(20) + ctaH;

  const rowH = Math.max(leftH, rightH);
  by -= rowH;
  const rowTop = by;

  // left group
  let ly = rowTop + (rowH - leftH) / 2;
  const siteOpts = { x: pad.x, baseline: ly + siteStyle.size * 0.82, lineHeight: siteStyle.size * 1.3, style: siteStyle };
  bottom.push(renderLines(siteLines, siteOpts));
  track('site', blockBox(siteLines, siteOpts));
  ly += siteH + g(20);

  const glyph = type.cta * 1.02;
  const phoneStyle = { family: 'sans', size: type.cta, weight: 600, tracking: 0, fill: direction.cta.text };
  const phoneW = await advance(copy.phone, phoneStyle);
  const pillPadX = type.cta * 0.92;
  const pillW = pillPadX * 2 + glyph + type.cta * 0.6 + phoneW;
  bottom.push(
    `<rect x="${pad.x}" y="${ly}" width="${pillW}" height="${ctaH}" rx="${ctaH / 2}" fill="${direction.cta.fill}"/>`,
    whatsappGlyph(pad.x + pillPadX, ly + (ctaH - glyph) / 2, glyph, direction.cta.text),
  );
  const phoneOpts = {
    x: pad.x + pillPadX + glyph + type.cta * 0.6,
    baseline: ly + ctaH / 2 + type.cta * 0.35,
    lineHeight: type.cta,
    style: phoneStyle,
  };
  bottom.push(renderLines([{ words: [{ text: copy.phone, x: 0, family: 'sans', fill: phoneStyle.fill }], width: phoneW }], phoneOpts));
  track('cta-pill', { x: pad.x, y: ly, w: pillW, h: ctaH });

  // right group
  const qrX = w - pad.x - qrSize;
  let ry = rowTop + (rowH - rightH) / 2;
  const qrLabelOpts = {
    x: qrX + qrSize,
    baseline: ry + type.fine * 0.82,
    lineHeight: type.fine * 1.4,
    style: qrLabelStyle,
    align: 'right',
  };
  bottom.push(renderLines(qrLabelLines, qrLabelOpts));
  track('qr-label', blockBox(qrLabelLines, qrLabelOpts));
  ry += qrLabelH + g(12);

  const qrPad = qrSize * 0.055;
  bottom.push(
    `<rect x="${qrX}" y="${ry}" width="${qrSize}" height="${qrSize}" rx="${qrSize * 0.09}" fill="${direction.qr.light}"/>`,
    `<path d="${qr.svgPath(copy.waLink, qrSize - qrPad * 2, { quiet: 2 })}" transform="translate(${qrX + qrPad} ${ry + qrPad})" fill="${direction.qr.dark}" shape-rendering="crispEdges"/>`,
  );
  track('qr', { x: qrX, y: ry, w: qrSize, h: qrSize });

  by -= g(34);

  const condStyle = { family: 'sans', size: type.cond, weight: 600, tracking: type.cond * 0.09, fill: direction.muted };
  const condLines = await wrap(copy.conditions.join('   ·   '), contentW, condStyle);
  by -= blockHeight(condLines, type.cond * 1.65, condStyle);
  const condOpts = { x: pad.x, baseline: by + type.cond * 0.82, lineHeight: type.cond * 1.65, style: condStyle };
  bottom.push(renderLines(condLines, condOpts));
  track('conditions', blockBox(condLines, condOpts));
  by -= g(28);

  const dividerY = by;
  bottom.unshift(
    `<rect x="${pad.x}" y="${dividerY}" width="${contentW}" height="${Math.max(1, u)}" fill="${direction.rule}" opacity=".5"/>`,
  );

  // -------------------------------------------------------------------------
  // Top stack. Every item's height is measured first, then the gaps between
  // them are scaled by one factor so the stack fills the space above the
  // divider instead of leaving a pool of air under the body copy.
  // -------------------------------------------------------------------------

  const logoW = Math.round(232 * u);
  const logoH = (await sharp(await logoBuffer(direction, logoW)).metadata()).height;

  const kickerStyle = { family: 'sans', size: type.kicker, weight: 600, tracking: type.kicker * 0.15, fill: direction.ink };
  const kickerLines = await wrap(copy.kicker, contentW, kickerStyle);
  const kickerH = blockHeight(kickerLines, type.kicker * 1.5, kickerStyle);

  const ruleH = Math.max(3, 5 * u);
  const ruleW = 62 * u;

  const headlineBase = { family: 'serif', size: type.headline, weight: 600, tracking: -type.headline * 0.022, fill: direction.ink };
  const { lines: headlineLines, style: headlineStyle } = await balanceRuns(headlineRuns(direction.accent), narrowW, headlineBase);
  const headlineH = blockHeight(headlineLines, headlineStyle.size * 1.1, headlineStyle);

  const bodyStyle = { family: 'sans', size: type.body, weight: 400, tracking: 0, fill: direction.ink };
  // Full width: the artwork column stops at the headline, so nothing sits
  // beside the body copy.
  const bodyLines = await wrap(copy.body, contentW * 0.94, bodyStyle);
  const bodyH = blockHeight(bodyLines, type.body * 1.38, bodyStyle);

  const baseGaps = [54, 16, 46, 44];
  const fixed = logoH + kickerH + ruleH + headlineH + bodyH;
  const gapTotal = baseGaps.reduce((a, b) => a + b, 0) * u * (fmt.density ?? 1);
  const target = dividerY - g(52) - pad.top - fixed;
  // Clamped: the layout should breathe into slack, not dissolve into it, and
  // must never compress past its designed rhythm. In band mode the leftover
  // space belongs to the illustration, so the type keeps its natural rhythm.
  const flex = band ? 1 : Math.min(2.1, Math.max(0.9, target / gapTotal));
  const gap = (i) => baseGaps[i] * u * (fmt.density ?? 1) * flex;

  const draw = [];
  let y = pad.top;
  const logoBox = track('logo', { x: pad.x, y, w: logoW, h: logoH });
  y += logoH + gap(0);

  const kickerOpts = { x: pad.x, baseline: y + type.kicker * 0.82, lineHeight: type.kicker * 1.5, style: kickerStyle };
  draw.push(renderLines(kickerLines, kickerOpts));
  track('kicker', blockBox(kickerLines, kickerOpts));
  y += kickerH + gap(1);

  draw.push(`<rect x="${pad.x}" y="${y}" width="${ruleW}" height="${ruleH}" rx="${ruleH / 2}" fill="${direction.accent}"/>`);
  track('rule', { x: pad.x, y, w: ruleW, h: ruleH });
  const ruleBottom = y + ruleH;
  y = ruleBottom + gap(2);

  const headlineOpts = { x: pad.x, baseline: y + headlineStyle.size * 0.8, lineHeight: headlineStyle.size * 1.1, style: headlineStyle };
  draw.push(renderLines(headlineLines, headlineOpts));
  track('headline', blockBox(headlineLines, headlineOpts));
  const headlineBottom = y + headlineH;
  y = headlineBottom + gap(3);

  const bodyOpts = { x: pad.x, baseline: y + type.body * 0.82, lineHeight: type.body * 1.38, style: bodyStyle };
  draw.push(renderLines(bodyLines, bodyOpts));
  track('body', blockBox(bodyLines, bodyOpts));
  const topStackBottom = y + bodyH;

  draw.push(...bottom);

  // The artwork column starts below the rule, which lets the kicker run at full
  // width and keeps the illustration clear of every flowed block.
  const bandGap = g(34);
  const art = band
    ? {
        x: pad.x,
        y: topStackBottom + bandGap,
        w: contentW,
        h: Math.max(80, dividerY - bandGap * 2 - (topStackBottom + bandGap)),
      }
    : {
        x: artLeft,
        y: ruleBottom + g(14),
        // Clamped to the canvas: sharp cannot composite past the edge.
        w: Math.min(fmt.art.w * w, w - artLeft),
        h: Math.max(80, headlineBottom - (ruleBottom + g(14))),
      };

  return {
    blocks,
    art,
    logo: { ...logoBox },
    waveY: dividerY / h,
    gap: band ? dividerY - (art.y + art.h) - bandGap : dividerY - topStackBottom,
    svgBody: draw.join(''),
    u,
  };
}

async function composeLandscape(direction, format, fmt) {
  const { w, h, pad, type } = fmt;
  const u = w / 1500;
  const artLeft = fmt.art.x * w;
  const textW = artLeft - pad.x - 40 * u;

  const blocks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  // Measure first, position second, so the column can be justified into the
  // canvas height rather than leaving a slab of dead space above the footer.
  const logoW = Math.round(196 * u);
  const logoH = (await sharp(await logoBuffer(direction, logoW)).metadata()).height;

  const kickerStyle = { family: 'sans', size: type.kicker, weight: 600, tracking: type.kicker * 0.16, fill: direction.muted };
  const kickerLines = await wrap(copy.kicker, textW, kickerStyle);
  const kickerH = blockHeight(kickerLines, type.kicker * 1.5, kickerStyle);

  const headlineBase = { family: 'serif', size: type.headline, weight: 600, tracking: -type.headline * 0.022, fill: direction.ink };
  const { lines: headlineLines, style: headlineStyle } = await balanceRuns(headlineRuns(direction.accent), textW, headlineBase);
  const headlineH = blockHeight(headlineLines, headlineStyle.size * 1.12, headlineStyle);

  const ctaStyle = { family: 'sans', size: type.cta, weight: 600, tracking: 0, fill: direction.ink };
  const ctaLines = await wrap(`${copy.site}   ·   WhatsApp ${copy.phone}`, textW, ctaStyle);
  const ctaH = blockHeight(ctaLines, type.cta * 1.4, ctaStyle);

  const condStyle = { family: 'sans', size: type.cond, weight: 600, tracking: type.cond * 0.1, fill: direction.muted };
  const condLines = await wrap(copy.conditions.join('  ·  '), textW, condStyle);
  const condH = blockHeight(condLines, type.cond * 1.5, condStyle);

  const baseGaps = [26, 20, 24];
  const fixed = logoH + kickerH + headlineH + ctaH;
  const gapTotal = baseGaps.reduce((a, b) => a + b, 0) * u;
  // The flowed column stops above any platform chrome that overlaps it
  // horizontally, so the contact line cannot end up behind the avatar.
  const columnRight = pad.x + textW;
  const chromeTop = Math.min(
    ...(fmt.obstructions ?? [])
      .filter((o) => o.rect.x < columnRight && o.rect.x + o.rect.w > pad.x)
      .map((o) => o.rect.y - 20 * u),
    Infinity,
  );
  const footerTop = Math.min(h - pad.bottom - condH - 26 * u, chromeTop);
  const flex = Math.min(1.9, Math.max(0.85, (footerTop - pad.top - fixed) / gapTotal));
  const gap = (i) => baseGaps[i] * u * flex;

  const draw = [];
  let y = pad.top;
  const logoBox = track('logo', { x: pad.x, y, w: logoW, h: logoH });
  y += logoH + gap(0);

  const kickerOpts = { x: pad.x, baseline: y + type.kicker * 0.82, lineHeight: type.kicker * 1.5, style: kickerStyle };
  draw.push(renderLines(kickerLines, kickerOpts));
  track('kicker', blockBox(kickerLines, kickerOpts));
  y += kickerH + gap(1);

  const headlineOpts = { x: pad.x, baseline: y + headlineStyle.size * 0.8, lineHeight: headlineStyle.size * 1.12, style: headlineStyle };
  draw.push(renderLines(headlineLines, headlineOpts));
  track('headline', blockBox(headlineLines, headlineOpts));
  y += headlineH + gap(2);

  const ctaOpts = { x: pad.x, baseline: y + type.cta * 0.82, lineHeight: type.cta * 1.4, style: ctaStyle };
  draw.push(renderLines(ctaLines, ctaOpts));
  track('cta', blockBox(ctaLines, ctaOpts));

  // Right-aligned along the text column: X overlays the profile picture on the
  // bottom-left of the header, which is exactly where a left-aligned footer
  // line would land.
  const condOpts = {
    x: pad.x + textW,
    baseline: h - pad.bottom - type.cond * 0.2,
    lineHeight: type.cond * 1.5,
    style: condStyle,
    align: 'right',
  };
  draw.push(renderLines(condLines, condOpts));
  track('conditions', blockBox(condLines, condOpts));

  const artTop = 18 * u;
  const art = {
    x: artLeft,
    y: artTop,
    w: Math.min(fmt.art.w * w, w - artLeft),
    h: h - artTop * 2,
  };

  return { blocks, art, logo: logoBox, gap: Infinity, svgBody: draw.join(''), u };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function canvasSvg(fmt, body) {
  const bleed = fmt.bleed ?? 0;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt.w}" height="${fmt.h}" viewBox="0 0 ${fmt.w} ${fmt.h}">` +
      `<defs><style>${fontCss}</style>` +
      `<linearGradient id="pine" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#0E6B63"/><stop offset=".55" stop-color="#0C4A45"/><stop offset="1" stop-color="#092F2C"/>` +
      `</linearGradient></defs>${body}</svg>`,
  );
}

async function render(direction, format) {
  const fmt = FORMATS[format];
  const compose = fmt.layout === 'landscape' ? composeLandscape : composeStack;
  const plan = await compose(direction, format, fmt);

  const verification = verifyLayout({ plan, fmt, direction, format });
  if (!verification.ok) return { verification, target: null };

  const artBuf = await prepareArt(direction, plan.art.w, plan.art.h);
  const artMeta = await sharp(artBuf).metadata();
  const artX = Math.round(plan.art.x + (plan.art.w - artMeta.width) / 2);
  const artY = Math.round(plan.art.y + (plan.art.h - artMeta.height) / 2);

  // The decorative halo tracks the artwork so it never lands behind the text.
  const bg = direction.background({
    w: fmt.w,
    h: fmt.h,
    u: plan.u,
    waveY: plan.waveY,
    art: {
      cx: artX + artMeta.width / 2,
      cy: artY + artMeta.height / 2,
      r: Math.min(artMeta.width, artMeta.height) * 0.62,
    },
  });

  const logo = await logoBuffer(direction, plan.logo.w);
  const target = path.join(outDir, `${direction.id}-${format}.png`);

  await sharp(canvasSvg(fmt, bg))
    .composite([
      { input: artBuf, left: Math.max(0, artX), top: Math.max(0, artY) },
      { input: canvasSvg(fmt, plan.svgBody), left: 0, top: 0 },
      { input: logo, left: Math.round(plan.logo.x), top: Math.round(plan.logo.y) },
    ])
    .removeAlpha()
    .withMetadata({ density: fmt.dpi })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(target);

  return { verification, target };
}

// ---------------------------------------------------------------------------
// Contact sheet
// ---------------------------------------------------------------------------

async function contactSheet(rendered) {
  const cellW = 520;
  const gutter = 44;
  const padSheet = 76;
  const headerH = 168;
  const rowLabelH = 52;
  const formats = ['x-header', 'portrait', 'square', 'story', 'a5-print'];

  const cells = [];
  for (const dir of directions) {
    const row = [];
    for (const format of formats) {
      const file = rendered.get(`${dir.id}|${format}`);
      if (!file) continue;
      const thumb = await sharp(file).resize({ width: cellW, height: cellW, fit: 'inside' }).png().toBuffer();
      const meta = await sharp(thumb).metadata();
      row.push({ thumb, ...meta, format });
    }
    cells.push({ dir, row });
  }

  const rowHeights = cells.map((c) => Math.max(...c.row.map((x) => x.height)) + rowLabelH + gutter);
  const sheetW = padSheet * 2 + cells[0].row.length * cellW + (cells[0].row.length - 1) * gutter;
  const sheetH = headerH + rowHeights.reduce((a, b) => a + b, 0) + padSheet;

  const composites = [];
  const labels = [];
  let y = headerH;
  for (const [i, cell] of cells.entries()) {
    labels.push(
      `<text x="${padSheet}" y="${y + 26}" font-family="'Instrument Sans', sans-serif" font-size="20" font-weight="600" letter-spacing="2.2" fill="#182A2E">${escapeXml(`${cell.dir.id.slice(0, 2)}  ${cell.dir.label}`)}</text>`,
    );
    let x = padSheet;
    for (const item of cell.row) {
      const top = y + rowLabelH + Math.round((Math.max(...cell.row.map((c) => c.height)) - item.height) / 2);
      composites.push({ input: item.thumb, left: x + Math.round((cellW - item.width) / 2), top });
      if (i === 0) {
        labels.push(
          `<text x="${x + cellW / 2}" y="${headerH - 18}" text-anchor="middle" font-family="'Instrument Sans', sans-serif" font-size="17" font-weight="600" letter-spacing="1.4" fill="#55666B">${escapeXml(item.format.toUpperCase())}</text>`,
        );
      }
      x += cellW + gutter;
    }
    y += rowHeights[i];
  }

  const base = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}">` +
      `<defs><style>${fontCss}</style></defs>` +
      `<rect width="${sheetW}" height="${sheetH}" fill="#EEEAE2"/>` +
      `<text x="${padSheet}" y="76" font-family="'Instrument Sans', sans-serif" font-size="38" font-weight="600" fill="#182A2E">MediVasc campaign · 3 directions × ${cells[0].row.length} formats</text>` +
      `<text x="${padSheet}" y="116" font-family="'Instrument Sans', sans-serif" font-size="21" fill="#55666B">Palette, headline and contact details built from the live site data (theme: ${escapeXml(theme.label)})</text>` +
      labels.join('') +
      `</svg>`,
  );

  const target = path.join(outDir, 'contact-sheet.png');
  await sharp(base).composite(composites).removeAlpha().png({ compressionLevel: 9 }).toFile(target);
  return target;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

const qrCheck = qr.selfTest(copy.waLink);
console.log(`QR ${copy.waLink} — version ${qrCheck.version}-${qrCheck.level}, mask ${qrCheck.mask}, round-trip OK\n`);

const rendered = new Map();
const results = [];
for (const direction of directions) {
  if (only && !direction.id.startsWith(only)) continue;
  for (const format of Object.keys(FORMATS)) {
    const { verification, target } = await render(direction, format);
    results.push({ id: `${direction.id} · ${format}`, verification });
    if (target) rendered.set(`${direction.id}|${format}`, target);
  }
}

const allOk = reportVerification(results);
if (!allOk) {
  console.error('\ncampaign: layout verification failed — no contact sheet written.');
  process.exit(1);
}

const sheet = await contactSheet(rendered);
console.log(`\nWrote ${rendered.size} assets + ${path.relative(root, sheet)}`);
