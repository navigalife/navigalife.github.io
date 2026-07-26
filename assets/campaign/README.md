# MediVasc campaign assets

Four surface treatments rendered across five delivery formats, from one layout
engine and two compositions — an editorial column (`01`–`03`) and a poster
(`04`).

```sh
node assets/campaign/build.mjs             # render everything
node assets/campaign/build.mjs --only 02   # render one treatment
```

The build is a verification gate, not just a renderer. It exits non-zero and
writes nothing if any asset fails its checks, so a broken file cannot reach the
`assets/campaign/` directory silently.

## What is on a flyer

### The editorial treatments (`01`–`03`)

Five elements, in this reading order, and nothing else:

1. the lockup
2. **the instruction** — `Prevent foot & leg amputation`, with the verb set
   italic in the accent colour
3. one supporting line
4. the conditions, set small
5. **the call to action** — `Get in touch — medivasc.in today →`, last on the
   page so it is the final thing read

No phone number, no WhatsApp block, no QR code, no address. If something is
being added here, the question to answer first is which of the five it is more
important than.

### The poster (`04-violet`)

Same restraint, more registers, because a forwarded flyer has to answer "is this
for me?" without a second screen:

1. the lockup
2. **the claim** — `PREVENT AMPUTATION. KEEP WALKING.`, caps, with the second
   half of each clause in the brand purple
3. one supporting line
4. **the process** — four pillars, read off `data/protocols.json`
5. **the call to action** — a filled bar: `medivasc.in` on the left,
   `REFERRED FOR AMPUTATION? TALK TO US FIRST.` on the right
6. the conditions, as a footer strip

Still no phone number and no QR. The site carries both, the flyer carries the
reason to go there.

The claim is deliberately not `PRESERVE LIFE`: the site claims limb preservation
and a return to independence, and it does not claim a mortality benefit. `KEEP
WALKING.` is the strongest line the site's own copy supports.

## Copy

Campaign copy is **written for the flyer, not lifted from the site**. A page has
a reader who already arrived and is scrolling; a flyer has about two seconds of a
stranger's attention, so it leads with the instruction rather than the
proposition: what can be done, who it is for, where to go.

All of it is the `copy` object at the top of `build.mjs` — one place. The build
throws if the accent word is not present in the headline.

The poster's process row is the exception, and it is not copy: the four pillars
are short forms of the four engagement steps every protocol in
`data/protocols.json` shares, and each caption declares the step it summarises.
Change or drop a step on the site and the build fails by name rather than letting
the flyer describe a process the clinic no longer follows.

The palette is still read from the site: `data/site-config.json` names a theme,
`data/themes.json` supplies its tokens, and the build throws if the id does not
resolve. Change the site theme, rebuild, and the campaign follows.

## Treatments and formats

| id | Surface |
|---|---|
| `01-paper` | Warm cream, ink type (theme `light` tokens) |
| `02-ink` | Near-black, paper type (theme `dark` tokens) |
| `03-pine` | Pine gradient, paper type |
| `04-violet` | Poster: near-white paper, caps claim, brand purple |

`04-violet`'s purple is the brand mark's own `#582078`, sampled from the owner's
original logo — not a theme token. The website lockup is monochrome by owner rule
(`AGENTS.md`) and the purple lives on collateral, which is what this is. Its ink,
paper and muted values still track the theme.

| id | Size | Notes |
|---|---|---|
| `x-header` | 1500 × 500 | X/Twitter profile header. Keeps content clear of the profile-avatar overlay in the bottom-left. |
| `portrait` | 1080 × 1350 | WhatsApp forward, Instagram feed. |
| `square` | 1080 × 1080 | Instagram / Facebook feed. |
| `story` | 1080 × 1920 | WhatsApp Status, Instagram Story. Extra top/bottom insets clear the platform UI. |
| `a5-print` | 1783 × 2516 @ 300 dpi | A5 handout with 3 mm bleed on all sides. Trim box is inset 35 px; all content sits well inside it. |

## The graphic

The editorial treatments' only graphic is **the lockup's own molecule mark**, set oversized,
recoloured to a tint just off the background, and bled off the canvas edges.

