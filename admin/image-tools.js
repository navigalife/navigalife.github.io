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

// ---- Clean background (recovery photos) ------------------------------------
// Browser port of the advisor's bgswap.py: every recovery photo sits on ONE
// canonical neutral-gray studio backdrop (constants measured off the hero story),
// with the same soft contact shadow and the locked watermark. The subject mask
// comes from the API's /cutout (Cloudflare Images, segment: foreground). Do not
// tweak these constants per image: consistency across stories is the point.
// The 4:5 crop frame and its zoom cap (#crop-canvas, #crop-zoom max): the cutout
// is sized from what that frame can show, so the subject layer is never upscaled.
const CROP_FRAME = { w: 640, h: 800, zoom: 2 };
// /cutout refuses bodies over 15 MB (traffic/worker.js CUTOUT_MAX_BYTES); keep
// the work canvas well inside that whatever the source size.
const CUTOUT_MAX_PIXELS = 16e6;
const CUTOUT_MAX_BYTES = 15 * 1024 * 1024;
const smoothstep = (e0, e1, t) => {
  const x = Math.min(1, Math.max(0, (t - e0) / (e1 - e0)));
  return x * x * (3 - 2 * x);
};

const paintBackdrop = (w, h) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(w, h);
  const d = pixels.data;
  let seed = 7;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  for (let y = 0; y < h; y += 1) {
    const ty = h > 1 ? y / (h - 1) : 0;
    const row = 172 + 29 * smoothstep(0, 0.42, ty) - 6 * smoothstep(0.62, 1, ty); // top shade -> body -> ease off
    for (let x = 0; x < w; x += 1) {
      const tx = w > 1 ? (2 * x) / (w - 1) - 1 : 0;
      const grain = Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand()) * 0.7; // no WebP banding
      const lum = Math.round(Math.min(255, Math.max(0, row - 6 * Math.abs(tx) ** 2.2 + grain))); // faint side vignette
      const i = (y * w + x) * 4;
      d[i] = lum; d[i + 1] = lum; d[i + 2] = lum; d[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
};

// In-place separable box blur, edge-clamped; three passes ~ a Gaussian with
// sigma ~ r + 0.5.
const boxBlur = (a, w, h, r, passes) => {
  const b = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < h; y += 1) {
      const o = y * w;
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += a[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x += 1) {
        b[o + x] = sum / n;
        sum += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += b[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y += 1) {
        a[y * w + x] = sum / n;
        sum += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
};

// Photo + cutout alpha -> the subject layer: mask eroded 1px (kills floor/cloth
// halo) and feathered, then edge-band colours pulled toward the nearby solid
// subject so green floor / red cloth spill does not ride onto the backdrop.
const prepareSubject = (photo, cut) => {
  const { width: w, height: h } = photo;
  const n = w * h;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) raw[i] = cut.data[i * 4 + 3] / 255;
  const mask = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let min = 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        const row = Math.min(h - 1, Math.max(0, y + dy)) * w;
        for (let dx = -1; dx <= 1; dx += 1) min = Math.min(min, raw[row + Math.min(w - 1, Math.max(0, x + dx))]);
      }
      mask[y * w + x] = min;
    }
  }
  boxBlur(mask, w, h, 1, 2);
  const hard = new Float32Array(n);
  for (let i = 0; i < n; i += 1) hard[i] = mask[i] > 0.92 ? 1 : 0;
  const den = boxBlur(hard.slice(), w, h, 6, 3);
  const out = new ImageData(w, h);
  const num = new Float32Array(n);
  for (let c = 0; c < 3; c += 1) {
    for (let i = 0; i < n; i += 1) num[i] = photo.data[i * 4 + c] * hard[i];
    boxBlur(num, w, h, 6, 3);
    for (let i = 0; i < n; i += 1) {
      const a = mask[i];
      let v = photo.data[i * 4 + c];
      if (a > 0.02 && a < 0.92 && den[i] > 0.02) {
        const t = Math.min(1, Math.max(0, (0.92 - a) / 0.9));
        v = v * (1 - t) + (num[i] / (den[i] + 1e-6)) * t;
      }
      out.data[i * 4 + c] = v;
    }
  }
  for (let i = 0; i < n; i += 1) out.data[i * 4 + 3] = Math.round(mask[i] * 255);
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  layer.getContext('2d').putImageData(out, 0, 0);
  // Quarter-res mask for the contact shadow (blurred per zoom level at draw time).
  const lw = Math.max(1, Math.ceil(w / 4));
  const lh = Math.max(1, Math.ceil(h / 4));
  const low = new Float32Array(lw * lh);
  const count = new Float32Array(lw * lh);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const j = (y >> 2) * lw + (x >> 2);
      low[j] += mask[y * w + x];
      count[j] += 1;
    }
  }
  for (let j = 0; j < low.length; j += 1) low[j] /= count[j];
  return { layer, low, lw, lh, shadow: null, shadowKey: '' };
};

