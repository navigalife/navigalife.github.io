// Layout verification.
//
// Every defect in the first generation of these assets was silent: the renderer
// happily wrote a PNG with the website URL sitting on top of the illustration,
// the last line clipped by the canvas edge, and a contact sheet whose bottom row
// ran off the bottom. None of it threw. These checks run on the computed layout
// before anything is rasterised, so a broken asset is a non-zero exit rather
// than a file someone has to notice.

const SAFE = 'safe-area';
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
 * `plan.blocks` are the laid-out rectangles and `plan.gap` is the slack between
 * the top stack and the footer.
 */
export function verifyLayout({ plan, fmt, direction, format }) {
  const failures = [];

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
    if (block.bleed) continue;
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

  // 2. The top stack must not collide with the footer.
  if (plan.gap < 0) {
    failures.push({ check: FLOW, detail: `top and bottom stacks collide by ${Math.abs(plan.gap).toFixed(0)}px` });
  }

  // 3. Text must clear the WCAG AA floor against the surface behind it.
  //    Large text (>= 24px at the format's own scale) gets the 3:1 floor.
  //
  //    A layout that draws colours the editorial treatments never use — white
  //    type on a filled bar, say — declares its own pairs, each with the surface
  //    it actually lands on. The default list below is the editorial one, where
  //    every colour can land on either the flat background or the mark tint.
  const scale = fmt.w / 1080;
  if (plan.contrast) {
    for (const pair of plan.contrast) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      if (ratio === null) continue;
      // A pair may state its own floor. Text is 4.5:1, or 3:1 once it is large;
      // a graphic element that is not text — a sign's band, a rule that carries
      // meaning — is 3:1 at any size (WCAG 1.4.11), and sizing it in points to
      // get there would be a fiction.
      const floor = pair.floor ?? (pair.size / scale >= 24 ? 3 : 4.5);
      if (ratio < floor) {
        failures.push({
          check: CONTRAST,
          detail: `${pair.name} ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, below the ${floor}:1 floor`,
        });
      }
    }
  }
  const pairs = plan.contrast ? [] : [
    { name: 'headline', fg: direction.ink, size: fmt.type.headline },
    { name: 'accent word', fg: direction.accent, size: fmt.type.headline },
    { name: 'body', fg: direction.muted, size: fmt.type.body },
    { name: 'conditions', fg: direction.muted, size: fmt.type.cond },
    { name: 'cta', fg: direction.muted, size: fmt.type.cta },
    { name: 'cta site', fg: direction.link, size: fmt.type.cta },
  ];
  // Two surfaces, because the oversized brand mark sits behind the type: text
  // must clear the floor on the flat background *and* on the mark tint, since
  // the copy runs full width across it.
  const surfaces = [
    { name: 'surface', color: direction.base },
    { name: 'mark tint', color: direction.markTint },
  ];
  for (const pair of pairs) {
    for (const surface of surfaces) {
      const ratio = contrastRatio(pair.fg, surface.color);
      if (ratio === null) continue;
      const isLarge = pair.size / scale >= 24;
      const floor = isLarge ? 3 : 4.5;
      if (ratio < floor) {
        failures.push({
          check: CONTRAST,
          detail: `${pair.name} ${pair.fg} on ${surface.name} ${surface.color} is ${ratio.toFixed(2)}:1, below the ${floor}:1 floor`,
        });
      }
    }
  }

  // 4. Platform chrome. An X header is not a flat canvas: the profile picture
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

  // 5. Invariants the composer itself computed. A layout knows things the
  //    verifier cannot infer from rectangles — that its four columns are evenly
  //    pitched, that a caption stayed inside its column, that a headline still
  //    fills its measure. It reports them; this is where they become a failure.
  for (const check of plan.checks ?? []) {
    if (check.ok) continue;
    failures.push({ check: check.check ?? 'layout', detail: `${check.name}: ${check.detail}` });
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