Earlier versions used illustrated limbs. They read as stock imagery bolted onto
an editorial layout — and an illustrated limb ending in a flat crop is, on an
amputation-prevention flyer, a stump. The mark cannot look out of place on its
own brand, and because it is tonal rather than pictorial the type runs full width
across it.

`markTint` is a per-treatment colour. It is checked: every text colour must clear
the contrast floor against **both** the flat background and the mark tint.

The poster has no background mark. Its field is its own white space, and a tonal
graphic under a symmetric composition muddies it; the four icon discs and the
purple bar are already carrying the colour. A treatment sets `mark: null` and the
mark layer is skipped.

## What the build checks

`verify.mjs` runs against the computed layout of each asset before rasterising:

1. **Safe area** — every laid-out block sits inside the format's margins. Print
   measures from the trim box, not the bleed edge.
2. **Flow** — the message block cannot collide with the footer.
3. **Contrast** — every foreground colour clears the WCAG AA floor (4.5:1, or
   3:1 for large text) on both surfaces it can land on.
4. **Platform chrome** — declared obstructions (currently the X avatar) must not
   cover any content.
5. **The composer's own invariants** — a layout knows things a rectangle does
   not. The poster reports whether its four columns are evenly pitched, whether
   each caption stayed inside its column, whether the two halves of the call to
   action still clear the divider, whether the claim still fills its measure, and
   whether every centred block is actually centred to the pixel. Any of them
   coming back false is a failed build.

These are not decorative. Check 4 caught the call to action disappearing under
the X avatar after a two-point headline increase; check 3 caught the terracotta
accent failing AA on the paper surface at CTA size, which is why the call to
action has its own `link` colour; check 1 caught footer descenders hanging past
the bottom margin.

## Typography

`text.mjs` measures text by rasterising and scanning the alpha channel, because
librsvg exposes no metrics API. Every word is then positioned at an absolute
`x`. Two consequences worth knowing:

- No whitespace is load bearing. An earlier generation of these assets built
  lines from `<tspan>` runs with literal spaces at the boundaries; SVG collapsed
  them, and "the only way out" shipped as "theonly way out" on every file. That
  failure mode is now unrepresentable.
- Headlines are wrapped at every width that produces the same number of lines,
  and the candidates are scored on evenness plus a penalty for ending a line on a
  weak word. The most even break for this headline is `Prevent foot & / leg
  amputation`, which hangs an ampersand off the line end; scoring picks `Prevent
  foot & leg / amputation` instead.

Vertically, the message sits high under the lockup and the leftover height
becomes one quiet field carrying the mark. Distributing that slack across the
gaps instead opens two separate voids, which reads as a mistake.

## How the poster fits every format

`poster.mjs` keeps two scales apart, and that separation is the whole trick:

- **type scale** — proportional to canvas *width*. Everything that has to fit
  between two margins is sized by it. Scaling type by height instead is how a
  caption ends up wider than its column on a 1080 × 1920 story.
- **gap expansion** — proportional to leftover *height*. A taller canvas gets
  more air between registers, never bigger type.

The composition is then solved rather than tuned. Registers are measured at full
size; if they overflow the canvas the type scale shrinks until they fit, and if
they underfill it the gaps open. There is no table of per-format numbers, and no
format that "nearly" fits — a canvas that cannot hold the composition fails the
flow check instead.

Three consequences worth knowing:

- The claim's line breaks are **authored** (`['PREVENT', 'AMPUTATION.', 'KEEP
  WALKING.']`), because where a poster headline breaks is a design decision. A
  format that wants fewer lines merges adjacent phrases at the split that evens
  the lines — the X header sets the same claim as two lines without a second
  string to keep in sync. The *size* is solved so the longest line lands on the
  measure.
- The call to action solves its own internal scale: both groups are measured and
  the type inside the bar shrinks until the gap between them clears its floor, so
  longer copy sets tighter rather than crowding the divider.
- The X header is composed **around** the profile avatar rather than merely
  avoiding it. The left column's height is measured against the avatar's top
  edge, and the conditions strip is aligned to the call-to-action panel's left
  edge — the one band of an X header that is always visible and otherwise dead.

## History

The illustrated artwork (`artwork/`, three PNGs) and a self-contained QR encoder
(`qr.mjs`) were part of earlier revisions and are recoverable from git —
`assets/campaign/` at commit `6a68692`.
