# MediVasc campaign assets

Three campaign directions rendered across five delivery formats, all from one
layout engine.

```sh
node assets/campaign/build.mjs             # render everything
node assets/campaign/build.mjs --only 02   # render one direction
```

The build is a verification gate, not just a renderer. It exits non-zero and
writes nothing if any asset fails its checks, so a broken file cannot reach the
`assets/campaign/` directory silently.

## What is on a flyer

Five elements, and nothing else:

1. the lockup
2. the headline, with one italic accent word
3. one supporting line
4. the conditions, set small
5. `medivasc.in`

No phone number, no WhatsApp block, no QR code, no address. The backgrounds are
flat — no waves, halos, rules or edge bars. If something is being added here, the
question to answer first is which of the five it is more important than.

## Directions

| id | Reads as | Surface |
|---|---|---|
| `01-protective` | Calm, clinical protection | Light (theme `light` tokens) |
| `02-standing-ground` | Firm, serious, a limb held safe | Dark (theme `dark` tokens) |
| `03-every-step` | Forward motion, independence regained | Pine gradient |

## Formats

| id | Size | Notes |
|---|---|---|
| `x-header` | 1500 × 500 | X/Twitter profile header. Keeps content clear of the profile-avatar overlay in the bottom-left. |
| `portrait` | 1080 × 1350 | WhatsApp forward, Instagram feed. |
| `square` | 1080 × 1080 | Instagram / Facebook feed. |
| `story` | 1080 × 1920 | WhatsApp Status, Instagram Story. Extra top/bottom insets clear the platform UI. |
| `a5-print` | 1783 × 2516 @ 300 dpi | A5 handout with 3 mm bleed on all sides. Trim box is inset 35 px; all content sits well inside it. |

## Copy

Campaign copy is **written for the flyer, not lifted from the site**. A page has
a reader who already arrived and is scrolling; a flyer has about two seconds of a
stranger's attention, so it carries one claim and one line of support.

All of it is the `copy` object at the top of `build.mjs` — four values, one
place. The build throws if the accent word is not present in the headline.

The palette is still read from the site: `data/site-config.json` names a theme,
`data/themes.json` supplies its tokens, and the build throws if the id does not
resolve. Change the site theme, rebuild, and the campaign follows.

## What the build checks

`verify.mjs` runs against the computed layout of each asset before rasterising:

1. **Safe area** — every laid-out block sits inside the format's margins. Print
   measures from the trim box, not the bleed edge.
2. **Artwork overlap** — no text block may enter the reserved illustration
   column. The column is a first-class part of the layout, and text columns are
   narrowed to clear it.
3. **Flow** — the top stack cannot collide with the footer.
4. **Contrast** — every foreground/background pair clears the WCAG AA floor
   (4.5:1, or 3:1 for large text).
5. **Platform chrome** — declared obstructions (currently the X avatar) must not
   cover any content.

These are not decorative. Check 5 caught the site line disappearing under the X
avatar after a two-point headline size increase; check 1 caught footer
descenders hanging past the margin.

## Typography

`text.mjs` measures text by rasterising and scanning the alpha channel, because
librsvg exposes no metrics API. Every word is then positioned at an absolute
`x`. Two consequences worth knowing:

- No whitespace is load bearing. An earlier generation of these assets built
  lines from `<tspan>` runs with literal spaces at the boundaries; SVG collapsed
  them, and "the only way out" shipped as "theonly way out" on every file. That
  failure mode is now unrepresentable.
- Headlines are wrapped, then re-wrapped at the narrowest width that yields the
  same number of lines, which evens out the line lengths and avoids stranding a
  single word on the last line.

Vertical rhythm is justified rather than fixed: the gaps between logo, headline,
support line and footer share the leftover height in proportion, so no format
pools its slack into one slab.

## Artwork

`artwork/` holds the three isolated illustrations. Each is a limb ending in a
hard horizontal crop, so `prepareArt` dissolves the cut edge with an alpha ramp
— on an amputation-prevention flyer a flat-cut limb reads as a stump.

Nothing is drawn on top of the illustrations. In particular, `02` uses a
protective cradle emblem, and stroking a prohibition slash across it (as an
earlier build did) reads as a blade through the limb and inverts the message.
