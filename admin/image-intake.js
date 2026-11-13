// Any-size image intake for the blog (browser ES module, no dependencies).
//
// The owner uploads from an iPhone and a desktop, and the ask is "an image of ANY
// size or dimensions". So nothing here rejects a file for being big: it is read,
// orientation-corrected, downscaled in the browser to a <=2400px long edge, and
// re-encoded (WebP; EXIF and every other metadata block dropped by the canvas).
// Only that small file is uploaded; the build makes the srcset sizes.
//
// Memory is the constraint, not file size. iOS caps a canvas at 16,777,216 px and
// kills the tab on huge allocations, so the full-resolution image is NEVER drawn
// into a canvas. Dimensions come from the file header (a few KB), and the decode
// goes straight to the target size with createImageBitmap's resize options. A
// browser that ignores those options hands back a full-size bitmap; it is then
// stepped down by halves on canvases that each stay under 16 MP.
//
// iPhone HEIC: Safari decodes it natively; Chrome and Firefox do not, so a
// vendored libheif build (admin/vendor/heic/, LGPL-3.0, its own file) is import()ed
// on first need only.
//
// Every failure throws an Error whose message is written for the owner (plain
// English, says what to do next); `error.code` is a stable machine tag
// (none|empty|read|not-image|corrupt|unsupported|heic|too-large|encode).

const SAFE_CANVAS_PIXELS = 16e6; // under iOS Safari's 16,777,216 px canvas cap
const HUGE_PIXELS = 100e6; // above this a failed decode is "too large", not "damaged"
const HEAD_BYTES = 256 * 1024; // headers (EXIF, HEIF meta) live well inside this
const HEIC_DECODER_URL = new URL('./vendor/heic/libheif-1.23.5.esm.js', import.meta.url).href;

const HEIC_MESSAGE = "This iPhone photo format couldn't be opened here — on iPhone, set Camera → Formats → Most Compatible, or open the admin in Safari.";
const FORMAT_NAMES = { jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', tiff: 'TIFF', heic: 'iPhone (HEIC)', avif: 'AVIF' };

const fail = (code, message, cause) => {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};

const quoted = (file) => (file && file.name ? `“${file.name}”` : 'This photo');

// ---- progress ------------------------------------------------------------------
// `fraction` is OVERALL progress (0..1, never goes backwards) so one progress bar
// can follow it; `stage` says which step is running. Decoding is one atomic browser
// call, so the bar holds inside that band rather than creeping.
const BANDS = {
  reading: [0, 0.05],
  decoding: [0.05, 0.7],
  resizing: [0.7, 0.85],
  encoding: [0.85, 0.99],
  done: [1, 1],
};
const LABELS = {
  reading: 'Reading the photo…',
  decoding: 'Opening the photo…',
  resizing: 'Resizing…',
  encoding: 'Saving a web copy…',
  done: 'Ready',
};
const progressReporter = (onProgress) => {
  let last = 0;
  return (stage, local = 0) => {
    if (typeof onProgress !== 'function') return;
    const [from, to] = BANDS[stage];
    last = Math.max(last, from + (to - from) * Math.min(1, Math.max(0, local)));
    try {
      onProgress({ stage, fraction: last, label: LABELS[stage] });
    } catch {
      // A broken progress callback must never break the upload itself.
    }
  };
};
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---- header parsing --------------------------------------------------------------
// Reads only the bytes it needs: the first 256 KB once, then small slices for the
// rare JPEG whose frame header sits past it (big XMP / Photoshop blocks).
const openReader = async (file) => {
  let head;
  try {
    head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  } catch (cause) {
    throw fail('read', `${quoted(file)} couldn't be read from this device. If it's stored in iCloud, open it once in Photos so it downloads, then pick it again.`, cause);
  }
  return {
    head,
    size: file.size,
    async bytes(offset, length) {
      if (offset + length <= head.length) return head.subarray(offset, offset + length);
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },
  };
};

const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0);

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'heif', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const isoBrands = (b) => {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return null;
  const size = Math.min(u32be(b, 0), b.length);
  const brands = [ascii(b, 8, 4)];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, 4));
  return brands;
};

