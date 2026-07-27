// The "say no to" graphic: a general prohibition sign, built to ISO 3864-1.
//
// A hand-drawn ring with a stroke through it is not a prohibition sign; it is a
// decoration that resembles one, and it is what the first generation of these
// assets drew — a slash laid across an illustration of a foot, which read as a
// blade through the limb and inverted the message (review finding 4).
//
// So this module builds the real thing, from the standard's own proportions,
// and it enforces two rules that make the difference between a sign and a
// decoration:
//
//   * the geometry is the standard's, not a designer's approximation. Inner
//     ground 0.80 of the outer diameter, band and bar each 0.10 of it, the bar
//     at exactly 45° descending left to right, and red covering at least 35% of
//     the sign area. Every one of those is computed from what is actually drawn
//     and reported as a check.
//   * the bar strikes the prohibited thing and nothing else. What is enclosed
//     here is the *word* — the procedure being refused — never a limb. A
//     prohibition sign drawn over a leg says legs are prohibited.
//
// The enclosed word is measured, not guessed: its size is solved so its box
// fits inside the inner circle with clearance, and both the fit and a
// legibility floor are checks the build can fail on.

import { advance } from '../campaign/text.mjs';
import { line } from '../campaign/poster.mjs';

/**
 * ISO 3864-1 general prohibition sign, as fractions of the outer diameter.
 *
 * `redFloor` is the standard's own requirement that red cover at least 35% of
 * the area of the sign; the geometry above satisfies it at 36.2%, which is the
 * reason those two ratios are 0.80 and 0.10 rather than anything else.
 */
export const SPEC = Object.freeze({
  inner: 0.80,   // diameter of the inner ground
  band: 0.10,    // width of the red ring
  bar: 0.10,     // width of the diagonal bar
  angle: 45,     // degrees, descending left → right
  redFloor: 0.35,
});

/**
 * Fraction of the sign's area covered in red, computed from the geometry.
 *
 * The ring is an annulus; the bar contributes only the part of it inside the
 * inner circle (the rest is already ring). That part is a chord band of
 * half-width t across a circle of radius r, whose area is closed-form — no
 * sampling, so this is exact and cannot drift with resolution.
 */
export function redCoverage({ inner, bar } = SPEC) {
  const ring = (Math.PI / 4) * (1 - inner ** 2);
  const r = inner / 2;
  const t = bar / 2;
  const band = 2 * (t * Math.sqrt(r * r - t * t) + r * r * Math.asin(t / r));
  return ring + band;
}

/** The four corners of the diagonal bar, as an oriented rectangle. */
export function barPolygon({ cx, cy, d, angle = SPEC.angle, bar = SPEC.bar }) {
  const rad = (angle * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const nx = -uy;
  const ny = ux;
  const half = d / 2;
  const t = (bar * d) / 2;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [
    cx + ux * half * a + nx * t * b,
    cy + uy * half * a + ny * t * b,
  ]);
}

/**
 * Does the bar cross an axis-aligned block?
 *
 * Separating-axis test over the four candidate axes — the block's two, and the
 * bar's own two. Used in both directions: the sign asserts that the bar *does*
 * strike the word it encloses, and the composition asserts that it strikes
 * nothing else on the page.
 */
