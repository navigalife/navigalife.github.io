// MediVasc campaign asset build.
//
// Renders three campaign directions across five delivery formats from a single
// layout engine. The assets are deliberately spare: logo, one claim, one line of
// support, the conditions, and the site name. No contact block, no decoration.
//
// The palette is read from the live site's active theme (data/themes.json via
// data/site-config.json) so the campaign cannot drift out of brand. The words
// are campaign-authored — see `copy` below.
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
import { loadFonts, wrap, balanceRuns, renderLines, blockBox, blockHeight, advance, escapeXml } from './text.mjs';
import { verifyLayout, reportVerification } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = here;

const readJson = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));

// ---------------------------------------------------------------------------
// Brand inputs — sourced from the site, not restated
// ---------------------------------------------------------------------------

const [siteConfig, themes] = await Promise.all([
  readJson('data/site-config.json'),
  readJson('data/themes.json'),
]);

const theme = themes.find((t) => t.id === siteConfig.theme);
if (!theme) {
  throw new Error(`campaign: site-config.json selects theme "${siteConfig.theme}", which is not in themes.json`);
}

const siteUrl = 'https://medivasc.in/';
const light = theme.light;
const dark = theme.dark;

const copy = {
  // Campaign copy is written for the flyer, not lifted from the site. Page copy
  // has a reader who already arrived and is scrolling; a flyer has about two
  // seconds of a stranger's attention, so it gets one claim and one line of
  // support. Change these four values to re-word the whole set.
  headline: 'Amputation is not the only way out',
  accent: 'only',
  body: 'Home therapy protocols, planned case by case and followed until results.',
  conditions: ['LYMPHEDEMA', 'DIABETIC FOOT', 'VENOUS ULCERS', 'DVT'],
  // The one identifier on the artwork. Derived so it cannot drift from the site.
  site: new URL(siteUrl).host.replace(/^www\./, ''),
};

