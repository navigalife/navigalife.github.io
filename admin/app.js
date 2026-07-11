import { ApiError, AuthError, BranchConflictError, GhApi } from './gh-api.js';
import { blobToBase64, cropEvidenceImage, resizeProductImage } from './image-tools.js';

const OWNER = 'navigalife';
const REPO = 'navigalife.github.io';
const TOKEN_SESSION_KEY = 'naviga-admin-token-session';
const TOKEN_LOCAL_KEY = 'naviga-admin-token-local';
const BRANCH_KEY = 'naviga-admin-branch';
const FILES = {
  products: 'data/products.json',
  protocols: 'data/protocols.json',
  testimonials: 'data/testimonials.json',
  company: 'data/company.json',
  config: 'data/site-config.json',
  themes: 'data/themes.json',
};

const state = {
  api: null,
  branch: new URLSearchParams(location.search).get('branch') || localStorage.getItem(BRANCH_KEY) || 'main',
  baseSha: '',
  draft: {},
  dirty: new Set(),
  assetChanges: new Map(),
  assetPreviews: new Map(),
  activeTab: 'products',
  editor: null,
  loaded: false,
  publishing: false,
};

const authView = document.querySelector('#auth-view');
const appView = document.querySelector('#app-view');
const authForm = document.querySelector('#auth-form');
const tokenInput = document.querySelector('#token-input');
const branchInput = document.querySelector('#branch-input');
const rememberInput = document.querySelector('#remember-input');
const storageWarning = document.querySelector('#storage-warning');
const authStatus = document.querySelector('#auth-status');
const connectButton = document.querySelector('#connect-button');
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
const slugify = (value) => String(value || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const icon = (name) => {
  const paths = {
    up: '<path d="m7 14 5-5 5 5"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    edit: '<path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z"/><path d="m14.5 7.1 2.8 2.8"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    hidden: '<path d="m3 3 18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a18 18 0 0 1-2.6 3.2M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6c1.2 0 2.3-.2 3.3-.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths[name] + '</svg>';
};

const setColorMode = (mode) => {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem('naviga-admin-color-mode', mode);
  applyThemeTokens();
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

const storeToken = (token, remember) => {
  sessionStorage.setItem(TOKEN_SESSION_KEY, token);
  if (remember) localStorage.setItem(TOKEN_LOCAL_KEY, token);
  else localStorage.removeItem(TOKEN_LOCAL_KEY);
};

const clearTokens = () => {
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  localStorage.removeItem(TOKEN_LOCAL_KEY);
};

const currentToken = () => sessionStorage.getItem(TOKEN_SESSION_KEY) || localStorage.getItem(TOKEN_LOCAL_KEY) || '';

const showAuth = (message = '') => {
  authView.hidden = false;
  appView.hidden = true;
  tokenInput.value = '';
  setAuthStatus(message);
  tokenInput.focus();
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

const authenticate = async (token, remember, branch) => {
  connectButton.disabled = true;
  setAuthStatus('Validating repository access…');
  const api = new GhApi({ token, owner: OWNER, repo: REPO, branch });
  try {
    await api.validate();
    const canResumeDraft = state.loaded && state.branch === branch;
    state.api = api;
    state.branch = branch;
    localStorage.setItem(BRANCH_KEY, branch);
    storeToken(token, remember);
    showApp();
    if (!canResumeDraft) await loadRepository();
    else render();
    setAuthStatus('');
  } catch (error) {
    setAuthStatus(error.message);
    showAuth(error.message);
  } finally {
    connectButton.disabled = false;
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

const applyThemeTokens = () => {
  if (!state.loaded) return;
  const selected = state.draft.themes.find((theme) => theme.id === state.draft.config.theme);
  if (!selected) return;
  const mode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  for (const [token, value] of Object.entries(selected[mode])) {
    document.documentElement.style.setProperty(token, value);
  }
};

const rowActions = (kind, index, length, canToggle = true) => '<div class="row-actions">' +
  '<button class="row-action" type="button" data-action="move" data-kind="' + kind + '" data-index="' + index + '" data-direction="-1" aria-label="Move up" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button>' +
  '<button class="row-action" type="button" data-action="move" data-kind="' + kind + '" data-index="' + index + '" data-direction="1" aria-label="Move down" ' + (index === length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button>' +
  (canToggle ? '<button class="row-action" type="button" data-action="toggle-visible" data-kind="' + kind + '" data-index="' + index + '" aria-label="Toggle visibility">' + icon('eye') + '</button>' : '') +
  '<button class="row-action row-action--text" type="button" data-action="edit" data-kind="' + kind + '" data-index="' + index + '">Edit</button>' +
  '<button class="row-action" type="button" data-action="delete" data-kind="' + kind + '" data-index="' + index + '" aria-label="Delete">' + icon('trash') + '</button>' +
  '</div>';

const listPage = (kind, title, description, rows) => {
  const label = kind === 'testimonials' ? 'testimonial' : kind.slice(0, -1);
  const content = rows.length ? '<div class="list-table" data-testid="' + kind + '-list"><div class="list-head"><span>Name</span><span>Type</span><span>Status</span><span>Actions</span></div>' + rows.join('') + '</div>' :
    '<div class="empty-state"><h2>No ' + h(kind) + ' yet</h2><p>Add the first ' + h(label) + ' to begin.</p><button class="button button--primary" type="button" data-action="add" data-kind="' + kind + '">Add ' + h(label) + '</button></div>';
  return '<section><div class="section-toolbar"><div><h1>' + h(title) + '</h1><p>' + h(description) + '</p></div><button class="button button--primary" type="button" data-action="add" data-kind="' + kind + '">Add ' + h(label) + '</button></div>' + content + '</section>';
};

const renderProductsList = () => {
  const items = state.draft.products;
  const rows = items.map((product, index) => '<div class="list-row" data-testid="product-row">' +
    '<div class="row-title"><strong>' + h(product.name) + '</strong><span>' + h(product.id) + '</span></div>' +
    '<div class="row-meta">' + h(product.category) + '</div>' +
    '<div class="status-badges"><span class="badge ' + (product.visible ? 'badge--active' : '') + '">' + (product.visible ? 'Visible' : 'Hidden') + '</span>' + (product.featured ? '<span class="badge">Featured</span>' : '') + '</div>' +
    rowActions('products', index, items.length) + '</div>');
  return listPage('products', 'Products', 'Edit device details, specifications, images, order, and visibility.', rows);
};

const renderProtocolsList = () => {
  const items = state.draft.protocols;
  const rows = items.map((protocol, index) => '<div class="list-row" data-testid="protocol-row">' +
    '<div class="row-title"><strong>' + h(protocol.condition) + '</strong><span>' + h(protocol.id) + '</span></div>' +
    '<div class="row-meta">' + h(protocol.audience) + ' · ' + protocol.deviceIds.length + ' devices</div>' +
    '<div class="status-badges"><span class="badge ' + (protocol.visible ? 'badge--active' : '') + '">' + (protocol.visible ? 'Visible' : 'Hidden') + '</span>' + (protocol.draft ? '<span class="badge badge--draft">Draft</span>' : '') + '</div>' +
    rowActions('protocols', index, items.length) + '</div>');
  return listPage('protocols', 'Protocols', 'Manage audience pathways, engagement steps, related devices, and draft status.', rows);
};

const renderTestimonialsList = () => {
  const items = state.draft.testimonials;
  const rows = items.map((testimonial, index) => '<div class="list-row" data-testid="testimonial-row">' +
    '<div class="row-title"><strong>' + h(testimonial.name) + '</strong><span>' + h(testimonial.id) + '</span></div>' +
    '<div class="row-meta">' + h(testimonial.type === 'before-after' ? 'Before / after' : 'Quote') + ' · ' + h(testimonial.location) + '</div>' +
    '<div class="status-badges">' + (testimonial.placeholder ? '<span class="badge badge--draft">Placeholder</span>' : '<span class="badge badge--active">Verified</span>') + '</div>' +
    rowActions('testimonials', index, items.length, false) + '</div>');
  return listPage('testimonials', 'Testimonials', 'Publish quotes or real 4:5 before-and-after evidence pairs.', rows);
};

const productPrompt = (name) => [
  'Use case: product-mockup',
  'Asset type: medical-device catalogue and website product image',
  'Input images: Image 1 is the edit target and exact product reference',
  'Primary request: Restyle Image 1 as a clean studio product photograph of ' + (name || '{PRODUCT_NAME}') + '.',
  'Device integrity: Keep this exact device. Preserve its shape, proportions, enclosure, controls, display, ports, tubing, cables, garments, attachments, materials, and colorway. Do not redesign, simplify, add, remove, relocate, or substitute any functional part. Change only the photographic setting, lighting, camera presentation, and removal of visible branding or text.',
  '',
  'Style/medium: restrained, photorealistic studio product photography for a trusted medical-device catalogue.',
  'Scene/backdrop: seamless warm off-white #F6F4EF studio background; the device rests on a low matte plinth in the same warm neutral family.',
  'Composition/framing: slight three-quarter hero angle; complete device and all necessary tubing or garments visible; centered visual balance; generous safe space; 3:2 landscape aspect ratio.',
  'Lighting/mood: soft diffused key light from the upper left; quiet clinical warmth; controlled natural shadow; shallow depth of field while every functional device detail remains legible.',
  'Color palette: muted clinical neutrals with restrained deep-teal accents echoing #0E6B63; accurate product colorway takes priority.',
  'Materials/textures: truthful medical-grade plastics, fabric, tubing, and matte surfaces; realistic edges and contact shadows.',
  'Constraints: no people; no hands; no text; no letters; no numbers; no logos; no trademarks; no watermark; no certification seal; no extra props; no packaging; no dramatic reflections; no gradient wash; no floating parts. Preserve product identity and functional geometry exactly.',
].join('\n');

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
    'Assessment of the condition, current care plan, and home-use needs',
    'Device and garment selection matched to the individual case',
    'Guided home-use sessions under expert guidance',
    'Review and adjustment based on progress and practical fit',
  ],
  durationNote: '30–90 days, case to case',
  deviceIds: [],
  visible: true,
  draft: true,
});

const defaultTestimonial = () => ({
  id: '',
  type: 'quote',
  name: '',
  location: '',
  quote: '',
  context: '',
  placeholder: true,
});

const editorHeading = (kicker, title) => '<div class="editor-header"><div><p class="auth-kicker">' + h(kicker) + '</p><h1>' + h(title) + '</h1></div><button class="button button--quiet" type="button" data-action="back">Back to list</button></div>';

const imagePreview = (path, evidence = false) => {
  const preview = state.assetPreviews.get(path);
  if (preview) return '<div class="image-preview ' + (evidence ? 'image-preview--evidence' : '') + '"><img src="' + h(preview) + '" alt=""></div>';
  return '<div class="image-preview ' + (evidence ? 'image-preview--evidence' : '') + '"><span class="help">Stored in repository</span></div>';
};

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
    '<label>Immutable slug<input name="id" value="' + h(product.id) + '" pattern="[a-z0-9-]+" required ' + (isNew && !hasStagedProductImage ? '' : 'readonly') + '><span class="field-help">' + (hasStagedProductImage ? 'Remove staged uploads before changing this slug.' : 'Lowercase letters, numbers, and hyphens.') + '</span></label>' +
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
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="submit">Save product draft</button></div></form></section>';
};

const renderProtocolEditor = () => {
  const protocol = state.editor.buffer;
  const isNew = state.editor.index < 0;
  const devices = state.draft.products.map((product) => '<label><input type="checkbox" name="deviceIds" value="' + h(product.id) + '" ' + (protocol.deviceIds.includes(product.id) ? 'checked' : '') + '><span>' + h(product.name) + '</span></label>').join('');
  return '<section class="editor-shell" data-testid="protocol-editor">' + editorHeading(isNew ? 'New protocol' : 'Edit protocol', protocol.condition || 'Untitled protocol') +
    '<div class="notice notice--warning">Keep protocol copy at the service level. Do not invent pressures, frequencies, session counts, or week-by-week regimens.</div>' +
    '<form id="protocol-form"><div class="editor-grid">' +
    '<label>Condition or pathway<input name="condition" value="' + h(protocol.condition) + '" required></label>' +
    '<label>Immutable slug<input name="id" value="' + h(protocol.id) + '" pattern="[a-z0-9-]+" required ' + (isNew ? '' : 'readonly') + '></label>' +
    '<label>Audience<select name="audience"><option value="disease" ' + (protocol.audience === 'disease' ? 'selected' : '') + '>Disease-specific care</option><option value="wellbeing" ' + (protocol.audience === 'wellbeing' ? 'selected' : '') + '>Elderly wellbeing</option><option value="sports" ' + (protocol.audience === 'sports' ? 'selected' : '') + '>Sports recovery</option></select></label>' +
    '<label>Duration note<input name="durationNote" value="' + h(protocol.durationNote) + '" required></label>' +
    '<label class="field--full">Summary<textarea name="summary" required>' + h(protocol.summary) + '</textarea></label>' +
    '<label class="field--full">Engagement steps<textarea name="engagement" required>' + h(protocol.engagement.join('\n')) + '</textarea><span class="field-help">One step per line.</span></label>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Related devices</h2><p>Choose every device that may support this pathway.</p></div></div><div class="device-select">' + devices + '</div></div>' +
    '<div class="field-group"><div class="inline-fields"><label class="checkbox-row"><input name="visible" type="checkbox" ' + (protocol.visible ? 'checked' : '') + '><span>Visible</span></label><label class="checkbox-row"><input name="draft" type="checkbox" ' + (protocol.draft ? 'checked' : '') + '><span>Draft content</span></label></div></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="submit">Save protocol draft</button></div></form></section>';
};

const evidenceUpload = (testimonial, field, label) => {
  const path = testimonial[field];
  return '<div class="image-item">' + (path ? imagePreview(path, true) + '<code>' + h(path) + '</code><button class="button button--danger" type="button" data-action="evidence-delete" data-field="' + field + '">Remove</button>' : '') +
    '<label class="upload-control"><input type="file" data-evidence-field="' + field + '" accept="image/jpeg,image/png,image/webp"><span>Upload ' + h(label) + ' image</span><small>You will crop it to 4:5 before saving.</small></label></div>';
};

const renderTestimonialEditor = () => {
  const testimonial = state.editor.buffer;
  const isNew = state.editor.index < 0;
  return '<section class="editor-shell" data-testid="testimonial-editor">' + editorHeading(isNew ? 'New testimonial' : 'Edit testimonial', testimonial.name || 'Untitled testimonial') +
    '<form id="testimonial-form"><div class="editor-grid">' +
    '<div class="field--full"><span class="field-label">Testimonial type</span><div class="type-toggle"><label><input type="radio" name="type" value="quote" ' + (testimonial.type === 'quote' ? 'checked' : '') + '><span>Quote only</span></label><label><input type="radio" name="type" value="before-after" ' + (testimonial.type === 'before-after' ? 'checked' : '') + '><span>Before / after evidence</span></label></div></div>' +
    '<label>Name<input name="name" value="' + h(testimonial.name) + '" required></label>' +
    '<label>Immutable id<input name="id" value="' + h(testimonial.id) + '" pattern="[a-z0-9-]+" required ' + (isNew ? '' : 'readonly') + '></label>' +
    '<label>Location<input name="location" value="' + h(testimonial.location) + '" required></label>' +
    '<label>Context or condition<input name="context" value="' + h(testimonial.context) + '" required></label>' +
    '<label class="field--full">Quote<textarea name="quote" required>' + h(testimonial.quote) + '</textarea></label>' +
    (testimonial.type === 'before-after' ? '<div class="field-group"><div class="field-group__heading"><div><h2>Matched evidence pair</h2><p>Real customer photos only. Both images are cropped client-side to 4:5 and encoded as WebP.</p></div></div><div class="evidence-uploads">' + evidenceUpload(testimonial, 'beforeImage', 'before') + evidenceUpload(testimonial, 'afterImage', 'after') + '</div></div>' : '') +
    '<div class="field-group"><label class="checkbox-row"><input name="placeholder" type="checkbox" ' + (testimonial.placeholder ? 'checked' : '') + ' ' + (testimonial.type === 'before-after' ? 'disabled' : '') + '><span>Placeholder testimonial <small class="field-help">This badge appears in admin only.</small></span></label></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="submit">Save testimonial draft</button></div></form></section>';
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
    '</div><div class="form-actions"><button class="button button--primary" type="submit">Save company draft</button></div></form></section>';
};

const renderAppearance = () => {
  const config = state.draft.config;
  const themes = state.draft.themes.map((theme) => {
    const light = theme.light;
    const style = '--preview-bg:' + light['--bg'] + ';--preview-surface:' + light['--surface'] + ';--preview-surface-2:' + light['--surface-2'] + ';--preview-ink:' + light['--ink'] + ';--preview-muted:' + light['--ink-muted'] + ';--preview-line:' + light['--line'];
    return '<button class="theme-option" type="button" data-action="select-theme" data-theme-id="' + h(theme.id) + '" aria-pressed="' + String(config.theme === theme.id) + '"><span class="theme-option__label">' + h(theme.label) + (config.theme === theme.id ? '<span class="badge badge--active">Active</span>' : '') + '</span><span class="theme-option__mock" style="' + h(style) + '"><span><span></span><span><strong>Compression therapy system</strong><small>Guided care at home</small></span></span></span></button>';
  }).join('');
  return '<section class="editor-shell"><div class="section-toolbar"><div><h1>Appearance</h1><p>Theme, hero positioning, and search metadata.</p></div></div>' +
    '<form id="appearance-form"><div class="editor-grid"><div class="field-group"><div class="field-group__heading"><div><h2>Site theme</h2><p>Each option includes its paired light and dark tokens.</p></div></div><div class="theme-grid">' + themes + '</div></div>' +
    '<label class="field--full">Hero headline<textarea name="heroHeadline" required>' + h(config.heroHeadline) + '</textarea></label>' +
    '<label class="field--full">Hero supporting line<textarea name="heroSub" required>' + h(config.heroSub) + '</textarea></label>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Search metadata</h2><p>Keep title and description specific and concise.</p></div></div><div class="editor-grid"><label class="field--full">SEO title<input name="seoTitle" value="' + h(config.seo.title) + '" required></label><label class="field--full">SEO description<textarea name="seoDescription" required>' + h(config.seo.description) + '</textarea></label></div></div>' +
    '</div><div class="form-actions"><button class="button button--primary" type="submit">Save appearance draft</button></div></form></section>';
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
    buffer.deviceIds = data.getAll('deviceIds').map(String);
    buffer.visible = data.has('visible');
    buffer.draft = data.has('draft');
  } else {
    for (const key of ['id', 'type', 'name', 'location', 'quote', 'context']) buffer[key] = String(data.get(key) || '').trim();
    buffer.placeholder = buffer.type === 'before-after' ? false : data.has('placeholder');
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
  }
  if (kind === 'testimonials') {
    if (!buffer.name || !buffer.location || !buffer.quote || !buffer.context) throw new Error('Complete every required testimonial field.');
    if (buffer.type === 'before-after' && (!buffer.beforeImage || !buffer.afterImage)) throw new Error('Before-and-after testimonials require both real images.');
    if (buffer.type === 'quote') {
      delete buffer.beforeImage;
      delete buffer.afterImage;
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
    const references = state.draft.protocols.filter((protocol) => protocol.deviceIds.includes(item.id));
    if (references.length) {
      showStatus('Product is still referenced', 'Remove it from these protocols first: ' + h(references.map((protocol) => protocol.condition).join(', ')) + '.');
      return;
    }
  }
  if (!confirm('Delete ' + (item.name || item.condition || item.id) + '? This will be included in the next publish.')) return;
  if (kind === 'products') for (const path of item.images) unstageOrDeleteAsset(path);
  if (kind === 'testimonials') {
    if (item.beforeImage) unstageOrDeleteAsset(item.beforeImage);
    if (item.afterImage) unstageOrDeleteAsset(item.afterImage);
  }
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

const uploadEvidence = async (field, file) => {
  syncEditorFromForm();
  const testimonial = state.editor.buffer;
  if (!testimonial.id || !/^[a-z0-9-]+$/.test(testimonial.id)) throw new Error('Enter a valid testimonial id before uploading images.');
  const label = field === 'beforeImage' ? 'before' : 'after';
  const blob = await cropEvidenceImage(file, label);
  if (!blob) return;
  if (testimonial[field]) unstageOrDeleteAsset(testimonial[field]);
  const path = 'assets/testimonials/' + testimonial.id + '-' + label + '.webp';
  await stageBlob(path, blob);
  testimonial[field] = path;
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
  if (action === 'evidence-delete') {
    const path = buffer[button.dataset.field];
    if (path) unstageOrDeleteAsset(path);
    delete buffer[button.dataset.field];
  }
  if (action === 'copy-prompt') {
    await navigator.clipboard.writeText(productPrompt(buffer.name));
    showStatus('Prompt copied', 'The locked product-image prompt is ready to paste into edit/reference mode.');
    return;
  }
  render();
};

const saveCompany = (form) => {
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
  const data = new FormData(form);
  state.draft.config.heroHeadline = String(data.get('heroHeadline') || '').trim();
  state.draft.config.heroSub = String(data.get('heroSub') || '').trim();
  state.draft.config.seo.title = String(data.get('seoTitle') || '').trim();
  state.draft.config.seo.description = String(data.get('seoDescription') || '').trim();
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

const pollActions = async (commitSha) => {
  let run;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const runs = await state.api.listRuns(commitSha);
    if (runs.length) {
      [run] = runs;
      break;
    }
    await wait(3000);
  }
  if (!run) {
    showStatus('No workflow run found', 'The branch update succeeded, but no workflow run was found for this commit. This is expected until the deploy workflow is added in Phase 5.');
    return;
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const runs = await state.api.listRuns(commitSha);
    run = runs.find((candidate) => candidate.id === run.id) || run;
    if (run.status === 'completed') {
      if (run.conclusion === 'success') showStatus('Publish complete', 'The commit and site build succeeded. <a href="' + h(run.html_url) + '" target="_blank" rel="noreferrer">View run</a>.');
      else showStatus('Build failed', 'The commit was published, but GitHub Actions reported ' + h(run.conclusion) + '. <a href="' + h(run.html_url) + '" target="_blank" rel="noreferrer">View run</a>.');
      return;
    }
    showStatus('Site build in progress', 'GitHub Actions is building this commit. <a href="' + h(run.html_url) + '" target="_blank" rel="noreferrer">View run</a>.');
    await wait(3000);
  }
  showStatus('Site build still in progress', 'The workflow is still running after three minutes. <a href="' + h(run.html_url) + '" target="_blank" rel="noreferrer">View run</a>.');
};

const publish = async () => {
  if (state.publishing) return;
  if (state.editor) return showStatus('Open editor not saved', 'Save or cancel the open editor first.');
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
    clearTokens();
    showAuth('Your token expired. Reconnect to continue; the in-memory draft is preserved.');
    return;
  }
  const prefix = error instanceof ApiError && error.status ? 'GitHub returned ' + error.status + '. ' : '';
  showStatus('Request failed', h(prefix + error.message));
};

authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  const branch = branchInput.value.trim();
  if (!token || !branch) return;
  authenticate(token, rememberInput.checked, branch);
});

rememberInput.addEventListener('change', () => {
  storageWarning.hidden = !rememberInput.checked;
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
    if (event.target.dataset.evidenceField && event.target.files[0]) await uploadEvidence(event.target.dataset.evidenceField, event.target.files[0]);
    if (event.target.name === 'type' && state.editor?.kind === 'testimonials') {
      syncEditorFromForm();
      const testimonial = state.editor.buffer;
      if (testimonial.type === 'quote') {
        if (testimonial.beforeImage) unstageOrDeleteAsset(testimonial.beforeImage);
        if (testimonial.afterImage) unstageOrDeleteAsset(testimonial.afterImage);
        delete testimonial.beforeImage;
        delete testimonial.afterImage;
      }
      testimonial.placeholder = testimonial.type === 'quote';
      render();
    }
  } catch (error) {
    showStatus('Image could not be processed', h(error.message));
  }
});

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
  showStatus('Starting rebuild', 'Requesting the deploy workflow on ' + h(state.branch) + '.');
  try {
    await state.api.dispatchWorkflow();
    showStatus('Rebuild requested', 'GitHub accepted the workflow dispatch.');
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

document.querySelector('#logout-button').addEventListener('click', () => {
  if ((state.dirty.size || state.assetChanges.size) && !confirm('Log out and discard the in-memory draft?')) return;
  clearTokens();
  state.api = null;
  state.loaded = false;
  state.draft = {};
  state.dirty.clear();
  state.assetChanges.clear();
  showAuth('Logged out.');
});

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty.size && !state.assetChanges.size) return;
  event.preventDefault();
  event.returnValue = '';
});

branchInput.value = state.branch;
rememberInput.checked = Boolean(localStorage.getItem(TOKEN_LOCAL_KEY));
storageWarning.hidden = !rememberInput.checked;

const savedToken = currentToken();
if (savedToken) authenticate(savedToken, rememberInput.checked, state.branch);
else showAuth();
