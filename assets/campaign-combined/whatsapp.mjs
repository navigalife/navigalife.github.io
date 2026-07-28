// WhatsApp-optimised flyers for assets/campaign-combined/forWhatsapp/.
//
//   node assets/campaign-combined/whatsapp.mjs
//
// The source is the PORTRAIT render (1080 × 1350, 4:5), not the square. A chat
// bubble is width-constrained, so within the ratios WhatsApp shows whole, the
// taller image occupies more of the screen — 4:5 is 25% more preview area than
// 1:1 at the same bubble width, and is shallower than a stock 3:4 phone photo,
// which WhatsApp displays uncropped. That is the whole point: readable in the
// bubble without a tap.
//
// Three rules, and each is a check rather than a comment:
//
//   1. NO RESAMPLING. 1350 px is already under WhatsApp's ~1600 px long-edge
//      cap, so a standard-quality send does not downscale it. Upscaling to meet
//      the cap would interpolate type that was rendered at its native size and
//      make it softer, not sharper. Geometry out must equal geometry in.
//   2. JPEG, not PNG. WhatsApp re-encodes to JPEG whatever it is given; handing
//      it a clean high-quality JPEG leaves its compressor with little left to
//      do. mozjpeg at q90.
//   3. 4:4:4 CHROMA. The default 4:2:0 halves colour resolution, which is where
//      an accent word in terracotta or red on a flat field picks up fringing.
//      These are type on flat colour — exactly the content subsampling ruins.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..');
const outDir = path.join(here, 'forWhatsapp');

const SOURCES = [
  { prefix: 'c1', dir: 'campaign' },
  { prefix: 'c2', dir: 'campaign_2' },
];

const EXPECT = { width: 1080, height: 1350 };
const QUALITY = 90;
// WhatsApp's standard-quality send targets a few hundred KB. A source already
// under this arrives with the compressor barely engaged; over it and the pass
// is heavy enough to show on fine type, which is the failure this file exists
// to avoid.
const SIZE_CEILING = 500 * 1024;

await fs.mkdir(outDir, { recursive: true });

const written = [];
const problems = [];

for (const { prefix, dir } of SOURCES) {
  const srcDir = path.join(assets, dir);
  const portraits = (await fs.readdir(srcDir)).filter((f) => f.endsWith('-portrait.png')).sort();

  if (!portraits.length) problems.push(`${dir}: no *-portrait.png found`);

  for (const file of portraits) {
    const src = path.join(srcDir, file);
    const meta = await sharp(src).metadata();
    if (meta.width !== EXPECT.width || meta.height !== EXPECT.height) {
      problems.push(`${dir}/${file}: ${meta.width}×${meta.height}, expected ${EXPECT.width}×${EXPECT.height}`);
      continue;
    }

    const target = path.join(outDir, `${prefix}-${file.replace(/-portrait\.png$/, '-whatsapp.jpg')}`);
    await sharp(src)
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4', progressive: false })
      .withMetadata({ density: 72 })
      .toFile(target);

    // Rule 1, enforced: the encode must not have moved a pixel.
    const out = await sharp(target).metadata();
    if (out.width !== EXPECT.width || out.height !== EXPECT.height) {
      problems.push(`${path.basename(target)}: written at ${out.width}×${out.height} — resampled`);
      continue;
    }
    const { size } = await fs.stat(target);
    if (size > SIZE_CEILING) {
      problems.push(`${path.basename(target)}: ${(size / 1024).toFixed(0)} KB over the ${SIZE_CEILING / 1024} KB ceiling`);
      continue;
    }
    written.push({ name: path.basename(target), size });
  }
}

for (const { name, size } of written) {
  console.log(`  ${name.padEnd(34)} ${String((size / 1024).toFixed(0)).padStart(4)} KB   1080×1350`);
}

if (problems.length) {
  console.error('\nwhatsapp: failed —');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const total = written.reduce((a, b) => a + b.size, 0);
console.log(`\nWrote ${written.length} files to ${path.relative(assets, outDir)} (${(total / 1024 / 1024).toFixed(1)} MB)`);
