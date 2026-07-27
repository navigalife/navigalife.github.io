# Mission card — 3:2, INK

```sh
node assets/campaign/mission.mjs
```

Owner-drawn layout (2026-07-27), on the signed-off `02-ink` surface: logo,
`MISSION`, the mission, one destination, a rule. No body paragraph, no
conditions strip, no reason-to-act-now — a mission card says what the practice
is for, once.

1620 × 1080. The short edge is the campaign's own 1080, so the type scale
carries over from the signed-off portrait instead of being re-guessed.

| file | claim | measure | why |
|---|---|---|---|
| `mission-a.png` | `Foot & leg amputation` / `prevention` | 68% of the column | the sketch as drawn — two lines, the point on its own |
| `mission-b.png` | `Foot & leg` / `amputation` / `prevention` | 50% | three short lines take a far larger setting and fill the canvas |

Two things the renderer solves rather than takes as input:

- **The claim size.** Authored line breaks are honoured (`setAuthored`, not
  `balanceRuns` — re-wrapping would discard them), and the size is solved
  against the *box*, not the column. Three short lines are height-bound on a 3:2
  canvas, two long ones width-bound; that is the entire difference between the
  variants, and it is why `b` gets a narrower measure — a wide column it cannot
  fill at any size that also fits.
- **Where the leftover goes.** A height-bound setting has none. A width-bound
  one does, and dropping all of it below the message opens a hole the mark
  cannot fill on a canvas this shallow, so a third of it is lifted above.

Verified by the campaign's own `verify.mjs` before anything is written: safe
area, flow, and every colour pair against both the flat surface and the mark
tint. A claim that no longer fills 82% of its measure fails the build rather
than shipping small.

Nothing here ships — `assets/campaign` is not in `src/build.js`'s deploy copy
list.
