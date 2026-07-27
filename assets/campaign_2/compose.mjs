// The composition: one instruction, completed by the sign.
//
// The page reads "Say no to" and then the graphic finishes the sentence — the
// word AMPUTATION, enclosed in a prohibition sign and struck by its bar. That
// is why the sign is the largest object here and the lead line is not: the
// graphic is carrying the claim, not illustrating it.
//
// Everything below the sign is what the flyer set already learned it needs: one
// line of support, one call to action that names the site, and the conditions.
// There is no process row. Under a sign this size a four-column diagram is
// noise, and the flyer set (`assets/campaign`) is where that register belongs.
//
// The layout rules are inherited from that engine rather than re-invented:
// type scales by canvas *width*, gaps by leftover *height*, and the composition
// is solved — registers are measured at full size, overflow shrinks the type
// scale until they fit, underflow opens the gaps to a ceiling and splits what
// is left as air above and below the stack.

import { wrapRuns, balanceRuns, renderLines, blockBox, wrap } from '../campaign/text.mjs';
import { line, footerStrip } from '../campaign/poster.mjs';
import { ctaPill } from '../campaign/composer.mjs';
import { buildField } from '../campaign/field.mjs';
import { loadMark } from '../campaign/mark.mjs';
import { prohibitionSign, barStrikes } from './sign.mjs';

// The lead's voice is a parameter, like the flyer set's claim voice: the site's
// own Fraunces with the negation italic, or safety-sign caps. Both say the same
// four words, and the sign says the fifth.
const LEAD_VOICE = {
  serif: { family: 'serif', accentFamily: 'serifItalic', size: 82, weight: 600, trackingRatio: -0.020, optical: 1.06 },
  caps: { family: 'sans', accentFamily: null, size: 44, weight: 600, trackingRatio: 0.075, optical: 1.02 },
};

const BASE_GAPS = { logo: 50, lead: 30, sign: 44, support: 52, cta: 42 };

function setup(direction, ctx) {
  const d = direction.design;
  const voice = LEAD_VOICE[d.lead];
  if (!voice) throw new Error(`campaign_2: no lead voice "${d.lead}"`);
  const set = ctx.copy.sets[d.copy];
  if (!set) throw new Error(`campaign_2: no copy set named "${d.copy}"`);
  return { d, c: direction.colour, voice, set };
}

/** The lead, with the negation picked out in the sign's own red. */
function leadRuns(ctx, c, voice, upper) {
  const accent = ctx.copy.accent.toLowerCase();
  const runs = ctx.copy.lead.split(/\s+/).map((word) => {
    const isAccent = word.replace(/[^a-z]/gi, '').toLowerCase() === accent;
    return {
      text: upper ? word.toUpperCase() : word,
      family: isAccent && voice.accentFamily ? voice.accentFamily : voice.family,
      fill: isAccent ? c.red : c.ink,
    };
  });
  if (!runs.some((r) => r.fill === c.red)) {
    throw new Error(`campaign_2: the accent word "${ctx.copy.accent}" does not occur in the lead "${ctx.copy.lead}"`);
  }
  return runs;
}

/** Type over the dense part of a background mark is unreadable, so it is barred. */
function keepOutChecks(keepOut, blocks) {
  const r = keepOut.rect;
  return blocks
    .filter((b) => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y)
    .map((b) => ({
      check: 'artwork',
      name: `"${b.name}" clears the ${keepOut.name}`,
      ok: false,
      detail: 'block overlaps the artwork’s dense zone',
    }));
}

/**
 * The bar strikes the word and nothing else.
 *
 * This is review finding 4 written as a check. The first generation stroked a
 * prohibition slash across an illustration of a foot; a bar that reaches any
 * block other than the word it encloses is striking the wrong thing, and the
 * build stops rather than shipping the inversion.
 */
function strikeChecks(sign, blocks) {
  return blocks
    .filter((b) => b.name !== 'sign')
    .map((b) => ({
      check: 'artwork',
      name: `the bar does not strike "${b.name}"`,
      ok: !barStrikes(sign.bar, b),
      detail: 'the sign’s bar may cross the word it encloses and nothing else',
    }));
}

