import { ApiError, AuthError, BranchConflictError, GhApi } from './gh-api.js';
import { blobToBase64, cropEvidenceImage, redactImage, resizeFeedbackImage, resizeProductImage } from './image-tools.js';
import { createVault, forgetVault, unlockVault, vaultExists } from './vault.js';
import { apiBase, mountTraffic, STAFF_KEY } from './traffic.js';
import { createPageEditor } from './page-editor.js';
import { createTherapyEditor } from './therapy-editor.js';
import { createFilmsEditor } from './media-tools.js';
import { applyCompanyLocation, applySeoExtras, checkCompanyFields, companyFoundedField, companyHoursField, companyLanguagesField, companyLocationFields, seoExtrasFields, showErrors, showFieldErrors, showHoursReading } from './structured-data.js';
import { createFocusKeeper, firstFocusable, focusField, linkInlineErrors, stickyInsets, uploadTargets } from './a11y.js';
import { DataFileError } from './gh-api.js';
import { freePath, mergeFile, renameString, sameValue, stringsIn } from './draft-merge.js';
import { createBlogTab } from './blog-tab.js';

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
  solutions: 'data/solutions.json',
  treatment: 'data/treatment.json',
  films: 'data/films.json',
  feedback: 'data/feedback.json',
  company: 'data/company.json',
  config: 'data/site-config.json',
  themes: 'data/themes.json',
  content: 'data/content.json',
  blogConfig: 'data/blog/config.json',
  blogPosts: 'data/blog/posts.json',
};
const STAGES = [
  { key: 'before', label: 'Before therapy' },
  { key: 'during', label: 'During therapy' },
  { key: 'after', label: 'After therapy' },
];

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
  activeTab: 'traffic',
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
// Re-renders replace the panel; the keeper puts focus back (afterRender), and
// scroll-padding keeps a focused control clear of the header and bottom bars.
const focusKeeper = createFocusKeeper(editorRoot);
stickyInsets(document.querySelector('.app-header'), unsavedBar, publishStatus);

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
    // Added with the Blog tab (blog-tab.js and its components share this set).
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-9 9"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    desktop: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/>',
    sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    drag: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    more: '<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/>',
    warning: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  };
  // An unknown name draws nothing rather than the text "undefined".
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || '') + '</svg>';
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

// Both moon/sun toggles are on/off switches for dark mode, so screen readers
// hear "Dark mode, pressed" rather than a verb that never says which way.
const syncModeToggles = () => {
  const dark = String(document.documentElement.dataset.theme === 'dark');
  for (const toggle of document.querySelectorAll('#auth-theme-toggle, #theme-toggle')) toggle.setAttribute('aria-pressed', dark);
};

