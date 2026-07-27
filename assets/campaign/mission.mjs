// The mission card — 3:2 landscape, INK surface.
//
//   node assets/campaign/mission.mjs
//
// The owner signed off 02-ink (build.mjs) and drew this layout: logo, then three
// lines of capitals, then one destination. Nothing else — no body paragraph, no
// conditions strip, no reason-to-act-now, and no rule under the call to action
// (the drawing had one; the owner cut it). A mission card is not a flyer; it
// says what the practice is for, once.
//
// Written as its own entry point rather than a sixth FORMATS entry because a
// format in build.mjs renders across all eight treatments and lands in the
// contact sheet. This layout belongs to one treatment and one set of words.
//
// The surface is read from the same source build.mjs reads — data/site-config
// selects the theme, the theme's dark tokens are the INK direction — so a theme
// change moves this card exactly as it moves the campaign.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadFonts, wrapRuns, renderLines, blockBox, blockHeight } from './text.mjs';
import { verifyLayout, reportVerification } from './verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.join(here, 'mission');

const readJson = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));

const [siteConfig, themes] = await Promise.all([
  readJson('data/site-config.json'),
  readJson('data/themes.json'),
]);

const theme = themes.find((t) => t.id === siteConfig.theme);
if (!theme) throw new Error(`mission: site-config.json selects theme "${siteConfig.theme}", not in themes.json`);
const dark = theme.dark;

// The INK direction, token for token as build.mjs declares it.
const direction = {
  id: '02-ink',
  mark: 'mark-paper.png',
  logo: 'logo-paper-tm-lg.png',
  ink: dark['--ink'],
  muted: dark['--ink-muted'],
  accent: dark['--accent'],
  base: dark['--bg'],
  markTint: dark['--surface-2'],
  link: dark['--accent'],
};

// ---------------------------------------------------------------------------
// Words
//
// One stack of three lines, all at one size and one weight. MISSION is not a
// label on this card and is not set like one — it is the first of the three
// lines, and the sentence runs straight through it.
//
// Line breaks are authored: where a three-line mission breaks is a design
// decision, not something a wrapper should infer from a column width.
//
// Colour does the work that size no longer does. The two accent lines are the
// frame — what this is, and what it is for — with the subject between them, and
// they sit on opposite edges, which is the composition.
// ---------------------------------------------------------------------------

const copy = {
  stack: [
    { text: 'MISSION', fill: 'accent' },
    { text: 'FOOT & LEG AMPUTATION' },
    { text: 'PREVENTION', fill: 'accent', align: 'right' },
  ],
  cta: { lead: 'VISIT', site: 'medivasc.in' },
};

// The width is fixed and the height is not: `h` is solved from the rhythm at the
// bottom of this file, because the card is a stack of five things one step
// apart and its height is whatever that comes to. Started at 3:2 with the step
// falling out of the canvas; the step is the design and the canvas follows it.
const fmt = {
  w: 1620,
  h: null,
  dpi: 72,
  pad: { x: 104, top: 88, bottom: 88 },
  // The stack gets a measure, not the full column: the right of the canvas is
  // given to the mark, and a line run edge to edge would sit on top of it.
  measure: 0.86,
  // `stack` is a ceiling, not a size — the setting is solved against the measure
  // and only clamped here.
  type: { stack: 210, cta: 46 },
  // The one gap in the card: lockup to first line, line to line, last line to
  // the destination. The visible space between two lines comes out ~7px more,
  // since a line's box is fractionally taller than the capitals in it — 88 here
  // renders as 95, which is 80% of the 119 the 3:2 canvas used to force.
  step: 88,
  // The lockup carries the top of a card whose type runs to 90px. At the 300px
  // it took when the stack was smaller it read as a corner mark rather than as
  // the thing that signs the card.
  logo: 348,
  mark: { size: 0.86, x: 0.54, y: -0.10 },
};

// Fraunces, the signed-off flyer's own face, set in capitals. Capitals accent by
// colour alone: an italic capital is a different letterform, not an emphasis.
//
// `body` is the visual height of one line as a fraction of the size, and it is
// deliberately not the line box. Capitals have no descender, so measuring them
// with the box's 26% descender allowance hangs a phantom gap under every line
// and makes an evenly stepped stack read bottom-heavy.
const VOICE = { family: 'serif', weight: 600, trackingRatio: -0.008, leading: 1.06, baseline: 0.74, body: 0.78 };

const fontCss = await loadFonts(root);

// ---------------------------------------------------------------------------
// Helpers (the two build.mjs keeps private, at this canvas's scale)
// ---------------------------------------------------------------------------

async function logoBuffer(width) {
  return sharp(path.join(root, 'assets/brand', direction.logo))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize({ width: Math.round(width) })
    .png()
    .toBuffer();
}

