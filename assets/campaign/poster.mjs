// The poster layout: a centred, structured flyer.
//
// The three original treatments are editorial — a left-aligned column of type on
// a tonal field. This one is a poster: symmetric, denser, and built from five
// horizontal registers (lockup, claim, support, process row, call to action) over
// a footer strip. It exists because a WhatsApp forward and an X header are read in
// about two seconds by someone who did not ask for them, and a symmetric poster
// with an accented claim survives that better than a quiet column does.
//
// Two scales run through everything here, and keeping them apart is the point:
//
//   * `ts` — the type scale, proportional to canvas *width*. Anything that has to
//     fit between two margins is sized by it: the claim, the pillar captions, the
//     call to action, the footer. Scaling those by height is how a caption ends up
//     wider than its column on a story canvas.
//   * gap expansion — proportional to leftover *height*. A taller canvas gets more
//     air between registers, not bigger type.
//
// The composition is solved, not tuned: registers are measured, and if they
// overflow the canvas the type scale shrinks until they fit; if they underfill it,
// the gaps open. No per-format table of numbers, and no format that "nearly" fits.
// Every register also reports its own invariants — column pitch, captions inside
// their column, padding inside the bar, the claim still filling its measure — and
// `verify.mjs` turns any of them into a non-zero exit.
//
// The purple is the brand mark's own `#582078`, not a site theme token: the
// website lockup is monochrome by owner rule and the purple lives on collateral.

import { advance, wrap, balanceRuns, wrapRuns, renderLines, blockBox } from './text.mjs';

// ---------------------------------------------------------------------------
// Icons
//
// Drawn on a 24-unit grid and stroked, so one definition serves every size from a
// 44px disc on the X header to a 150px disc on the A5 page. Stroke weight is
// given in grid units, so it stays optically identical at every size instead of
// growing with the icon.
// ---------------------------------------------------------------------------

// One idea per icon. Anything busier turns to noise at the 60-70px disc these sit
// on in a phone-sized flyer — an earlier set put a pulse inside three of the four
// and they stopped being distinguishable from each other.
const ICONS = {
  // Case studied in detail — a lens over a trace.
  magnifier: [
    'M15.9 15.9 L20.7 20.7',
    'M10.1 3.6 a6.5 6.5 0 1 0 0.001 0 z',
    'M6.6 10.4 h1.6 l1.3 -3.1 1.7 5.4 1.1 -2.3 h1.4',
  ],
  // Protocol built for the case — a written clipboard.
  clipboard: [
    'M8.2 4.2 H5.9 A1.9 1.9 0 0 0 4.0 6.1 V19.6 A1.9 1.9 0 0 0 5.9 21.5 H18.1 A1.9 1.9 0 0 0 20.0 19.6 V6.1 A1.9 1.9 0 0 0 18.1 4.2 H15.8',
    'M9.2 2.5 h5.6 a1.0 1.0 0 0 1 1.0 1.0 v2.4 a1.0 1.0 0 0 1 -1.0 1.0 h-5.6 a1.0 1.0 0 0 1 -1.0 -1.0 v-2.4 a1.0 1.0 0 0 1 1.0 -1.0 z',
    'M8.2 12.0 H15.8',
    'M8.2 16.0 H13.4',
  ],
  // Therapy guided at home.
  home: ['M3.4 10.6 L12.0 3.4 L20.6 10.6 V19.7 A1.8 1.8 0 0 1 18.8 21.5 H5.2 A1.8 1.8 0 0 1 3.4 19.7 Z'],
  // Followed up to the result.
  cycle: [
    'M20.3 12.0 a8.3 8.3 0 0 1 -13.3 6.6',
    'M3.7 12.0 a8.3 8.3 0 0 1 13.3 -6.6',
    'M17.0 2.0 V5.6 H13.4',
    'M7.0 22.0 V18.4 H10.6',
  ],
  globe: [
    'M12.0 3.2 a8.8 8.8 0 1 0 0.001 0 z',
    'M12.0 3.2 a4.7 8.8 0 0 0 0 17.6 a4.7 8.8 0 0 0 0 -17.6 z',
    'M3.9 9.3 H20.1',
    'M3.9 14.7 H20.1',
  ],
};

function icon(name, cx, cy, size, color, weightUnits = 1.7) {
  const paths = ICONS[name];
  if (!paths) throw new Error(`poster: no icon "${name}"`);
  const s = size / 24;
  return (
    `<g transform="translate(${(cx - size / 2).toFixed(2)} ${(cy - size / 2).toFixed(2)}) scale(${s.toFixed(5)})" ` +
    `fill="none" stroke="${color}" stroke-width="${weightUnits}" stroke-linecap="round" stroke-linejoin="round">` +
    paths.map((d) => `<path d="${d}"/>`).join('') +
    `</g>`
  );
}

