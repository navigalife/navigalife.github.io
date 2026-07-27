// MediVasc campaign 2 — "Say no to amputation".
//
//   node assets/campaign_2/build.mjs             # render everything
//   node assets/campaign_2/build.mjs --only 02   # render one treatment
//
// One instruction, in the owner's own words, finished by a prohibition sign
// built to ISO 3864-1 (`sign.mjs`). The owner's phrase is not retyped into each
// treatment: it is one constant, asserted below to be exactly what the page
// says once the lead and the enclosed word are put back together.
//
// The measured-text engine, the layout verifier, the background fields and the
// call-to-action pill are `assets/campaign`'s — imported, not copied. A second
// copy of a verified layout engine is a second engine to keep correct.
//
// The build is a gate, not a renderer: it exits non-zero and writes nothing if
// any asset fails its checks.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadFonts, escapeXml } from '../campaign/text.mjs';
import { verifyLayout, reportVerification } from '../campaign/verify.mjs';
import { composeSignFlyer, composeSignHeader } from './compose.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = here;

const readJson = async (p) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));

// ---------------------------------------------------------------------------
// Brand inputs
// ---------------------------------------------------------------------------

const [siteConfig, themes] = await Promise.all([
  readJson('data/site-config.json'),
  readJson('data/themes.json'),
]);

const theme = themes.find((t) => t.id === siteConfig.theme);
if (!theme) {
  throw new Error(`campaign_2: site-config.json selects theme "${siteConfig.theme}", which is not in themes.json`);
}
const light = theme.light;
const dark = theme.dark;

// ---------------------------------------------------------------------------
// Copy
//
// The owner asked for this campaign to say one thing. It is written here once,
// in full, and the page is assembled out of its two halves — the lead line and
// the word inside the sign — so the two cannot drift apart or be quietly
// improved into "Prevent amputation" by a later edit.
// ---------------------------------------------------------------------------

const OWNER_PHRASE = 'Say no to amputation';

const copy = {
  lead: 'Say no to',
  // Lower case here is the source of truth; the sign sets it in caps, which is
  // the safety-sign voice and not a second copy of the word.
  prohibited: 'amputation',
  // Picked out in the sign's red, so the negation reads before the sentence
  // does. Italic where the lead is set in the site's serif.
  accent: 'no',
  conditions: ['LYMPHEDEMA', 'DIABETIC FOOT', 'VENOUS ULCERS', 'DVT'],
  pill: { label: 'Visit', site: 'medivasc.in' },

  // What the flyer says under the sign. Two lengths, because a left-aligned
  // treatment gives a third of its width to the background field.
  //
  // Deliberately absent: any claim that amputation is always avoidable, and any
  // claim about survival. What is asserted is that the decision is worth a
  // second opinion, which is the site's own position and is the only thing
  // "say no" can honestly mean on a flyer.
  sets: {
    standard: {
      support: 'Referred for amputation? Get a second opinion first. Vascular and lymphatic protocols, studied case by case, guided at home, and followed up until the result holds.',
    },
    brief: {
      support: 'Referred for amputation? Get a second opinion first — studied case by case and guided at home.',
    },
  },
};

if (`${copy.lead} ${copy.prohibited}` !== OWNER_PHRASE) {
  throw new Error(
    `campaign_2: the page reads "${copy.lead} ${copy.prohibited}", the owner asked for "${OWNER_PHRASE}". ` +
      'The campaign says the owner\'s phrase exactly, or it does not build.',
  );
}
if (!copy.lead.split(/\s+/).some((w) => w.toLowerCase() === copy.accent.toLowerCase())) {
  throw new Error(`campaign_2: the accent word "${copy.accent}" is not in the lead "${copy.lead}"`);
}

// ---------------------------------------------------------------------------
// Surface treatments
//
// `red` is the sign's own colour and is not a brand token. A prohibition sign
// is red; a purple one is a ring with a stripe in it. It is checked against
// every surface it can land on, which is why the two dark treatments carry a
// lighter red — safety red on near-black misses the 3:1 floor for a large
// graphic. `ground` is the sign's inner circle, near-white on every surface for
// the same reason: the standard's sign has a light ground and the word has to
// sit on something that is not the field.
// ---------------------------------------------------------------------------

