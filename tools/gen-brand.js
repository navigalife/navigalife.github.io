// Regenerates brand assets derived from the owner's logo lockup.
// Chain: tools/prepare-brand.js (owner PNG -> logo-full.png + marks/favicons)
//        -> this script (logo-full.png -> tinted header lockups + OG image).
// Supersedes tools/prepare-og.js (the OG card is now the lockup itself, so the
// header and social card can never drift apart). Run: node tools/gen-brand.js
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const BRAND = path.join(ROOT, 'assets', 'brand');

const INK = '#1C2B2E';
const PAPER = '#EAF2F0';
const OG_BG = '#FAF7F2';

const tintedLockup = async (color, width) => {
  const trimmed = await sharp(path.join(BRAND, 'logo-full.png')).trim().png().toBuffer();
  const resized = await sharp(trimmed).resize({ width }).png().toBuffer();
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
  const ink = await tintedLockup(INK, 720);
  const paper = await tintedLockup(PAPER, 720);
  await sharp(ink.buffer).toFile(path.join(BRAND, 'logo-ink.png'));
  await sharp(paper.buffer).toFile(path.join(BRAND, 'logo-paper.png'));

  const ogLockup = await tintedLockup(INK, 640);
  const kicker = Buffer.from(
    `<svg width="1200" height="630">
      <text x="600" y="520" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="30" font-weight="600" letter-spacing="6" fill="#0F5E68">PREVENTION OF FOOT AND LEG AMPUTATION</text>
    </svg>`,
  );
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: OG_BG } })
    .composite([
      { input: ogLockup.buffer, left: Math.round((1200 - ogLockup.meta.width) / 2), top: 100 },
      { input: kicker, left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(BRAND, 'og-image.png'));
  console.log('Brand assets regenerated: logo-ink, logo-paper, og-image.');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
