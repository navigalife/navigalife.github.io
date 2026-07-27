# Mission card — 3:2, INK

```sh
node assets/campaign/mission.mjs
```

Owner-drawn layout (2026-07-27) on the signed-off `02-ink` surface: logo,
`MISSION`, the mission, one destination, a rule. Nothing else — no body
paragraph, no conditions strip, no reason-to-act-now. A mission card says what
the practice is for, once.

1620 × 1080. The short edge is the campaign's own 1080, so the type scale
carries over from the signed-off portrait instead of being re-guessed.

| file | voice | claim | rhythm |
|---|---|---|---|
| `mission-sketch.png` | Instrument Sans caps | `FOOT & LEG AMPUTATION` / `PREVENTION` | even |
| `mission-serif-caps.png` | Fraunces caps | same | even |
| `mission-serif.png` | Fraunces, sentence case | `Foot & leg` / `amputation` / `prevention` | collected |

## What the drawing settled

- **Caps.** The sketch is capitals and it means them: `medivasc.in` is written
  lowercase inside an otherwise capitalised line, so the case is authored, not
  handwriting habit. `mission-serif.png` keeps the sentence-case setting for
  comparison; it is the flyer's voice, not the drawing's.
- **An even rhythm.** `MISSION`, each claim line and the destination sit one
  ruled line apart, all the way down the page. That is a different composition
  from the signed-off portrait — message up under the lockup, the whole leftover
  gathered into one field, footer on the base — and both are here, as `even` and
  `collected`. What is never right is spreading slack across some gaps and not
  others.
- **Two claim lines, not three.** The three-line setting is a design proposal,
  not the drawing.

`PREVENTION` sets flush right; that is the owner's correction to the drawing,
which had it flush left with everything else.

## What the renderer solves rather than takes as input

- **The claim size**, against the *box*: authored line breaks are honoured
  (`setAuthored`, not `balanceRuns` — re-wrapping would discard them), and three
  short lines are height-bound on a 3:2 canvas while two long ones are
  width-bound. That is the whole difference between the settings.
- **Two column edges.** Flush-left lines run to `measure`; the flush-right line
  hangs to `rightMeasure`. They differ only where they must — in the three-line
  setting `prevention` is itself the longest line, so aligning it to the left
  lines' own edge would move it by nothing.
- **Capitals have no descender.** Measuring them with the line box's 26%
  descender allowance puts a phantom gap under every line and makes an evenly
  stepped stack look bottom-heavy, so each voice declares its own visual height.

Verified by the campaign's own `verify.mjs` before anything is written: safe
area, flow, and every colour pair against both the flat surface and the mark
tint. Two invariants the composer reports itself — a claim that stops filling
82% of its column, and an even rhythm whose step falls under 40px — fail the
build rather than shipping.

Nothing here ships: `assets/campaign` is not in `src/build.js`'s deploy copy
list.
