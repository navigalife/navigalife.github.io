# Mission card — 3:2, INK

```sh
node assets/campaign/mission.mjs
```

Owner-drawn layout (2026-07-27) on the signed-off `02-ink` surface: the lockup,
three lines of capitals, one destination. Nothing else — no body paragraph, no
conditions strip, no reason-to-act-now, and no rule under the call to action
(the drawing had one; the owner cut it). A mission card is not a flyer; it says
what the practice is for, once.

**1620 × 982** (1.650:1). The height is not chosen — it is solved. The card is
five things one `step` apart, so its height is whatever that comes to; fixing a
ratio first and letting the step fall out of it is how the first version ended
up with a 119px rhythm nobody picked. Change `fmt.step` and the canvas follows.

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
  action are one equal step apart — `fmt.step`, 88px, which renders as a ~95px
  visible gap because a line's box is fractionally taller than the capitals in
  it. That is the drawing. It is not the signed-off portrait's rhythm, which
  holds the message up under the lockup and gathers the whole leftover into one
  field below — different card.

## The mark

The MediVasc mark is a **C** — an open ring of atoms — and the flyer sets it at
roughly canvas width, which puts two or three atoms on the page and reads as
texture rather than as a molecule. Here it is pulled back until the network is
legible: the ring arcs in from the right edge with its opening off-canvas.

It is specified by where it lands, not by scale. `span` is how far it reaches in
from the right edge (0.30); `bleed` is how much runs off past it (0.15), and it
is vertically centred on whatever height the rhythm solved.

`bleed` is the real dial, trading atom count against the arc's presence: at 0.05
the whole C sits inside the band and reads as a small badge floating in it; at
0.30 it is a true half-ring filling the height, but the atoms are back to being
large and few.

The mark is trimmed before it is placed, like the lockup. The file carries
transparent padding around the C, so positioning its edge put the *artwork* at
27.8% in rather than the 30% asked for.

## What the renderer solves rather than takes as input

- **The size**, against the measure: authored line breaks are honoured
  (`setStack`, not `balanceRuns` — re-wrapping would discard them) and the
  largest size that fits the column wins. Width alone, now that the height
  follows the type instead of constraining it.
- **The height.** n lines between the lockup and the destination means n+1 gaps
  — logo→first, line→line, last→destination — plus the call to action's own box
  and the two pads. Rounded to an even number, so nothing that later scales or
  crops the card lands on a half-pixel centre.
- **Capitals have no descender.** Measuring them with the line box's 26%
  descender allowance hangs a phantom gap under every line and makes an evenly
  stepped stack read bottom-heavy, so the voice declares its own visual height.

## Verification

`verify.mjs` gates the write: safe area, flow, and every colour pair against
both the flat surface and the mark tint. Three invariants the composer reports
itself fail the build rather than shipping — a stack that stops filling 82% of
its measure, a closing gap that drifts more than 2px from the step (the last gap
is the one that absorbs the even-height rounding), and the flush-right edge
missing by more than a pixel.

Measured off the rendered PNG rather than off the layout math: `AMPUTATION` and
`PREVENTION` both end at x=1351, the four gaps come out 93/95/96/95px, and the
mark's ink reaches in to x=1138 — 29.8% of the width from the right.

Nothing here ships: `assets/campaign` is not in `src/build.js`'s deploy copy
list.