/** An arrow inside a filled disc — the sans subset has no arrow glyph. */
function arrowDisc(cx, cy, d, discFill, arrowColor) {
  const len = d * 0.44;
  const head = len * 0.42;
  const x = cx - len / 2;
  return (
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(d / 2).toFixed(2)}" fill="${discFill}"/>` +
    `<g stroke="${arrowColor}" stroke-width="${(d * 0.075).toFixed(2)}" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M${x.toFixed(2)} ${cy.toFixed(2)}H${(x + len).toFixed(2)}"/>` +
    `<path d="M${(x + len - head).toFixed(2)} ${(cy - head * 0.85).toFixed(2)}L${(x + len).toFixed(2)} ${cy.toFixed(2)}` +
    `L${(x + len - head).toFixed(2)} ${(cy + head * 0.85).toFixed(2)}"/>` +
    `</g>`
  );
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** One measured line, placed by its centre or its left edge. */
async function line(text, style, { cx, x, baseline, align = 'center' }) {
  const lines = await wrapRuns([{ text }], Infinity, style);
  const opts = { x: align === 'center' ? cx : x, baseline, lineHeight: style.size * 1.2, style, align };
  return { draw: renderLines(lines, opts), box: blockBox(lines, opts), width: lines[0]?.width ?? 0 };
}

/** Several measured lines in one style, as a block. */
async function stack(rows, style, { x, cx, baseline, lineHeight, align = 'left' }) {
  const lines = [];
  for (const row of rows) lines.push((await wrapRuns([{ text: row }], Infinity, style))[0]);
  const opts = { x: align === 'center' ? cx : x, baseline, lineHeight, style, align };
  return {
    draw: renderLines(lines, opts),
    box: blockBox(lines, opts),
    width: Math.max(...lines.map((l) => l.width)),
    height: (lines.length - 1) * lineHeight + style.size * 1.0,
  };
}

/** Split an authored phrase list into `count` contiguous groups, evenly. */
function groupPhrases(phrases, count) {
  if (count >= phrases.length) return phrases.map((p) => [p]);
  const weight = phrases.map((p) => p.length);
  let best = null;
  const walk = (index, groups) => {
    if (groups.length === count) {
      if (index !== phrases.length) return;
      const sums = groups.map((g) => g.reduce((a, i) => a + weight[i], 0));
      const spread = Math.max(...sums) - Math.min(...sums);
      if (!best || spread < best.spread) best = { spread, groups: groups.map((g) => g.map((i) => phrases[i])) };
      return;
    }
    for (let end = index + 1; end <= phrases.length - (count - groups.length - 1); end++) {
      walk(end, [...groups, Array.from({ length: end - index }, (_, k) => index + k)]);
    }
  };
  walk(0, []);
  if (!best) throw new Error(`poster: cannot group ${phrases.length} phrases into ${count} lines`);
  return best.groups;
}

/**
 * The claim, set at the size that fills its measure.
 *
 * The line breaks are authored, because where a poster headline breaks is a
 * design decision and not something a wrapper should guess at; a format that
 * wants fewer lines gets them by merging adjacent phrases at the split that
 * evens the lines out. What is not authored is the size: it is solved so the
 * longest line lands on the measure, subject to a ceiling. Advance width is
 * linear in font size, so one probe measurement gives the answer and the second
 * pass is the exact one that gets placed.
 */
async function claimBlock(phrases, accents, measure, { cap, ink, accentFill, lineCount, lineHeight }) {
  const groups = groupPhrases(phrases, lineCount);
  const styleAt = (size) => ({ family: 'sans', size, weight: 600, tracking: -size * 0.014, fill: ink });

  const runsFor = (group) =>
    group.join(' ').split(/\s+/).map((word) => ({ text: word, fill: accents.includes(word) ? accentFill : ink }));

  const widthsAt = async (size) => {
    const st = styleAt(size);
    const out = [];
    for (const group of groups) {
      const lines = await wrapRuns(runsFor(group), Infinity, st);
      if (lines.length !== 1) throw new Error('poster: a claim group wrapped unexpectedly');
      out.push(lines[0]);
    }
    return out;
  };

  const probe = 100;
  const widest = Math.max(...(await widthsAt(probe)).map((l) => l.width));
  let size = Math.max(8, Math.min(Math.round(cap), Math.floor((measure * probe) / widest)));
  let lines = await widthsAt(size);
  while (size > 8 && Math.max(...lines.map((l) => l.width)) > measure) {
    size -= 1;
    lines = await widthsAt(size);
  }

  return {
    lines,
    style: styleAt(size),
    size,
    fill: Math.max(...lines.map((l) => l.width)) / measure,
    // `height` is the optical height used for stacking registers — caps, so no
    // descender. `boxHeight` is the rectangle the verifier sees, which includes
    // the generous descent estimate; a clearance test has to use that one.
    height: (lines.length - 1) * size * lineHeight + size * 0.74,
    boxHeight: (lines.length - 1) * size * lineHeight + size * 1.02,
  };
}