function contrastPairs({ c, surfaces, sizes }) {
  const pairs = [];
  const onField = [
    { name: 'lead', fg: c.ink, size: sizes.lead },
    { name: 'lead accent', fg: c.red, size: sizes.lead },
    { name: 'support', fg: c.muted, size: sizes.support },
    { name: 'conditions', fg: c.footerInk ?? c.ink, size: sizes.footer },
    // The band is a large graphic element against whatever field it lands on:
    // a red sign that does not separate from its background is not a sign.
    { name: 'sign band', fg: c.red, size: sizes.band },
  ];
  for (const item of onField) {
    for (const surface of surfaces) {
      pairs.push({ name: `${item.name} on ${surface.name}`, fg: item.fg, bg: surface.color, size: item.size });
    }
  }
  pairs.push(
    { name: 'prohibited word on the sign ground', fg: c.signInk ?? c.ink, bg: c.ground, size: sizes.word },
    { name: 'sign band on the sign ground', fg: c.red, bg: c.ground, size: sizes.band },
    { name: 'cta pill label', fg: c.pillInk, bg: c.pillFill, size: sizes.pill },
  );
  return pairs;
}

// ---------------------------------------------------------------------------
// The flyer — square, portrait, story, print
// ---------------------------------------------------------------------------

export async function composeSignFlyer(direction, format, fmt, ctx) {
  const { d, c, voice, set } = setup(direction, ctx);
  const mark = d.field ? await loadMark(ctx.root) : null;
  const u = fmt.w / 1080;
  const cx = fmt.w / 2;
  const contentW = fmt.w - fmt.pad.x * 2;
  const available = fmt.h - fmt.pad.top - fmt.pad.bottom;

  const alignLeft = d.align === 'left';
  const align = alignLeft ? 'left' : 'center';
  const anchorX = alignLeft ? fmt.pad.x : cx;
  const measureW = contentW * (d.measure ?? (alignLeft ? 0.70 : 1));

  let sign = null;

  /** Measure the whole composition at type scale `k`, gaps unexpanded. */
  const measure = async (k) => {
    const ts = u * k;
    const seq = [];
    const push = (name, height, gapAfter, place) => seq.push({ name, height, gap: gapAfter * ts, place });

    const logoW = Math.round((d.logoWidth ?? 300) * ts);
    const logoH = await ctx.logoHeight(direction, logoW);
    push('logo', logoH, BASE_GAPS.logo, async (y) => ({
      box: { x: Math.round(alignLeft ? fmt.pad.x : cx - logoW / 2), y: Math.round(y), w: logoW, h: logoH },
      logo: true,
    }));

    const leadSize = Math.round(voice.size * ts);
    const leadStyle = {
      family: voice.family, size: leadSize, weight: voice.weight,
      tracking: voice.trackingRatio * leadSize, fill: c.ink,
    };
    const leadLines = await wrapRuns(leadRuns(ctx, c, voice, d.lead === 'caps'), Infinity, leadStyle);
    push('lead', leadSize * voice.optical, BASE_GAPS.lead, async (y) => {
      const opts = { x: anchorX, baseline: y + leadSize * (voice.family === 'serif' ? 0.80 : 0.76), lineHeight: leadSize * 1.1, style: leadStyle, align };
      return { draw: renderLines(leadLines, opts), box: blockBox(leadLines, opts) };
    });

    // The sign takes the height the rest of the composition leaves, up to the
    // measure. Scaling it with the type instead makes a square canvas shrink
    // everything — the flyer ends up with small type *and* a small sign, and a
    // third of the width unused. Its diameter is patched in below, once the
    // registers around it have been measured.
    const signEntry = { name: 'sign', height: 0, gap: BASE_GAPS.sign * ts, place: null };
    let diameter = 0;
    signEntry.place = async (y) => {
      sign = await prohibitionSign(ctx.copy.prohibited.toUpperCase(), {
        cx: alignLeft ? fmt.pad.x + diameter / 2 : cx,
        cy: y + diameter / 2,
        d: diameter,
        red: c.red,
        ground: c.ground,
        ink: c.signInk ?? c.ink,
        legibleFloor: fmt.w * 0.030,
        id: `sign-${direction.id}`,
      });
      return { draw: sign.draw, box: sign.box, checks: sign.checks };
    };
    seq.push(signEntry);

    const supportSize = Math.round(27 * ts);
    const supportStyle = { family: 'sans', size: supportSize, weight: 400, tracking: 0, fill: c.muted };
    const supportW = contentW * (d.supportMeasure ?? (alignLeft ? d.measure ?? 0.70 : 0.82));
    const { lines: supportLines } = await balanceRuns([{ text: set.support }], supportW, supportStyle, { minScale: 1 });
    const supportLead = supportSize * 1.44;
    push('support', (supportLines.length - 1) * supportLead + supportSize * 1.04, BASE_GAPS.support, async (y) => {
      const opts = { x: anchorX, baseline: y + supportSize * 0.8, lineHeight: supportLead, style: supportStyle, align };
      return { draw: renderLines(supportLines, opts), box: blockBox(supportLines, opts) };
    });

    const pillArgs = (y) => ({ x: fmt.pad.x, cx, y, align, ts, fill: c.pillFill, ink: c.pillInk, measure: contentW });
    const pillProbe = await ctaPill(ctx.copy.pill, pillArgs(0));
    push('cta', pillProbe.height, BASE_GAPS.cta, async (y) => {
      const placed = await ctaPill(ctx.copy.pill, pillArgs(y));
      return { draw: placed.draw, box: placed.box, checks: placed.checks };
    });

    const footerArgs = (baseline) => ({
      cx, baseline, width: contentW, colour: c, ts,
      inkColour: c.footerInk ?? c.ink, dotColour: c.red, ruleColour: c.line,
    });
    const footerProbe = await footerStrip(ctx.conditions, footerArgs(0));
    push('footer', footerProbe.height, 0, async (y) => {
      const placed = await footerStrip(ctx.conditions, footerArgs(y + footerProbe.height * 0.72));
      return { draw: placed.draw, box: placed.box, checks: placed.checks };
    });

    const gapsH = seq.reduce((a, s) => a + s.gap, 0);
    const withoutSign = seq.reduce((a, s) => a + s.height, 0) + gapsH;
    diameter = Math.max(0, Math.min(measureW, available - withoutSign - 2));
    signEntry.height = diameter;

    return {
      k, ts, seq, gapsH, diameter, total: withoutSign + diameter,
      // The sign has a floor as well as a ceiling: below it the graphic has
      // stopped being the page and the type around it is what needs to give.
      room: diameter / measureW,
      sizes: { lead: leadSize, support: supportSize, pill: pillProbe.size, footer: footerProbe.size, band: diameter * 0.1 },
    };
  };

  let m = await measure(1);
  for (let pass = 0; pass < 4 && m.room < (d.signFloor ?? 0.40); pass++) {
    const next = Math.max(0.55, m.k * 0.88);
    if (next >= m.k) break;
    m = await measure(next);
  }

  const slack = Math.max(0, available - m.total - 2);
  const expand = slack > 0 ? Math.min(2.4, 1 + slack / m.gapsH) : 1;
  const air = Math.max(0, slack - (expand - 1) * m.gapsH);

  const draw = [];
  const blocks = [];
  const checks = [];
  let logoBox = null;
  let y = fmt.pad.top + air * 0.5;

  for (const register of m.seq) {
    const placed = await register.place(y);
    if (placed.draw) draw.push(placed.draw);
    if (placed.checks) checks.push(...placed.checks);
    blocks.push({ name: register.name, ...placed.box });
    if (placed.logo) logoBox = placed.box;
    y += register.height + register.gap * expand;
  }
  const bottom = y - m.seq[m.seq.length - 1].gap * expand;

  checks.push(...strikeChecks(sign, blocks));
  checks.push({
    name: 'the sign still holds the page',
    ok: m.room >= (d.signFloor ?? 0.40),
    detail: `sign is ${(m.room * 100).toFixed(0)}% of the measure, floor ${((d.signFloor ?? 0.40) * 100).toFixed(0)}%`,
  });

  const field = d.field
    ? buildField(d.field, { fmt, colour: c, mark, focus: { cx, cy: fmt.h / 2, radius: fmt.w * 0.4 } })
    : null;
  if (field?.keepOut) checks.push(...keepOutChecks(field.keepOut, blocks));

  if (!alignLeft) {
    for (const block of blocks) {
      if (block.name === 'footer') continue;
      const offset = Math.abs(block.x + block.w / 2 - cx);
      checks.push({ name: `${block.name} is centred`, ok: offset <= 1, detail: `${offset.toFixed(2)}px off the canvas centre` });
    }
  }

  return {
    blocks,
    logo: logoBox,
    gap: fmt.h - fmt.pad.bottom - bottom,
    defs: (field?.defs ?? '') + sign.defs,
    background: field?.draw,
    svgBody: draw.join(''),
    u,
    checks,
    contrast: contrastPairs({
      c,
      surfaces: field?.surfaces ?? [{ name: 'surface', color: c.paper }],
      sizes: { ...m.sizes, word: sign.wordSize },
    }),
  };
}