// Container format from the leading bytes (never from the name or MIME type, which
// say nothing reliable — a .txt renamed .jpg still arrives as image/jpeg).
const sniff = (b) => {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length >= 6 && ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 26 && ascii(b, 0, 2) === 'BM') return 'bmp';
  if (b.length >= 4 && (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*')) return 'tiff';
  const brands = isoBrands(b);
  if (brands) {
    if (brands.some((x) => AVIF_BRANDS.has(x))) return 'avif';
    if (brands.some((x) => HEIC_BRANDS.has(x))) return 'heic';
  }
  return null;
};

// Formats every browser's createImageBitmap decodes: a refusal is a damaged file.
const STRICT_FORMATS = new Set(['jpeg', 'png', 'gif', 'webp', 'bmp']);

const looksHeicByName = (file) => /^image\/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');

// EXIF orientation (tag 0x0112) from a TIFF block. 1 = upright; 5-8 swap the axes.
const exifOrientation = (b, tiff) => {
  if (tiff + 8 > b.length) return 1;
  const le = ascii(b, tiff, 2) === 'II';
  const r16 = (i) => (le ? u16le(b, i) : u16be(b, i));
  const r32 = (i) => (le ? u32le(b, i) : u32be(b, i));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > b.length) return 1;
  const count = r16(ifd);
  for (let k = 0; k < count; k += 1) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > b.length) break;
    if (r16(entry) === 0x0112) {
      const value = r16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
};

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const jpegInfo = async (reader) => {
  let pos = 2;
  let orientation = 1;
  let exif = false;
  for (let guard = 0; guard < 4096 && pos + 4 <= reader.size; guard += 1) {
    const h = await reader.bytes(pos, 4);
    if (h[0] !== 0xff) return null;
    const marker = h[1];
    if (marker === 0xff) { pos += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // image data before any frame header
    const length = u16be(h, 2);
    if (length < 2) return null;
    if (marker === 0xe1 && !exif) {
      const seg = await reader.bytes(pos + 4, Math.min(length - 2, 65533));
      if (seg.length >= 14 && ascii(seg, 0, 6) === 'Exif\0\0') {
        exif = true;
        orientation = exifOrientation(seg, 6);
      }
    }
    if (SOF_MARKERS.has(marker)) {
      const sof = await reader.bytes(pos + 4, 5);
      const height = u16be(sof, 1);
      const width = u16be(sof, 3);
      return width && height ? { width, height, orientation, exif } : null;
    }
    pos += 2 + length;
  }
  return null;
};

const webpInfo = (b) => {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, orientation: 1, exif: false };
  }
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, orientation: 1, exif: false };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, orientation: 1, exif: Boolean(b[20] & 0x08) };
  }
  return null;
};

// HEIF/AVIF (ISO-BMFF): the primary item's `ispe` gives the stored size and its
// `irot` the rotation the decoder applies (90/270 swap the axes).
const isoBoxes = (b, start, end) => {
  const boxes = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = u32be(b, pos);
    const type = ascii(b, pos + 4, 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = u32be(b, pos + 8) * 2 ** 32 + u32be(b, pos + 12);
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header) break;
    boxes.push({ type, start: pos + header, end: Math.min(pos + size, end) });
    pos += size;
  }
  return boxes;
};
const heifInfo = (b) => {
  const meta = isoBoxes(b, 0, b.length).find((box) => box.type === 'meta');
  if (!meta) return null;
  const children = isoBoxes(b, meta.start + 4, meta.end); // meta is a FullBox
  const pitm = children.find((box) => box.type === 'pitm');
  const iprp = children.find((box) => box.type === 'iprp');
  if (!pitm || !iprp) return null;
  const primary = b[pitm.start] === 0 ? u16be(b, pitm.start + 4) : u32be(b, pitm.start + 4);
  const props = isoBoxes(b, iprp.start, iprp.end);
  const ipco = props.find((box) => box.type === 'ipco');
  if (!ipco) return null;
  const properties = isoBoxes(b, ipco.start, ipco.end); // 1-based in ipma
  const linked = [];
  for (const ipma of props.filter((box) => box.type === 'ipma')) {
    const version = b[ipma.start];
    const wide = b[ipma.start + 3] & 1;
    let p = ipma.start + 4;
    const entries = u32be(b, p);
    p += 4;
    for (let e = 0; e < entries && p < ipma.end; e += 1) {
      const item = version < 1 ? u16be(b, p) : u32be(b, p);
      p += version < 1 ? 2 : 4;
      const n = b[p];
      p += 1;
      for (let k = 0; k < n; k += 1) {
        const index = wide ? u16be(b, p) & 0x7fff : b[p] & 0x7f;
        p += wide ? 2 : 1;
        if (item === primary && index > 0) linked.push(properties[index - 1]);
      }
    }
  }
  const ispe = linked.find((box) => box && box.type === 'ispe');
  if (!ispe) return null;
  const irot = linked.find((box) => box && box.type === 'irot');
  const quarterTurns = irot ? b[irot.start] & 3 : 0;
  const width = u32be(b, ispe.start + 4);
  const height = u32be(b, ispe.start + 8);
  if (!width || !height) return null;
  // `swap` marks dimensions that are stored sideways; the decoder turns them upright.
  return { width, height, orientation: 1, swap: quarterTurns % 2 === 1, exif: false };
};