const directions = [
  {
    id: '01-paper',
    label: 'PAPER',
    logo: 'logo_newfont/logo_tm/MediVasc-logo-tm-lg.png',
    base: light['--bg'],
    design: { align: 'center', lead: 'serif', copy: 'standard', logoWidth: 300 },
    colour: {
      paper: light['--bg'],
      ink: light['--ink'],
      muted: light['--ink-muted'],
      line: light['--line'],
      red: '#C8102E',
      ground: light['--surface'],
      signInk: light['--ink'],
      pillFill: light['--primary'],
      pillInk: light['--primary-ink'],
      footerInk: light['--ink-muted'],
      purple: '#582078',
    },
  },
  {
    id: '02-ink',
    label: 'INK',
    logo: 'logo_newfont/logo_tm/MediVasc-logo-white-tm-lg.png',
    base: dark['--bg'],
    design: { align: 'center', lead: 'serif', copy: 'standard', logoWidth: 300 },
    colour: {
      paper: dark['--bg'],
      ink: dark['--ink'],
      muted: dark['--ink-muted'],
      line: dark['--line'],
      red: '#F0554F',
      ground: '#F7F5F0',
      signInk: '#141B1D',
      pillFill: dark['--primary'],
      pillInk: dark['--primary-ink'],
      footerInk: dark['--ink-muted'],
      purple: '#582078',
    },
  },
  {
    id: '03-royal',
    label: 'ROYAL',
    logo: 'logo_newfont/logo_tm/MediVasc-logo-white-tm-lg.png',
    base: '#170823',
    design: { align: 'center', lead: 'caps', copy: 'standard', field: 'royal', logoWidth: 290 },
    // The field is darker than the flyer set's royal, and deliberately: the
    // brightest point of that one (#56227A lifted by its own glow) leaves the
    // sign's red at 2.4:1 against it, and a prohibition sign that does not
    // separate from its background has stopped being a sign.
    colour: {
      paper: '#170823',
      ink: '#FFFFFF',
      muted: '#DCCBEC',
      line: '#7A5A96',
      red: '#F0554F',
      ground: '#FBF8FD',
      signInk: '#14101B',
      pillFill: '#FFFFFF',
      pillInk: '#4A1A6B',
      footerInk: '#EADDF6',
      purple: '#582078',
      fieldTop: '#3E1259',
      fieldMid: '#2A1040',
      fieldEdge: '#150720',
      glow: '#6E2FA0',
    },
  },
  {
    id: '04-signal',
    label: 'SIGNAL',
    logo: 'logo_newfont/logo_tm/MediVasc-logo-tm-lg.png',
    base: '#FBFAFD',
    // Left-aligned, so the field gets the right of the canvas — which is where
    // the header puts the sign. The flyer set's lattice mark lives exactly
    // there and its keep-out zone catches the collision on the header, so this
    // treatment takes the aurora instead: a drift of ribbons at the foot, which
    // has no dense zone to keep type out of.
    design: {
      align: 'left', lead: 'caps', copy: 'brief', field: 'aurora',
      logoWidth: 260, measure: 0.88, supportMeasure: 0.72,
    },
    colour: {
      paper: '#FBFAFD',
      ink: '#0C0C0C',
      muted: '#4C4557',
      line: '#E3D8EE',
      red: '#C8102E',
      ground: '#FFFFFF',
      signInk: '#0C0C0C',
      pillFill: '#582078',
      pillInk: '#FFFFFF',
      footerInk: '#4C4557',
      purple: '#582078',
      ribbonCool: '#7A3BB0',
      ribbonWarm: '#C69BE8',
    },
  },
];

// ---------------------------------------------------------------------------
// Formats — the flyer set's, unchanged: the same five places these go.
// ---------------------------------------------------------------------------

const FORMATS = {
  'x-header': {
    w: 1500, h: 500, dpi: 72, layout: 'landscape',
    pad: { x: 68, top: 52, bottom: 46 },
    obstructions: [{ name: 'X profile avatar', rect: { x: 0, y: 330, w: 310, h: 170 } }],
    note: 'X / Twitter profile header',
  },
  portrait: {
    w: 1080, h: 1350, dpi: 72, layout: 'stack',
    pad: { x: 78, top: 74, bottom: 74 },
    note: 'WhatsApp / Instagram feed',
  },
  square: {
    w: 1080, h: 1080, dpi: 72, layout: 'stack',
    pad: { x: 74, top: 66, bottom: 66 },
    note: 'Instagram / Facebook feed',
  },
  story: {
    w: 1080, h: 1920, dpi: 72, layout: 'stack',
    pad: { x: 86, top: 240, bottom: 260 },
    note: 'WhatsApp Status / Instagram Story (UI-safe top and bottom insets)',
  },
  'a5-print': {
    w: 1783, h: 2516, dpi: 300, layout: 'stack', bleed: 35,
    pad: { x: 196, top: 196, bottom: 196 },
    note: 'A5 handout, 300 dpi, 3 mm bleed',
  },
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const fontCss = await loadFonts(root);

async function logoBuffer(direction, width) {
  return sharp(path.join(root, 'assets/brand', direction.logo))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize({ width: Math.round(width) })
    .png()
    .toBuffer();
}

function canvasSvg(fmt, body, defs = '') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt.w}" height="${fmt.h}" viewBox="0 0 ${fmt.w} ${fmt.h}">` +
      `<defs><style>${fontCss}</style>${defs}</defs>${body}</svg>`,
  );
}

async function render(direction, format) {
  const fmt = FORMATS[format];
  const compose = fmt.layout === 'landscape' ? composeSignHeader : composeSignFlyer;
  const plan = await compose(direction, format, fmt, {
    copy,
    conditions: copy.conditions,
    root,
    logoHeight: async (dir, width) => (await sharp(await logoBuffer(dir, width)).metadata()).height,
  });

  const verification = verifyLayout({ plan, fmt, direction, format });
  if (!verification.ok) return { verification, target: null };

  const background = canvasSvg(
    fmt,
    plan.background ?? `<rect width="${fmt.w}" height="${fmt.h}" fill="${direction.base}"/>`,
    plan.defs ?? '',
  );
  const logo = await logoBuffer(direction, plan.logo.w);
  const target = path.join(outDir, `${direction.id}-${format}.png`);

  await sharp(background)
    .composite([
      { input: canvasSvg(fmt, plan.svgBody, plan.defs ?? ''), left: 0, top: 0 },
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
      `<text x="${padSheet}" y="76" font-family="'Instrument Sans', sans-serif" font-size="38" font-weight="600" fill="#182A2E">MediVasc · “${escapeXml(OWNER_PHRASE)}” · ${cells.length} treatments × ${cells[0].row.length} formats</text>` +
      `<text x="${padSheet}" y="116" font-family="'Instrument Sans', sans-serif" font-size="21" fill="#55666B">The graphic is an ISO 3864-1 general prohibition sign, struck across the word and nothing else. Palette read from the live site theme (${escapeXml(theme.label)}); every asset gated by verify.mjs.</text>` +
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
  console.error('\ncampaign_2: layout verification failed — no contact sheet written.');
  process.exit(1);
}

const sheet = await contactSheet(rendered);
console.log(`\nWrote ${rendered.size} assets + ${path.relative(root, sheet)}`);
