// Measured text layout for the campaign renderer.
//
// The previous generation of these assets hand-broke every line into `<tspan>`
// elements with literal spaces at the run boundaries. SVG collapses that
// whitespace, which is how "the only way out" shipped as "theonly way out" on
// all six files. Nothing here relies on whitespace surviving: every word is
// measured and then positioned at an absolute x, so a run boundary cannot eat a
// space, and a line that would overflow its column is detected rather than
// clipped.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const FAMILIES = {
  sans: { name: 'Instrument Sans', file: 'instrument-sans-latin-400-600.woff2', weight: '400 600', style: 'normal' },
  serif: { name: 'Fraunces', file: 'fraunces-latin-600.woff2', weight: '600', style: 'normal' },
  serifItalic: { name: 'Fraunces', file: 'fraunces-latin-600-italic.woff2', weight: '600', style: 'italic' },
};

let fontCss = null;

export async function loadFonts(root) {
  if (fontCss) return fontCss;
  const faces = await Promise.all(
    Object.values(FAMILIES).map(async (f) => {
      const data = await fs.readFile(path.join(root, 'assets/fonts', f.file));
      return `@font-face{font-family:'${f.name}';src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');font-weight:${f.weight};font-style:${f.style};}`;
    }),
  );
  fontCss = faces.join('');
  return fontCss;
}

export const fontFamily = (family) => `'${FAMILIES[family].name}', ${family === 'sans' ? 'sans-serif' : 'serif'}`;
export const fontStyle = (family) => (family === 'serifItalic' ? 'italic' : 'normal');
export const fontWeightOf = (family, weight) => weight ?? (family === 'sans' ? 400 : 600);

export const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const cache = new Map();

/**
 * Ink width of a rendered string, in px.
 *
 * Measured by rasterising and scanning the alpha channel, because librsvg gives
 * us no text metrics API. Callers should use `advance()` rather than this —
 * ink width drops side bearings and trailing spaces entirely.
 */
async function inkWidth(text, style) {
  const size = style.size;
  const probeW = Math.ceil(text.length * size * 1.6 + size * 4 + 200);
  const probeH = Math.ceil(size * 3);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${probeW}" height="${probeH}">` +
      `<defs><style>${fontCss}</style></defs>` +
      `<text x="${size}" y="${size * 2}" font-family="${fontFamily(style.family)}" font-size="${size}" ` +
      `font-weight="${fontWeightOf(style.family, style.weight)}" font-style="${fontStyle(style.family)}" ` +
      `letter-spacing="${style.tracking ?? 0}" fill="#000">${escapeXml(text)}</text></svg>`,
  );
  const { data, info } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let min = Infinity;
  let max = -1;
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width * info.channels;
    for (let x = 0; x < info.width; x++) {
      if (data[row + x * info.channels + 3] > 8) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  return max < 0 ? 0 : max - min + 1;
}

const key = (text, style) =>
  `${style.family}|${style.size}|${style.weight ?? ''}|${style.tracking ?? 0}|${text}`;

/**
 * Advance width of `text`, including leading/trailing spaces.
 *
 * Bracketing the string in sentinel bars makes the side bearings cancel, which
 * turns an ink measurement into a usable advance.
 */
export async function advance(text, style) {
  if (text === '') return 0;
  const k = key(text, style);
  if (cache.has(k)) return cache.get(k);
  const [withText, bare] = await Promise.all([inkWidth(`|${text}|`, style), inkWidth('||', style)]);
  const value = Math.max(0, withText - bare);
  cache.set(k, value);
  return value;
}

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap styled runs into lines that fit `maxWidth`.
 *
 * `runs` is `[{ text, family?, fill?, weight? }]`. The run's own family/fill
 * override the block style, which is what lets a single italic accent word sit
 * inside an otherwise roman headline without a manual line break.
 *
 * Returns `[{ words: [{ text, x, family, fill, weight }], width }]`.
 */
export async function wrapRuns(runs, maxWidth, style) {
  const tokens = [];
  for (const run of runs) {
    const runStyle = { ...style, family: run.family ?? style.family, weight: run.weight ?? style.weight };
    for (const word of String(run.text).split(/\s+/).filter(Boolean)) {
      tokens.push({ text: word, fill: run.fill ?? style.fill, style: runStyle, family: runStyle.family, weight: runStyle.weight });
    }
  }

  await Promise.all(tokens.map(async (t) => { t.width = await advance(t.text, t.style); }));
  const spaceWidth = await advance(' ', style);

  const lines = [];
  let current = [];
  let x = 0;
  for (const token of tokens) {
    const gap = current.length ? spaceWidth : 0;
    if (current.length && x + gap + token.width > maxWidth) {
      lines.push({ words: current, width: x });
      current = [];
      x = 0;
    }
    const at = current.length ? x + spaceWidth : 0;
    current.push({ ...token, x: at });
    x = at + token.width;
  }
  if (current.length) lines.push({ words: current, width: x });
  return lines;
}

/** Wrap a plain string. */
export const wrap = (text, maxWidth, style) => wrapRuns([{ text }], maxWidth, style);