// A container whose declared length runs past the end of the file was cut short
// (an interrupted download / AirDrop). HEIF decoders otherwise paint the missing
// tiles green and WebP decoders grey, without any error. ISO-BMFF: walk the
// top-level boxes; WebP: the RIFF length.
const isTruncated = async (reader, format) => {
  if (format === 'webp') return 8 + u32le(reader.head, 4) > reader.size;
  if (format !== 'heic' && format !== 'avif') return false;
  let pos = 0;
  for (let guard = 0; guard < 256 && pos < reader.size; guard += 1) {
    const h = await reader.bytes(pos, 16);
    if (h.length < 8) return true;
    let size = u32be(h, 0);
    if (size === 0) return false; // last box, runs to the end of the file
    if (size === 1) size = h.length >= 16 ? u32be(h, 8) * 2 ** 32 + u32be(h, 12) : 0;
    if (size < 8 || pos + size > reader.size) return true;
    pos += size;
  }
  return false;
};

// { width, height } upright (as the owner sees the photo), plus the EXIF
// orientation the browser is expected to apply. null when the header can't say.
const readInfo = async (reader, format) => {
  const b = reader.head;
  let raw = null;
  try {
    if (format === 'jpeg') raw = await jpegInfo(reader);
    else if (format === 'png' && ascii(b, 12, 4) === 'IHDR') raw = { width: u32be(b, 16), height: u32be(b, 20), orientation: 1, exif: false };
    else if (format === 'gif') raw = { width: u16le(b, 6), height: u16le(b, 8), orientation: 1, exif: false };
    else if (format === 'webp') raw = webpInfo(b);
    else if (format === 'bmp') raw = { width: Math.abs(b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24)), height: Math.abs(b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] << 24)), orientation: 1, exif: false };
    else if (format === 'heic' || format === 'avif') raw = heifInfo(b);
  } catch {
    raw = null; // a malformed header only costs the cheap path, never the upload
  }
  if (!raw || !(raw.width > 0) || !(raw.height > 0)) return null;
  const swap = raw.swap || raw.orientation >= 5;
  return {
    width: swap ? raw.height : raw.width,
    height: swap ? raw.width : raw.height,
    orientation: raw.orientation,
    exif: raw.exif,
    truncated: await isTruncated(reader, format).catch(() => false),
  };
};

// ---- sizing -----------------------------------------------------------------------
const fitLongEdge = (maxEdge) => (w, h) => {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
};
const fitPixels = (maxPixels) => (w, h) => {
  const scale = Math.min(1, Math.sqrt(maxPixels / (w * h)));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
};
const close = (a, b) => Math.abs(a - b) <= 1;

// ---- canvases (each one <=16 MP, released as soon as it is used) -----------------
const makeCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
const release = (source) => {
  if (!source) return;
  if (typeof source.close === 'function') source.close(); // ImageBitmap
  else if ('width' in source && source.getContext) { source.width = 0; source.height = 0; } // canvas
};
const smooth = (context) => {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
};

// EXIF orientations 5-8, for a browser that handed back the stored (sideways)
// pixels. Draws `source` (raw w x h) upright into a (h x w)-shaped context.
const ORIENT_TRANSFORMS = {
  5: () => [0, 1, 1, 0, 0, 0],
  6: (w, h) => [0, 1, -1, 0, h, 0],
  7: (w, h) => [0, -1, -1, 0, h, w],
  8: (w, h) => [0, -1, 1, 0, 0, w],
};

