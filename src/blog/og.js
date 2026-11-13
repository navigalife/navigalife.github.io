// Blog share cards (og:image) — one 1200x630 PNG per post, rendered at build time.
//
// Why the type is drawn as SVG paths instead of with sharp's `text` input: on macOS
// sharp's Pango uses CoreText and ignores `fontfile`, so a Mac build would silently
// set the title in a fallback sans while CI set it in Fraunces. Reading the glyph
// outlines straight out of the OFL fonts in tools/fonts/ (a small TrueType reader
// below: cmap, hmtx, glyf incl. composites, GPOS pair kerning) makes the card
// byte-for-byte the same on every machine and gives exact text metrics for free.
//
// The generator verifies its own layout (AGENTS Lesson 24): every line is measured
// before it is placed, the title shrinks/rebalances until it fits its box, and the
// rendered title layer is scanned pixel by pixel against that box. Anything that
// still does not fit throws — a clipped card never ships. A title with characters
// the fonts cannot draw (e.g. Devanagari) returns null, so the page falls back to
// the site's default share image instead of showing tofu.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const FONT_DIR = path.join(__dirname, '..', '..', 'tools', 'fonts');
const W = 1200;
const H = 630;

// ---------------------------------------------------------------------------
// Minimal TrueType reader (static, glyf-flavoured fonts only — tools/fonts/*.ttf)
// ---------------------------------------------------------------------------
const readFont = (file) => {
  const buf = fs.readFileSync(file);
  const u8 = (o) => buf.readUInt8(o);
  const i8 = (o) => buf.readInt8(o);
  const u16 = (o) => buf.readUInt16BE(o);
  const i16 = (o) => buf.readInt16BE(o);
  const u32 = (o) => buf.readUInt32BE(o);
  const f2 = (o) => i16(o) / 16384;

  const tables = {};
  for (let i = 0, n = u16(4); i < n; i += 1) {
    const rec = 12 + i * 16;
    tables[buf.toString('latin1', rec, rec + 4)] = u32(rec + 8);
  }
  for (const tag of ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'loca', 'glyf']) {
    if (tables[tag] === undefined) throw new Error(`og: ${path.basename(file)} has no ${tag} table`);
  }
  const unitsPerEm = u16(tables.head + 18);
  const longLoca = i16(tables.head + 50) === 1;
  const numGlyphs = u16(tables.maxp + 4);
  const numHMetrics = u16(tables.hhea + 34);
  const capHeight = tables['OS/2'] !== undefined && u16(tables['OS/2']) >= 2 ? i16(tables['OS/2'] + 88) : unitsPerEm * 0.7;

  // cmap: Windows Unicode BMP (format 4) or full repertoire (format 12).
  let lookupCmap = () => 0;
  {
    const base = tables.cmap;
    let best = null;
    for (let i = 0, n = u16(base + 2); i < n; i += 1) {
      const rec = base + 4 + i * 8;
      const pid = u16(rec);
      const eid = u16(rec + 2);
      const off = base + u32(rec + 4);
      const format = u16(off);
      const score = format === 12 ? 3 : format === 4 && (pid === 3 || pid === 0) ? 2 : 0;
      if (score && (!best || score > best.score)) best = { off, format, score, pid, eid };
    }
    if (!best) throw new Error(`og: ${path.basename(file)} has no usable cmap`);
    const { off } = best;
    if (best.format === 12) {
      const groups = u32(off + 12);
      lookupCmap = (cp) => {
        for (let g = 0; g < groups; g += 1) {
          const at = off + 16 + g * 12;
          if (cp >= u32(at) && cp <= u32(at + 4)) return u32(at + 8) + (cp - u32(at));
        }
        return 0;
      };
    } else {
      const segX2 = u16(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      lookupCmap = (cp) => {
        if (cp > 0xffff) return 0;
        for (let s = 0; s < segX2; s += 2) {
          if (cp > u16(ends + s)) continue;
          const start = u16(starts + s);
          if (cp < start) return 0;
          const delta = i16(deltas + s);
          const ro = u16(ranges + s);
          if (!ro) return (cp + delta) & 0xffff;
          const g = u16(ranges + s + ro + (cp - start) * 2);
          return g ? (g + delta) & 0xffff : 0;
        }
        return 0;
      };
    }
  }

  const advance = (gid) => u16(tables.hmtx + 4 * Math.min(gid, numHMetrics - 1));
  const glyphRange = (gid) => {
    if (gid >= numGlyphs) return [0, 0];
    const at = longLoca ? [u32(tables.loca + gid * 4), u32(tables.loca + gid * 4 + 4)]
      : [u16(tables.loca + gid * 2) * 2, u16(tables.loca + gid * 2 + 2) * 2];
    return at;
  };

  // Glyph outline → contours of { x, y, on } in font units (y up).
  const outlineCache = new Map();
  const outline = (gid, depth = 0) => {
    if (outlineCache.has(gid)) return outlineCache.get(gid);
    if (depth > 8) throw new Error('og: composite glyph nesting too deep');
    const [start, end] = glyphRange(gid);
    let contours = [];
    if (end > start) {
      const g = tables.glyf + start;
      const nContours = i16(g);
      if (nContours >= 0) {
        const endPts = [];
        for (let c = 0; c < nContours; c += 1) endPts.push(u16(g + 10 + c * 2));
        const nPts = nContours ? endPts[nContours - 1] + 1 : 0;
        let p = g + 10 + nContours * 2;
        p += 2 + u16(p); // instructions
        const flags = [];
        while (flags.length < nPts) {
          const flag = u8(p++);
          flags.push(flag);
          if (flag & 8) {
            for (let r = u8(p++); r > 0; r -= 1) flags.push(flag);
          }
        }
        const xs = [];
        let x = 0;
        for (const flag of flags) {
          if (flag & 2) { const d = u8(p++); x += flag & 16 ? d : -d; } else if (!(flag & 16)) { x += i16(p); p += 2; }
          xs.push(x);
        }
        const ys = [];
        let y = 0;
        for (const flag of flags) {
          if (flag & 4) { const d = u8(p++); y += flag & 32 ? d : -d; } else if (!(flag & 32)) { y += i16(p); p += 2; }
          ys.push(y);
        }
        let first = 0;
        for (const last of endPts) {
          const contour = [];
          for (let k = first; k <= last; k += 1) contour.push({ x: xs[k], y: ys[k], on: Boolean(flags[k] & 1) });
          if (contour.length) contours.push(contour);
          first = last + 1;
        }
      } else {
        let p = g + 10;
        let flags;
        do {
          flags = u16(p);
          const component = u16(p + 2);
          p += 4;
          let dx;
          let dy;
          if (flags & 1) { dx = i16(p); dy = i16(p + 2); p += 4; } else { dx = i8(p); dy = i8(p + 1); p += 2; }
          if (!(flags & 2)) { dx = 0; dy = 0; } // point-matched anchoring: not used by these fonts
          let [a, b, c, d] = [1, 0, 0, 1];
          if (flags & 8) { a = f2(p); d = a; p += 2; } else if (flags & 0x40) { a = f2(p); d = f2(p + 2); p += 4; } else if (flags & 0x80) { a = f2(p); b = f2(p + 2); c = f2(p + 4); d = f2(p + 6); p += 8; }
          for (const contour of outline(component, depth + 1)) {
            contours.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
          }
        } while (flags & 0x20);
      }
    }
    outlineCache.set(gid, contours);
    return contours;
  };

  // GPOS pair kerning ('kern' feature lookups, PairPos format 1 and 2, via Extension too).
  const kernSubtables = [];
  if (tables.GPOS !== undefined) {
    const gpos = tables.GPOS;
    const featureList = gpos + u16(gpos + 6);
    const lookupList = gpos + u16(gpos + 8);
    const lookupIds = new Set();
    for (let i = 0, n = u16(featureList); i < n; i += 1) {
      const rec = featureList + 2 + i * 6;
      if (buf.toString('latin1', rec, rec + 4) !== 'kern') continue;
      const feature = featureList + u16(rec + 4);
      for (let k = 0, m = u16(feature + 2); k < m; k += 1) lookupIds.add(u16(feature + 4 + k * 2));
    }
    for (const id of [...lookupIds].sort((a, b) => a - b)) {
      const lookup = lookupList + u16(lookupList + 2 + id * 2);
      const type = u16(lookup);
      const subs = [];
      for (let s = 0, n = u16(lookup + 4); s < n; s += 1) {
        let sub = lookup + u16(lookup + 6 + s * 2);
        let subType = type;
        if (type === 9) { subType = u16(sub + 2); sub += u32(sub + 4); }
        if (subType === 2) subs.push(sub);
      }
      if (subs.length) kernSubtables.push(subs);
    }
  }
  const coverageIndex = (cov, gid) => {
    const format = u16(cov);
    if (format === 1) {
      let lo = 0;
      let hi = u16(cov + 2) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = u16(cov + 4 + mid * 2);
        if (g === gid) return mid;
        if (g < gid) lo = mid + 1; else hi = mid - 1;
      }
      return -1;
    }
    for (let r = 0, n = u16(cov + 2); r < n; r += 1) {
      const at = cov + 4 + r * 6;
      if (gid >= u16(at) && gid <= u16(at + 2)) return u16(at + 4) + gid - u16(at);
    }
    return -1;
  };
  const classOf = (cd, gid) => {
    const format = u16(cd);
    if (format === 1) {
      const first = u16(cd + 2);
      return gid >= first && gid < first + u16(cd + 4) ? u16(cd + 6 + (gid - first) * 2) : 0;
    }
    for (let r = 0, n = u16(cd + 2); r < n; r += 1) {
      const at = cd + 4 + r * 6;
      if (gid >= u16(at) && gid <= u16(at + 2)) return u16(at + 4);
    }
    return 0;
  };
  const bits = (v) => { let c = 0; for (let x = v; x; x >>= 1) c += x & 1; return c; };
  const xAdvanceOf = (record, vf) => (vf & 4 ? i16(record + 2 * bits(vf & 3)) : 0);
  const kernCache = new Map();
  const kern = (left, right) => {
    const key = left * 65536 + right;
    if (kernCache.has(key)) return kernCache.get(key);
    let total = 0;
    for (const subs of kernSubtables) {
      for (const sub of subs) {
        const ci = coverageIndex(sub + u16(sub + 2), left);
        if (ci < 0) continue;
        const vf1 = u16(sub + 4);
        const vf2 = u16(sub + 6);
        const size = 2 * (bits(vf1) + bits(vf2));
        if (u16(sub) === 1) {
          const set = sub + u16(sub + 10 + ci * 2);
          let hit = -1;
          for (let k = 0, n = u16(set); k < n; k += 1) {
            if (u16(set + 2 + k * (2 + size)) === right) { hit = set + 2 + k * (2 + size) + 2; break; }
          }
          if (hit < 0) continue; // format 1: a missing pair lets the next subtable try
          total += xAdvanceOf(hit, vf1);
          break;
        }
        const c1 = classOf(sub + u16(sub + 8), left);
        const c2 = classOf(sub + u16(sub + 10), right);
        const class2Count = u16(sub + 14);
        total += xAdvanceOf(sub + 16 + (c1 * class2Count + c2) * size, vf1);
        break;
      }
    }
    kernCache.set(key, total);
    return total;
  };

  return { unitsPerEm, capHeight, glyph: lookupCmap, advance, outline, kern };
};

