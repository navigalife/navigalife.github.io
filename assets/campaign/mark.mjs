// The brand mark as vector geometry.
//
// `assets/brand/mark-{ink,paper}.png` is a flat raster in one colour: fine for a
// tonal wash behind an editorial column, useless for a field that needs the
// atoms at one opacity and the bonds at another, or a node picked out in a
// second colour. The committed lockup SVG carries the mark as primitives — 21
// bonds as <line> and 19 atoms as <circle>, with the wordmark as <path> — so the
// mark is read out of the brand asset itself rather than transcribed here. A
// transcription would be a second copy of an owner-approved geometry, free to
// drift; this cannot drift, it can only fail loudly.

import fs from 'node:fs/promises';
import path from 'node:path';

// The owner-approved mark (tools/brand/mark.json in the advisor workspace,
// rendered into every committed lockup variant). If the brand file ever changes
// shape these numbers are the tripwire: a mark drawn from a partially-parsed
// file would look plausible and be wrong.
const EXPECT = { bonds: 21, atoms: 19 };

const SOURCE = 'assets/brand/logo_newfont/MediVasc-logo.svg';

let cached = null;

/** Parse the mark's primitives out of the committed lockup SVG. */
export async function loadMark(root) {
  if (cached) return cached;
  const svg = await fs.readFile(path.join(root, SOURCE), 'utf8');

  const num = (s) => Number.parseFloat(s);
  const bonds = [...svg.matchAll(/<line\s+x1="([-\d.]+)"\s+y1="([-\d.]+)"\s+x2="([-\d.]+)"\s+y2="([-\d.]+)"\s*\/>/g)]
    .map((m) => ({ x1: num(m[1]), y1: num(m[2]), x2: num(m[3]), y2: num(m[4]) }));
  const atoms = [...svg.matchAll(/<circle\s+cx="([-\d.]+)"\s+cy="([-\d.]+)"\s+r="([-\d.]+)"\s*\/>/g)]
    .map((m) => ({ cx: num(m[1]), cy: num(m[2]), r: num(m[3]) }));
  const strokeWidth = num(/<g\s+stroke="[^"]+"\s+stroke-width="([\d.]+)"/.exec(svg)?.[1] ?? '12');

  if (bonds.length !== EXPECT.bonds || atoms.length !== EXPECT.atoms) {
    throw new Error(
      `campaign: ${SOURCE} parsed as ${bonds.length} bonds / ${atoms.length} atoms, ` +
        `expected ${EXPECT.bonds} / ${EXPECT.atoms}. The mark geometry changed — check the file and update EXPECT.`,
    );
  }

  const x0 = Math.min(...atoms.map((a) => a.cx - a.r));
  const y0 = Math.min(...atoms.map((a) => a.cy - a.r));
  const x1 = Math.max(...atoms.map((a) => a.cx + a.r));
  const y1 = Math.max(...atoms.map((a) => a.cy + a.r));

  cached = { bonds, atoms, strokeWidth, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  return cached;
}

/**
 * Draw the mark at `width`, its top-left at (`x`, `y`).
 *
 * Atoms and bonds take separate opacities because that is the whole reason this
 * module exists: a background field wants the bonds to nearly vanish while the
 * nodes still read. `nodeGlow` adds a soft halo behind the larger atoms, which
 * is what stops an oversized flat mark from looking like a diagram.
 *
 * Returns the drawing and the placed bounding box, so a composer can keep type
 * out of the dense part of it and the verifier can be told where it is.
 */
export function markSvg(mark, { x, y, width, fill, atomOpacity = 1, bondOpacity = 1, nodeGlow = null, id = 'mk' }) {
  const s = width / mark.box.w;
  const height = mark.box.h * s;
  const tx = x - mark.box.x * s;
  const ty = y - mark.box.y * s;

  const defs = nodeGlow
    ? `<radialGradient id="${id}-glow">` +
      `<stop offset="0" stop-color="${nodeGlow.color}" stop-opacity="${nodeGlow.opacity}"/>` +
      `<stop offset=".55" stop-color="${nodeGlow.color}" stop-opacity="${(nodeGlow.opacity * 0.42).toFixed(3)}"/>` +
      `<stop offset="1" stop-color="${nodeGlow.color}" stop-opacity="0"/></radialGradient>`
    : '';

  const glows = nodeGlow
    ? mark.atoms
        .filter((a) => a.r >= 30)
        .map((a) => `<circle cx="${a.cx}" cy="${a.cy}" r="${(a.r * nodeGlow.spread).toFixed(1)}" fill="url(#${id}-glow)"/>`)
        .join('')
    : '';

  const body =
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(6)})">` +
    glows +
    `<g stroke="${fill}" stroke-width="${mark.strokeWidth}" stroke-linecap="round" opacity="${bondOpacity}">` +
    mark.bonds.map((b) => `<line x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}"/>`).join('') +
    `</g>` +
    `<g fill="${fill}" opacity="${atomOpacity}">` +
    mark.atoms.map((a) => `<circle cx="${a.cx}" cy="${a.cy}" r="${a.r}"/>`).join('') +
    `</g></g>`;

  return { defs, draw: body, box: { x, y, w: width, h: height } };
}