// Halve until within 2x of the target (each halving is a clean 2:1 filter, so a
// 12000px photo doesn't alias the way one 5:1 draw does), then one last draw at the
// exact size. A first step that would still exceed 16 MP is clamped to 16 MP.
const stepDown = async (source, sw, sh, tw, th, report) => {
  let current = source;
  let w = sw;
  let h = sh;
  const total = Math.max(1, Math.ceil(Math.log2(Math.max(sw / tw, sh / th, 1))));
  let step = 0;
  while (w > tw * 2 || h > th * 2) {
    let nw = Math.max(tw, Math.ceil(w / 2));
    let nh = Math.max(th, Math.ceil(h / 2));
    if (nw * nh > SAFE_CANVAS_PIXELS) {
      const k = Math.sqrt(SAFE_CANVAS_PIXELS / (nw * nh));
      nw = Math.max(tw, Math.floor(nw * k));
      nh = Math.max(th, Math.floor(nh * k));
    }
    const canvas = makeCanvas(nw, nh);
    smooth(canvas.getContext('2d')).drawImage(current, 0, 0, w, h, 0, 0, nw, nh);
    if (current !== source) release(current);
    current = canvas;
    w = nw;
    h = nh;
    step += 1;
    report('resizing', step / (total + 1));
    await nextFrame();
  }
  const out = makeCanvas(tw, th);
  smooth(out.getContext('2d')).drawImage(current, 0, 0, w, h, 0, 0, tw, th);
  if (current !== source) release(current);
  return out;
};

// ---- decoding ----------------------------------------------------------------------
const hasBitmap = typeof createImageBitmap === 'function';

// Native decode, straight to size when the target is known. Only the LONG edge is
// requested: the browser derives the other from the upright aspect, so a browser
// that resizes before rotating (or ignores the EXIF tag) still keeps the aspect
// and is caught by the dimension checks in toTarget() instead of distorting.
const bitmapDecode = (file, info, target, nativeResize) => {
  const options = { imageOrientation: 'from-image' };
  if (info && target && nativeResize && (target.width < info.width || target.height < info.height)) {
    options.resizeQuality = 'high';
    if (info.width >= info.height) options.resizeWidth = target.width;
    else options.resizeHeight = target.height;
  }
  return createImageBitmap(file, options);
};

// <img> fallback: browsers whose createImageBitmap is missing or refuses a format
// that <img> takes (iOS also subsamples very large <img> decodes on its own).
const imageDecode = async (file) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error('empty image');
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
};

let heifModule = null;
const loadHeif = () => {
  heifModule ||= import(HEIC_DECODER_URL).then(({ default: factory }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('libheif init timed out')), 60000);
    factory({
      onRuntimeInitialized() { clearTimeout(timer); resolve(this); },
      onAbort(what) { clearTimeout(timer); reject(new Error(`libheif aborted: ${what}`)); },
    });
  })).catch((error) => {
    heifModule = null; // a failed fetch (offline) can be retried on the next upload
    error.heifLoad = true;
    throw error;
  });
  return heifModule;
};

// Vendored libheif: full-size RGBA (libheif applies the HEIF rotation itself), then
// resized by createImageBitmap — no full-size canvas. Runs on desktop Chrome/Firefox
// in practice; Safari (incl. every iPhone) decodes HEIC natively above.
const heifDecode = async (file, fit, report) => {
  const lib = await loadHeif();
  report('decoding', 0.3);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new lib.HeifDecoder();
  let images = [];
  try {
    images = decoder.decode(bytes);
    const image = images.find((candidate) => candidate.is_primary()) || images[0];
    if (!image) throw new Error('no image in HEIF container');
    const width = image.get_width();
    const height = image.get_height();
    const pixels = new ImageData(width, height);
    await new Promise((resolve, reject) => image.display(pixels, (out) => (out ? resolve() : reject(new Error('HEIF decode failed')))));
    report('decoding', 0.85);
    const target = fit(width, height);
    const options = target.width < width
      ? { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' }
      : {};
    const bitmap = await createImageBitmap(pixels, options);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, upright: { width, height }, done: () => bitmap.close() };
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) lib.heif_context_free(decoder.decoder);
    decoder.decoder = null;
  }
};

