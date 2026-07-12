/**
 * One-off brand pipeline: owner-assets/MediVasc_Logo.PNG -> assets/brand/*
 *
 * The supplied logo is black art on near-white. We derive an alpha mask from
 * luminance (no redraw), tint it per use, and cut a mark-only square by
 * erasing the wordmark region inside the molecule "C".
 *
 * Usage: node tools/prepare-brand.js
 */
const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'owner-assets', 'MediVasc_Logo.PNG');
const OUT = path.join(ROOT, 'assets', 'brand');

const INK_LIGHT = { r: 0x12, g: 0x24, b: 0x2e }; // mark on light backgrounds
const INK_DARK = { r: 0xe6, g: 0xed, b: 0xf0 }; // mark on dark backgrounds
const PRIMARY = { r: 0x0f, g: 0x5e, b: 0x75 }; // favicon / icon tint
const PRIMARY_INK = { r: 0xf2, g: 0xfa, b: 0xfc };

// Full-logo coordinates in the 1448x1086 source.
const MARK_BOX = { left: 60, top: 200, width: 640, height: 700 };
const TEXT_ERASE = { left: 335, top: 430, right: 705, bottom: 655 }; // "Me…" inside the C mouth

const buildAlpha = async () => {
  const { data, info } = await sharp(SRC)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < alpha.length; i += 1) {
    const value = data[i];
    alpha[i] = value >= 243 ? 0 : 255 - value;
  }
  return { alpha, width: info.width, height: info.height };
};

const eraseRect = (alpha, width, box) => {
  const copy = Buffer.from(alpha);
  for (let y = box.top; y < box.bottom; y += 1) {
    copy.fill(0, y * width + box.left, y * width + box.right);
  }
  return copy;
};

const tinted = (alpha, width, height, tint) =>
  sharp({ create: { width, height, channels: 3, background: tint } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png();

const onSquare = async (markPng, size, scale, background) => {
  const inner = Math.round(size * scale);
  const mark = await sharp(markPng).resize(inner, inner, { fit: 'inside' }).toBuffer();
  const meta = await sharp(mark).metadata();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background || { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: mark,
        left: Math.round((size - meta.width) / 2),
        top: Math.round((size - meta.height) / 2),
      },
    ])
    .png()
    .toBuffer();
};

const run = async () => {
  await fs.mkdir(OUT, { recursive: true });
  const { alpha, width, height } = await buildAlpha();
  const markAlpha = eraseRect(alpha, width, TEXT_ERASE);

  const fullInk = await tinted(alpha, width, height, INK_LIGHT).toBuffer();
  const markInk = await sharp(await tinted(markAlpha, width, height, INK_LIGHT).toBuffer())
    .extract(MARK_BOX)
    .toBuffer();
  const markPaper = await sharp(await tinted(markAlpha, width, height, INK_DARK).toBuffer())
    .extract(MARK_BOX)
    .toBuffer();
  const markPrimary = await sharp(await tinted(markAlpha, width, height, PRIMARY).toBuffer())
    .extract(MARK_BOX)
    .toBuffer();
  const markPrimaryInk = await sharp(
    await tinted(markAlpha, width, height, PRIMARY_INK).toBuffer(),
  )
    .extract(MARK_BOX)
    .toBuffer();

  const trim = (buffer) => sharp(buffer).trim({ threshold: 8 });

  await trim(fullInk).resize({ width: 1200 }).png().toFile(path.join(OUT, 'logo-full.png'));
  await fs.writeFile(path.join(OUT, 'mark-ink.png'), await onSquare(await trim(markInk).toBuffer(), 640, 1));
  await fs.writeFile(path.join(OUT, 'mark-paper.png'), await onSquare(await trim(markPaper).toBuffer(), 640, 1));

  await fs.writeFile(path.join(OUT, 'favicon-32.png'), await sharp(await onSquare(await trim(markPrimary).toBuffer(), 256, 1)).resize(32, 32).png().toBuffer());
  const favicon256 = await onSquare(await trim(markPrimary).toBuffer(), 256, 1);
  await fs.writeFile(
    path.join(OUT, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${favicon256.toString('base64')}"/></svg>\n`,
  );
  await fs.writeFile(
    path.join(OUT, 'apple-touch-icon.png'),
    await onSquare(await trim(markPrimaryInk).toBuffer(), 180, 0.68, PRIMARY),
  );
  await fs.writeFile(path.join(OUT, 'icon-192.png'), await onSquare(await trim(markPrimaryInk).toBuffer(), 192, 0.6, PRIMARY));
  await fs.writeFile(path.join(OUT, 'icon-512.png'), await onSquare(await trim(markPrimaryInk).toBuffer(), 512, 0.6, PRIMARY));
  console.log('Brand assets written to assets/brand/.');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