const setColorMode = (mode) => {
  document.documentElement.dataset.theme = mode;
  syncModeToggles();
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

// The status toast is an overlay sitting on top of the editor, so it must not
// outstay its welcome: it now carries a close button and clears itself after
// STATUS_DISMISS_MS. The one exception is a message carrying an action button —
// "Branch changed → reload and reapply" is the owner's recovery path out of a
// publish conflict, and a recovery path that disappears after seven seconds is
// worse than no recovery path at all. Those stay until dismissed.
const STATUS_DISMISS_MS = 7000;
let statusTimer = null;
let statusSticky = false;
let statusKey = '';

const stopStatusTimer = () => {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
};

// Re-arms both halves of the countdown — the timeout that actually dismisses and
// the bar that shows it coming. Restarting the CSS animation needs the class off,
// a reflow, then the class back on; without the reflow the browser coalesces the
// two class changes and the animation never replays.
const startStatusTimer = () => {
  stopStatusTimer();
  publishStatus.classList.remove('is-counting');
  if (statusSticky || publishStatus.hidden) return;
  // Refuse to arm while the owner is in the toast. Without this the pause holds
  // only until the next showStatus — and pollActions re-sends every five seconds
  // during a build, so a hovered or keyboard-focused toast would quietly restart
  // its countdown and vanish out from under them. pointerleave/focusout call this
  // again, which is when it actually arms.
  if (publishStatus.matches(':hover') || publishStatus.contains(document.activeElement)) return;
  void publishStatus.offsetWidth;
  publishStatus.classList.add('is-counting');
  statusTimer = setTimeout(clearStatus, STATUS_DISMISS_MS);
};

const showStatus = (title, message, options = {}) => {
  const key = JSON.stringify([title, message, options.action || '']);
  publishStatus.hidden = false;
  statusSticky = Boolean(options.action);
  // pollActions re-sends the same message every POLL_INTERVAL for as long as a
  // build runs. Rewriting the DOM on each identical one would restart the
  // countdown bar mid-sweep and pull focus off the close button, so an unchanged
  // message only re-arms the timer — which is what keeps a running build's toast
  // on screen instead of flickering every five seconds.
  if (key !== statusKey) {
    statusKey = key;
    publishStatus.innerHTML =
      '<button class="status-close" type="button" data-global-action="dismiss-status" aria-label="Dismiss this message">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<strong>' + h(title) + '</strong><p>' + message + '</p>' +
      (options.action ? '<button class="button button--quiet" type="button" data-global-action="' + h(options.action) + '">' + h(options.actionLabel) + '</button>' : '') +
      '<span class="status-countdown" aria-hidden="true"></span>';
  }
  startStatusTimer();
};

const clearStatus = () => {
  stopStatusTimer();
  statusKey = '';
  statusSticky = false;
  publishStatus.hidden = true;
  publishStatus.classList.remove('is-counting');
  publishStatus.replaceChildren();
};

// Reading a message should never race its own countdown: hovering or tabbing into
// the toast holds it, and leaving gives it the full seven seconds again rather
// than the remainder, so a message can't vanish the instant the pointer drifts off.
// Re-arming waits a tick rather than running inside the event: during pointerleave
// the toast can still match :hover, and during focusout document.activeElement has
// not settled off the old element yet. Re-arming synchronously would read that
// stale state, hit the "owner is still in here" guard above, refuse — and then
// nothing would be left to dismiss the toast at all.
const rearmStatusTimer = () => setTimeout(startStatusTimer, 0);
publishStatus.addEventListener('pointerenter', stopStatusTimer);
publishStatus.addEventListener('pointerleave', rearmStatusTimer);
publishStatus.addEventListener('focusin', stopStatusTimer);
publishStatus.addEventListener('focusout', rearmStatusTimer);

const sessionToken = () => sessionStorage.getItem(TOKEN_SESSION_KEY) || '';

// Background removal for recovery photos (traffic/worker.js POST /cutout).
const CUTOUT_ERRORS = { 401: 'Background cleaning needs a token that can publish.', 413: 'Photo too large to clean.', 429: 'Monthly background-cleaning allowance used up.' };
const requestCutout = async (blob) => {
  let response;
  try {
    response = await fetch(apiBase() + '/cutout', { method: 'POST', headers: { Authorization: 'Bearer ' + sessionToken(), 'Content-Type': blob.type }, body: blob, cache: 'no-store' });
  } catch {
    throw new Error('Background cleaning couldn’t be reached. Check the internet connection.');
  }
  if (!response.ok) throw new Error(CUTOUT_ERRORS[response.status] || 'Background cleaning failed.');
  return response.blob();
};

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

// `state.base` is the copy of each data file as last loaded from (or committed
// to) the branch. "Load their changes, keep mine" measures the owner's edits
// against it, so only what the owner actually changed is carried over.
const loadRepository = async () => {
  loadingState.hidden = false;
  editorRoot.replaceChildren();
  try {
    const ref = await state.api.getRef();
    const entries = await Promise.all(Object.entries(FILES).map(async ([key, path]) => {
      const result = await state.api.getJson(path);
      return [key, result];
    }));
    state.baseSha = ref.object.sha;
    state.draft = {};
    state.base = {};
    for (const [key, result] of entries) {
      state.draft[key] = result.data;
      state.base[key] = deepClone(result.data);
    }
    state.loaded = true;
    rebuildButton.disabled = false;
    state.dirty.clear();
    state.assetChanges.clear();
    state.editor = null;
  } finally {
    // The draft is only replaced once every file has arrived, so a failed
    // reload leaves it intact: put it back on screen instead of a blank editor
    // behind a spinner. A failed first load shows its own error (showLoadError).
    loadingState.hidden = true;
    render();
    renderUnsaved();
  }
};

// Only a token GitHub refuses, or one that cannot publish, is a sign-in
// problem. GitHub being down or rate limited, a dropped connection, or a damaged
// data file keeps the owner where they are, with a way to try again.
const isAuthProblem = (error) => error instanceof AuthError || error?.status === 401 ||
  (error?.status === 403 && !/rate limit/i.test(error.message));

const describeApiError = (error) => {
  if (error instanceof DataFileError) return 'The file ' + error.path + ' on GitHub has a mistake in it, so the admin can’t open it. Ask your developer to fix that file, then try again.';
  if (!(error instanceof ApiError)) return error?.message || 'Something unexpected went wrong.';
  if (error.status === 0) return 'Couldn’t reach GitHub. Check the internet connection, then try again.';
  if ((error.status === 403 || error.status === 429) && /rate limit/i.test(error.message)) return 'GitHub is limiting how often the admin can ask right now. Wait a few minutes, then try again.';
  if (error.status >= 500) return 'GitHub is having trouble right now (error ' + error.status + '). Wait a minute, then try again.';
  if (error.status === 404) return 'GitHub couldn’t find the site’s files on the “' + state.branch + '” branch.';
  return 'GitHub said: ' + error.message;
};

const showLoadError = (error, retry) => {
  loadingState.hidden = true;
  // Nothing to publish or rebuild until a token has been checked and content loaded.
  rebuildButton.disabled = true;
  renderUnsaved();
  editorRoot.innerHTML = '<div class="empty-state" role="alert" data-testid="load-error"><h2>The site content didn’t load</h2><p>' + h(describeApiError(error)) + '</p>' +
    '<button class="button button--primary" type="button" id="load-retry">Try again</button></div>';
  editorRoot.querySelector('#load-retry').addEventListener('click', () => {
    editorRoot.replaceChildren();
    loadingState.hidden = false;
    retry();
  }, { once: true });
};

// inApp: called on a page refresh with the session token, so there is no form
// on screen to show a GitHub outage in — it gets the in-app error with a retry.
// onValidated runs once the token is known to work (setup saves the vault there).
const connect = async (token, branch, options) => {
  const { busyButton, onAuthFailure, onValidated, inApp = false } = options;
  busyButton.disabled = true;
  setAuthStatus('Checking your access…');
  const api = new GhApi({ token, owner: OWNER, repo: REPO, branch });
  try {
    await api.validate();
  } catch (error) {
    busyButton.disabled = false;
    if (isAuthProblem(error)) {
      setAuthStatus(error.message);
      if (onAuthFailure) onAuthFailure(error);
    } else if (inApp) {
      showApp();
      showLoadError(error, () => connect(token, branch, options));
    } else {
      setAuthStatus(describeApiError(error));
    }
    return false;
  }
  busyButton.disabled = false;
  const canResumeDraft = state.loaded && state.branch === branch;
  state.api = api;
  state.branch = branch;
  localStorage.setItem(BRANCH_KEY, branch);
  sessionStorage.setItem(TOKEN_SESSION_KEY, token);
  localStorage.setItem(STAFF_KEY, '1');
  setAuthStatus('');
  rebuildButton.disabled = false;
  showApp();
  if (onValidated) await onValidated();
  if (canResumeDraft) {
    render();
    return true;
  }
  const load = async () => {
    try {
      await loadRepository();
    } catch (error) {
      if (error instanceof AuthError || error.status === 401) handleApiError(error);
      else showLoadError(error, load);
    }
  };
  await load();
  return true;
};

// The tab each data file was changed from, so the unsaved bar can name tabs
// rather than files (site-config.json is written by both Page and Appearance).
// draftWrites counts every write into the draft.
const dirtyTabs = new Map();
let draftWrites = 0;

const markDirty = (key) => {
  if (!state.dirty.has(key) || !dirtyTabs.has(key)) dirtyTabs.set(key, new Set());
  dirtyTabs.get(key).add(state.activeTab);
  draftWrites += 1;
  state.dirty.add(key);
  renderUnsaved();
};

// ------------------------------------------------------------ unsaved work
// Work that is not published yet lives in four places: the draft itself
// (state.dirty / state.assetChanges), an open item editor, the Page tab's
// working copy (page-editor.js), and typed Company / Appearance form values.
// hasUnsavedWork() covers all four; the unsaved bar, Lock, tab switching and
// beforeunload all go through it.

// Which tab edits each data file, for a change whose tab was not recorded.
const FILE_TABS = { products: 'products', protocols: 'protocols', testimonials: 'testimonials', solutions: 'solutions', treatment: 'treatment', films: 'films', feedback: 'voices', company: 'company', config: 'appearance', themes: 'appearance', content: 'page', blogConfig: 'blog', blogPosts: 'blog' };
const tabName = (tab) => tabNav.querySelector('[data-tab="' + tab + '"]')?.textContent.trim() || tab;

// Company and Appearance values are held per tab as they are typed, so a
// re-render (another tab, a theme click, the color mode) puts them back, the
// same way the Page tab keeps its working copy. `baseline` is the form as the
// draft renders it; the tab has unsaved edits while the two differ.
const FORM_TABS = { company: 'company-form', appearance: 'appearance-form' };
const formEdits = {};
// Typed-but-unsaved values carried over "Load their changes, keep mine": the
// controls the owner changed ({baseline, values} arrays), laid over the form as
// the reloaded draft renders it the next time that tab is shown.
const carriedForms = {};
const formControls = (form) => [...form.elements].filter((control) => control.name && !['button', 'submit', 'reset', 'file'].includes(control.type));
const formValues = (form) => JSON.stringify(formControls(form).map((control) => (control.type === 'checkbox' || control.type === 'radio' ? control.checked : control.value)));
const formHasEdits = (tab) => {
  const held = formEdits[tab];
  return Boolean(carriedForms[tab]) || Boolean(held && held.draft === state.draft && held.values !== held.baseline);
};
const typedFormEdits = (tab) => {
  if (carriedForms[tab]) return carriedForms[tab];
  const held = formEdits[tab];
  return held && held.draft === state.draft && held.values !== held.baseline
    ? { baseline: JSON.parse(held.baseline), values: JSON.parse(held.values) }
    : null;
};
const showFormDiscard = (form, tab) => {
  const discard = form.querySelector('[data-action="discard-form"]');
  if (discard) discard.hidden = !formHasEdits(tab);
};
const restoreFormEdits = (tab) => {
  const form = editorRoot.querySelector('#' + FORM_TABS[tab]);
  if (!form) return;
  const baseline = formValues(form);
  const held = formEdits[tab];
  const controls = formControls(form);
  let values = held && held.draft === state.draft && held.values !== baseline ? JSON.parse(held.values) : null;
  const carried = carriedForms[tab];
  delete carriedForms[tab];
  if (!values && carried && carried.values.length === controls.length) {
    // Only the controls the owner changed; everything else shows the reloaded draft.
    values = JSON.parse(baseline);
    carried.values.forEach((value, index) => { if (value !== carried.baseline[index]) values[index] = value; });
  }
  if (values && values.length === controls.length) {
    controls.forEach((control, index) => {
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = values[index];
      else control.value = values[index];
    });
    const hours = form.querySelector('[name="hours"]');
    if (hours) showHoursReading(hours, false);
    formEdits[tab] = { draft: state.draft, baseline, values: JSON.stringify(values) };
  } else {
    formEdits[tab] = { draft: state.draft, baseline, values: baseline };
  }
  showFormDiscard(form, tab);
};

// An open item editor has unsaved work when its form, its buffer, or the
// photos staged since it opened differ from how it started. The four editors
// app.js syncs are compared as they would be saved (their sync run on a copy),
// so a sync that changes nothing does not count.
const SYNCED_EDITORS = ['products', 'protocols', 'testimonials', 'solutions'];
const EDITOR_NOUNS = { products: 'product', protocols: 'protocol', testimonials: 'story', solutions: 'card', treatment: 'patient', films: 'video' };
const editorSnapshot = () => {
  const editor = state.editor;
  const form = editorRoot.querySelector('form');
  const live = editor.buffer;
  let buffer = live;
  if (form && SYNCED_EDITORS.includes(editor.kind)) {
    editor.buffer = deepClone(live);
    try {
      syncEditorFromForm();
      buffer = editor.buffer;
    } catch {
      buffer = live;
    } finally {
      editor.buffer = live;
    }
  }
  return JSON.stringify([buffer, form ? formValues(form) : '', Boolean(editor.media && editor.media.posterDirty)]);
};
const editorChanged = () => {
  const editor = state.editor;
  if (!editor || editor.baseline === undefined) return false;
  if (editorSnapshot() !== editor.baseline) return true;
  const before = editor.assetSnapshot;
  return state.assetChanges.size !== before.size || [...state.assetChanges].some(([path, change]) => before.get(path) !== change);
};

// Tabs with unsaved work, in tab-bar order.
const unsavedTabs = () => {
  const tabs = new Set();
  for (const key of state.dirty) {
    const recorded = dirtyTabs.get(key);
    for (const tab of (recorded && recorded.size ? recorded : [FILE_TABS[key]])) tabs.add(tab);
  }
  if (state.loaded) {
    if (editorChanged()) tabs.add(state.activeTab);
    if (pageEditor.hasUnsavedEdits()) tabs.add('page');
    for (const tab of Object.keys(FORM_TABS)) if (formHasEdits(tab)) tabs.add(tab);
  }
  return [...tabNav.querySelectorAll('[data-tab]')].map((button) => button.dataset.tab).filter((tab) => tabs.has(tab));
};
const hasUnsavedWork = () => Boolean(state.loaded && (state.assetChanges.size || unsavedTabs().length || blogTab.hasUnsavedDraft()));

// Typed Company / Appearance edits block a publish the way unsaved Page edits do.
const unsavedFormsBlock = () => {
  const tabs = Object.keys(FORM_TABS).filter(formHasEdits);
  if (!tabs.length) return null;
  if (pageEditor.hasUnsavedEdits()) tabs.unshift('page');
  const names = tabs.map(tabName);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  const message = names.length > 1
    ? 'Save or discard the edits on the ' + list + ' tabs before publishing.'
    : 'Save the ' + names[0].toLowerCase() + ' draft on the ' + names[0] + ' tab, or discard those edits, before publishing.';
  return { title: list + ' edits not saved', message, tab: tabs[0], tabName: names[0] };
};

// Closing an open editor throws its buffer away: ask first, but only when
// something in it changed. False when the owner chooses to stay.
const leaveEditor = () => {
  if (!state.editor) return true;
  if (editorChanged() && !confirm('Discard your unsaved edits to this ' + (EDITOR_NOUNS[state.editor.kind] || 'item') + '?')) return false;
  cancelEditor();
  return true;
};

// Runs at the end of every render().
const afterRender = () => {
  if (state.editor) {
    if (state.editor.baseline === undefined) state.editor.baseline = editorSnapshot();
  } else if (FORM_TABS[state.activeTab]) {
    restoreFormEdits(state.activeTab);
  }
  renderUnsaved();
  linkInlineErrors(editorRoot);
  focusKeeper.settle();
};

// Where the keyboard goes once an editor action re-renders the panel (the
// keeper settles it in afterRender): the same control on the row it moved to,
// the neighbour after a delete (then Add, or the upload), the first invalid
// field or else the saved row's Edit after Save, and after Cancel the row's
// Edit (Add, for a new item). Anything else returns to its re-rendered self.
// Opening an editor focuses the editor instead (openEditor).
const focusTargets = (button) => {
  const { action, kind, index, direction } = button.dataset;
  if (action === 'add' || action === 'edit') return null;
  const row = (name, at, extra = '') => '[data-action="' + name + '"]' + (kind ? '[data-kind="' + kind + '"]' : '') + '[data-index="' + at + '"]' + extra;
  const editAt = (list, at) => '[data-action="edit"][data-kind="' + list + '"][data-index="' + at + '"]';
  const addFor = (list) => '[data-action="add"][data-kind="' + list + '"]';
  const at = Number(index);
  if (/move$/.test(action)) {
    const to = at + Number(direction);
    return [row(action, to, '[data-direction="' + direction + '"]'), row(action, to, '[data-direction="' + -direction + '"]'), kind && editAt(kind, to)];
  }
  if (/delete$/.test(action) && index !== undefined) {
    return [row(action, at), row(action, at - 1), kind && addFor(kind), '[data-action="' + action.replace(/delete$/, 'add') + '"]', 'input[type="file"]'];
  }
  const editor = state.editor;
  if (action === 'save-editor' && editor) {
    return ['[aria-invalid="true"]', editAt(editor.kind, editor.index >= 0 ? editor.index : (state.draft[editor.kind] || []).length)];
  }
  if (action === 'back' && editor) return [editor.index >= 0 ? editAt(editor.kind, editor.index) : addFor(editor.kind)];
  if (action === 'stage-delete') return ['[data-stage-field="' + button.dataset.stage + '"]'];
  if (action === 'body-add' && editor) return ['[data-body-field="text"][data-body-index="' + (editor.buffer.body || []).length + '"]'];
  if (action === 'spec-add' && editor) return ['[data-spec-field="key"][data-spec-index="' + (editor.buffer.specs || []).length + '"]'];
  if (action === 'discard-form') return ['[data-action="save-' + button.dataset.formTab + '"]'];
  return null;
};

const renderUnsaved = () => {
  const changed = unsavedTabs().map(tabName);
  if (state.assetChanges.size) changed.push(state.assetChanges.size + ' file' + (state.assetChanges.size === 1 ? '' : 's') + ' to upload or delete');
  const isDirty = changed.length > 0;
  unsavedBar.hidden = !isDirty;
  dirtySummary.textContent = isDirty ? changed.join(' · ') : '';
  publishButton.disabled = !isDirty || state.publishing;
  barPublishButton.disabled = !isDirty || state.publishing;
};

// Icon buttons name the row they act on ("Move “Venous ulcers” up"), so a
// screen reader hears which item, not five identical "Delete" buttons.
const rowActions = (kind, index, length, canToggle = true, name = '') => {
  const item = '“' + h(String(name).trim() || 'item ' + (index + 1)) + '”';
  const visible = ((state.draft[kind] || [])[index] || {}).visible;
  const shown = kind === 'solutions' ? visible !== false : Boolean(visible);
  return '<div class="row-actions">' +
  '<button class="row-action" type="button" data-action="move" data-kind="' + kind + '" data-index="' + index + '" data-direction="-1" aria-label="Move ' + item + ' up" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button>' +
  '<button class="row-action" type="button" data-action="move" data-kind="' + kind + '" data-index="' + index + '" data-direction="1" aria-label="Move ' + item + ' down" ' + (index === length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button>' +
  (canToggle ? '<button class="row-action" type="button" data-action="toggle-visible" data-kind="' + kind + '" data-index="' + index + '" aria-label="Show ' + item + ' on the site" aria-pressed="' + String(shown) + '">' + icon('eye') + '</button>' : '') +
  '<button class="row-action row-action--text" type="button" data-action="edit" data-kind="' + kind + '" data-index="' + index + '" aria-label="Edit ' + item + '">Edit</button>' +
  '<button class="row-action" type="button" data-action="delete" data-kind="' + kind + '" data-index="' + index + '" aria-label="Delete ' + item + '">' + icon('trash') + '</button>' +
  '</div>';
};

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
    rowActions('products', index, items.length, true, product.name || product.id) + '</div>');
  return listPage('products', 'Products', 'Device details, specifications, images, order, and visibility.', rows, {
    notice: '<div class="notice">Products are currently archived from the public site. Everything here is kept and still saved when you publish, but none of it appears on the site until products return.</div>',
  });
};

