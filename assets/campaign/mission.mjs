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
//
// The last line sets flush right against the measure. That is what turns a
// left-aligned stack into a composition: the column gains a second live edge,
// and the point of the mission — the accent word — arrives at it.
// ---------------------------------------------------------------------------

const copy = {
  eyebrow: 'MISSION',
  accent: 'prevention',
  site: 'medivasc.in',
};

// The two voices the campaign already speaks in, taken from composer.mjs so the
// mission card cannot invent a third. Caps is sans and accents by colour alone —
// an italic capital is a different letterform, not an emphasis.
//
// `body` is the visual height of one line as a fraction of the size, and it is
// not the same as the line box: capitals have no descender, so measuring them
// with a descender allowance puts a phantom 26% under every line and makes an
// evenly stepped stack look bottom-heavy.
const VOICE = {
  caps: { family: 'sans', weight: 600, trackingRatio: -0.010, italicAccent: false, leading: 1.02, baseline: 0.76, body: 0.80, lead: 'VISIT' },
  serifCaps: { family: 'serif', weight: 600, trackingRatio: -0.008, italicAccent: false, leading: 1.06, baseline: 0.74, body: 0.78, lead: 'VISIT' },
  serif: { family: 'serif', weight: 600, trackingRatio: -0.024, italicAccent: true, leading: 1.05, baseline: 0.80, body: 1.08, lead: 'Visit' },
};

