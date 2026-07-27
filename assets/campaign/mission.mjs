// The mission card — 3:2 landscape, INK surface.
//
//   node assets/campaign/mission.mjs
//
// The owner signed off 02-ink (build.mjs) and drew this layout: logo, MISSION,
// the mission itself, one destination, a rule. Four elements and nothing else —
// no body paragraph, no conditions strip, no reason-to-act-now. A mission card
// is not a flyer; it says what the practice is for, once.
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
import { loadFonts, wrapRuns, renderLines, blockBox, blockHeight, advance } from './text.mjs';
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
  label: 'INK',
  mark: 'mark-paper.png',
  logo: 'logo-paper-tm-lg.png',
  ink: dark['--ink'],
  muted: dark['--ink-muted'],
  accent: dark['--accent'],
  base: dark['--bg'],
  markTint: dark['--surface-2'],
  line: dark['--line'],
  link: dark['--accent'],
};

// ---------------------------------------------------------------------------
// Words
//
// The eyebrow names the register; the claim is the mission. Line breaks are
// authored, because where a three-word mission breaks is a design decision and
// not something a wrapper should decide from a column width. `accent` is matched
// by word, so the mission can be reworded without re-marking anything by index.
// ---------------------------------------------------------------------------

const copy = {
  eyebrow: 'MISSION',
  accent: 'prevention',
  cta: { lead: 'Visit', site: 'medivasc.in' },
};

const VARIANTS = [
  {
    id: 'a',
    note: 'two lines — the mission as one phrase, the point on its own line',
    claim: ['Foot & leg amputation', 'prevention'],
    measure: 0.68,
  },
  {
    id: 'b',
    // Three lines are height-bound on a 3:2 canvas, not width-bound, so a wide
    // measure cannot be filled at any size that also fits. The column narrows to
    // match the setting the height allows — which is also the better shape here:
    // a tall column on the left, the mark reading clear on the right.
    note: 'three lines — a narrow column, the mark given the right half',
    claim: ['Foot & leg', 'amputation', 'prevention'],
    measure: 0.50,
  },
];

// 3:2. 1620 × 1080 keeps the short edge at the campaign's own 1080, so the type
// scale carries over from the signed-off portrait rather than being re-guessed.
const fmt = {
  w: 1620,
  h: 1080,
  dpi: 72,
  pad: { x: 104, top: 88, bottom: 88 },
  // The claim gets a measure, not the full column: the right of the canvas is
  // given to the mark, and a claim run edge to edge would sit on top of it.
  measure: 0.68,
  // `claim` is a ceiling, not a size: the setting is solved against the measure
  // and only clamped here, so a short line breaks into a large setting and a
  // long one into a smaller — which is the whole difference between the two
  // variants below.
  type: { eyebrow: 26, claim: 210, cta: 40 },
  mark: { size: 0.88, x: 0.50, y: -0.12 },
};

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
 * Set authored lines at the largest common size that keeps every one of them
 * inside the measure.
 *
 * `balanceRuns` in text.mjs solves the other problem — it chooses the breaks. It
 * cannot be used here: these breaks are given, and re-wrapping would silently
 * discard them. Returns the fitted lines, the style, and how much of the measure
 * the longest line actually fills, so the caller can reject a setting that came
 * out timid.
 */
async function setAuthored(lines, maxWidth, maxHeight, lineHeight, style, { minScale = 0.45, step = 2 } = {}) {
  const floor = Math.max(1, Math.round(style.size * minScale));
  for (let size = style.size; size >= floor; size -= step) {
    const scaled = { ...style, size, tracking: (style.tracking ?? 0) * (size / style.size) };
    const wrapped = await Promise.all(lines.map((runs) => wrapRuns(runs, Number.MAX_SAFE_INTEGER, scaled)));
    const flat = wrapped.map((w) => w[0]);
    // Solved against the box, not the column. Three short lines want a far
    // larger setting than two long ones, and on a 3:2 canvas it is the height
    // that stops them — fitting on width alone puts variant b through the floor.
    const fits = flat.every((l) => l.width <= maxWidth) && blockHeight(flat, size * lineHeight, scaled) <= maxHeight;
    if (fits) {
      return { lines: flat, style: scaled, fill: Math.max(...flat.map((l) => l.width)) / maxWidth };
    }
  }
  const scaled = { ...style, size: floor, tracking: (style.tracking ?? 0) * (floor / style.size) };
  const wrapped = await Promise.all(lines.map((runs) => wrapRuns(runs, Number.MAX_SAFE_INTEGER, scaled)));
  const flat = wrapped.map((w) => w[0]);
  return { lines: flat, style: scaled, fill: Math.max(...flat.map((l) => l.width)) / maxWidth };
}

