# Campaign 2 — "Say no to amputation"

The owner asked for one thing: the campaign should say **"Say no to amputation"**,
with a proper *say no to* graphic. This directory is that, across four surfaces
and the same five delivery formats as `assets/campaign`.

```sh
node assets/campaign_2/build.mjs             # render everything
node assets/campaign_2/build.mjs --only 03   # render one treatment
```

Nothing here ships to the live site: `assets/campaign_2` is not in `src/build.js`'s
deploy copy list, and `node src/build.js` leaves `dist` unchanged.

## The phrase

`build.mjs` holds the owner's sentence once, as a constant, and the page is
assembled out of its two halves:

```js
const OWNER_PHRASE = 'Say no to amputation';
copy.lead        = 'Say no to';     // set above the sign
copy.prohibited  = 'amputation';    // set inside it, in caps
```

The build asserts `` `${copy.lead} ${copy.prohibited}` === OWNER_PHRASE `` — exact
string equality, not a fuzzy match — and refuses to render otherwise. So the
campaign cannot be quietly improved into "Prevent amputation" by a later edit,
and the two halves cannot drift apart. The caps inside the sign are
`.toUpperCase()` of the same string, not a second copy of the word.

## The graphic

An **ISO 3864-1 general prohibition sign**, built from the standard's own
proportions in `sign.mjs`:

| | |
|---|---|
| inner ground | 0.80 of the outer diameter |
| red band | 0.10 |
| diagonal bar | 0.10, at exactly 45°, descending left → right |
| red coverage | 36.2% of the sign area — the standard's floor is 35% |

Those are not comments. Each one is computed from what is actually drawn and
reported as a check the build can fail on; the red coverage is the closed-form
area of the annulus plus the chord band the bar contributes inside it, so it is
exact rather than sampled.

**What the sign encloses is the word, and the bar strikes the word and nothing
else.** That is the whole design decision here, and it is review finding 4
written as code. The first generation of these assets stroked a prohibition
slash across an illustration of a foot: a bar through a limb reads as a blade
through the limb, and a prohibition sign drawn over a leg says *legs are
prohibited*. What is being refused is the procedure, so what is enclosed is its
name. `compose.mjs` runs a separating-axis test of the bar against every other
laid-out block and fails the build if it reaches any of them; `sign.mjs` runs the
same test the other way and fails if the bar *misses* the word, because a sign
whose bar does not strike anything is a red ring with a stripe in it.

The enclosed word is measured, not guessed. Its size is solved so its box fits
inside the inner circle with clearance — bisection on the closed form, since
advance width is linear in font size — and then measured for real and checked.
There is also a legibility floor: a sign shrunk until its word is unreadable is
a failure, not a compromise, and the flyer formats set that floor at 3% of the
canvas width.

### The red

`red` is the sign's own colour and is deliberately not a brand token. A
prohibition sign is red; a purple one is a decoration that resembles one. It is
checked against every surface it can land on, which is why the two dark
treatments carry a lighter red — safety red on near-black misses the 3:1 floor
for a large graphic — and why `03-royal`'s field is darker than the flyer set's
royal: at that one's brightest point the red came back at 2.4:1.

The sign's inner ground is near-white on every surface, including the dark ones.
That is the standard's sign, and it is also the only way the word sits on
something other than the field.

## What is on a flyer

Five elements, in reading order:

1. the lockup
2. **the lead** — `Say no to`, with the negation picked out in the sign's red
3. **the sign** — `AMPUTATION`, enclosed and struck
4. one line of support
5. the call to action — a pill: `Visit medivasc.in →`
6. the conditions, as a footer strip

There is no process row. Under a sign this size a four-column diagram is noise,
and `assets/campaign` is where that register belongs. There is no phone number
and no QR: the site carries both, the flyer carries the reason to go there.

The support line is written for this campaign and is deliberately narrow in what
it claims — *"Referred for amputation? Get a second opinion first."* It does not
say amputation is always avoidable and it does not claim a survival benefit.
Asking for a second opinion before consenting is the strongest thing "say no"
can honestly mean on a flyer, and it is the site's own position.

