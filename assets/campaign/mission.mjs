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
//
// The stack is drawn as outlines, not as <text>. See `face` below: this
// librsvg ignores @font-face, so <text> can only ever get what the system
// offers for `serif`/`sans-serif`, and the wordmark's face is neither.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadFonts, wrapRuns, renderLines, blockBox } from './text.mjs';
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

// Two of the three dimensions here are solved, not chosen. `h` comes from the
// rhythm and `pad.x` from the type, at the bottom of this file — the card is a
// stack of five things one step apart, and its type is justified to the column,
// so the canvas and the margins are consequences. Started at 3:2 with the step
// falling out of the canvas; the step is the design and the canvas follows it.
const fmt = {
  w: 1620,
  h: null,
  dpi: 72,
  // `x` is solved. `padX` is what it is aiming for: the stack is set to fill the
  // column between the two margins, then the margins are recomputed from the
  // line that came out, so the left and right are equal by construction rather
  // than by arithmetic that rounds.
  pad: { x: null, padX: 124, top: 88, bottom: 88 },
  // `stack` is a ceiling, not a size — high enough that the column binds the
  // setting and this never does. If it ever binds, the fill check fails.
  type: { stack: 420, cta: 46 },
  // The one gap in the card: lockup to first line, cap line to baseline, last
  // line to the destination. It is the gap between the *cap boxes* — the ink
  // gap comes out ~5px under it, because the O overshoots the cap line and the
  // M dips under the baseline, and boxing to those instead is what makes a
  // round letter read small. 100 here renders as the 95 the owner signed off on
  // when the stack was smaller.
  step: 100,
  // The lockup carries the top of a card whose capitals run over 100px tall. At
  // the 348 it took against the smaller stack it read as a corner mark rather
  // than as the thing that signs the card.
  logo: 420,
  // The mark is a C — an open ring of atoms — and at the scale the flyer uses it
  // (roughly canvas-width) only two or three atoms land on the page, which reads
  // as texture rather than as a molecule. Pulled back, it reads as what it is:
  // the ring arcs in from the right edge with its opening off-canvas.
  //
  // Specified by where it lands, not by raw scale. `span` is how far it reaches
  // in from the right edge, as a fraction of the width. `overflow` is how far it
  // runs past the top and the bottom, as a fraction of the height — it is what
  // sizes the mark now, so the arc always breaks both edges by the same amount
  // whatever the rhythm solves the height to. Filling the height exactly would
  // read as a contained shape; a slight overflow reads as a section of something
  // larger, which is what a molecule is.
  mark: { span: 0.30, overflow: 0.05 },
};

// Exotc350 Demi Bold — the wordmark's own face, the Peignot revival the MediVasc
// lockup is drawn in — set in capitals. Capitals accent by colour alone: an
// italic capital is a different letterform, not an emphasis.
//
// Outlines, not a font file. This librsvg ignores @font-face: an embedded woff2
// data URL is inert and `font-family` resolves to whatever the system has for
// the generic keyword, so a <text> element cannot be made to render this face —
// verified by pixel-diff, `'Fraunces', serif` with the woff2 embedded comes out
// byte-identical to a bare `serif`. Drawing the glyphs does not ask permission.
//
// The outline dump is deliberately NOT in this repo — it is a extracted from a
// licensed face, and this repo is public. It is gitignored and regenerated
// locally instead, which is why this reads as a missing input with instructions
// rather than a file that is simply expected to be there.
const facePath = path.join(here, 'fonts/exotc350.glyphs.json');
const face = JSON.parse(await fs.readFile(facePath, 'utf8').catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  throw new Error(
    'Missing ' + path.relative(process.cwd(), facePath) + '.\n' +
    'The Exotc350 outlines are not committed (licensed face, public repo).\n' +
    'Regenerate them with the advisor\'s tools/brand/glyphs.py, then rerun this.',
  );
}));