const decodeError = (file, format, info, causes) => {
  const name = quoted(file);
  if (format === 'heic' || (!format && looksHeicByName(file))) {
    if (causes.some((cause) => cause && cause.heifLoad)) {
      return fail('heic', "The iPhone photo reader couldn't be downloaded. Check the internet connection and try again — or open the admin in Safari, which reads iPhone photos on its own.", causes);
    }
    return fail('heic', HEIC_MESSAGE, causes);
  }
  if (format === 'avif') return fail('unsupported', `${name} is an AVIF image, which this browser can't open. Use an up-to-date Chrome, Safari or Firefox, or save it as a JPEG first.`, causes);
  if (format === 'tiff') return fail('unsupported', `${name} is a TIFF image, which this browser can't open. Save it as a JPEG or PNG first, then upload that.`, causes);
  if (!format) return fail('not-image', `${name} isn't a photo this page can open — what's inside the file isn't an image. Choose a JPEG, PNG, WebP, GIF or iPhone (HEIC) photo.`, causes);
  if (info && info.width * info.height > HUGE_PIXELS) {
    return fail('too-large', `${name} is too large for this browser to open (${info.width.toLocaleString('en-US')} × ${info.height.toLocaleString('en-US')} pixels). Save a smaller copy (under about 100 megapixels) and upload that.`, causes);
  }
  return fail('corrupt', `${name} looks like a ${FORMAT_NAMES[format]} photo but couldn't be opened — the file may be damaged or only partly downloaded. Save or export it again, then pick the new copy.`, causes);
};

