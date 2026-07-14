import { ApiError, AuthError, BranchConflictError, GhApi } from './gh-api.js';
import { blobToBase64, cropEvidenceImage, resizeProductImage } from './image-tools.js';
import { createVault, forgetVault, unlockVault, vaultExists } from './vault.js';

const OWNER = 'navigalife';
const REPO = 'navigalife.github.io';
// Public raw host — the repo is public, so committed assets can be previewed
// directly with a plain <img> (no token, no CORS). Pinned to the loaded commit.
const RAW_ROOT = `https://raw.githubusercontent.com/${OWNER}/${REPO}/`;
const TOKEN_SESSION_KEY = 'medivasc-admin-token-session';
const BRANCH_KEY = 'medivasc-admin-branch';
const COLOR_KEY = 'medivasc-admin-color-mode';
const FILES = {
  products: 'data/products.json',
  protocols: 'data/protocols.json',
  testimonials: 'data/testimonials.json',
  company: 'data/company.json',
  config: 'data/site-config.json',
  themes: 'data/themes.json',
};
const STAGES = [
  { key: 'before', label: 'Before therapy' },
  { key: 'during', label: 'During therapy' },
  { key: 'after', label: 'After therapy' },
];
// Hero counter glyphs the site can render (mirror of template.js STAT_ICONS);
// an unknown value falls back to `pulse` on the site.
const STAT_ICON_NAMES = ['pulse', 'clipboard', 'clock', 'heart', 'shield', 'users'];

// One-time migration off run-1 storage: keep the chosen color mode, drop
// every legacy key (including any plain-text token from the old remember box).
(() => {
  const legacyMode = localStorage.getItem('naviga-admin-color-mode');
  if (legacyMode && !localStorage.getItem(COLOR_KEY)) localStorage.setItem(COLOR_KEY, legacyMode);
  for (const key of ['naviga-admin-token-local', 'naviga-admin-branch', 'naviga-admin-color-mode']) {
    localStorage.removeItem(key);
  }
  sessionStorage.removeItem('naviga-admin-token-session');
})();

const state = {
  api: null,
  branch: new URLSearchParams(location.search).get('branch') || localStorage.getItem(BRANCH_KEY) || 'main',
  baseSha: '',
  draft: {},
  dirty: new Set(),
  assetChanges: new Map(),
  assetPreviews: new Map(),
  activeTab: 'testimonials',
  editor: null,
  loaded: false,
  publishing: false,
};

const authView = document.querySelector('#auth-view');
const appView = document.querySelector('#app-view');
const setupForm = document.querySelector('#setup-form');
const unlockForm = document.querySelector('#unlock-form');
const setupToken = document.querySelector('#setup-token');
const setupBranch = document.querySelector('#setup-branch');
const setupPasscode = document.querySelector('#setup-passcode');
const setupPasscodeConfirm = document.querySelector('#setup-passcode-confirm');
const setupButton = document.querySelector('#setup-button');
const unlockPasscode = document.querySelector('#unlock-passcode');
const unlockButton = document.querySelector('#unlock-button');
const forgetButton = document.querySelector('#forget-button');
const authStatus = document.querySelector('#auth-status');
const loadingState = document.querySelector('#loading-state');
const editorRoot = document.querySelector('#editor-root');
const tabNav = document.querySelector('#tab-nav');
const branchBadge = document.querySelector('#branch-badge');
const publishButton = document.querySelector('#publish-button');
const barPublishButton = document.querySelector('#bar-publish-button');
const rebuildButton = document.querySelector('#rebuild-button');
const unsavedBar = document.querySelector('#unsaved-bar');
const dirtySummary = document.querySelector('#dirty-summary');
const publishStatus = document.querySelector('#publish-status');

const h = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const deepClone = (value) => structuredClone(value);
const lines = (value) => String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);