/**
 * Wrap runs at the largest size at or below `style.size` that keeps every word
 * inside the column.
 *
 * Wrapping cannot break inside a word, so a column narrower than the longest
 * word silently produces an overflowing line. Shrinking is bounded: past
 * `minScale` the layout is wrong in a way a smaller type size should not paper
 * over, and the caller gets an overflowing block that verification will reject.
 */
export async function fitRuns(runs, maxWidth, style, { minScale = 0.8, step = 2 } = {}) {
  const floor = Math.max(1, Math.round(style.size * minScale));
  for (let size = style.size; size >= floor; size -= step) {
    const scaled = { ...style, size, tracking: (style.tracking ?? 0) * (size / style.size) };
    const lines = await wrapRuns(runs, maxWidth, scaled);
    if (lines.every((l) => l.width <= maxWidth)) return { lines, style: scaled };
  }
  const scaled = { ...style, size: floor, tracking: (style.tracking ?? 0) * (floor / style.size) };
  return { lines: await wrapRuns(runs, maxWidth, scaled), style: scaled };
}

// Words that should not be left dangling at the end of a line: an ampersand or
// a short function word at a line break reads as a typo, and "&" is the worst
// of them. Purely a ranking signal — a break is penalised, never forbidden.
const WEAK_LINE_END = new Set(['&', 'and', 'or', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'not']);

/**
 * Fit, then choose the best line breaks.
 *
 * Greedy wrapping packs early lines full and strands whatever is left on the
 * last one — "Prevent foot & leg / amputation". Re-wrapping at a narrower width
 * yields a different set of breaks at no vertical cost, so every width that
 * still produces the same number of lines is a candidate and they are scored:
 * evenness of line length, plus a penalty for ending a line on a weak word.
 *
 * Scoring rather than simply taking the narrowest matters — the narrowest wrap
 * of "Prevent foot & leg amputation" is the perfectly even "Prevent foot & /
 * leg amputation", which hangs an ampersand off the line end.
 */
export async function balanceRuns(runs, maxWidth, style, opts) {
  const { lines, style: fitted } = await fitRuns(runs, maxWidth, style, opts);
  if (lines.length < 2) return { lines, style: fitted };

  const penalty = maxWidth * 0.75;
  const score = (candidate) => {
    const widths = candidate.map((l) => l.width);
    let value = Math.max(...widths) - Math.min(...widths);
    for (const line of candidate.slice(0, -1)) {
      const last = line.words[line.words.length - 1];
      if (last && WEAK_LINE_END.has(last.text.toLowerCase())) value += penalty;
    }
    return value;
  };

  let best = lines;
  let bestScore = score(lines);
  const step = maxWidth * 0.015;
  for (let width = maxWidth - step; width >= maxWidth * 0.6; width -= step) {
    const candidate = await wrapRuns(runs, width, fitted);
    if (candidate.length !== lines.length) break;
    const value = score(candidate);
    if (value < bestScore) {
      best = candidate;
      bestScore = value;
    }
  }
  return { lines: best, style: fitted };
}

/**
 * Emit an SVG `<text>` block for wrapped lines whose origin is the first
 * baseline. Every word carries its own absolute `x`, so no whitespace is load
 * bearing.
 */
export function renderLines(lines, { x, baseline, lineHeight, style, align = 'left' }) {
  const family = fontFamily(style.family);
  const parts = lines.map((line, i) => {
    const offset = align === 'center' ? -line.width / 2 : align === 'right' ? -line.width : 0;
    const y = baseline + i * lineHeight;
    const spans = line.words
      .map((w) => {
        const attrs = [
          `x="${(x + offset + w.x).toFixed(2)}"`,
          `y="${y.toFixed(2)}"`,
          w.family !== style.family ? `font-family="${fontFamily(w.family)}" font-style="${fontStyle(w.family)}"` : '',
          w.family !== style.family ? `font-weight="${fontWeightOf(w.family, w.weight)}"` : '',
          w.fill !== style.fill ? `fill="${w.fill}"` : '',
        ].filter(Boolean);
        return `<tspan ${attrs.join(' ')}>${escapeXml(w.text)}</tspan>`;
      })
      .join('');
    return spans;
  });

  return (
    `<text font-family="${family}" font-size="${style.size}" font-weight="${fontWeightOf(style.family, style.weight)}" ` +
    `font-style="${fontStyle(style.family)}" letter-spacing="${style.tracking ?? 0}" fill="${style.fill}" ` +
    `xml:space="preserve">${parts.join('')}</text>`
  );
}

/** Bounding box of a rendered block, used by the layout verifier. */
export function blockBox(lines, { x, baseline, lineHeight, style, align = 'left' }) {
  const width = Math.max(0, ...lines.map((l) => l.width));
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  // Ascent/descent estimates: generous enough that the verifier errs toward
  // reporting a collision rather than missing one.
  const top = baseline - style.size * 0.82;
  const bottom = baseline + (lines.length - 1) * lineHeight + style.size * 0.26;
  return { x: left, y: top, w: width, h: bottom - top };
}

export const blockHeight = (lines, lineHeight, style) =>
  (lines.length - 1) * lineHeight + style.size * 1.08;
