// In therapy — data/treatment.json, the site's "Patients undergoing treatment"
// gallery. A sibling of Solutions: a reorderable list plus a per-patient editor.
// Photographs go through the recovery-photo pipeline (4:5 crop, clean background
// on the canonical studio gray, baked watermark) and land at fresh paths
// assets/treatment/treatment-NN.webp.
//
// Asset states (AGENTS Lesson 1). A treatment photo path is only ever
//   committed    in the loaded tree and referenced by the draft
//   staged-new   uploaded this session (state.assetChanges content + preview)
//   tombstoned   committed, deletion staged ({ delete: true })
// Uploads always take a fresh path (nextGalleryPath skips committed, staged and
// tombstoned paths), so nothing is overwritten in place. Removing a photo
// releases its path only when no other patient still references it:
// staged-new -> dropped, committed -> tombstoned (app.js unstageOrDeleteAsset).
// Cancelling the editor restores the asset snapshot taken when it opened.
//
// Validation is content-rules.js validateTreatmentDetailed, run on the list as
// it would be saved; its errors render next to their field and block the save.
import './content-rules.js';
import { cropEvidenceImage } from './image-tools.js';

const MAX_PHOTOS = 3;
const PHOTO_DIR = 'assets/treatment';
const PHOTO_PREFIX = 'treatment';

const rules = () => globalThis.MediVascContentRules;