// ---------------------------------------------------------------------------
// The X header
// ---------------------------------------------------------------------------

/**
 * Landscape: identity and instruction on the left, the sign on the right.
 *
 * The left column is measured against the profile avatar rather than the canvas
 * — X draws the avatar over the bottom-left corner, and content placed there is
 * permanently hidden for every visitor. The conditions run along the bottom
 * right for the same reason.
 */
export async function composeSignHeader(direction, format, fmt, ctx) {
  const { d, c, voice } = setup(direction, ctx);
  const mark = d.field ? await loadMark(ctx.root) : null;
  const u = fmt.w / 1500;

  const blocks = [];
  const draw = [];
  const checks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  // The sign first: it takes the height it can have, and what is left of the
  // width is the left column's.
  const diameter = Math.min(fmt.h - fmt.pad.top - fmt.pad.bottom, fmt.w * 0.30);
  const signCx = fmt.w - fmt.pad.x - diameter / 2;
  // Centred in the safe band, not on the canvas: the top and bottom margins of
  // a header are not equal, and a sign that fills the band and is centred on
  // the canvas hangs 3px over the top margin.
  const sign = await prohibitionSign(ctx.copy.prohibited.toUpperCase(), {
    cx: signCx,
    cy: fmt.pad.top + (fmt.h - fmt.pad.top - fmt.pad.bottom) / 2,
    d: diameter,
    red: c.red,
    ground: c.ground,
    ink: c.signInk ?? c.ink,
    legibleFloor: fmt.w * 0.014,
    id: `sign-${direction.id}`,
  });
  draw.push(sign.draw);
  track('sign', sign.box);
  checks.push(...sign.checks);

  const signLeft = signCx - diameter / 2;
  const columnW = signLeft - 60 * u - fmt.pad.x;
  const avatar = (fmt.obstructions ?? []).find((o) => o.rect.x < fmt.pad.x + 40 * u);
  const floor = avatar ? avatar.rect.y - 18 * u : fmt.h - fmt.pad.bottom;

  // The left column is solved the same way the flyer is: measured at full size,
  // then shrunk until it clears the avatar.
  const column = async (k) => {
    const ts = u * k;
    const logoW = Math.round(172 * ts);
    const logoH = await ctx.logoHeight(direction, logoW);
    // The header's column has one job and 260px of height to do it in, so the
    // lead takes as much of that as the registers around it can spare.
    const leadSize = Math.round(voice.size * 1.05 * ts);
    const leadStyle = {
      family: voice.family, size: leadSize, weight: voice.weight,
      tracking: voice.trackingRatio * leadSize, fill: c.ink,
    };
    const leadLines = await wrapRuns(leadRuns(ctx, c, voice, d.lead === 'caps'), columnW, leadStyle);
    const pill = await ctaPill(ctx.copy.pill, {
      x: fmt.pad.x, cx: 0, y: 0, align: 'left', ts: ts * 0.86, fill: c.pillFill, ink: c.pillInk, measure: columnW,
    });
    const gaps = [22 * ts, 22 * ts];
    const leadH = (leadLines.length - 1) * leadSize * 1.1 + leadSize * voice.optical;
    return { k, ts, logoW, logoH, leadSize, leadStyle, leadLines, leadH, pill, gaps, total: logoH + gaps[0] + leadH + gaps[1] + pill.height };
  };

  let col = await column(1);
  for (let pass = 0; pass < 4 && fmt.pad.top + col.total > floor; pass++) {
    const next = Math.max(0.55, col.k * ((floor - fmt.pad.top - 2) / col.total));
    if (next >= col.k) break;
    col = await column(next);
  }

  let y = fmt.pad.top + Math.max(0, (floor - fmt.pad.top - col.total) / 2);
  const logoBox = track('logo', { x: fmt.pad.x, y: Math.round(y), w: col.logoW, h: col.logoH });
  y += col.logoH + col.gaps[0];

  const leadOpts = {
    x: fmt.pad.x,
    baseline: y + col.leadSize * (voice.family === 'serif' ? 0.80 : 0.76),
    lineHeight: col.leadSize * 1.1,
    style: col.leadStyle,
  };
  draw.push(renderLines(col.leadLines, leadOpts));
  track('lead', blockBox(col.leadLines, leadOpts));
  y += col.leadH + col.gaps[1];

  const placedPill = await ctaPill(ctx.copy.pill, {
    x: fmt.pad.x, cx: 0, y, align: 'left', ts: col.ts * 0.86, fill: c.pillFill, ink: c.pillInk, measure: columnW,
  });
  draw.push(placedPill.draw);
  const pillBox = track('cta', placedPill.box);
  checks.push(...placedPill.checks);

  // The conditions sit in the one band of an X header that is always visible
  // and otherwise dead: bottom right, clear of the avatar and of the sign.
  const condStyle = { family: 'sans', size: Math.round(17 * u), weight: 600, tracking: 17 * u * 0.15, fill: c.footerInk ?? c.muted };
  const condOpts = {
    x: signLeft - 40 * u,
    baseline: fmt.h - fmt.pad.bottom - condStyle.size * 0.22,
    lineHeight: condStyle.size * 1.5,
    style: condStyle,
    align: 'right',
  };
  const condLines = await wrap(ctx.conditions.join('   ·   '), columnW, condStyle);
  draw.push(renderLines(condLines, condOpts));
  const condBox = track('conditions', blockBox(condLines, condOpts));

  checks.push(...strikeChecks(sign, blocks));

  const field = d.field
    ? buildField(d.field, { fmt, colour: c, mark, focus: { cx: fmt.w * 0.3, cy: fmt.h / 2, radius: fmt.h * 0.62 } })
    : null;
  if (field?.keepOut) checks.push(...keepOutChecks(field.keepOut, blocks));

  checks.push(
    {
      name: 'left column clears the profile avatar',
      ok: pillBox.y + pillBox.h <= floor + 1,
      detail: `column ends at ${(pillBox.y + pillBox.h).toFixed(0)}px, avatar starts at ${floor.toFixed(0)}px`,
    },
    {
      name: 'conditions strip clears the profile avatar',
      ok: !avatar || condBox.x > avatar.rect.x + avatar.rect.w,
      detail: `strip starts at ${condBox.x.toFixed(0)}px, avatar ends at ${avatar ? (avatar.rect.x + avatar.rect.w).toFixed(0) : 'n/a'}px`,
    },
    {
      name: 'the left column clears the sign',
      ok: Math.max(...blocks.filter((b) => b.name !== 'sign').map((b) => b.x + b.w)) <= signLeft - 1,
      detail: `column ends at ${Math.max(...blocks.filter((b) => b.name !== 'sign').map((b) => b.x + b.w)).toFixed(0)}px, sign starts at ${signLeft.toFixed(0)}px`,
    },
  );

  return {
    blocks,
    logo: logoBox,
    gap: Infinity,
    defs: (field?.defs ?? '') + sign.defs,
    background: field?.draw,
    svgBody: draw.join(''),
    u,
    checks,
    contrast: contrastPairs({
      c,
      surfaces: field?.surfaces ?? [{ name: 'surface', color: c.paper }],
      sizes: {
        lead: col.leadSize, support: condStyle.size, pill: placedPill.size,
        footer: condStyle.size, band: diameter * 0.1, word: sign.wordSize,
      },
    }),
  };
}
