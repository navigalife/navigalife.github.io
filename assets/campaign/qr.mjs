// Minimal QR encoder (byte mode, single error-correction block).
//
// Scope is deliberately narrow: the campaign only ever encodes short ASCII URLs
// (a wa.me link and medivasc.in), so versions 1-4 with one EC block cover every
// payload we need and the interleaving logic that multi-block versions require
// stays out of the codebase. `selfTest()` proves the output is a valid Reed-
// Solomon codeword, which is the part that cannot be eyeballed from a render.

// ---------------------------------------------------------------------------
// GF(256), primitive polynomial 0x11D
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= mul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  // The recurrence above accumulates coefficients lowest-degree-first; the
  // division below indexes them highest-degree-first, so hand it back reversed.
  return poly.reverse();
}

function ecCodewords(data, count) {
  const gen = generatorPoly(count);
  const rem = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < count; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// ---------------------------------------------------------------------------
// Version / EC tables — single-block configurations only
// ---------------------------------------------------------------------------

const EC_LEVELS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

// version -> level -> { data, ec }  (codeword counts for one block)
const BLOCKS = {
  1: { L: { data: 19, ec: 7 }, M: { data: 16, ec: 10 }, Q: { data: 13, ec: 13 }, H: { data: 9, ec: 17 } },
  2: { L: { data: 34, ec: 10 }, M: { data: 28, ec: 16 }, Q: { data: 22, ec: 22 }, H: { data: 16, ec: 28 } },
  3: { L: { data: 55, ec: 15 }, M: { data: 44, ec: 26 } },
  4: { L: { data: 80, ec: 20 } },
};

// Alignment-pattern centre coordinates per version.
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26] };

// Strongest-first, so `pick` prefers more error correction at the same version.
const LEVEL_ORDER = ['H', 'Q', 'M', 'L'];

function pick(byteLength) {
  for (const version of [1, 2, 3, 4]) {
    for (const level of LEVEL_ORDER) {
      const block = BLOCKS[version]?.[level];
      if (!block) continue;
      // 4 bits mode + 8 bits length + payload must fit the data codewords.
      if (12 + byteLength * 8 <= block.data * 8) return { version, level, ...block };
    }
  }
  throw new Error(`qr: payload of ${byteLength} bytes exceeds the supported versions (1-4, single block)`);
}

// ---------------------------------------------------------------------------
// Bitstream -> data codewords
// ---------------------------------------------------------------------------

function dataCodewords(text, capacity) {
  const bytes = [...new TextEncoder().encode(text)];
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // versions 1-9 use an 8-bit length field in byte mode
  for (const byte of bytes) push(byte, 8);

  const limit = capacity * 8;
  for (let i = 0; i < 4 && bits.length < limit; i++) bits.push(0); // terminator
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const pad = [0xec, 0x11];
  while (codewords.length < capacity) codewords.push(pad[(codewords.length - bits.length / 8) % 2]);
  return codewords;
}

// ---------------------------------------------------------------------------
// Module placement
// ---------------------------------------------------------------------------

function blankMatrix(size) {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array(size).fill(0)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || y >= m.size || x < 0 || x >= m.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m.modules[y][x] = inRing || inCore ? 1 : 0;
      m.reserved[y][x] = true;
    }
  }
}

function placeFunctionPatterns(m, version) {
  placeFinder(m, 0, 0);
  placeFinder(m, 0, m.size - 7);
  placeFinder(m, m.size - 7, 0);

  for (let i = 8; i < m.size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    m.modules[6][i] = bit;
    m.reserved[6][i] = true;
    m.modules[i][6] = bit;
    m.reserved[i][6] = true;
  }

  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      if (m.reserved[row][col]) continue; // skips the finder-pattern corners
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const outer = Math.abs(r) === 2 || Math.abs(c) === 2;
          m.modules[row + r][col + c] = outer || (r === 0 && c === 0) ? 1 : 0;
          m.reserved[row + r][col + c] = true;
        }
      }
    }
  }

  // Dark module, then reserve the two format-information strips.
  m.modules[m.size - 8][8] = 1;
  m.reserved[m.size - 8][8] = true;
  for (let i = 0; i < 9; i++) {
    if (!m.reserved[8][i]) m.reserved[8][i] = true;
    if (!m.reserved[i][8]) m.reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8][m.size - 1 - i] = true;
    m.reserved[m.size - 1 - i][8] = true;
  }
}

