#!/usr/bin/env python3
"""Solutions/feedback image pipeline (2026-07-17 owner batch).

owner-assets/solutions-2026-07-17/{NEW SECTION 1,NEW SECTION 2,NEW SECTION - 3 ...}
  -> assets/solutions/mastectomy-NN.webp      (watermarked)
  -> assets/solutions/elephantiasis-NN.webp   (watermarked)
  -> assets/feedback/feedback-NN.webp         (no watermark - chat screenshots,
                                               the mark would sit over message text)

Policy (spec 002 / AGENTS.md): no generative edits. Applied here: EXIF rotation,
downscale, the LOCKED "MediVasc" watermark (owner-approved 2026-07-14; see the
advisor's navigalife-watermark-spec memory + admin/image-tools.js
drawEvidenceWatermark), WebP re-encode (strips metadata). The spec keys inset and
font size to output width W on 4:5 uploads; these sources are mixed-aspect, so we
key to S = min(W, H) - identical to the spec for portraits, and keeps the mark
proportionate on landscape frames.

Usage: python3 tools/prepare-solutions.py
"""
import glob
import os
import re

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'owner-assets', 'solutions-2026-07-17')
GEORGIA = '/System/Library/Fonts/Supplemental/Georgia.ttf'

SETS = [
    ('NEW SECTION 1', 'assets/solutions', 'mastectomy', 1600, True),
    ('NEW SECTION 2', 'assets/solutions', 'elephantiasis', 1600, True),
    ('NEW SECTION - 3 WHAT PATIENTS SAY ABOUT US', 'assets/feedback', 'feedback', 2000, False),
]

# Crop to just the chat (non-generative window). feedback-01 and feedback-02 are
# before/after composites with a WhatsApp chat sandwiched between flanking medical
# photos; the testimonials rail should show only the message screenshot, so we
# window each down to its central chat column before anything else. Boxes are
# fractions of the EXIF-corrected source (x0, y0, x1, y1), applied ahead of the
# downscale. Images with no entry pass through whole.
CROPS = {
    'feedback-01': (0.376, 0.000, 0.624, 1.000),  # blue-panel before/after -> chat
    'feedback-02': (0.315, 0.015, 0.715, 0.912),  # drop side wounds + bottom labels
}

# Privacy redaction (non-generative: heavy Gaussian blur only). Each region is a
# box in fractions of the FINAL output W x H, applied after crop + downscale (so
# feedback-01's boxes below live in its cropped frame, not the original
# composite). Sender identity is blurred in every chat screenshot: avatars (real
# photos), saved contact names, and forwarded-sender attributions. feedback-02
# and feedback-03 show no sender identity. The "KL 3000 PRO" device string in
# feedback-07's message body is testimonial text, not sender identity, so it
# stays intact. Future uploads have names at non-deterministic positions; the
# plan is for the admin panel to let an editor drag these boxes per image.
REDACTIONS = {
    'feedback-01': [  # white chat header, name after avatar; 2 forwarded attributions
        {'kind': 'avatar', 'box': (0.105, 0.060, 0.351, 0.166)},
        {'kind': 'name', 'box': (0.306, 0.078, 0.903, 0.156)},
        {'kind': 'name', 'tint': 'blue', 'box': (0.169, 0.360, 0.968, 0.408)},
        {'kind': 'name', 'tint': 'blue', 'box': (0.169, 0.615, 0.968, 0.662)},
    ],
    'feedback-04': [  # white header (avatar already a default icon); bottom reply
        {'kind': 'name', 'box': (0.274, 0.026, 0.606, 0.086)},
        {'kind': 'name', 'tint': 'blue', 'box': (0.168, 0.944, 0.868, 0.997)},
    ],
    'feedback-05': [  # green header, real-face avatar
        {'kind': 'avatar', 'box': (0.064, 0.044, 0.210, 0.112)},
        {'kind': 'name', 'box': (0.200, 0.046, 0.606, 0.112)},
    ],
    'feedback-06': [  # green header, real-face avatar + "online"
        {'kind': 'avatar', 'box': (0.064, 0.040, 0.210, 0.112)},
        {'kind': 'name', 'box': (0.200, 0.042, 0.606, 0.116)},
    ],
    'feedback-07': [  # white header, deity avatar
        {'kind': 'avatar', 'box': (0.054, 0.006, 0.204, 0.086)},
        {'kind': 'name', 'box': (0.196, 0.014, 0.606, 0.082)},
    ],
}