// ---------------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------------

/**
 * The process row: four pillars read off `data/protocols.json`.
 *
 * The captions are short forms of the four engagement steps every protocol
 * shares, and `build.mjs` refuses to run if a caption's source phrase has left
 * that list — the flyer cannot describe a process the site does not.
 */
async function pillarRow(pillars, { x, y, width, colour, ts }) {
  const cols = pillars.length;
  const colW = width / cols;
  const disc = 92 * ts;
  const captionSize = Math.round(20 * ts);
  const captionLead = captionSize * 1.34;
  const underDisc = 24 * ts;
  const style = { family: 'sans', size: captionSize, weight: 600, tracking: 0, fill: colour.ink };

  const discCy = y + disc / 2;
  const firstBaseline = y + disc + underDisc + captionSize * 0.76;

  const draw = [];
  const centres = [];
  const checks = [];
  let rows = 0;

  for (const [i, pillar] of pillars.entries()) {
    const cx = x + colW * (i + 0.5);
    centres.push(cx);
    draw.push(`<circle cx="${cx.toFixed(2)}" cy="${discCy.toFixed(2)}" r="${(disc / 2).toFixed(2)}" fill="${colour.purple}"/>`);
    draw.push(icon(pillar.icon, cx, discCy, disc * 0.54, colour.paper, 1.75));

    for (const [row, text] of pillar.caption.entries()) {
      const placed = await line(text, style, { cx, baseline: firstBaseline + row * captionLead });
      draw.push(placed.draw);
      // A caption touching its neighbour's column is the failure mode of a
      // four-up row, and it is invisible in a thumbnail.
      checks.push({
        name: `pillar ${i + 1} caption fits its column`,
        ok: placed.width <= colW - 26 * ts,
        detail: `"${text}" is ${placed.width.toFixed(0)}px in a ${(colW - 26 * ts).toFixed(0)}px column`,
      });
    }
    rows = Math.max(rows, pillar.caption.length);
  }

  const height = disc + underDisc + (rows - 1) * captionLead + captionSize * 1.02;

  const ruleTop = y + disc * 0.06;
  const ruleBottom = y + height - captionSize * 0.12;
  for (let i = 1; i < cols; i++) {
    const rx = x + colW * i;
    draw.push(
      `<path d="M${rx.toFixed(2)} ${ruleTop.toFixed(2)}V${ruleBottom.toFixed(2)}" stroke="${colour.line}" ` +
        `stroke-width="${Math.max(1, 1.4 * ts).toFixed(2)}"/>`,
    );
  }

  const pitch = centres.slice(1).map((c, i) => c - centres[i]);
  checks.push({
    name: 'pillar columns are evenly pitched',
    ok: Math.max(...pitch) - Math.min(...pitch) < 0.5,
    detail: `column pitch varies by ${(Math.max(...pitch) - Math.min(...pitch)).toFixed(2)}px`,
  });

  return { draw: draw.join(''), box: { x, y, w: width, h: height }, height, checks };
}

/**
 * The call to action as a filled bar: where to go on the left, why to go now on
 * the right, a hairline between them.
 *
 * The bar solves its own internal scale. Both groups are measured, and if what is
 * left between them falls under the floor the type inside the bar shrinks until it
 * clears — so a longer line of copy makes the bar set tighter rather than crowding
 * the divider, and only fails the build once shrinking stops being honest.
 */