const icon = (name) => {
  const paths = {
    up: '<path d="m7 14 5-5 5 5"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths[name] + '</svg>';
};

const stageKeyOf = (image) => STAGES.find((stage) => stage.label === image.stage)?.key || null;
const imageForStage = (testimonial, key) => (testimonial.images || []).find((image) => stageKeyOf(image) === key);

/* Site-theme tokens apply only inside the app view, so the login screen always
 * uses the admin's own palette and its toggle works before any repo loads. */
const applyThemeTokens = () => {
  if (!state.loaded) return;
  const selected = state.draft.themes.find((theme) => theme.id === state.draft.config.theme);
  if (!selected) return;
  const mode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  for (const [token, value] of Object.entries(selected[mode])) {
    appView.style.setProperty(token, value);
  }
};

const setColorMode = (mode) => {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem(COLOR_KEY, mode);
  applyThemeTokens();
  render();
};

const toggleColorMode = () => {
  setColorMode(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
};

const setAuthStatus = (message) => {
  authStatus.textContent = message;
};

const showStatus = (title, message, options = {}) => {
  publishStatus.hidden = false;
  publishStatus.innerHTML = '<strong>' + h(title) + '</strong><p>' + message + '</p>' +
    (options.action ? '<button class="button button--quiet" type="button" data-global-action="' + h(options.action) + '">' + h(options.actionLabel) + '</button>' : '');
};

const clearStatus = () => {
  publishStatus.hidden = true;
  publishStatus.replaceChildren();
};

const sessionToken = () => sessionStorage.getItem(TOKEN_SESSION_KEY) || '';

const showAuth = (message = '') => {
  authView.hidden = false;
  appView.hidden = true;
  const hasVault = vaultExists();
  setupForm.hidden = hasVault;
  unlockForm.hidden = !hasVault;
  unlockPasscode.value = '';
  setupToken.value = '';
  setupPasscode.value = '';
  setupPasscodeConfirm.value = '';
  setAuthStatus(message);
  (hasVault ? unlockPasscode : setupToken).focus();
};

const showApp = () => {
  authView.hidden = true;
  appView.hidden = false;
  branchBadge.textContent = state.branch;
};

const loadRepository = async () => {
  loadingState.hidden = false;
  editorRoot.replaceChildren();
  const ref = await state.api.getRef();
  const entries = await Promise.all(Object.entries(FILES).map(async ([key, path]) => {
    const result = await state.api.getJson(path);
    return [key, result];
  }));
  state.baseSha = ref.object.sha;
  state.draft = {};
  for (const [key, result] of entries) {
    state.draft[key] = result.data;
  }
  state.loaded = true;
  state.dirty.clear();
  state.assetChanges.clear();
  state.editor = null;
  loadingState.hidden = true;
  render();
  renderUnsaved();
};

const connect = async (token, branch, { busyButton, onAuthFailure }) => {
  busyButton.disabled = true;
  setAuthStatus('Validating repository access…');
  const api = new GhApi({ token, owner: OWNER, repo: REPO, branch });
  try {
    await api.validate();
    const canResumeDraft = state.loaded && state.branch === branch;
    state.api = api;
    state.branch = branch;
    localStorage.setItem(BRANCH_KEY, branch);
    sessionStorage.setItem(TOKEN_SESSION_KEY, token);
    showApp();
    if (!canResumeDraft) await loadRepository();
    else render();
    setAuthStatus('');
    return true;
  } catch (error) {
    setAuthStatus(error.message);
    if (onAuthFailure) onAuthFailure(error);
    return false;
  } finally {
    busyButton.disabled = false;
  }
};

const markDirty = (key) => {
  state.dirty.add(key);
  renderUnsaved();
};

const renderUnsaved = () => {
  const changed = [...state.dirty].map((key) => FILES[key]);
  if (state.assetChanges.size) changed.push(state.assetChanges.size + ' image file' + (state.assetChanges.size === 1 ? '' : 's'));
  const isDirty = changed.length > 0;
  unsavedBar.hidden = !isDirty;
  dirtySummary.textContent = isDirty ? changed.join(' · ') : '';
  publishButton.disabled = !isDirty || state.publishing;
  barPublishButton.disabled = !isDirty || state.publishing;
};

const rowActions = (kind, index, length, canToggle = true) => '<div class="row-actions">' +
  '<button class="row-action" type="button" data-action="move" data-kind="' + kind + '" data-index="' + index + '" data-direction="-1" aria-label="Move up" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button>' +
  '<button class="row-action" type="button" data-action="move" data-kind="' + kind + '" data-index="' + index + '" data-direction="1" aria-label="Move down" ' + (index === length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button>' +
  (canToggle ? '<button class="row-action" type="button" data-action="toggle-visible" data-kind="' + kind + '" data-index="' + index + '" aria-label="Toggle visibility">' + icon('eye') + '</button>' : '') +
  '<button class="row-action row-action--text" type="button" data-action="edit" data-kind="' + kind + '" data-index="' + index + '">Edit</button>' +
  '<button class="row-action" type="button" data-action="delete" data-kind="' + kind + '" data-index="' + index + '" aria-label="Delete">' + icon('trash') + '</button>' +
  '</div>';

const listPage = (kind, title, description, rows, options = {}) => {
  const label = options.itemLabel || kind.slice(0, -1);
  const content = rows.length ? '<div class="list-table" data-testid="' + kind + '-list"><div class="list-head"><span>Name</span><span>Type</span><span>Status</span><span>Actions</span></div>' + rows.join('') + '</div>' :
    '<div class="empty-state"><h2>Nothing here yet</h2><p>Add the first ' + h(label) + ' to begin.</p><button class="button button--primary" type="button" data-action="add" data-kind="' + kind + '">Add ' + h(label) + '</button></div>';
  return '<section><div class="section-toolbar"><div><h1>' + h(title) + '</h1><p>' + h(description) + '</p></div><button class="button button--primary" type="button" data-action="add" data-kind="' + kind + '">Add ' + h(label) + '</button></div>' + (options.notice || '') + content + '</section>';
};

const renderProductsList = () => {
  const items = state.draft.products;
  const rows = items.map((product, index) => '<div class="list-row" data-testid="product-row">' +
    '<div class="row-title"><strong>' + h(product.name) + '</strong><span>' + h(product.id) + '</span></div>' +
    '<div class="row-meta">' + h(product.category) + '</div>' +
    '<div class="status-badges"><span class="badge ' + (product.visible ? 'badge--active' : '') + '">' + (product.visible ? 'Visible' : 'Hidden') + '</span>' + (product.featured ? '<span class="badge">Featured</span>' : '') + '</div>' +
    rowActions('products', index, items.length) + '</div>');
  return listPage('products', 'Products', 'Device details, specifications, images, order, and visibility.', rows, {
    notice: '<div class="notice">Products are currently archived from the public site. Everything here is preserved and still publishes to the data files, but nothing renders publicly until products return.</div>',
  });
};

const audienceLabel = (audience) => (audience === 'elderly' ? 'Bedridden & elderly' : 'Disease-specific');

const renderProtocolsList = () => {
  const items = state.draft.protocols;
  const rows = items.map((protocol, index) => '<div class="list-row" data-testid="protocol-row">' +
    '<div class="row-title"><strong>' + h(protocol.condition) + '</strong><span>' + h(protocol.id) + '</span></div>' +
    '<div class="row-meta">' + h(audienceLabel(protocol.audience)) + '</div>' +
    '<div class="status-badges"><span class="badge ' + (protocol.visible ? 'badge--active' : '') + '">' + (protocol.visible ? 'Visible' : 'Hidden') + '</span>' + (protocol.draft ? '<span class="badge badge--draft">Draft</span>' : '') + '</div>' +
    rowActions('protocols', index, items.length) + '</div>');
  return listPage('protocols', 'Protocols', 'The public site lists each protocol’s condition, grouped by track. Summaries stay internal.', rows);
};

const storyTypeLabel = (testimonial) => {
  const count = (testimonial.images || []).length;
  if (count >= 3) return '3-stage journey';
  if (count === 2) return 'Before & after';
  return 'Quote';
};

// A real name when we have one, otherwise "Patient aged N" when an age is on
// record, otherwise nothing. No "Identity protected" placeholder.
const patientLabel = (testimonial) => {
  if (testimonial.name) return testimonial.name;
  if (testimonial.age) return 'Patient aged ' + testimonial.age;
  return '';
};

const renderTestimonialsList = () => {
  const items = state.draft.testimonials;
  const rows = items.map((testimonial, index) => '<div class="list-row" data-testid="testimonial-row">' +
    '<div class="row-title"><strong>' + h(testimonial.condition) + '</strong><span>' + h(patientLabel(testimonial) || 'Anonymous') + '</span></div>' +
    '<div class="row-meta">' + h(storyTypeLabel(testimonial)) + ' · ' + h(testimonial.location) + '</div>' +
    '<div class="status-badges">' + (testimonial.featured ? '<span class="badge badge--active">Featured</span>' : '') + ((testimonial.images || []).length ? '<span class="badge">Photographs</span>' : '') + '</div>' +
    rowActions('testimonials', index, items.length, false) + '</div>');
  return listPage('testimonials', 'Recoveries', 'Real patient stories with photographic evidence and the clinical remark shown on each card.', rows, { itemLabel: 'recovery story' });
};

const defaultProduct = () => ({
  id: '',
  name: '',
  tagline: '',
  category: '',
  model: '',
  description: '',
  conditions: [],
  images: [],
  specs: [{ key: '', value: '', visible: true }],
  catalogue: true,
  featured: false,
  visible: true,
});

const defaultProtocol = () => ({
  id: '',
  condition: '',
  audience: 'disease',
  summary: '',
  engagement: [
    'Detailed case study of the condition, history, and current treatment',
    'Customized, affordable protocol designed around the individual case',
    'Guided therapy with expert supervision, at home wherever possible',
    'Regular follow-ups until the desired result is achieved',
  ],
  durationNote: 'Customized case to case',
  deviceIds: [],
  visible: true,
  draft: true,
});

const defaultTestimonial = () => ({
  id: '',
  featured: false,
  name: '',
  age: '',
  location: '',
  condition: '',
  duration: '',
  remark: '',
  quote: '',
  images: [],
});

const editorHeading = (kicker, title) => '<div class="editor-header"><div><p class="auth-kicker">' + h(kicker) + '</p><h1>' + h(title) + '</h1></div><button class="button button--quiet" type="button" data-action="back">Back to list</button></div>';

// URL for an already-committed asset. Pinned to the loaded commit (baseSha) so
// the preview always matches what is checked in, and never shows a stale cache.
const committedAssetUrl = (path) =>
  RAW_ROOT + encodeURIComponent(state.baseSha || state.branch) + '/' +
  path.split('/').map(encodeURIComponent).join('/');

const imagePreview = (path, evidence = false) => {
  const cls = 'image-preview' + (evidence ? ' image-preview--evidence' : '');
  const staged = state.assetPreviews.get(path);
  // Newly uploaded (not yet published): show the in-memory object URL.
  if (staged) return '<div class="' + cls + '"><img src="' + h(staged) + '" alt=""></div>';
  // Already committed: load the real photograph from the repo. If it can't load
  // (offline, or path not committed yet) the delegated error handler swaps in
  // the "Stored in repository" label.
  return '<div class="' + cls + '"><img src="' + h(committedAssetUrl(path)) + '" alt="" loading="lazy" data-asset-fallback="1"></div>';
};

const productPrompt = (name) => [
  'Use case: product-mockup',
  'Asset type: medical-device catalogue and website product image',
  'Input images: Image 1 is the edit target and exact product reference',
  'Primary request: Restyle Image 1 as a clean studio product photograph of ' + (name || '{PRODUCT_NAME}') + '.',
  'Device integrity: Keep this exact device. Preserve its shape, proportions, enclosure, controls, display, ports, tubing, cables, garments, attachments, materials, and colorway. Do not redesign, simplify, add, remove, relocate, or substitute any functional part. Change only the photographic setting, lighting, camera presentation, and removal of visible branding or text.',
  '',
  'Style/medium: restrained, photorealistic studio product photography for a trusted medical-device catalogue.',
  'Scene/backdrop: seamless cool off-white #F5F8F9 studio background; the device rests on a low matte plinth in the same neutral family.',
  'Composition/framing: slight three-quarter hero angle; complete device and all necessary tubing or garments visible; centered visual balance; generous safe space; 3:2 landscape aspect ratio.',
  'Lighting/mood: soft diffused key light from the upper left; quiet clinical calm; controlled natural shadow; shallow depth of field while every functional device detail remains legible.',
  'Color palette: muted clinical neutrals with restrained deep teal-blue accents echoing #0E5F76; accurate product colorway takes priority.',
  'Materials/textures: truthful medical-grade plastics, fabric, tubing, and matte surfaces; realistic edges and contact shadows.',
  'Constraints: no people; no hands; no text; no letters; no numbers; no logos; no trademarks; no watermark; no certification seal; no extra props; no packaging; no dramatic reflections; no gradient wash; no floating parts. Preserve product identity and functional geometry exactly.',
].join('\n');

const renderProductEditor = () => {
  const product = state.editor.buffer;
  const isNew = state.editor.index < 0;
  const hasStagedProductImage = product.images.some((path) => {
    const change = state.assetChanges.get(path);
    return change && !change.delete;
  });
  const specs = product.specs.map((spec, index) => '<div class="repeat-row">' +
    '<input aria-label="Specification name" data-spec-index="' + index + '" data-spec-field="key" value="' + h(spec.key) + '" placeholder="Name">' +
    '<input aria-label="Specification value" data-spec-index="' + index + '" data-spec-field="value" value="' + h(spec.value) + '" placeholder="Value">' +
    '<label class="checkbox-row"><input type="checkbox" data-spec-index="' + index + '" data-spec-field="visible" ' + (spec.visible ? 'checked' : '') + '><span>Visible</span></label>' +
    '<div class="row-actions"><button class="row-action" type="button" data-action="spec-move" data-index="' + index + '" data-direction="-1" aria-label="Move specification up" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button><button class="row-action" type="button" data-action="spec-move" data-index="' + index + '" data-direction="1" aria-label="Move specification down" ' + (index === product.specs.length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button><button class="row-action" type="button" data-action="spec-delete" data-index="' + index + '" aria-label="Delete specification">' + icon('trash') + '</button></div>' +
    '</div>').join('');
  const images = product.images.map((path, index) => '<div class="image-item">' + imagePreview(path) + '<code>' + h(path) + '</code><div class="row-actions"><button class="row-action" type="button" data-action="image-move" data-index="' + index + '" data-direction="-1" aria-label="Move image left" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button><button class="row-action" type="button" data-action="image-move" data-index="' + index + '" data-direction="1" aria-label="Move image right" ' + (index === product.images.length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button><button class="row-action" type="button" data-action="image-delete" data-index="' + index + '" aria-label="Delete image">' + icon('trash') + '</button></div></div>').join('');
  return '<section class="editor-shell" data-testid="product-editor">' + editorHeading(isNew ? 'New product' : 'Edit product', product.name || 'Untitled product') +
    '<form id="product-form"><div class="editor-grid">' +
    '<label>Product name<input name="name" value="' + h(product.name) + '" required></label>' +
    '<label>Immutable slug<input name="id" value="' + h(product.id) + '" pattern="[a-z0-9\\-]+" required ' + (isNew && !hasStagedProductImage ? '' : 'readonly') + '><span class="field-help">' + (hasStagedProductImage ? 'Remove staged uploads before changing this slug.' : 'Lowercase letters, numbers, and hyphens.') + '</span></label>' +
    '<label>Tagline<input name="tagline" value="' + h(product.tagline) + '" required></label>' +
    '<label>Category<input name="category" value="' + h(product.category) + '" required></label>' +
    '<label>Model<input name="model" value="' + h(product.model || '') + '"></label>' +
    '<label>Source reference<input name="sourceId" value="' + h(product.sourceId || '') + '" ' + (isNew ? '' : 'readonly') + '></label>' +
    '<label class="field--full">Description<textarea name="description" required>' + h(product.description) + '</textarea></label>' +
    '<label class="field--full">Conditions supported<textarea name="conditions" required>' + h(product.conditions.join('\n')) + '</textarea><span class="field-help">One condition per line.</span></label>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Specifications</h2><p>Add, reorder, or hide individual rows.</p></div><button class="button button--quiet" type="button" data-action="spec-add">Add row</button></div>' + specs + '</div>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Product images</h2><p>Uploads are converted to WebP and downscaled to a 1600px maximum edge.</p></div></div><div class="image-list">' + images +
    '<label class="upload-control"><input type="file" id="product-images" accept="image/jpeg,image/png,image/webp" multiple><span>Upload one or more images</span><small>JPEG, PNG, or WebP · 20 MB each</small></label></div></div>' +
    '<div class="field-group"><div class="inline-fields"><label class="checkbox-row"><input name="catalogue" type="checkbox" ' + (product.catalogue ? 'checked' : '') + '><span>Generate catalogue</span></label><label class="checkbox-row"><input name="featured" type="checkbox" ' + (product.featured ? 'checked' : '') + '><span>Featured device</span></label><label class="checkbox-row"><input name="visible" type="checkbox" ' + (product.visible ? 'checked' : '') + '><span>Visible</span></label></div></div>' +
    (isNew ? '<aside class="prompt-card"><div class="field-group__heading"><div><h2>Locked product-image prompt</h2><p>Use edit/reference mode with the real device photo. Generate a 3:2 result, then upload it above.</p></div><button class="button button--quiet" type="button" data-action="copy-prompt">' + icon('copy') + ' Copy prompt</button></div><pre id="product-prompt">' + h(productPrompt(product.name)) + '</pre></aside>' : '') +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save product draft</button></div></form></section>';
};

const renderProtocolEditor = () => {
  const protocol = state.editor.buffer;
  const isNew = state.editor.index < 0;
  return '<section class="editor-shell" data-testid="protocol-editor">' + editorHeading(isNew ? 'New protocol' : 'Edit protocol', protocol.condition || 'Untitled protocol') +
    '<div class="notice notice--warning">Keep protocol copy at the service level. Do not invent pressures, frequencies, session counts, or week-by-week regimens.</div>' +
    '<form id="protocol-form"><div class="editor-grid">' +
    '<label>Condition or pathway<input name="condition" value="' + h(protocol.condition) + '" required><span class="field-help">This is the only text shown publicly, as one line in the conditions list.</span></label>' +
    '<label>Immutable slug<input name="id" value="' + h(protocol.id) + '" pattern="[a-z0-9\\-]+" required ' + (isNew ? '' : 'readonly') + '></label>' +
    '<label>Track<select name="audience"><option value="disease" ' + (protocol.audience === 'disease' ? 'selected' : '') + '>Disease-specific protocols</option><option value="elderly" ' + (protocol.audience === 'elderly' ? 'selected' : '') + '>Bedridden and elderly care</option></select></label>' +
    '<label>Duration note<input name="durationNote" value="' + h(protocol.durationNote) + '" required></label>' +
    '<label class="field--full">Summary (internal)<textarea name="summary" required>' + h(protocol.summary) + '</textarea></label>' +
    '<label class="field--full">Engagement steps (internal)<textarea name="engagement" required>' + h(protocol.engagement.join('\n')) + '</textarea><span class="field-help">One step per line.</span></label>' +
    '<div class="field-group"><div class="inline-fields"><label class="checkbox-row"><input name="visible" type="checkbox" ' + (protocol.visible ? 'checked' : '') + '><span>Visible</span></label><label class="checkbox-row"><input name="draft" type="checkbox" ' + (protocol.draft ? 'checked' : '') + '><span>Draft content</span></label></div></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save protocol draft</button></div></form></section>';
};

const stageSlot = (testimonial, stage) => {
  const entry = imageForStage(testimonial, stage.key);
  return '<div class="stage-slot" data-stage="' + stage.key + '"><span class="stage-slot__label">' + h(stage.label) + '</span>' +
    (entry
      ? imagePreview(entry.src, true) + '<code>' + h(entry.src) + '</code><button class="button button--danger" type="button" data-action="stage-delete" data-stage="' + stage.key + '">Remove</button>'
      : '<label class="upload-control"><input type="file" data-stage-field="' + stage.key + '" accept="image/jpeg,image/png,image/webp"><span>Upload photograph</span><small>You will crop it to 4:5 before saving.</small></label>') +
    '</div>';
};

const renderTestimonialEditor = () => {
  const testimonial = state.editor.buffer;
  const isNew = state.editor.index < 0;
  return '<section class="editor-shell" data-testid="testimonial-editor">' + editorHeading(isNew ? 'New recovery story' : 'Edit recovery story', testimonial.name || testimonial.condition || 'Untitled story') +
    '<div class="notice">Real patients only. Names are optional and patients stay anonymous by default; add a patient age to show “Patient aged N” on the card instead. With photographs, the clinical remark is required and the quote is optional; without photographs, the quote is required. Location and condition are always required.</div>' +
    '<form id="testimonial-form"><div class="editor-grid">' +
    '<label>Patient name (optional)<input name="name" value="' + h(testimonial.name || '') + '"><span class="field-help">Leave blank to keep the patient anonymous.</span></label>' +
    '<label>Patient age (optional)<input name="age" value="' + h(testimonial.age || '') + '" inputmode="numeric"><span class="field-help">Shown as “Patient aged N”. Leave blank to omit.</span></label>' +
    '<label>Immutable id<input name="id" value="' + h(testimonial.id) + '" pattern="[a-z0-9\\-]+" required ' + (isNew ? '' : 'readonly') + '></label>' +
    '<label>Location<input name="location" value="' + h(testimonial.location) + '" required></label>' +
    '<label class="field--full">Condition<input name="condition" value="' + h(testimonial.condition) + '" required><span class="field-help">Short clinical label shown on the card, e.g. “Venous ulcers from untreated varicose veins”. Do not put the age here.</span></label>' +
    '<label class="field--full">Recovery duration (optional)<input name="duration" value="' + h(testimonial.duration || '') + '" placeholder="e.g. Signs of recovery within 30 days"></label>' +
    '<label class="field--full">Clinical remark<textarea name="remark" rows="5">' + h(testimonial.remark || '') + '</textarea><span class="field-help">The company’s note on condition, treatment, and recovery, shown as the “Case note” on each story.</span></label>' +
    '<label class="field--full">Patient quote (optional with photographs)<textarea name="quote" rows="3">' + h(testimonial.quote || '') + '</textarea></label>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Evidence photographs</h2><p>Before and After are a pair: upload both or neither. During is optional and makes the story a 3-stage journey.</p></div></div><div class="stage-slots">' +
    STAGES.map((stage) => stageSlot(testimonial, stage)).join('') +
    '</div></div>' +
    '<div class="field-group"><label class="checkbox-row"><input name="featured" type="checkbox" ' + (testimonial.featured ? 'checked' : '') + '><span>Featured story <small class="field-help">Renders as the large journey at the top of Recoveries. Only one story can be featured.</small></span></label></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save story draft</button></div></form></section>';
};

const renderCompany = () => {
  const company = state.draft.company;
  return '<section class="editor-shell"><div class="section-toolbar"><div><h1>Company</h1><p>Business identity, contact channels, and about copy.</p></div></div>' +
    '<form id="company-form"><div class="editor-grid">' +
    '<label>Display name<input name="name" value="' + h(company.name) + '" required></label>' +
    '<label>Legal name<input name="legalName" value="' + h(company.legalName) + '" required></label>' +
    '<label class="field--full">Tagline<input name="tagline" value="' + h(company.tagline) + '" required></label>' +
    '<label class="field--full">About copy<textarea name="about" rows="12" required>' + h(company.about) + '</textarea></label>' +
    '<label>Phone<input name="phone" value="' + h(company.phone) + '"></label>' +
    '<label>WhatsApp<input name="whatsapp" value="' + h(company.whatsapp) + '"></label>' +
    '<label>Email<input name="email" type="email" value="' + h(company.email) + '"></label>' +
    '<label>Support hours<input name="hours" value="' + h(company.hours) + '"></label>' +
    '<label class="field--full">Address<input name="address" value="' + h(company.address) + '"></label>' +
    '<label class="field--full">Google Maps URL<input name="mapsUrl" type="url" value="' + h(company.mapsUrl) + '"></label>' +
    '<label>Founded<input name="founded" value="' + h(company.founded) + '"></label>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Social profiles</h2><p>Leave unused channels blank.</p></div></div><div class="editor-grid"><label>LinkedIn<input name="linkedin" type="url" value="' + h(company.social.linkedin) + '"></label><label>Instagram<input name="instagram" type="url" value="' + h(company.social.instagram) + '"></label><label>Facebook<input name="facebook" type="url" value="' + h(company.social.facebook) + '"></label></div></div>' +
    '<div class="field-group"><label class="checkbox-row"><input name="gstDisplay" type="checkbox" ' + (company.gstDisplay ? 'checked' : '') + '><span>Show GST registration detail publicly</span></label></div>' +
    '</div><div class="form-actions"><button class="button button--primary" type="button" data-action="save-company">Save company draft</button></div></form></section>';
};

const renderAppearance = () => {
  const config = state.draft.config;
  const colorMode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const aliases = [
    ['bg', '--bg'], ['surface', '--surface'], ['surface-2', '--surface-2'],
    ['ink', '--ink'], ['muted', '--ink-muted'], ['line', '--line'],
    ['primary', '--primary'], ['accent', '--accent'], ['good', '--good'],
  ];
  const themes = state.draft.themes.map((theme) => {
    const previewTokens = (mode) => aliases
      .map(([alias, token]) => '--preview-' + mode + '-' + alias + ':' + theme[mode][token])
      .join(';');
    const style = previewTokens('light') + ';' + previewTokens('dark');
    const active = config.theme === theme.id;
    const swatch = (name) => '<span style="background:var(--preview-' + name + ')"></span>';
    return '<button class="theme-option" type="button" data-action="select-theme" data-theme-id="' + h(theme.id) + '" aria-pressed="' + String(active) + '" style="' + h(style) + '">' +
      '<span class="theme-option__top"><span class="theme-option__label">' + h(theme.label) + '</span>' + (active ? '<span class="theme-option__check">' + icon('check') + 'Active</span>' : '') + '</span>' +
      '<span class="theme-option__mock" aria-hidden="true"><span class="theme-option__bar"></span><span class="theme-option__card"><span class="theme-option__image"></span><span class="theme-option__copy"><strong>Recoveries you can <em>see</em></strong><small>Documented home therapy</small><span class="theme-option__btn">Talk to us</span></span></span></span>' +
      '<span class="theme-option__swatches" aria-hidden="true">' + ['bg', 'surface', 'primary', 'accent', 'good', 'ink'].map(swatch).join('') + '</span>' +
      '</button>';
  }).join('');
  const statIconLabels = { pulse: 'Pulse', clipboard: 'Clipboard', clock: 'Clock', heart: 'Heart', shield: 'Shield', users: 'People' };
  const statDefaults = [{ icon: 'pulse' }, { icon: 'clipboard' }, { icon: 'clock' }];
  const statSource = Array.isArray(config.heroStats) ? config.heroStats : [];
  const heroStats = [0, 1, 2].map((i) => statSource[i] || statDefaults[i]);
  const statRows = heroStats.map((stat, i) =>
    '<div class="stat-row">' +
    '<label>Icon<select name="stat-icon-' + i + '">' + STAT_ICON_NAMES.map((name) =>
      '<option value="' + name + '"' + (stat.icon === name ? ' selected' : '') + '>' + statIconLabels[name] + '</option>').join('') + '</select></label>' +
    '<label>Number<input name="stat-value-' + i + '" value="' + h(stat.value || '') + '" placeholder="500+"></label>' +
    '<label>Label<input name="stat-label-' + i + '" value="' + h(stat.label || '') + '" placeholder="Recoveries"></label>' +
    '</div>').join('');
  const statFieldGroup = '<div class="field-group"><div class="field-group__heading"><div><h2>Hero counter</h2><p>Up to three stat tiles shown in the hero. Clear a number <em>and</em> label to hide that tile.</p></div></div><div class="stat-editor">' + statRows + '</div></div>';
  return '<section class="editor-shell"><div class="section-toolbar"><div><h1>Appearance</h1><p>Site theme, hero copy, search metadata, and this admin’s color mode.</p></div></div>' +
    '<form id="appearance-form"><div class="editor-grid">' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Site theme</h2><p>Each option pairs light and dark tokens; the preview follows this admin’s color mode.</p></div></div><div class="theme-grid">' + themes + '</div></div>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Admin color mode</h2><p>Only affects this editor on this device.</p></div></div><div class="mode-toggle"><button class="button ' + (colorMode === 'light' ? 'button--primary' : 'button--quiet') + '" type="button" data-action="set-color-mode" data-mode="light">Light</button><button class="button ' + (colorMode === 'dark' ? 'button--primary' : 'button--quiet') + '" type="button" data-action="set-color-mode" data-mode="dark">Dark</button></div></div>' +
    '<label class="field--full">Hero headline<textarea name="heroHeadline" required>' + h(config.heroHeadline) + '</textarea></label>' +
    '<label class="field--full">Hero supporting line<textarea name="heroSub" required>' + h(config.heroSub) + '</textarea></label>' +
    statFieldGroup +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Search metadata</h2><p>Keep title and description specific and concise.</p></div></div><div class="editor-grid"><label class="field--full">SEO title<input name="seoTitle" value="' + h(config.seo.title) + '" required></label><label class="field--full">SEO description<textarea name="seoDescription" required>' + h(config.seo.description) + '</textarea></label></div></div>' +
    '</div><div class="form-actions"><button class="button button--primary" type="button" data-action="save-appearance">Save appearance draft</button></div></form></section>';
};

const render = () => {
  if (!state.loaded) return;
  for (const button of tabNav.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-current', button.dataset.tab === state.activeTab ? 'page' : 'false');
  }
  let html;
  if (state.editor?.kind === 'products') html = renderProductEditor();
  else if (state.editor?.kind === 'protocols') html = renderProtocolEditor();
  else if (state.editor?.kind === 'testimonials') html = renderTestimonialEditor();
  else if (state.activeTab === 'products') html = renderProductsList();
  else if (state.activeTab === 'protocols') html = renderProtocolsList();
  else if (state.activeTab === 'testimonials') html = renderTestimonialsList();
  else if (state.activeTab === 'company') html = renderCompany();
  else html = renderAppearance();
  editorRoot.innerHTML = html;
  applyThemeTokens();
};

const openEditor = (kind, index) => {
  const defaults = { products: defaultProduct, protocols: defaultProtocol, testimonials: defaultTestimonial };
  state.editor = {
    kind,
    index,
    buffer: index < 0 ? defaults[kind]() : deepClone(state.draft[kind][index]),
    assetSnapshot: new Map(state.assetChanges),
    previewPaths: new Set(state.assetPreviews.keys()),
  };
  render();
  document.querySelector('#admin-main').focus();
};

const cancelEditor = () => {
  if (!state.editor) return;
  state.assetChanges = state.editor.assetSnapshot;
  for (const [path, url] of state.assetPreviews) {
    if (!state.editor.previewPaths.has(path)) {
      URL.revokeObjectURL(url);
      state.assetPreviews.delete(path);
    }
  }
  state.editor = null;
  renderUnsaved();
  render();
};

const syncEditorFromForm = () => {
  if (!state.editor) return;
  const form = editorRoot.querySelector('form');
  if (!form) return;
  const data = new FormData(form);
  const buffer = state.editor.buffer;
  if (state.editor.kind === 'products') {
    for (const key of ['id', 'name', 'tagline', 'category', 'model', 'sourceId', 'description']) buffer[key] = String(data.get(key) || '').trim();
    buffer.conditions = lines(data.get('conditions'));
    buffer.catalogue = data.has('catalogue');
    buffer.featured = data.has('featured');
    buffer.visible = data.has('visible');
    for (const input of form.querySelectorAll('[data-spec-index]')) {
      const spec = buffer.specs[Number(input.dataset.specIndex)];
      if (input.dataset.specField === 'visible') spec.visible = input.checked;
      else spec[input.dataset.specField] = input.value.trim();
    }
  } else if (state.editor.kind === 'protocols') {
    for (const key of ['id', 'condition', 'audience', 'summary', 'durationNote']) buffer[key] = String(data.get(key) || '').trim();
    buffer.engagement = lines(data.get('engagement'));
    buffer.visible = data.has('visible');
    buffer.draft = data.has('draft');
  } else {
    for (const key of ['id', 'name', 'age', 'location', 'condition', 'duration', 'remark', 'quote']) buffer[key] = String(data.get(key) || '').trim();
    buffer.featured = data.has('featured');
  }
};

const validateStory = (buffer) => {
  if (!buffer.location || !buffer.condition) {
    throw new Error('Location and condition are required on every story.');
  }
  const byStage = Object.fromEntries(STAGES.map((stage) => [stage.key, imageForStage(buffer, stage.key)]));
  const count = (buffer.images || []).length;
  if (count === 1) throw new Error('A single photograph is not evidence of change: add both Before and After, or remove it.');
  if (count > 0 && (!byStage.before || !byStage.after)) {
    throw new Error('Photograph stories need the Before and After pair. During is optional.');
  }
  if (!count && !buffer.quote) throw new Error('Without photographs, the patient quote is required.');
  if (count && !buffer.remark) throw new Error('Stories with photographs need the clinical remark.');
  if (buffer.featured && count !== 3) throw new Error('The featured story fills the hero’s three-up strip, so it needs all three photographs: Before, During, and After.');
  buffer.images = STAGES.map((stage) => byStage[stage.key]).filter(Boolean);
};

const validateDraft = (testimonials) => {
  let featuredCount = 0;
  for (const testimonial of testimonials) {
    const images = testimonial.images || [];
    if (images.length === 1) {
      throw new Error(`Story “${testimonial.id}” has a single photograph; use 0, 2, or 3.`);
    }
    if (images.length > 3) {
      throw new Error(`Story “${testimonial.id}” has more than 3 photographs; use 0, 2, or 3.`);
    }
    if (testimonial.featured) {
      featuredCount += 1;
      if (images.length !== 3) {
        throw new Error(`The featured story “${testimonial.id}” needs exactly 3 photographs to fill the hero strip (has ${images.length}).`);
      }
    }
  }
  if (featuredCount !== 1) {
    throw new Error(`Exactly one story must be featured before publishing (currently ${featuredCount}). The featured story anchors the hero.`);
  }
};

const saveEditor = () => {
  syncEditorFromForm();
  const { kind, index, buffer } = state.editor;
  if (!buffer.id || !/^[a-z0-9-]+$/.test(buffer.id)) throw new Error('Enter a valid lowercase slug.');
  const duplicate = state.draft[kind].some((item, itemIndex) => item.id === buffer.id && itemIndex !== index);
  if (duplicate) throw new Error('That slug is already in use.');
  if (kind === 'products') {
    if (!buffer.name || !buffer.tagline || !buffer.category || !buffer.description || !buffer.conditions.length) throw new Error('Complete every required product field.');
    buffer.specs = buffer.specs.filter((spec) => spec.key && spec.value);
    if (!buffer.images.length) throw new Error('Add at least one product image.');
  }
  if (kind === 'protocols') {
    if (!buffer.condition || !buffer.summary || !buffer.engagement.length || !buffer.durationNote) throw new Error('Complete every required protocol field.');
    if (!['disease', 'elderly'].includes(buffer.audience)) throw new Error('Choose one of the two tracks.');
  }
  if (kind === 'testimonials') {
    validateStory(buffer);
    const wasFeatured = index >= 0 && state.draft.testimonials[index].featured;
    const othersFeatured = state.draft.testimonials.some((testimonial, itemIndex) => itemIndex !== index && testimonial.featured);
    if (wasFeatured && !buffer.featured && !othersFeatured) {
      throw new Error('One story must stay featured to anchor the hero. Feature another story first, then remove this one from featured.');
    }
    if (buffer.featured) {
      for (const [itemIndex, item] of state.draft.testimonials.entries()) {
        if (itemIndex !== index && item.featured) {
          item.featured = false;
          showStatus('Featured story moved', h(item.condition + ' is no longer featured. Only one story can be.'));
        }
      }
    }
  }
  if (index < 0) state.draft[kind].push(deepClone(buffer));
  else state.draft[kind][index] = deepClone(buffer);
  markDirty(kind);
  state.editor = null;
  render();
};

const moveItem = (kind, index, direction) => {
  const target = index + direction;
  if (target < 0 || target >= state.draft[kind].length) return;
  const [item] = state.draft[kind].splice(index, 1);
  state.draft[kind].splice(target, 0, item);
  markDirty(kind);
  render();
};

const deleteItem = (kind, index) => {
  const item = state.draft[kind][index];
  if (kind === 'products') {
    const references = state.draft.protocols.filter((protocol) => (protocol.deviceIds || []).includes(item.id));
    if (references.length) {
      showStatus('Product is still referenced', 'Remove it from these protocols first: ' + h(references.map((protocol) => protocol.condition).join(', ')) + '.');
      return;
    }
  }
  if (kind === 'testimonials' && item.featured && !state.draft.testimonials.some((testimonial, itemIndex) => itemIndex !== index && testimonial.featured)) {
    showStatus('The featured story can’t be deleted', 'One story must stay featured to anchor the hero. Feature another story first, then delete this one.');
    return;
  }
  if (!confirm('Delete ' + (item.name || item.condition || item.id) + '? This will be included in the next publish.')) return;
  if (kind === 'products') for (const path of item.images) unstageOrDeleteAsset(path);
  if (kind === 'testimonials') for (const image of item.images || []) unstageOrDeleteAsset(image.src);
  state.draft[kind].splice(index, 1);
  markDirty(kind);
  render();
};

const toggleVisible = (kind, index) => {
  const item = state.draft[kind][index];
  item.visible = !item.visible;
  markDirty(kind);
  render();
};

const nextProductImagePath = (product) => {
  const used = new Set(product.images);
  let number = 1;
  let path;
  do {
    path = 'assets/products/' + product.id + '/' + String(number).padStart(2, '0') + '.webp';
    number += 1;
  } while (used.has(path));
  return path;
};

const stageBlob = async (path, blob) => {
  const previous = state.assetPreviews.get(path);
  if (previous) URL.revokeObjectURL(previous);
  state.assetPreviews.set(path, URL.createObjectURL(blob));
  state.assetChanges.set(path, { path, content: await blobToBase64(blob), encoding: 'base64' });
  renderUnsaved();
};

const unstageOrDeleteAsset = (path) => {
  const staged = state.assetChanges.get(path);
  if (staged && !staged.delete) {
    state.assetChanges.delete(path);
    const preview = state.assetPreviews.get(path);
    if (preview) URL.revokeObjectURL(preview);
    state.assetPreviews.delete(path);
    renderUnsaved();
    return;
  }
  state.assetChanges.set(path, { delete: true });
  renderUnsaved();
};

const uploadProductImages = async (files) => {
  syncEditorFromForm();
  const product = state.editor.buffer;
  if (!product.id || !/^[a-z0-9-]+$/.test(product.id)) throw new Error('Enter a valid product slug before uploading images.');
  const duplicate = state.draft.products.some((item, index) => item.id === product.id && index !== state.editor.index);
  if (duplicate) throw new Error('That product slug is already in use. Choose a unique slug before uploading images.');
  for (const file of files) {
    const blob = await resizeProductImage(file);
    const path = nextProductImagePath(product);
    await stageBlob(path, blob);
    product.images.push(path);
  }
  render();
};

const uploadStagePhoto = async (stageKey, file) => {
  syncEditorFromForm();
  const testimonial = state.editor.buffer;
  if (!testimonial.id || !/^[a-z0-9-]+$/.test(testimonial.id)) throw new Error('Enter a valid story id before uploading photographs.');
  const duplicate = state.draft.testimonials.some((item, index) => item.id === testimonial.id && index !== state.editor.index);
  if (duplicate) throw new Error('That story id is already in use. Choose a unique id before uploading photographs.');
  const stage = STAGES.find((candidate) => candidate.key === stageKey);
  const blob = await cropEvidenceImage(file, stage.key);
  if (!blob) return;
  const existing = imageForStage(testimonial, stage.key);
  if (existing) unstageOrDeleteAsset(existing.src);
  const path = 'assets/testimonials/' + testimonial.id + '-' + stage.key + '.webp';
  await stageBlob(path, blob);
  testimonial.images = (testimonial.images || []).filter((image) => stageKeyOf(image) !== stage.key);
  testimonial.images.push({ src: path, stage: stage.label });
  render();
};

const handleEditorAction = async (button) => {
  const action = button.dataset.action;
  if (action === 'add') return openEditor(button.dataset.kind, -1);
  if (action === 'edit') return openEditor(button.dataset.kind, Number(button.dataset.index));
  if (action === 'back') {
    cancelEditor();
    return;
  }
  if (action === 'move') return moveItem(button.dataset.kind, Number(button.dataset.index), Number(button.dataset.direction));
  if (action === 'toggle-visible') return toggleVisible(button.dataset.kind, Number(button.dataset.index));
  if (action === 'delete') return deleteItem(button.dataset.kind, Number(button.dataset.index));
  if (action === 'save-editor') return saveEditor();
  if (action === 'save-company') return saveCompany(editorRoot.querySelector('#company-form'));
  if (action === 'save-appearance') return saveAppearance(editorRoot.querySelector('#appearance-form'));
  if (action === 'set-color-mode') return setColorMode(button.dataset.mode);
  if (action === 'select-theme') {
    state.draft.config.theme = button.dataset.themeId;
    markDirty('config');
    render();
    return;
  }
  if (!state.editor) return;
  syncEditorFromForm();
  const buffer = state.editor.buffer;
  if (action === 'spec-add') buffer.specs.push({ key: '', value: '', visible: true });
  if (action === 'spec-move') {
    const index = Number(button.dataset.index);
    const target = index + Number(button.dataset.direction);
    const [spec] = buffer.specs.splice(index, 1);
    buffer.specs.splice(target, 0, spec);
  }
  if (action === 'spec-delete') buffer.specs.splice(Number(button.dataset.index), 1);
  if (action === 'image-move') {
    const index = Number(button.dataset.index);
    const target = index + Number(button.dataset.direction);
    const [path] = buffer.images.splice(index, 1);
    buffer.images.splice(target, 0, path);
  }
  if (action === 'image-delete') {
    const [path] = buffer.images.splice(Number(button.dataset.index), 1);
    unstageOrDeleteAsset(path);
  }
  if (action === 'stage-delete') {
    const existing = imageForStage(buffer, button.dataset.stage);
    if (existing) {
      unstageOrDeleteAsset(existing.src);
      buffer.images = buffer.images.filter((image) => image !== existing);
    }
  }
  if (action === 'copy-prompt') {
    await navigator.clipboard.writeText(productPrompt(buffer.name));
    showStatus('Prompt copied', 'The locked product-image prompt is ready to paste into edit/reference mode.');
    return;
  }
  render();
};

const saveCompany = (form) => {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  state.draft.company = {
    name: String(data.get('name') || '').trim(),
    legalName: String(data.get('legalName') || '').trim(),
    tagline: String(data.get('tagline') || '').trim(),
    about: String(data.get('about') || '').trim(),
    phone: String(data.get('phone') || '').trim(),
    whatsapp: String(data.get('whatsapp') || '').trim(),
    email: String(data.get('email') || '').trim(),
    address: String(data.get('address') || '').trim(),
    mapsUrl: String(data.get('mapsUrl') || '').trim(),
    hours: String(data.get('hours') || '').trim(),
    social: {
      linkedin: String(data.get('linkedin') || '').trim(),
      instagram: String(data.get('instagram') || '').trim(),
      facebook: String(data.get('facebook') || '').trim(),
    },
    founded: String(data.get('founded') || '').trim(),
    gstDisplay: data.has('gstDisplay'),
  };
  markDirty('company');
  showStatus('Company draft saved', 'The changes are held in memory until you publish.');
};

const saveAppearance = (form) => {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  state.draft.config.heroHeadline = String(data.get('heroHeadline') || '').trim();
  state.draft.config.heroSub = String(data.get('heroSub') || '').trim();
  state.draft.config.seo.title = String(data.get('seoTitle') || '').trim();
  state.draft.config.seo.description = String(data.get('seoDescription') || '').trim();
  const heroStats = [];
  for (let i = 0; i < 3; i += 1) {
    const value = String(data.get('stat-value-' + i) || '').trim();
    const label = String(data.get('stat-label-' + i) || '').trim();
    const iconName = String(data.get('stat-icon-' + i) || 'pulse').trim();
    // A tile needs both a number and a label; blank either to drop it.
    if (value && label) {
      heroStats.push({ icon: STAT_ICON_NAMES.includes(iconName) ? iconName : 'pulse', value, label });
    }
  }
  state.draft.config.heroStats = heroStats;
  markDirty('config');
  showStatus('Appearance draft saved', 'The theme and copy changes are held in memory until you publish.');
};

const collectChanges = () => {
  const changes = [...state.dirty].map((key) => GhApi.jsonChange(FILES[key], state.draft[key]));
  for (const [path, change] of state.assetChanges) {
    changes.push(change.delete ? { path, delete: true } : { path, content: change.content, encoding: change.encoding });
  }
  return changes;
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const ACTIONS_URL = `https://github.com/${OWNER}/${REPO}/actions/workflows/deploy.yml`;
// GitHub can lag before it even registers the run (busy queue, or the previous
// deploy still holding the `pages` concurrency group), and a hosted runner can
// take many minutes to be assigned. These budgets are generous on purpose so a
// slow-but-healthy build is never reported as a failure or "no run found".
const POLL_INTERVAL = 5000;
const DISCOVER_DEADLINE = 4 * 60 * 1000; // wait this long for the run to appear
const COMPLETE_DEADLINE = 20 * 60 * 1000; // total budget through completion

const pollActions = async (commitSha) => {
  const started = Date.now();
  const actionsLink = '<a href="' + h(ACTIONS_URL) + '" target="_blank" rel="noreferrer">Watch on GitHub</a>';

  // Phase 1 — wait for GitHub to create the workflow run for this commit.
  // The commit is already safe on the branch; we are only waiting for CI to
  // pick it up, which can take minutes when GitHub is busy or a prior deploy
  // is still finishing (the workflow queues on the `pages` concurrency group).
  let run = null;
  while (!run) {
    const runs = await state.api.listRuns(commitSha);
    if (runs.length) { [run] = runs; break; }
    if (Date.now() - started > DISCOVER_DEADLINE) {
      showStatus('Build hasn’t started yet', 'Your changes are committed and safe — GitHub just hasn’t picked them up yet (it can be slow when busy). The site will rebuild once it does. ' + actionsLink + '.');
      return;
    }
    showStatus('Waiting for the build to start', 'Saved. Waiting for GitHub Actions to pick up the change… this can take a few minutes when GitHub is busy. ' + actionsLink + '.');
    await wait(POLL_INTERVAL);
  }

  // Phase 2 — follow the run through queued → building → completed.
  for (;;) {
    const runs = await state.api.listRuns(commitSha);
    run = runs.find((candidate) => candidate.id === run.id) || run;
    const runLink = '<a href="' + h(run.html_url) + '" target="_blank" rel="noreferrer">View run</a>.';
    if (run.status === 'completed') {
      if (run.conclusion === 'success') showStatus('Publish complete', 'Your changes are live — the site built and deployed successfully. ' + runLink);
      else showStatus('Build failed', 'The commit was published, but GitHub Actions reported ' + h(run.conclusion) + '. Open the run to see why. ' + runLink);
      return;
    }
    if (Date.now() - started > COMPLETE_DEADLINE) {
      showStatus('Build still running', 'The build has been running unusually long — GitHub may be under load. It should still finish on its own; check the run for progress. ' + runLink);
      return;
    }
    if (run.status === 'in_progress') showStatus('Building and deploying', 'GitHub Actions is building and deploying your changes now. ' + runLink);
    else showStatus('Waiting for a runner', 'GitHub has queued the build and is assigning a machine — this can take several minutes when GitHub is busy. ' + runLink);
    await wait(POLL_INTERVAL);
  }
};

const publish = async () => {
  if (state.publishing) return;
  if (state.editor) return showStatus('Open editor not saved', 'Save or cancel the open editor first.');
  try {
    validateDraft(state.draft.testimonials);
  } catch (error) {
    showStatus('Cannot publish yet', h(error.message));
    return;
  }
  const changes = collectChanges();
  if (!changes.length) return showStatus('Nothing to publish', 'Make a content change first.');
  state.publishing = true;
  renderUnsaved();
  publishButton.textContent = 'Publishing…';
  barPublishButton.textContent = 'Publishing…';
  showStatus('Preparing commit', 'Uploading changed files before the branch reference is updated atomically.');
  try {
    const commit = await state.api.publish(changes, state.baseSha, 'Update site content from admin');
    state.baseSha = commit.sha;
    state.dirty.clear();
    state.assetChanges.clear();
    renderUnsaved();
    showStatus('Commit published', 'The branch now points to commit ' + h(commit.sha.slice(0, 7)) + '. Checking GitHub Actions…');
    pollActions(commit.sha).catch((error) => showStatus('Commit published', 'The commit succeeded, but Actions status could not be checked: ' + h(error.message)));
  } catch (error) {
    if (error instanceof BranchConflictError) {
      showStatus('Branch changed', h(error.message), { action: 'reload-reapply', actionLabel: 'Reload source and reapply draft' });
    } else {
      handleApiError(error);
    }
  } finally {
    state.publishing = false;
    publishButton.textContent = 'Save & Publish';
    barPublishButton.textContent = 'Save & Publish';
    renderUnsaved();
  }
};

const reloadAndReapply = async () => {
  const pendingDraft = deepClone(state.draft);
  const pendingDirty = new Set(state.dirty);
  const pendingAssets = new Map(state.assetChanges);
  showStatus('Refreshing source', 'Loading the latest branch before reapplying changed files.');
  await loadRepository();
  for (const key of pendingDirty) state.draft[key] = pendingDraft[key];
  state.dirty = pendingDirty;
  state.assetChanges = pendingAssets;
  render();
  renderUnsaved();
  showStatus('Draft reapplied', 'Latest branch loaded. Review the draft and publish again.');
};

const handleApiError = (error) => {
  if (error instanceof AuthError || error.status === 401) {
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
    showAuth('GitHub rejected the stored token. If it was rotated or expired, forget this device and set it up with the new token.');
    return;
  }
  const prefix = error instanceof ApiError && error.status ? 'GitHub returned ' + error.status + '. ' : '';
  showStatus('Request failed', h(prefix + error.message));
};

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = setupToken.value.trim();
  const branch = setupBranch.value.trim() || 'main';
  const passcode = setupPasscode.value;
  if (!token) return;
  if (passcode.length < 8) return setAuthStatus('The passcode needs at least 8 characters.');
  if (passcode !== setupPasscodeConfirm.value) return setAuthStatus('The passcodes do not match.');
  const connected = await connect(token, branch, { busyButton: setupButton });
  if (!connected) return;
  setAuthStatus('');
  try {
    await createVault(token, passcode, branch);
  } catch (error) {
    showStatus('Vault not saved', h('The token works for this session, but encrypting it failed: ' + error.message));
  }
});

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  unlockButton.disabled = true;
  setAuthStatus('Decrypting token…');
  try {
    const { token, branch } = await unlockVault(unlockPasscode.value);
    await connect(token, state.branch || branch, { busyButton: unlockButton });
  } catch (error) {
    setAuthStatus(error.message);
    unlockPasscode.select();
  } finally {
    unlockButton.disabled = false;
  }
});

forgetButton.addEventListener('click', () => {
  if (!confirm('Forget this device? The encrypted token is deleted and you will need to paste the token again.')) return;
  forgetVault();
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  showAuth('Device forgotten. Set it up again with your token.');
});

for (const toggle of [document.querySelector('#auth-theme-toggle'), document.querySelector('#theme-toggle')]) {
  toggle.addEventListener('click', toggleColorMode);
}

tabNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  if (state.editor) cancelEditor();
  state.activeTab = button.dataset.tab;
  clearStatus();
  render();
});

editorRoot.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  try {
    await handleEditorAction(button);
  } catch (error) {
    showStatus('Could not update draft', h(error.message));
  }
});

