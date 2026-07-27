// The field treatments: one composition, four surfaces.
//
// `poster.mjs` is a fixed composition — lockup, claim, rule, support, four
// pillars, a call-to-action bar, a footer, in that order, always centred. This
// composer takes the same registers and makes the composition itself a
// parameter: the alignment, the claim's voice (caps sans or the site's serif),
// whether there is an eyebrow, whether the pillars are drawn at all, and which
// background field sits behind it. A treatment is then a palette, a field, and
// five words of configuration — not a second layout engine.
//
// Two rules hold everything together, both inherited from `poster.mjs` because
// they are what makes a composition survive five aspect ratios:
//
//   * type is scaled by canvas *width*, gaps by leftover *height*. A story is a
//     portrait with more air, never with bigger type.
//   * the composition is solved, not tuned. Registers are measured at full size;
//     overflow shrinks the type scale until they fit, underflow opens the gaps,
//     and a canvas that can hold neither fails the flow check instead of
//     quietly clipping.
//
// Every register reports its own invariants — the pill's padding, the claim
// inside the halo, the type clear of the mark — and `verify.mjs` turns any of
// them into a non-zero exit.

import { advance, wrap, balanceRuns, renderLines, blockBox } from './text.mjs';
import { claimBlock, pillarRow, footerStrip, line } from './poster.mjs';
import { buildField } from './field.mjs';
import { loadMark } from './mark.mjs';

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------

/**
 * The call to action as a pill.
 *
 * `poster.mjs` sets it as a full-measure bar with two groups and a divider,
 * which is right for an A5 page a reader is holding. On a phone screen the pill
 * is the stronger object: one line, one destination, an arrow, and enough
 * background to read as something you could press.
 *
 * The pill is sized from its own measured text rather than from a table, so it
 * cannot end up with the label crowding the radius; what is checked is that the
 * result still fits the measure it was given.
 */
export async function ctaPill(words, { x, cx, y, align, ts, fill, ink, measure }) {
  const size = Math.round(35 * ts);
  const style = { family: 'sans', size, weight: 600, tracking: -size * 0.006, fill: ink };
  const label = `${words.label} ${words.site}`;
  const textW = await advance(label, style);

  const padX = size * 1.34;
  const arrowSize = size * 0.90;
  const arrowGap = size * 0.66;
  const h = Math.round(size * 2.34);
  const w = padX * 2 + textW + arrowGap + arrowSize;
  const left = align === 'center' ? cx - w / 2 : x;
  const cy = y + h / 2;

  const textX = left + padX;
  const arrowX = textX + textW + arrowGap;
  const stroke = Math.max(2, size * 0.078);
  const head = arrowSize * 0.34;

  const draw =
    `<rect x="${left.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="${(h / 2).toFixed(2)}" fill="${fill}"/>` +
    (await line(label, style, { x: textX, baseline: cy + size * 0.34, align: 'left' })).draw +
    `<g stroke="${ink}" stroke-width="${stroke.toFixed(2)}" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M${arrowX.toFixed(2)} ${cy.toFixed(2)}H${(arrowX + arrowSize).toFixed(2)}"/>` +
    `<path d="M${(arrowX + arrowSize - head).toFixed(2)} ${(cy - head * 0.82).toFixed(2)}L${(arrowX + arrowSize).toFixed(2)} ${cy.toFixed(2)}` +
    `L${(arrowX + arrowSize - head).toFixed(2)} ${(cy + head * 0.82).toFixed(2)}"/></g>`;

  return {
    draw,
    box: { x: left, y, w, h },
    height: h,
    size,
    checks: [
      {
        name: 'call-to-action pill fits the measure',
        ok: w <= measure + 0.5,
        detail: `pill is ${w.toFixed(0)}px on a ${measure.toFixed(0)}px measure`,
      },
      {
        name: 'call-to-action pill has optical padding',
        ok: h - size >= size * 1.1,
        detail: `${(h - size).toFixed(0)}px around ${size}px type`,
      },
    ],
  };
}