export function barStrikes(poly, box) {
  const rect = [
    [box.x, box.y], [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h], [box.x, box.y + box.h],
  ];
  const edge = [poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]];
  const axes = [[1, 0], [0, 1], edge, [-edge[1], edge[0]]];
  for (const [ax, ay] of axes) {
    const project = (points) => {
      const values = points.map(([px, py]) => px * ax + py * ay);
      return [Math.min(...values), Math.max(...values)];
    };
    const [a0, a1] = project(poly);
    const [b0, b1] = project(rect);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

/**
 * The sign, with `word` enclosed and struck.
 *
 * Sizing the word is solved rather than tuned: advance width is linear in font
 * size, so one probe measurement gives the width at any size, and the largest
 * size whose box still fits inside the inner circle is found by bisection on
 * that closed form. The chosen size is then measured for real and checked — a
 * solved layout that is never verified against the rasteriser is how the last
 * set of these shipped broken.
 *
 * `legibleFloor` is the smallest cap size the format will tolerate. A sign
 * shrunk to fit a banner until its word is unreadable is a failure, not a
 * compromise, and this is where it is caught.
 */
export async function prohibitionSign(
  word,
  { cx, cy, d, red, ground, ink, tracking = 0.045, legibleFloor = 0, id = 'sign' },
) {
  const outer = d / 2;
  const innerR = (d * SPEC.inner) / 2;
  const margin = d * 0.055;
  const clear = innerR - margin;

  const styleAt = (size) => ({ family: 'sans', size, weight: 600, tracking: size * tracking, fill: ink });

  const probe = 100;
  const probeWidth = await advance(word, styleAt(probe));
  // The half-height the fit has to clear is the verifier's own, not a tidy
  // symmetric estimate: the block box runs from 0.82em above the baseline to
  // 0.26em below it, and the line is placed by its cap height, which leaves the
  // box 0.08em low. Assuming it centred puts the corner 1px outside the ground
  // and fails the check it was meant to satisfy.
  const rise = (size) => Math.max(0.82 - 0.36, 0.26 + 0.36) * size;
  const fits = (size) => {
    const half = (probeWidth * size) / probe / 2;
    const drop = rise(size);
    return drop < clear && half <= Math.sqrt(clear * clear - drop * drop);
  };

  let size = Math.floor(d * 0.34);
  if (!fits(size)) {
    let lo = 6;
    let hi = size;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    size = Math.max(6, Math.floor(lo));
  }

  const style = styleAt(size);
  const capHeight = size * 0.72;
  const placed = await line(word, style, { cx, baseline: cy + capHeight / 2, align: 'center' });

  const corners = [
    [placed.box.x, placed.box.y],
    [placed.box.x + placed.box.w, placed.box.y],
    [placed.box.x, placed.box.y + placed.box.h],
    [placed.box.x + placed.box.w, placed.box.y + placed.box.h],
  ];
  const worst = Math.max(...corners.map(([px, py]) => Math.hypot(px - cx, py - cy)));

  const barW = d * SPEC.bar;
  const poly = barPolygon({ cx, cy, d });
  const coverage = redCoverage();

  // The bar is drawn last and clipped to the outer circle: an unclipped
  // rectangle of length d at 45° pushes its corners 0.5025d from the centre and
  // shows two nicks outside the ring.
  const defs = `<clipPath id="${id}-outer"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${outer.toFixed(2)}"/></clipPath>`;
  const draw =
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${outer.toFixed(2)}" fill="${red}"/>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${innerR.toFixed(2)}" fill="${ground}"/>` +
    placed.draw +
    `<g clip-path="url(#${id}-outer)">` +
    `<rect x="${(cx - outer).toFixed(2)}" y="${(cy - barW / 2).toFixed(2)}" width="${d.toFixed(2)}" height="${barW.toFixed(2)}" ` +
    `fill="${red}" transform="rotate(${SPEC.angle} ${cx.toFixed(2)} ${cy.toFixed(2)})"/></g>`;

  const near = (a, b) => Math.abs(a - b) < 1e-6;

  return {
    defs,
    draw,
    box: { x: cx - outer, y: cy - outer, w: d, h: d },
    bar: poly,
    wordBox: placed.box,
    wordSize: size,
    diameter: d,
    checks: [
      {
        name: 'sign geometry follows ISO 3864-1',
        ok: near((innerR * 2) / d, SPEC.inner) && near((outer - innerR) / d, SPEC.band) && near(barW / d, SPEC.bar) && SPEC.angle === 45,
        detail:
          `inner ${(innerR * 2 / d).toFixed(3)}d (spec ${SPEC.inner}), band ${((outer - innerR) / d).toFixed(3)}d ` +
          `(spec ${SPEC.band}), bar ${(barW / d).toFixed(3)}d at ${SPEC.angle}°`,
      },
      {
        name: 'red covers the standard’s minimum of the sign',
        ok: coverage >= SPEC.redFloor,
        detail: `red is ${(coverage * 100).toFixed(1)}% of the sign area, floor ${(SPEC.redFloor * 100).toFixed(0)}%`,
      },
      {
        name: `the prohibited word sits inside the sign`,
        ok: worst <= clear + 0.5,
        detail: `furthest corner ${worst.toFixed(0)}px from the centre, ground clear to ${clear.toFixed(0)}px`,
      },
      {
        name: 'the prohibited word is legible',
        ok: size >= legibleFloor,
        detail: `word set at ${size}px, floor ${legibleFloor.toFixed(0)}px`,
      },
      {
        // The point of the graphic. A sign whose bar misses the word it encloses
        // is a red ring with a stripe in it.
        name: 'the bar strikes the prohibited word',
        ok: barStrikes(poly, placed.box),
        detail: `bar at ${SPEC.angle}° across a ${placed.box.w.toFixed(0)}×${placed.box.h.toFixed(0)}px word`,
      },
    ],
  };
}
