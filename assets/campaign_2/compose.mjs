// The composition: what the clinic does, then what it asks you to do.
//
// Three registers carry the message, in this order:
//
//   1. the eyebrow — `Prevention of foot & leg amputation`, the clinic's own
//      line, asserted in `build.mjs` against `data/company.json`'s tagline
//   2. the sign — the prohibition mark, small, sitting between the two
//   3. the claim — `Say no to amputation.`, the owner's phrase, set large
//
// The sign is a mark and not the page. An earlier version made it the hero,
// nearly a full measure across with the word AMPUTATION set inside it and
// struck; it read as a warning label rather than as a clinic's flyer. Held to
// about a fifth of the measure it does what a "say no to" graphic is for —
// it says *no* before the sentence does — and the words carry the message.
//
// The layout rules are `assets/campaign`'s, inherited rather than re-invented:
// type scales by canvas *width*, gaps by leftover *height*, the composition is
// solved rather than tuned, and leftover air is split evenly top and bottom.

import { wrapRuns, balanceRuns, renderLines, blockBox, wrap } from '../campaign/text.mjs';
import { claimBlock, line, footerStrip } from '../campaign/poster.mjs';
import { ctaPill, CLAIM_VOICE } from '../campaign/composer.mjs';
import { buildField } from '../campaign/field.mjs';
import { loadMark } from '../campaign/mark.mjs';
import { prohibitionSign, barStrikes } from './sign.mjs';

const BASE_GAPS = { logo: 46, eyebrow: 32, sign: 38, claim: 40, support: 50, cta: 42 };