// Soft studio shadow: the mask, blurred to sigma = 2.5% of the frame width,
// at 16% black. Cached per on-screen subject width (i.e. per zoom level).
const shadowLayer = (subject, drawnWidth, frameWidth) => {
  const sigma = (frameWidth * 0.025 * subject.lw) / drawnWidth; // in low-res px
  const r = Math.max(1, Math.round(sigma - 0.5));
  const key = String(r);
  if (subject.shadowKey === key) return subject.shadow;
  const { lw, lh } = subject;
  const blurred = boxBlur(subject.low.slice(), lw, lh, r, 3);
  const pixels = new ImageData(lw, lh);
  for (let j = 0; j < blurred.length; j += 1) pixels.data[j * 4 + 3] = Math.round(blurred[j] * 0.16 * 255);
  const canvas = subject.shadow || document.createElement('canvas');
  canvas.width = lw;
  canvas.height = lh;
  canvas.getContext('2d').putImageData(pixels, 0, 0);
  subject.shadow = canvas;
  subject.shadowKey = key;
  return canvas;
};

// The canonical backdrop + contact shadow + subject, drawn at (x, y, width,
// height) inside a frame the size of `context`'s canvas. The crop dialog and the
// redaction dialog share this so every cleaned photo is composed the same way.
const drawCleanSubject = (context, subject, backdrop, x, y, width, height) => {
  const frame = context.canvas;
  context.drawImage(backdrop, 0, 0);
  context.drawImage(shadowLayer(subject, width, frame.width), x, y + Math.round(frame.height * 0.008), width, height);
  context.drawImage(subject.layer, x, y, width, height);
};

// The cutout's working resolution. The 4:5 crop draws the photo at cover scale
// times zoom, so at full zoom it needs max(1280/W, 1600/H) of the source (a
// landscape subject is limited by its height, not its long edge); natural-aspect
// callers pass 1 (their output is the source size). Never above the source.
const cropCutoutScale = (image) => CROP_FRAME.zoom * Math.max(CROP_FRAME.w / image.width, CROP_FRAME.h / image.height);
const encodeJpeg = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser could not encode the image.'))), 'image/jpeg', quality));
const cutoutSubject = async (image, cutout, wanted = cropCutoutScale(image)) => {
  const scale = Math.min(1, wanted, Math.sqrt(CUTOUT_MAX_PIXELS / (image.width * image.height)));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const context = work.getContext('2d', { willReadFrequently: true });
  // Transparent pixels (a PNG with alpha) sit on the canonical backdrop, so any
  // the cutout keeps inside the subject read as backdrop, never as black.
  context.drawImage(paintBackdrop(w, h), 0, 0);
  context.drawImage(image, 0, 0, w, h);
  const photo = context.getImageData(0, 0, w, h);
  let sent = await encodeJpeg(work, 0.92);
  if (sent.size > CUTOUT_MAX_BYTES) sent = await encodeJpeg(work, 0.8);
  const png = await createImageBitmap(await cutout(sent));
  context.clearRect(0, 0, w, h);
  context.drawImage(png, 0, 0, w, h);
  png.close();
  const cut = context.getImageData(0, 0, w, h);
  return prepareSubject(photo, cut);
};