async function ctaBar(copy, { x, y, w, minH, colour, ts, radius }) {
  const floor = 60 * ts;
  const inset = 40 * ts;
  const inner = w - inset * 2;

  const measure = async (s) => {
    const sizes = {
      kicker: Math.round(20 * ts * s),
      site: Math.round(46 * ts * s),
      sub: Math.round(19 * ts * s),
      claim: Math.round(23 * ts * s),
    };
    const styles = {
      kicker: { family: 'sans', size: sizes.kicker, weight: 600, tracking: sizes.kicker * 0.14, fill: colour.onPurpleDim },
      site: { family: 'sans', size: sizes.site, weight: 600, tracking: -sizes.site * 0.012, fill: colour.paper },
      sub: { family: 'sans', size: sizes.sub, weight: 400, tracking: 0, fill: colour.onPurpleSoft },
      claim: { family: 'sans', size: sizes.claim, weight: 600, tracking: sizes.claim * 0.012, fill: colour.paper },
    };
    const [kickerW, siteW, subW, ...claimW] = await Promise.all([
      advance(copy.kicker, styles.kicker),
      advance(copy.site, styles.site),
      advance(copy.sub, styles.sub),
      ...copy.claim.map((row) => advance(row, styles.claim)),
    ]);

    const disc = 58 * ts * s;
    const textW = Math.max(kickerW, siteW, subW);
    const leftW = disc + 26 * ts * s + textW;
    const rightW = disc + 22 * ts * s + Math.max(...claimW);
    const stackH = sizes.kicker * 1.16 + sizes.site * 1.04 + sizes.sub * 1.3;
    const claimLead = sizes.claim * 1.28;
    const claimH = (copy.claim.length - 1) * claimLead + sizes.claim * 1.0;
    return { s, sizes, styles, disc, leftW, rightW, stackH, claimLead, claimH, slack: inner - leftW - rightW };
  };

  let m = await measure(1);
  for (let pass = 0; pass < 3 && m.slack < floor; pass++) {
    const fixed = m.disc * 2 + (26 + 22) * ts * m.s;
    const textual = m.leftW + m.rightW - fixed;
    const next = Math.max(0.62, m.s * ((inner - floor - fixed) / textual));
    if (next >= m.s) break;
    m = await measure(next);
  }

  const h = Math.max(minH, Math.max(m.disc, m.stackH, m.claimH) + 40 * ts);
  const cy = y + h / 2;
  const draw = [
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
      `rx="${radius.toFixed(2)}" fill="${colour.purple}"/>`,
  ];

  // Left group: globe, then kicker / site / sub as one optically centred stack.
  const leftX = x + inset;
  draw.push(icon('globe', leftX + m.disc / 2, cy, m.disc, colour.paper, 1.55));
  const textX = leftX + m.disc + 26 * ts * m.s;
  let ty = cy - m.stackH / 2;
  const kicker = await line(copy.kicker, m.styles.kicker, { x: textX, baseline: ty + m.sizes.kicker * 0.78, align: 'left' });
  ty += m.sizes.kicker * 1.16;
  const site = await line(copy.site, m.styles.site, { x: textX, baseline: ty + m.sizes.site * 0.76, align: 'left' });
  ty += m.sizes.site * 1.04;
  const sub = await line(copy.sub, m.styles.sub, { x: textX, baseline: ty + m.sizes.sub * 0.78, align: 'left' });
  draw.push(kicker.draw, site.draw, sub.draw);

  // Right group, flush to the inner right edge.
  const rightX = x + w - inset - m.rightW;
  draw.push(arrowDisc(rightX + m.disc / 2, cy, m.disc, colour.paper, colour.purple));
  const claim = await stack(copy.claim, m.styles.claim, {
    x: rightX + m.disc + 22 * ts * m.s,
    baseline: cy - ((copy.claim.length - 1) * m.claimLead) / 2 + m.sizes.claim * 0.34,
    lineHeight: m.claimLead,
  });
  draw.push(claim.draw);

  // Divider at the midpoint of whatever is left between the two groups.
  const dividerX = leftX + m.leftW + m.slack / 2;
  const dividerH = h * 0.56;
  draw.push(
    `<path d="M${dividerX.toFixed(2)} ${(cy - dividerH / 2).toFixed(2)}V${(cy + dividerH / 2).toFixed(2)}" ` +
      `stroke="${colour.onPurpleLine}" stroke-width="${Math.max(1, 1.5 * ts).toFixed(2)}"/>`,
  );

  return {
    draw: draw.join(''),
    box: { x, y, w, h },
    height: h,
    sizes: m.sizes,
    checks: [
      {
        name: 'call-to-action groups clear the divider',
        ok: m.slack >= floor - 0.5,
        detail: `${m.slack.toFixed(0)}px of slack between the groups, floor ${floor.toFixed(0)}px`,
      },
      {
        name: 'call-to-action bar has vertical padding',
        ok: h - Math.max(m.disc, m.stackH, m.claimH) >= 34 * ts,
        detail: `${(h - Math.max(m.disc, m.stackH, m.claimH)).toFixed(0)}px around the tallest group`,
      },
    ],
  };
}

/**
 * The same two groups stacked, for the tall narrow panel on an X header. It
 * solves its own scale the same way the bar does, against height rather than
 * width.
 */