/** A short rule: a bar, or a hairline pinched by one of the mark's own nodes. */
function ruleMark(style, { x, cx, y, align, ts, colour }) {
  const width = 96 * ts;
  const left = align === 'center' ? cx - width / 2 : x;
  if (style === 'node') {
    const r = Math.max(2.2, 4.6 * ts);
    const cyy = y + r;
    return {
      draw:
        `<path d="M${left.toFixed(2)} ${cyy.toFixed(2)}H${(left + width / 2 - r * 2.4).toFixed(2)}" stroke="${colour}" ` +
        `stroke-width="${Math.max(1, 1.6 * ts).toFixed(2)}" opacity=".55"/>` +
        `<circle cx="${(left + width / 2).toFixed(2)}" cy="${cyy.toFixed(2)}" r="${r.toFixed(2)}" fill="${colour}"/>` +
        `<path d="M${(left + width / 2 + r * 2.4).toFixed(2)} ${cyy.toFixed(2)}H${(left + width).toFixed(2)}" stroke="${colour}" ` +
        `stroke-width="${Math.max(1, 1.6 * ts).toFixed(2)}" opacity=".55"/>`,
      box: { x: left, y, w: width, h: r * 2 },
      height: r * 2,
    };
  }
  const h = Math.max(2, 4 * ts);
  return {
    draw: `<rect x="${left.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${h.toFixed(2)}" fill="${colour}"/>`,
    box: { x: left, y, w: width, h },
    height: h,
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const CLAIM_VOICE = {
  // The poster voice: caps, tight, the accent clause in purple.
  caps: { family: 'sans', weight: 600, trackingRatio: -0.014, accentFamily: null, optical: 0.74, boxed: 1.02, lineHeight: 0.94 },
  // The site's voice: Fraunces, sentence case, the accent word italic — the same
  // treatment the homepage gives its own headline.
  serif: { family: 'serif', weight: 600, trackingRatio: -0.020, accentFamily: 'serifItalic', optical: 0.92, boxed: 1.16, lineHeight: 1.02 },
};

function setup(direction, ctx) {
  const words = ctx.campaign.fields[direction.design.copy];
  if (!words) throw new Error(`campaign: no field copy named "${direction.design.copy}"`);
  const voice = CLAIM_VOICE[direction.design.voice];
  if (!voice) throw new Error(`campaign: no claim voice "${direction.design.voice}"`);
  return { d: direction.design, c: direction.colour, words, voice };
}

/**
 * Every foreground/background pair the composition draws, at the size it draws
 * it, against every surface the field says the type can land on.
 *
 * The field owns the surface list — a gradient contributes both ends, a wash
 * contributes its densest point — which is why a treatment cannot pass contrast
 * by declaring only the colour it started from.
 */
function contrastPairs({ c, d, surfaces, sizes }) {
  const onField = [
    { name: 'claim', fg: c.ink, size: sizes.claim },
    { name: 'claim accent', fg: c.accent, size: sizes.claim },
    { name: 'support', fg: c.muted, size: sizes.support },
    { name: 'footer conditions', fg: c.footerInk ?? c.ink, size: sizes.footer },
  ];
  if (sizes.eyebrow) onField.push({ name: 'eyebrow', fg: c.eyebrow ?? c.muted, size: sizes.eyebrow });
  if (sizes.caption) onField.push({ name: 'pillar caption', fg: c.ink, size: sizes.caption });

  const pairs = [];
  for (const item of onField) {
    for (const surface of surfaces) pairs.push({ name: `${item.name} on ${surface.name}`, fg: item.fg, bg: surface.color, size: item.size });
  }
  pairs.push({ name: 'cta pill label', fg: c.pillInk, bg: c.pillFill, size: sizes.pill });
  if (sizes.caption) {
    // An outlined disc leaves the icon sitting on the field itself; a filled one
    // puts it on the disc.
    const iconBg = d.pillars === 'outline' ? null : c.discFill ?? c.purple;
    if (iconBg) pairs.push({ name: 'pillar icon', fg: c.iconInk ?? c.paper, bg: iconBg, size: sizes.caption * 2.2 });
    else for (const surface of surfaces) pairs.push({ name: `pillar icon on ${surface.name}`, fg: c.iconInk ?? c.ink, bg: surface.color, size: sizes.caption * 2.2 });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// The flyer — square, portrait, story, print
// ---------------------------------------------------------------------------

const BASE_GAPS = {
  logo: 54,
  eyebrow: 26,
  claim: 30,
  rule: 34,
  support: 58,
  pillars: 52,
  cta: 44,
};

export async function composeFieldFlyer(direction, format, fmt, ctx) {
  const { d, c, words, voice } = setup(direction, ctx);
  const mark = await loadMark(ctx.root);
  const u = fmt.w / 1080;
  const cx = fmt.w / 2;
  const contentW = fmt.w - fmt.pad.x * 2;
  const available = fmt.h - fmt.pad.top - fmt.pad.bottom;

  const alignLeft = d.align === 'left';
  const align = alignLeft ? 'left' : 'center';
  const anchorX = alignLeft ? fmt.pad.x : cx;
  // A left-aligned treatment gives the right of the canvas to the field, so the
  // column stops well short of the margin; a centred one uses nearly all of it.
  const measureW = contentW * (d.measure ?? (alignLeft ? 0.68 : 0.94));

  /** Measure the whole composition at type scale `k`, gaps unexpanded. */
  const measure = async (k) => {
    const ts = u * k;
    const seq = [];
    const push = (name, height, gapAfter, place) => seq.push({ name, height, gap: gapAfter * ts, place });

    const logoW = Math.round((d.logoWidth ?? 320) * ts);
    const logoH = await ctx.logoHeight(direction, logoW);
    push('logo', logoH, BASE_GAPS.logo, async (y) => ({
      box: { x: Math.round(alignLeft ? fmt.pad.x : cx - logoW / 2), y: Math.round(y), w: logoW, h: logoH },
      logo: true,
    }));

    let eyebrowSize = 0;
    if (words.eyebrow) {
      eyebrowSize = Math.round(20 * ts);
      const style = { family: 'sans', size: eyebrowSize, weight: 600, tracking: eyebrowSize * 0.22, fill: c.eyebrow ?? c.muted };
      push('eyebrow', eyebrowSize * 1.04, BASE_GAPS.eyebrow, async (y) => {
        const placed = await line(words.eyebrow, style, { x: anchorX, cx: anchorX, baseline: y + eyebrowSize * 0.82, align });
        return { draw: placed.draw, box: placed.box };
      });
    }

    const claim = await claimBlock(words.claim, words.accents, measureW, {
      cap: (d.claimCap ?? 100) * ts,
      ink: c.ink,
      accentFill: c.accent,
      lineCount: fmt.claimLines ?? words.lines ?? 3,
      lineHeight: voice.lineHeight,
      family: voice.family,
      weight: voice.weight,
      trackingRatio: voice.trackingRatio,
      accentFamily: voice.accentFamily,
      optical: voice.optical,
      boxed: voice.boxed,
    });
    push('claim', claim.height, d.rule === 'none' ? BASE_GAPS.rule : BASE_GAPS.claim, async (y) => {
      const opts = { x: anchorX, baseline: y + claim.size * (voice.family === 'serif' ? 0.86 : 0.76), lineHeight: claim.size * voice.lineHeight, style: claim.style, align };
      return { draw: renderLines(claim.lines, opts), box: blockBox(claim.lines, opts) };
    });

    if (d.rule !== 'none') {
      const probe = ruleMark(d.rule, { x: anchorX, cx: anchorX, y: 0, align, ts, colour: c.rule ?? c.accent });
      push('rule', probe.height, BASE_GAPS.rule, async (y) => {
        const placed = ruleMark(d.rule, { x: anchorX, cx: anchorX, y, align, ts, colour: c.rule ?? c.accent });
        return { draw: placed.draw, box: placed.box };
      });
    }

    const supportSize = Math.round(27 * ts);
    const supportStyle = { family: 'sans', size: supportSize, weight: 400, tracking: 0, fill: c.muted };
    // The support gets its own measure. Tying it to the claim's makes a
    // treatment with a short claim set its support in a narrow, tall column —
    // three lines where two would do — for no reason other than that the
    // headline above it happened to be three words long.
    const supportW = contentW * (d.supportMeasure ?? (alignLeft ? d.measure ?? 0.68 : 0.80));
    const { lines: supportLines } = await balanceRuns([{ text: words.support }], supportW, supportStyle, { minScale: 1 });
    const supportLead = supportSize * 1.44;
    const supportH = (supportLines.length - 1) * supportLead + supportSize * 1.04;
    push('support', supportH, d.pillars ? BASE_GAPS.support : BASE_GAPS.support * 0.9, async (y) => {
      const opts = { x: anchorX, baseline: y + supportSize * 0.8, lineHeight: supportLead, style: supportStyle, align };
      return { draw: renderLines(supportLines, opts), box: blockBox(supportLines, opts) };
    });

    let captionSize = 0;
    if (d.pillars) {
      const pillarOpts = {
        x: fmt.pad.x, width: contentW, colour: c, ts,
        discFill: d.pillars === 'outline' ? null : c.discFill ?? c.purple,
        discStroke: d.pillars === 'outline' ? c.discStroke ?? c.line : null,
        iconColour: d.pillars === 'outline' ? c.iconInk ?? c.ink : c.iconInk ?? c.paper,
        ruleColour: c.line,
      };
      const probe = await pillarRow(ctx.copy.pillars, { ...pillarOpts, y: 0 });
      captionSize = Math.round(20 * ts);
      push('pillars', probe.height, BASE_GAPS.pillars, async (y) => {
        const placed = await pillarRow(ctx.copy.pillars, { ...pillarOpts, y });
        return { draw: placed.draw, box: placed.box, checks: placed.checks };
      });
    }

    const pillProbe = await ctaPill(words.cta ?? ctx.campaign.pill, {
      x: fmt.pad.x, cx, y: 0, align, ts, fill: c.pillFill, ink: c.pillInk, measure: contentW,
    });
    push('cta', pillProbe.height, BASE_GAPS.cta, async (y) => {
      const placed = await ctaPill(words.cta ?? ctx.campaign.pill, {
        x: fmt.pad.x, cx, y, align, ts, fill: c.pillFill, ink: c.pillInk, measure: contentW,
      });
      return { draw: placed.draw, box: placed.box, checks: placed.checks };
    });

    const footerProbe = await footerStrip(ctx.conditions, {
      cx, baseline: 0, width: contentW, colour: c, ts,
      inkColour: c.footerInk ?? c.ink, dotColour: c.accent, ruleColour: c.line,
    });
    push('footer', footerProbe.height, 0, async (y) => {
      const placed = await footerStrip(ctx.conditions, {
        cx, baseline: y + footerProbe.height * 0.72, width: contentW, colour: c, ts,
        inkColour: c.footerInk ?? c.ink, dotColour: c.accent, ruleColour: c.line,
      });
      return { draw: placed.draw, box: placed.box, checks: placed.checks };
    });

    const blocksH = seq.reduce((a, s) => a + s.height, 0);
    const gapsH = seq.reduce((a, s) => a + s.gap, 0);
    return {
      k, ts, seq, gapsH, total: blocksH + gapsH,
      sizes: { claim: claim.size, support: supportSize, eyebrow: eyebrowSize, caption: captionSize, pill: pillProbe.size, footer: footerProbe.size },
      claimFill: claim.fill,
    };
  };

  let m = await measure(1);
  for (let pass = 0; pass < 4 && m.total > available; pass++) {
    const next = Math.max(0.62, m.k * ((available - 2) / m.total));
    if (next >= m.k) break;
    m = await measure(next);
  }

  // Underflow opens the gaps, up to a ceiling — past it the registers stop
  // reading as one composition. Whatever the ceiling leaves over is split
  // evenly above and below the stack, because a sparse treatment (no process
  // row) has enough slack to hit that ceiling, and putting a third of it at the
  // top leaves the other two thirds as a dead band under the footer.
  const slack = Math.max(0, available - m.total - 2);
  const expand = slack > 0 ? Math.min(3.0, 1 + slack / m.gapsH) : 1;
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

  // The field is built last, because it is built around the type: the halo's
  // radius comes from the block it has to enclose, not from a fraction someone
  // typed.
  const enclosed = blocks.filter((b) => ['eyebrow', 'claim', 'rule', 'support'].includes(b.name));
  // The band a background light is allowed to occupy: below the lockup, above
  // whatever comes after the support. A field that lights outside it is
  // lighting something that was composed to be read.
  const after = blocks.find((b) => ['pillars', 'cta'].includes(b.name));
  const focus = {
    ...haloFocus(enclosed, cx, m.ts, fmt),
    lightFrom: logoBox ? logoBox.y + logoBox.h + 26 * m.ts : fmt.pad.top,
    lightTo: after ? after.y - 26 * m.ts : fmt.h - fmt.pad.bottom,
  };
  const field = buildField(d.field, { fmt, colour: c, mark, focus });

  if (field.ring) checks.push(...ringChecks(field.ring, enclosed, m.ts));
  // The pill is opaque and carries its own ground, so it is the one block a
  // background wash is allowed to pass behind.
  if (field.keepOut) checks.push(...keepOutChecks(field.keepOut, blocks.filter((b) => b.name !== 'cta')));

  // The floor catches a claim that quietly got small — the failure mode of a
  // solved layout is a headline that shrank to fit rather than a composition
  // that gave way. A treatment whose claim is three words sets its own floor:
  // that claim is already the largest thing on the page, and filling a full
  // measure with it would mean setting it at a size the page cannot carry.
  const floor = d.fillFloor ?? 0.70;
  checks.push({
    name: 'claim fills its measure',
    ok: m.claimFill >= floor,
    detail: `longest line covers ${(m.claimFill * 100).toFixed(0)}% of the measure, floor ${(floor * 100).toFixed(0)}%`,
  });
  if (!alignLeft) {
    for (const block of blocks) {
      if (['pillars', 'footer'].includes(block.name)) continue;
      const offset = Math.abs(block.x + block.w / 2 - cx);
      checks.push({ name: `${block.name} is centred`, ok: offset <= 1, detail: `${offset.toFixed(2)}px off the canvas centre` });
    }
  }

  return {
    blocks,
    logo: logoBox,
    gap: fmt.h - fmt.pad.bottom - bottom,
    defs: field.defs,
    background: field.draw,
    svgBody: draw.join(''),
    u,
    checks,
    contrast: contrastPairs({ c, d, surfaces: field.surfaces, sizes: m.sizes }),
  };
}

/**
 * The circle the halo has to enclose, as a centre and a radius.
 *
 * The floor keeps a short claim from getting a ring drawn tight around it like
 * a badge; on a 3:1 header the canvas height is the constraint, not the width.
 */
function haloFocus(enclosed, cx, ts, fmt) {
  const floor = fmt.layout === 'landscape' ? fmt.h * 0.62 : fmt.w * 0.40;
  if (!enclosed.length) return { cx, cy: fmt.h / 2, radius: floor };
  const top = Math.min(...enclosed.map((b) => b.y));
  const bottom = Math.max(...enclosed.map((b) => b.y + b.h));
  const left = Math.min(...enclosed.map((b) => b.x));
  const right = Math.max(...enclosed.map((b) => b.x + b.w));
  const cy = (top + bottom) / 2;
  const centre = (left + right) / 2;
  const need = Math.hypot((right - left) / 2, (bottom - top) / 2) + 54 * ts;
  return { cx: centre, cy, radius: Math.max(need, floor) };
}

/** Type inside a halo has to stay inside it: a ring through a word is a defect. */
function ringChecks(ring, enclosed, ts) {
  const clear = ring.r - 16 * ts;
  return enclosed.map((b) => {
    const corners = [
      [b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h],
    ];
    const worst = Math.max(...corners.map(([px, py]) => Math.hypot(px - ring.cx, py - ring.cy)));
    return {
      name: `${b.name} sits inside the halo`,
      ok: worst <= clear,
      detail: `furthest corner ${worst.toFixed(0)}px from the centre, ring at ${clear.toFixed(0)}px`,
    };
  });
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
      detail: `block overlaps the artwork's dense zone`,
    }));
}

// ---------------------------------------------------------------------------
// The X header
// ---------------------------------------------------------------------------

/**
 * Landscape: identity and claim on the left, the pill on the right, the
 * conditions along the bottom right.
 *
 * The left column is measured against the profile avatar rather than the canvas
 * — X draws the avatar over the bottom-left corner, and content placed there is
 * permanently hidden for every visitor.
 */
export async function composeFieldHeader(direction, format, fmt, ctx) {
  const { d, c, words, voice } = setup(direction, ctx);
  const mark = await loadMark(ctx.root);
  const u = fmt.w / 1500;

  const blocks = [];
  const draw = [];
  const checks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  // The right column first: the pill's width is measured, and what is left over
  // is the claim's measure.
  const pill = await ctaPill(words.cta ?? ctx.campaign.pill, {
    x: 0, cx: 0, y: 0, align: 'left', ts: u * 0.92, fill: c.pillFill, ink: c.pillInk, measure: fmt.w * 0.42,
  });
  const condStyle = { family: 'sans', size: Math.round(17 * u), weight: 600, tracking: 17 * u * 0.15, fill: c.footerInk ?? c.muted };
  const condLines = await wrap(ctx.conditions.join('   ·   '), fmt.w * 0.5, condStyle);
  const condOpts = {
    x: fmt.w - fmt.pad.x,
    baseline: fmt.h - fmt.pad.bottom - condStyle.size * 0.22,
    lineHeight: condStyle.size * 1.5,
    style: condStyle,
    align: 'right',
  };

  const pillX = fmt.w - fmt.pad.x - pill.box.w;
  const condTop = condOpts.baseline - condStyle.size * 0.82;
  const pillY = fmt.pad.top + Math.max(0, (condTop - 30 * u - fmt.pad.top - pill.height) / 2);
  const placedPill = await ctaPill(words.cta ?? ctx.campaign.pill, {
    x: pillX, cx: 0, y: pillY, align: 'left', ts: u * 0.92, fill: c.pillFill, ink: c.pillInk, measure: fmt.w * 0.42,
  });
  draw.push(placedPill.draw);
  track('cta', placedPill.box);
  checks.push(...placedPill.checks);

  const columnRight = pillX - 64 * u;
  const measureW = columnRight - fmt.pad.x;
  const avatar = (fmt.obstructions ?? []).find((o) => o.rect.x < fmt.pad.x + 40 * u);
  const floor = avatar ? avatar.rect.y - 18 * u : fmt.h - fmt.pad.bottom;

  const logoW = Math.round(172 * u);
  const logoH = await ctx.logoHeight(direction, logoW);
  const gap = 30 * u;

  let eyebrowSize = 0;
  let eyebrowDraw = '';
  let eyebrowH = 0;
  const eyebrowGap = 20 * u;
  if (words.eyebrow) {
    eyebrowSize = Math.round(19 * u);
    eyebrowH = eyebrowSize * 1.04;
  }

  const room = floor - fmt.pad.top - logoH - gap - (eyebrowH ? eyebrowH + eyebrowGap : 0);
  // How many lines the claim breaks into on a 3:1 canvas is a treatment's own
  // call: two lines of caps fill a banner, two lines of a serif sentence leave
  // it half empty, and the fill check below is what says so.
  const claimOptsFor = (cap) => ({
    cap, ink: c.ink, accentFill: c.accent, lineCount: d.headerClaimLines ?? fmt.claimLines ?? 2, lineHeight: voice.lineHeight,
    family: voice.family, weight: voice.weight, trackingRatio: voice.trackingRatio,
    accentFamily: voice.accentFamily, optical: voice.optical, boxed: voice.boxed,
  });
  let claim = await claimBlock(words.claim, words.accents, measureW, claimOptsFor((d.headerClaimCap ?? 74) * u));
  if (claim.boxHeight > room) {
    claim = await claimBlock(words.claim, words.accents, measureW, claimOptsFor(Math.max(20, claim.size * (room / claim.boxHeight))));
  }

  const groupH = logoH + gap + (eyebrowH ? eyebrowH + eyebrowGap : 0) + claim.boxHeight;
  let y = fmt.pad.top + Math.max(0, (floor - fmt.pad.top - groupH) / 2);

  const logoBox = track('logo', { x: fmt.pad.x, y: Math.round(y), w: logoW, h: logoH });
  y += logoH + gap;

  if (eyebrowH) {
    const style = { family: 'sans', size: eyebrowSize, weight: 600, tracking: eyebrowSize * 0.22, fill: c.eyebrow ?? c.muted };
    const placed = await line(words.eyebrow, style, { x: fmt.pad.x, baseline: y + eyebrowSize * 0.82, align: 'left' });
    eyebrowDraw = placed.draw;
    draw.push(eyebrowDraw);
    track('eyebrow', placed.box);
    y += eyebrowH + eyebrowGap;
  }

  const claimOpts = {
    x: fmt.pad.x,
    baseline: y + claim.size * (voice.family === 'serif' ? 0.86 : 0.76),
    lineHeight: claim.size * voice.lineHeight,
    style: claim.style,
  };
  draw.push(renderLines(claim.lines, claimOpts));
  const claimBox = track('claim', blockBox(claim.lines, claimOpts));

  draw.push(renderLines(condLines, condOpts));
  const condBox = track('conditions', blockBox(condLines, condOpts));

  const enclosed = blocks.filter((b) => ['eyebrow', 'claim'].includes(b.name));
  const field = buildField(d.field, { fmt, colour: c, mark, focus: haloFocus(enclosed, fmt.w * 0.3, u, fmt) });
  if (field.ring) checks.push(...ringChecks(field.ring, enclosed, u));
  // The pill is opaque and carries its own ground, so it is the one block a
  // background wash is allowed to pass behind.
  if (field.keepOut) checks.push(...keepOutChecks(field.keepOut, blocks.filter((b) => b.name !== 'cta')));

  checks.push(
    {
      name: 'claim fills its measure',
      ok: claim.fill >= (d.fillFloor ?? 0.70),
      detail: `longest line covers ${(claim.fill * 100).toFixed(0)}% of the measure, floor ${((d.fillFloor ?? 0.7) * 100).toFixed(0)}%`,
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
      name: 'claim clears the call to action',
      ok: claimBox.x + claimBox.w <= pillX - 1,
      detail: `claim ends at ${(claimBox.x + claimBox.w).toFixed(0)}px, pill starts at ${pillX.toFixed(0)}px`,
    },
    {
      name: 'call to action clears the conditions strip',
      ok: placedPill.box.y + placedPill.box.h <= condTop - 1,
      detail: `pill ends at ${(placedPill.box.y + placedPill.box.h).toFixed(0)}px, strip starts at ${condTop.toFixed(0)}px`,
    },
  );

  return {
    blocks,
    logo: logoBox,
    gap: Infinity,
    defs: field.defs,
    background: field.draw,
    svgBody: draw.join(''),
    u,
    checks,
    contrast: contrastPairs({
      c, d, surfaces: field.surfaces,
      sizes: { claim: claim.size, support: condStyle.size, eyebrow: eyebrowSize, caption: 0, pill: placedPill.size, footer: condStyle.size },
    }),
  };
}