// The headline is split into runs so the accent word can be italic without a
// hand-written line break. Matching is on the word, not an index, so rewording
// the headline does not require re-marking the accent.
function headlineRuns(accentFill) {
  const words = copy.headline.split(/\s+/);
  const target = copy.accent.trim().toLowerCase();
  const runs = [];
  for (const word of words) {
    const isAccent = word.replace(/[^a-z]/gi, '').toLowerCase() === target;
    runs.push({ text: word, family: isAccent ? 'serifItalic' : 'serif', fill: isAccent ? accentFill : undefined });
  }
  if (!runs.some((r) => r.family === 'serifItalic')) {
    throw new Error(`campaign: accent word "${copy.accent}" does not occur in the headline "${copy.headline}"`);
  }
  return runs;
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
    background: (f) => `<rect width="${f.w}" height="${f.h}" fill="${light['--bg']}"/>`,
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
    background: (f) => `<rect width="${f.w}" height="${f.h}" fill="${dark['--bg']}"/>`,
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
    background: (f) => `<rect width="${f.w}" height="${f.h}" fill="url(#pine)"/>`,
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
    // 58 keeps the headline on one line at this column width; 60+ wraps to two
    // and pushes the site line down under the avatar.
    type: { headline: 58, body: 22, cond: 13, site: 22 },
    art: { x: 0.66, w: 0.30 },
    // The avatar is drawn over the bottom-left of the header at roughly a
    // fifth of the canvas width; content underneath it is never seen.
    obstructions: [{ name: 'X profile avatar', rect: { x: 0, y: 330, w: 310, h: 170 } }],
    note: 'X / Twitter profile header',
  },
  portrait: {
    w: 1080, h: 1350, dpi: 72, layout: 'stack',
    pad: { x: 76, top: 72, bottom: 72 },
    type: { headline: 84, body: 31, cond: 18, site: 30 },
    art: { x: 0.55, w: 0.51 },
    note: 'WhatsApp / Instagram feed',
  },
  square: {
    w: 1080, h: 1080, dpi: 72, layout: 'stack',
    pad: { x: 72, top: 64, bottom: 64 },
    type: { headline: 74, body: 28, cond: 17, site: 27 },
    art: { x: 0.55, w: 0.52 },
    density: 0.8,
    note: 'Instagram / Facebook feed',
  },
  story: {
    w: 1080, h: 1920, dpi: 72, layout: 'stack',
    pad: { x: 84, top: 220, bottom: 240 },
    type: { headline: 94, body: 33, cond: 19, site: 32 },
    art: { mode: 'band' },
    note: 'WhatsApp Status / Instagram Story (UI-safe top and bottom insets)',
  },
  'a5-print': {
    w: 1783, h: 2516, dpi: 300, layout: 'stack', bleed: 35,
    pad: { x: 190, top: 190, bottom: 190 },
    type: { headline: 136, body: 48, cond: 27, site: 46 },
    art: { x: 0.50, w: 0.56 },
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

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Build the full drawing plan for one direction in one format.
 *
 * Returns `{ blocks, art, svgBody }` where `blocks` is the list of laid-out
 * rectangles the verifier checks. No PNG is written until verification passes.
 */
/**
 * The footer is one row: conditions on the left, the site on the right. If the
 * two would meet, they stack instead — checked by measurement, not by format.
 */
async function footerRow(direction, fmt, u, contentW) {
  const { w, h, pad, type } = fmt;
  const condStyle = { family: 'sans', size: type.cond, weight: 600, tracking: type.cond * 0.12, fill: direction.muted };
  const siteStyle = { family: 'sans', size: type.site, weight: 600, tracking: 0, fill: direction.ink };

  const condText = copy.conditions.join('   ·   ');
  const condW = await advance(condText, condStyle);
  const siteW = await advance(copy.site, siteStyle);
  const inline = condW + type.cond * 3 + siteW <= contentW;

  const draw = [];
  const boxes = [];
  // Sit the descenders on the safe edge, not the baseline, so the footer is
  // optically aligned with the margin rather than hanging past it.
  const baseline = h - pad.bottom - Math.max(type.site, type.cond) * 0.26;

  const siteLines = await wrap(copy.site, contentW, siteStyle);
  const condLines = await wrap(condText, contentW, condStyle);

  if (inline) {
    const siteOpts = { x: pad.x + contentW, baseline, lineHeight: type.site, style: siteStyle, align: 'right' };
    const condOpts = { x: pad.x, baseline, lineHeight: type.cond, style: condStyle };
    draw.push(renderLines(siteLines, siteOpts), renderLines(condLines, condOpts));
    boxes.push({ name: 'site', ...blockBox(siteLines, siteOpts) }, { name: 'conditions', ...blockBox(condLines, condOpts) });
  } else {
    const siteOpts = { x: pad.x, baseline, lineHeight: type.site, style: siteStyle };
    const condBaseline = baseline - type.site * 1.5;
    const condOpts = { x: pad.x, baseline: condBaseline, lineHeight: type.cond * 1.6, style: condStyle };
    draw.push(renderLines(siteLines, siteOpts), renderLines(condLines, condOpts));
    boxes.push({ name: 'site', ...blockBox(siteLines, siteOpts) }, { name: 'conditions', ...blockBox(condLines, condOpts) });
  }

  const top = Math.min(...boxes.map((b) => b.y));
  return { draw, boxes, top };
}

async function composeStack(direction, format, fmt) {
  const { w, h, pad, type } = fmt;
  const u = w / 1080;
  const g = (n) => n * u * (fmt.density ?? 1);
  const contentW = w - pad.x * 2;
  const band = fmt.art.mode === 'band';
  const artLeft = band ? pad.x : fmt.art.x * w;
  const narrowW = band ? contentW : artLeft - pad.x - 28 * u;

  const blocks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  const footer = await footerRow(direction, fmt, u, contentW);
  for (const box of footer.boxes) blocks.push(box);

  // Measure the top stack, then scale its gaps by one factor so it settles into
  // the space above the footer rather than pooling air under the sub-line.
  const logoW = Math.round(226 * u);
  const logoH = (await sharp(await logoBuffer(direction, logoW)).metadata()).height;

  const headlineBase = { family: 'serif', size: type.headline, weight: 600, tracking: -type.headline * 0.022, fill: direction.ink };
  const { lines: headlineLines, style: headlineStyle } = await balanceRuns(headlineRuns(direction.accent), narrowW, headlineBase);
  const headlineH = blockHeight(headlineLines, headlineStyle.size * 1.08, headlineStyle);

  const bodyStyle = { family: 'sans', size: type.body, weight: 400, tracking: 0, fill: direction.muted };
  const bodyLines = await wrap(copy.body, band ? contentW * 0.9 : narrowW, bodyStyle);
  const bodyH = blockHeight(bodyLines, type.body * 1.4, bodyStyle);

  // The third weight is the gap *after* the body copy. Including it in the
  // distribution is what stops all the leftover room from pooling in one slab
  // above the footer — the slack is shared out in proportion instead.
  const baseGaps = [92, 40, 104];
  const fixed = logoH + headlineH + bodyH;
  const gapTotal = baseGaps.reduce((a, b) => a + b, 0) * u * (fmt.density ?? 1);
  const target = footer.top - pad.top - fixed;
  const flex = Math.min(band ? 1.5 : 2.6, Math.max(0.85, target / gapTotal));
  const gap = (i) => baseGaps[i] * u * (fmt.density ?? 1) * flex;

  const draw = [];
  let y = pad.top;
  const logoBox = track('logo', { x: pad.x, y, w: logoW, h: logoH });
  const logoBottom = y + logoH;
  y += logoH + gap(0);

  const headlineOpts = { x: pad.x, baseline: y + headlineStyle.size * 0.8, lineHeight: headlineStyle.size * 1.08, style: headlineStyle };
  draw.push(renderLines(headlineLines, headlineOpts));
  track('headline', blockBox(headlineLines, headlineOpts));
  const headlineBottom = y + headlineH;
  y = headlineBottom + gap(1);

  const bodyOpts = { x: pad.x, baseline: y + type.body * 0.82, lineHeight: type.body * 1.4, style: bodyStyle };
  draw.push(renderLines(bodyLines, bodyOpts));
  track('body', blockBox(bodyLines, bodyOpts));
  const topStackBottom = y + bodyH;

  draw.push(...footer.draw);

  const bandGap = g(40);
  const art = band
    ? {
        x: pad.x,
        y: topStackBottom + bandGap,
        w: contentW,
        h: Math.max(80, footer.top - bandGap * 2 - (topStackBottom + bandGap)),
      }
    : {
        x: artLeft,
        y: logoBottom + g(26),
        // Clamped to the canvas: sharp cannot composite past the edge.
        w: Math.min(fmt.art.w * w, w - artLeft),
        h: Math.max(80, headlineBottom - (logoBottom + g(26))),
      };

  return {
    blocks,
    art,
    logo: { ...logoBox },
    gap: band ? footer.top - (art.y + art.h) - bandGap : footer.top - topStackBottom,
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

  const logoW = Math.round(190 * u);
  const logoH = (await sharp(await logoBuffer(direction, logoW)).metadata()).height;

  const headlineBase = { family: 'serif', size: type.headline, weight: 600, tracking: -type.headline * 0.022, fill: direction.ink };
  const { lines: headlineLines, style: headlineStyle } = await balanceRuns(headlineRuns(direction.accent), textW, headlineBase);
  const headlineH = blockHeight(headlineLines, headlineStyle.size * 1.1, headlineStyle);

  const siteStyle = { family: 'sans', size: type.site, weight: 600, tracking: 0, fill: direction.ink };
  const siteLines = await wrap(copy.site, textW, siteStyle);
  const siteH = blockHeight(siteLines, type.site * 1.4, siteStyle);

  const condStyle = { family: 'sans', size: type.cond, weight: 600, tracking: type.cond * 0.12, fill: direction.muted };
  const condLines = await wrap(copy.conditions.join('  ·  '), textW, condStyle);
  const condH = blockHeight(condLines, type.cond * 1.5, condStyle);

  const baseGaps = [46, 30, 34];
  const fixed = logoH + headlineH + siteH;
  const gapTotal = baseGaps.reduce((a, b) => a + b, 0) * u;

  // The flowed column stops above any platform chrome that overlaps it
  // horizontally, so the site line cannot end up behind the profile avatar.
  const columnRight = pad.x + textW;
  const chromeTop = Math.min(
    ...(fmt.obstructions ?? [])
      .filter((o) => o.rect.x < columnRight && o.rect.x + o.rect.w > pad.x)
      .map((o) => o.rect.y - 20 * u),
    Infinity,
  );
  const footerTop = Math.min(h - pad.bottom - condH - 26 * u, chromeTop);
  const flex = Math.min(1.8, Math.max(0.85, (footerTop - pad.top - fixed) / gapTotal));
  const gap = (i) => baseGaps[i] * u * flex;

  const draw = [];
  let y = pad.top;
  const logoBox = track('logo', { x: pad.x, y, w: logoW, h: logoH });
  y += logoH + gap(0);

  const headlineOpts = { x: pad.x, baseline: y + headlineStyle.size * 0.8, lineHeight: headlineStyle.size * 1.1, style: headlineStyle };
  draw.push(renderLines(headlineLines, headlineOpts));
  track('headline', blockBox(headlineLines, headlineOpts));
  y += headlineH + gap(1);

  const siteOpts = { x: pad.x, baseline: y + type.site * 0.82, lineHeight: type.site * 1.4, style: siteStyle };
  draw.push(renderLines(siteLines, siteOpts));
  track('site', blockBox(siteLines, siteOpts));

  // Right-aligned along the text column: X draws the profile picture over the
  // bottom-left of the header, exactly where a left-aligned footer would land.
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
      `<text x="${padSheet}" y="116" font-family="'Instrument Sans', sans-serif" font-size="21" fill="#55666B">Logo and site name only. Palette read from the live site theme (${escapeXml(theme.label)}); campaign copy written for the flyer.</text>` +
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
