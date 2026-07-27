# Campaign 2 — "Say no to amputation"

Two things had to be on these assets: the owner's instruction, **"Say no to
amputation"**, with a proper *say no to* graphic, and the clinic's own line,
**"Prevention of foot & leg amputation"**, said explicitly. Four surfaces, the
same five delivery formats as `assets/campaign`.

```sh
node assets/campaign_2/build.mjs             # render everything
node assets/campaign_2/build.mjs --only 03   # render one treatment
```

Nothing here ships to the live site: `assets/campaign_2` is not in `src/build.js`'s
deploy copy list, and `node src/build.js` leaves `dist` unchanged.

## The two lines, and why neither can drift

```js
const OWNER_PHRASE = 'Say no to amputation';
copy.claim   = ['Say no to', 'amputation.'];         // authored line breaks
copy.eyebrow = 'PREVENTION OF FOOT & LEG AMPUTATION';
```

The claim's phrases are joined, the full stop dropped, and the result asserted
**equal to `OWNER_PHRASE`** by string equality. The build refuses to render
otherwise, so the campaign cannot be quietly improved into "Prevent amputation"
by a later edit, and a caps treatment gets its capitals from `.toUpperCase()` of
those same strings rather than from a second copy outside the check.

The eyebrow is asserted against the first sentence of `data/company.json`'s
tagline — *"Prevention of foot and leg amputation."* — normalising `&` to `and`,
since that is a typesetting choice and not a difference in what is claimed. If
the owner rewrites the tagline in the admin CMS, this build fails by name rather
than advertising a practice the site no longer describes.

## The graphic

An **ISO 3864-1 general prohibition sign** (P001), built from the standard's own
proportions in `sign.mjs`:

| | |
|---|---|
| inner ground | 0.80 of the outer diameter |
| red band | 0.10 |
| diagonal bar | 0.10, at exactly 45°, descending left → right |
| red coverage | 36.2% of the sign area — the standard's floor is 35% |

Those are not comments. Each is computed from what is actually drawn and
reported as a check the build can fail on; the red coverage is the closed-form
area of the annulus plus the chord band the bar contributes inside it, so it is
exact rather than sampled.

**It is a mark, not the page.** The first version of this set made the sign the
hero — most of a measure across, with the word AMPUTATION inside it and struck.
It was legible, it was correct, and it read as a warning label rather than as a
clinic's flyer. At about a fifth of the measure the sign does what a *say no to*
graphic is for: it says *no* before the sentence does, and the words carry the
message.

**Its ground is empty, and the bar strikes nothing.** That is review finding 4
written as code. The rejected set stroked a prohibition slash across an
illustration of a foot — a bar through a limb reads as a blade through it, and a
prohibition sign over a leg says *legs are prohibited*. `compose.mjs` runs a
separating-axis test of the bar against every laid-out block on the page and
fails the build if it reaches any of them.

### The red

`red` is the sign's own colour and is deliberately not a brand token. A
prohibition sign is red; a purple one is a decoration that resembles one. It is
checked against every surface it can land on — the field *and* its own ground —
at the 3:1 non-text floor (WCAG 1.4.11: a graphic element is not text, and
sizing it in points to reach a text threshold would be a fiction). That check is
why the two dark treatments carry a lighter red, and why `03-royal`'s field is
darker than the flyer set's royal: at that one's brightest point the red came
back at 2.4:1.

## What is on a flyer

Six elements, in reading order:

1. the lockup
2. **the eyebrow** — `PREVENTION OF FOOT & LEG AMPUTATION`
3. **the sign**
4. **the claim** — `Say no to amputation.`, the negation in the sign's red, and
   italic where the claim is set in the site's serif
5. one line of support
6. the call to action — a pill: `Visit medivasc.in →` — over the conditions strip

There is no process row. `assets/campaign` is where that register belongs, and
under a claim this size a four-column diagram is noise. There is no phone number
and no QR: the site carries both, the flyer carries the reason to go there.

The support line is deliberately narrow in what it claims — *"Referred for
amputation? Get a second opinion first."* It does not say amputation is always
avoidable and it does not claim a survival benefit. Asking for a second opinion
before consenting is the strongest thing "say no" can honestly mean on a flyer,
and it is the site's own position.

