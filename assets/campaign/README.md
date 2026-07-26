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

## Nothing here is retyped from the site

Anything that could drift from the live site is read from the site's own data at
build time:

- **Palette** — the theme named by `data/site-config.json` is looked up in
  `data/themes.json` and its tokens are used directly. Switching the site theme
  and rebuilding re-colours the whole campaign. The build throws if the theme id
  does not resolve.
- **Headline** — `heroHeadline` and `heroAccent` from `data/site-config.json`.
  The accent word is matched by word, not position, so an admin edit flows
  through. The build throws if the accent word is absent from the headline.
- **Contact details** — `whatsapp`, `email` and `address` from
  `data/company.json`. The phone is formatted and the `wa.me` link and QR code
  are derived from the same field, so they cannot disagree.
- **Logo** — `assets/brand/logo-{ink,paper}-tm-lg.png`, the same lockup files
  the site ships.

## What the build checks

`verify.mjs` runs against the computed layout of each asset before rasterising:

1. **Safe area** — every laid-out block sits inside the format's margins. Print
   measures from the trim box, not the bleed edge.
2. **Artwork overlap** — no text block may enter the reserved illustration
   column. The column is a first-class part of the layout, and text columns are
   narrowed to clear it.
3. **Flow** — the top stack cannot collide with the bottom contact block.
4. **Contrast** — every foreground/background pair clears the WCAG AA floor
   (4.5:1, or 3:1 for large text).
5. **Platform chrome** — declared obstructions (currently the X avatar) must not
   cover any content.

`qr.mjs` self-tests on every build: it checks that all Reed-Solomon syndromes of
the finished codeword are zero, then reads the rendered matrix back the way a
scanner would and asserts it decodes to the original URL.

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

## Artwork

`artwork/` holds the three isolated illustrations. Each is a limb ending in a
hard horizontal crop, so `prepareArt` dissolves the cut edge with an alpha ramp
— on an amputation-prevention flyer a flat-cut limb reads as a stump.

Nothing is drawn on top of the illustrations. In particular, `02` uses a
protective cradle emblem, and stroking a prohibition slash across it (as an
earlier build did) reads as a blade through the limb and inverts the message.