// Tracking as a fraction of the em, applied between every pair. Zero is the
// font's own fit, corrected by its kern table.
const VOICE = { trackingRatio: 0 };

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
  const { span, overflow } = fmt.mark;
  // Sized by height, positioned by its left edge: the arc breaks the top and the
  // bottom by `overflow` each and reaches in to `span`, and how far it runs off
  // the right is whatever the mark's own aspect makes of that.
  const size = Math.round((1 + overflow * 2) * fmt.h);
  // Trimmed first, like the lockup. The file carries transparent padding around
  // the C, so sizing and placing its edge puts the *artwork* short of where it
  // was asked to reach — the padding, not the ink, would be breaking the edges.
  const shape = await sharp(path.join(root, 'assets/brand', direction.mark))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize({ height: size })
    .png()
    .toBuffer();
  const { width, height } = await sharp(shape).metadata();
  const tinted = await sharp({ create: { width, height, channels: 4, background: direction.markTint } })
    .composite([{ input: shape, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Left edge at `1 - span` of the width, so the visible arc is exactly the
  // right `span` of the canvas whatever the mark's own aspect turns out to be.
  const x = Math.round(fmt.w * (1 - span));
  const y = -Math.round(fmt.h * overflow);
  const left = Math.max(0, -x);
  const top = Math.max(0, -y);
  // Sharp refuses to composite past the canvas edge, so the overflow is cropped
  // here rather than clamped — the mark is meant to bleed.
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

// ---------------------------------------------------------------------------
// Setting the stack, in outlines
//
// Everything here is in font units until the last moment, which is the point:
// `text.mjs` has to rasterise a string and count pixels to find out how wide it
// is, and this knows. The line's ink extent is exact arithmetic, so the size
// that fills a column is one division rather than a search, and the flush-right
// edge lands on the number instead of near it.
// ---------------------------------------------------------------------------

/** Lay a string out in font units: glyphs at pen positions, plus its ink span. */
function setLine(text) {
  const track = VOICE.trackingRatio * face.upem;
  const glyphs = [];
  let pen = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const g = face.glyphs[ch];
    if (!g) throw new Error(`mission: ${face.family} has no glyph for "${ch}" — regenerate with glyphs.py`);
    if (g.d) {
      glyphs.push({ d: g.d, at: pen });
      x0 = Math.min(x0, pen + g.x0);
      x1 = Math.max(x1, pen + g.x1);
    }
    pen += g.a + track + (face.kern[ch + text[i + 1]] ?? 0);
  }
  // Ink, not advance: a line is as wide as what you can see of it, and the two
  // differ by a side bearing at each end — which is exactly the size of the
  // near-miss a flush-right line would land on.
  return { text, glyphs, x0, x1, units: x1 - x0 };
}

/** Draw a laid-out line at a size, with its ink left or right edge on `edge`. */
function drawLine(line, scale, edge, baseline, fill, align) {
  const originX = align === 'right' ? edge - line.x1 * scale : edge - line.x0 * scale;
  const paths = line.glyphs.map((g) => `<path transform="translate(${g.at} 0)" d="${g.d}"/>`).join('');
  // The flip: font units are y-up from the baseline, the canvas is y-down.
  return `<g fill="${fill}" transform="translate(${originX.toFixed(3)} ${baseline.toFixed(3)}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})">${paths}</g>`;
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
 * Solve the type, and from it the margins and the canvas.
 *
 * The stack is set to the column `pad.padX` implies; the margins are then read
 * back off the line that actually came out, and the height is whatever five
 * things one `step` apart add up to. Doing either the other way round — fixing
 * 3:2 and letting the step be the residual, fixing the margin and letting the
 * line stop wherever it stops — is how the card ended up with a 119px rhythm
 * nobody chose and a right margin two and a half times its left.
 */
async function solve() {
  const { w, pad, type, step } = fmt;
  const u = w / 1620;

  const lines = copy.stack.map((line) => ({ ...setLine(line.text), align: line.align ?? 'left', fill: line.fill }));
  const widestUnits = Math.max(...lines.map((l) => l.units));

  // One division, not a search: ink width is linear in the size, and both the
  // glyph advances and the tracking are in font units, so the size that fills
  // the column exactly is the column over the line's own width in ems.
  const column = w - pad.padX * 2;
  const scale = Math.min(column / widestUnits, type.stack / face.upem);
  const size = scale * face.upem;
  const widest = widestUnits * scale;

  // A line's box is its cap line to its baseline, and nothing else. Boxing to
  // the O's optical overshoot or the M's dip would put a phantom gap on every
  // line of an all-capitals stack; boxing to the font's line height would put a
  // descender's worth of it there.
  const lineH = face.capHeight * scale;

  // The margin is the leftover, halved — floored, so the line lands a rounding
  // inside the safe area rather than a rounding outside it.
  const padX = Math.floor((w - widest) / 2);

  const logoW = Math.round(fmt.logo * u);
  const logoH = (await sharp(await logoBuffer(logoW)).metadata()).height;

  // n lines between the lockup and the destination means n+1 gaps: logo→first,
  // each line→the next, last→destination. The call to action's own box is
  // `cta * 1.08` deep from its top to below its baseline.
  const n = lines.length;
  const h = pad.top + logoH + n * lineH + (n + 1) * step + type.cta * 1.08 + pad.bottom;

  // Even, because an odd dimension is a half-pixel centre for anything that
  // later scales or crops this.
  const stack = { lines, scale, size, widest, fill: widest / column };
  return { stack, lineH, logoW, logoH, padX, h: 2 * Math.round(h / 2) };
}

async function compose(solved) {
  const { w, h, pad, type, step } = fmt;
  const { stack, lineH, logoW, logoH } = solved;
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
  // A mission set at two thirds of its column reads as a caption. The floor is a
  // check rather than a comment: reworded copy that no longer fills the column
  // fails the build instead of shipping small.
  checks.push({
    check: 'fill',
    name: 'stack column',
    ok: stack.fill >= 0.82,
    detail: `longest line fills ${(stack.fill * 100).toFixed(0)}% of the column, floor 82%`,
  });

  // Equal margins are the point, and they are structural — `pad.x` is half the
  // leftover, so the only way they come out unequal is a rounding. The margin
  // being near the one asked for is the part that can actually drift: it is the
  // type's fit, and copy that will not justify to this column would show up here
  // as a margin nothing chose.
  const rightMargin = w - (pad.x + stack.widest);
  checks.push({
    check: 'alignment',
    name: 'margins',
    ok: Math.abs(rightMargin - pad.x) <= 1 && Math.abs(pad.x - pad.padX) <= 10,
    detail: `${pad.x} left, ${rightMargin.toFixed(1)} right, asked for ${pad.padX}`,
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
  const rightEdge =
    pad.x + Math.max(...stack.lines.filter((l) => l.align !== 'right').map((l) => l.units * stack.scale));

  let top = pad.top + logoH + step;
  for (const [i, line] of stack.lines.entries()) {
    const edge = line.align === 'right' ? rightEdge : pad.x;
    const baseline = top + lineH;
    const fill = line.fill === 'accent' ? direction.accent : direction.ink;
    draw.push(drawLine(line, stack.scale, edge, baseline, fill, line.align));
    const box = track(`stack line ${i + 1}`, {
      x: line.align === 'right' ? rightEdge - line.units * stack.scale : pad.x,
      y: top,
      w: line.units * stack.scale,
      h: lineH,
    });
    if (line.align === 'right') {
      // Asserted, not assumed. This is the alignment the whole composition is
      // hung on, and a rounding error in it is exactly the kind of near-miss
      // nobody sees in code and everybody sees on the card.
      checks.push({
        check: 'alignment',
        name: `"${line.text}" flush right`,
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
      { name: 'stack', fg: direction.ink, bg: direction.base, size: stack.size },
      { name: 'stack on mark', fg: direction.ink, bg: direction.markTint, size: stack.size },
      { name: 'accent line', fg: direction.accent, bg: direction.base, size: stack.size },
      { name: 'accent line on mark', fg: direction.accent, bg: direction.markTint, size: stack.size },
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
fmt.pad.x = solved.padX;

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
    `(${(fmt.w / fmt.h).toFixed(3)}:1), type ${solved.stack.size.toFixed(0)}px, ` +
    `step ${fmt.step}px, margins ${fmt.pad.x}px`,
);