function setup(direction, ctx) {
  const d = direction.design;
  const voice = CLAIM_VOICE[d.voice];
  if (!voice) throw new Error(`campaign_2: no claim voice "${d.voice}"`);
  const set = ctx.copy.sets[d.copy];
  if (!set) throw new Error(`campaign_2: no copy set named "${d.copy}"`);
  return { d, c: direction.colour, voice, set };
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
 * The bar strikes nothing.
 *
 * This is review finding 4 written as a check. The first generation stroked a
 * prohibition slash across an illustration of a foot — a bar through a limb
 * reads as a blade through it, and a prohibition sign over a leg says legs are
 * prohibited. This sign's ground is empty and must stay that way, so anything
 * the bar reaches is a defect and stops the build.
 */
function strikeChecks(sign, blocks) {
  return blocks
    .filter((b) => b.name !== 'sign')
    .map((b) => ({
      check: 'artwork',
      name: `the bar does not strike "${b.name}"`,
      ok: !barStrikes(sign.bar, b),
      detail: 'the sign’s ground is empty; the bar may cross nothing',
    }));
}

function contrastPairs({ c, surfaces, sizes }) {
  const pairs = [];
  const onField = [
    { name: 'eyebrow', fg: c.eyebrow ?? c.muted, size: sizes.eyebrow },
    { name: 'claim', fg: c.ink, size: sizes.claim },
    { name: 'claim accent', fg: c.accent ?? c.red, size: sizes.claim },
    { name: 'support', fg: c.muted, size: sizes.support },
    { name: 'conditions', fg: c.footerInk ?? c.ink, size: sizes.footer },
  ];
  for (const item of onField) {
    for (const surface of surfaces) {
      pairs.push({ name: `${item.name} on ${surface.name}`, fg: item.fg, bg: surface.color, size: item.size });
    }
  }
  // The band is a graphic and not text: 3:1 at any size. A sign that does not
  // separate from what is behind it — the field, or its own ground — is not a
  // sign, and both surfaces are checked.
  for (const surface of [...surfaces, { name: 'the sign ground', color: c.ground }]) {
    pairs.push({ name: `sign band on ${surface.name}`, fg: c.red, bg: surface.color, size: sizes.band, floor: 3 });
  }
  pairs.push({ name: 'cta pill label', fg: c.pillInk, bg: c.pillFill, size: sizes.pill });
  return pairs;
}

/**
 * The claim, at the size that fills its measure, in the treatment's voice.
 *
 * A caps treatment upper-cases the authored phrases here rather than carrying a
 * second copy of them in caps — `build.mjs` asserts the owner's phrase against
 * the source strings, and an upper-cased duplicate would be outside that check.
 */
const claimFor = (ctx, c, voice, measure, cap, lineCount, upper = false) =>
  claimBlock(upper ? ctx.copy.claim.map((p) => p.toUpperCase()) : ctx.copy.claim,
    upper ? ctx.copy.accents.map((a) => a.toUpperCase()) : ctx.copy.accents, measure, {
    cap,
    ink: c.ink,
    accentFill: c.accent ?? c.red,
    lineCount,
    lineHeight: voice.lineHeight,
    family: voice.family,
    weight: voice.weight,
    trackingRatio: voice.trackingRatio,
    accentFamily: voice.accentFamily,
    optical: voice.optical,
    boxed: voice.boxed,
  });

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
  const measureW = contentW * (d.measure ?? (alignLeft ? 0.80 : 1));

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

    // The clinic's own line, said plainly and said first.
    const eyebrowSize = Math.round(23 * ts);
    const eyebrowStyle = { family: 'sans', size: eyebrowSize, weight: 600, tracking: eyebrowSize * 0.16, fill: c.eyebrow ?? c.muted };
    const eyebrowLines = await wrapRuns([{ text: ctx.copy.eyebrow }], measureW, eyebrowStyle);
    const eyebrowLead = eyebrowSize * 1.5;
    push('eyebrow', (eyebrowLines.length - 1) * eyebrowLead + eyebrowSize * 1.04, BASE_GAPS.eyebrow, async (y) => {
      const opts = { x: anchorX, baseline: y + eyebrowSize * 0.82, lineHeight: eyebrowLead, style: eyebrowStyle, align };
      return { draw: renderLines(eyebrowLines, opts), box: blockBox(eyebrowLines, opts) };
    });

    // A mark, not the page: a fixed fraction of the measure, so it keeps the
    // same optical weight on a square as on an A5 sheet.
    const diameter = (d.signWidth ?? 0.20) * measureW;
    push('sign', diameter, BASE_GAPS.sign, async (y) => {
      sign = prohibitionSign({
        cx: alignLeft ? fmt.pad.x + diameter / 2 : cx,
        cy: y + diameter / 2,
        d: diameter,
        red: c.red,
        ground: c.ground,
        floor: fmt.w * 0.11,
        id: `sign-${direction.id}`,
      });
      return { draw: sign.draw, box: sign.box, checks: sign.checks };
    });

    // The claim gets its own measure, narrower than the page's. Two short lines
    // set across a full measure either fill it at a size the page cannot carry
    // or sit in it at 59% and read as a headline that lost its nerve.
    const claimW = contentW * (d.claimMeasure ?? (alignLeft ? d.measure ?? 0.80 : 0.74));
    const claim = await claimFor(ctx, c, voice, claimW, (d.claimCap ?? 150) * ts, d.claimLines ?? 2, d.voice === 'caps');
    push('claim', claim.height, BASE_GAPS.claim, async (y) => {
      const opts = {
        x: anchorX,
        baseline: y + claim.size * (voice.family === 'serif' ? 0.86 : 0.76),
        lineHeight: claim.size * voice.lineHeight,
        style: claim.style,
        align,
      };
      return { draw: renderLines(claim.lines, opts), box: blockBox(claim.lines, opts) };
    });

    const supportSize = Math.round(27 * ts);
    const supportStyle = { family: 'sans', size: supportSize, weight: 400, tracking: 0, fill: c.muted };
    const supportW = contentW * (d.supportMeasure ?? (alignLeft ? d.measure ?? 0.80 : 0.82));
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

    const blocksH = seq.reduce((a, s) => a + s.height, 0);
    const gapsH = seq.reduce((a, s) => a + s.gap, 0);
    return {
      k, ts, seq, gapsH, total: blocksH + gapsH, claimFill: claim.fill,
      sizes: {
        eyebrow: eyebrowSize, claim: claim.size, support: supportSize,
        pill: pillProbe.size, footer: footerProbe.size, band: diameter * 0.1,
      },
    };
  };

  let m = await measure(1);
  for (let pass = 0; pass < 4 && m.total > available; pass++) {
    const next = Math.max(0.58, m.k * ((available - 2) / m.total));
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
    name: 'claim fills its measure',
    ok: m.claimFill >= (d.fillFloor ?? 0.70),
    detail: `longest line covers ${(m.claimFill * 100).toFixed(0)}% of the measure, floor ${((d.fillFloor ?? 0.70) * 100).toFixed(0)}%`,
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
      sizes: m.sizes,
    }),
  };
}