// The whole dialog has to fit the screen (image, controls, and the save button,
// with no scrolling), so the canvas' displayed width is capped until its height
// fits what the rest of the dialog leaves free. The dialog's max-height must
// resolve to px (styles.css sets it in dvh at every width; the UA default is a
// percentage, reads as NaN, and skips the fit). `frame` is the canvas' own box
// when it has one (the redaction stage). Phones and laptop screens hit the cap.
const fitToScreen = (dialog, canvas, frame = canvas) => {
  canvas.style.maxWidth = '';
  const limit = parseFloat(getComputedStyle(dialog).maxHeight);
  if (!dialog.open || !Number.isFinite(limit) || !canvas.offsetHeight) return;
  const style = getComputedStyle(frame);
  const framePad = frame === canvas ? 0 : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const total = dialog.scrollHeight + dialog.offsetHeight - dialog.clientHeight;
  // -1: offsetHeight/scrollHeight are integers but the form can be fractional
  // (W2c: 0.7px at 360 with two-line buttons) — absorb it so the dialog never scrolls.
  const room = Math.floor(limit - (total - frame.offsetHeight) - framePad) - 1;
  if (canvas.offsetHeight > room) canvas.style.maxWidth = 'min(100%, ' + Math.max(96, Math.floor((room * canvas.offsetWidth) / canvas.offsetHeight)) + 'px)';
};

// A failed /cutout never falls back on its own: the toggle stays on, saving
// stays blocked, and the owner picks "Try again" or "Use original background"
// (or switches the toggle off). An uncleaned photo is only ever saved on purpose.
const cleanFailureText = (error) => (error && error.message ? error.message : 'Background cleaning failed.') + ' The background was not cleaned.';

