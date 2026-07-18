const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const assertImage = (file) => {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} is larger than 20 MB.`);
  }
};

const canvasBlob = (canvas, quality = 0.86) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('This browser could not encode the image.'));
  }, 'image/webp', quality);
});

export const resizeProductImage = async (file) => {
  assertImage(file);
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#F5F8F9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvasBlob(canvas);
};

// Bakes the locked "MediVasc" testimonial watermark into the pixels (proportional
// to width W so it looks identical on every 4:5 upload). Mirrors the batch spec in
// tools/watermark.js — top-left, Georgia, semi-transparent white + faint dark
// outline + soft shadow. Runs inside the crop draw() so it is WYSIWYG in the dialog
// and captured by the exported blob.
const drawEvidenceWatermark = (context, w) => {
  const inset = Math.round(w * 0.06);
  const fontSize = Math.round(w * 0.08);
  const baseline = inset + fontSize;
  context.save();
  context.font = `500 ${fontSize}px Georgia, "Times New Roman", serif`;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.lineJoin = 'round';
  // Soft shadow cast from the white fill so it reads at the spec's strength.
  context.shadowColor = 'rgba(0, 0, 0, 0.28)';
  context.shadowBlur = 1.5;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 1;
  context.fillStyle = 'rgba(255, 255, 255, 0.66)';
  context.fillText('MediVasc', inset, baseline);
  // Faint dark outline (no shadow so it isn't doubled).
  context.shadowColor = 'transparent';
  context.lineWidth = 3.5;
  context.strokeStyle = 'rgba(11, 31, 42, 0.16)';
  context.strokeText('MediVasc', inset, baseline);
  context.restore();
};

export const cropEvidenceImage = async (file, label) => {
  assertImage(file);
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const dialog = document.querySelector('#crop-dialog');
  const canvas = document.querySelector('#crop-canvas');
  const zoom = document.querySelector('#crop-zoom');
  const positionX = document.querySelector('#crop-x');
  const positionY = document.querySelector('#crop-y');
  document.querySelector('#crop-title').textContent = `Crop ${label} image`;
  zoom.value = '1';
  positionX.value = '0';
  positionY.value = '0';

  const draw = () => {
    const context = canvas.getContext('2d', { alpha: false });
    const coverScale = Math.max(canvas.width / image.width, canvas.height / image.height);
    const scale = coverScale * Number(zoom.value);
    const width = image.width * scale;
    const height = image.height * scale;
    const overflowX = Math.max(0, width - canvas.width);
    const overflowY = Math.max(0, height - canvas.height);
    const x = -(overflowX / 2) + (Number(positionX.value) * overflowX / 2);
    const y = -(overflowY / 2) + (Number(positionY.value) * overflowY / 2);
    context.fillStyle = '#F5F8F9';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, width, height);
    drawEvidenceWatermark(context, canvas.width);
  };
  const update = () => draw();
  zoom.addEventListener('input', update);
  positionX.addEventListener('input', update);
  positionY.addEventListener('input', update);
  draw();

  const accepted = await new Promise((resolve) => {
    const close = () => resolve(dialog.returnValue === 'default');
    dialog.addEventListener('close', close, { once: true });
    dialog.showModal();
  });
  zoom.removeEventListener('input', update);
  positionX.removeEventListener('input', update);
  positionY.removeEventListener('input', update);
  image.close();
  if (!accepted) return null;
  return canvasBlob(canvas, 0.88);
};

// Downscale a chat screenshot to a 2000px maximum edge and re-encode to WebP,
// preserving its natural aspect (no crop, no watermark — the mark would sit over
// message text). Mirrors the feedback branch of tools/prepare-solutions.py.
export const resizeFeedbackImage = async (file) => {
  assertImage(file);
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvasBlob(canvas, 0.9);
};

// Heavy Gaussian-blur radius for a redaction box, keyed to its shorter edge so
// short name bars and square avatars alike end up fully illegible. Mirrors
// tools/prepare-solutions.py blur_region() (min-edge * 0.7, floor 8). Kept as one
// function so the WYSIWYG preview and the baked output cannot drift apart.
const redactRadius = (w, h) => Math.max(8, Math.round(Math.min(w, h) * 0.7));

// Identity-redaction tool for chat-screenshot uploads. The editor drags one box
// per avatar / contact name / phone number; each is baked as a heavy, permanent
// Gaussian blur (non-generative — pixels are smeared, never invented). This is
// the interactive counterpart to the hand-coded fractional boxes in
// tools/prepare-solutions.py: the site build only downscales the result, so what
// is baked here is exactly what ships. Boxes live in DISPLAY-canvas coordinates
// and are mapped to natural pixels at bake time. Resolves to a WebP blob, or
// null if the editor cancels the upload.
export const redactImage = async (blob, label = 'screenshot') => {
  const image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const dialog = document.querySelector('#redact-dialog');
  const canvas = document.querySelector('#redact-canvas');
  const removeButton = document.querySelector('#redact-remove');
  const clearButton = document.querySelector('#redact-clear');
  const countLabel = document.querySelector('#redact-count');
  const title = document.querySelector('#redact-title');
  title.textContent = `Blur identifying details — ${label}`;

  // Fit the working canvas inside the viewport; boxes are stored at this scale.
  const maxW = Math.min(680, Math.round(window.innerWidth * 0.84));
  const maxH = Math.min(760, Math.round(window.innerHeight * 0.6));
  const fit = Math.min(maxW / image.width, maxH / image.height, 1);
  canvas.width = Math.max(1, Math.round(image.width * fit));
  canvas.height = Math.max(1, Math.round(image.height * fit));
  const scale = canvas.width / image.width; // display px per natural px
  const context = canvas.getContext('2d');

  let boxes = [];
  let selected = -1;
  let drag = null;
  const HANDLE = 15;
  const MIN = 10;

  const norm = (b) => ({
    x: Math.min(b.x, b.x + b.w),
    y: Math.min(b.y, b.y + b.h),
    w: Math.abs(b.w),
    h: Math.abs(b.h),
  });
  const clampBox = (b) => {
    b.x = Math.max(0, Math.min(b.x, canvas.width - b.w));
    b.y = Math.max(0, Math.min(b.y, canvas.height - b.h));
    return b;
  };

  const draw = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.filter = 'none';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    boxes.forEach((raw, index) => {
      const b = norm(raw);
      if (b.w < 1 || b.h < 1) return;
      context.save();
      context.beginPath();
      context.rect(b.x, b.y, b.w, b.h);
      context.clip();
      context.filter = `blur(${redactRadius(b.w, b.h)}px)`;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.restore();
      context.filter = 'none';
      context.lineWidth = index === selected ? 2 : 1.5;
      context.setLineDash(index === selected ? [] : [5, 4]);
      context.strokeStyle = index === selected ? '#0E5F76' : 'rgba(255,255,255,0.9)';
      context.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      if (index === selected) {
        context.setLineDash([]);
        context.fillStyle = '#0E5F76';
        context.fillRect(b.x + b.w - HANDLE, b.y + b.h - HANDLE, HANDLE, HANDLE);
      }
    });
    context.setLineDash([]);
    const n = boxes.filter((raw) => { const b = norm(raw); return b.w >= MIN && b.h >= MIN; }).length;
    countLabel.textContent = `${n} box${n === 1 ? '' : 'es'}`;
    removeButton.disabled = selected < 0;
    clearButton.disabled = boxes.length === 0;
  };

  const toCanvas = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const onHandle = (b, p) => selected >= 0 &&
    p.x >= b.x + b.w - HANDLE && p.x <= b.x + b.w + 4 &&
    p.y >= b.y + b.h - HANDLE && p.y <= b.y + b.h + 4;
  const boxAt = (p) => {
    for (let i = boxes.length - 1; i >= 0; i -= 1) {
      const b = norm(boxes[i]);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
    }
    return -1;
  };

  const onDown = (event) => {
    const p = toCanvas(event);
    if (selected >= 0 && onHandle(norm(boxes[selected]), p)) {
      const b = norm(boxes[selected]);
      boxes[selected] = { x: b.x, y: b.y, w: b.w, h: b.h };
      drag = { mode: 'resize', index: selected };
    } else {
      const hit = boxAt(p);
      if (hit >= 0) {
        selected = hit;
        const b = norm(boxes[hit]);
        boxes[hit] = { x: b.x, y: b.y, w: b.w, h: b.h };
        drag = { mode: 'move', index: hit, startX: p.x, startY: p.y, origX: b.x, origY: b.y };
      } else {
        boxes.push({ x: p.x, y: p.y, w: 0, h: 0 });
        selected = boxes.length - 1;
        drag = { mode: 'new', index: selected };
      }
    }
    try { canvas.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
    draw();
  };
  const onMove = (event) => {
    if (!drag) return;
    const p = toCanvas(event);
    const cx = Math.max(0, Math.min(p.x, canvas.width));
    const cy = Math.max(0, Math.min(p.y, canvas.height));
    const b = boxes[drag.index];
    if (drag.mode === 'move') {
      b.x = drag.origX + (p.x - drag.startX);
      b.y = drag.origY + (p.y - drag.startY);
      clampBox(b);
    } else {
      b.w = cx - b.x;
      b.h = cy - b.y;
    }
    draw();
  };
  const onUp = (event) => {
    if (!drag) return;
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    const b = norm(boxes[drag.index]);
    if (b.w < MIN || b.h < MIN) {
      boxes.splice(drag.index, 1);
      selected = -1;
    } else {
      boxes[drag.index] = clampBox(b);
    }
    drag = null;
    draw();
  };

  const onRemove = () => { if (selected >= 0) { boxes.splice(selected, 1); selected = -1; draw(); } };
  const onClear = () => { boxes = []; selected = -1; draw(); };
  const onKey = (event) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected >= 0) {
      event.preventDefault();
      onRemove();
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  removeButton.addEventListener('click', onRemove);
  clearButton.addEventListener('click', onClear);
  dialog.addEventListener('keydown', onKey);
  draw();

  const accepted = await new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'default'), { once: true });
    dialog.showModal();
  });

  canvas.removeEventListener('pointerdown', onDown);
  canvas.removeEventListener('pointermove', onMove);
  canvas.removeEventListener('pointerup', onUp);
  canvas.removeEventListener('pointercancel', onUp);
  removeButton.removeEventListener('click', onRemove);
  clearButton.removeEventListener('click', onClear);
  dialog.removeEventListener('keydown', onKey);

  if (!accepted) { image.close(); return null; }

  // Bake at natural resolution: redraw the whole image blurred, clipped to each
  // box, so the blur samples real neighbours (no dark clip-edge halo).
  const out = document.createElement('canvas');
  out.width = image.width;
  out.height = image.height;
  const octx = out.getContext('2d');
  octx.drawImage(image, 0, 0);
  for (const raw of boxes) {
    const b = norm(raw);
    if (b.w < MIN || b.h < MIN) continue;
    const bx = b.x / scale;
    const by = b.y / scale;
    const bw = b.w / scale;
    const bh = b.h / scale;
    octx.save();
    octx.beginPath();
    octx.rect(bx, by, bw, bh);
    octx.clip();
    octx.filter = `blur(${redactRadius(bw, bh)}px)`;
    octx.drawImage(image, 0, 0);
    octx.restore();
  }
  octx.filter = 'none';
  image.close();
  return canvasBlob(out, 0.9);
};

export const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]));
  reader.addEventListener('error', () => reject(new Error('The processed image could not be read.')));
  reader.readAsDataURL(blob);
});
