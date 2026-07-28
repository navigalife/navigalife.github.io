# Combined — every square and X header, both campaigns

Copies, not renders. 24 files: 12 squares (1080 × 1080) and 12 X headers
(1500 × 500), byte-identical to their sources.

| prefix | source | line |
|---|---|---|
| `c1-` | `assets/campaign` | 8 treatments — `Prevent foot & leg amputation` and the poster/field claims |
| `c2-` | `assets/campaign_2` | 4 treatments — `Say no to amputation`, with the ISO prohibition mark |

Re-copy after either campaign is rebuilt:

```sh
cd assets
for f in campaign/*-{square,x-header}.png;   do cp -p "$f" "campaign-combined/c1-$(basename "$f")"; done
for f in campaign_2/*-{square,x-header}.png; do cp -p "$f" "campaign-combined/c2-$(basename "$f")"; done
```

Nothing here ships: `assets/campaign-combined` is not in `src/build.js`'s deploy
copy list.

## `forWhatsapp/` — the files to actually forward

```sh
node assets/campaign-combined/whatsapp.mjs
```

12 JPEGs, 1080 × 1350, 84–141 KB. **Built from the portrait render, not the
square** — a chat bubble is width-constrained, so 4:5 gives 25% more preview
area than 1:1 at the same bubble width, and it is shallower than a stock 3:4
phone photo, which WhatsApp shows uncropped. This is the file that reads in the
bubble without a tap.

Why they are shaped the way they are, and why each is a check in `whatsapp.mjs`
rather than a comment:

- **No resampling.** 1350 px is under WhatsApp's ~1600 px long-edge cap, so a
  standard-quality send does not downscale it. Upscaling to reach the cap would
  interpolate type rendered at its native size — softer, not sharper. The script
  fails if geometry out ≠ geometry in.
- **JPEG at q90 (mozjpeg).** WhatsApp re-encodes to JPEG whatever it is handed;
  a clean high-quality JPEG leaves its compressor almost nothing to do. Measured
  against the PNG source: PSNR 41.5 dB.
- **4:4:4 chroma.** Default 4:2:0 halves colour resolution, which is exactly
  where an accent word in red or terracotta on a flat field picks up fringing.
- **Under 500 KB**, so the send stays in WhatsApp's light-touch band. The script
  fails on anything over.

Send them from the gallery as photos. Do **not** use the HD toggle — at 1080 px
it changes nothing, and it costs the recipient a larger download.