let FACES = null;
const faces = () => {
  if (!FACES) {
    FACES = {
      display: readFont(path.join(FONT_DIR, 'mv-fraunces-72-600.ttf')),
      italic: readFont(path.join(FONT_DIR, 'mv-fraunces-72-600-italic.ttf')),
      label: readFont(path.join(FONT_DIR, 'mv-instrument-sans-600.ttf')),
    };
  }
  return FACES;
};

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------
// A run = consecutive characters in one face/colour. Shaping = cmap + advances +
// pair kerning within a run + uniform tracking; ink bounds come from the outlines.
const shapeRun = (font, text, size, tracking = 0) => {
  const scale = size / font.unitsPerEm;
  const glyphs = [];
  let x = 0;
  let prev = null;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const gid = font.glyph(cp) || (cp === 0xa0 ? font.glyph(0x20) : 0);
    if (prev !== null) x += font.kern(prev, gid) * scale;
    glyphs.push({ gid, x });
    x += font.advance(gid) * scale + tracking * size;
    prev = gid;
  }
  if (glyphs.length) x -= tracking * size; // no tracking after the last glyph
  return { glyphs, width: x, scale };
};

const missingGlyphs = (font, text) => [...text].filter((ch) => !/\s/.test(ch) && font.glyph(ch.codePointAt(0)) === 0);

