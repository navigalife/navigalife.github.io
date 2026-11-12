// Videos — data/films.json, the case clips in “Complications we manage”.
// A sibling of Solutions: a reorderable list plus a per-video editor.
//
// A clip is an MP4 of at most 25 MB, committed byte-for-byte at a fresh path
// assets/conditions/case-NN.mp4. Its length is read from the file's metadata
// (rounded to whole seconds, m:ss). The poster is deliberately NOT a photo
// upload and skips the evidence pipeline: it is a frame grabbed from the clip at
// the moment the owner picks on the scrubber, cover-cropped to 480 x 854 JPEG
// (the site's video-tile shape), so the thumbnail always matches the video.
//
// Asset states follow therapy-editor.js (AGENTS Lesson 1): every clip and poster
// takes a fresh path, so a path is committed, staged-new, or tombstoned and is
// never overwritten. Replacing a clip or re-picking a poster releases the old
// path (staged-new -> dropped, committed -> deletion staged) unless another
// video still references it. Cancelling the editor restores the snapshot.
//
// Validation is content-rules.js validateFilmsDetailed on the list as it would
// be saved; errors render next to their field and block the save.
import './content-rules.js';

export const MAX_CLIP_BYTES = 25 * 1024 * 1024;
export const POSTER_WIDTH = 480;
export const POSTER_HEIGHT = 854;
const POSTER_QUALITY = 0.9;
const CLIP_DIR = 'assets/conditions';
const CLIP_PREFIX = 'case';

const rules = () => globalThis.MediVascContentRules;

const fieldMessage = (message) => {
  const text = String(message).replace(/^Videos:\s*/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Whole seconds, as the site's duration badge shows them (5.77 s -> 0:06).
export const formatDuration = (seconds) => {
  const total = Math.max(1, Math.round(seconds));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
};

// Scrubber readout, to a tenth of a second (0:01.5).
const formatClock = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  return Math.floor(value / 60) + ':' + (value % 60).toFixed(1).padStart(4, '0');
};

const fileName = (path) => String(path || '').split('/').pop();

// MP4 only, at most 25 MB. Throws an owner-readable message otherwise.
export const checkClipFile = (file) => {
  const name = file?.name || 'This file';
  const isMp4 = Boolean(file) && (file.type === 'video/mp4' || (!file.type && /\.mp4$/i.test(file.name)));
  if (!isMp4) throw new Error('Videos must be MP4 files, and “' + name + '” is not. Export or convert it to MP4 (H.264), then try again.');
  if (file.size > MAX_CLIP_BYTES) {
    throw new Error('“' + name + '” is ' + (file.size / 1024 / 1024).toFixed(1) + ' MB. A video can be at most 25 MB: trim it or export it at a lower resolution, then try again.');
  }
};

const unplayable = 'This clip can’t be played in the browser. Export it as an H.264 MP4, then try again.';

// A detached <video> with its first frame decoded. Remote (committed) clips load
// with CORS so their frames can be drawn to a canvas.
const openVideo = (url) => new Promise((resolve, reject) => {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (!url.startsWith('blob:')) video.crossOrigin = 'anonymous';
  const timer = setTimeout(() => reject(new Error('The clip took too long to load.')), 30000);
  video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(video); }, { once: true });
  video.addEventListener('error', () => { clearTimeout(timer); reject(new Error(unplayable)); }, { once: true });
  video.src = url;
});

const closeVideo = (video) => {
  video.removeAttribute('src');
  video.load();
};

const seekTo = (video, time) => new Promise((resolve) => {
  const timer = setTimeout(resolve, 5000);
  video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
  video.currentTime = time;
});

// Last seekable instant that still has a picture (the very end can be blank).
const lastFrame = (duration) => Math.max(0, duration - 0.05);
const clampTime = (time, duration) => Math.min(Math.max(0, Number(time) || 0), lastFrame(duration));