// options.cutout(blob) -> Promise<Blob PNG with alpha>; when given, the dialog
// offers a per-image "Clean background" toggle that starts at
// options.cleanDefault (on unless false). On: the subject on the canonical gray
// backdrop. Off: the original background, and /cutout is never called. The
// cutout is fetched once, on first need, so flipping the toggle never re-requests
// it. The canvas always shows exactly what "Use crop" saves; "Use crop" waits
// while a cleaned preview is on its way and stays blocked after a failure until
// the owner chooses (cleanFailureText).
//
// The blog editor reuses this dialog for its photos with options.frame
// 'natural' (the frame takes the photo's own shape, long edge <= 2400; zoom and
// the sliders choose how close in, and the save keeps the source pixels the
// frame shows, never upscaled), options.watermark false, and its own
// options.kicker / options.title. Without them it is the 4:5 watermarked
// testimonial crop, unchanged; the 640x800 canvas and the kicker are put back
// when the dialog closes.
export const cropEvidenceImage = async (file, label, { cutout, cleanDefault, frame = '4:5', watermark = true, kicker, title } = {}) => {
  assertImage(file);
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const dialog = document.querySelector('#crop-dialog');
  const canvas = document.querySelector('#crop-canvas');
  const kickerEl = dialog.querySelector('.dialog-heading .auth-kicker');
  const kickerWas = kickerEl ? kickerEl.textContent : '';
  const natural = frame === 'natural';
  if (natural) {
    const fit = Math.min(1, 2400 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * fit));
    canvas.height = Math.max(1, Math.round(image.height * fit));
    canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    // A wide photo may use more of the dialog than the 4:5 frame's 400px;
    // fitToScreen still trims it to the height that is free.
    if (canvas.width > canvas.height) canvas.style.width = 'min(100%, 600px)';
  }
  if (kickerEl && kicker) kickerEl.textContent = kicker;
  const zoom = document.querySelector('#crop-zoom');
  const positionX = document.querySelector('#crop-x');
  const positionY = document.querySelector('#crop-y');
  const cleanRow = document.querySelector('#crop-clean-row');
  const clean = document.querySelector('#crop-clean');
  const note = document.querySelector('#crop-note');
  const apply = document.querySelector('#crop-apply');
  const choice = document.querySelector('#crop-choice');
  document.querySelector('#crop-title').textContent = title || `Crop ${label} image`;
  zoom.value = '1';
  positionX.value = '0';
  positionY.value = '0';
  cleanRow.hidden = !cutout;
  clean.checked = Boolean(cutout && (cleanDefault ?? true));
  clean.disabled = false;
  note.textContent = '';
  choice.hidden = true;
  apply.disabled = false;
  let subject = null;
  let pending = false;
  let backdrop = null;
  let open = true;

  // Paints the crop into any context whose canvas has the frame's shape: the
  // dialog canvas, or (natural frame) the save canvas at source resolution.
  const paint = (context) => {
    const { width: frameW, height: frameH } = context.canvas;
    const coverScale = Math.max(frameW / image.width, frameH / image.height);
    const scale = coverScale * Number(zoom.value);
    const width = image.width * scale;
    const height = image.height * scale;
    const overflowX = Math.max(0, width - frameW);
    const overflowY = Math.max(0, height - frameH);
    const x = -(overflowX / 2) + (Number(positionX.value) * overflowX / 2);
    const y = -(overflowY / 2) + (Number(positionY.value) * overflowY / 2);
    if (subject && clean.checked) {
      if (!backdrop || backdrop.width !== frameW || backdrop.height !== frameH) backdrop = paintBackdrop(frameW, frameH);
      drawCleanSubject(context, subject, backdrop, x, y, width, height);
    } else {
      context.fillStyle = '#F5F8F9';
      context.fillRect(0, 0, frameW, frameH);
      context.drawImage(image, x, y, width, height);
    }
    if (watermark) drawEvidenceWatermark(context, frameW);
  };
  const draw = () => paint(canvas.getContext('2d', { alpha: false }));
  const fit = () => fitToScreen(dialog, canvas);
  const setNote = (text) => {
    note.textContent = text;
    fit();
  };
  // "Use crop" saves the canvas as drawn, so it waits only while a cleaned
  // preview the owner asked for is still on its way.
  const sync = () => {
    apply.disabled = clean.checked && !subject;
    draw();
  };
  const requestClean = () => {
    if (subject || pending) return;
    pending = true;
    choice.hidden = true;
    setNote('Cleaning background…');
    cutoutSubject(image, cutout, natural ? CROP_FRAME.zoom * canvas.width / image.width : undefined).then((result) => {
      if (!open) return;
      subject = result;
      setNote('');
    }).catch((error) => {
      if (!open) return;
      // Only an owner still asking for a clean photo has a choice to make.
      choice.hidden = !clean.checked;
      setNote(clean.checked ? cleanFailureText(error) : '');
    }).finally(() => {
      pending = false;
      if (open) sync();
    });
  };
  const onClean = () => {
    if (clean.checked) requestClean();
    else if (!pending) {
      choice.hidden = true;
      setNote('');
    }
    sync();
  };
  const onChoice = (event) => {
    const action = event.target.closest('[data-clean]')?.dataset.clean;
    if (action === 'retry') requestClean();
    if (action === 'skip') {
      clean.checked = false;
      choice.hidden = true;
      setNote('');
    }
    sync();
  };
  choice.addEventListener('click', onChoice);
  zoom.addEventListener('input', draw);
  positionX.addEventListener('input', draw);
  positionY.addEventListener('input', draw);
  clean.addEventListener('change', onClean);
  window.addEventListener('resize', fit);
  if (clean.checked) requestClean();
  sync();

  const accepted = await new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'default'), { once: true });
    dialog.returnValue = ''; // Escape keeps the previous value; never let it read as "Use crop"
    dialog.showModal();
    fit();
  });
  open = false;
  apply.disabled = false;
  zoom.removeEventListener('input', draw);
  positionX.removeEventListener('input', draw);
  positionY.removeEventListener('input', draw);
  clean.removeEventListener('change', onClean);
  choice.removeEventListener('click', onChoice);
  window.removeEventListener('resize', fit);
  if (kickerEl) kickerEl.textContent = kickerWas;
  let out = canvas;
  if (natural) {
    // The frame at zoom z shows 1/z of the photo: save those pixels at their own
    // size, never stretched back up to the frame.
    if (accepted) {
      const z = Math.max(1, Number(zoom.value) || 1);
      out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(canvas.width / z));
      out.height = Math.max(1, Math.round(canvas.height / z));
      paint(out.getContext('2d', { alpha: false }));
    }
    canvas.width = CROP_FRAME.w;
    canvas.height = CROP_FRAME.h;
    canvas.style.aspectRatio = '';
    canvas.style.width = '';
    canvas.style.maxWidth = '';
  }
  image.close();
  if (!accepted) return null;
  return canvasBlob(out, natural ? 0.9 : 0.88);
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