const audienceLabel = (audience) => (audience === 'elderly' ? 'Bedridden & elderly' : 'Disease-specific');

const renderProtocolsList = () => {
  const items = state.draft.protocols;
  const rows = items.map((protocol, index) => '<div class="list-row" data-testid="protocol-row">' +
    '<div class="row-title"><strong>' + h(protocol.condition) + '</strong><span>' + h(protocol.id) + '</span></div>' +
    '<div class="row-meta">' + h(audienceLabel(protocol.audience)) + '</div>' +
    '<div class="status-badges"><span class="badge ' + (protocol.visible ? 'badge--active' : '') + '">' + (protocol.visible ? 'Visible' : 'Hidden') + '</span>' + (protocol.draft ? '<span class="badge badge--draft">Not ready</span>' : '') + '</div>' +
    rowActions('protocols', index, items.length, true, protocol.condition || protocol.id) + '</div>');
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
    rowActions('testimonials', index, items.length, false, testimonial.condition) + '</div>');
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

// Story ids carry no meaning (patients are anonymous) — they only name the
// evidence files, so the owner should never have to remember the sequence.
// Suggest the next free story-NNN; the field stays editable while the story is
// new and has no photographs, and saveEditor still rejects duplicates.
const storyPhotoPath = (id, stageKey) => 'assets/testimonials/' + id + '-' + stageKey + '.webp';

// Every photo path the stories in the draft list, except the one being edited.
// Uploading over one of these would overwrite another story's evidence, and
// deleting either story would then unstage the file both point at.
const storyPhotoPathsInUse = (skipIndex = null) => {
  const used = new Set();
  for (const [index, testimonial] of (state.draft.testimonials || []).entries()) {
    if (index !== skipIndex) for (const image of testimonial.images || []) used.add(image.src);
  }
  return used;
};