function placeData(m, codewords) {
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);

  let index = 0;
  let upward = true;
  for (let right = m.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern is skipped entirely
    for (let step = 0; step < m.size; step++) {
      const y = upward ? m.size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (m.reserved[y][x]) continue;
        m.modules[y][x] = index < bits.length ? bits[index] : 0;
        index++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(grid) {
  const n = grid.length;
  let score = 0;

  // Rule 1 — runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < n; i++) {
    for (const read of [(k) => grid[i][k], (k) => grid[k][i]]) {
      let run = 1;
      for (let k = 1; k < n; k++) {
        if (read(k) === read(k - 1)) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2 — 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3 — finder-like 1:1:3:1:1 sequences.
  const a = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const b = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k + 11 <= n; k++) {
      const row = grid[i].slice(k, k + 11);
      const col = Array.from({ length: 11 }, (_, j) => grid[k + j][i]);
      for (const seq of [row, col]) {
        if (a.every((v, j) => v === seq[j]) || b.every((v, j) => v === seq[j])) score += 40;
      }
    }
  }

  // Rule 4 — deviation from a 50/50 dark ratio.
  const dark = grid.flat().reduce((acc, v) => acc + v, 0);
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

function formatBits(level, mask) {
  let value = (EC_LEVELS[level] << 3) | mask;
  let rem = value << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((value << 10) | rem) ^ 0b101010000010010;
}

function applyFormat(m, level, mask) {
  const bits = formatBits(level, mask);
  const bit = (i) => (bits >> i) & 1;
  for (let i = 0; i <= 5; i++) {
    m.modules[8][i] = bit(i);
    m.modules[i][8] = bit(14 - i);
  }
  m.modules[8][7] = bit(6);
  m.modules[8][8] = bit(7);
  m.modules[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) m.modules[14 - i][8] = bit(i);
  for (let i = 0; i <= 7; i++) m.modules[8][m.size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) m.modules[m.size - 15 + i][8] = bit(i);
  m.modules[m.size - 8][8] = 1;
}

/** Encode `text` and return `{ size, modules }` where modules[row][col] is 0 or 1. */
export function encode(text) {
  const bytes = new TextEncoder().encode(text).length;
  const { version, level, data, ec } = pick(bytes);
  const codewords = [...dataCodewords(text, data)];
  const full = [...codewords, ...ecCodewords(codewords, ec)];

  const size = version * 4 + 17;
  const base = blankMatrix(size);
  placeFunctionPatterns(base, version);
  placeData(base, full);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = {
      size,
      modules: base.modules.map((row) => [...row]),
      reserved: base.reserved,
    };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!base.reserved[r][c] && MASKS[mask](r, c)) candidate.modules[r][c] ^= 1;
      }
    }
    applyFormat(candidate, level, mask);
    const score = penalty(candidate.modules);
    if (!best || score < best.score) best = { score, matrix: candidate };
  }

  return { size, modules: best.matrix.modules, version, level, codewords: full, ec };
}

/**
 * Read a matrix back the way a scanner would: recover the mask from the format
 * strip, undo it, walk the data placement, and parse the byte-mode segment.
 *
 * Deliberately independent of the encoder's own state — it re-derives the
 * reserved map from the version rather than reusing the one `encode` built.
 */
function decodeMatrix({ size, modules, version }) {
  const reserved = blankMatrix(size);
  placeFunctionPatterns(reserved, version);

  let raw = 0;
  for (let i = 0; i <= 5; i++) raw |= modules[8][i] << i;
  raw |= modules[8][7] << 6;
  raw |= modules[8][8] << 7;
  raw |= modules[7][8] << 8;
  for (let i = 9; i <= 14; i++) raw |= modules[14 - i][8] << i;
  const mask = ((raw ^ 0b101010000010010) >> 10) & 7;

  const grid = modules.map((row) => [...row]);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved.reserved[r][c] && MASKS[mask](r, c)) grid[r][c] ^= 1;
    }
  }

  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (!reserved.reserved[y][x]) bits.push(grid[y][x]);
      }
    }
    upward = !upward;
  }

  const take = (n) => bits.splice(0, n).reduce((acc, bit) => (acc << 1) | bit, 0);
  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`qr: decoded mode ${mode}, expected byte mode`);
  const length = take(8);
  const bytes = Array.from({ length }, () => take(8));
  return { text: new TextDecoder().decode(Uint8Array.from(bytes)), mask };
}

/**
 * Prove the code is scannable without a scanner, two ways: every Reed-Solomon
 * syndrome of a valid codeword is zero, and reading the finished matrix back
 * returns the original payload. A render can look perfectly plausible and still
 * be undecodable, so this gates the build.
 */
export function selfTest(text) {
  const result = encode(text);
  const { codewords, ec, version, level } = result;

  for (let i = 0; i < ec; i++) {
    let syndrome = 0;
    for (const cw of codewords) syndrome = mul(syndrome, EXP[i]) ^ cw;
    if (syndrome !== 0) {
      throw new Error(`qr: Reed-Solomon self-test failed for ${JSON.stringify(text)} (syndrome ${i} = ${syndrome})`);
    }
  }

  const { text: decoded, mask } = decodeMatrix(result);
  if (decoded !== text) {
    throw new Error(`qr: round-trip failed — encoded ${JSON.stringify(text)}, read back ${JSON.stringify(decoded)}`);
  }

  return { version, level, mask, codewords: codewords.length };
}

/** Render the code as an SVG path string sized to `size` px, with a quiet zone. */
export function svgPath(text, size, { quiet = 4 } = {}) {
  const { size: n, modules } = encode(text);
  const scale = size / (n + quiet * 2);
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules[r][c]) continue;
      const x = (c + quiet) * scale;
      const y = (r + quiet) * scale;
      // +0.5 overdraw closes hairline seams between adjacent modules.
      d += `M${x.toFixed(2)} ${y.toFixed(2)}h${(scale + 0.5).toFixed(2)}v${(scale + 0.5).toFixed(2)}h${(-scale - 0.5).toFixed(2)}Z`;
    }
  }
  return d;
}