## Treatments

| id | Surface | Claim voice |
|---|---|---|
| `01-paper` | Warm cream, theme `light` tokens, teal call to action | The site's Fraunces, `no` italic in red |
| `02-ink` | Near-black, theme `dark` tokens, lighter red | The same, inverted |
| `03-royal` | Deep purple gradient field, white lockup, white pill | Caps sans |
| `04-signal` | Paper, a drift of purple ribbons at the foot, left-aligned | Caps sans |

`04-signal` takes the aurora field rather than the flyer set's lattice for a
reason worth recording: the lattice bleeds the brand mark off the **right** edge,
which is where the header puts its right-hand group. The keep-out zone the
lattice declares caught that collision on the first build, which is the check
doing exactly what it is for.

## Palette and formats

The palette is read from the live site: `data/site-config.json` names a theme,
`data/themes.json` supplies its tokens, and the build throws if the id does not
resolve. Change the site theme, rebuild, and the campaign follows.

| id | Size | Notes |
|---|---|---|
| `x-header` | 1500 × 500 | X/Twitter profile header. |
| `portrait` | 1080 × 1350 | WhatsApp forward, Instagram feed. |
| `square` | 1080 × 1080 | Instagram / Facebook feed. |
| `story` | 1080 × 1920 | WhatsApp Status, Instagram Story. Extra top/bottom insets clear the platform UI. |
| `a5-print` | 1783 × 2516 @ 300 dpi | A5 handout with 3 mm bleed. Trim box inset 35 px. |

## How the composition fits every format

The layout rules are `assets/campaign`'s, inherited rather than re-invented —
type scales by canvas **width**, gaps by leftover **height**, the composition is
solved rather than tuned, and leftover air is split evenly above and below the
stack. Two rules are this directory's own:

- **The sign is a fixed fraction of the measure** (a fifth), so it keeps the same
  optical weight on a square as on an A5 sheet. Sizing it from leftover height
  instead — which the hero version did — makes the graphic swell on a story and
  shrink on a square, which is the opposite of what a mark should do.
- **The claim gets its own measure**, about three quarters of the page's. Two
  short lines set across a full measure either fill it at a size the page cannot
  carry or sit in it at 59% and read as a headline that lost its nerve. The fill
  floor is a check, so the second failure mode stops the build.

### The header

The first version of the X header put a full-height sign hard against the right
margin and a short column against the left, and left a third of the banner as a
hole in the middle. What closes it is giving the claim the room: the sign and the
pill are stacked into one right-hand group, its width is measured first, and the
left column measures out to it with the claim solved to fill that on one line.
The conditions run along the bottom of the column — the one band of an X header
that is always visible and otherwise dead.

The column is measured against the profile avatar rather than the canvas: X draws
the avatar over the bottom-left corner, and content placed there is permanently
hidden for every visitor.

## What the build checks

`verify.mjs` runs against the computed layout of every asset before anything is
rasterised: safe area (measured from the trim box on print), flow, WCAG contrast
on every surface the type can land on, and declared platform chrome. On top of it
this composition reports:

- the sign's geometry, red coverage, and minimum legible size
- the bar strikes nothing
- the claim fills its measure
- every block is centred to the pixel, on the centred treatments
- the header's column clears the avatar, the sign, the call to action, and the
  conditions strip
- no block sits on a background field's dense zone

Failures exit non-zero and write nothing — including the contact sheet, so a
half-verified set cannot be reviewed as if it were finished. Real defects it
caught while this was being built: the header's sign hanging 3 px over the top
margin (it was centred on the canvas, whose top and bottom margins are not
equal); the red at 2.4:1 on the royal field; the claim covering 59% of its
measure once the sign stopped being the page.

## Shared code

`text.mjs`, `verify.mjs`, `field.mjs`, `mark.mjs`, the claim and footer registers
in `poster.mjs`, and the call-to-action pill and claim voices in `composer.mjs`
are imported from `assets/campaign`, not copied. A second copy of a verified
layout engine is a second engine to keep correct. Three changes were made there,
all additive: `ctaPill` and `CLAIM_VOICE` are now exported, and a contrast pair
may declare its own floor.