/** Split an authored line into runs, italicising and accenting the point word. */
function claimRuns(line) {
  const target = copy.accent.toLowerCase();
  return line.split(/\s+/).map((word) => {
    const isAccent = word.replace(/[^a-z]/gi, '').toLowerCase() === target;
    return { text: word, family: isAccent ? 'serifItalic' : 'serif', fill: isAccent ? direction.accent : undefined };
  });
}

// ---------------------------------------------------------------------------
// Layout
//
// The vertical rhythm is the signed-off portrait's, turned on its side: lockup
// at the top, the message directly under it, then one collected void carrying
// the mark, then the footer on the bottom safe line. Spreading the slack across
// every gap instead opens three small holes, which reads as a mistake.
// ---------------------------------------------------------------------------

async function compose(variant) {
  const { w, h, pad, type } = fmt;
  const u = w / 1620;
  const contentW = w - pad.x * 2;
  const measure = contentW * (variant.measure ?? fmt.measure);

  const blocks = [];
  const checks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };
  const draw = [];

  // --- lockup --------------------------------------------------------------
  const logoW = Math.round(300 * u);
  const logoH = (await sharp(await logoBuffer(logoW)).metadata()).height;
  const logoBox = track('logo', { x: pad.x, y: pad.top, w: logoW, h: logoH });

  // --- footer: the rule sits on the bottom safe line, the destination above it
  const ruleWeight = Math.max(2, Math.round(2 * u));
  const ruleY = h - pad.bottom - ruleWeight;
  const accentRun = Math.round(contentW * 0.14);
  draw.push(
    `<rect x="${pad.x}" y="${ruleY}" width="${contentW}" height="${ruleWeight}" fill="${direction.line}"/>`,
    `<rect x="${pad.x}" y="${ruleY}" width="${accentRun}" height="${ruleWeight}" fill="${direction.accent}"/>`,
  );
  track('rule', { x: pad.x, y: ruleY, w: contentW, h: ruleWeight });

  const ctaStyle = { family: 'sans', size: type.cta, weight: 600, tracking: 0, fill: direction.muted };
  const ctaLines = await wrapRuns(
    [{ text: copy.cta.lead, fill: direction.muted }, { text: copy.cta.site, fill: direction.link }],
    contentW,
    ctaStyle,
  );
  const ctaBaseline = ruleY - 30 * u - type.cta * 0.26;
  const ctaOpts = { x: pad.x, baseline: ctaBaseline, lineHeight: type.cta * 1.3, style: ctaStyle };
  const ctaBox = blockBox(ctaLines, ctaOpts);
  const arrowSize = type.cta * 0.86;
  const arrowX = pad.x + ctaLines[0].width + type.cta * 0.44;
  draw.push(
    renderLines(ctaLines, ctaOpts),
    arrow(arrowX, ctaBaseline - type.cta * 0.28, arrowSize, direction.link, Math.max(2, type.cta * 0.075)),
  );
  track('cta', { ...ctaBox, w: arrowX + arrowSize - pad.x });

  // --- the message, under the lockup ---------------------------------------
  const eyebrowStyle = {
    family: 'sans', size: type.eyebrow, weight: 600,
    tracking: type.eyebrow * 0.22, fill: direction.accent,
  };
  const eyebrowLines = await wrapRuns([{ text: copy.eyebrow }], contentW, eyebrowStyle);
  const eyebrowH = blockHeight(eyebrowLines, type.eyebrow * 1.4, eyebrowStyle);

  // The message starts under the lockup; the claim may take everything down to
  // the footer bar one held-back void, which is the field the mark reads in.
  const claimTop = pad.top + logoH + 82 * u + eyebrowH + 34 * u;
  const minVoid = 76 * u;

  const LEADING = 1.05;
  const claimBase = { family: 'serif', size: type.claim, weight: 600, tracking: -type.claim * 0.024, fill: direction.ink };
  const claim = await setAuthored(
    variant.claim.map(claimRuns),
    measure,
    ctaBox.y - claimTop - minVoid,
    LEADING,
    claimBase,
  );
  const claimLH = claim.style.size * LEADING;
  const claimH = blockHeight(claim.lines, claimLH, claim.style);

  // A setting that is height-bound leaves nothing over and sits where it starts.
  // One that is width-bound — the two-line variant — leaves a void, and dropping
  // the whole of it under the message opens a hole the mark cannot fill on a
  // canvas this shallow. So the leftover is split: a little above the message,
  // the rest below, which reads as air rather than as a missing element.
  const slack = Math.max(0, (ctaBox.y - minVoid) - (claimTop + claimH));
  const drop = slack * 0.34;

  // A mission set at two thirds of its measure reads as a caption. The floor is
  // a check rather than a comment: a reworded claim that no longer fills the
  // column fails the build instead of shipping small.
  checks.push({
    check: 'fill',
    name: 'claim measure',
    ok: claim.fill >= 0.82,
    detail: `longest line fills ${(claim.fill * 100).toFixed(0)}% of the measure, floor 82%`,
  });

  const eyebrowY = pad.top + logoH + 82 * u + drop;
  const eyebrowOpts = { x: pad.x, baseline: eyebrowY + type.eyebrow * 0.82, lineHeight: type.eyebrow * 1.4, style: eyebrowStyle };
  draw.push(renderLines(eyebrowLines, eyebrowOpts));
  track('eyebrow', blockBox(eyebrowLines, eyebrowOpts));

  const y = claimTop + drop;
  const claimOpts = { x: pad.x, baseline: y + claim.style.size * 0.8, lineHeight: claimLH, style: claim.style };
  draw.push(renderLines(claim.lines, claimOpts));
  track('claim', blockBox(claim.lines, claimOpts));
  const messageBottom = y + claimH;

  return {
    blocks,
    checks,
    logo: logoBox,
    // The void between the message and the footer. Negative means they collide.
    gap: ctaBox.y - messageBottom,
    svgBody: draw.join(''),
    contrast: [
      { name: 'eyebrow', fg: direction.accent, bg: direction.base, size: type.eyebrow },
      { name: 'eyebrow on mark', fg: direction.accent, bg: direction.markTint, size: type.eyebrow },
      { name: 'claim', fg: direction.ink, bg: direction.base, size: claim.style.size },
      { name: 'claim on mark', fg: direction.ink, bg: direction.markTint, size: claim.style.size },
      { name: 'accent word', fg: direction.accent, bg: direction.markTint, size: claim.style.size },
      { name: 'cta', fg: direction.muted, bg: direction.markTint, size: type.cta },
      { name: 'cta site', fg: direction.link, bg: direction.markTint, size: type.cta },
      { name: 'rule accent', fg: direction.accent, bg: direction.base, size: 0, floor: 3 },
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

const results = [];
const written = [];
for (const variant of VARIANTS) {
  const plan = await compose(variant);
  const verification = verifyLayout({ plan, fmt, direction, format: `mission-${variant.id}` });
  results.push({ id: `mission-${variant.id}`, verification });
  if (!verification.ok) continue;

  const target = path.join(outDir, `mission-${variant.id}.png`);
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
  written.push(target);
}

if (!reportVerification(results)) {
  console.error('\nmission: layout verification failed — nothing written for the failing variants.');
  process.exit(1);
}

console.log(`\nWrote ${written.length} files to ${path.relative(root, outDir)} (${fmt.w}×${fmt.h}, 3:2)`);