editorRoot.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    if (event.target.id === 'product-form' || event.target.id === 'protocol-form' || event.target.id === 'testimonial-form') saveEditor();
    if (event.target.id === 'company-form') saveCompany(event.target);
    if (event.target.id === 'appearance-form') saveAppearance(event.target);
  } catch (error) {
    showStatus('Check the form', h(error.message));
  }
});

editorRoot.addEventListener('change', async (event) => {
  try {
    if (event.target.id === 'product-images') await uploadProductImages([...event.target.files]);
    if (event.target.dataset.stageField && event.target.files[0]) await uploadStagePhoto(event.target.dataset.stageField, event.target.files[0]);
  } catch (error) {
    showStatus('Image could not be processed', h(error.message));
  }
});

// A committed-asset preview that fails to load falls back to the text label.
// `error` does not bubble, so this listens in the capture phase.
editorRoot.addEventListener('error', (event) => {
  const img = event.target;
  if (img?.tagName !== 'IMG' || !img.dataset.assetFallback || img.dataset.assetFailed) return;
  img.dataset.assetFailed = '1';
  img.insertAdjacentHTML('afterend', '<span class="help">Stored in repository</span>');
  img.remove();
}, true);

editorRoot.addEventListener('input', (event) => {
  if (state.editor?.kind === 'products' && event.target.name === 'name') {
    state.editor.buffer.name = event.target.value.trim();
    const prompt = document.querySelector('#product-prompt');
    if (prompt) prompt.textContent = productPrompt(state.editor.buffer.name);
  }
});