async function ctaPanel(copy, { x, y, w, h, colour, ts, radius }) {
  const inset = 36 * ts;
  const inner = w - inset * 2;
  const padFloor = 30 * ts;

  const measure = async (s) => {
    const sizes = {
      kicker: Math.round(19 * ts * s),
      site: Math.round(41 * ts * s),
      sub: Math.round(18 * ts * s),
      claim: Math.round(21 * ts * s),
    };
    const styles = {
      kicker: { family: 'sans', size: sizes.kicker, weight: 600, tracking: sizes.kicker * 0.14, fill: colour.onPurpleDim },
      site: { family: 'sans', size: sizes.site, weight: 600, tracking: -sizes.site * 0.012, fill: colour.paper },
      sub: { family: 'sans', size: sizes.sub, weight: 400, tracking: 0, fill: colour.onPurpleSoft },
      claim: { family: 'sans', size: sizes.claim, weight: 600, tracking: sizes.claim * 0.012, fill: colour.paper },
    };
    const disc = 50 * ts * s;
    const gap = 32 * ts * s;
    const subLines = await wrap(copy.sub, inner, styles.sub);
    const subLead = sizes.sub * 1.34;
    const claimLead = sizes.claim * 1.3;
    const topH = disc + 24 * ts * s + sizes.kicker * 1.2 + sizes.site * 1.02 + (subLines.length - 1) * subLead + sizes.sub * 1.0;
    const bottomH = disc + 22 * ts * s + (copy.claim.length - 1) * claimLead + sizes.claim * 1.0;
    const total = topH + gap + 1 + gap + bottomH;
    return { s, sizes, styles, disc, gap, subLines, subLead, claimLead, topH, bottomH, total };
  };

  let m = await measure(1);
  for (let pass = 0; pass < 3 && h - m.total < padFloor * 2; pass++) {
    const next = Math.max(0.6, m.s * ((h - padFloor * 2) / m.total));
    if (next >= m.s) break;
    m = await measure(next);
  }

  const cx = x + w / 2;
  const draw = [
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
      `rx="${radius.toFixed(2)}" fill="${colour.purple}"/>`,
  ];

  let cursor = y + (h - m.total) / 2;
  draw.push(icon('globe', cx, cursor + m.disc / 2, m.disc, colour.paper, 1.55));
  cursor += m.disc + 24 * ts * m.s;
  const kicker = await line(copy.kicker, m.styles.kicker, { cx, baseline: cursor + m.sizes.kicker * 0.78 });
  cursor += m.sizes.kicker * 1.2;
  const site = await line(copy.site, m.styles.site, { cx, baseline: cursor + m.sizes.site * 0.76 });
  cursor += m.sizes.site * 1.02;
  const subOpts = { x: cx, baseline: cursor + m.sizes.sub * 0.78, lineHeight: m.subLead, style: m.styles.sub, align: 'center' };
  draw.push(kicker.draw, site.draw, renderLines(m.subLines, subOpts));
  cursor += (m.subLines.length - 1) * m.subLead + m.sizes.sub * 1.0 + m.gap;

  draw.push(
    `<path d="M${(x + inset * 1.5).toFixed(2)} ${cursor.toFixed(2)}H${(x + w - inset * 1.5).toFixed(2)}" ` +
      `stroke="${colour.onPurpleLine}" stroke-width="${Math.max(1, 1.5 * ts).toFixed(2)}"/>`,
  );
  cursor += 1 + m.gap;

  draw.push(arrowDisc(cx, cursor + m.disc / 2, m.disc, colour.paper, colour.purple));
  cursor += m.disc + 22 * ts * m.s;
  const claim = await stack(copy.claim, m.styles.claim, {
    cx,
    baseline: cursor + m.sizes.claim * 0.78,
    lineHeight: m.claimLead,
    align: 'center',
  });
  draw.push(claim.draw);

  const widest = Math.max(site.width, claim.width, ...m.subLines.map((l) => l.width));
  return {
    draw: draw.join(''),
    box: { x, y, w, h },
    sizes: m.sizes,
    checks: [
      { name: 'panel content fits its inset', ok: widest <= inner, detail: `widest line ${widest.toFixed(0)}px in ${inner.toFixed(0)}px` },
      {
        name: 'panel has vertical padding',
        ok: h - m.total >= padFloor * 2 - 1,
        detail: `${(h - m.total).toFixed(0)}px spare in a ${h.toFixed(0)}px panel, floor ${(padFloor * 2).toFixed(0)}px`,
      },
    ],
  };
}

/**
 * The footer strip: the conditions, separated by the mark's own node dots and
 * flanked by hairlines out to the margins.
 */