// "In therapy: patient 2 needs a location." reads as "Patient 2 needs a
// location." under the field it belongs to.
const fieldMessage = (message) => {
  const text = String(message).replace(/^In therapy:\s*/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// The site's fallback name for a patient without a label (src/template.js).
export const patientNumber = (index) => 'Patient ' + String(index + 1).padStart(2, '0');

const LEFT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7l-5 5 5 5"/></svg>';
const RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5"/></svg>';

export const createTherapyEditor = (ctx) => {
  const { state, h } = ctx;

  const patients = () => {
    if (!Array.isArray(state.draft.treatment)) state.draft.treatment = [];
    return state.draft.treatment;
  };
  const isOpen = () => state.editor?.kind === 'treatment';
  const nameOf = (patient, index) => String(patient.label || '').trim() || patientNumber(index);
  const photoCount = (count) => count + ' photograph' + (count === 1 ? '' : 's');

  const blank = () => ({ location: '', label: '', photos: [] });

  // Field -> messages for the patient being edited, from the whole list as it
  // would be saved (the rules check cross-patient photo reuse too).
  const editorErrors = (patient) => {
    const { index } = state.editor;
    const list = patients().slice();
    const at = index < 0 ? list.length : index;
    list[at] = patient;
    const prefix = at + '.';
    const errors = new Map();
    for (const error of rules().validateTreatmentDetailed(list)) {
      if (error.path !== String(at) && !error.path.startsWith(prefix)) continue;
      const field = error.path.slice(prefix.length);
      errors.set(field, [...(errors.get(field) || []), fieldMessage(error.message)]);
    }
    return errors;
  };

  const syncForm = () => {
    const form = document.querySelector('#treatment-form');
    if (!form || !isOpen()) return;
    const data = new FormData(form);
    state.editor.buffer.location = String(data.get('location') || '').trim();
    state.editor.buffer.label = String(data.get('label') || '').trim();
  };

  // Release a removed path unless another patient (or the rest of this one)
  // still shows it.
  const release = (path, stillUsed) => {
    if (path && !stillUsed.has(path)) ctx.unstageOrDeleteAsset(path);
  };

  const renderList = () => {
    const list = patients();
    const rows = list.map((patient, index) => '<div class="list-row" data-testid="treatment-row">' +
      '<div class="row-title"><strong>' + h(nameOf(patient, index)) + '</strong><span>' + h(patient.location || 'No location') + '</span></div>' +
      '<div class="row-meta">' + photoCount((patient.photos || []).length) + '</div>' +
      '<div class="status-badges"><span class="badge">' + (String(patient.label || '').trim() ? 'Own label' : 'Numbered') + '</span></div>' +
      ctx.rowActions('treatment', index, list.length, false, nameOf(patient, index)) + '</div>');
    return ctx.listPage('treatment', 'In therapy', 'Patients currently in home therapy, shown in “Patients undergoing treatment”. The order here is the order on the site; patients without a label are numbered by position.', rows, {
      itemLabel: 'patient',
      notice: list.length ? '' : '<div class="notice">The section is hidden on the site while this list is empty.</div>',
    });
  };

  const renderEditor = () => {
    const { buffer: patient, index } = state.editor;
    const isNew = index < 0;
    const fallback = patientNumber(isNew ? patients().length : index);
    const errors = state.editor.showErrors ? editorErrors(patient) : new Map();
    const note = (field) => (errors.get(field) || []).map((message) => '<span class="inline-error">' + h(message) + '</span>').join('');
    const invalid = (field) => (errors.has(field) ? ' aria-invalid="true"' : '');
    const photos = patient.photos || [];
    const items = photos.map((src, i) => '<div class="image-item" data-testid="treatment-photo">' + ctx.imagePreview(src, true) + '<code>' + h(src) + '</code>' + note('photos.' + i) +
      '<div class="row-actions">' +
      '<button class="row-action" type="button" data-action="treatment-photo-move" data-index="' + i + '" data-direction="-1" aria-label="Move photograph ' + (i + 1) + ' left" ' + (i === 0 ? 'disabled' : '') + '>' + LEFT + '</button>' +
      '<button class="row-action" type="button" data-action="treatment-photo-move" data-index="' + i + '" data-direction="1" aria-label="Move photograph ' + (i + 1) + ' right" ' + (i === photos.length - 1 ? 'disabled' : '') + '>' + RIGHT + '</button>' +
      '<button class="row-action" type="button" data-action="treatment-photo-delete" data-index="' + i + '" aria-label="Remove photograph ' + (i + 1) + '">' + ctx.icon('trash') + '</button>' +
      '</div></div>').join('');
    const room = MAX_PHOTOS - photos.length;
    const upload = room > 0
      ? '<label class="upload-control"><input type="file" id="treatment-photos" accept="image/jpeg,image/png,image/webp" multiple><span>' + (photos.length ? 'Add a photograph' : 'Upload one or more photographs') + '</span><small>JPEG, PNG, or WebP · 20 MB each · ' + room + ' of 3 left</small></label>'
      : '';
    return '<section class="editor-shell" data-testid="treatment-editor">' + ctx.editorHeading(isNew ? 'New patient' : 'Edit patient', nameOf(patient, isNew ? patients().length : index)) +
      '<div class="notice">Real patients in therapy only. Each photograph is cropped to 4:5, set on the studio-gray backdrop when “Clean background” is on, and carries the “MediVasc” watermark, exactly like recovery evidence.</div>' +
      note('') +
      '<form id="treatment-form"><div class="editor-grid">' +
      '<label>Location<input name="location" value="' + h(patient.location || '') + '"' + invalid('location') + ' autocomplete="off"><span class="field-help">City and state, e.g. “Gurugram, Haryana”.</span>' + note('location') + '</label>' +
      '<label>Label (optional)<input name="label" value="' + h(patient.label || '') + '" placeholder="' + h(fallback) + '"' + invalid('label') + ' autocomplete="off"><span class="field-help">Leave blank and the site shows “' + h(fallback) + '”, numbered by position.</span>' + note('label') + '</label>' +
      '<div class="field-group"><div class="field-group__heading"><div><h2>Photographs</h2><p>One to three, shown side by side in this order. Reorder with the arrows.</p></div></div>' + note('photos') +
      '<div class="image-list">' + items + upload + '</div></div>' +
      '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save patient draft</button></div></form></section>';
  };

  const save = () => {
    syncForm();
    const { index, buffer } = state.editor;
    const patient = { ...buffer, location: String(buffer.location || '').trim(), label: String(buffer.label || '').trim(), photos: (buffer.photos || []).slice() };
    state.editor.showErrors = true;
    if (editorErrors(patient).size) {
      ctx.render();
      ctx.showStatus('Patient not saved', 'Fix the highlighted fields first.');
      return;
    }
    if (index < 0) patients().push(patient);
    else patients()[index] = patient;
    ctx.markDirty('treatment');
    state.editor = null;
    ctx.render();
  };

  const removePatient = (index) => {
    const list = patients();
    const patient = list[index];
    if (!patient) return;
    const where = patient.location ? ' (' + patient.location + ')' : '';
    if (!confirm('Delete ' + nameOf(patient, index) + where + '? Their photographs are removed in the next publish.')) return;
    list.splice(index, 1);
    const stillUsed = new Set(list.flatMap((item) => item.photos || []));
    for (const path of patient.photos || []) release(path, stillUsed);
    ctx.markDirty('treatment');
    ctx.render();
  };

  const uploadPhotos = async (input) => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    syncForm();
    const editor = state.editor;
    const current = () => state.editor === editor;
    const patient = editor.buffer;
    patient.photos = patient.photos || [];
    const room = MAX_PHOTOS - patient.photos.length;
    if (files.length > room) {
      ctx.showStatus('Three photographs per patient', room === 1 ? 'Only the first photograph you chose was used.' : 'Only the first ' + room + ' photographs you chose were used.');
    }
    const used = ctx.usedGalleryPaths(patients().flatMap((item) => item.photos || []).concat(patient.photos));
    const skipped = [];
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        let encoded = null;
        try {
          const blob = await cropEvidenceImage(file, 'in-therapy', { cutout: ctx.requestCutout });
          if (blob && current()) encoded = await ctx.encodeBlob(blob);
        } catch (error) {
          skipped.push({ name: file.name, reason: error.message });
        }
        // Cancelled, saved, or left mid-upload: stage nothing into the draft the
        // closed editor restored, and open no more crops.
        if (!current()) return;
        if (!encoded) continue; // crop cancelled, or the file could not be read
        const path = ctx.nextGalleryPath(PHOTO_DIR, PHOTO_PREFIX, used);
        used.add(path);
        ctx.stageEncoded(path, encoded);
        patient.photos.push(path);
      }
    } finally {
      if (current()) {
        ctx.render();
        ctx.reportSkippedFiles(skipped);
      }
    }
  };

  // Returns true when the click was an In therapy action.
  const handleAction = async (button) => {
    const { action, kind } = button.dataset;
    if (kind === 'treatment' && action === 'delete') {
      removePatient(Number(button.dataset.index));
      return true;
    }
    if (!isOpen()) return false;
    if (action === 'save-editor') {
      save();
      return true;
    }
    if (action !== 'treatment-photo-move' && action !== 'treatment-photo-delete') return false;
    syncForm();
    const { buffer, index } = state.editor;
    const at = Number(button.dataset.index);
    if (action === 'treatment-photo-move') {
      const target = at + Number(button.dataset.direction);
      if (target >= 0 && target < buffer.photos.length) {
        const [path] = buffer.photos.splice(at, 1);
        buffer.photos.splice(target, 0, path);
      }
    } else {
      const [removed] = buffer.photos.splice(at, 1);
      const stillUsed = new Set(patients().filter((_, i) => i !== index).flatMap((item) => item.photos || []).concat(buffer.photos));
      release(removed, stillUsed);
    }
    ctx.render();
    return true;
  };

  const handleChange = async (target) => {
    if (target.id !== 'treatment-photos' || !isOpen()) return false;
    await uploadPhotos(target);
    return true;
  };

  const handleSubmit = (form) => {
    if (form.id !== 'treatment-form' || !isOpen()) return false;
    save();
    return true;
  };

  return { blank, renderList, renderEditor, handleAction, handleChange, handleSubmit };
};