async function markLayer() {
  const size = Math.round(fmt.mark.size * fmt.w);
  const shape = await sharp(path.join(root, 'assets/brand', direction.mark)).resize({ width: size }).png().toBuffer();
  const { width, height } = await sharp(shape).metadata();
  const tinted = await sharp({ create: { width, height, channels: 4, background: direction.markTint } })
    .composite([{ input: shape, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const x = Math.round(fmt.mark.x * fmt.w);
  const y = Math.round(fmt.mark.y * fmt.w);
  const left = Math.max(0, -x);
  const top = Math.max(0, -y);
  const cropW = Math.min(width - left, fmt.w - Math.max(0, x));
  const cropH = Math.min(height - top, fmt.h - Math.max(0, y));
  if (cropW <= 0 || cropH <= 0) throw new Error('mission: the mark falls entirely off the canvas');
  return {
    input: await sharp(tinted).extract({ left, top, width: cropW, height: cropH }).png().toBuffer(),
    left: Math.max(0, x),
    top: Math.max(0, y),
  };
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

/**
 * Set the authored lines at the largest common size that fits the measure.
 *
 * Width alone, now that the canvas height follows the type rather than
 * constraining it. `balanceRuns` in text.mjs solves the other problem — it
 * chooses the breaks. It cannot be used here: these breaks are given, and
 * re-wrapping would silently discard them. Returns how much of the measure the
 * longest line fills, so the caller can reject a setting that came out timid.
 */
async function setStack(maxWidth, base, { minScale = 0.45, step = 2 } = {}) {
  const set = async (size) => {
    const style = { ...base, size, tracking: base.tracking * (size / base.size) };
    const measured = await Promise.all(
      copy.stack.map(async (line) => {
        const fill = line.fill === 'accent' ? direction.accent : direction.ink;
        const runs = line.text.split(/\s+/).map((text) => ({ text, family: VOICE.family, fill }));
        const [wrapped] = await wrapRuns(runs, Number.MAX_SAFE_INTEGER, style);
        return { ...wrapped, align: line.align ?? 'left' };
      }),
    );
    return { lines: measured, style, fill: Math.max(...measured.map((l) => l.width)) / maxWidth };
  };

  const floor = Math.max(1, Math.round(base.size * minScale));
  for (let size = base.size; size >= floor; size -= step) {
    const candidate = await set(size);
    if (candidate.lines.every((l) => l.width <= maxWidth)) return candidate;
  }
  return set(floor);
}

// ---------------------------------------------------------------------------
// Layout
//
// One rhythm, from the lockup to the destination: the logo, each line of the
// stack and the call to action are all one equal step apart. That is the
// drawing — every element one ruled line from the next — and it is not the
// signed-off portrait's rhythm, which holds the message up under the lockup and
// gathers the whole leftover into one field below it. Different card.
// ---------------------------------------------------------------------------

/**
 * Solve the type and, from it, the canvas.
 *
 * The stack is set against the measure; the height is then whatever five things
 * one `step` apart add up to. Doing it the other way round — fixing 3:2 and
 * letting the step be the residual — is how the first version ended up with a
 * 119px rhythm nobody chose.
 */
async function solve() {
  const { w, pad, type, step } = fmt;
  const u = w / 1620;
  const measure = (w - pad.x * 2) * fmt.measure;

  const logoW = Math.round(fmt.logo * u);
  const logoH = (await sharp(await logoBuffer(logoW)).metadata()).height;

  const stack = await setStack(measure, {
    family: VOICE.family, size: type.stack, weight: VOICE.weight,
    tracking: type.stack * VOICE.trackingRatio, fill: direction.ink,
  });
  const lineH = stack.style.size * VOICE.body;

  // n lines between the lockup and the destination means n+1 gaps: logo→first,
  // each line→the next, last→destination. The call to action's own box is
  // `cta * 1.08` deep from its top to below its baseline.
  const n = stack.lines.length;
  const h = pad.top + logoH + n * lineH + (n + 1) * step + type.cta * 1.08 + pad.bottom;

  // Even, because an odd dimension is a half-pixel centre for anything that
  // later scales or crops this.
  return { stack, lineH, logoW, logoH, measure, h: 2 * Math.round(h / 2) };
}

async function compose(solved) {
  const { w, h, pad, type, step } = fmt;
  const { stack, lineH, logoW, logoH, measure } = solved;
  const u = w / 1620;
  const contentW = w - pad.x * 2;

  const blocks = [];
  const checks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };
  const draw = [];

  // --- lockup --------------------------------------------------------------
  const logoBox = track('logo', { x: pad.x, y: pad.top, w: logoW, h: logoH });

  // --- the destination, sitting on the bottom safe line ---------------------
  const ctaStyle = { family: 'sans', size: type.cta, weight: 600, tracking: 0, fill: direction.muted };
  const ctaLines = await wrapRuns(
    [{ text: copy.cta.lead, fill: direction.muted }, { text: copy.cta.site, fill: direction.link }],
    contentW,
    ctaStyle,
  );
  const ctaBaseline = h - pad.bottom - type.cta * 0.26;
  const ctaOpts = { x: pad.x, baseline: ctaBaseline, lineHeight: type.cta * 1.3, style: ctaStyle };
  const ctaBox = blockBox(ctaLines, ctaOpts);
  const arrowSize = type.cta * 0.86;
  const arrowX = pad.x + ctaLines[0].width + type.cta * 0.44;
  draw.push(
    renderLines(ctaLines, ctaOpts),
    arrow(arrowX, ctaBaseline - type.cta * 0.28, arrowSize, direction.link, Math.max(2, type.cta * 0.075)),
  );
  track('cta', { ...ctaBox, w: arrowX + arrowSize - pad.x });

  // --- the stack ------------------------------------------------------------
  // A mission set at two thirds of its measure reads as a caption. The floor is
  // a check rather than a comment: reworded copy that no longer fills the column
  // fails the build instead of shipping small.
  checks.push({
    check: 'fill',
    name: 'stack measure',
    ok: stack.fill >= 0.82,
    detail: `longest line fills ${(stack.fill * 100).toFixed(0)}% of the measure, floor 82%`,
  });

  // The step is an input now, so the thing worth checking is that the canvas
  // solved from it actually holds it — a rounding to an even height, a logo that
  // trimmed taller than expected, and the last gap is the one that absorbs it.
  const closing = ctaBox.y - (pad.top + logoH + stack.lines.length * (lineH + step));
  checks.push({
    check: 'flow',
    name: 'closing gap',
    ok: Math.abs(closing - step) <= 2,
    detail: `${closing.toFixed(1)}px before the call to action, the step is ${step}px`,
  });

  // The right edge is the longest flush-left line's own edge, not an abstract
  // column: a flush-right line has to land where the reader has already been
  // reading to, and PREVENTION ending anywhere but exactly under AMPUTATION
  // reads as a near-miss rather than as alignment.
  const rightEdge = pad.x + Math.max(...stack.lines.filter((l) => l.align !== 'right').map((l) => l.width));

  let top = pad.top + logoH + step;
  for (const [i, line] of stack.lines.entries()) {
    const x = line.align === 'right' ? rightEdge - line.width : pad.x;
    const opts = { x, baseline: top + stack.style.size * VOICE.baseline, lineHeight: lineH, style: stack.style };
    draw.push(renderLines([line], opts));
    const box = track(`stack line ${i + 1}`, blockBox([line], opts));
    if (line.align === 'right') {
      // Asserted, not assumed. This is the alignment the whole composition is
      // hung on, and a rounding error in it is exactly the kind of near-miss
      // nobody sees in code and everybody sees on the card.
      checks.push({
        check: 'alignment',
        name: `"${line.text ?? line.words.map((word) => word.text).join(' ')}" flush right`,
        ok: Math.abs(box.x + box.w - rightEdge) <= 1,
        detail: `ends at ${(box.x + box.w).toFixed(1)}, the column edge is ${rightEdge.toFixed(1)}`,
      });
    }
    top += lineH + step;
  }

  return {
    blocks,
    checks,
    logo: logoBox,
    // The void between the stack and the destination. Negative means they touch.
    gap: ctaBox.y - (top - step),
    svgBody: draw.join(''),
    contrast: [
      { name: 'stack', fg: direction.ink, bg: direction.base, size: stack.style.size },
      { name: 'stack on mark', fg: direction.ink, bg: direction.markTint, size: stack.style.size },
      { name: 'accent line', fg: direction.accent, bg: direction.base, size: stack.style.size },
      { name: 'accent line on mark', fg: direction.accent, bg: direction.markTint, size: stack.style.size },
      { name: 'cta', fg: direction.muted, bg: direction.markTint, size: type.cta },
      { name: 'cta site', fg: direction.link, bg: direction.markTint, size: type.cta },
    ],
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const canvasSvg = (body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt.w}" height="${fmt.h}" viewBox="0 0 ${fmt.w} ${fmt.h}">` +
      `<defs><style>${fontCss}</style></defs>${body}</svg>`,
  );

await fs.mkdir(outDir, { recursive: true });

const solved = await solve();
fmt.h = solved.h;

const plan = await compose(solved);
const verification = verifyLayout({ plan, fmt, direction, format: 'mission' });
if (!reportVerification([{ id: 'mission', verification }])) {
  console.error('\nmission: layout verification failed — nothing written.');
  process.exit(1);
}

const target = path.join(outDir, 'mission.png');
await sharp(canvasSvg(`<rect width="${fmt.w}" height="${fmt.h}" fill="${direction.base}"/>`))
  .composite([
    await markLayer(),
    { input: canvasSvg(plan.svgBody), left: 0, top: 0 },
    { input: await logoBuffer(plan.logo.w), left: Math.round(plan.logo.x), top: Math.round(plan.logo.y) },
  ])
  .removeAlpha()
  .withMetadata({ density: fmt.dpi })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(target);

console.log(
  `\nWrote ${path.relative(root, target)} — ${fmt.w}×${fmt.h} ` +
    `(${(fmt.w / fmt.h).toFixed(3)}:1), type ${solved.stack.style.size}px, step ${fmt.step}px`,
);
