# Naviga Life image style

This file is the canonical, frozen image protocol for the initial catalogue and every product added later. Do not paraphrase the constant suffix. Product images are edits of a real device reference, never unconstrained generations.

## Product image recipe

Build every prompt by joining the product-specific clause and the constant style suffix below, separated by a blank line.

### Product-specific clause

```text
Use case: product-mockup
Asset type: medical-device catalogue and website product image
Input images: Image 1 is the edit target and exact product reference
Primary request: Restyle Image 1 as a clean studio product photograph of {PRODUCT_NAME}.
Device integrity: Keep this exact device. Preserve its shape, proportions, enclosure, controls, display, ports, tubing, cables, garments, attachments, materials, and colorway. Do not redesign, simplify, add, remove, relocate, or substitute any functional part. Change only the photographic setting, lighting, camera presentation, and removal of visible branding or text.
```

### Constant style suffix — frozen

```text
Style/medium: restrained, photorealistic studio product photography for a trusted medical-device catalogue.
Scene/backdrop: seamless warm off-white #F6F4EF studio background; the device rests on a low matte plinth in the same warm neutral family.
Composition/framing: slight three-quarter hero angle; complete device and all necessary tubing or garments visible; centered visual balance; generous safe space; 3:2 landscape aspect ratio.
Lighting/mood: soft diffused key light from the upper left; quiet clinical warmth; controlled natural shadow; shallow depth of field while every functional device detail remains legible.
Color palette: muted clinical neutrals with restrained deep-teal accents echoing #0E6B63; accurate product colorway takes priority.
Materials/textures: truthful medical-grade plastics, fabric, tubing, and matte surfaces; realistic edges and contact shadows.
Constraints: no people; no hands; no text; no letters; no numbers; no logos; no trademarks; no watermark; no certification seal; no extra props; no packaging; no dramatic reflections; no gradient wash; no floating parts. Preserve product identity and functional geometry exactly.
```

### Example assembled prompt

```text
Use case: product-mockup
Asset type: medical-device catalogue and website product image
Input images: Image 1 is the edit target and exact product reference
Primary request: Restyle Image 1 as a clean studio product photograph of KL 3000 Pro Neo Limb Therapy System.
Device integrity: Keep this exact device. Preserve its shape, proportions, enclosure, controls, display, ports, tubing, cables, garments, attachments, materials, and colorway. Do not redesign, simplify, add, remove, relocate, or substitute any functional part. Change only the photographic setting, lighting, camera presentation, and removal of visible branding or text.

Style/medium: restrained, photorealistic studio product photography for a trusted medical-device catalogue.
Scene/backdrop: seamless warm off-white #F6F4EF studio background; the device rests on a low matte plinth in the same warm neutral family.
Composition/framing: slight three-quarter hero angle; complete device and all necessary tubing or garments visible; centered visual balance; generous safe space; 3:2 landscape aspect ratio.
Lighting/mood: soft diffused key light from the upper left; quiet clinical warmth; controlled natural shadow; shallow depth of field while every functional device detail remains legible.
Color palette: muted clinical neutrals with restrained deep-teal accents echoing #0E6B63; accurate product colorway takes priority.
Materials/textures: truthful medical-grade plastics, fabric, tubing, and matte surfaces; realistic edges and contact shadows.
Constraints: no people; no hands; no text; no letters; no numbers; no logos; no trademarks; no watermark; no certification seal; no extra props; no packaging; no dramatic reflections; no gradient wash; no floating parts. Preserve product identity and functional geometry exactly.
```

## Testimonial portrait template — retired

This template is retained as a historical record only. A2 retires customer
portraits and prohibits generating replacements. Do not use this prompt for
new testimonial assets.

```text
Use case: photorealistic-natural
Asset type: website testimonial portrait
Primary request: A natural chest-up portrait of an Indian adult, {AGE_RANGE}, {GENDER_PRESENTATION}, from {CITY_CONTEXT}, with a gentle genuine expression.
Scene/backdrop: warm neutral interior backdrop with subtle real-world texture and no identifiable location.
Style/medium: photorealistic editorial portrait; candid, respectful, and lightly finished rather than commercial stock photography.
Composition/framing: chest-up, eye-level, 1:1 square aspect ratio, relaxed posture, simple everyday clothing, direct or slightly off-camera gaze.
Lighting/mood: soft natural window light from the upper left; calm, approachable, and credible.
Color palette: warm paper neutrals, natural skin tones, restrained deep-teal or earth-tone clothing accents.
Materials/textures: natural skin texture, age-appropriate detail, realistic hair and fabric.
Constraints: one person only; no clinician costume; no medical setting; no device; no text; no logo; no watermark; no exaggerated smile; no beauty retouching; no glamour styling; no visible brand marks.
```

Vary age, gender presentation, clothing, expression, and city context across the set. Do not vary the composition, lighting direction, neutral backdrop, or realism requirements.

## Before/after evidence recipe — deterministic only

Patient before/after photographs are medical evidence, not creative assets.
Generative or AI editing is prohibited. Never use image generation, inpainting,
generative fill, face or body retouching, background replacement, synthetic
upscaling, or any process that can change the photographed limb or outcome.

1. Preserve the supplied original files as the evidence source.
2. Apply only deterministic auto-orientation, rotation, global exposure and
   white-balance normalization, ordinary resizing/re-encoding, and a 4:5 crop.
   Do not use local retouching or remove marks, objects, swelling, discoloration,
   or other visible evidence.
3. Keep the subject at a comparable visual scale where the source pair permits
   it. If either image cannot crop cleanly to 4:5, letterbox that complete image
   over a blurred fill derived from the same image. Never invent edge content.
4. Render the pair in matched 4:5 frames with `--surface-2` matting, the shared
   component radius, a consistent inner gap, and small-caps BEFORE / AFTER
   labels. AFTER may use `--primary` for the label only.
5. Strip EXIF, XMP, IPTC, and ICC metadata from shipped derivatives. Record the
   source-to-output transform so the deterministic treatment can be reproduced.
6. When no real paired photographs are available, render the designed empty
   state. Never generate or substitute fabricated outcome imagery.

## Output and review rules

1. Use image edit/reference mode for every product. The selected archive photo is the edit target, not merely a mood reference.
2. Produce a 3:2 landscape final at 1600 pixels or more on the long edge. Upscale and re-encode with `sharp` when the tool output is smaller.
3. Reject an output if any functional part changes, if tubing or garments disappear, or if invented controls, ports, text, logos, or accessories appear.
4. Save approved product files under `assets/products/{product-slug}/`.
5. Append every attempt, including rejected attempts, to `assets/products/manifest.json` with product id, source cache path, full prompt, image tool/model identifier, generation date, output path, and approval status.
6. Re-encode every shipped raster with `sharp` to remove metadata. Never copy source metadata into `assets/`.

## CSS normalization frame

Every product image is displayed in a fixed 3:2 frame with `background: var(--surface-2)`, `object-fit: contain`, 8% inner padding, and the shared component radius. Dark mode changes the frame surface only; it never inverts or recolors the photo.

## Admin protocol card

The add-product interface must interpolate the new product name into the product-specific clause, append the frozen suffix verbatim, and offer one copy action. This file remains the source of truth.
