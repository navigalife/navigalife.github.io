// Regenerates the brand lockups the site renders, from the new-font masters.
//
// Chain: tools/prepare-brand.js (owner PNG -> logo-full.png + mark-only
//        favicons/icons — those carry NO wordmark, so they are font-agnostic)
//        -> this script (logo_newfont masters -> tinted site lockups + OG card).
//
// Source of truth is assets/brand/logo_newfont/ — the Exotc350 (Peignot) lockup
// family, shipped as OUTLINES so the commercial font never has to live in this
// repo. We source the *mono black* variants and repaint them: the masters are
// flat #0C0C0C on transparency, so the alpha channel is the artwork and a
// tint = flat fill + that alpha. Colour variants (purple / gradient) exist in
// logo_newfont/ but the website lockup is deliberately monochrome.
//
// Emits (all resized to a common LOCKUP_H so the header/footer scale ratio
// matches what the CSS was tuned against):
//   logo-ink.png  logo-paper.png              plain lockup, light / dark bg
//   logo-{ink,paper}-tm.png                   ™ at the c's shoulder (base size)
//   logo-{ink,paper}-tm-lg.png                ™ one step larger (desktop footer)
//   og-image.png                              1200x630 social card
//
// Run: node tools/gen-brand.js   (then `node src/build.js`)
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const BRAND = path.join(ROOT, 'assets', 'brand');
const NEWFONT = path.join(BRAND, 'logo_newfont');

const INK = '#1C2B2E';
const PAPER = '#EAF2F0';
const OG_BG = '#FAF7F2';

// Rendered height of every stored lockup. The build downsamples to 512px wide
// and the CSS drives display height, so this only sets source resolution — but
// resizing all variants to the SAME height (not the same width) is what keeps
// the plain and ™ lockups at their historical relative scale.
const LOCKUP_H = 640;

// name in logo_newfont/ -> stored basename in assets/brand/
const MASTERS = [
  ['MediVasc-logo-black.png', ''],
  [path.join('logo_tm', 'MediVasc-logo-black-tm.png'), '-tm'],
  [path.join('logo_tm', 'MediVasc-logo-black-tm-lg.png'), '-tm-lg'],
];

// Trim the master's transparent padding, scale to `height`, then repaint the
// alpha with a flat colour.
const tintedLockup = async (master, color, { height, width } = {}) => {
  const trimmed = await sharp(master).trim().png().toBuffer();
  const resized = await sharp(trimmed).resize(width ? { width } : { height }).png().toBuffer();
  const meta = await sharp(resized).metadata();
  const alpha = await sharp(resized).extractChannel(3).toBuffer();
  return {
    meta,
    buffer: await sharp({
      create: { width: meta.width, height: meta.height, channels: 3, background: color },
    })
      .joinChannel(alpha)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  };
};

const run = async () => {
  for (const [master, suffix] of MASTERS) {
    const src = path.join(NEWFONT, master);
    const ink = await tintedLockup(src, INK, { height: LOCKUP_H });
    const paper = await tintedLockup(src, PAPER, { height: LOCKUP_H });
    await sharp(ink.buffer).toFile(path.join(BRAND, `logo-ink${suffix}.png`));
    await sharp(paper.buffer).toFile(path.join(BRAND, `logo-paper${suffix}.png`));
    console.log(`logo-{ink,paper}${suffix}.png  ${ink.meta.width}x${ink.meta.height}`);
  }

  // OG card: the lockup itself, so the social card and the header can never
  // drift apart. Sized/placed to sit optically centred above the kicker.
  const ogLockup = await tintedLockup(path.join(NEWFONT, 'MediVasc-logo-black.png'), INK, {
    width: 620,
  });
  const kicker = Buffer.from(
    `<svg width="1200" height="630">
      <text x="600" y="525" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="30" font-weight="600" letter-spacing="6" fill="#0F5E68">PREVENTION OF FOOT AND LEG AMPUTATION</text>
    </svg>`,
  );
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: OG_BG } })
    .composite([
      {
        input: ogLockup.buffer,
        left: Math.round((1200 - ogLockup.meta.width) / 2),
        top: Math.round((470 - ogLockup.meta.height) / 2),
      },
      { input: kicker, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(BRAND, 'og-image.png'));
  console.log(`og-image.png  lockup ${ogLockup.meta.width}x${ogLockup.meta.height}`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