const nextStoryId = () => {
  const ids = new Set();
  let highest = 0;
  for (const testimonial of state.draft.testimonials || []) {
    ids.add(testimonial.id);
    const match = /^story-(\d+)$/.exec(testimonial.id || '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  // Pending uploads and deletes count too: a story deleted in this draft keeps
  // its photo names until the publish removes the files.
  const taken = new Set([...storyPhotoPathsInUse(), ...state.assetChanges.keys()]);
  for (let number = highest + 1; ; number += 1) {
    const id = 'story-' + String(number).padStart(3, '0');
    if (!ids.has(id) && !STAGES.some((stage) => taken.has(storyPhotoPath(id, stage.key)))) return id;
  }
};

const defaultTestimonial = () => ({
  id: nextStoryId(),
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

const defaultSolution = () => ({
  id: '',
  title: '',
  condition: '',
  visible: true,
  cta: { label: '', message: '' },
  body: [{ text: '' }],
  images: [],
});

const editorHeading = (kicker, title) => '<div class="editor-header"><div><p class="auth-kicker">' + h(kicker) + '</p><h1>' + h(title) + '</h1></div><button class="button button--quiet" type="button" data-action="back">Cancel</button></div>';

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
    '<div class="row-actions"><button class="row-action" type="button" data-action="spec-move" data-index="' + index + '" data-direction="-1" aria-label="Move specification ' + (index + 1) + ' up" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button><button class="row-action" type="button" data-action="spec-move" data-index="' + index + '" data-direction="1" aria-label="Move specification ' + (index + 1) + ' down" ' + (index === product.specs.length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button><button class="row-action" type="button" data-action="spec-delete" data-index="' + index + '" aria-label="Remove specification ' + (index + 1) + '">' + icon('trash') + '</button></div>' +
    '</div>').join('');
  const images = product.images.map((path, index) => '<div class="image-item">' + imagePreview(path) + '<code>' + h(path) + '</code><div class="row-actions"><button class="row-action" type="button" data-action="image-move" data-index="' + index + '" data-direction="-1" aria-label="Move photograph ' + (index + 1) + ' left" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button><button class="row-action" type="button" data-action="image-move" data-index="' + index + '" data-direction="1" aria-label="Move photograph ' + (index + 1) + ' right" ' + (index === product.images.length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button><button class="row-action" type="button" data-action="image-delete" data-index="' + index + '" aria-label="Remove photograph ' + (index + 1) + '">' + icon('trash') + '</button></div></div>').join('');
  return '<section class="editor-shell" data-testid="product-editor">' + editorHeading(isNew ? 'New product' : 'Edit product', product.name || 'Untitled product') +
    '<form id="product-form"><div class="editor-grid">' +
    '<label>Product name<input name="name" value="' + h(product.name) + '" required></label>' +
    '<label>Product reference<input name="id" value="' + h(product.id) + '" pattern="[a-z0-9\\-]+" required ' + (isNew && !hasStagedProductImage ? '' : 'readonly') + '><span class="field-help">' + (!isNew ? 'Set when this product was created. Its images are filed under it, so it stays fixed.' : hasStagedProductImage ? 'Its images are filed under it. Remove the new images to change it.' : 'Lowercase letters, numbers, and hyphens. Its images are filed under it.') + '</span></label>' +
    '<label>Tagline<input name="tagline" value="' + h(product.tagline) + '" required></label>' +
    '<label>Category<input name="category" value="' + h(product.category) + '" required></label>' +
    '<label>Model<input name="model" value="' + h(product.model || '') + '"></label>' +
    '<label>Source reference<input name="sourceId" value="' + h(product.sourceId || '') + '" ' + (isNew ? '' : 'readonly') + '>' + (isNew ? '' : '<span class="field-help">Set when this product was created.</span>') + '</label>' +
    '<label class="field--full">Description<textarea name="description" required>' + h(product.description) + '</textarea></label>' +
    '<label class="field--full">Conditions supported<textarea name="conditions" required>' + h(product.conditions.join('\n')) + '</textarea><span class="field-help">One condition per line.</span></label>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Specifications</h2><p>Add, reorder, or hide individual rows.</p></div><button class="button button--quiet" type="button" data-action="spec-add">Add row</button></div>' + specs + '</div>' +
    '<div class="field-group" data-rule-block="editor-images"><div class="field-group__heading"><div><h2>Product images</h2><p>Uploads are resized for the web, up to 1600 pixels on the longest side.</p></div></div><div class="image-list">' + images +
    '<label class="upload-control"><input type="file" id="product-images" accept="image/jpeg,image/png,image/webp" multiple><span>Upload one or more images</span><small>JPEG, PNG, or WebP · 20 MB each</small></label></div></div>' +
    '<div class="field-group"><div class="inline-fields"><label class="checkbox-row"><input name="catalogue" type="checkbox" ' + (product.catalogue ? 'checked' : '') + '><span>Generate catalogue</span></label><label class="checkbox-row"><input name="featured" type="checkbox" ' + (product.featured ? 'checked' : '') + '><span>Featured device</span></label><label class="checkbox-row"><input name="visible" type="checkbox" ' + (product.visible ? 'checked' : '') + '><span>Visible</span></label></div></div>' +
    (isNew ? '<aside class="prompt-card"><div class="field-group__heading"><div><h2>Locked product-image prompt</h2><p>Use edit/reference mode with the real device photo. Generate a 3:2 result, then upload it above.</p></div><button class="button button--quiet" type="button" data-action="copy-prompt">' + icon('copy') + ' Copy prompt</button></div><pre id="product-prompt">' + h(productPrompt(product.name)) + '</pre></aside>' : '') +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save product draft</button></div></form></section>';
};

const renderProtocolEditor = () => {
  const protocol = state.editor.buffer;
  const isNew = state.editor.index < 0;
  return '<section class="editor-shell" data-testid="protocol-editor">' + editorHeading(isNew ? 'New protocol' : 'Edit protocol', protocol.condition || 'Untitled protocol') +
    '<div class="notice notice--warning">Describe the service in general terms. Only mention pressures, frequencies, session counts, or week-by-week plans that the clinic actually uses.</div>' +
    '<form id="protocol-form"><div class="editor-grid">' +
    '<label>Condition or pathway<input name="condition" value="' + h(protocol.condition) + '" required><span class="field-help">This is the only text shown publicly, as one line in the conditions list.</span></label>' +
    '<label>Protocol reference<input name="id" value="' + h(protocol.id) + '" pattern="[a-z0-9\\-]+" required ' + (isNew ? '' : 'readonly') + '><span class="field-help">' + (isNew ? 'Lowercase letters, numbers, and hyphens, e.g. venous-ulcers. It can’t be changed later.' : 'Set when this protocol was created, so it stays fixed.') + '</span></label>' +
    '<label>Track<select name="audience"><option value="disease" ' + (protocol.audience === 'disease' ? 'selected' : '') + '>Disease-specific protocols</option><option value="elderly" ' + (protocol.audience === 'elderly' ? 'selected' : '') + '>Bedridden and elderly care</option></select></label>' +
    '<label>Duration note (internal)<input name="durationNote" value="' + h(protocol.durationNote) + '"><span class="field-help">Optional. Not shown on the site.</span></label>' +
    '<label class="field--full">Summary (internal)<textarea name="summary" required>' + h(protocol.summary) + '</textarea></label>' +
    '<label class="field--full">Engagement steps (internal)<textarea name="engagement">' + h((protocol.engagement || []).join('\n')) + '</textarea><span class="field-help">Optional. One step per line. Not shown on the site.</span></label>' +
    '<div class="field-group"><div class="inline-fields"><label class="checkbox-row"><input name="visible" type="checkbox" ' + (protocol.visible ? 'checked' : '') + '><span>Visible</span></label><label class="checkbox-row"><input name="draft" type="checkbox" ' + (protocol.draft ? 'checked' : '') + '><span>Not ready yet (kept off the site)</span></label></div></div>' +
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
  const hasStagedPhoto = (testimonial.images || []).some((image) => {
    const change = state.assetChanges.get(image.src);
    return change && !change.delete;
  });
  const idHelp = !isNew ? 'Set when this story was created. Its photos are filed under it, so it stays fixed.'
    : hasStagedPhoto ? 'Its photos are filed under it. Remove the new photos to change it.'
    : 'Suggested for you and safe to keep. The photographs are named after it, so it locks once you add one.';
  return '<section class="editor-shell" data-testid="testimonial-editor">' + editorHeading(isNew ? 'New recovery story' : 'Edit recovery story', testimonial.name || testimonial.condition || 'Untitled story') +
    '<div class="notice">Real patients only. Names are optional and patients stay anonymous by default; add a patient age to show “Patient aged N” on the card instead. With photographs, the clinical remark is required and the quote is optional; without photographs, the quote is required. Location and condition are always required.</div>' +
    '<form id="testimonial-form"><div class="editor-grid">' +
    '<label>Patient name (optional)<input name="name" value="' + h(testimonial.name || '') + '"><span class="field-help">Leave blank to keep the patient anonymous.</span></label>' +
    '<label>Patient age (optional)<input name="age" value="' + h(testimonial.age || '') + '" inputmode="numeric"><span class="field-help">Shown as “Patient aged N”. Leave blank to omit.</span></label>' +
    '<label>Story reference<input name="id" value="' + h(testimonial.id) + '" pattern="[a-z0-9\\-]+" required ' + (isNew && !hasStagedPhoto ? '' : 'readonly') + '><span class="field-help">' + idHelp + '</span></label>' +
    '<label>Location<input name="location" value="' + h(testimonial.location) + '" required></label>' +
    '<label class="field--full">Condition<input name="condition" value="' + h(testimonial.condition) + '" required><span class="field-help">Short clinical label shown on the card, e.g. “Venous ulcers from untreated varicose veins”. Do not put the age here.</span></label>' +
    '<label class="field--full">Recovery duration (optional)<input name="duration" value="' + h(testimonial.duration || '') + '" placeholder="e.g. Signs of recovery within 30 days"></label>' +
    '<label class="field--full">Clinical remark<textarea name="remark" rows="5">' + h(testimonial.remark || '') + '</textarea><span class="field-help">The company’s note on condition, treatment, and recovery, shown as the “Case note” on each story.</span></label>' +
    '<label class="field--full">Patient quote (optional with photographs)<textarea name="quote" rows="3">' + h(testimonial.quote || '') + '</textarea></label>' +
    '<div class="field-group" data-rule-block="editor-photos"><div class="field-group__heading"><div><h2>Evidence photographs</h2><p>Before and After are a pair: upload both or neither. During is optional and makes the story a 3-stage journey.</p></div></div><div class="stage-slots">' +
    STAGES.map((stage) => stageSlot(testimonial, stage)).join('') +
    '</div></div>' +
    '<div class="field-group"><label class="checkbox-row"><input name="featured" type="checkbox" ' + (testimonial.featured ? 'checked' : '') + '><span>Featured story <small class="field-help">Shown as the large journey at the top of Recoveries. Only one story can be featured.</small></span></label></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save story draft</button></div></form></section>';
};

const renderSolutionsList = () => {
  const items = state.draft.solutions || [];
  const rows = items.map((card, index) => '<div class="list-row" data-testid="solution-row">' +
    '<div class="row-title"><strong>' + h(card.title || 'Untitled card') + '</strong><span>' + h(card.id) + '</span></div>' +
    '<div class="row-meta">' + h(card.condition || '') + '</div>' +
    '<div class="status-badges"><span class="badge ' + (card.visible !== false ? 'badge--active' : '') + '">' + (card.visible !== false ? 'Visible' : 'Hidden') + '</span>' +
    ((card.images || []).length ? '<span class="badge">' + card.images.length + ' photo' + (card.images.length === 1 ? '' : 's') + '</span>' : '<span class="badge badge--draft">No photos</span>') + '</div>' +
    rowActions('solutions', index, items.length, true, card.title || 'Untitled card') + '</div>');
  return listPage('solutions', 'Solutions', 'Condition galleries shown in “Complications we manage”. Each card has its own text, button, and photographs.', rows, { itemLabel: 'condition card' });
};

const renderSolutionEditor = () => {
  const card = state.editor.buffer;
  const isNew = state.editor.index < 0;
  const hasStagedImage = (card.images || []).some((image) => {
    const change = state.assetChanges.get(image.src);
    return change && !change.delete;
  });
  const body = (card.body || []).map((paragraph, index) => '<div class="repeat-row repeat-row--body">' +
    '<textarea aria-label="Paragraph ' + (index + 1) + '" data-body-index="' + index + '" data-body-field="text" rows="3" placeholder="Paragraph text">' + h(paragraph.text || '') + '</textarea>' +
    '<label class="checkbox-row"><input type="checkbox" data-body-index="' + index + '" data-body-field="warn" ' + (paragraph.variant === 'warn' ? 'checked' : '') + '><span>Warning</span></label>' +
    '<div class="row-actions"><button class="row-action" type="button" data-action="body-move" data-index="' + index + '" data-direction="-1" aria-label="Move paragraph ' + (index + 1) + ' up" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button><button class="row-action" type="button" data-action="body-move" data-index="' + index + '" data-direction="1" aria-label="Move paragraph ' + (index + 1) + ' down" ' + (index === card.body.length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button><button class="row-action" type="button" data-action="body-delete" data-index="' + index + '" aria-label="Remove paragraph ' + (index + 1) + '">' + icon('trash') + '</button></div>' +
    '</div>').join('');
  const images = (card.images || []).map((image, index) => '<div class="image-item">' + imagePreview(image.src, true) + '<code>' + h(image.src) + '</code><div class="row-actions"><button class="row-action" type="button" data-action="image-move" data-index="' + index + '" data-direction="-1" aria-label="Move photograph ' + (index + 1) + ' left" ' + (index === 0 ? 'disabled' : '') + '>' + icon('up') + '</button><button class="row-action" type="button" data-action="image-move" data-index="' + index + '" data-direction="1" aria-label="Move photograph ' + (index + 1) + ' right" ' + (index === card.images.length - 1 ? 'disabled' : '') + '>' + icon('down') + '</button><label class="row-action row-action--text">Replace<input type="file" data-replace-image="' + index + '" accept="image/jpeg,image/png,image/webp" aria-label="Replace photograph ' + (index + 1) + '"></label><button class="row-action" type="button" data-action="image-delete" data-index="' + index + '" aria-label="Remove photograph ' + (index + 1) + '">' + icon('trash') + '</button></div></div>').join('');
  return '<section class="editor-shell" data-testid="solution-editor">' + editorHeading(isNew ? 'New condition card' : 'Edit condition card', card.title || 'Untitled card') +
    '<div class="notice">The card’s text, button, and photo order are all set here. Photographs are cropped to 4:5 and carry the “MediVasc” watermark, exactly like recovery evidence.</div>' +
    '<form id="solution-form"><div class="editor-grid">' +
    '<label>Card title<input name="title" value="' + h(card.title) + '" required></label>' +
    '<label>Card reference<input name="id" value="' + h(card.id) + '" pattern="[a-z0-9\\-]+" required ' + (isNew && !hasStagedImage ? '' : 'readonly') + '><span class="field-help">' + (!isNew ? 'Set when this card was created. Its photos are filed under it, so it stays fixed.' : hasStagedImage ? 'Its photos are filed under it. Remove the new photos to change it.' : 'Lowercase letters, numbers, and hyphens. Its photos are filed under it.') + '</span></label>' +
    '<label class="field--full">Carousel label (condition)<input name="condition" value="' + h(card.condition) + '" required><span class="field-help">Announced to screen readers on the photo carousel, e.g. “Post-mastectomy arm lymphedema”.</span></label>' +
    '<label>Button label<input name="ctaLabel" value="' + h(card.cta ? card.cta.label : '') + '" required></label>' +
    '<label class="field--full">Button message<textarea name="ctaMessage" required>' + h(card.cta ? card.cta.message : '') + '</textarea><span class="field-help">Pre-filled in WhatsApp or email when a visitor taps the button.</span></label>' +
    '<div class="field-group" data-rule-block="editor-body"><div class="field-group__heading"><div><h2>Body paragraphs</h2><p>Shown above the gallery. Mark one “Warning” for the cautionary styling.</p></div><button class="button button--quiet" type="button" data-action="body-add">Add paragraph</button></div>' + body + '</div>' +
    '<div class="field-group" data-rule-block="editor-images"><div class="field-group__heading"><div><h2>Case photographs</h2><p>Uploads are cropped to 4:5, watermarked, and downscaled, on the clean gray backdrop unless you switch it off. Reorder with the arrows; Replace swaps a photo in place.</p></div></div><div class="image-list">' + images +
    '<label class="upload-control"><input type="file" id="solution-images" accept="image/jpeg,image/png,image/webp" multiple><span>Upload one or more photographs</span><small>JPEG, PNG, or WebP · 20 MB each</small></label></div></div>' +
    '<div class="field-group"><label class="checkbox-row"><input name="visible" type="checkbox" ' + (card.visible !== false ? 'checked' : '') + '><span>Visible on the site</span></label></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="back">Cancel</button><button class="button button--primary" type="button" data-action="save-editor">Save card draft</button></div></form></section>';
};

const renderVoices = () => {
  const items = state.draft.feedback || [];
  const cards = items.map((item, index) => '<div class="voice-item" data-testid="voice-row">' + imagePreview(item.src) +
    '<div class="row-actions"><button class="row-action" type="button" data-action="voice-move" data-index="' + index + '" data-direction="-1" aria-label="Move screenshot ' + (index + 1) + ' left" ' + (index === 0 ? 'disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7l-5 5 5 5"/></svg></button><button class="row-action" type="button" data-action="voice-move" data-index="' + index + '" data-direction="1" aria-label="Move screenshot ' + (index + 1) + ' right" ' + (index === items.length - 1 ? 'disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5"/></svg></button><button class="row-action" type="button" data-action="voice-delete" data-index="' + index + '" aria-label="Delete screenshot ' + (index + 1) + '">' + icon('trash') + '</button></div></div>');
  const gallery = items.length
    ? '<div class="voice-grid" data-testid="voices-list">' + cards.join('') + '</div>'
    : '<div class="empty-state"><h2>No patient messages yet</h2><p>Upload the first chat screenshot to begin. You will blur identifying details before it is saved.</p></div>';
  return '<section><div class="section-toolbar"><div><h1>Voices</h1><p>Patient-message screenshots for “In their words”. The order here is the order shown; earlier cards are seen first.</p></div></div>' +
    '<div class="notice notice--warning">You blur every screenshot as you upload it: cover the profile photo, saved contact name, and any phone number before saving. The blur is permanent.</div>' +
    gallery +
    '<label class="upload-control upload-control--wide"><input type="file" id="voice-images" accept="image/jpeg,image/png,image/webp" multiple><span>Add message screenshots</span><small>JPEG, PNG, or WebP · 20 MB each · you will blur each one</small></label>' +
    '</section>';
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
    companyHoursField(company, h) +
    '<label class="field--full">Address<input name="address" value="' + h(company.address) + '"></label>' +
    '<label class="field--full">Google Maps URL<input name="mapsUrl" type="url" value="' + h(company.mapsUrl) + '"></label>' +
    companyFoundedField(company, h) +
    companyLanguagesField(company, h) +
    companyLocationFields(company, h) +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Social profiles</h2><p>Leave unused channels blank.</p></div></div><div class="editor-grid"><label>X (Twitter)<input name="x" type="url" value="' + h(company.social.x) + '"></label><label>LinkedIn<input name="linkedin" type="url" value="' + h(company.social.linkedin) + '"></label><label>Instagram<input name="instagram" type="url" value="' + h(company.social.instagram) + '"></label><label>Facebook<input name="facebook" type="url" value="' + h(company.social.facebook) + '"></label><label>YouTube<input name="youtube" type="url" value="' + h(company.social.youtube) + '"></label></div></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="discard-form" data-form-tab="company" hidden>Discard changes</button><button class="button button--primary" type="button" data-action="save-company">Save company draft</button></div></form></section>';
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
  return '<section class="editor-shell"><div class="section-toolbar"><div><h1>Appearance</h1><p>Site theme, search listing, and this admin’s color mode. Hero copy is on the Page tab.</p></div></div>' +
    '<form id="appearance-form"><div class="editor-grid">' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Site theme</h2><p>Each theme has a light and a dark version; the preview follows this admin’s color mode.</p></div></div><div class="theme-grid">' + themes + '</div></div>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Admin color mode</h2><p>Only affects this editor on this device.</p></div></div><div class="mode-toggle"><button class="button ' + (colorMode === 'light' ? 'button--primary' : 'button--quiet') + '" type="button" data-action="set-color-mode" data-mode="light" aria-pressed="' + String(colorMode === 'light') + '">Light</button><button class="button ' + (colorMode === 'dark' ? 'button--primary' : 'button--quiet') + '" type="button" data-action="set-color-mode" data-mode="dark" aria-pressed="' + String(colorMode === 'dark') + '">Dark</button></div></div>' +
    '<div class="field-group"><div class="field-group__heading"><div><h2>Search listing</h2><p>Keep title and description specific and concise. The lists below feed the site’s business listing for search engines.</p></div></div><div class="editor-grid"><label class="field--full">SEO title<input name="seoTitle" value="' + h(config.seo.title) + '" required></label><label class="field--full">SEO description<textarea name="seoDescription" required>' + h(config.seo.description) + '</textarea></label>' + seoExtrasFields(config.seo, h) + '</div></div>' +
    '</div><div class="form-actions"><button class="button button--quiet" type="button" data-action="discard-form" data-form-tab="appearance" hidden>Discard changes</button><button class="button button--primary" type="button" data-action="save-appearance">Save appearance draft</button></div></form></section>';
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
  else if (state.editor?.kind === 'solutions') html = renderSolutionEditor();
  else if (state.editor?.kind === 'treatment') html = therapyEditor.renderEditor();
  else if (state.editor?.kind === 'films') html = filmsEditor.renderEditor();
  else if (state.activeTab === 'products') html = renderProductsList();
  else if (state.activeTab === 'protocols') html = renderProtocolsList();
  else if (state.activeTab === 'testimonials') html = renderTestimonialsList();
  else if (state.activeTab === 'solutions') html = renderSolutionsList();
  else if (state.activeTab === 'treatment') html = therapyEditor.renderList();
  else if (state.activeTab === 'films') html = filmsEditor.renderList();
  else if (state.activeTab === 'voices') html = renderVoices();
  else if (state.activeTab === 'company') html = renderCompany();
  else if (state.activeTab === 'traffic') html = '<div id="traffic-root"></div>';
  else if (state.activeTab === 'page') html = pageEditor.render();
  else if (state.activeTab === 'blog') html = '';
  else html = renderAppearance();
  focusKeeper.hold();
  editorRoot.innerHTML = html;
  filmsEditor.mount(editorRoot);
  if (!state.editor && state.activeTab === 'traffic') mountTraffic(editorRoot.querySelector('#traffic-root'), sessionToken());
  if (!state.editor && state.activeTab === 'page') pageEditor.mount();
  if (!state.editor && state.activeTab === 'blog') blogTab.mount(editorRoot);
  applyThemeTokens();
  afterRender();
};

// The Page tab (admin/page-editor.js) wires its own input/click listeners on
// editorRoot, guarded to that tab; app.js only routes render and publish to it.
const pageEditor = createPageEditor({ state, root: editorRoot, h, icon, markDirty, showStatus, rerender: () => render() });

const openEditor = (kind, index) => {
  const defaults = { products: defaultProduct, protocols: defaultProtocol, testimonials: defaultTestimonial, solutions: defaultSolution, treatment: therapyEditor.blank, films: filmsEditor.blank };
  state.editor = {
    kind,
    index,
    buffer: index < 0 ? defaults[kind]() : deepClone(state.draft[kind][index]),
    assetSnapshot: new Map(state.assetChanges),
    previewSnapshot: new Map(state.assetPreviews),
  };
  render();
  document.querySelector('#admin-main').focus();
};

const cancelEditor = () => {
  if (!state.editor) return;
  state.assetChanges = state.editor.assetSnapshot;
  // Previews go back with the assets: a photo replaced in place during this edit
  // must not keep showing its new bytes once the old ones are restored.
  const kept = new Set(state.editor.previewSnapshot.values());
  for (const url of state.assetPreviews.values()) if (!kept.has(url)) URL.revokeObjectURL(url);
  state.assetPreviews = state.editor.previewSnapshot;
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
    // A key the saved product never had is written only once the owner gives it a
    // value, so an untouched save doesn't add `"model": ""` to products without one.
    // Keys it already had keep today's behaviour, including being cleared.
    const original = state.editor.index < 0 ? null : state.draft.products[state.editor.index];
    const put = (key, value) => {
      if (!original || key in original || (Array.isArray(value) ? value.length : value)) buffer[key] = value;
      else delete buffer[key];
    };
    for (const key of ['id', 'name', 'tagline', 'category', 'model', 'sourceId', 'description']) put(key, String(data.get(key) || '').trim());
    put('conditions', lines(data.get('conditions')));
    put('catalogue', data.has('catalogue'));
    put('featured', data.has('featured'));
    put('visible', data.has('visible'));
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
  } else if (state.editor.kind === 'solutions') {
    for (const key of ['id', 'title', 'condition']) buffer[key] = String(data.get(key) || '').trim();
    buffer.cta = { label: String(data.get('ctaLabel') || '').trim(), message: String(data.get('ctaMessage') || '').trim() };
    buffer.visible = data.has('visible');
    for (const input of form.querySelectorAll('[data-body-index]')) {
      const paragraph = buffer.body[Number(input.dataset.bodyIndex)];
      if (!paragraph) continue;
      if (input.dataset.bodyField === 'warn') {
        if (input.checked) paragraph.variant = 'warn';
        else delete paragraph.variant;
      } else {
        paragraph.text = input.value;
      }
    }
  } else {
    for (const key of ['id', 'name', 'age', 'location', 'condition', 'duration', 'remark', 'quote']) buffer[key] = String(data.get(key) || '').trim();
    buffer.featured = data.has('featured');
  }
};

// A story's photographs in stage order (Before, During, After).
const storyImagesInOrder = (buffer) => STAGES.map((stage) => imageForStage(buffer, stage.key)).filter(Boolean);

// Each list editor's save rules, as [{ path, message }]: the path names the form
// field (or the photo / paragraph block, "editor-<path>") the message belongs
// under. saveEditor refuses the save while any remain.
const editorErrors = (kind, index, buffer) => {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!buffer.id || !/^[a-z0-9-]+$/.test(buffer.id)) add('id', 'The reference can only use lowercase letters, numbers, and hyphens.');
  else if (state.draft[kind].some((item, itemIndex) => item.id === buffer.id && itemIndex !== index)) add('id', 'Another item already uses that reference. Choose a different one.');
  if (kind === 'products') {
    if (!buffer.name) add('name', 'Add the product name.');
    if (!buffer.tagline) add('tagline', 'Add the tagline.');
    if (!buffer.category) add('category', 'Add the category.');
    if (!buffer.description) add('description', 'Add the description.');
    if (!buffer.conditions.length) add('conditions', 'Add at least one supported condition.');
    if (!buffer.images.length) add('images', 'Add at least one product image.');
  }
  if (kind === 'protocols') {
    if (!buffer.condition) add('condition', 'Add the condition.');
    if (!buffer.summary) add('summary', 'Add the summary.');
    if (!['disease', 'elderly'].includes(buffer.audience)) add('audience', 'Choose one of the two tracks.');
  }
  if (kind === 'testimonials') {
    if (!buffer.location) add('location', 'Location is required on every story.');
    if (!buffer.condition) add('condition', 'Condition is required on every story.');
    const byStage = Object.fromEntries(STAGES.map((stage) => [stage.key, imageForStage(buffer, stage.key)]));
    const count = (buffer.images || []).length;
    if (count === 1) add('photos', 'A single photograph is not evidence of change: add both Before and After, or remove it.');
    else if (count > 0 && (!byStage.before || !byStage.after)) add('photos', 'Photograph stories need the Before and After pair. During is optional.');
    if (!count && !buffer.quote) add('quote', 'Without photographs, the patient quote is required.');
    if (count && !buffer.remark) add('remark', 'Stories with photographs need the clinical remark.');
    if (buffer.featured && count !== 3 && !errors.some((error) => error.path === 'photos')) {
      add('photos', 'The featured story fills the hero’s three-up strip, so it needs all three photographs: Before, During, and After.');
    }
    const wasFeatured = index >= 0 && state.draft.testimonials[index].featured;
    const othersFeatured = state.draft.testimonials.some((testimonial, itemIndex) => itemIndex !== index && testimonial.featured);
    if (wasFeatured && !buffer.featured && !othersFeatured) {
      add('featured', 'One story must stay featured to anchor the hero. Feature another story first, then remove this one from featured.');
    }
  }
  if (kind === 'solutions') {
    if (!buffer.title) add('title', 'The card needs a title.');
    if (!buffer.condition) add('condition', 'The card needs a carousel label.');
    if (!buffer.cta || !buffer.cta.label) add('ctaLabel', 'The card needs a button label.');
    if (!buffer.cta || !buffer.cta.message) add('ctaMessage', 'The card needs a button message.');
    if (!solutionBody(buffer).length) add('body', 'Add at least one body paragraph.');
    if (buffer.visible && !buffer.images.length) add('images', 'A visible card needs at least one photograph. Add a photo, or untick Visible.');
  }
  return errors;
};

// A card's paragraphs as saved: trimmed, blank ones dropped.
const solutionBody = (buffer) => (buffer.body || [])
  .map((paragraph) => (paragraph.variant === 'warn' ? { text: String(paragraph.text || '').trim(), variant: 'warn' } : { text: String(paragraph.text || '').trim() }))
  .filter((paragraph) => paragraph.text);

// Shows editorErrors in place (structured-data.js showFieldErrors / showErrors,
// the Company and Appearance pattern), focuses the first one, and names them
// in the toast.
const EDITOR_BLOCKS = ['photos', 'body', 'images'];
const showEditorErrors = (kind, errors) => {
  const form = editorRoot.querySelector('form');
  const fieldErrors = errors.filter((error) => !EDITOR_BLOCKS.includes(error.path));
  showFieldErrors(form, 'editor', fieldErrors, (path) => path, { focus: false });
  for (const block of EDITOR_BLOCKS) {
    showErrors(form, 'editor-' + block, errors.filter((error) => error.path === block), () => null, { focus: false, blockControl: firstFocusable });
  }
  const first = form.querySelector('[aria-invalid="true"], [data-rule-block^="editor-"] > .inline-error');
  const target = first?.matches('.inline-error') ? firstFocusable(first.closest('[data-rule-block]')) : first;
  showStatus('Could not save the ' + (EDITOR_NOUNS[kind] || 'item'), errors.map((error) => h(error.message)).join('<br>'));
  if (target) focusField(target);
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
  const errors = editorErrors(kind, index, buffer);
  if (errors.length) {
    showEditorErrors(kind, errors);
    return;
  }
  if (kind === 'products') buffer.specs = buffer.specs.filter((spec) => spec.key && spec.value);
  if (kind === 'testimonials') {
    buffer.images = storyImagesInOrder(buffer);
    if (buffer.featured) {
      for (const [itemIndex, item] of state.draft.testimonials.entries()) {
        if (itemIndex !== index && item.featured) {
          item.featured = false;
          showStatus('Featured story moved', h(item.condition + ' is no longer featured. Only one story can be.'));
        }
      }
    }
  }
  if (kind === 'solutions') buffer.body = solutionBody(buffer);
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
  if (!confirm('Delete ' + (item.name || item.title || item.condition || item.id) + '? This will be included in the next publish.')) return;
  if (kind === 'products') for (const path of item.images) unstageOrDeleteAsset(path);
  if (kind === 'testimonials') for (const image of item.images || []) unstageOrDeleteAsset(image.src);
  if (kind === 'solutions') for (const image of item.images || []) unstageOrDeleteAsset(image.src);
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

// Asset states per path: committed (no entry) | new upload ({content}) |
// committed file replaced in place ({content, replaces}) | pending delete
// ({delete}). Uploading over a pending delete or a replacement keeps `replaces`,
// so removing that photo later deletes the committed file instead of only
// dropping the staged bytes (which would orphan it in the repository).
// An object URL the open editor's snapshot still holds outlives the edit (Cancel
// restores it); any other superseded preview is released at once.
const releasePreview = (url) => {
  if (url && !(state.editor && [...state.editor.previewSnapshot.values()].includes(url))) URL.revokeObjectURL(url);
};

// Encoding is the slow half of staging (most of a second for a 25 MB clip, far
// longer on a phone) and writes nothing. stageEncoded then records the change
// synchronously, so an upload flow checks its editor is still open (not
// cancelled, saved, or left for another tab) in between, and a closed editor's
// upload never lands in the draft it restored.
const encodeBlob = async (blob) => ({ blob, content: await blobToBase64(blob) });

const stageEncoded = (path, { blob, content }) => {
  const prior = state.assetChanges.get(path);
  releasePreview(state.assetPreviews.get(path));
  state.assetPreviews.set(path, URL.createObjectURL(blob));
  const change = { path, content, encoding: 'base64' };
  if (prior && (prior.delete || prior.replaces)) change.replaces = true;
  state.assetChanges.set(path, change);
  renderUnsaved();
};

const stageBlob = async (path, blob) => stageEncoded(path, await encodeBlob(blob));

const unstageOrDeleteAsset = (path) => {
  const staged = state.assetChanges.get(path);
  if (staged && !staged.delete) {
    if (staged.replaces) state.assetChanges.set(path, { delete: true });
    else state.assetChanges.delete(path);
    releasePreview(state.assetPreviews.get(path));
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
  if (!product.id || !/^[a-z0-9-]+$/.test(product.id)) throw new Error('Enter a product reference (lowercase letters, numbers, and hyphens) before uploading images.');
  const duplicate = state.draft.products.some((item, index) => item.id === product.id && index !== state.editor.index);
  if (duplicate) throw new Error('Another product already uses this reference. Choose a different one before uploading images.');
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
  const editor = state.editor;
  const testimonial = editor.buffer;
  if (!testimonial.id || !/^[a-z0-9-]+$/.test(testimonial.id)) throw new Error('Enter a story reference (lowercase letters, numbers, and hyphens) before uploading photographs.');
  const duplicate = state.draft.testimonials.some((item, index) => item.id === testimonial.id && index !== editor.index);
  if (duplicate) throw new Error('Another story already uses this reference. Choose a different one before uploading photographs.');
  const stage = STAGES.find((candidate) => candidate.key === stageKey);
  const path = storyPhotoPath(testimonial.id, stage.key);
  if (storyPhotoPathsInUse(editor.index).has(path)) throw new Error('Photographs named “' + testimonial.id + '” already belong to another story. Choose a different story reference before uploading.');
  const blob = await cropEvidenceImage(file, stage.key, { cutout: requestCutout });
  if (!blob || state.editor !== editor) return;
  const encoded = await encodeBlob(blob);
  if (state.editor !== editor) return;
  const existing = imageForStage(testimonial, stage.key);
  if (existing) unstageOrDeleteAsset(existing.src);
  stageEncoded(path, encoded);
  testimonial.images = (testimonial.images || []).filter((image) => stageKeyOf(image) !== stage.key);
  testimonial.images.push({ src: path, stage: stage.label });
  render();
};

// Existing srcs (from the manifest) plus every path already staged this session,
// so a fresh upload never collides with a pending add or a pending delete.
const usedGalleryPaths = (srcs) => {
  const used = new Set(srcs);
  for (const path of state.assetChanges.keys()) used.add(path);
  return used;
};

const nextGalleryPath = (dir, prefix, used) => {
  let number = 1;
  let path;
  do {
    path = dir + '/' + prefix + '-' + String(number).padStart(2, '0') + '.webp';
    number += 1;
  } while (used.has(path));
  return path;
};

// A multi-file upload carries on past a file it can't read; when the batch
// ends, one message names every file left out and why.
const reportSkippedFiles = (skipped) => {
  if (!skipped.length) return;
  showStatus(skipped.length === 1 ? 'One file was not added' : skipped.length + ' files were not added',
    skipped.map(({ name, reason }) => h(name) + ': ' + h(reason)).join('<br>'));
};

// In therapy (therapy-editor.js) and Videos (media-tools.js) own their list,
// editor and uploads; app.js only hands them the shared draft helpers.
const editorContext = {
  state, h, icon, render, markDirty, showStatus, rowActions, listPage, editorHeading, imagePreview,
  committedAssetUrl, stageBlob, encodeBlob, stageEncoded, unstageOrDeleteAsset, usedGalleryPaths, nextGalleryPath,
  reportSkippedFiles, requestCutout,
};
const therapyEditor = createTherapyEditor(editorContext);
const filmsEditor = createFilmsEditor(editorContext);
// The Blog tab (blog-tab.js) keeps its own DOM and events; it reaches the shared
// draft through these helpers and commits through publish() below.
const blogTab = createBlogTab({
  state, h, icon, markDirty, showStatus, stageBlob, committedAssetUrl, renderUnsaved, apiBase, sessionToken,
  clearDirty: (key) => { state.dirty.delete(key); dirtyTabs.delete(key); renderUnsaved(); },
  // Only a still-staged file is dropped; a committed photo is left in the repo.
  unstageAsset: (path) => { const staged = state.assetChanges.get(path); if (staged && !staged.delete) unstageOrDeleteAsset(path); },
  otherUnsavedTabs: () => unsavedTabs().filter((tab) => tab !== 'blog').map(tabName),
  publish: (options) => publish(options),
});

const uploadSolutionImages = async (files) => {
  syncEditorFromForm();
  const editor = state.editor;
  const card = editor.buffer;
  if (!card.id || !/^[a-z0-9-]+$/.test(card.id)) throw new Error('Enter a card reference (lowercase letters, numbers, and hyphens) before uploading photographs.');
  const duplicate = state.draft.solutions.some((item, index) => item.id === card.id && index !== editor.index);
  if (duplicate) throw new Error('Another card already uses this reference. Choose a different one before uploading photographs.');
  const used = usedGalleryPaths((state.draft.solutions || []).flatMap((item) => (item.images || []).map((image) => image.src)));
  const skipped = [];
  try {
    for (const file of files) {
      let encoded = null;
      try {
        const blob = await cropEvidenceImage(file, card.condition || 'before and after', { cutout: requestCutout });
        if (blob && state.editor === editor) encoded = await encodeBlob(blob);
      } catch (error) {
        skipped.push({ name: file.name, reason: error.message });
      }
      if (state.editor !== editor) return; // the card was cancelled, saved, or left mid-upload
      if (!encoded) continue; // crop cancelled, or the file could not be read
      const path = nextGalleryPath('assets/solutions', card.id, used);
      used.add(path);
      stageEncoded(path, encoded);
      card.images.push({ src: path });
    }
  } finally {
    if (state.editor === editor) {
      render();
      reportSkippedFiles(skipped);
    }
  }
};

// Replace keeps the photo's place in the gallery and its file path: the new
// bytes are staged over the same path (a committed file becomes a replacement,
// see stageBlob), and the preview switches to the staged object URL.
const replaceSolutionImage = async (index, file) => {
  syncEditorFromForm();
  const editor = state.editor;
  const card = editor.buffer;
  const image = (card.images || [])[index];
  if (!image) return;
  const blob = await cropEvidenceImage(file, card.condition || 'before and after', { cutout: requestCutout });
  if (!blob || state.editor !== editor) return;
  const encoded = await encodeBlob(blob);
  if (state.editor !== editor) return;
  unstageOrDeleteAsset(image.src);
  stageEncoded(image.src, encoded);
  render();
};

const uploadVoiceImages = async (files) => {
  if (!Array.isArray(state.draft.feedback)) state.draft.feedback = [];
  // Voices has no editor to cancel. A screenshot is stale only once the draft is
  // replaced (Lock, reload) or a publish has begun: it would be dropped, or listed
  // in feedback.json without its file. Leaving the tab stops the batch, so the
  // next redaction never opens over another screen.
  const draft = state.draft;
  const live = () => state.draft === draft && !state.publishing;
  const onVoices = () => live() && state.activeTab === 'voices';
  const used = usedGalleryPaths(draft.feedback.map((item) => item.src));
  const skipped = [];
  try {
    for (const file of files) {
      if (!onVoices()) return;
      let encoded = null;
      try {
        const resized = await resizeFeedbackImage(file);
        const redacted = onVoices() && await redactImage(resized, 'patient message', { cutout: requestCutout, cleanDefault: false });
        if (redacted && live()) encoded = await encodeBlob(redacted);
      } catch (error) {
        skipped.push({ name: file.name, reason: error.message });
      }
      if (!live()) return;
      if (!encoded) continue; // redaction cancelled, or the file could not be read
      const path = nextGalleryPath('assets/feedback', 'feedback', used);
      used.add(path);
      stageEncoded(path, encoded);
      draft.feedback.push({ src: path });
      markDirty('feedback');
    }
  } finally {
    if (onVoices()) {
      render();
      reportSkippedFiles(skipped);
    }
  }
};

const deleteFeedback = (index) => {
  const item = state.draft.feedback[index];
  if (!item) return;
  if (!confirm('Delete this screenshot? This will be included in the next publish.')) return;
  unstageOrDeleteAsset(item.src);
  state.draft.feedback.splice(index, 1);
  markDirty('feedback');
  render();
};

const handleEditorAction = async (button) => {
  if (await therapyEditor.handleAction(button) || await filmsEditor.handleAction(button)) return;
  const action = button.dataset.action;
  if (action === 'add') return openEditor(button.dataset.kind, -1);
  if (action === 'edit') return openEditor(button.dataset.kind, Number(button.dataset.index));
  if (action === 'back') {
    leaveEditor();
    return;
  }
  if (action === 'move') return moveItem(button.dataset.kind, Number(button.dataset.index), Number(button.dataset.direction));
  if (action === 'toggle-visible') return toggleVisible(button.dataset.kind, Number(button.dataset.index));
  if (action === 'delete') return deleteItem(button.dataset.kind, Number(button.dataset.index));
  if (action === 'voice-move') return moveItem('feedback', Number(button.dataset.index), Number(button.dataset.direction));
  if (action === 'voice-delete') return deleteFeedback(Number(button.dataset.index));
  if (action === 'save-editor') return saveEditor();
  if (action === 'save-company') return saveHeldForm('company', saveCompany);
  if (action === 'save-appearance') return saveHeldForm('appearance', saveAppearance);
  if (action === 'discard-form') {
    const tab = button.dataset.formTab;
    if (!confirm('Discard your unsaved ' + tabName(tab).toLowerCase() + ' edits?')) return;
    delete formEdits[tab];
    delete carriedForms[tab];
    render();
    return;
  }
  if (action === 'set-color-mode') return setColorMode(button.dataset.mode);
  if (action === 'select-theme') {
    // The re-render puts back any typed-but-unsaved search fields (afterRender).
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
  if (action === 'body-add') buffer.body.push({ text: '' });
  if (action === 'body-move') {
    const index = Number(button.dataset.index);
    const target = index + Number(button.dataset.direction);
    const [paragraph] = buffer.body.splice(index, 1);
    buffer.body.splice(target, 0, paragraph);
  }
  if (action === 'body-delete') buffer.body.splice(Number(button.dataset.index), 1);
  if (action === 'image-move') {
    const index = Number(button.dataset.index);
    const target = index + Number(button.dataset.direction);
    const [path] = buffer.images.splice(index, 1);
    buffer.images.splice(target, 0, path);
  }
  if (action === 'image-delete') {
    const [removed] = buffer.images.splice(Number(button.dataset.index), 1);
    unstageOrDeleteAsset(typeof removed === 'string' ? removed : removed.src);
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

// Saves the Company or Appearance form into the draft. Once it is kept, the
// tab re-renders from the draft (as the Page tab does) so the form shows what
// was stored; when the save refuses, the typed values stay held.
const saveHeldForm = (tab, save) => {
  const form = editorRoot.querySelector('#' + FORM_TABS[tab]);
  if (!form) return;
  const writes = draftWrites;
  save(form);
  if (draftWrites === writes) return;
  delete formEdits[tab];
  delete carriedForms[tab];
  render();
};

const saveCompany = (form) => {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const field = (name) => String(data.get(name) || '').trim();
  // Start from what is on record so fields this form does not edit (and any
  // social channel it does not list) survive a save.
  const existing = state.draft.company || {};
  const company = {
    ...existing,
    name: field('name'),
    legalName: field('legalName'),
    tagline: field('tagline'),
    about: field('about'),
    phone: field('phone'),
    whatsapp: field('whatsapp'),
    email: field('email'),
    address: field('address'),
    mapsUrl: field('mapsUrl'),
    hours: field('hours'),
    social: {
      ...(existing.social || {}),
      x: field('x'),
      linkedin: field('linkedin'),
      instagram: field('instagram'),
      facebook: field('facebook'),
      youtube: field('youtube'),
    },
    founded: field('founded'),
  };
  // Names and address of only spaces, and numbers the site cannot dial
  // (content-rules.js validateCompanyDetailed), then the location block.
  const fieldErrors = checkCompanyFields(form, company);
  if (applyCompanyLocation(form, company).length || fieldErrors.length) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    showStatus('Company draft not saved', 'Fix the highlighted fields first.');
    return;
  }
  state.draft.company = company;
  markDirty('company');
  showStatus('Company draft saved', 'Press Save & Publish to put the changes on the site.');
};

const saveAppearance = (form) => {
  if (!form.reportValidity()) return;
  if (applySeoExtras(form, state.draft.config.seo).length) {
    showStatus('Appearance draft not saved', 'Fix the highlighted search fields first.');
    return;
  }
  const data = new FormData(form);
  state.draft.config.seo.title = String(data.get('seoTitle') || '').trim();
  state.draft.config.seo.description = String(data.get('seoDescription') || '').trim();
  markDirty('config');
  showStatus('Appearance draft saved', 'Press Save & Publish to put the theme and search changes on the site.');
};

// Snapshot exactly what one publish sends: the text of each changed file and
// each staged file entry. A successful publish then forgets only these, so an
// edit saved while the upload was still running stays unpublished, and dirty.
const collectChanges = () => {
  const files = new Map();
  for (const key of state.dirty) files.set(key, GhApi.jsonChange(FILES[key], state.draft[key]).content);
  const assets = new Map(state.assetChanges);
  const changes = [...files].map(([key, content]) => ({ path: FILES[key], content, encoding: 'utf-8' }));
  for (const [path, change] of assets) {
    changes.push(change.delete ? { path, delete: true } : { path, content: change.content, encoding: change.encoding });
  }
  return { changes, files, assets };
};

const sameAsset = (a, b) => Boolean(a && b) &&
  (a === b || (Boolean(a.delete) === Boolean(b.delete) && a.content === b.content && a.encoding === b.encoding));

const settleCommitted = ({ files, assets }) => {
  for (const [key, content] of files) {
    state.base[key] = JSON.parse(content);
    if (GhApi.jsonChange(FILES[key], state.draft[key]).content === content) state.dirty.delete(key);
  }
  // The open editor's snapshot too: Cancel restores it, and must not bring back
  // a file that is already committed.
  for (const staged of [state.assetChanges, state.editor?.assetSnapshot]) {
    if (!staged) continue;
    for (const [path, sent] of assets) {
      const now = staged.get(path);
      if (sameAsset(now, sent)) staged.delete(path);
      // Re-staged while uploading: the committed upload now exists in the
      // repository (or the committed delete removed it), which decides whether
      // removing this new one later must delete a file.
      else if (now && !now.delete) staged.set(path, { ...now, replaces: !sent.delete });
    }
  }
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

// Each publish bumps the generation; a watcher from an earlier publish sees it
// changed and stops, so it can't paint over the newer publish's progress.
let pollGeneration = 0;

const pollActions = async (commitSha, note = '') => {
  const generation = pollGeneration;
  const current = () => generation === pollGeneration;
  const say = (title, message) => { if (current()) showStatus(title, message + note); };
  const started = Date.now();
  const actionsLink = '<a href="' + h(ACTIONS_URL) + '" target="_blank" rel="noreferrer">Watch on GitHub</a>';
  try {
    // Phase 1 — wait for GitHub to create the workflow run for this commit.
    // The commit is already safe on the branch; we are only waiting for CI to
    // pick it up, which can take minutes when GitHub is busy or a prior deploy
    // is still finishing (the workflow queues on the `pages` concurrency group).
    let run = null;
    while (!run) {
      const runs = await state.api.listRuns(commitSha);
      if (!current()) return;
      if (runs.length) { [run] = runs; break; }
      if (Date.now() - started > DISCOVER_DEADLINE) {
        say('Published — rebuild not started yet', 'Your changes are saved on GitHub, but GitHub hasn’t started rebuilding the site yet (it can be slow when busy). The site will update once it does. ' + actionsLink + '.');
        return;
      }
      say('Published', 'Your changes are saved. The site is rebuilding — usually a minute or two, longer when GitHub is busy. ' + actionsLink + '.');
      await wait(POLL_INTERVAL);
      if (!current()) return;
    }

    // Phase 2 — follow the run through queued → building → completed.
    for (;;) {
      const runs = await state.api.listBranchRuns();
      if (!current()) return;
      run = runs.find((candidate) => candidate.id === run.id) || run;
      const runLink = '<a href="' + h(run.html_url) + '" target="_blank" rel="noreferrer">View on GitHub</a>.';
      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          say('Live on the site', 'Your changes are live. ' + runLink);
          return;
        }
        if (run.conclusion === 'cancelled') {
          // deploy.yml builds one at a time (concurrency group `pages`): when a
          // newer change lands while this build is still waiting, GitHub drops
          // this one and runs the newer build, which includes these changes.
          const newer = runs
            .filter((candidate) => candidate.id > run.id && (!run.workflow_id || candidate.workflow_id === run.workflow_id))
            .sort((x, y) => x.id - y.id)[0];
          if (newer) {
            run = newer;
            say('Published — rebuilding with a newer update', 'Another change was published right after yours, so GitHub is rebuilding the site once with both. <a href="' + h(newer.html_url) + '" target="_blank" rel="noreferrer">View on GitHub</a>.');
            await wait(POLL_INTERVAL);
            if (!current()) return;
            continue;
          }
          say('Rebuild stopped', 'Your changes are saved on GitHub, but the site rebuild was cancelled before it finished, so the site may still show the old version. Press Rebuild site to try again. ' + runLink);
          return;
        }
        say('The site didn’t update', 'Your changes are saved on GitHub, but the site rebuild failed, so visitors still see the previous version. Press Rebuild site to try again, or open the run to see what went wrong. ' + runLink);
        return;
      }
      if (Date.now() - started > COMPLETE_DEADLINE) {
        say('The rebuild is taking a while', 'The site has been rebuilding for unusually long — GitHub may be busy. It should still finish on its own. ' + runLink);
        return;
      }
      if (run.status === 'in_progress') say('Updating the site', 'GitHub is rebuilding the site with your changes now — usually about a minute. ' + runLink);
      else say('Published — waiting to rebuild', 'Your changes are saved. GitHub has queued the site rebuild; it can take a few minutes when GitHub is busy. ' + runLink);
      await wait(POLL_INTERVAL);
      if (!current()) return;
    }
  } catch {
    say('Published', 'Your changes are saved on GitHub, but the admin couldn’t check on the site rebuild. The site normally updates within a few minutes. ' + actionsLink + '.');
  }
};

const CONFLICT_ACTION = { action: 'reload-reapply', actionLabel: 'Load their changes, keep mine' };

// Resolves true once the commit landed, false when nothing was published
// (blog-tab.js rolls its staged post back on false).
const publish = async (options) => {
  if (state.publishing) return false;
  if (state.editor) {
    showStatus('Open editor not saved', 'Save or cancel the open editor first.');
    return false;
  }
  const message = typeof options?.message === 'string' && options.message.trim() ? options.message.trim() : 'Update site content from admin';
  try {
    validateDraft(state.draft.testimonials);
  } catch (error) {
    showStatus('Cannot publish yet', h(error.message));
    return false;
  }
  // Pre-publish gate: unsaved Company / Appearance / Page edits, then the
  // shared content rules for every changed data file they cover
  // (admin/content-rules.js).
  // The toast stays up (it has an action) and offers the tab that fixes it.
  const blocked = unsavedFormsBlock() || pageEditor.publishBlock();
  if (blocked) {
    const canOpen = tabNav.querySelector('[data-tab="' + blocked.tab + '"]');
    showStatus(blocked.title, blocked.message, canOpen ? { action: 'open-tab:' + blocked.tab, actionLabel: 'Open the ' + blocked.tabName + ' tab' } : {});
    return false;
  }
  const sent = collectChanges();
  if (!sent.changes.length) {
    showStatus('Nothing to publish', 'Make a content change first.');
    return false;
  }
  state.publishing = true;
  pollGeneration += 1;
  renderUnsaved();
  publishButton.textContent = 'Publishing…';
  barPublishButton.textContent = 'Publishing…';
  showStatus('Publishing…', 'Sending your changes to GitHub. Keep this tab open until it says Published.');
  try {
    const commit = await state.api.publish(sent.changes, state.baseSha, message);
    state.baseSha = commit.sha;
    settleCommitted(sent);
    renderUnsaved();
    const later = state.dirty.size || state.assetChanges.size
      ? ' Changes you saved while it was publishing aren’t included yet — press Save & Publish again for those.'
      : '';
    showStatus('Published', 'Your changes are saved. The site is rebuilding — usually a minute or two.' + later);
    pollActions(commit.sha, later);
    return true;
  } catch (error) {
    if (error instanceof BranchConflictError) {
      showStatus('Someone else published since you opened the admin', 'Nothing of yours was published yet, and your changes are safe here. Load their changes first; yours will be kept on top.', CONFLICT_ACTION);
    } else {
      handleApiError(error, 'Not published', ' Your changes are still here — press Save & Publish to try again.');
    }
  } finally {
    state.publishing = false;
    publishButton.textContent = 'Save & Publish';
    barPublishButton.textContent = 'Save & Publish';
    renderUnsaved();
  }
  return false;
};

// Main moved under the admin. Load it, then carry over only what the owner
// changed since their copy was loaded (admin/draft-merge.js) — putting their
// whole stale file back would silently revert the other writer's edits in it.
const reloadAndReapply = async () => {
  if (state.editor) return showStatus('Save or cancel the open editor first', 'Then load their changes — yours will be kept on top.', CONFLICT_ACTION);
  const ownDraft = state.draft;
  const ownDirty = new Set(state.dirty);
  const assets = new Map(state.assetChanges);
  const base = state.base || {};
  const typedForms = Object.fromEntries(Object.keys(FORM_TABS).map((tab) => [tab, typedFormEdits(tab)]));
  showStatus('Loading their changes…', 'Getting the latest version of the site, then putting your changes back on top.');
  try {
    await loadRepository();
  } catch (error) {
    if (error instanceof AuthError || error.status === 401) return handleApiError(error);
    return showStatus('Couldn’t load their changes', h(describeApiError(error)) + ' Your changes are still here.', { action: 'reload-reapply', actionLabel: 'Try again' });
  }
  const fresh = state.draft;
  const refsOf = (draft, keys = Object.keys(FILES), into = new Set()) => {
    for (const key of keys) stringsIn(draft[key], into);
    return into;
  };
  const baseRefs = refsOf(base);
  const theirRefs = refsOf(fresh);
  const ours = Object.fromEntries([...ownDirty].map((key) => [key, ownDraft[key]]));

  // A new file of ours at a path the other writer has since started using
  // would overwrite theirs: give ours a free name next to it.
  for (const [path, change] of [...assets]) {
    if (change.delete || change.replaces || baseRefs.has(path) || !theirRefs.has(path)) continue;
    const taken = refsOf(ours, Object.keys(ours), new Set([...baseRefs, ...theirRefs, ...assets.keys()]));
    const moved = freePath(path, taken);
    for (const key of Object.keys(ours)) ours[key] = renameString(ours[key], path, moved);
    assets.delete(path);
    assets.set(moved, { ...change, path: moved });
    if (state.assetPreviews.has(path)) {
      state.assetPreviews.set(moved, state.assetPreviews.get(path));
      state.assetPreviews.delete(path);
    }
  }

  const conflicts = [];
  const dirty = new Set();
  for (const key of ownDirty) {
    const merged = mergeFile(key, base[key], ours[key], fresh[key]);
    conflicts.push(...merged.conflicts);
    if (!sameValue(merged.value, fresh[key])) {
      state.draft[key] = merged.value;
      dirty.add(key);
    }
  }

  // Staged files follow the merged content: keep a file whose delete would
  // break an item that kept the other writer's version, and drop an upload
  // that only an item which lost to their version used.
  const mergedRefs = refsOf(state.draft);
  const ownRefs = refsOf(ours, Object.keys(ours));
  for (const [path, change] of [...assets]) {
    const drop = change.delete ? mergedRefs.has(path) : !mergedRefs.has(path) && ownRefs.has(path);
    if (!drop) continue;
    assets.delete(path);
    if (!change.delete && state.assetPreviews.has(path)) {
      URL.revokeObjectURL(state.assetPreviews.get(path));
      state.assetPreviews.delete(path);
    }
  }
  state.dirty = dirty;
  state.assetChanges = assets;
  // The merge rewrote the draft files in place, so values held against the
  // pre-merge render are stale: re-seed each form from the merged draft and lay
  // only what the owner had typed (and not yet saved) back on top.
  for (const tab of Object.keys(FORM_TABS)) {
    delete formEdits[tab];
    if (typedForms[tab]) carriedForms[tab] = typedForms[tab];
    else delete carriedForms[tab];
  }
  render();
  renderUnsaved();
  const left = dirty.size || assets.size;
  if (conflicts.length) {
    showStatus('Some of your changes need redoing',
      'Their changes are loaded' + (left ? ' and the rest of yours are kept on top' : '') + '. Someone else also changed these, so their version was kept — please redo your change to:' +
      conflicts.map((item) => '<br>• ' + h(item)).join('') + (left ? '<br>Then press Save & Publish.' : ''),
      { action: 'dismiss-status', actionLabel: 'Got it' });
  } else if (left) {
    showStatus('Your changes are back on top', 'Their changes are loaded, with yours kept on top. Check them, then press Save & Publish.');
  } else {
    showStatus('Their changes are loaded', 'Your changes were already part of what they published, so there is nothing left to publish.');
  }
};

const handleApiError = (error, title = 'Something went wrong', note = '') => {
  if (error instanceof AuthError || error.status === 401) {
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
    showAuth(vaultExists()
      ? 'GitHub stopped accepting the saved sign-in. Unlock with your passcode to carry on — your unpublished changes stay here while this tab is open. If the token was replaced, choose “Forget this device” and set it up with the new one.'
      : 'GitHub stopped accepting the token. Set up again with a working token to carry on — your unpublished changes stay here while this tab is open.');
    return;
  }
  showStatus(title, h(describeApiError(error)) + note);
};

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = setupToken.value.trim();
  const branch = setupBranch.value.trim() || 'main';
  const passcode = setupPasscode.value;
  if (!token) return;
  if (passcode.length < 8) return setAuthStatus('The passcode needs at least 8 characters.');
  if (passcode !== setupPasscodeConfirm.value) return setAuthStatus('The passcodes do not match.');
  // The vault is saved as soon as GitHub accepts the token, so a content load
  // that fails afterwards doesn't cost the owner the device setup.
  await connect(token, branch, {
    busyButton: setupButton,
    onValidated: async () => {
      try {
        await createVault(token, passcode, branch);
      } catch (error) {
        showStatus('This device won’t remember you', h('You’re signed in for now, but saving your sign-in on this device failed (' + error.message + '). Next time you’ll need to paste the token again.'));
      }
    },
  });
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
syncModeToggles();

tabNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button || button.dataset.tab === state.activeTab) return;
  if (!leaveEditor()) return;
  state.activeTab = button.dataset.tab;
  clearStatus();
  render();
});

editorRoot.addEventListener('click', async (event) => {
  if (blogTab.owns(event.target)) return;
  const button = event.target.closest('[data-action]');
  if (!button) return;
  focusKeeper.plan(focusTargets(button));
  try {
    await handleEditorAction(button);
  } catch (error) {
    showStatus('Couldn’t make that change', h(error.message));
  } finally {
    focusKeeper.settle();
  }
});

editorRoot.addEventListener('submit', (event) => {
  // Blog components handle their own forms; blog-manage's <form method="dialog">
  // confirm dialogs only close (with their returnValue) if the submit goes through.
  if (blogTab.owns(event.target)) return;
  event.preventDefault();
  try {
    if (therapyEditor.handleSubmit(event.target) || filmsEditor.handleSubmit(event.target)) return;
    if (event.target.id === 'product-form' || event.target.id === 'protocol-form' || event.target.id === 'testimonial-form' || event.target.id === 'solution-form') saveEditor();
    if (event.target.id === 'company-form') saveHeldForm('company', saveCompany);
    if (event.target.id === 'appearance-form') saveHeldForm('appearance', saveAppearance);
  } catch (error) {
    showStatus('Check the form', h(error.message));
  }
});

editorRoot.addEventListener('change', async (event) => {
  if (blogTab.owns(event.target)) return;
  if (event.target.name === 'hours' && event.target.closest('#company-form')) {
    showHoursReading(event.target, true);
    return;
  }
  // An upload's crop or redaction dialog hands focus back to the new tile, or
  // to the control that opened it (cancel, Escape), once the panel re-renders.
  if (event.target.type === 'file') focusKeeper.plan(uploadTargets(editorRoot, event.target));
  try {
    if (await therapyEditor.handleChange(event.target) || await filmsEditor.handleChange(event.target)) return;
    if (event.target.id === 'product-images') await uploadProductImages([...event.target.files]);
    if (event.target.id === 'solution-images') await uploadSolutionImages([...event.target.files]);
    if (event.target.dataset.replaceImage && event.target.files[0]) await replaceSolutionImage(Number(event.target.dataset.replaceImage), event.target.files[0]);
    if (event.target.id === 'voice-images') await uploadVoiceImages([...event.target.files]);
    if (event.target.dataset.stageField && event.target.files[0]) await uploadStagePhoto(event.target.dataset.stageField, event.target.files[0]);
  } catch (error) {
    showStatus('Image could not be processed', h(error.message));
  } finally {
    // A cancelled crop leaves the input holding its file, and choosing the same
    // file again would not fire another change.
    if (event.target.type === 'file') {
      event.target.value = '';
      focusKeeper.settle();
    }
  }
});

// A committed-asset preview that fails to load falls back to the text label.
// `error` does not bubble, so this listens in the capture phase.
editorRoot.addEventListener('error', (event) => {
  const img = event.target;
  if (img?.tagName !== 'IMG' || !img.dataset.assetFallback || img.dataset.assetFailed) return;
  img.dataset.assetFailed = '1';
  img.insertAdjacentHTML('afterend', '<span class="help">Saved, but the preview couldn’t load</span>');
  img.remove();
}, true);

editorRoot.addEventListener('input', (event) => {
  if (blogTab.owns(event.target)) return;
  if (event.target.name === 'hours' && event.target.closest('#company-form')) showHoursReading(event.target, false);
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
  showStatus('Starting rebuild', 'Asking GitHub to rebuild the site.');
  try {
    await state.api.dispatchWorkflow();
    showStatus('Rebuild requested', 'GitHub is rebuilding the site as it is now, with no content changes. It can take a few minutes to start. <a href="' + h(ACTIONS_URL) + '" target="_blank" rel="noreferrer">Watch on GitHub</a>.');
  } catch (error) {
    handleApiError(error);
  } finally {
    rebuildButton.disabled = false;
  }
});

publishStatus.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-global-action]');
  if (!button) return;
  if (button.dataset.globalAction === 'dismiss-status') return clearStatus();
  const openTab = /^open-tab:([a-z]+)$/.exec(button.dataset.globalAction);
  if (openTab) {
    if (!leaveEditor()) return;
    state.activeTab = openTab[1];
    clearStatus();
    render();
    if (openTab[1] === 'page') pageEditor.revealErrors();
    const saveButton = FORM_TABS[openTab[1]] && formHasEdits(openTab[1]) && editorRoot.querySelector('#' + FORM_TABS[openTab[1]] + ' [data-action^="save-"]');
    if (saveButton) {
      saveButton.scrollIntoView({ block: 'center' });
      saveButton.focus({ preventScroll: true });
    }
    return;
  }
  if (button.dataset.globalAction === 'reload-reapply') {
    try { await reloadAndReapply(); } catch (error) { handleApiError(error); }
  }
});

// Typing in any form refreshes the unsaved bar; Company / Appearance values
// are held as they are typed (restoreFormEdits puts them back on render).
// Registered after the Page tab's own listeners so its working copy is current.
const noteTyping = (event) => {
  const form = event.target.closest && event.target.closest('form');
  const tab = form && Object.keys(FORM_TABS).find((key) => FORM_TABS[key] === form.id);
  if (tab && formEdits[tab] && formEdits[tab].draft === state.draft) {
    formEdits[tab].values = formValues(form);
    showFormDiscard(form, tab);
  }
  renderUnsaved();
};
editorRoot.addEventListener('input', noteTyping);
editorRoot.addEventListener('change', noteTyping);

document.querySelector('#lock-button').addEventListener('click', () => {
  if (hasUnsavedWork() && !confirm('Lock the admin and discard your unpublished changes?')) return;
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  state.api = null;
  state.loaded = false;
  state.draft = {};
  state.dirty.clear();
  state.assetChanges.clear();
  state.editor = null;
  renderUnsaved();
  showAuth('Locked. Enter your passcode to continue.');
});

window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedWork()) return;
  event.preventDefault();
  event.returnValue = '';
});

const savedToken = sessionToken();
if (savedToken) {
  connect(savedToken, state.branch, {
    busyButton: unlockButton,
    inApp: true,
    onAuthFailure: (error) => showAuth(error.status === 401
      ? 'GitHub no longer accepts the saved token — it may have expired or been replaced. Unlock to try again, or choose “Forget this device” and set it up with a new token.'
      : error.message),
  });
} else {
  showAuth();
}
