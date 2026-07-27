# Mission card — 3:2, INK

```sh
node assets/campaign/mission.mjs
```

Owner-drawn layout (2026-07-27) on the signed-off `02-ink` surface: the lockup,
three lines of capitals, one destination. Nothing else — no body paragraph, no
conditions strip, no reason-to-act-now, and no rule under the call to action
(the drawing had one; the owner cut it). A mission card is not a flyer; it says
what the practice is for, once.

1620 × 1080. The short edge is the campaign's own 1080, so the type scale
carries over from the signed-off portrait instead of being re-guessed.

## The three decisions the card is built on

- **One size, one weight, one face.** Fraunces — the flyer's own — set in
  capitals. `MISSION` is not a label and is not set like one: it is the first of
  three lines and the sentence runs straight through it. Colour does the work
  size no longer does, and the two accent lines are the frame — what this is,
  and what it is for — sitting on opposite edges.
- **`PREVENTION` ends exactly where `AMPUTATION` ends.** Not at an abstract
  column, at the longest flush-left line's own right edge. A flush-right line
  has to land where the reader has already been reading to; a few pixels off
  reads as a near-miss rather than as alignment, so the composer computes the
  edge and then *asserts* it (`alignment` check, 1px tolerance).
- **One rhythm, lockup to destination.** The logo, each line and the call to
  action are one equal step apart. That is the drawing. It is not the signed-off
  portrait's rhythm, which holds the message up under the lockup and gathers the
  whole leftover into one field below — different card.

## What the renderer solves rather than takes as input

- **The size**, against the box: authored line breaks are honoured (`setStack`,
  not `balanceRuns` — re-wrapping would discard them) and the largest size that
  fits both the measure and the height available wins.
- **The step.** n lines between the lockup and the destination means n+1 gaps.
  Dividing the slack by n drops the last one and jams the closing line onto the
  call to action.
- **Capitals have no descender.** Measuring them with the line box's 26%
  descender allowance hangs a phantom gap under every line and makes an evenly
  stepped stack read bottom-heavy, so the voice declares its own visual height.

## Verification

`verify.mjs` gates the write: safe area, flow, and every colour pair against
both the flat surface and the mark tint. Three invariants the composer reports
itself fail the build rather than shipping — a stack that stops filling 82% of
its measure, an even step under 46px, and the flush-right edge missing by more
than a pixel.

Measured off the rendered PNG rather than off the layout math: `AMPUTATION` and
`PREVENTION` both end at x=1351, and the four gaps come out 118/119/120/119px.

Nothing here ships: `assets/campaign` is not in `src/build.js`'s deploy copy
list.