// Decodes `file` and returns a canvas at exactly fit(uprightW, uprightH).
// `test` (dev page only): { nativeResize: false } forces the stepped canvas path;
// { decodeBlob } decodes that blob instead of `file` (headers still come from
// `file`) — the dev page passes an EXIF-stripped copy to run the manual rotation.
const render = async (file, { fit, report, test = {} }) => {
  const nativeResize = test.nativeResize !== false;
  if (!(file instanceof Blob)) throw fail('none', 'No photo was chosen. Pick a photo and try again.');
  if (!file.size) {
    throw fail('empty', `${quoted(file)} is empty (0 bytes), so there's no photo in it. Pick it again — if it came from iCloud, WhatsApp or another app, let it finish downloading first.`);
  }
  report('reading', 0);
  const reader = await openReader(file);
  const format = sniff(reader.head);
  if (!format && !/^image\//i.test(file.type || '') && !looksHeicByName(file)) throw decodeError(file, null, null);
  const info = format ? await readInfo(reader, format) : null;
  if (info && info.truncated) {
    throw fail('corrupt', `${quoted(file)} is incomplete — only part of the photo is in the file, so it was probably cut off while downloading or copying. Save or export it again, then pick the new copy.`);
  }
  const target = info ? fit(info.width, info.height) : null;
  report('reading', 1);
  report('decoding', 0);
  await nextFrame();

  // 1) createImageBitmap at target size  2) createImageBitmap full size (a browser
  // whose resize path chokes)  3) <img>, only where createImageBitmap is missing or
  // the format's support varies by browser — for JPEG/PNG/GIF/WebP/BMP a refusal
  // means a damaged file, and <img> would happily show a truncated photo half blank
  // 4) vendored libheif (HEIC only).
  const causes = [];
  let decoded = null;
  let decoder = '';
  if (hasBitmap) {
    for (const resize of nativeResize && target ? [true, false] : [false]) {
      try {
        const bitmap = await bitmapDecode(test.decodeBlob || file, info, target, resize);
        decoded = { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
        decoder = 'bitmap';
        break;
      } catch (error) { causes.push(error); }
    }
  }
  if (!decoded && (!hasBitmap || !STRICT_FORMATS.has(format))) {
    try {
      decoded = await imageDecode(file);
      decoder = 'img';
    } catch (error) { causes.push(error); }
  }
  if (!decoded && (format === 'heic' || (!format && looksHeicByName(file)))) {
    try {
      decoded = await heifDecode(file, fit, report);
      decoder = 'libheif';
    } catch (error) { causes.push(error); }
  }
  if (!decoded) throw decodeError(file, format, info, causes);
  report('decoding', 1);

  try {
    return await toTarget(decoded, info, fit, report, decoder, format);
  } finally {
    decoded.done();
  }
};

// Whatever the decoder handed back (exact size, full size, or sideways), make the
// upright target-size canvas.
const toTarget = async (decoded, info, fit, report, decoder, format) => {
  report('resizing', 0);
  let { source, width: w, height: h } = decoded;
  // The upright size: libheif's own word, else the header, else the decoded size.
  let upright = decoded.upright
    || (info ? { width: info.width, height: info.height } : { width: w, height: h });
  let { width: tw, height: th } = fit(upright.width, upright.height);
  let rotated = null;
  // Sideways result: the browser didn't apply EXIF 5-8. Rotate while stepping down.
  const sideways = Boolean(info && info.orientation >= 5 && upright.width !== upright.height
    && (w > h) !== (upright.width > upright.height));
  if (!sideways && Math.abs(w / h - upright.width / upright.height) > 0.01 * (upright.width / upright.height)) {
    // The decode disagrees with the header in a way EXIF doesn't explain (e.g. a
    // container rotation the browser skipped). Never squash a photo to fit a
    // header: the decoded pixels win.
    upright = (w > h) === (upright.height > upright.width) && close(w / h, upright.height / upright.width)
      ? { width: upright.height, height: upright.width }
      : { width: w, height: h };
    ({ width: tw, height: th } = fit(upright.width, upright.height));
  }
  if (sideways) {
    // Shrink first (sideways, on a <=16 MP canvas) so the rotation canvas is small.
    const small = await stepDown(source, w, h, Math.min(w, th), Math.min(h, tw), report);
    rotated = makeCanvas(small.height, small.width);
    const context = smooth(rotated.getContext('2d'));
    context.setTransform(...ORIENT_TRANSFORMS[info.orientation](small.width, small.height));
    context.drawImage(small, 0, 0);
    release(small);
    source = rotated;
    w = rotated.width;
    h = rotated.height;
  }
  let canvas;
  let width = tw;
  let height = th;
  let steps = false;
  if (close(w, tw) && close(h, th)) {
    // Native resize landed (the browser may round the derived edge differently).
    width = w;
    height = h;
    canvas = makeCanvas(w, h);
    canvas.getContext('2d').drawImage(source, 0, 0);
  } else {
    canvas = await stepDown(source, w, h, tw, th, report);
    steps = true;
  }
  release(rotated);
  report('resizing', 1);
  const path = [decoder, sideways && 'rotate', steps && 'steps'].filter(Boolean).join('+');
  return { canvas, width, height, originalWidth: upright.width, originalHeight: upright.height, decoder: path, format };
};

// ---- encoding ----------------------------------------------------------------------
const toBlob = (canvas, type, quality) => new Promise((resolve) => {
  try {
    canvas.toBlob(resolve, type, quality);
  } catch {
    resolve(null);
  }
});
// JPEG has no alpha: flatten transparent areas onto white rather than black.
const flatten = (canvas) => {
  const flat = makeCanvas(canvas.width, canvas.height);
  const context = flat.getContext('2d', { alpha: false });
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, flat.width, flat.height);
  context.drawImage(canvas, 0, 0);
  return flat;
};
const encodeJpeg = async (canvas, quality) => {
  const flat = flatten(canvas);
  try {
    return await toBlob(flat, 'image/jpeg', quality);
  } finally {
    release(flat);
  }
};
// Older Safari can't encode WebP and silently hands back PNG; probe once on a 1x1
// canvas so a phone doesn't pay for a full-size PNG encode it then throws away.
let webpEncode = null;
const canEncodeWebp = () => {
  if (webpEncode === null) {
    try {
      webpEncode = makeCanvas(1, 1).toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      webpEncode = false;
    }
  }
  return webpEncode;
};
const encodeError = (cause) => fail('encode', "This browser couldn't save the resized photo. Try again, or use a different browser (Safari or Chrome).", cause);

const outputName = (file, type) => {
  const base = String((file && file.name) || 'image')
    .replace(/\.[^./\\]+$/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'image';
  return `${base}.${type === 'image/webp' ? 'webp' : 'jpg'}`;
};

// ---- public API -------------------------------------------------------------------

/**
 * Accept any image file (any byte size, any dimensions, HEIC included) and return a
 * web copy: upright, <= maxEdge on the long side (never upscaled), metadata-free.
 *
 * @param {File|Blob} file
 * @param {{ maxEdge?: number, quality?: number,
 *           onProgress?: (p: { stage: 'reading'|'decoding'|'resizing'|'encoding'|'done',
 *                              fraction: number, label: string }) => void }} [options]
 *   `fraction` is overall progress 0..1 (monotonic); `label` is owner-readable.
 * @returns {Promise<{ blob: Blob, type: 'image/webp'|'image/jpeg', width: number,
 *   height: number, originalWidth: number, originalHeight: number,
 *   originalBytes: number, name: string, decoder: string }>}
 *   original* are the upright source dimensions; `type` is what the browser really
 *   produced (older Safari can't encode WebP and gets JPEG). `decoder` is
 *   diagnostic only (bitmap | img | libheif, +rotate / +steps).
 *   `__test` is for admin/__intake.html only (see render()).
 * @throws {Error} with an owner-readable `message` and a machine `code`.
 */
export async function intakeImage(file, { maxEdge = 2400, quality = 0.86, onProgress, __test } = {}) {
  const report = progressReporter(onProgress);
  const edge = Math.max(1, Math.floor(Number(maxEdge) || 2400));
  const q = Math.min(1, Math.max(0.1, Number(quality) || 0.86));
  const rendered = await render(file, { fit: fitLongEdge(edge), report, test: __test || {} });
  const { canvas } = rendered;
  try {
    report('encoding', 0);
    await nextFrame();
    let blob = canEncodeWebp() ? await toBlob(canvas, 'image/webp', q) : null;
    if (!blob || blob.type !== 'image/webp') {
      // Older Safari returns PNG for an unsupported type without saying so.
      report('encoding', 0.5);
      blob = await encodeJpeg(canvas, q);
    }
    if (!blob || !blob.size) throw encodeError();
    report('done', 1);
    return {
      blob,
      type: blob.type,
      width: rendered.width,
      height: rendered.height,
      originalWidth: rendered.originalWidth,
      originalHeight: rendered.originalHeight,
      originalBytes: file.size,
      name: outputName(file, blob.type),
      decoder: rendered.decoder,
    };
  } finally {
    release(canvas);
  }
}

/**
 * Cheap header read (no decode): the upright size and container format, or null
 * when the header can't say (unknown/odd format — intakeImage still tries a decode).
 * @param {Blob} file
 * @returns {Promise<{ format: string, width: number, height: number, orientation: number } | null>}
 */
export async function imageInfo(file) {
  if (!(file instanceof Blob) || !file.size) return null;
  const reader = await openReader(file);
  const format = sniff(reader.head);
  const info = format ? await readInfo(reader, format) : null;
  return info ? { format, width: info.width, height: info.height, orientation: info.orientation } : null;
}

const CUTOUT_PASSTHROUGH = new Set(['jpeg', 'png', 'webp']);

/**
 * Shrink an image until the Worker's /cutout accepts it (<= maxBytes, <= maxMegapixels
 * MP, JPEG/PNG/WebP). A blob that already fits and carries no EXIF (orientation or
 * location) is returned untouched; anything else is re-encoded as JPEG (transparent
 * areas on white), stepping quality and then size down until it fits.
 *
 * @param {Blob} blob
 * @param {{ maxMegapixels?: number, maxBytes?: number }} [options]
 * @returns {Promise<Blob>}
 */
export async function downscaleForCutout(blob, { maxMegapixels = 15, maxBytes = 15e6, onProgress } = {}) {
  const report = progressReporter(onProgress);
  const maxPixels = Math.max(1, Number(maxMegapixels) || 15) * 1e6;
  const byteCap = Math.max(1024, Number(maxBytes) || 15e6);
  if (blob instanceof Blob && blob.size && blob.size <= byteCap) {
    const reader = await openReader(blob);
    const format = sniff(reader.head);
    const info = format ? await readInfo(reader, format) : null;
    if (CUTOUT_PASSTHROUGH.has(format) && info && !info.exif && info.width * info.height <= maxPixels) {
      report('done', 1);
      return blob;
    }
  }
  let pixels = maxPixels;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rendered = await render(blob, { fit: fitPixels(pixels), report });
    try {
      report('encoding', 0);
      for (const quality of [0.92, 0.85, 0.75]) {
        const out = await encodeJpeg(rendered.canvas, quality);
        if (!out || !out.size) throw encodeError();
        if (out.size <= byteCap) {
          report('done', 1);
          return out;
        }
      }
    } finally {
      release(rendered.canvas);
    }
    pixels = Math.min(pixels, rendered.width * rendered.height) * 0.6;
  }
  throw fail('too-large', `${quoted(blob)} couldn't be made small enough for the clean-background tool. Try a smaller copy of the photo.`);
}