// ---------------------------------------------------------------------------
// The X header
// ---------------------------------------------------------------------------

/**
 * Landscape: the message on the left, the sign and the call to action on the
 * right, the conditions along the bottom of the text column.
 *
 * The first version of this header put a full-height sign hard against the
 * right margin and a short column against the left, which left a third of the
 * banner as a hole in the middle. What closes it is giving the claim the room:
 * the left column measures out to the right-hand group, and the claim's size is
 * solved to fill it on one line.
 *
 * The column is measured against the profile avatar rather than the canvas — X
 * draws the avatar over the bottom-left corner, and content placed there is
 * permanently hidden for every visitor.
 */
export async function composeSignHeader(direction, format, fmt, ctx) {
  const { d, c, voice } = setup(direction, ctx);
  const mark = d.field ? await loadMark(ctx.root) : null;
  const u = fmt.w / 1500;

  const blocks = [];
  const draw = [];
  const checks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  // The right-hand group first — sign over pill, centred on each other — because
  // its width is what the claim's measure is left with.
  const diameter = (d.headerSign ?? 0.115) * fmt.w;
  const pillProbe = await ctaPill(ctx.copy.pill, {
    x: 0, cx: 0, y: 0, align: 'left', ts: u * 0.84, fill: c.pillFill, ink: c.pillInk, measure: fmt.w * 0.34,
  });
  const groupW = Math.max(diameter, pillProbe.box.w);
  const groupCx = fmt.w - fmt.pad.x - groupW / 2;
  const groupGap = 34 * u;
  const groupH = diameter + groupGap + pillProbe.height;
  const groupTop = fmt.pad.top + Math.max(0, (fmt.h - fmt.pad.top - fmt.pad.bottom - groupH) / 2);

  const sign = prohibitionSign({
    cx: groupCx,
    cy: groupTop + diameter / 2,
    d: diameter,
    red: c.red,
    ground: c.ground,
    floor: fmt.w * 0.07,
    id: `sign-${direction.id}`,
  });
  draw.push(sign.draw);
  track('sign', sign.box);
  checks.push(...sign.checks);

  const placedPill = await ctaPill(ctx.copy.pill, {
    x: 0, cx: groupCx, y: groupTop + diameter + groupGap, align: 'center',
    ts: u * 0.84, fill: c.pillFill, ink: c.pillInk, measure: fmt.w * 0.34,
  });
  draw.push(placedPill.draw);
  const pillBox = track('cta', placedPill.box);
  checks.push(...placedPill.checks);

  const columnRight = groupCx - groupW / 2 - 56 * u;
  const measureW = columnRight - fmt.pad.x;
  const avatar = (fmt.obstructions ?? []).find((o) => o.rect.x < fmt.pad.x + 40 * u);
  const floor = avatar ? avatar.rect.y - 18 * u : fmt.h - fmt.pad.bottom;

  // The column is solved the same way the flyer is: measured at full size, then
  // shrunk until it clears the avatar.
  const column = async (k) => {
    const ts = u * k;
    const logoW = Math.round(178 * ts);
    const logoH = await ctx.logoHeight(direction, logoW);
    const eyebrowSize = Math.round(21 * ts);
    const eyebrowStyle = { family: 'sans', size: eyebrowSize, weight: 600, tracking: eyebrowSize * 0.16, fill: c.eyebrow ?? c.muted };
    const claim = await claimFor(ctx, c, voice, measureW, (d.headerClaimCap ?? 104) * ts, d.headerClaimLines ?? 1, d.voice === 'caps');
    const gaps = [20 * ts, 22 * ts];
    return {
      k, ts, logoW, logoH, eyebrowSize, eyebrowStyle, claim, gaps,
      total: logoH + gaps[0] + eyebrowSize * 1.04 + gaps[1] + claim.boxHeight,
    };
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

  const eyebrow = await line(ctx.copy.eyebrow, col.eyebrowStyle, { x: fmt.pad.x, baseline: y + col.eyebrowSize * 0.82, align: 'left' });
  draw.push(eyebrow.draw);
  track('eyebrow', eyebrow.box);
  y += col.eyebrowSize * 1.04 + col.gaps[1];

  const claimOpts = {
    x: fmt.pad.x,
    baseline: y + col.claim.size * (voice.family === 'serif' ? 0.86 : 0.76),
    lineHeight: col.claim.size * voice.lineHeight,
    style: col.claim.style,
  };
  draw.push(renderLines(col.claim.lines, claimOpts));
  const claimBox = track('claim', blockBox(col.claim.lines, claimOpts));

  // The conditions sit in the one band of an X header that is always visible and
  // otherwise dead: along the bottom of the text column, clear of the avatar.
  const condStyle = { family: 'sans', size: Math.round(17 * u), weight: 600, tracking: 17 * u * 0.15, fill: c.footerInk ?? c.muted };
  const condOpts = {
    x: columnRight,
    baseline: fmt.h - fmt.pad.bottom - condStyle.size * 0.22,
    lineHeight: condStyle.size * 1.5,
    style: condStyle,
    align: 'right',
  };
  const condLines = await wrap(ctx.conditions.join('   ·   '), measureW, condStyle);
  draw.push(renderLines(condLines, condOpts));
  const condBox = track('conditions', blockBox(condLines, condOpts));

  checks.push(...strikeChecks(sign, blocks));

  const field = d.field
    ? buildField(d.field, { fmt, colour: c, mark, focus: { cx: fmt.w * 0.3, cy: fmt.h / 2, radius: fmt.h * 0.62 } })
    : null;
  if (field?.keepOut) checks.push(...keepOutChecks(field.keepOut, blocks));

  checks.push(
    {
      name: 'claim fills its measure',
      ok: col.claim.fill >= (d.headerFillFloor ?? 0.72),
      detail: `longest line covers ${(col.claim.fill * 100).toFixed(0)}% of the measure, floor ${((d.headerFillFloor ?? 0.72) * 100).toFixed(0)}%`,
    },
    {
      name: 'left column clears the profile avatar',
      ok: claimBox.y + claimBox.h <= floor + 1,
      detail: `column ends at ${(claimBox.y + claimBox.h).toFixed(0)}px, avatar starts at ${floor.toFixed(0)}px`,
    },
    {
      name: 'conditions strip clears the profile avatar',
      ok: !avatar || condBox.x > avatar.rect.x + avatar.rect.w,
      detail: `strip starts at ${condBox.x.toFixed(0)}px, avatar ends at ${avatar ? (avatar.rect.x + avatar.rect.w).toFixed(0) : 'n/a'}px`,
    },
    {
      name: 'the text column clears the sign and the call to action',
      ok: Math.max(claimBox.x + claimBox.w, condBox.x, eyebrow.box.x + eyebrow.box.w) <= Math.min(sign.box.x, pillBox.x) - 1,
      detail:
        `column ends at ${Math.max(claimBox.x + claimBox.w, condBox.x).toFixed(0)}px, ` +
        `the right-hand group starts at ${Math.min(sign.box.x, pillBox.x).toFixed(0)}px`,
    },
    {
      name: 'the conditions clear the claim',
      ok: condBox.y >= claimBox.y + claimBox.h - 1,
      detail: `strip at ${condBox.y.toFixed(0)}px, claim ends at ${(claimBox.y + claimBox.h).toFixed(0)}px`,
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
        eyebrow: col.eyebrowSize, claim: col.claim.size, support: condStyle.size,
        pill: placedPill.size, footer: condStyle.size, band: diameter * 0.1,
      },
    }),
  };
}
