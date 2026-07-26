// MediVasc campaign asset build.
//
// Renders three surface treatments across five delivery formats from a single
// layout engine. Each asset carries one instruction, one line of support, the
// conditions, and one call to action — nothing else.
//
//   node assets/campaign/build.mjs             # render everything
//   node assets/campaign/build.mjs --only 02   # render one treatment
//
// The palette is read from the live site's active theme (data/themes.json via
// data/site-config.json) so the campaign cannot drift out of brand. The words
// are campaign-authored — see `copy` below.
//
// The build fails loudly rather than shipping a broken asset: `verify.mjs`
// checks every laid-out block against the canvas safe area, a WCAG contrast
// floor and any declared platform chrome before a single PNG is written.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadFonts, wrap, wrapRuns, balanceRuns, renderLines, blockBox, blockHeight, escapeXml } from './text.mjs';
import { verifyLayout, reportVerification } from './verify.mjs';
import { composePosterFlyer, composePosterHeader } from './poster.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = here;

const readJson = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));

// ---------------------------------------------------------------------------
// Brand inputs
// ---------------------------------------------------------------------------

const [siteConfig, themes, protocols] = await Promise.all([
  readJson('data/site-config.json'),
  readJson('data/themes.json'),
  readJson('data/protocols.json'),
]);

const theme = themes.find((t) => t.id === siteConfig.theme);
if (!theme) {
  throw new Error(`campaign: site-config.json selects theme "${siteConfig.theme}", which is not in themes.json`);
}

const light = theme.light;
const dark = theme.dark;

const copy = {
  // Written for the flyer, not lifted from the site. A page has a reader who
  // already arrived; a flyer has about two seconds of a stranger's attention.
  // So it leads with the instruction rather than the proposition: what can be
  // done, who it is for, and where to go. These five values are the whole set.
  headline: 'Prevent foot & leg amputation',
  // Italicised and set in the accent colour. Must appear in the headline.
  accent: 'Prevent',
  body: 'Amputation is not the only way out. Home therapy protocols, planned case by case.',
  conditions: ['LYMPHEDEMA', 'DIABETIC FOOT', 'VENOUS ULCERS', 'DVT'],
  cta: { lead: 'Get in touch —', site: 'medivasc.in', tail: 'today' },

  // The poster treatment carries more than the editorial ones: a two-clause
  // claim, the process, and a call to action with a reason to act now. Line
  // breaks in `claim` are authored, because where a poster headline breaks is a
  // design decision; the size that fills the measure is solved, not typed.
  poster: {
    claim: ['PREVENT', 'AMPUTATION.', 'KEEP WALKING.'],
    claimAccents: ['AMPUTATION.', 'WALKING.'],
    support: 'A protocol built around your case, guided at home, and followed up until the result holds.',
    // `from` ties each caption to the engagement step it summarises. The build
    // fails if the step is no longer in data/protocols.json — the flyer cannot
    // describe a process the site does not.
    pillars: [
      { icon: 'magnifier', caption: ['Case studied', 'in detail'], from: 'Detailed case study' },
      { icon: 'clipboard', caption: ['Protocol built', 'for your case'], from: 'protocol designed around the individual case' },
      { icon: 'home', caption: ['Therapy guided', 'at home'], from: 'at home wherever possible' },
      { icon: 'cycle', caption: ['Followed up', 'to the result'], from: 'Regular follow-ups until the desired result' },
    ],
    cta: {
      kicker: 'VISIT',
      site: 'medivasc.in',
      sub: 'Protocols, recovery records and how to reach us.',
      claim: ['REFERRED FOR', 'AMPUTATION?', 'TALK TO US FIRST.'],
    },
  },
};

// The process row is site data, not campaign copy. Every protocol carries the
// same four engagement steps; the flyer shows short forms of them, and this is
// the check that keeps the two in step.
const engagement = protocols.find((p) => p.visible && !p.draft)?.engagement ?? [];
for (const pillar of copy.poster.pillars) {
  if (!engagement.some((step) => step.toLowerCase().includes(pillar.from.toLowerCase()))) {
    throw new Error(
      `campaign: pillar "${pillar.caption.join(' ')}" cites "${pillar.from}", which is no longer an engagement step in data/protocols.json`,
    );
  }
}
if (engagement.length !== copy.poster.pillars.length) {
  throw new Error(`campaign: protocols.json describes ${engagement.length} engagement steps, the poster shows ${copy.poster.pillars.length}`);
}