export const probeClip = async (url) => {
  const video = await openVideo(url);
  try {
    if (!video.videoWidth || !video.videoHeight) throw new Error('This file has no picture track. Choose a video clip.');
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('The clip’s length could not be read. Export it again as an MP4, then try again.');
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  } finally {
    closeVideo(video);
  }
};

// The frame at `time`, cover-cropped (centred) to the 480 x 854 poster.
export const grabPoster = async (url, time) => {
  const video = await openVideo(url);
  try {
    await seekTo(video, clampTime(time, video.duration));
    const canvas = document.createElement('canvas');
    canvas.width = POSTER_WIDTH;
    canvas.height = POSTER_HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    const scale = Math.max(POSTER_WIDTH / video.videoWidth, POSTER_HEIGHT / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.drawImage(video, (POSTER_WIDTH - width) / 2, (POSTER_HEIGHT - height) / 2, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This browser could not encode the poster.'))),
      'image/jpeg',
      POSTER_QUALITY,
    ));
  } catch (error) {
    if (error?.name === 'SecurityError') throw new Error('The current clip could not be read to make a new poster. Replace the clip instead.');
    throw error;
  } finally {
    closeVideo(video);
  }
};

export const createFilmsEditor = (ctx) => {
  const { state, h } = ctx;

  const films = () => {
    if (!Array.isArray(state.draft.films)) state.draft.films = [];
    return state.draft.films;
  };
  const isOpen = () => state.editor?.kind === 'films';
  const blank = () => ({ src: '', poster: '', duration: '', caption: '', featured: false });

  // Per-editor media state: where the clip plays from, the chosen poster time,
  // and whether the poster must be (re)grabbed on save.
  const media = () => {
    if (!state.editor.media) {
      const { src } = state.editor.buffer;
      state.editor.media = { url: src ? (state.assetPreviews.get(src) || ctx.committedAssetUrl(src)) : '', time: 0, duration: 0, posterDirty: false, unavailable: false };
    }
    return state.editor.media;
  };

  const posterUrl = (path) => state.assetPreviews.get(path) || ctx.committedAssetUrl(path);

  // Every path any video, staged change, or tombstone holds: a new clip or
  // poster never reuses one.
  const usedPaths = () => {
    const used = new Set(state.assetChanges.keys());
    for (const film of films().concat(state.editor ? [state.editor.buffer] : [])) {
      if (film.src) used.add(film.src);
      if (film.poster) used.add(film.poster);
    }
    return used;
  };

  const nextClipBase = (used) => {
    for (let number = 1; ; number += 1) {
      const base = CLIP_DIR + '/' + CLIP_PREFIX + '-' + String(number).padStart(2, '0');
      if (!used.has(base + '.mp4') && !used.has(base + '.jpg')) return base;
    }
  };

  // case-03.mp4 -> case-03.jpg, or case-03-2.jpg when that is taken.
  const freePosterPath = (src, used) => {
    const base = src.replace(/\.mp4$/i, '');
    if (!used.has(base + '.jpg')) return base + '.jpg';
    for (let number = 2; ; number += 1) if (!used.has(base + '-' + number + '.jpg')) return base + '-' + number + '.jpg';
  };

  const referencedElsewhere = (path, skipIndex) =>
    films().some((film, i) => i !== skipIndex && (film.src === path || film.poster === path));

  // Featured is exclusive: the list as it would be saved has every other video
  // un-featured when this one is featured.
  const savedList = (film, index) => {
    const list = films().map((item) => (film.featured ? { ...item, featured: false } : item));
    list[index < 0 ? list.length : index] = film;
    return list;
  };

  const editorErrors = (film) => {
    const { index } = state.editor;
    const at = index < 0 ? films().length : index;
    const prefix = at + '.';
    const errors = new Map();
    for (const error of rules().validateFilmsDetailed(savedList(film, index))) {
      if (error.path !== '' && error.path !== String(at) && !error.path.startsWith(prefix)) continue;
      let field = error.path.slice(prefix.length);
      if (['src', 'poster', 'duration'].includes(field)) field = 'clip';
      const message = field === 'clip' && !film.src ? 'Choose an MP4 clip for this video.' : fieldMessage(error.message);
      if (!(errors.get(field) || []).includes(message)) errors.set(field, [...(errors.get(field) || []), message]);
    }
    return errors;
  };

  const syncForm = () => {
    const form = document.querySelector('#film-form');
    if (!form || !isOpen()) return;
    const data = new FormData(form);
    state.editor.buffer.caption = String(data.get('caption') || '').trim();
    state.editor.buffer.featured = data.has('featured');
  };

  const renderList = () => {
    const list = films();
    const rows = list.map((film, index) => '<div class="list-row" data-testid="film-row">' +
      '<div class="row-title"><strong>' + h(film.caption || 'Untitled video') + '</strong><span>' + h(fileName(film.src)) + '</span></div>' +
      '<div class="row-meta">' + h(film.duration || '') + '</div>' +
      '<div class="status-badges">' + (film.featured ? '<span class="badge badge--active">Featured</span>' : '') + '</div>' +
      ctx.rowActions('films', index, list.length, false, film.caption || 'Untitled video') + '</div>');
    return ctx.listPage('films', 'Videos', 'Case videos in “Complications we manage”. The order here is the order shown; the featured video carries the case highlight’s “View more”.', rows, {
      itemLabel: 'video',
      notice: list.length ? '' : '<div class="notice">The video grid is hidden on the site while this list is empty.</div>',
    });
  };

  const clipUpload = (label, detail, wide) => '<label class="upload-control' + (wide ? ' upload-control--wide' : '') + '"><input type="file" id="film-clip" accept="video/mp4,.mp4"><span>' + label + '</span><small>' + detail + '</small></label>';

  const renderEditor = () => {
    const { buffer: film, index } = state.editor;
    const isNew = index < 0;
    const m = media();
    // A pending poster frame gets its path only at save; validate as save will,
    // or a new clip shows a poster error the owner can't fix (W4d D1).
    const checked = m.posterDirty && film.src ? { ...film, poster: freePosterPath(film.src, usedPaths()) } : film;
    const errors = state.editor.showErrors ? editorErrors(checked) : new Map();
    const note = (field) => (errors.get(field) || []).map((message) => '<span class="inline-error">' + h(message) + '</span>').join('');
    const showPoster = film.poster && !m.posterDirty;
    const clip = film.src
      ? '<div class="film-clip">' +
          '<div class="film-frame">' +
            '<video id="film-video" src="' + h(m.url) + '" muted playsinline preload="auto"' + (m.url.startsWith('blob:') ? '' : ' crossorigin="anonymous"') + '></video>' +
            (showPoster ? '<img id="film-poster" src="' + h(posterUrl(film.poster)) + '" alt="" data-asset-fallback="1">' : '') +
          '</div>' +
          '<div class="film-clip__details">' +
            '<dl class="film-facts"><dt>Clip</dt><dd><code>' + h(fileName(film.src)) + '</code></dd><dt>Length</dt><dd>' + h(film.duration || '–') + '</dd><dt>Poster</dt><dd>' + (m.posterDirty ? 'New frame, made when you save' : '<code>' + h(fileName(film.poster)) + '</code>') + '</dd></dl>' +
            '<label class="film-scrub">Poster frame<input id="film-scrub" type="range" min="0" max="' + (m.duration ? lastFrame(m.duration) : 1) + '" step="0.01" value="' + m.time + '" disabled aria-describedby="film-scrub-time">' +
            '<span class="field-help" id="film-scrub-time" aria-live="polite">' + (m.unavailable ? 'This clip can’t be loaded here, so its poster frame can’t be changed. Replace the clip to pick a new one.' : 'Loading the clip…') + '</span></label>' +
            note('clip') +
            clipUpload('Replace clip', 'MP4 · up to 25 MB') +
          '</div>' +
        '</div>'
      : note('clip') + clipUpload('Choose an MP4 clip', 'MP4 · up to 25 MB · the length is read from the file', true);
    return '<section class="editor-shell" data-testid="film-editor">' + ctx.editorHeading(isNew ? 'New video' : 'Edit video', film.caption || 'Untitled video') +
      '<div class="notice">Clips play in “Complications we manage”. The poster is a frame from the clip itself, so the thumbnail always matches the video.</div>' +
      note('') +
      '<form id="film-form"><div class="editor-grid">' +
      '<div class="field-group"><div class="field-group__heading"><div><h2>Clip and poster</h2><p>Drag the slider to the frame you want as the poster. It is cropped to 480 × 854, the shape of the video tiles.</p></div></div>' + clip + '</div>' +
      '<label class="field--full">Caption<input name="caption" value="' + h(film.caption || '') + '"' + (errors.has('caption') ? ' aria-invalid="true"' : '') + ' autocomplete="off"><span class="field-help">Shown under the video and announced by screen readers. One short sentence.</span>' + note('caption') + '</label>' +
      '<div class="field-group"><label class="checkbox-row"><input name="featured" type="checkbox" ' + (film.featured ? 'checked' : '') + '><span>Featured video <small class="field-help">Carries the “View more” link to the case highlight. Only one video can be featured; featuring this one un-features the other.</small></span></label>' + note('featured') + '</div>' +
      '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save video draft</button></div></form></section>';
  };

  // Wires the on-page preview after each render: the scrubber seeks the clip and
  // records the poster time; until it moves, an existing poster stays on top.
  const mount = (root) => {
    if (!isOpen()) return;
    const video = root.querySelector('#film-video');
    const scrub = root.querySelector('#film-scrub');
    const readout = root.querySelector('#film-scrub-time');
    if (!video || !scrub || !readout) return;
    const m = media();
    const describe = () => {
      readout.textContent = m.posterDirty
        ? 'Poster frame at ' + formatClock(m.time) + ' of ' + formatClock(m.duration) + '.'
        : 'The current poster is shown. Move the slider to pick a new frame.';
    };
    const ready = () => {
      if (!isOpen() || state.editor.media !== m) return;
      m.duration = video.duration;
      m.unavailable = false;
      scrub.max = String(lastFrame(video.duration));
      scrub.value = String(m.time);
      scrub.disabled = false;
      if (m.posterDirty) video.currentTime = clampTime(m.time, video.duration);
      describe();
    };
    if (m.unavailable) return;
    if (video.readyState >= 1) ready();
    else video.addEventListener('loadedmetadata', ready, { once: true });
    video.addEventListener('error', () => {
      m.unavailable = true;
      scrub.disabled = true;
      readout.textContent = 'This clip can’t be loaded here, so its poster frame can’t be changed. Replace the clip to pick a new one.';
    }, { once: true });
    scrub.addEventListener('input', () => {
      m.time = Number(scrub.value);
      if (!m.posterDirty) {
        m.posterDirty = true;
        root.querySelector('#film-poster')?.remove();
        const posterFact = root.querySelector('.film-facts dd:last-of-type');
        if (posterFact) posterFact.textContent = 'New frame, made when you save';
      }
      video.currentTime = clampTime(m.time, m.duration || video.duration);
      describe();
    });
  };

  // Reading and encoding a clip takes a moment. Everything slow happens first and
  // writes nothing; only if this same editor is still open (not cancelled, saved,
  // or left for another tab) is the clip staged and the old one released, in one
  // synchronous step. A closed editor must not stage an orphan clip or tombstone
  // the one films.json still lists.
  const chooseClip = async (input) => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    syncForm();
    const editor = state.editor;
    const current = () => state.editor === editor;
    const m = media();
    m.loading = true;
    try {
      checkClipFile(file);
      const probeUrl = URL.createObjectURL(file);
      let meta;
      try {
        meta = await probeClip(probeUrl);
      } finally {
        URL.revokeObjectURL(probeUrl);
      }
      const encoded = current() && await ctx.encodeBlob(file);
      if (!current()) return;
      const { buffer: film, index } = editor;
      const src = nextClipBase(usedPaths()) + '.mp4';
      const previous = film.src;
      ctx.stageEncoded(src, encoded);
      if (previous && previous !== src && !referencedElsewhere(previous, index)) ctx.unstageOrDeleteAsset(previous);
      film.src = src;
      film.duration = formatDuration(meta.duration);
      m.url = state.assetPreviews.get(src);
      m.duration = meta.duration;
      m.time = Math.min(1, meta.duration / 4);
      m.posterDirty = true;
      m.unavailable = false;
    } catch (error) {
      if (current()) ctx.showStatus('Clip not added', h(error.message));
    } finally {
      m.loading = false;
    }
    if (current()) ctx.render();
  };

  const save = async () => {
    syncForm();
    const editor = state.editor;
    const { index, buffer } = editor;
    const m = media();
    if (m.loading) {
      ctx.showStatus('Clip still loading', 'Wait for the new clip to finish loading, then save.');
      return;
    }
    const film = { ...buffer, caption: String(buffer.caption || '').trim(), featured: Boolean(buffer.featured) };
    const used = usedPaths();
    if (m.posterDirty && film.src) film.poster = freePosterPath(film.src, used);
    state.editor.showErrors = true;
    if (editorErrors(film).size) {
      ctx.render();
      ctx.showStatus('Video not saved', 'Fix the highlighted fields first.');
      return;
    }
    if (m.posterDirty) {
      if (m.unavailable) throw new Error('The clip could not be loaded to make its poster. Replace the clip, then save again.');
      const encoded = await ctx.encodeBlob(await grabPoster(m.url, m.time));
      // Cancelled, left, or saved by a second click meanwhile: stage nothing.
      // From here on nothing awaits, so the poster and the list change together.
      if (state.editor !== editor) return;
      ctx.stageEncoded(film.poster, encoded);
      if (buffer.poster && buffer.poster !== film.poster && !referencedElsewhere(buffer.poster, index)) ctx.unstageOrDeleteAsset(buffer.poster);
    }
    const unfeatured = [];
    if (film.featured) {
      for (const [i, other] of films().entries()) {
        if (i !== index && other.featured) {
          other.featured = false;
          unfeatured.push(other.caption || 'Video ' + (i + 1));
        }
      }
    }
    if (index < 0) films().push(film);
    else films()[index] = film;
    ctx.markDirty('films');
    state.editor = null;
    ctx.render();
    if (unfeatured.length) ctx.showStatus('Featured video moved', h('“' + unfeatured.join('”, “') + '” is no longer featured. Only one video can be.'));
  };

  const removeFilm = (index) => {
    const list = films();
    const film = list[index];
    if (!film) return;
    if (!confirm('Delete the video “' + (film.caption || fileName(film.src)) + '”? Its clip and poster are removed in the next publish.')) return;
    list.splice(index, 1);
    for (const path of [film.src, film.poster]) {
      if (path && !referencedElsewhere(path, -1)) ctx.unstageOrDeleteAsset(path);
    }
    ctx.markDirty('films');
    ctx.render();
  };

  // Returns true when the click was a Videos action.
  const handleAction = async (button) => {
    const { action, kind } = button.dataset;
    if (kind === 'films' && action === 'delete') {
      removeFilm(Number(button.dataset.index));
      return true;
    }
    if (!isOpen() || action !== 'save-editor') return false;
    await save();
    return true;
  };

  const handleChange = async (target) => {
    if (target.id !== 'film-clip' || !isOpen()) return false;
    await chooseClip(target);
    return true;
  };

  const handleSubmit = (form) => {
    if (form.id !== 'film-form' || !isOpen()) return false;
    save().catch((error) => ctx.showStatus('Video not saved', h(error.message)));
    return true;
  };

  return { blank, renderList, renderEditor, mount, handleAction, handleChange, handleSubmit };
};