## Treatments

| id | Surface | Lead |
|---|---|---|
| `01-paper` | Warm cream, theme `light` tokens, teal call to action | The site's Fraunces, `no` italic in red |
| `02-ink` | Near-black, theme `dark` tokens, lighter red | The same, inverted |
| `03-royal` | Deep purple gradient field, white lockup, white pill | Tracked caps |
| `04-signal` | Paper, a drift of purple ribbons at the foot, left-aligned | Tracked caps |

`04-signal` is strongest in the tall formats: left-aligned, its sign is bounded
by the height the page has left, so a square canvas leaves more of the right-hand
column open than a portrait or a print page does.

It takes the aurora field rather than the flyer set's lattice for a reason worth
recording — the lattice bleeds the brand mark off the **right** edge, which is
where the header puts the sign. The keep-out zone the lattice declares caught
that collision on the first build, which is the check doing exactly what it is
for.

## Palette and formats

The palette is read from the live site: `data/site-config.json` names a theme,
`data/themes.json` supplies its tokens, and the build throws if the id does not
resolve. Change the site theme, rebuild, and the campaign follows.

| id | Size | Notes |
|---|---|---|
| `x-header` | 1500 × 500 | X/Twitter profile header. Sign right, identity and instruction left, both clear of the profile-avatar overlay. |
| `portrait` | 1080 × 1350 | WhatsApp forward, Instagram feed. |
| `square` | 1080 × 1080 | Instagram / Facebook feed. |
| `story` | 1080 × 1920 | WhatsApp Status, Instagram Story. Extra top/bottom insets clear the platform UI. |
| `a5-print` | 1783 × 2516 @ 300 dpi | A5 handout with 3 mm bleed. Trim box inset 35 px. |

## How the composition fits every format

The layout rules are `assets/campaign`'s, inherited rather than re-invented —
type scales by canvas **width**, gaps by leftover **height**, and the composition
is solved rather than tuned. One rule is this directory's own:

> **The sign takes the height the rest of the composition leaves, up to the
> measure.**

Scaling the sign with the type instead — which is what the first version of
`compose.mjs` did — makes a square canvas shrink everything at once: small type
*and* a small sign, with a third of the width unused. Sizing it from leftover
height keeps the type at full size and lets the graphic absorb the difference
between a square and a story. Below a floor (40% of the measure) the graphic has
stopped being the page, and *then* the type is what gives — that floor is a
check, so a canvas that can hold neither fails the build rather than quietly
rendering a badge.

## What the build checks

`verify.mjs` — `assets/campaign`'s, unmodified — runs against the computed layout
of every asset before anything is rasterised: safe area (measured from the trim
box on print), flow, WCAG AA contrast on every surface the type can land on, and
declared platform chrome. On top of it this composition reports:

- the sign's five geometry, coverage, fit, legibility and strike invariants
- the bar does not strike any block except the word
- the sign still holds the page (its floor, above)
- every block is centred to the pixel, on the centred treatments
- the header's column clears both the profile avatar and the sign
- no block sits on a background field's dense zone

Failures exit non-zero and write nothing — including the contact sheet, so a
half-verified set cannot be reviewed as if it were finished.

Three of those caught real defects during this build: the safe-area check caught
the header's sign hanging 3 px over the top margin (it was centred on the canvas,
whose top and bottom margins are not equal); the contrast check caught the red at
2.4:1 on the royal field; the fit check caught the word's box sitting 0.08 em low
and putting a corner 1 px outside the ground.

## Shared code

`text.mjs`, `verify.mjs`, `field.mjs`, `mark.mjs`, the claim/footer helpers in
`poster.mjs` and the call-to-action pill in `composer.mjs` are imported from
`assets/campaign`, not copied. A second copy of a verified layout engine is a
second engine to keep correct. The only change made there was exporting
`ctaPill`, which was already module-private for no reason.