// The headline is split into runs so the accent word can be italic without a
// hand-written line break. Matching is on the word, not an index, so rewording
// the headline does not require re-marking the accent.
function headlineRuns(accentFill) {
  const target = copy.accent.trim().toLowerCase();
  const runs = copy.headline.split(/\s+/).map((word) => {
    const isAccent = word.replace(/[^a-z]/gi, '').toLowerCase() === target;
    return {
      text: word,
      family: isAccent ? 'serifItalic' : 'serif',
      fill: isAccent ? accentFill : undefined,
    };
  });
  if (!runs.some((r) => r.family === 'serifItalic')) {
    throw new Error(`campaign: accent word "${copy.accent}" does not occur in the headline "${copy.headline}"`);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Surface treatments
//
// `markTint` is the colour of the oversized brand mark in the background. It is
// close enough to `base` to read as a tonal field rather than a picture, which
// is what lets the type run full width across it.
//
// `accent` carries the italic headline word (large text, 3:1 floor). `link` is
// separate because the call to action is set small enough to need the full
// 4.5:1 — the warm terracotta accent misses it on the paper surface.
// ---------------------------------------------------------------------------

const directions = [
  {
    id: '01-paper',
    label: 'PAPER',
    mark: 'mark-ink.png',
    logo: 'logo-ink-tm-lg.png',
    ink: light['--ink'],
    muted: light['--ink-muted'],
    accent: light['--accent'],
    base: light['--bg'],
    markTint: light['--surface-2'],
    link: light['--primary'],
  },
  {
    id: '02-ink',
    label: 'INK',
    mark: 'mark-paper.png',
    logo: 'logo-paper-tm-lg.png',
    ink: dark['--ink'],
    muted: dark['--ink-muted'],
    accent: dark['--accent'],
    base: dark['--bg'],
    markTint: dark['--surface-2'],
    link: dark['--accent'],
  },
  {
    id: '03-pine',
    label: 'PINE',
    mark: 'mark-paper.png',
    logo: 'logo-paper-tm-lg.png',
    ink: '#F4FAF8',
    muted: '#BBD6D0',
    accent: '#F0A97E',
    base: '#0C4A45',
    markTint: '#0A413D',
    link: '#F0A97E',
    gradient: 'pine',
  },
  // The poster. Its purple is the brand mark's own #582078, sampled from the
  // owner's original logo — not a theme token. The website lockup is monochrome
  // by owner rule (AGENTS.md) and the purple lives on collateral, which is what
  // this is. Ink, paper and muted still track the theme, so a theme change still
  // moves the flyer.
  {
    id: '04-violet',
    label: 'POSTER',
    compose: { stack: composePosterFlyer, landscape: composePosterHeader },
    logo: 'logo_newfont/logo_tm/MediVasc-logo-tm-lg.png',
    mark: null,
    base: '#FBFAFD',
    colour: {
      paper: '#FBFAFD',
      ink: '#0C0C0C',            // the wordmark's own black, so the two match exactly
      muted: '#4C4557',
      purple: '#582078',
      line: '#E3D8EE',
      onPurpleDim: '#D9C7EA',
      onPurpleSoft: '#E4D6F0',
      onPurpleLine: '#8659A5',
    },
  },
];

// ---------------------------------------------------------------------------
// Formats
//
// `pad` is the safe area. `bleed` is trim overflow for print only. `mark` is
// the background lockup mark: `size` and the anchor are fractions of the canvas
// width, and it is expected to run off the edges.
// ---------------------------------------------------------------------------

const FORMATS = {
  'x-header': {
    w: 1500, h: 500, dpi: 72, layout: 'landscape',
    pad: { x: 68, top: 52, bottom: 46 },
    type: { headline: 62, body: 22, cond: 13, cta: 26 },
    mark: { size: 1.15, x: 0.60, y: -0.16 },
    // The avatar is drawn over the bottom-left of the header at roughly a fifth
    // of the canvas width; content underneath it is never seen.
    obstructions: [{ name: 'X profile avatar', rect: { x: 0, y: 330, w: 310, h: 170 } }],
    // Three lines of caps do not belong on a 3:1 canvas; the poster claim merges
    // its authored phrases down to two here.
    claimLines: 2,
    note: 'X / Twitter profile header',
  },
  portrait: {
    w: 1080, h: 1350, dpi: 72, layout: 'stack',
    pad: { x: 78, top: 74, bottom: 74 },
    type: { headline: 96, body: 32, cond: 18, cta: 38 },
    mark: { size: 1.02, x: 0.40, y: 0.30 },
    note: 'WhatsApp / Instagram feed',
  },
  square: {
    w: 1080, h: 1080, dpi: 72, layout: 'stack',
    pad: { x: 74, top: 66, bottom: 66 },
    type: { headline: 84, body: 29, cond: 17, cta: 34 },
    mark: { size: 0.94, x: 0.44, y: 0.26 },
    density: 0.86,
    note: 'Instagram / Facebook feed',
  },
  story: {
    w: 1080, h: 1920, dpi: 72, layout: 'stack',
    pad: { x: 86, top: 240, bottom: 260 },
    type: { headline: 104, body: 34, cond: 19, cta: 40 },
    mark: { size: 1.06, x: 0.38, y: 0.36 },
    note: 'WhatsApp Status / Instagram Story (UI-safe top and bottom insets)',
  },
  'a5-print': {
    w: 1783, h: 2516, dpi: 300, layout: 'stack', bleed: 35,
    pad: { x: 196, top: 196, bottom: 196 },
    type: { headline: 156, body: 50, cond: 27, cta: 60 },
    mark: { size: 1.02, x: 0.40, y: 0.31 },
    note: 'A5 handout, 300 dpi, 3 mm bleed',
  },
};

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const fontCss = await loadFonts(root);

/**
 * The brand mark, oversized and recoloured, cropped to whatever falls on the
 * canvas.
 *
 * The mark is the campaign's only graphic. Earlier versions used illustrated
 * limbs, which read as stock imagery bolted onto an editorial layout; the
 * lockup's own molecule geometry cannot look out of place on its own brand.
 * Sharp refuses to composite past the canvas edge, so the overflow is cropped
 * here rather than clamped — the mark is meant to bleed.
 */
async function markLayer(direction, fmt) {
  const size = Math.round(fmt.mark.size * fmt.w);
  const source = path.join(root, 'assets/brand', direction.mark);
  const shape = await sharp(source).resize({ width: size }).png().toBuffer();
  const { width, height } = await sharp(shape).metadata();

  const tinted = await sharp({
    create: { width, height, channels: 4, background: direction.markTint },
  })
    .composite([{ input: shape, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const x = Math.round(fmt.mark.x * fmt.w);
  const y = Math.round(fmt.mark.y * fmt.w);
  const left = Math.max(0, -x);
  const top = Math.max(0, -y);
  const cropW = Math.min(width - left, fmt.w - Math.max(0, x));
  const cropH = Math.min(height - top, fmt.h - Math.max(0, y));
  if (cropW <= 0 || cropH <= 0) throw new Error(`campaign: mark for ${direction.id} falls entirely off the canvas`);

  return {
    input: await sharp(tinted).extract({ left, top, width: cropW, height: cropH }).png().toBuffer(),
    left: Math.max(0, x),
    top: Math.max(0, y),
  };
}

async function logoBuffer(direction, width) {
  return sharp(path.join(root, 'assets/brand', direction.logo))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize({ width: Math.round(width) })
    .png()
    .toBuffer();
}

/** A drawn arrow — the sans subset has no dependable glyph for one. */
function arrow(x, centerY, size, color, weight) {
  const head = size * 0.34;
  return (
    `<g stroke="${color}" stroke-width="${weight}" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M${x} ${centerY}H${x + size}"/>` +
    `<path d="M${x + size - head} ${centerY - head * 0.82}L${x + size} ${centerY}L${x + size - head} ${centerY + head * 0.82}"/>` +
    `</g>`
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The call to action, as one measured line ending in an arrow.
 *
 * Returns its own height so the caller can anchor it without guessing, and its
 * box so verification can check it like any other block.
 */
async function ctaLine(direction, fmt, x, baseline, contentW) {
  const size = fmt.type.cta;
  const style = { family: 'sans', size, weight: 600, tracking: 0, fill: direction.muted };
  const runs = [
    { text: copy.cta.lead, fill: direction.muted },
    { text: copy.cta.site, fill: direction.link },
    { text: copy.cta.tail, fill: direction.muted },
  ];
  const lines = await wrapRuns(runs, contentW, style);
  const opts = { x, baseline, lineHeight: size * 1.3, style };

  const last = lines[lines.length - 1];
  const arrowGap = size * 0.44;
  const arrowSize = size * 0.86;
  const arrowX = x + last.width + arrowGap;
  const arrowY = baseline + (lines.length - 1) * opts.lineHeight - size * 0.28;

  const box = blockBox(lines, opts);
  return {
    draw: renderLines(lines, opts) + arrow(arrowX, arrowY, arrowSize, direction.link, Math.max(2, size * 0.075)),
    box: { ...box, w: arrowX + arrowSize - x },
    height: blockHeight(lines, opts.lineHeight, style),
  };
}

async function composeStack(direction, format, fmt) {
  const { w, h, pad, type } = fmt;
  const u = w / 1080;
  const g = (n) => n * u * (fmt.density ?? 1);
  const contentW = w - pad.x * 2;

  const blocks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  // --- footer, anchored up from the bottom pad -----------------------------
  // The call to action sits last so it is the final thing read.
  const ctaProbe = await ctaLine(direction, fmt, pad.x, 0, contentW);
  const ctaBaseline = h - pad.bottom - (ctaProbe.height - type.cta * 0.82);
  const cta = await ctaLine(direction, fmt, pad.x, ctaBaseline, contentW);
  track('cta', cta.box);

  const condStyle = { family: 'sans', size: type.cond, weight: 600, tracking: type.cond * 0.13, fill: direction.muted };
  const condLines = await wrap(copy.conditions.join('   ·   '), contentW, condStyle);
  const condOpts = {
    x: pad.x,
    baseline: cta.box.y - g(30) - type.cond * 0.26,
    lineHeight: type.cond * 1.6,
    style: condStyle,
  };
  const condBox = track('conditions', blockBox(condLines, condOpts));
  const footerTop = condBox.y;

  // --- top stack, justified into the room above the footer -----------------
  const logoW = Math.round(226 * u);
  const logoH = (await sharp(await logoBuffer(direction, logoW)).metadata()).height;

  const headlineBase = { family: 'serif', size: type.headline, weight: 600, tracking: -type.headline * 0.024, fill: direction.ink };
  const { lines: headlineLines, style: headlineStyle } = await balanceRuns(headlineRuns(direction.accent), contentW, headlineBase);
  const headlineH = blockHeight(headlineLines, headlineStyle.size * 1.06, headlineStyle);

  const bodyStyle = { family: 'sans', size: type.body, weight: 400, tracking: 0, fill: direction.muted };
  const bodyLines = await wrap(copy.body, contentW * 0.82, bodyStyle);
  const bodyH = blockHeight(bodyLines, type.body * 1.42, bodyStyle);

  // The message sits high, just under the lockup, and the leftover height
  // becomes one quiet field carrying the brand mark. Spreading the slack across
  // the gaps instead opens two separate voids, which reads as a mistake;
  // collecting it into one below the message reads as composition.
  const headBodyGap = g(46);
  const groupH = headlineH + headBodyGap + bodyH;
  const bandTop = pad.top + logoH + g(70);
  const bandBottom = footerTop - g(56);
  const slack = Math.max(0, bandBottom - bandTop - groupH);

  const draw = [];
  const logoBox = track('logo', { x: pad.x, y: pad.top, w: logoW, h: logoH });
  let y = bandTop + slack * 0.14;

  const headlineOpts = { x: pad.x, baseline: y + headlineStyle.size * 0.8, lineHeight: headlineStyle.size * 1.06, style: headlineStyle };
  draw.push(renderLines(headlineLines, headlineOpts));
  track('headline', blockBox(headlineLines, headlineOpts));
  y += headlineH + headBodyGap;

  const bodyOpts = { x: pad.x, baseline: y + type.body * 0.82, lineHeight: type.body * 1.42, style: bodyStyle };
  draw.push(renderLines(bodyLines, bodyOpts));
  track('body', blockBox(bodyLines, bodyOpts));
  const topStackBottom = y + bodyH;

  draw.push(renderLines(condLines, condOpts), cta.draw);

  return {
    blocks,
    logo: { ...logoBox },
    gap: footerTop - topStackBottom,
    svgBody: draw.join(''),
    u,
  };
}

async function composeLandscape(direction, format, fmt) {
  const { w, h, pad, type } = fmt;
  const u = w / 1500;
  const textW = w * 0.62 - pad.x;

  const blocks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  const logoW = Math.round(190 * u);
  const logoH = (await sharp(await logoBuffer(direction, logoW)).metadata()).height;

  const headlineBase = { family: 'serif', size: type.headline, weight: 600, tracking: -type.headline * 0.024, fill: direction.ink };
  const { lines: headlineLines, style: headlineStyle } = await balanceRuns(headlineRuns(direction.accent), textW, headlineBase);
  const headlineH = blockHeight(headlineLines, headlineStyle.size * 1.08, headlineStyle);

  const ctaProbe = await ctaLine(direction, fmt, pad.x, 0, textW);

  const condStyle = { family: 'sans', size: type.cond, weight: 600, tracking: type.cond * 0.13, fill: direction.muted };
  const condLines = await wrap(copy.conditions.join('  ·  '), textW, condStyle);
  const condH = blockHeight(condLines, type.cond * 1.5, condStyle);

  const baseGaps = [42, 34, 30];
  const fixed = logoH + headlineH + ctaProbe.height;
  const gapTotal = baseGaps.reduce((a, b) => a + b, 0) * u;

  // The flowed column stops above any platform chrome that overlaps it
  // horizontally, so the call to action cannot end up behind the avatar.
  const columnRight = pad.x + textW;
  const chromeTop = Math.min(
    ...(fmt.obstructions ?? [])
      .filter((o) => o.rect.x < columnRight && o.rect.x + o.rect.w > pad.x)
      .map((o) => o.rect.y - 20 * u),
    Infinity,
  );
  const footerTop = Math.min(h - pad.bottom - condH - 26 * u, chromeTop);
  const flex = Math.min(1.8, Math.max(0.8, (footerTop - pad.top - fixed) / gapTotal));
  const gap = (i) => baseGaps[i] * u * flex;

  const draw = [];
  let y = pad.top;
  const logoBox = track('logo', { x: pad.x, y, w: logoW, h: logoH });
  y += logoH + gap(0);

  const headlineOpts = { x: pad.x, baseline: y + headlineStyle.size * 0.8, lineHeight: headlineStyle.size * 1.08, style: headlineStyle };
  draw.push(renderLines(headlineLines, headlineOpts));
  track('headline', blockBox(headlineLines, headlineOpts));
  y += headlineH + gap(1);

  const cta = await ctaLine(direction, fmt, pad.x, y + type.cta * 0.82, textW);
  draw.push(cta.draw);
  track('cta', cta.box);

  // Right-aligned along the text column: X draws the profile picture over the
  // bottom-left of the header, exactly where a left-aligned footer would land.
  const condOpts = {
    x: w - pad.x,
    baseline: h - pad.bottom - type.cond * 0.26,
    lineHeight: type.cond * 1.5,
    style: condStyle,
    align: 'right',
  };
  draw.push(renderLines(condLines, condOpts));
  track('conditions', blockBox(condLines, condOpts));

  return { blocks, logo: logoBox, gap: Infinity, svgBody: draw.join(''), u };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function canvasSvg(fmt, body) {
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
  const compose = direction.compose
    ? direction.compose[fmt.layout]
    : fmt.layout === 'landscape' ? composeLandscape : composeStack;
  const plan = await compose(direction, format, fmt, {
    copy: copy.poster,
    conditions: copy.conditions,
    logoHeight: async (dir, width) => (await sharp(await logoBuffer(dir, width)).metadata()).height,
  });

  const verification = verifyLayout({ plan, fmt, direction, format });
  if (!verification.ok) return { verification, target: null };

  const fill = direction.gradient ? `url(#${direction.gradient})` : direction.base;
  const background = canvasSvg(fmt, `<rect width="${fmt.w}" height="${fmt.h}" fill="${fill}"/>`);
  // A treatment may have no background mark: the poster's field is its own
  // white space, and a tonal graphic under a symmetric composition muddies it.
  const mark = direction.mark ? [await markLayer(direction, fmt)] : [];
  const logo = await logoBuffer(direction, plan.logo.w);
  const target = path.join(outDir, `${direction.id}-${format}.png`);

  await sharp(background)
    .composite([
      ...mark,
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

  const cells = [];
  for (const dir of directions) {
    const row = [];
    for (const format of Object.keys(FORMATS)) {
      const file = rendered.get(`${dir.id}|${format}`);
      if (!file) continue;
      const thumb = await sharp(file).resize({ width: cellW, height: cellW, fit: 'inside' }).png().toBuffer();
      row.push({ thumb, ...(await sharp(thumb).metadata()), format });
    }
    // `--only` renders one treatment; a sheet row with nothing in it is not a
    // row (and `Math.max()` of no cells is -Infinity, which sharp rejects).
    if (row.length) cells.push({ dir, row });
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
    const tallest = Math.max(...cell.row.map((c) => c.height));
    for (const item of cell.row) {
      composites.push({
        input: item.thumb,
        left: x + Math.round((cellW - item.width) / 2),
        top: y + rowLabelH + Math.round((tallest - item.height) / 2),
      });
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
      `<text x="${padSheet}" y="76" font-family="'Instrument Sans', sans-serif" font-size="38" font-weight="600" fill="#182A2E">MediVasc campaign · 3 treatments × ${cells[0].row.length} formats</text>` +
      `<text x="${padSheet}" y="116" font-family="'Instrument Sans', sans-serif" font-size="21" fill="#55666B">One instruction, one supporting line, one call to action. Palette read from the live site theme (${escapeXml(theme.label)}).</text>` +
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