def numeric_key(path):
    match = re.search(r'(\d+)', os.path.basename(path))
    return int(match.group(1)) if match else 0


def watermark(image):
    from PIL import ImageFont

    width, height = image.size
    scale = min(width, height)
    inset = round(scale * 0.06)
    font_size = round(scale * 0.08)
    baseline = inset + font_size
    stroke = max(2, round(3.5 * font_size / 64))
    font = ImageFont.truetype(GEORGIA, font_size)

    overlay = Image.new('RGBA', image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Soft shadow: dy 1, blur 1.5, black at 0.28 (scaled with the mark).
    shadow = Image.new('RGBA', image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((inset, baseline + max(1, round(font_size / 64))), 'MediVasc',
                     font=font, fill=(0, 0, 0, 71), anchor='ls')
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(1.5, 1.5 * font_size / 64)))
    overlay = Image.alpha_composite(overlay, shadow)

    # Dark outline at 0.16, then the white fill at 0.66.
    layer = Image.new('RGBA', image.size, (0, 0, 0, 0))
    layer_draw = ImageDraw.Draw(layer)
    layer_draw.text((inset, baseline), 'MediVasc', font=font,
                    fill=(0, 0, 0, 0), stroke_width=stroke,
                    stroke_fill=(11, 31, 42, 41), anchor='ls')
    layer_draw.text((inset, baseline), 'MediVasc', font=font,
                    fill=(255, 255, 255, 168), anchor='ls')
    overlay = Image.alpha_composite(overlay, layer)

    return Image.alpha_composite(image.convert('RGBA'), overlay).convert('RGB')


def blur_region(image, box):
    """Obscure a region (avatar, contact name, or forwarded-sender attribution)
    with a heavy Gaussian blur so it cannot be read or recognised. The radius is
    keyed to the box's shorter edge, so short name bars and square avatars alike
    end up fully illegible. Non-generative: no pixels are invented, only smeared."""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(image.width, x1), min(image.height, y1)
    if x1 <= x0 or y1 <= y0:
        return
    region = image.crop((x0, y0, x1, y1))
    radius = max(10, round(min(x1 - x0, y1 - y0) * 0.7))
    region = region.filter(ImageFilter.GaussianBlur(radius))
    image.paste(region, (x0, y0))


def crop(image, key):
    """Window an image down to the box in CROPS (fractions of its own size), or
    return it unchanged when there is no entry. Non-generative: a plain crop."""
    box = CROPS.get(key)
    if not box:
        return image
    w, h = image.size
    x0, y0, x1, y1 = box
    return image.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))


def redact(image, key):
    w, h = image.size
    for region in REDACTIONS.get(key, []):
        x0, y0, x1, y1 = region['box']
        blur_region(image, (x0 * w, y0 * h, x1 * w, y1 * h))


def run():
    for folder, out_dir, stem, max_edge, mark in SETS:
        sources = sorted(
            glob.glob(os.path.join(SRC, folder, '*.[jJpP]*[gG]')), key=numeric_key)
        if not sources:
            raise SystemExit(f'No sources found in {folder}')
        out_path = os.path.join(ROOT, out_dir)
        os.makedirs(out_path, exist_ok=True)
        for index, source in enumerate(sources, start=1):
            image = ImageOps.exif_transpose(Image.open(source)).convert('RGB')
            image = crop(image, f'{stem}-{index:02d}')
            if max(image.size) > max_edge:
                ratio = max_edge / max(image.size)
                image = image.resize(
                    (round(image.width * ratio), round(image.height * ratio)),
                    Image.LANCZOS)
            if mark:
                image = watermark(image)
            redact(image, f'{stem}-{index:02d}')
            name = f'{stem}-{index:02d}.webp'
            image.save(os.path.join(out_path, name), 'WEBP', quality=90, method=6)
            print(f'{name}: {image.width}x{image.height} <- {os.path.basename(source)}')


if __name__ == '__main__':
    run()
