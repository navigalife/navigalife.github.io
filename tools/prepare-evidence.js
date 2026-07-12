/**
 * One-off evidence pipeline: owner-assets/{1..4} -> assets/testimonials/*.webp
 *
 * Policy (spec 002): no generative edits. Allowed: EXIF rotation, 180° flip for
 * an upside-down source, cropping away phone/WhatsApp UI chrome, mild tonal
 * normalization, resize to 4:5, WebP encode (strips metadata).
 *
 * Crop recipes are recorded here so every shipped evidence image is
 * reproducible from the raw owner asset.
 *
 * Usage: node tools/prepare-evidence.js [--only story-002-before]
 */
const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'owner-assets');
const OUT = path.join(ROOT, 'assets', 'testimonials');
const TARGET = { width: 800, height: 1000 }; // 4:5

/**
 * Each recipe: source file, optional pre-rotation, a content window (removes
 * UI chrome / surroundings), and a 4:5 focus box INSIDE the rotated source
 * coordinates. focus is {left, top, width} — height derives from 4:5.
 */
const RECIPES = [
  {
    id: 'story-001-before',
    source: '1/1_before.jpg', // 738x1600 WhatsApp screenshot: bar ~0-175, nav ~1505+
    focus: { left: 0, top: 300, width: 738 },
    note: 'WhatsApp chrome cropped; frame on tissue-loss region of the limb',
  },
  {
    id: 'story-001-during',
    source: '1/1_mid after.jpg', // 960x1280
    focus: { left: 0, top: 40, width: 960 },
  },
  {
    id: 'story-001-after',
    source: '1/1_ after therapy.jpg', // 1018x1469
    focus: { left: 0, top: 90, width: 1018 },
  },
  {
    id: 'story-002-before',
    source: '2/2_before.jpg', // 900x1600 photo of a screen, upside down
    rotate: 180,
    focus: { left: 130, top: 240, width: 750 },
    normalize: true,
    sharpen: true,
    note: 'Rotated 180°; cropped to the inner photo, excluding chat UI',
  },
  {
    id: 'story-002-after',
    source: '2/2_after.jpg', // 900x1600 photo of a phone showing the photo
    focus: { left: 95, top: 250, width: 745 },
    normalize: true,
    sharpen: true,
    note: 'Cropped to the on-screen photograph, excluding phone body and UI',
  },
  {
    id: 'story-003-before',
    source: '3/3_before.jpg', // 1600x902 landscape
    focus: { left: 400, top: 0, width: 721 },
  },
  {
    id: 'story-003-after',
    source: '3/3_after.jpg', // 963x1280
    focus: { left: 0, top: 70, width: 963 },
  },
  {
    id: 'story-004-before',
    source: '4/4_before.jpg', // 960x1280
    focus: { left: 0, top: 40, width: 960 },
  },
  {
    id: 'story-004-after',
    source: '4/4_after.jpg', // 1200x1600
    focus: { left: 0, top: 60, width: 1200 },
  },
];

const run = async () => {
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : null;
  await fs.mkdir(OUT, { recursive: true });
  for (const recipe of RECIPES) {
    if (only && recipe.id !== only) continue;
    const sourcePath = path.join(SRC, recipe.source);
    let image = sharp(sourcePath).rotate(); // honor EXIF first
    if (recipe.rotate) image = sharp(await image.toBuffer()).rotate(recipe.rotate);
    const meta = await sharp(await image.toBuffer()).metadata();
    const width = Math.min(recipe.focus.width, meta.width - recipe.focus.left);
    const height = Math.min(
      Math.round(width * (TARGET.height / TARGET.width)),
      meta.height - recipe.focus.top,
    );
    let pipeline = sharp(await image.toBuffer()).extract({
      left: recipe.focus.left,
      top: recipe.focus.top,
      width,
      height,
    });
    if (recipe.normalize) pipeline = pipeline.normalise({ lower: 1, upper: 99 });
    if (recipe.sharpen) pipeline = pipeline.sharpen({ sigma: 0.8 });
    const buffer = await pipeline
      .resize(TARGET.width, TARGET.height, { fit: 'cover' })
      .webp({ quality: 84, effort: 5 })
      .toBuffer();
    const outPath = path.join(OUT, `${recipe.id}.webp`);
    await fs.writeFile(outPath, buffer);
    const kb = (buffer.length / 1024).toFixed(0);
    console.log(`${recipe.id}: ${width}x${height} -> ${TARGET.width}x${TARGET.height} (${kb} KB)`);
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
