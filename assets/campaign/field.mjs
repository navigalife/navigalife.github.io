// Background fields.
//
// A field is everything behind the type: the surface itself and whatever tonal
// graphic sits on it. Each one returns its drawing, the SVG defs it needs, and —
// the part that matters — the list of surfaces the type can actually land on.
// `verify.mjs` holds every foreground colour against every one of them, so a
// gradient is checked at both ends and a wash is checked at its densest point
// rather than at the paper colour it started from.
//
// Fields are drawn from geometry, never from a stock image: a raster behind a
// vector layout is the thing that made the first generation of these assets read
// as a template with a photo dropped in.

import { markSvg } from './mark.mjs';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const parse = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim());
  if (!m) throw new Error(`field: "${c}" is not a #rrggbb colour`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The flat colour of `fg` at `alpha` composited over `bg` — what the eye sees. */
export function over(fg, alpha, bg) {
  const a = parse(fg);
  const b = parse(bg);
  return `#${a.map((v, i) => hex(v * alpha + b[i] * (1 - alpha))).join('')}`;
}

/** Mix two opaque colours, `t` of the way from `a` to `b`. */
export function mix(a, b, t) {
  const x = parse(a);
  const y = parse(b);
  return `#${x.map((v, i) => hex(v + (y[i] - v) * t)).join('')}`;
}

// ---------------------------------------------------------------------------
// Ribbons
// ---------------------------------------------------------------------------

/**
 * A smooth open curve through sampled points, as one cubic path.
 *
 * Catmull-Rom converted to Bézier: sampling a sine into a polyline and stroking
 * it leaves visible facets on a 1783px print canvas, which is exactly the kind
 * of defect that survives a thumbnail check and shows up on paper.
 */
function smoothPath(points) {
  const d = [`M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d.push(`C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`);
  }
  return d.join('');
}

function ribbon(w, { yBase, amp, freq, phase, tilt }) {
  const points = [];
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = -w * 0.08 + t * w * 1.16;
    // A single sine reads as a graph; the second harmonic and the envelope are
    // what make the set look like drifting ribbons instead of a wave diagram.
    const envelope = 0.55 + 0.45 * Math.sin(Math.PI * t);
    const y =
      yBase +
      tilt * (t - 0.5) * w * 0.12 +
      amp * envelope * (Math.sin(2 * Math.PI * freq * t + phase) + 0.32 * Math.sin(4 * Math.PI * freq * t + phase * 1.7));
    points.push({ x, y });
  }
  return smoothPath(points);
}

// ---------------------------------------------------------------------------
// The fields
//
// Every field takes the format, the treatment's palette, the parsed mark, and
// `focus` — the centre of the claim block, known only once the layout is solved.
// A field that ignores focus is free to; the halo is built around it.
// ---------------------------------------------------------------------------

/**
 * A dark violet field lit from behind the claim, with one luminous ring.
 *
 * The ring is drawn as a filled annulus in a radial gradient rather than a
 * stroked circle under a blur: librsvg's filter support is not something to bet
 * a print file on, and stops give exact control of where the light falls off.
 */
function halo({ fmt, colour, focus }) {
  const { w, h } = fmt;
  const c = colour;
  const r = focus.radius;
  const cx = focus.cx;
  const cy = focus.cy;

  const defs =
    `<radialGradient id="halo-bg" cx="0.5" cy="${(cy / h).toFixed(3)}" r="0.92">` +
    `<stop offset="0" stop-color="${c.fieldTop}"/>` +
    `<stop offset=".52" stop-color="${c.fieldMid}"/>` +
    `<stop offset="1" stop-color="${c.fieldEdge}"/></radialGradient>` +
    `<radialGradient id="halo-ring">` +
    `<stop offset="0" stop-color="${c.glow}" stop-opacity="0"/>` +
    `<stop offset=".855" stop-color="${c.glow}" stop-opacity="0"/>` +
    `<stop offset=".915" stop-color="${c.glow}" stop-opacity=".55"/>` +
    `<stop offset=".955" stop-color="${c.glow}" stop-opacity=".16"/>` +
    `<stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="halo-arc" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${c.glowHot}" stop-opacity=".95"/>` +
    `<stop offset=".42" stop-color="${c.glow}" stop-opacity=".38"/>` +
    `<stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></linearGradient>` +
    // The ring is a rim light, not an outline. Left as a full circle it draws
    // straight through the process row and around the wordmark — even,
    // deliberate-looking, and wrong. So it is lit only between the two
    // registers that bracket the claim: the layout hands over the band between
    // the bottom of the lockup and the top of whatever follows the support, and
    // the ring exists inside that band and nowhere else. A layout that does not
    // supply one (the header, where the ring is cropped to a sweep) falls back
    // to the ring's own bounding box.
    `<linearGradient id="halo-fade" gradientUnits="userSpaceOnUse" ` +
    `x1="0" y1="${(focus.lightFrom ?? cy - r).toFixed(2)}" x2="0" y2="${(focus.lightTo ?? cy + r).toFixed(2)}">` +
    `<stop offset="0" stop-color="#000"/><stop offset=".13" stop-color="#B4B4B4"/>` +
    `<stop offset=".42" stop-color="#fff"/><stop offset=".76" stop-color="#7E7E7E"/>` +
    `<stop offset=".93" stop-color="#141414"/><stop offset="1" stop-color="#000"/></linearGradient>` +
    `<mask id="halo-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="url(#halo-fade)"/></mask>`;

  const draw =
    `<rect width="${w}" height="${h}" fill="url(#halo-bg)"/>` +
    `<g mask="url(#halo-mask)">` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(r * 1.16).toFixed(2)}" fill="url(#halo-ring)"/>` +
    `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="none" ` +
    `stroke="url(#halo-arc)" stroke-width="${Math.max(1.6, fmt.w * 0.0022).toFixed(2)}"/></g>`;

  return {
    defs,
    draw,
    // The ring's bright band is a surface in its own right; the type inside it
    // sits on the interior, which runs from the lit centre to the edge tone.
    surfaces: [
      { name: 'field centre', color: c.fieldTop },
      { name: 'field mid', color: c.fieldMid },
      { name: 'field edge', color: c.fieldEdge },
    ],
    // Type must stay inside the ring, not cross it.
    ring: { cx, cy, r },
  };
}

/**
 * Paper, with the mark oversized and bled off the right edge.
 *
 * The atoms carry the wash and the bonds nearly vanish, so it reads as a tonal
 * field rather than a diagram of a molecule pasted next to some text.
 */
function lattice({ fmt, colour, mark }) {
  const { w, h } = fmt;
  const c = colour;
  const landscape = fmt.layout === 'landscape';
  // The mark is placed so its dense middle falls to the right of the text
  // column and below (or above) the strips that run the full measure. On a 3:1
  // header there is no height to place it in, so it bleeds off the top instead.
  const width = w * (landscape ? 0.34 : 0.80);
  const height = (mark.box.h / mark.box.w) * width;
  const x = w * (landscape ? 0.64 : 0.66);
  const y = landscape ? -height * 0.52 : h * 0.42 - height * 0.5;

  const placed = markSvg(mark, {
    x,
    y,
    width,
    fill: c.purple,
    atomOpacity: 0.17,
    bondOpacity: 0.085,
    nodeGlow: { color: c.purple, opacity: 0.13, spread: 2.4 },
    id: 'lattice',
  });

  return {
    defs: placed.defs,
    draw: `<rect width="${w}" height="${h}" fill="${c.paper}"/>` + placed.draw,
    surfaces: [
      { name: 'paper', color: c.paper },
      // The densest point type could reach: an atom's flat wash with its glow
      // stacked under it.
      { name: 'lattice wash', color: over(c.purple, 0.17 + 0.13, c.paper) },
    ],
    keepOut: { name: 'lattice mark', rect: { x: x + width * 0.10, y: y + height * 0.10, w: width * 0.8, h: height * 0.8 } },
  };
}

/** A deep purple field, lit from the top, with the mark ghosted into a corner. */
function royal({ fmt, colour, mark }) {
  const { w, h } = fmt;
  const c = colour;
  // Barely there, and mostly off the canvas: at any more than this the atoms
  // stop reading as structure under the field and start reading as blemishes
  // behind the process row.
  const width = w * 0.86;
  const x = -width * 0.46;
  const height = (mark.box.h / mark.box.w) * width;
  const placed = markSvg(mark, {
    x,
    y: h - height * 0.58,
    width,
    fill: '#FFFFFF',
    atomOpacity: 0.038,
    bondOpacity: 0.022,
    id: 'royal',
  });

  const defs =
    `<linearGradient id="royal-bg" x1="0" y1="0" x2=".55" y2="1">` +
    `<stop offset="0" stop-color="${c.fieldTop}"/>` +
    `<stop offset=".54" stop-color="${c.fieldMid}"/>` +
    `<stop offset="1" stop-color="${c.fieldEdge}"/></linearGradient>` +
    `<radialGradient id="royal-lift" cx=".5" cy="0" r=".9">` +
    `<stop offset="0" stop-color="${c.glow}" stop-opacity=".34"/>` +
    `<stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>`;

  return {
    defs,
    draw:
      `<rect width="${w}" height="${h}" fill="url(#royal-bg)"/>` +
      `<rect width="${w}" height="${h}" fill="url(#royal-lift)"/>` +
      placed.draw,
    surfaces: [
      { name: 'field top', color: mix(c.fieldTop, c.glow, 0.34) },
      { name: 'field mid', color: c.fieldMid },
      { name: 'field edge', color: c.fieldEdge },
    ],
  };
}

/** Paper, with a drift of purple ribbons across the lower band. */
function aurora({ fmt, colour }) {
  const { w, h } = fmt;
  const c = colour;
  // The ribbons are a flourish at the foot of the page, not a texture across
  // it: spread over the whole canvas they pass through the process row and read
  // as a printing fault. Kept low and close, they read as one moving field.
  const band = fmt.layout === 'landscape' ? h * 1.02 : h * 0.955;
  const spread = fmt.layout === 'landscape' ? h * 0.46 : h * 0.15;

  const defs =
    `<linearGradient id="aurora-a" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${c.ribbonCool}" stop-opacity="0"/>` +
    `<stop offset=".3" stop-color="${c.ribbonCool}" stop-opacity="1"/>` +
    `<stop offset=".72" stop-color="${c.ribbonWarm}" stop-opacity="1"/>` +
    `<stop offset="1" stop-color="${c.ribbonWarm}" stop-opacity="0"/></linearGradient>`;

  const ribbons = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    ribbons.push(
      `<path d="${ribbon(w, {
        yBase: band + (t - 0.5) * spread,
        amp: h * 0.020 * (0.6 + t * 0.9),
        freq: 0.85 + t * 0.3,
        phase: t * 2.1,
        tilt: -0.42 + t * 0.3,
      })}" fill="none" stroke="url(#aurora-a)" stroke-width="${(w * (0.016 + t * 0.026)).toFixed(2)}" ` +
        `stroke-opacity="${(0.13 + t * 0.085).toFixed(3)}" stroke-linecap="round"/>`,
    );
  }

  return {
    defs,
    draw: `<rect width="${w}" height="${h}" fill="${c.paper}"/>` + ribbons.join(''),
    surfaces: [
      { name: 'paper', color: c.paper },
      // Two ribbons can cross under the footer; the wash is checked at roughly
      // twice a single ribbon's weight.
      { name: 'ribbon wash', color: over(c.ribbonWarm, 0.30, c.paper) },
    ],
  };
}

const FIELDS = { halo, lattice, royal, aurora };

export function buildField(name, ctx) {
  const field = FIELDS[name];
  if (!field) throw new Error(`field: no field named "${name}"`);
  return field(ctx);
}
