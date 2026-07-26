# MediVasc campaign assets

Three surface treatments rendered across five delivery formats, all from one
layout engine.

```sh
node assets/campaign/build.mjs             # render everything
node assets/campaign/build.mjs --only 02   # render one treatment
```

The build is a verification gate, not just a renderer. It exits non-zero and
writes nothing if any asset fails its checks, so a broken file cannot reach the
`assets/campaign/` directory silently.

## What is on a flyer

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

## Copy

Campaign copy is **written for the flyer, not lifted from the site**. A page has
a reader who already arrived and is scrolling; a flyer has about two seconds of a
stranger's attention, so it leads with the instruction rather than the
proposition: what can be done, who it is for, where to go.

All of it is the `copy` object at the top of `build.mjs` — five values, one
place. The build throws if the accent word is not present in the headline.

The palette is still read from the site: `data/site-config.json` names a theme,
`data/themes.json` supplies its tokens, and the build throws if the id does not
resolve. Change the site theme, rebuild, and the campaign follows.

## Treatments and formats

| id | Surface |
|---|---|
| `01-paper` | Warm cream, ink type (theme `light` tokens) |
| `02-ink` | Near-black, paper type (theme `dark` tokens) |
| `03-pine` | Pine gradient, paper type |

| id | Size | Notes |
|---|---|---|
| `x-header` | 1500 × 500 | X/Twitter profile header. Keeps content clear of the profile-avatar overlay in the bottom-left. |
| `portrait` | 1080 × 1350 | WhatsApp forward, Instagram feed. |
| `square` | 1080 × 1080 | Instagram / Facebook feed. |
| `story` | 1080 × 1920 | WhatsApp Status, Instagram Story. Extra top/bottom insets clear the platform UI. |
| `a5-print` | 1783 × 2516 @ 300 dpi | A5 handout with 3 mm bleed on all sides. Trim box is inset 35 px; all content sits well inside it. |

## The graphic

The campaign's only graphic is **the lockup's own molecule mark**, set oversized,
recoloured to a tint just off the background, and bled off the canvas edges.

Earlier versions used illustrated limbs. They read as stock imagery bolted onto
an editorial layout — and an illustrated limb ending in a flat crop is, on an
amputation-prevention flyer, a stump. The mark cannot look out of place on its
own brand, and because it is tonal rather than pictorial the type runs full width
across it.

`markTint` is a per-treatment colour. It is checked: every text colour must clear
the contrast floor against **both** the flat background and the mark tint.

## What the build checks

`verify.mjs` runs against the computed layout of each asset before rasterising:

1. **Safe area** — every laid-out block sits inside the format's margins. Print
   measures from the trim box, not the bleed edge.
2. **Flow** — the message block cannot collide with the footer.
3. **Contrast** — every foreground colour clears the WCAG AA floor (4.5:1, or
   3:1 for large text) on both surfaces it can land on.
4. **Platform chrome** — declared obstructions (currently the X avatar) must not
   cover any content.

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

## History

The illustrated artwork (`artwork/`, three PNGs) and a self-contained QR encoder
(`qr.mjs`) were part of earlier revisions and are recoverable from git —
`assets/campaign/` at commit `6a68692`.