// SVG path data for a shaped run whose origin (baseline-left) is (ox, oy); also
// returns the exact ink box of the outlines (on-curve + control points).
const runPath = (font, run, ox, oy) => {
  const parts = [];
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const r = (v) => Math.round(v * 100) / 100;
  for (const { gid, x } of run.glyphs) {
    for (const contour of font.outline(gid)) {
      const pts = contour.map((pt) => ({ x: ox + x + pt.x * run.scale, y: oy - pt.y * run.scale, on: pt.on }));
      for (const pt of pts) {
        box.x0 = Math.min(box.x0, pt.x); box.x1 = Math.max(box.x1, pt.x);
        box.y0 = Math.min(box.y0, pt.y); box.y1 = Math.max(box.y1, pt.y);
      }
      // TrueType quadratic contour → SVG: consecutive off-curve points imply an
      // on-curve midpoint; a contour with no on-curve point starts at one.
      const n = pts.length;
      const firstOn = pts.findIndex((pt) => pt.on);
      const start = firstOn >= 0 ? pts[firstOn]
        : { x: (pts[0].x + pts[n - 1].x) / 2, y: (pts[0].y + pts[n - 1].y) / 2, on: true };
      const rest = firstOn >= 0
        ? Array.from({ length: n - 1 }, (_, k) => pts[(firstOn + 1 + k) % n])
        : pts;
      let d = `M${r(start.x)} ${r(start.y)}`;
      let ctrl = null;
      for (const pt of [...rest, start]) {
        if (pt.on) {
          d += ctrl ? `Q${r(ctrl.x)} ${r(ctrl.y)} ${r(pt.x)} ${r(pt.y)}` : `L${r(pt.x)} ${r(pt.y)}`;
          ctrl = null;
        } else if (ctrl) {
          d += `Q${r(ctrl.x)} ${r(ctrl.y)} ${r((ctrl.x + pt.x) / 2)} ${r((ctrl.y + pt.y) / 2)}`;
          ctrl = pt;
        } else {
          ctrl = pt;
        }
      }
      parts.push(`${d}Z`);
    }
  }
  return { d: parts.join(''), box };
};

