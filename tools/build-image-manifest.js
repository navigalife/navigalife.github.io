#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const productSuffix = `Style/medium: restrained, photorealistic studio product photography for a trusted medical-device catalogue.
Scene/backdrop: seamless warm off-white #F6F4EF studio background; the device rests on a low matte plinth in the same warm neutral family.
Composition/framing: slight three-quarter hero angle; complete device and all necessary tubing or garments visible; centered visual balance; generous safe space; 3:2 landscape aspect ratio.
Lighting/mood: soft diffused key light from the upper left; quiet clinical warmth; controlled natural shadow; shallow depth of field while every functional device detail remains legible.
Color palette: muted clinical neutrals with restrained deep-teal accents echoing #0E6B63; accurate product colorway takes priority.
Materials/textures: truthful medical-grade plastics, fabric, tubing, and matte surfaces; realistic edges and contact shadows.
Constraints: no people; no hands; no text; no letters; no numbers; no logos; no trademarks; no watermark; no certification seal; no extra props; no packaging; no dramatic reflections; no gradient wash; no floating parts. Preserve product identity and functional geometry exactly.`;

const products = [
  ['venogain-scd-500', 'VenoGain SCD 500', 'scrape/images/daf027929822747b-lymphedema-compression-dvt-pump.jpg.jpg', 'Isolate the actual black oval controller and its matching compression garment from the source layout; discard the doctor portrait, diagrams, borders, background, and all printed copy.'],
  ['kl-3000-pro-neo', 'KL 3000 Pro Neo Limb Therapy System', 'scrape/images/d8c9005aa9c5c047-kl-3000-pro-neo-catalog-jpg.jpg.jpg', 'Isolate the actual black rectangular controller, its tubing, and matching compression garments from the source brochure; discard the clinician portrait, specifications table, borders, background, and all printed copy.'],
  ['kl-5000-pro-neo', 'KL 5000 Pro Neo Limb Therapy System', 'scrape/images/22f2fc95b76a4420-compressible-limb-therapy-system-kl-5000-pro-neo-legs-and-arms-swellin.jpg', 'Isolate the actual dark green and black controller shown in the source layout; discard the clinician portrait, borders, background, and all printed copy. Include the matching compression garments shown with this model.'],
  ['kl-2000-pro-neo', 'KL 2000 Pro Neo Compression Pump', 'scrape/images/aa9b81c3d5ec8081-kl-2000-pro-neo-catalog-jpg.jpg.jpg', 'Isolate the actual black rectangular controller, its tubing, and matching compression garments from the source brochure; discard the clinician portrait, specifications table, borders, background, and all printed copy.'],
  ['cvi-cellulitis-care', 'CVI and Cellulitis Limb Therapy System', 'scrape/images/732ab74840f694e3-cvi-chronic-cellulitis-treatment-device.jpg.jpg', 'Isolate the actual black controller, tubing, and matching compression garments from the brochure; discard the clinician portrait, specifications, background, and all printed copy.'],
  ['filariasis-leg-compression', 'Filariasis Leg Compression System', 'scrape/images/9463deeb265dd8bc-filariasis-elephantiasis-treatment-device.jpg.jpg', 'Isolate the actual dark green and black controller and matching full-leg compression garments from the source layout; discard the clinician portrait, background, and all printed copy.'],
  ['foot-amputation-prevention-4', 'Four-Chamber Foot and Leg Compression System', 'scrape/images/aa9b81c3d5ec8081-kl-2000-pro-neo-catalog-jpg.jpg.jpg', 'Isolate the actual black four-chamber controller, tubing, and matching leg-and-foot garments from the brochure; discard the clinician portrait, specifications table, background, and all printed copy.'],
  ['foot-leg-amputation-prevention-6', 'Six-Chamber Limb Circulation System', 'scrape/images/56da4ee445be5c7e-foot-leg-amputation-prevention.jpg.jpg', 'Isolate the actual black six-chamber controller, tubing, and matching compression garments from the brochure; discard the clinician portrait, specifications table, background, and all printed copy.'],
  ['limb-lymphedema-8', 'Eight-Chamber Lymphedema Therapy System', 'scrape/images/29d119e94fd6ce44-legs-and-arms-swelling-lymphedema-treatment-device.jpg.jpg', 'Isolate the actual dark green and black controller, tubing, and eight-chamber arm and leg garments from the source layout; discard the clinician portrait, background, and all printed copy.'],
  ['lymphedema-cellulitis-6', 'Six-Chamber Lymphedema and Cellulitis System', 'scrape/images/76888249e538ece6-lymphedema-and-cellulitis-patient-treatment-device.jpg.jpg', 'Isolate the actual black controller, tubing, and matching six-chamber compression garments from the brochure; discard the clinician portrait, specifications, background, and all printed copy.'],
  ['pad-pvd-circulation-4', 'Four-Chamber PAD and PVD Support System', 'scrape/images/b8af4a5ca31244af-pad-peripheral-artery-disease-pvd-peripheral-vascular-disease-preventi.jpg', 'Isolate the actual black four-chamber controller, tubing, and leg-and-foot compression garments from the brochure; discard the clinician portrait, specifications, background, and all printed copy.'],
  ['diabetic-foot-pad-8', 'Eight-Chamber Diabetic Foot and PAD System', 'scrape/images/e666a6a43750db05-pad-peripheral-artery-disease-treatment-diabetic-foot-amputation-preve.jpg', 'Isolate the actual dark green and black controller, tubing, and eight-chamber leg-and-foot compression garments from the source layout; discard the clinician portrait, background, and all printed copy.'],
  ['post-lumpectomy-arm', 'Post-Lumpectomy Arm Therapy System', 'scrape/images/7fb1c747121e5ed8-post-lumpectomy-upper-limb-arm-swelling-lymphedema-treatment-device.jp.jpg', 'Restyle the exact black multi-chamber arm compression garment and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.'],
  ['post-mastectomy-arm', 'Post-Mastectomy Arm Therapy System', 'scrape/images/d2feccb8967a7b4b-post-mastectomy-arm-lymphedema-treatment-device.jpg.jpg', 'Restyle the exact black multi-chamber arm compression garment and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.'],
  ['venous-care-6', 'Six-Chamber Venous Care System', 'scrape/images/defd99c80adedd4b-varicose-veins-cellulitis-cvi-chronic-venous-insufficiency-venous-ulce.jpg', 'Restyle the exact pair of black six-chamber leg compression garments and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.'],
  ['varicose-vein-care', 'Varicose Vein Therapy System', 'scrape/images/00da26d6b828e7d7-varicose-veins-treatment-device.jpg.jpg', 'Restyle the exact pair of black six-chamber leg compression garments and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.'],
  ['venous-ulcer-cvi-fluid', 'Venous Ulcer and CVI Therapy System', 'scrape/images/144cefa52113d8f4-varicose-veins-venous-ulcers-cellulitis-cvi-limbs-water-retention-trea.jpg', 'Restyle the exact pair of black six-chamber leg compression garments and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.'],
  ['venous-ulcer-compression', 'Venous Ulcer Compression System', 'scrape/images/4e138e9820587867-varicose-veins-venous-ulcers-treatment-device.jpg.jpg', 'Restyle the exact pair of black six-chamber leg compression garments and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.'],
  ['venous-ulcer-dvt-care', 'Venous Ulcer and DVT Care System', 'scrape/images/f749f9da4a6a7a4a-venous-ulcers-deep-vein-thrombosis-blood-clots-treatment-device.jpg.jpg', 'Restyle the exact pair of black six-channel leg compression garments and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.'],
  ['post-surgical-arm-swelling', 'Post-Surgical Arm Swelling Therapy System', 'scrape/images/b491debba02ea7fd-after-breast-cancer-surgery-arms-swelling-treatment-device.jpg.jpg', 'Restyle the exact black multi-chamber arm compression garment and attached tubing shown in Image 1. Remove only the blue background and visible watermark. Do not invent or add a controller.']
];

function productPrompt(name, note) {
  return `Use case: product-mockup