publishButton.addEventListener('click', publish);
barPublishButton.addEventListener('click', publish);

rebuildButton.addEventListener('click', async () => {
  rebuildButton.disabled = true;
  showStatus('Starting rebuild', 'Requesting the deploy workflow on main.');
  try {
    await state.api.dispatchWorkflow();
    showStatus('Rebuild requested', 'GitHub is rebuilding and redeploying the current site (no content change). It can take a few minutes to start. <a href="' + h(ACTIONS_URL) + '" target="_blank" rel="noreferrer">Watch on GitHub</a>.');
  } catch (error) {
    handleApiError(error);
  } finally {
    rebuildButton.disabled = false;
  }
});

publishStatus.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-global-action]');
  if (!button) return;
  if (button.dataset.globalAction === 'reload-reapply') {
    try { await reloadAndReapply(); } catch (error) { handleApiError(error); }
  }
});

document.querySelector('#lock-button').addEventListener('click', () => {
  if ((state.dirty.size || state.assetChanges.size) && !confirm('Lock the admin and discard the in-memory draft?')) return;
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  state.api = null;
  state.loaded = false;
  state.draft = {};
  state.dirty.clear();
  state.assetChanges.clear();
  showAuth('Locked. Enter your passcode to continue.');
});

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty.size && !state.assetChanges.size) return;
  event.preventDefault();
  event.returnValue = '';
});

const savedToken = sessionToken();
if (savedToken) {
  connect(savedToken, state.branch, {
    busyButton: unlockButton,
    onAuthFailure: () => showAuth('The session token no longer works. Unlock with your passcode.'),
  });
} else {
  showAuth();
}