// Typographic quotes/dashes for the card only (the page title stays as typed).
const smarten = (text) => String(text || '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/(\w)'(\w)/g, '$1’$2')
  .replace(/'(?=\w)/g, '‘')
  .replace(/'/g, '’')
  .replace(/"(?=\w)/g, '“')
  .replace(/"/g, '”')
  .replace(/ - /g, ' – ')
  .replace(/\.\.\./g, '…');

// Title → words, each a list of styled segments ({ text, italic }). The accent
// phrase (post.titleAccent, a whole-word phrase) is set in the accent italic.
const titleWords = (rawTitle, accent) => {
  // A spaced dash stays with the word before it (never starts a line).
  const title = rawTitle.replace(/ ([\u2013\u2014])/g, '\u00A0$1');
  const chars = [...title];
  const italic = new Array(chars.length).fill(false);
  const phrase = smarten(accent).replace(/ ([\u2013\u2014])/g, '\u00A0$1');
  if (phrase) {
    const lower = title.toLowerCase();
    const needle = phrase.toLowerCase();
    let at = -1;
    for (let from = 0; (at = lower.indexOf(needle, from)) >= 0; from = at + 1) {
      const before = at === 0 ? ' ' : lower[at - 1];
      const after = lower[at + needle.length] || ' ';
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) break;
    }
    if (at >= 0) {
      // indexOf works on UTF-16 units; titles are BMP text, so units == chars here.
      for (let k = at; k < at + needle.length; k += 1) italic[k] = true;
    }
  }
  const words = [];
  let word = [];
  chars.forEach((ch, k) => {
    if (ch === ' ') {
      if (word.length) words.push(word);
      word = [];
      return;
    }
    const last = word[word.length - 1];
    if (last && last.italic === italic[k]) last.text += ch; else word.push({ text: ch, italic: italic[k] });
  });
  if (word.length) words.push(word);
  return words;
};

// Words that read badly at the end of a display line.
const WEAK_END = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'at', 'by', 'with', 'your', 'my', 'our', 'is', 'are', 'when', 'what', 'how', 'why', 'if', 'but', 'from', 'as', 'that', 'this']);

const plainWord = (word) => word.map((s) => s.text).join('');

// Lay out the title at `size` inside `maxWidth`: minimal line count (greedy), then
// a balanced break (CSS text-wrap: balance, plus no orphan and no weak line-ends).
// Returns null when a single word is wider than the box.
const layoutTitle = (words, size, maxWidth, tracking) => {
  const { display, italic } = faces();
  const fontOf = (seg) => (seg.italic ? italic : display);
  // Letter-spacing applies after every character, the space included (as in CSS).
  const track = tracking * size;
  const space = shapeRun(display, ' ', size).width + 2 * track;
  const lineCache = new Map();
  const measureLine = (i, j) => {
    const key = `${i}:${j}`;
    if (lineCache.has(key)) return lineCache.get(key);
    const runs = [];
    let x = 0;
    for (let w = i; w < j; w += 1) {
      if (w > i) x += space;
      words[w].forEach((seg, si) => {
        if (si > 0) x += track;
        const run = shapeRun(fontOf(seg), seg.text, size, tracking);
        runs.push({ seg, run, x });
        x += run.width;
      });
    }
    const line = { runs, width: x };
    lineCache.set(key, line);
    return line;
  };
  for (let w = 0; w < words.length; w += 1) if (measureLine(w, w + 1).width > maxWidth) return null;
  // Greedy count.
  let count = 0;
  for (let i = 0; i < words.length; count += 1) {
    let j = i + 1;
    while (j < words.length && measureLine(i, j + 1).width <= maxWidth) j += 1;
    i = j;
  }
  // Balanced DP over break points with exactly `count` lines.
  const n = words.length;
  const memo = new Map();
  const best = (i, linesLeft) => {
    if (i === n) return linesLeft === 0 ? { cost: 0, breaks: [] } : null;
    if (linesLeft === 0) return null;
    const key = `${i}:${linesLeft}`;
    if (memo.has(key)) return memo.get(key);
    let result = null;
    for (let j = i + 1; j <= n; j += 1) {
      const line = measureLine(i, j);
      if (line.width > maxWidth) break;
      const rest = best(j, linesLeft - 1);
      if (!rest) continue;
      const slack = (maxWidth - line.width) / maxWidth;
      let cost = slack * slack;
      if (j < n && WEAK_END.has(plainWord(words[j - 1]).toLowerCase().replace(/[^\p{L}]/gu, ''))) cost += 0.08;
      if (j === n && j - i === 1 && count > 1) cost += 0.25; // orphan
      if (j < n && /[:;,.?!\u2013\u2014]$/.test(plainWord(words[j - 1]))) cost -= 0.06; // break at a phrase boundary
      cost += rest.cost;
      if (!result || cost < result.cost) result = { cost, breaks: [j, ...rest.breaks] };
    }
    memo.set(key, result);
    return result;
  };
  const plan = best(0, count);
  if (!plan) return null;
  const lines = [];
  let i = 0;
  for (const j of plan.breaks) { lines.push(measureLine(i, j)); i = j; }
  return { lines, size, cost: plan.cost / count };
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
const escAttr = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i;
const pick = (tokens, key, fallback) => (tokens && HEX.test(String(tokens[key] || '')) ? tokens[key] : fallback);

const paletteFor = (theme, variant) => {
  const deep = variant === 'deep';
  const t = theme && typeof theme === 'object' ? (deep ? theme.dark : theme.light) || theme : null;
  return deep
    ? {
      bg: pick(t, '--bg', '#10181A'), ink: pick(t, '--ink', '#E9E6DF'), muted: pick(t, '--ink-muted', '#9AA8AB'),
      line: pick(t, '--line', '#2A373B'), primary: pick(t, '--primary', '#4FB3A6'), accent: pick(t, '--accent', '#D98E68'),
    }
    : {
      bg: pick(t, '--bg', '#F6F4EF'), ink: pick(t, '--ink', '#182A2E'), muted: pick(t, '--ink-muted', '#425054'),
      line: pick(t, '--line', '#DDD6CA'), primary: pick(t, '--primary', '#0E6B63'), accent: pick(t, '--accent', '#B25A38'),
    };
};

const fitError = (slug, what) => new Error(`og: share card for "${slug}" — ${what}. Shorten the title or fix the layout; a clipped card never ships.`);

// Scan an RGBA buffer for its painted bounds (alpha > 8).
const paintedBounds = (data, width, height) => {
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
};

const loadCover = async (post, root, width, height) => {
  const cover = post && post.cover;
  if (!cover || !cover.src || cover.patient) return null; // patient photos never go on a share card
  if (/^[a-z]+:/i.test(cover.src) || cover.src.startsWith('/')) return null;
  const file = path.join(root, cover.src);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return null;
  const upright = await sharp(file).rotate().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = upright.info;
  const scale = Math.max(width / w, height / h);
  const rw = Math.max(width, Math.round(w * scale));
  const rh = Math.max(height, Math.round(h * scale));
  const fx = Number.isFinite(cover.focal && cover.focal.x) ? cover.focal.x : 0.5;
  const fy = Number.isFinite(cover.focal && cover.focal.y) ? cover.focal.y : 0.5;
  const left = Math.min(rw - width, Math.max(0, Math.round(fx * rw - width / 2)));
  const top = Math.min(rh - height, Math.max(0, Math.round(fy * rh - height / 2)));
  return sharp(upright.data).resize(rw, rh).extract({ left, top, width, height }).toBuffer();
};

/**
 * renderOgPng(post, { blogName, category, lockupPath, theme, root, variant }) → PNG Buffer | null
 *   category: the category object (uses .name) or a plain string
 *   theme:    the site theme object ({ light, dark } token maps) — meridian by default
 *   variant:  'paper' (default) | 'deep'
 *   root:     repo root for resolving post.cover.src (default: this repo)
 */
const renderOgPng = async (post, { blogName, category, lockupPath, theme, root, variant = 'paper' } = {}) => {
  if (!post || !post.title) return null;
  const { display, italic, label } = faces();
  const repoRoot = path.resolve(root || path.join(__dirname, '..', '..'));
  const slug = post.slug || post.id || 'post';
  const colors = paletteFor(theme, variant);

  const title = smarten(post.title);
  const kicker = String((category && typeof category === 'object' ? category.name : category) || '').trim().toUpperCase();
  const journal = String(blogName || '').trim();
  // Characters the fonts cannot draw → let the page use the site default image.
  if (missingGlyphs(display, title).length || missingGlyphs(italic, title).length
    || missingGlyphs(label, kicker).length || missingGlyphs(display, journal).length) return null;

  // Frame.
  const coverW = 430;
  const coverBuf = await loadCover(post, repoRoot, coverW, H);
  const padX = 76;
  const colRight = coverBuf ? W - coverW - 64 : W - padX;
  const colW = colRight - padX;
  const titleMaxW = coverBuf ? colW : Math.min(colW, 900);

  // Kicker (category) at the top.
  const kickerSize = 17;
  const kickerTrack = 0.16;
  const kickerBaseline = 96;
  const diamond = 9;
  const kickerRun = kicker ? shapeRun(label, kicker, kickerSize, kickerTrack) : null;
  const kickerX = padX + (kickerRun ? diamond + 14 : 0);
  if (kickerRun && kickerX + kickerRun.width > colRight) throw fitError(slug, `category label "${kicker}" is wider than the card column`);

  // Footer: rule, lockup, journal name.
  const footerRuleY = 484;
  const lockupH = 64;
  const lockupTop = 512;
  const journalSize = 23;

  // Title box: between the kicker and the footer rule.
  const box = { x0: padX, x1: padX + titleMaxW, y0: kickerBaseline + 34, y1: footerRuleY - 34 };
  const words = titleWords(title, post.titleAccent);
  const tracking = -0.02;
  const lineHeight = 1.08;
  // Every size that fits is a candidate; the winner balances size against rag
  // quality (and a fourth line), so a long title takes 3 well-broken lines over 4
  // ragged ones, and a short one gets the biggest type.
  let layout = null;
  for (let size = 84; size >= 40; size -= 2) {
    const attempt = layoutTitle(words, size, box.x1 - box.x0, tracking);
    if (!attempt || attempt.lines.length > 4) continue;
    const capH = display.capHeight * (size / display.unitsPerEm);
    const blockH = capH + (attempt.lines.length - 1) * size * lineHeight + size * 0.26; // + descender room
    if (blockH > box.y1 - box.y0) continue;
    const score = size - 40 * attempt.cost - (attempt.lines.length === 4 ? 5 : 0);
    if (process.env.MV_OG_DEBUG) console.log(slug, size, attempt.lines.length, attempt.cost.toFixed(3), score.toFixed(1));
    if (!layout || score > layout.score) layout = { ...attempt, capH, blockH, score };
  }
  if (!layout) throw fitError(slug, `the title does not fit in ${4} lines at the smallest size`);

  // Title block sits under the kicker, optically centred in the space above the footer
  // (a short title doesn't leave a hole at the bottom; a long one fills the box).
  const free = box.y1 - box.y0 - layout.blockH;
  const firstBaseline = box.y0 + Math.round(free * 0.32) + layout.capH;
  const titlePaths = [];
  const titleBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  layout.lines.forEach((line, li) => {
    const baseline = firstBaseline + li * layout.size * lineHeight;
    for (const { seg, run, x } of line.runs) {
      const font = seg.italic ? italic : display;
      const { d, box: ink } = runPath(font, run, padX + x, baseline);
      if (!d) continue;
      titlePaths.push(`<path d="${d}" fill="${seg.italic ? colors.accent : colors.ink}"/>`);
      titleBox.x0 = Math.min(titleBox.x0, ink.x0); titleBox.x1 = Math.max(titleBox.x1, ink.x1);
      titleBox.y0 = Math.min(titleBox.y0, ink.y0); titleBox.y1 = Math.max(titleBox.y1, ink.y1);
    }
  });
  const tol = 2; // italic overhang / antialiasing
  if (titleBox.x0 < box.x0 - tol || titleBox.x1 > box.x1 + tol || titleBox.y0 < box.y0 - tol || titleBox.y1 > box.y1 + tol) {
    throw fitError(slug, `measured title ink ${JSON.stringify(titleBox)} escapes its box ${JSON.stringify(box)}`);
  }

  // Rendered check: rasterise the title layer alone and scan its painted pixels.
  const titleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${titlePaths.join('')}</svg>`;
  const titleRaster = await sharp(Buffer.from(titleSvg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const painted = paintedBounds(titleRaster.data, W, H);
  if (!painted) throw fitError(slug, 'the title rendered no pixels');
  if (painted.x0 < box.x0 - tol || painted.x1 > box.x1 + tol || painted.y0 < box.y0 - tol || painted.y1 > box.y1 + tol) {
    throw fitError(slug, `rendered title ${JSON.stringify(painted)} escapes its box ${JSON.stringify(box)}`);
  }

  // Kicker + journal name.
  const shapes = [];
  if (kickerRun) {
    const cy = kickerBaseline - (label.capHeight * kickerSize) / label.unitsPerEm / 2;
    const cx = padX + diamond / 2;
    shapes.push(`<path d="M${cx} ${cy - diamond / 2}L${cx + diamond / 2} ${cy}L${cx} ${cy + diamond / 2}L${cx - diamond / 2} ${cy}Z" fill="${colors.accent}"/>`);
    shapes.push(`<path d="${runPath(label, kickerRun, kickerX, kickerBaseline).d}" fill="${colors.primary}"/>`);
  }
  shapes.push(`<rect x="${padX}" y="${footerRuleY}" width="${colRight - padX}" height="1.5" fill="${colors.line}"/>`);
  let journalSvg = '';
  if (journal) {
    const run = shapeRun(italic, journal, journalSize, -0.005);
    const jx = colRight - run.width;
    const jBaseline = lockupTop + lockupH / 2 + (italic.capHeight * journalSize) / italic.unitsPerEm / 2;
    if (jx < padX + 200) throw fitError(slug, `the journal name "${journal}" collides with the lockup`);
    journalSvg = `<path d="${runPath(italic, run, jx, jBaseline).d}" fill="${colors.muted}"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<rect width="${W}" height="${H}" fill="${escAttr(colors.bg)}"/>${shapes.join('')}${titlePaths.join('')}${journalSvg}</svg>`;

  // The owner's lockup, composited as-is (never re-typeset). Deep cards use the
  // paper-coloured master that sits beside the ink one.
  const composites = [];
  let lockupFile = lockupPath || path.join(repoRoot, 'assets', 'brand', 'logo-ink.png');
  if (variant === 'deep') {
    const paper = lockupFile.replace(/logo-ink(\.[a-z]+)$/i, 'logo-paper$1');
    if (paper !== lockupFile && fs.existsSync(paper)) lockupFile = paper;
  }
  if (fs.existsSync(lockupFile)) {
    const lockup = await sharp(lockupFile).resize({ height: lockupH }).png().toBuffer();
    composites.push({ input: lockup, left: padX, top: lockupTop });
  }
  if (coverBuf) composites.push({ input: coverBuf, left: W - coverW, top: 0 });

  return sharp(Buffer.from(svg)).composite(composites).png({ compressionLevel: 9 }).toBuffer();
};

module.exports = { renderOgPng, _internals: { readFont, shapeRun, layoutTitle, titleWords, smarten } };
