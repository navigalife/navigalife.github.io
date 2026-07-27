// The "say no to" graphic: a general prohibition sign, built to ISO 3864-1.
//
// A hand-drawn ring with a stroke through it is not a prohibition sign; it is a
// decoration that resembles one, and it is what the first generation of these
// assets drew — a slash laid across an illustration of a foot, which read as a
// blade through the limb and inverted the message (review finding 4).
//
// So this module builds the real thing, from the standard's own proportions:
// inner ground 0.80 of the outer diameter, band and bar each 0.10 of it, the bar
// at exactly 45° descending left to right, and red over at least 35% of the
// sign's area. Every one of those is computed from what is actually drawn and
// reported as a check the build can fail on.
//
// It encloses nothing. ISO 3864-1's P001 is a complete sign with an empty
// ground — the general prohibition — and at the size this campaign uses it,
// beside the words rather than instead of them, anything inside it would be
// unreadable. What must never end up inside it is a limb: a prohibition sign
// drawn over a leg says legs are prohibited. `compose.mjs` enforces that as
// geometry — the bar is tested against every laid-out block on the page and the
// build fails if it reaches any of them.

/**
 * ISO 3864-1 general prohibition sign, as fractions of the outer diameter.
 *
 * `redFloor` is the standard's requirement that red cover at least 35% of the
 * area of the sign; the geometry above satisfies it at 36.2%, which is the
 * reason those ratios are 0.80 and 0.10 rather than anything else.
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
 * Separating-axis test over the four candidate axes — the block's two and the
 * bar's own two.
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
 * The sign.
 *
 * `floor` is the smallest diameter this format will accept. Subtle is the
 * brief; illegible is not, and a sign whose band lands under a pixel and a half
 * on a 300 dpi print file has stopped being a sign.
 */
export function prohibitionSign({ cx, cy, d, red, ground, floor = 0, id = 'sign' }) {
  const outer = d / 2;
  const innerR = (d * SPEC.inner) / 2;
  const barW = d * SPEC.bar;
  const coverage = redCoverage();

  // The bar is drawn last and clipped to the outer circle: an unclipped
  // rectangle of length d at 45° pushes its corners 0.5025d from the centre and
  // shows two nicks outside the ring.
  const defs = `<clipPath id="${id}-outer"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${outer.toFixed(2)}"/></clipPath>`;
  const draw =
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${outer.toFixed(2)}" fill="${red}"/>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${innerR.toFixed(2)}" fill="${ground}"/>` +
    `<g clip-path="url(#${id}-outer)">` +
    `<rect x="${(cx - outer).toFixed(2)}" y="${(cy - barW / 2).toFixed(2)}" width="${d.toFixed(2)}" height="${barW.toFixed(2)}" ` +
    `fill="${red}" transform="rotate(${SPEC.angle} ${cx.toFixed(2)} ${cy.toFixed(2)})"/></g>`;

  const near = (a, b) => Math.abs(a - b) < 1e-6;

  return {
    defs,
    draw,
    box: { x: cx - outer, y: cy - outer, w: d, h: d },
    bar: barPolygon({ cx, cy, d }),
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
        name: 'the sign is large enough to read as one',
        ok: d >= floor && barW >= 3,
        detail: `${d.toFixed(0)}px across (floor ${floor.toFixed(0)}px), band ${barW.toFixed(1)}px`,
      },
    ],
  };
}