const VARIANTS = [
  {
    id: 'sketch',
    note: 'the drawing as drawn — caps, two lines, evenly spaced down the card',
    voice: 'caps',
    // Caps, because the sketch is caps and it means it: `medivasc.in` is written
    // lowercase inside an otherwise capitalised line, so the case is authored.
    claim: ['FOOT & LEG AMPUTATION', { text: 'PREVENTION', align: 'right' }],
    measure: 0.80,
    // Evenly spaced, because the sketch is: MISSION, the two claim lines and the
    // destination each sit one ruled line apart, all the way down the page. The
    // signed-off portrait's rhythm — message up top, one collected void, footer
    // on the base — is a different composition and does not belong to this one.
    rhythm: 'even',
  },
  {
    id: 'serif-caps',
    // The sketch's structure in the signed-off flyer's typeface. Caps are the
    // owner's call and the campaign sets caps in the sans — but the sans caps
    // are a plain grotesque, and on a card whose only other voice is Fraunces
    // they read as someone else's. Same words, same rhythm, brand letterforms.
    note: 'the sketch in the flyer’s own serif — caps, two lines, evenly spaced',
    voice: 'serifCaps',
    claim: ['FOOT & LEG AMPUTATION', { text: 'PREVENTION', align: 'right' }],
    measure: 0.86,
    rhythm: 'even',
  },
  {
    id: 'serif',
    // Three lines are height-bound on a 3:2 canvas, not width-bound, so a wide
    // measure cannot be filled at any size that also fits. The column narrows to
    // match the setting the height allows — which is also the better shape here:
    // a tall column on the left, the mark reading clear on the right.
    note: 'the site voice — Fraunces, three lines, the portrait flyer’s rhythm',
    voice: 'serif',
    claim: ['Foot & leg', 'amputation', { text: 'prevention', align: 'right' }],
    measure: 0.50,
    rightMeasure: 0.62,
    rhythm: 'collected',
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
  // The eyebrow is set large on purpose. MISSION is not a label on this card —
  // it is the first word read, and at label size it looked like one.
  type: { eyebrow: 54, claim: 210, cta: 40 },
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
async function setAuthored(authored, maxHeight, lineHeight, style, { minScale = 0.45, step = 2 } = {}) {
  const set = async (size) => {
    const scaled = { ...style, size, tracking: (style.tracking ?? 0) * (size / style.size) };
    const wrapped = await Promise.all(authored.map((a) => wrapRuns(a.runs, Number.MAX_SAFE_INTEGER, scaled)));
    const lines = wrapped.map((w, i) => ({ ...w[0], align: authored[i].align, max: authored[i].max }));
    // Each line is measured against its own column, so the fill floor still
    // means "this setting is not timid" when the flush-right line runs to a
    // wider edge than the ones above it.
    return { lines, style: scaled, fill: Math.max(...lines.map((l) => l.width / l.max)) };
  };

  const floor = Math.max(1, Math.round(style.size * minScale));
  for (let size = style.size; size >= floor; size -= step) {
    const candidate = await set(size);
    // Solved against the box, not the column. Three short lines want a far
    // larger setting than two long ones, and on a 3:2 canvas it is the height
    // that stops them — fitting on width alone puts variant b through the floor.
    const fits =
      candidate.lines.every((l) => l.width <= l.max) &&
      blockHeight(candidate.lines, size * lineHeight, candidate.style) <= maxHeight;
    if (fits) return candidate;
  }
  return set(floor);
}

/**
 * Normalise one authored line: split into runs, italicise and accent the point
 * word, and carry its alignment. A line is a string, or `{ text, align }` when
 * it does not set flush left.
 */
function authoredLine(line, columns, voice) {
  const { text, align = 'left' } = typeof line === 'string' ? { text: line } : line;
  const target = copy.accent.toLowerCase();
  const runs = text.split(/\s+/).map((word) => {
    const isAccent = word.replace(/[^a-z]/gi, '').toLowerCase() === target;
    return {
      text: word,
      family: isAccent && voice.italicAccent ? 'serifItalic' : voice.family,
      fill: isAccent ? direction.accent : undefined,
    };
  });
  return { runs, align, max: align === 'right' ? columns.right : columns.left };
}

// ---------------------------------------------------------------------------
// Layout
//
// Two rhythms, because the drawing and the signed-off flyer do not share one.
//
//   even       MISSION, each claim line and the destination one equal step
//              apart, all the way down the card. This is the sketch: the owner
//              set every element one ruled line from the next.
//   collected  the portrait flyer's rhythm — message up under the lockup, the
//              whole of the leftover gathered into one field for the mark, the
//              footer on the base line.
//
// Both are right; they are different cards. What is never right is spreading
// the slack across some gaps and not others, which opens holes.
// ---------------------------------------------------------------------------

async function compose(variant) {
  const { w, h, pad, type } = fmt;
  const u = w / 1620;
  const voice = VOICE[variant.voice];
  if (!voice) throw new Error(`mission: no voice "${variant.voice}"`);
  const contentW = w - pad.x * 2;
  // Two edges, not one. The flush-left lines run to `left`; the flush-right line
  // hangs to `right`. They are the same column unless a variant says otherwise —
  // and one has to, because in the three-line setting `prevention` is itself the
  // longest line, so aligning it to the left lines' own edge moves it by nothing.
  const columns = {
    left: contentW * (variant.measure ?? fmt.measure),
    right: contentW * (variant.rightMeasure ?? variant.measure ?? fmt.measure),
  };

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
    [{ text: voice.lead, fill: direction.muted }, { text: copy.site, fill: direction.link }],
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
  // MISSION is capitals too, so it gets the same descender-free measurement the
  // claim does when the stack is being stepped evenly.
  const eyebrowCap = type.eyebrow * 0.80;

  // The band the message lives in: under the lockup, down to the destination.
  const bandTop = pad.top + logoH + 82 * u;
  const bandBottom = ctaBox.y;
  const minVoid = 76 * u;

  const claimBase = {
    family: voice.family, size: type.claim, weight: voice.weight,
    tracking: type.claim * voice.trackingRatio, fill: direction.ink,
  };
  const claim = await setAuthored(
    variant.claim.map((line) => authoredLine(line, columns, voice)),
    bandBottom - bandTop - eyebrowH - 34 * u - minVoid,
    voice.leading,
    claimBase,
  );
  const claimLH = claim.style.size * voice.leading;
  const claimH = blockHeight(claim.lines, claimLH, claim.style);

  // A mission set at two thirds of its measure reads as a caption. The floor is
  // a check rather than a comment: a reworded claim that no longer fills the
  // column fails the build instead of shipping small.
  checks.push({
    check: 'fill',
    name: 'claim measure',
    ok: claim.fill >= 0.82,
    detail: `longest line fills ${(claim.fill * 100).toFixed(0)}% of its column, floor 82%`,
  });

  // Where each element lands. `even` steps the eyebrow, every claim line and the
  // destination by one equal gap; `collected` keeps the flyer's tight message
  // and gathers the leftover into the field below it.
  const lineH = claim.style.size * voice.body;
  let eyebrowY;
  let claimBaselines;
  if (variant.rhythm === 'even') {
    // n claim lines between the eyebrow and the destination means n+1 gaps:
    // eyebrow→first, each line→the next, last→destination. Dividing by n drops
    // the last one and jams the closing line onto the call to action.
    const n = claim.lines.length;
    const step = (bandBottom - bandTop - eyebrowCap - n * lineH) / (n + 1);
    checks.push({
      check: 'flow',
      name: 'even rhythm',
      ok: step >= 40 * u,
      detail: `${step.toFixed(0)}px between elements, floor ${Math.round(40 * u)}px`,
    });
    eyebrowY = bandTop;
    let cursor = bandTop + eyebrowCap + step;
    claimBaselines = claim.lines.map(() => {
      const baseline = cursor + claim.style.size * voice.baseline;
      cursor += lineH + step;
      return baseline;
    });
  } else {
    // A setting that is height-bound leaves nothing over. One that is
    // width-bound leaves a void, and dropping the whole of it under the message
    // opens a hole the mark cannot fill on a canvas this shallow — so a third
    // of it is lifted above, and the gap below reads as air.
    const claimTop = bandTop + eyebrowH + 34 * u;
    const drop = Math.max(0, (bandBottom - minVoid) - (claimTop + claimH)) * 0.34;
    eyebrowY = bandTop + drop;
    claimBaselines = claim.lines.map((_, i) => claimTop + drop + claim.style.size * voice.baseline + i * claimLH);
  }

  const eyebrowOpts = { x: pad.x, baseline: eyebrowY + type.eyebrow * 0.82, lineHeight: type.eyebrow * 1.4, style: eyebrowStyle };
  draw.push(renderLines(eyebrowLines, eyebrowOpts));
  track('eyebrow', blockBox(eyebrowLines, eyebrowOpts));

  // Each line is emitted on its own so it can take its own edge and its own
  // baseline: `renderLines` aligns and steps a whole block. A flush-right line
  // anchors to its column, not to the longest line above it — an edge that moves
  // with the copy is not an edge.
  let messageBottom = eyebrowY + eyebrowH;
  for (const [i, line] of claim.lines.entries()) {
    const x = line.align === 'right' ? pad.x + columns.right - line.width : pad.x;
    const opts = { x, baseline: claimBaselines[i], lineHeight: claimLH, style: claim.style };
    draw.push(renderLines([line], opts));
    const box = track(`claim line ${i + 1}`, blockBox([line], opts));
    messageBottom = Math.max(messageBottom, box.y + box.h);
  }

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