// One redaction box of `source`, as an opaque tile that fully replaces the box
// when drawn at (x, y) on the same pixel scale. The blur samples the real
// neighbours around the box; then every tile pixel is divided by its own
// coverage (getImageData un-premultiplies) and made opaque. A plain clipped blur
// fades toward transparent where its kernel runs off the image, so a box near an
// edge (where chat headers put the contact name) let up to half of the sharp
// original show through (measured: alpha 127/255 at the border). The live
// preview and the bake both use this, so they cannot drift apart.
const redactionTile = (source, box) => {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.min(source.width, Math.ceil(box.x + box.w)) - x;
  const h = Math.min(source.height, Math.ceil(box.y + box.h)) - y;
  if (w < 1 || h < 1) return null;
  const tile = document.createElement('canvas');
  tile.width = w;
  tile.height = h;
  const t = tile.getContext('2d', { willReadFrequently: true });
  t.filter = `blur(${redactRadius(box.w, box.h)}px)`;
  t.drawImage(source, -x, -y);
  const pixels = t.getImageData(0, 0, w, h);
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
  t.putImageData(pixels, 0, 0);
  return { canvas: tile, x, y };
};

// Identity-redaction tool for chat-screenshot uploads. The editor drags one box
// per avatar / contact name / phone number; each is baked as a heavy, permanent
// Gaussian blur (non-generative — pixels are smeared, never invented). This is
// the interactive counterpart to the hand-coded fractional boxes in
// tools/prepare-solutions.py: the site build only downscales the result, so what
// is baked here is exactly what ships. Boxes live in DISPLAY-canvas coordinates
// and are mapped to natural pixels at bake time. Resolves to a WebP blob, or
// null if the editor cancels the upload.
//
// options.cutout: offer "Clean background" (natural aspect, no watermark), off
// unless options.cleanDefault is true. PRIVACY ORDER: redact FIRST, then cutout.
// The boxes are drawn on the original; "Bake blur & clean" burns every box into
// a natural-size copy (bakeRedacted), and only that copy is sent to /cutout. The
// cleaned result is built from the redacted pixels alone (subject from the
// redacted copy, backdrop painted), so the sharp original never leaves the
// browser and can never reappear: a box over the subject stays blurred, a box
// over the background becomes backdrop. The canvas then shows that result, and
// "Use cleaned image" saves exactly it; editing a box drops back to the original
// and the next save cleans again.
//
// The blog editor reuses this dialog for any photo: options.title, options.hint
// (replaces the screenshot instructions before the keyboard line),
// options.canvasLabel (the image's spoken name) and options.cancelText (the
// cancel button and the close button's name). Each is put back when the dialog
// closes, so the testimonial flow always opens with its own words.
export const redactImage = async (blob, label = 'screenshot', { cutout, cleanDefault, title: titleText, hint, canvasLabel, cancelText } = {}) => {
  const image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const dialog = document.querySelector('#redact-dialog');
  const canvas = document.querySelector('#redact-canvas');
  const hintEl = dialog.querySelector('.redact-hint');
  const hintText = hintEl && hintEl.firstChild && hintEl.firstChild.nodeType === 3 ? hintEl.firstChild : null;
  const cancelButton = dialog.querySelector('.form-actions [value="cancel"]');
  const closeButton = dialog.querySelector('.dialog-heading [value="cancel"]');
  const words = {
    hint: hintText ? hintText.nodeValue : '',
    canvas: canvas.getAttribute('aria-label'),
    cancel: cancelButton ? cancelButton.textContent : '',
    close: closeButton ? closeButton.getAttribute('aria-label') : '',
  };
  if (hintText && hint) hintText.nodeValue = `${hint} `;
  if (canvasLabel) canvas.setAttribute('aria-label', canvasLabel);
  if (cancelButton && cancelText) cancelButton.textContent = cancelText;
  if (closeButton && cancelText) closeButton.setAttribute('aria-label', cancelText);
  const stage = dialog.querySelector('.redact-stage');
  const removeButton = document.querySelector('#redact-remove');
  const clearButton = document.querySelector('#redact-clear');
  const editButton = document.querySelector('#redact-edit');
  const countLabel = document.querySelector('#redact-count');
  const announce = document.querySelector('#redact-announce');
  const title = document.querySelector('#redact-title');
  const cleanRow = document.querySelector('#redact-clean-row');
  const clean = document.querySelector('#redact-clean');
  const note = document.querySelector('#redact-note');
  const choice = document.querySelector('#redact-choice');
  const apply = document.querySelector('#redact-apply');
  title.textContent = titleText || `Blur identifying details: ${label}`;
  cleanRow.hidden = !cutout;
  clean.checked = Boolean(cutout && cleanDefault);
  note.textContent = '';
  choice.hidden = true;
  apply.disabled = false;
  let cleaned = null; // { key, canvas }: natural-size result cleaned from the redacted copy
  let reviewing = false; // the canvas shows `cleaned` (what will be saved), editing paused
  let pending = false;
  let run = 0; // a toggle-off or new request makes an in-flight result stale
  let open = true;

  // Fit the working canvas inside the viewport; boxes are stored at this scale.
  // From 1024px wide the controls sit beside the image (styles.css), so it may
  // take the screen height less the heading, buttons and margins (~240px);
  // fitToScreen trims the displayed size to what is actually free.
  const sideBySide = window.matchMedia('(min-width: 1024px)').matches;
  const maxW = Math.min(680, Math.round(window.innerWidth * 0.84));
  const maxH = Math.min(760, sideBySide ? window.innerHeight - 240 : Math.round(window.innerHeight * 0.6));
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
  // The boxes that bake (the MIN filter matches bakeRedacted), as a key: a cleaned
  // result is only ever saved for the exact boxes it was cleaned with.
  const baked = () => boxes.map(norm).filter((b) => b.w >= MIN && b.h >= MIN);
  const boxKey = () => JSON.stringify(baked());

  // Every box burned into a natural-size copy of the original: the plain save,
  // and the only image /cutout ever receives.
  const bakeRedacted = () => {
    const out = document.createElement('canvas');
    out.width = image.width;
    out.height = image.height;
    const octx = out.getContext('2d');
    octx.drawImage(image, 0, 0);
    for (const b of baked()) {
      const tile = redactionTile(image, { x: b.x / scale, y: b.y / scale, w: b.w / scale, h: b.h / scale });
      if (tile) octx.drawImage(tile.canvas, tile.x, tile.y);
    }
    return out;
  };

  // The original at display size, plus each box's blur tile at its current
  // geometry, so a drag re-blurs only the box being dragged.
  const photo = document.createElement('canvas');
  photo.width = canvas.width;
  photo.height = canvas.height;
  photo.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  let tiles = new Map();

  const boxCount = () => {
    const n = baked().length;
    return `${n} box${n === 1 ? '' : 'es'}`;
  };
  const draw = () => {
    countLabel.textContent = boxCount();
    removeButton.disabled = pending || selected < 0;
    clearButton.disabled = pending || boxes.length === 0;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (reviewing) {
      context.drawImage(cleaned.canvas, 0, 0, canvas.width, canvas.height);
      return;
    }
    const shown = new Map();
    context.drawImage(photo, 0, 0);
    boxes.forEach((raw, index) => {
      const b = norm(raw);
      if (b.w < 1 || b.h < 1) return;
      const id = b.x + ',' + b.y + ',' + b.w + ',' + b.h;
      const tile = tiles.get(id) || redactionTile(photo, b);
      if (tile) {
        shown.set(id, tile);
        context.drawImage(tile.canvas, tile.x, tile.y);
      }
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
    tiles = shown;
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
    if (pending) return;
    if (reviewing) { backToEdit(); return; } // touching the cleaned result means "edit the boxes"
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
    drag.pointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }
    draw();
  };
  // A box removed mid-drag (Delete, Clear all) ends that drag.
  const endDrag = () => {
    if (!drag) return;
    try { canvas.releasePointerCapture(drag.pointerId); } catch { /* already released */ }
    drag = null;
  };
  const onMove = (event) => {
    if (!drag) return;
    const b = boxes[drag.index];
    if (!b) { endDrag(); return; }
    const p = toCanvas(event);
    const cx = Math.max(0, Math.min(p.x, canvas.width));
    const cy = Math.max(0, Math.min(p.y, canvas.height));
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
    if (!boxes[drag.index]) { drag = null; draw(); return; }
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

  const say = (text) => { announce.textContent = text; };
  const onRemove = () => {
    if (pending || reviewing || selected < 0) return;
    endDrag();
    boxes.splice(selected, 1);
    selected = -1;
    draw();
    say(`Box removed. ${boxCount()} left.`);
  };
  const onClear = () => { if (pending || reviewing) return; endDrag(); boxes = []; selected = -1; draw(); say('All boxes cleared.'); };

  // Keyboard editing on the focused canvas: N adds a centred box, arrows move
  // the selected box (Shift: bigger steps), Alt/Option + arrows resize it, [ and ]
  // step through the boxes, Delete removes it. Tab is never handled, so focus
  // always moves on; Escape still closes the dialog.
  const STEP = 2;
  const BIG_STEP = 20;
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const selectedText = () => `Box ${selected + 1} of ${boxes.length} selected.`;
  const onCanvasKey = (event) => {
    if (event.ctrlKey || event.metaKey || drag) return;
    const key = event.key;
    const arrow = ARROWS[key];
    const add = key === 'n' || key === 'N';
    const cycle = key === '[' || key === ']';
    if (!arrow && !add && !cycle) return;
    event.preventDefault(); // arrows would otherwise scroll the stage
    if (pending) return;
    if (reviewing) { backToEdit(); say('Editing the blur boxes again.'); return; }
    if (add) {
      const w = Math.max(MIN * 2, Math.round(canvas.width * 0.3));
      const h = Math.max(MIN * 2, Math.round(Math.min(canvas.height * 0.08, canvas.width * 0.12)));
      boxes.push(clampBox({ x: Math.round((canvas.width - w) / 2), y: Math.round((canvas.height - h) / 2), w, h }));
      selected = boxes.length - 1;
      draw();
      say(`Box added. ${selectedText()}`);
      return;
    }
    if (!boxes.length) { say('No boxes yet. Press N to add one.'); return; }
    if (cycle) {
      const dir = key === ']' ? 1 : -1;
      selected = selected < 0 ? (dir > 0 ? 0 : boxes.length - 1) : (selected + dir + boxes.length) % boxes.length;
      draw();
      say(selectedText());
      return;
    }
    if (selected < 0) { say('No box selected. Press ] to select one.'); return; }
    const step = event.shiftKey ? BIG_STEP : STEP;
    const b = norm(boxes[selected]);
    if (event.altKey) {
      b.w = Math.max(MIN, Math.min(b.w + arrow[0] * step, canvas.width - b.x));
      b.h = Math.max(MIN, Math.min(b.h + arrow[1] * step, canvas.height - b.y));
    } else {
      b.x += arrow[0] * step;
      b.y += arrow[1] * step;
    }
    boxes[selected] = clampBox(b);
    draw();
  };
  const onKey = (event) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected >= 0) {
      event.preventDefault();
      onRemove();
    }
  };

  const fitDialog = () => fitToScreen(dialog, canvas, stage);
  const setNote = (text) => {
    note.textContent = text;
    fitDialog();
  };
  // The primary button is the plain bake (toggle off), the blur-then-clean step
  // (toggle on), or, once the cleaned result is on screen, saving exactly that.
  // A failure blocks it until the owner picks "Try again" or "Use original
  // background" (cleanFailureText).
  const sync = () => {
    if (reviewing && (!clean.checked || !cleaned || cleaned.key !== boxKey())) reviewing = false;
    apply.textContent = !clean.checked ? 'Blur & use' : reviewing ? 'Use cleaned image' : 'Blur & clean';
    apply.disabled = pending || (clean.checked && !choice.hidden);
    removeButton.hidden = reviewing;
    clearButton.hidden = reviewing;
    editButton.hidden = !reviewing;
    draw();
    fitDialog();
  };
  const REVIEW_NOTE = 'Background cleaned. This is the image that will be saved.';
  const backToEdit = () => {
    reviewing = false;
    setNote('');
    sync();
  };
  const requestClean = () => {
    const key = boxKey();
    choice.hidden = true;
    if (cleaned && cleaned.key === key) { // same boxes as last time: no second request
      reviewing = true;
      setNote(REVIEW_NOTE);
      sync();
      return;
    }
    const mine = ++run;
    pending = true;
    setNote('Blurring, then cleaning the background…');
    sync();
    const redacted = bakeRedacted(); // every box burned in BEFORE anything leaves the browser
    cutoutSubject(redacted, cutout, 1).then((subject) => {
      if (!open || mine !== run) return;
      const result = document.createElement('canvas');
      result.width = redacted.width;
      result.height = redacted.height;
      drawCleanSubject(result.getContext('2d'), subject, paintBackdrop(result.width, result.height), 0, 0, result.width, result.height);
      cleaned = { key, canvas: result };
      reviewing = true;
      setNote(REVIEW_NOTE);
    }).catch((error) => {
      if (!open || mine !== run) return;
      choice.hidden = false;
      setNote(cleanFailureText(error));
    }).finally(() => {
      if (mine !== run) return;
      pending = false;
      if (open) sync();
    });
  };
  const onClean = () => {
    if (pending) { // switching the toggle abandons an in-flight clean
      run += 1;
      pending = false;
    }
    reviewing = false;
    choice.hidden = true;
    setNote('');
    sync();
  };
  const onChoice = (event) => {
    const action = event.target.closest('[data-clean]')?.dataset.clean;
    if (action === 'retry') requestClean();
    if (action === 'skip') {
      clean.checked = false;
      onClean();
    }
  };
  const onApply = (event) => {
    if (!clean.checked || reviewing) return; // the plain bake, or the cleaned result on screen
    event.preventDefault();
    requestClean();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('keydown', onCanvasKey);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  removeButton.addEventListener('click', onRemove);
  clearButton.addEventListener('click', onClear);
  editButton.addEventListener('click', backToEdit);
  dialog.addEventListener('keydown', onKey);
  clean.addEventListener('change', onClean);
  choice.addEventListener('click', onChoice);
  apply.addEventListener('click', onApply);
  window.addEventListener('resize', fitDialog);
  sync();

  announce.textContent = '';
  const accepted = await new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'default'), { once: true });
    dialog.returnValue = ''; // Escape keeps the previous value; never let it read as a save
    dialog.showModal();
    fitDialog();
  });
  open = false;
  run += 1;

  canvas.removeEventListener('pointerdown', onDown);
  canvas.removeEventListener('keydown', onCanvasKey);
  canvas.removeEventListener('pointermove', onMove);
  canvas.removeEventListener('pointerup', onUp);
  canvas.removeEventListener('pointercancel', onUp);
  removeButton.removeEventListener('click', onRemove);
  clearButton.removeEventListener('click', onClear);
  editButton.removeEventListener('click', backToEdit);
  dialog.removeEventListener('keydown', onKey);
  clean.removeEventListener('change', onClean);
  choice.removeEventListener('click', onChoice);
  apply.removeEventListener('click', onApply);
  window.removeEventListener('resize', fitDialog);
  // With the toggle on, the only saveable state is the cleaned result on screen
  // for these exact boxes (onApply). Anything else is refused, never saved plain.
  const cleanedOut = clean.checked && reviewing && cleaned && cleaned.key === boxKey() ? cleaned.canvas : null;
  apply.textContent = 'Blur & use';
  apply.disabled = false;
  removeButton.hidden = false;
  clearButton.hidden = false;
  editButton.hidden = true;
  if (hintText) hintText.nodeValue = words.hint;
  if (words.canvas !== null) canvas.setAttribute('aria-label', words.canvas);
  if (cancelButton) cancelButton.textContent = words.cancel;
  if (closeButton && words.close !== null) closeButton.setAttribute('aria-label', words.close);

  if (!accepted) {
    // Focus goes back to the opener (or its re-rendered twin) through the
    // caller's focus keeper (admin/a11y.js), as it does after a crop.
    image.close();
    return null;
  }
  if (clean.checked && !cleanedOut) {
    image.close();
    throw new Error('The cleaned image was not ready, so nothing was saved. Upload the screenshot again.');
  }
  const out = cleanedOut || bakeRedacted();
  image.close();
  return canvasBlob(out, 0.9);
};

export const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]));
  reader.addEventListener('error', () => reject(new Error('The processed image could not be read.')));
  reader.readAsDataURL(blob);
});