Asset type: medical-device catalogue and website product image
Input images: Image 1 is the edit target and exact product reference
Primary request: Restyle Image 1 as a clean studio product photograph of ${name}. ${note}
Device integrity: Keep this exact device. Preserve its shape, proportions, enclosure, controls, display, ports, tubing, cables, garments, attachments, materials, and colorway. Do not redesign, simplify, add, remove, relocate, or substitute any functional part. Change only the photographic setting, lighting, camera presentation, and removal of visible branding or text.

${productSuffix}`;
}

const portraitFixed = `Scene/backdrop: warm neutral interior backdrop with subtle real-world texture and no identifiable location.
Style/medium: photorealistic editorial portrait; candid, respectful, and lightly finished rather than commercial stock photography.
Composition/framing: chest-up, eye-level, 1:1 square aspect ratio, relaxed posture, simple everyday clothing, direct or slightly off-camera gaze.
Lighting/mood: soft natural window light from the upper left; calm, approachable, and credible.
Color palette: warm paper neutrals, natural skin tones, restrained deep-teal or earth-tone clothing accents.
Materials/textures: natural skin texture, age-appropriate detail, realistic hair and fabric.
Constraints: one person only; no clinician costume; no medical setting; no device; no text; no logo; no watermark; no exaggerated smile; no beauty retouching; no glamour styling; no visible brand marks.`;

const portraits = [
  ['t-001', 'an Indian woman in her early 50s from Pune, wearing a simple muted teal cotton kurta, gentle genuine expression'],
  ['t-003', 'an Indian woman in her early 60s from Jaipur, wearing a warm clay and cream handloom top, gentle genuine expression'],
  ['t-005', 'an Indian Muslim woman in her late 50s from Lucknow, wearing a modest sage-green dupatta and neutral clothing, gentle genuine expression'],
  ['t-007', 'an Indian man in his mid 40s from Hyderabad, wearing a simple deep-teal collared shirt, gentle genuine expression'],
  ['t-009', 'an Indian Bengali woman in her early 50s from Kolkata, wearing a restrained ochre and cream cotton sari blouse, gentle genuine expression']
];

const generatedAt = new Date().toISOString();
const records = products.map(([id, name, sourceCachePath, note]) => ({
  id: `product-${id}-01`,
  kind: 'product',
  productId: id,
  sourceCachePath,
  fullPrompt: productPrompt(name, note),
  model: 'gpt-image-2 via built-in image_gen',
  generatedAt,
  outputPath: `assets/products/${id}/01.webp`,
  dimensions: { width: 1800, height: 1200 },
  status: 'approved'
}));

for (const [id, person] of portraits) {
  records.push({
    id: `portrait-${id}`,
    kind: 'testimonial-portrait',
    testimonialId: id,
    sourceCachePath: null,
    fullPrompt: `Use case: photorealistic-natural
Asset type: website testimonial portrait
Primary request: A natural chest-up portrait of ${person}.

${portraitFixed}`,
    model: 'gpt-image-2 via built-in image_gen',
    generatedAt,
    outputPath: `assets/testimonials/${id}.webp`,
    dimensions: { width: 1200, height: 1200 },
    status: 'approved'
  });
}

const target = path.join(__dirname, '..', 'assets', 'products', 'manifest.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify({ version: 1, records }, null, 2)}\n`);
console.log(`Wrote ${records.length} image records to ${target}`);
