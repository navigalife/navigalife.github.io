// Layout verification.
//
// Every defect in the previous generation of these assets was silent: the
// renderer happily wrote a PNG with the website URL sitting on top of the
// artwork, the last line of a flyer clipped by the canvas edge, and a contact
// sheet whose bottom row ran off the bottom. None of it threw. These checks run
// on the computed layout before anything is rasterised, so a broken asset is a
// non-zero exit rather than a file someone has to notice.

const SAFE = 'safe-area';
const ART = 'art-overlap';
const CONTRAST = 'contrast';
const FLOW = 'flow';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const intersects = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Check one composed layout.
 *
 * `plan.blocks` are the laid-out rectangles, `plan.art` the reserved
 * illustration column, `plan.gap` the slack between the top and bottom stacks.
 */
export function verifyLayout({ plan, fmt, direction, format }) {
  const failures = [];
  const bleed = fmt.bleed ?? 0;

  // 1. Everything stays inside the safe area.
  //    Print formats measure the safe area from the trim box, not the bleed
  //    edge, which is the whole reason the bleed is tracked separately.
  const safe = {
    x: fmt.pad.x,
    y: fmt.pad.top,
    w: fmt.w - fmt.pad.x * 2,
    h: fmt.h - fmt.pad.top - fmt.pad.bottom,
  };
  for (const block of plan.blocks) {
    const slackLeft = block.x - safe.x;
    const slackRight = safe.x + safe.w - (block.x + block.w);
    const slackTop = block.y - safe.y;
    const slackBottom = safe.y + safe.h - (block.y + block.h);
    const worst = Math.min(slackLeft, slackRight, slackTop, slackBottom);
    // A 1px allowance absorbs the rounding in the ascent/descent estimates.
    if (worst < -1) {
      failures.push({
        check: SAFE,
        detail: `"${block.name}" escapes the safe area by ${Math.abs(worst).toFixed(1)}px ` +
          `(l ${slackLeft.toFixed(0)} r ${slackRight.toFixed(0)} t ${slackTop.toFixed(0)} b ${slackBottom.toFixed(0)})`,
      });
    }
  }

  // 2. No text block may enter the reserved artwork column.
  //    The logo is exempt: it is placed, not flowed, and sits above the column.
  for (const block of plan.blocks) {
    if (block.name === 'logo') continue;
    if (!intersects(block, plan.art)) continue;
    const area = overlapArea(block, plan.art);
    failures.push({
      check: ART,
      detail: `"${block.name}" overlaps the artwork column by ${Math.round(area)}px²`,
    });
  }

  // 3. The top stack must not collide with the bottom stack.
  if (plan.gap < 0) {
    failures.push({ check: FLOW, detail: `top and bottom stacks collide by ${Math.abs(plan.gap).toFixed(0)}px` });
  }

  // 4. Text must clear the WCAG AA floor against the surface behind it.
  //    Large text (>= 24px at the format's own scale) gets the 3:1 floor.
  const pairs = [
    { name: 'headline', fg: direction.ink, bg: direction.base, size: fmt.type.headline },
    { name: 'body', fg: direction.ink, bg: direction.base, size: fmt.type.body },
    { name: 'kicker', fg: direction.ink, bg: direction.base, size: fmt.type.kicker },
    { name: 'conditions', fg: direction.muted, bg: direction.base, size: fmt.type.cond },
    { name: 'fineprint', fg: direction.muted, bg: direction.base, size: fmt.type.fine },
    { name: 'cta text', fg: direction.cta.text, bg: direction.cta.fill, size: fmt.type.cta },
    { name: 'accent word', fg: direction.accent, bg: direction.base, size: fmt.type.headline },
    { name: 'qr modules', fg: direction.qr.dark, bg: direction.qr.light, size: 99 },
  ];
  for (const pair of pairs) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    if (ratio === null) continue;
    const scale = fmt.w / 1080;
    const isLarge = pair.size / scale >= 24;
    const floor = isLarge ? 3 : 4.5;
    if (ratio < floor) {
      failures.push({
        check: CONTRAST,
        detail: `${pair.name} ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, below the ${floor}:1 floor`,
      });
    }
  }

  // 5. Platform chrome. An X header is not a flat canvas: the profile picture
  //    is drawn over its bottom-left corner, so anything placed there is
  //    permanently hidden for every visitor.
  if (fmt.obstructions) {
    for (const zone of fmt.obstructions) {
      for (const block of plan.blocks) {
        if (!intersects(block, zone.rect)) continue;
        failures.push({
          check: 'platform-chrome',
          detail: `"${block.name}" sits under the ${zone.name} (${Math.round(overlapArea(block, zone.rect))}px² hidden)`,
        });
      }
    }
  }

  // 6. Artwork must stay on the canvas vertically; horizontal bleed is allowed
  //    (the illustration is designed to run off the right edge).
  if (plan.art.y < -bleed || plan.art.y + plan.art.h > fmt.h + bleed) {
    failures.push({ check: SAFE, detail: 'artwork column extends past the canvas vertically' });
  }

  return { ok: failures.length === 0, failures, id: `${direction.id} · ${format}` };
}

/** Print a per-asset table. Returns true when everything passed. */
export function reportVerification(results) {
  const width = Math.max(...results.map((r) => r.id.length));
  let ok = true;
  for (const { id, verification } of results) {
    if (verification.ok) {
      console.log(`  PASS  ${id.padEnd(width)}`);
      continue;
    }
    ok = false;
    console.log(`  FAIL  ${id.padEnd(width)}`);
    for (const f of verification.failures) console.log(`        ${f.check}: ${f.detail}`);
  }
  return ok;
}