async function footerStrip(conditions, { cx, baseline, width, colour, ts }) {
  const size = Math.round(18 * ts);
  const style = { family: 'sans', size, weight: 600, tracking: size * 0.15, fill: colour.ink };
  const dotR = Math.max(1.4, 2.3 * ts);
  const gap = size * 1.9;
  const pull = size * 1.7;

  const widths = await Promise.all(conditions.map((c) => advance(c, style)));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (conditions.length - 1);
  const left = cx - total / 2;
  const ruleY = baseline - size * 0.28;

  const draw = [];
  let x = left;
  for (const [i, condition] of conditions.entries()) {
    draw.push((await line(condition, style, { x, baseline, align: 'left' })).draw);
    x += widths[i];
    if (i < conditions.length - 1) {
      draw.push(`<circle cx="${(x + gap / 2).toFixed(2)}" cy="${ruleY.toFixed(2)}" r="${dotR.toFixed(2)}" fill="${colour.purple}"/>`);
      x += gap;
    }
  }

  const margin = cx - width / 2;
  for (const [a, b] of [[margin, left - pull], [left + total + pull, margin + width]]) {
    if (b - a > 8) {
      draw.push(
        `<path d="M${a.toFixed(2)} ${ruleY.toFixed(2)}H${b.toFixed(2)}" stroke="${colour.line}" ` +
          `stroke-width="${Math.max(1, 1.4 * ts).toFixed(2)}"/>`,
      );
    }
  }

  return {
    draw: draw.join(''),
    box: { x: margin, y: baseline - size * 0.82, w: width, h: size * 1.1 },
    height: size * 1.1,
    size,
    checks: [
      {
        name: 'footer strip fits between the margins',
        ok: total <= width - pull * 2,
        detail: `${total.toFixed(0)}px of type in ${width.toFixed(0)}px`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The flyer — square, portrait, story, print
// ---------------------------------------------------------------------------

const BASE_GAPS = { logoClaim: 56, claimRule: 28, ruleSupport: 36, supportPillars: 58, pillarsCta: 50, ctaFooter: 40 };

export async function composePosterFlyer(direction, format, fmt, ctx) {
  const { copy, logoHeight } = ctx;
  const colour = direction.colour;
  const u = fmt.w / 1080;
  const cx = fmt.w / 2;
  const contentW = fmt.w - fmt.pad.x * 2;
  const available = fmt.h - fmt.pad.top - fmt.pad.bottom;

  // Measure the whole composition at a given type scale, with gaps at their base
  // (unexpanded) size. Everything below is derived from this one pass.
  const measure = async (k) => {
    const ts = u * k;
    const gaps = Object.fromEntries(Object.entries(BASE_GAPS).map(([name, v]) => [name, v * ts]));
    const logoW = Math.round(330 * ts);
    const logoH = await logoHeight(direction, logoW);

    const claim = await claimBlock(copy.claim, copy.claimAccents, contentW * 0.94, {
      cap: 104 * ts,
      ink: colour.ink,
      accentFill: colour.purple,
      lineCount: fmt.claimLines ?? 3,
      lineHeight: 0.94,
    });

    const supportStyle = { family: 'sans', size: Math.round(27 * ts), weight: 400, tracking: 0, fill: colour.muted };
    // Balanced, not greedily wrapped: a centred two-line support with one full
    // line and three words under it reads as an accident.
    const { lines: supportLines } = await balanceRuns([{ text: copy.support }], contentW * 0.80, supportStyle, { minScale: 1 });
    const supportLead = supportStyle.size * 1.42;
    const supportH = (supportLines.length - 1) * supportLead + supportStyle.size * 1.04;

    const ruleW = 92 * ts;
    const ruleH = Math.max(2, 4 * ts);

    const pillars = await pillarRow(copy.pillars, { x: fmt.pad.x, y: 0, width: contentW, colour, ts });
    const bar = await ctaBar(copy.cta, { x: fmt.pad.x, y: 0, w: contentW, minH: 146 * ts, colour, ts, radius: 22 * ts });
    const footer = await footerStrip(ctx.conditions, { cx, baseline: 0, width: contentW, colour, ts });

    const blocksH = logoH + claim.height + ruleH + supportH + pillars.height + bar.height + footer.height;
    const gapsH = Object.values(gaps).reduce((a, b) => a + b, 0);
    return { k, ts, gaps, gapsH, logoW, logoH, claim, supportStyle, supportLines, supportLead, supportH, ruleW, ruleH, pillars, bar, footer, totalH: blocksH + gapsH };
  };

  // Solve the type scale against the height available. Overflow shrinks the type
  // (bounded — past the floor the format is wrong for the composition and should
  // say so); underflow is absorbed by opening the gaps, never by inflating type.
  let m = await measure(1);
  for (let pass = 0; pass < 4 && m.totalH > available; pass++) {
    const next = Math.max(0.62, m.k * ((available - 2) / m.totalH));
    if (next >= m.k) break;
    m = await measure(next);
  }

  // Two pixels are held back from the expansion so the accumulated rounding of a
  // dozen registers cannot push the last one past the bottom margin.
  const slack = Math.max(0, available - m.totalH - 2);
  const expand = slack > 0 ? Math.min(2.4, 1 + slack / m.gapsH) : 1;
  const gap = Object.fromEntries(Object.entries(m.gaps).map(([name, v]) => [name, v * expand]));
  const air = Math.max(0, slack - (expand - 1) * m.gapsH);

  const draw = [];
  const blocks = [];
  const checks = [...m.pillars.checks, ...m.bar.checks, ...m.footer.checks];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  let y = fmt.pad.top + air * 0.34;

  const logoBox = track('logo', { x: Math.round(cx - m.logoW / 2), y: Math.round(y), w: m.logoW, h: m.logoH });
  y += m.logoH + gap.logoClaim;

  const claimOpts = { x: cx, baseline: y + m.claim.size * 0.76, lineHeight: m.claim.size * 0.94, style: m.claim.style, align: 'center' };
  draw.push(renderLines(m.claim.lines, claimOpts));
  track('claim', blockBox(m.claim.lines, claimOpts));
  y += m.claim.height + gap.claimRule;

  draw.push(
    `<rect x="${(cx - m.ruleW / 2).toFixed(2)}" y="${y.toFixed(2)}" width="${m.ruleW.toFixed(2)}" ` +
      `height="${m.ruleH.toFixed(2)}" fill="${colour.purple}"/>`,
  );
  track('rule', { x: cx - m.ruleW / 2, y, w: m.ruleW, h: m.ruleH });
  y += m.ruleH + gap.ruleSupport;

  const supportOpts = { x: cx, baseline: y + m.supportStyle.size * 0.8, lineHeight: m.supportLead, style: m.supportStyle, align: 'center' };
  draw.push(renderLines(m.supportLines, supportOpts));
  track('support', blockBox(m.supportLines, supportOpts));
  y += m.supportH + gap.supportPillars;

  const pillars = await pillarRow(copy.pillars, { x: fmt.pad.x, y, width: contentW, colour, ts: m.ts });
  draw.push(pillars.draw);
  track('pillars', pillars.box);
  y += pillars.height + gap.pillarsCta;

  const bar = await ctaBar(copy.cta, { x: fmt.pad.x, y, w: contentW, minH: 146 * m.ts, colour, ts: m.ts, radius: 22 * m.ts });
  draw.push(bar.draw);
  track('cta', bar.box);
  y += bar.height + gap.ctaFooter;

  const footer = await footerStrip(ctx.conditions, { cx, baseline: y + m.footer.height * 0.72, width: contentW, colour, ts: m.ts });
  draw.push(footer.draw);
  track('footer', footer.box);
  y += footer.height;

  checks.push({
    name: 'claim fills its measure',
    ok: m.claim.fill >= 0.70,
    detail: `longest line covers ${(m.claim.fill * 100).toFixed(0)}% of the measure, floor 70%`,
  });
  // Centring is the premise of this layout, so it is asserted rather than assumed.
  for (const block of blocks) {
    if (['pillars', 'cta', 'footer'].includes(block.name)) continue;
    const offset = Math.abs(block.x + block.w / 2 - cx);
    checks.push({ name: `${block.name} is centred`, ok: offset <= 1, detail: `${offset.toFixed(2)}px off the canvas centre` });
  }

  return {
    blocks,
    logo: logoBox,
    gap: fmt.h - fmt.pad.bottom - y,
    svgBody: draw.join(''),
    u,
    checks,
    contrast: contrastPairs(direction, m.ts, m.claim.size, bar.sizes, footer.size),
  };
}

// ---------------------------------------------------------------------------
// The X header
// ---------------------------------------------------------------------------

/**
 * Landscape variant: identity and claim on the left, the call to action as a
 * panel on the right.
 *
 * The left column is measured against the profile avatar rather than the canvas.
 * On a real profile the avatar fills the bottom-left corner, so the composition is
 * built around it: the claim stops above it, and the conditions strip is aligned
 * to the panel's left edge — the one band of an X header that is both always
 * visible and otherwise dead.
 */
export async function composePosterHeader(direction, format, fmt, ctx) {
  const { copy, logoHeight } = ctx;
  const colour = direction.colour;
  const u = fmt.w / 1500;

  const blocks = [];
  const draw = [];
  const checks = [];
  const track = (name, box) => { blocks.push({ name, ...box }); return box; };

  const panelW = 452 * u;
  const panelX = fmt.w - fmt.pad.x - panelW;
  const panelH = fmt.h - fmt.pad.top - fmt.pad.bottom;
  const panel = await ctaPanel(copy.cta, {
    x: panelX, y: fmt.pad.top, w: panelW, h: panelH, colour, ts: u, radius: 22 * u,
  });
  draw.push(panel.draw);
  track('cta panel', panel.box);
  checks.push(...panel.checks);

  const columnRight = panelX - 56 * u;
  const measure = columnRight - fmt.pad.x;
  const avatar = (fmt.obstructions ?? []).find((o) => o.rect.x < fmt.pad.x + 40 * u);
  const floor = avatar ? avatar.rect.y - 18 * u : fmt.h - fmt.pad.bottom;

  const logoW = Math.round(168 * u);
  const logoH = await logoHeight(direction, logoW);
  const gap = 28 * u;
  const room = floor - fmt.pad.top - logoH - gap;

  // The claim takes the height the avatar leaves it: measure at the ceiling, then
  // scale the ceiling by whatever fraction of the room it actually needed.
  let claim = await claimBlock(copy.claim, copy.claimAccents, measure, {
    cap: 76 * u, ink: colour.ink, accentFill: colour.purple, lineCount: fmt.claimLines ?? 2, lineHeight: 0.96,
  });
  if (claim.boxHeight > room) {
    claim = await claimBlock(copy.claim, copy.claimAccents, measure, {
      cap: Math.max(20, claim.size * (room / claim.boxHeight)),
      ink: colour.ink, accentFill: colour.purple, lineCount: fmt.claimLines ?? 2, lineHeight: 0.96,
    });
  }

  const groupH = logoH + gap + claim.boxHeight;
  let y = fmt.pad.top + Math.max(0, (floor - fmt.pad.top - groupH) / 2);

  const logoBox = track('logo', { x: fmt.pad.x, y: Math.round(y), w: logoW, h: logoH });
  y += logoH + gap;

  const claimOpts = { x: fmt.pad.x, baseline: y + claim.size * 0.76, lineHeight: claim.size * 0.96, style: claim.style };
  draw.push(renderLines(claim.lines, claimOpts));
  track('claim', blockBox(claim.lines, claimOpts));

  const condStyle = { family: 'sans', size: Math.round(17 * u), weight: 600, tracking: 17 * u * 0.15, fill: colour.muted };
  const condLines = await wrap(ctx.conditions.join('   ·   '), measure, condStyle);
  const condOpts = {
    x: columnRight,
    baseline: fmt.h - fmt.pad.bottom - condStyle.size * 0.22,
    lineHeight: condStyle.size * 1.5,
    style: condStyle,
    align: 'right',
  };
  draw.push(renderLines(condLines, condOpts));
  const condBox = track('conditions', blockBox(condLines, condOpts));

  checks.push(
    {
      name: 'claim fills its measure',
      ok: claim.fill >= 0.70,
      detail: `longest line covers ${(claim.fill * 100).toFixed(0)}% of the measure, floor 70%`,
    },
    {
      name: 'left column clears the profile avatar',
      ok: y + claim.boxHeight <= floor + 1,
      detail: `column ends at ${(y + claim.boxHeight).toFixed(0)}px, avatar starts at ${floor.toFixed(0)}px`,
    },
    {
      name: 'conditions strip clears the profile avatar',
      ok: !avatar || condBox.x > avatar.rect.x + avatar.rect.w,
      detail: `strip starts at ${condBox.x.toFixed(0)}px, avatar ends at ${avatar ? (avatar.rect.x + avatar.rect.w).toFixed(0) : 'n/a'}px`,
    },
  );

  return {
    blocks,
    logo: logoBox,
    gap: Infinity,
    svgBody: draw.join(''),
    u,
    checks,
    contrast: contrastPairs(direction, u, claim.size, panel.sizes, condStyle.size),
  };
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/**
 * Every foreground/background pair this layout actually draws, at the size it is
 * drawn, for `verify.mjs` to hold against the WCAG floor.
 *
 * Listed here rather than in the verifier because this treatment puts white type
 * on a filled purple bar, which the editorial ones never do: the verifier should
 * check what a layout says it draws, not a fixed list.
 */
function contrastPairs(direction, ts, claimSize, ctaSizes, footerSize) {
  const c = direction.colour;
  return [
    { name: 'claim', fg: c.ink, bg: c.paper, size: claimSize },
    { name: 'claim accent', fg: c.purple, bg: c.paper, size: claimSize },
    { name: 'support', fg: c.muted, bg: c.paper, size: 27 * ts },
    { name: 'pillar caption', fg: c.ink, bg: c.paper, size: 20 * ts },
    { name: 'pillar icon', fg: c.paper, bg: c.purple, size: 44 * ts },
    { name: 'cta kicker', fg: c.onPurpleDim, bg: c.purple, size: ctaSizes.kicker },
    { name: 'cta site', fg: c.paper, bg: c.purple, size: ctaSizes.site },
    { name: 'cta sub', fg: c.onPurpleSoft, bg: c.purple, size: ctaSizes.sub },
    { name: 'cta claim', fg: c.paper, bg: c.purple, size: ctaSizes.claim },
    { name: 'footer conditions', fg: c.ink, bg: c.paper, size: footerSize },
  ];
}
