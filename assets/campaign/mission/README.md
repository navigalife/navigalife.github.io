# Mission card — 3:2, INK

```sh
node assets/campaign/mission.mjs
```

Needs `assets/campaign/fonts/exotc350.glyphs.json`, which is **not in this repo**
— it is outlines extracted from a licensed face and this repo is public, so it is
gitignored. Regenerate it with the advisor's `tools/brand/glyphs.py` first; the
renderer fails with that instruction rather than falling back to another face.

Owner-drawn layout (2026-07-27) on the signed-off `02-ink` surface: the lockup,
three lines of capitals, one destination. Nothing else — no body paragraph, no
conditions strip, no reason-to-act-now, and no rule under the call to action
(the drawing had one; the owner cut it). A mission card is not a flyer; it says
what the practice is for, once.

**1620 × 1088** (1.489:1). Only the width is chosen. The height is five things
one `step` apart, so it is whatever that comes to, and the margins are read back
off the line the type actually set — fixing a ratio first and letting the step
fall out of it is how the first version ended up with a 119px rhythm nobody
picked, and fixing the margin and letting the line stop where it stopped is how
it ended up with a right margin two and a half times its left. Change `fmt.step`
or the copy and the canvas follows.

## The three decisions the card is built on

- **One size, one weight, one face.** Exotc350 Demi Bold — the wordmark's own
  face, the Peignot revival the MediVasc lockup is drawn in — set in capitals.
  `MISSION` is not a label and is not set like one: it is the first of three
  lines and the sentence runs straight through it. Colour does the work size no
  longer does, and the two accent lines are the frame — what this is, and what it
  is for — sitting on opposite edges. The stack is *drawn as outlines*, not set
  as `<text>`: this librsvg ignores `@font-face`, so an embedded woff2 is inert
  and `font-family` resolves to whatever the system offers for the generic
  keyword. Hence the glyph dump the build demands.
- **`PREVENTION` ends exactly where `AMPUTATION` ends.** Not at an abstract
  column, at the longest flush-left line's own right edge. A flush-right line
  has to land where the reader has already been reading to; a few pixels off
  reads as a near-miss rather than as alignment, so the composer computes the
  edge and then *asserts* it (`alignment` check, 1px tolerance).
- **One rhythm, lockup to destination.** The logo, each line and the call to
  action are one equal step apart — `fmt.step`, 100px, measured cap box to cap
  box, which renders as the ~95px of visible ink gap the owner signed off on
  (the O overshoots the cap line and the M dips under the baseline; boxing to
  those instead is what makes a round letter read small). That is the drawing.
  It is not the signed-off portrait's rhythm, which holds the message up under
  the lockup and gathers the whole leftover into one field below — different
  card.

## The mark

The MediVasc mark is a **C** — an open ring of atoms — and the flyer sets it at
roughly canvas width, which puts two or three atoms on the page and reads as
texture rather than as a molecule. Here it is pulled back until the network is
legible: the ring arcs in from the right edge with its opening off-canvas.

It is specified by where it lands, not by scale. `span` (0.30) is how far it
reaches in from the right edge, as a fraction of the width. `overflow` (0.05) is
how far it runs past the top and the bottom, as a fraction of the height — and
it is what *sizes* the mark, so the arc breaks both edges by the same amount
whatever height the rhythm solves to.

`overflow` is the real dial, trading atom count against the arc's presence:
filling the height exactly reads as a contained shape sitting in the band; at
0.30 it is a true half-ring, but the atoms are back to being large and few.

The mark is trimmed before it is placed, like the lockup. The file carries
transparent padding around the C, so sizing and placing its raw edge would put
the *artwork* short of where it was asked to reach — the padding, not the ink,
would be breaking the edges.

## What the renderer solves rather than takes as input

- **The size**, against the measure: the three lines are authored, not wrapped
  (`setLine` lays each one out in font units), and the size that fills the column
  exactly is one division rather than a search — ink width is linear in the size,
  and both the advances and the tracking are in font units.
- **The margins.** The stack is set to the column `pad.padX` implies, then the
  left margin is half of what is left over, floored; the right is equal to it by
  construction rather than by arithmetic that rounds.
- **The height.** n lines between the lockup and the destination means n+1 gaps
  — logo→first, line→line, last→destination — plus the call to action's own box
  and the two pads. Rounded to an even number, so nothing that later scales or
  crops the card lands on a half-pixel centre.
- **Capitals have no descender.** A line's box is its cap line to its baseline
  and nothing else (`face.capHeight`); boxing to the font's line height would
  hang a descender's worth of phantom gap under every line and make an evenly
  stepped stack read bottom-heavy.

## Verification

`verify.mjs` gates the write: safe area, flow, and every colour pair against
both the flat surface and the mark tint. Four invariants the composer reports
itself fail the build rather than shipping — a stack that stops filling 82% of
its measure, margins that come out unequal or more than 10px off the one asked
for, a closing gap that drifts more than 2px from the step (the last gap is the
one that absorbs the even-height rounding), and the flush-right edge missing by
more than a pixel.

What it reports on the current card:

```
fill:       longest line fills 100% of the column, floor 82%
alignment:  124 left, 124.0 right, asked for 124
flow:       99.1px before the call to action, the step is 100px
alignment:  "PREVENTION" ends at 1496.0, the column edge is 1496.0
```

The render is byte-reproducible: rerunning `mission.mjs` on an unchanged tree
leaves `mission.png` untouched.

Nothing here ships: `assets/campaign` is not in `src/build.js`'s deploy copy
list, and `medivasc.in/assets/campaign/…` returns 404.
