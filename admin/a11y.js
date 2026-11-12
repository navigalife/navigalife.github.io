// Keyboard and screen-reader plumbing shared by the admin modules.
//
// createFocusKeeper(root): a re-render replaces the panel's markup, which drops
// keyboard focus to <body>. Before an action the dispatcher names where focus
// should land (plan), render() notes the focused control (hold), and the end of
// every render (afterRender → settle) moves focus to the first target that
// exists and can take it. Targets are selectors, or functions returning an
// element; the held control's re-rendered twin is the last resort.
//
// stickyInsets(): keeps --admin-inset-top / --admin-inset-bottom equal to the
// real heights of the sticky header and of whatever is fixed at the bottom
// (unsaved bar, status toast), so scroll-padding keeps a focused control clear
// of them.
//
// describeError / clearError: ties an inline error note to its control with
// aria-describedby (ids prefixed "err-"), or unties it when the error clears.
// linkInlineErrors(root) does the same for notes rendered as markup.

const KEY_ATTRS = ['data-action', 'data-kind', 'data-index', 'data-direction', 'data-stage', 'data-stage-field', 'data-replace-image',
  'data-theme-id', 'data-mode', 'data-form-tab', 'data-page-action', 'data-list', 'data-page-path', 'data-body-index', 'data-body-field',
  'data-spec-index', 'data-spec-field', 'name'];

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

// A selector that finds this control again after a re-render.
export const controlKey = (el) => {
  if (!el || el === document.body || !el.tagName) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = KEY_ATTRS.filter((name) => el.hasAttribute(name)).map((name) => '[' + name + '="' + CSS.escape(el.getAttribute(name)) + '"]');
  return parts.length ? el.tagName.toLowerCase() + parts.join('') : null;
};

const canFocus = (el) => Boolean(el && el.isConnected && !el.disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length);

export const firstFocusable = (scope) => [...scope.querySelectorAll(FOCUSABLE)].find(canFocus) || null;

export const createFocusKeeper = (root) => {
  let planned = null;
  let held = null;
  const resolve = (target) => (typeof target === 'function' ? target() : target ? root.querySelector(target) : null);
  return {
    plan(targets) {
      planned = targets ? targets.filter(Boolean) : null;
    },
    hold() {
      const active = document.activeElement;
      held = active && root.contains(active) ? controlKey(active) : null;
    },
    // Moves focus only when the render lost it; a control outside the panel
    // (the tabs, Publish) keeps it. Returns the element focused, if any.
    settle() {
      const targets = [...(planned || []), held];
      planned = null;
      held = null;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return null;
      for (const target of targets) {
        const el = resolve(target);
        if (canFocus(el)) {
          el.focus();
          return el;
        }
      }
      return null;
    },
  };
};

// After an upload: the first tile the upload added (its own copy of the opener,
// e.g. Replace, when it has one), else the opener's twin. A tile is new when its
// image is one the panel did not show before.
export const uploadTargets = (root, opener) => {
  const tiles = () => [...root.querySelectorAll('.image-item, .voice-item, .stage-slot')];
  const image = (tile) => tile.querySelector('img')?.getAttribute('src') || '';
  const before = new Set(tiles().map(image));
  const key = controlKey(opener);
  return [() => {
    const tile = tiles().find((item) => !before.has(image(item)));
    if (!tile) return null;
    const twin = key && tile.querySelector(key);
    return canFocus(twin) ? twin : firstFocusable(tile);
  }, key];
};

// ---------------------------------------------------------------- insets

const insetState = { header: null, bottoms: [] };

export const syncInsets = () => {
  const { header, bottoms } = insetState;
  if (!header) return;
  const style = document.documentElement.style;
  const top = getComputedStyle(header).position === 'sticky' || getComputedStyle(header).position === 'fixed' ? header.getBoundingClientRect().height : 0;
  let bottom = 0;
  for (const el of bottoms) {
    if (el.hidden || !el.getClientRects().length) continue;
    bottom = Math.max(bottom, window.innerHeight - el.getBoundingClientRect().top);
  }
  style.setProperty('--admin-inset-top', Math.round(top) + 'px');
  style.setProperty('--admin-inset-bottom', Math.round(Math.max(0, bottom)) + 'px');
};

export const stickyInsets = (header, ...bottoms) => {
  insetState.header = header;
  insetState.bottoms = bottoms.filter(Boolean);
  const observer = new ResizeObserver(syncInsets);
  for (const el of [header, ...insetState.bottoms]) observer.observe(el);
  // `hidden` toggles change no size the observer sees on an element that was
  // already display:none, so watch the attribute as well.
  const watcher = new MutationObserver(syncInsets);
  for (const el of insetState.bottoms) watcher.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', syncInsets);
  syncInsets();
};

// Focus a control the owner must fix, clear of the header and bottom bars.
export const focusField = (el) => {
  syncInsets();
  el.focus();
};

// ---------------------------------------------------------------- errors

let noteCount = 0;

export const describeError = (control, note) => {
  if (!note.id) {
    noteCount += 1;
    note.id = 'err-' + noteCount;
  }
  const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== note.id);
  const errors = ids.filter((id) => id.startsWith('err-') && document.getElementById(id));
  const others = ids.filter((id) => !id.startsWith('err-'));
  control.setAttribute('aria-describedby', [...errors, note.id, ...others].join(' '));
};

export const clearError = (control) => {
  control.removeAttribute('aria-invalid');
  const kept = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && !id.startsWith('err-'));
  if (kept.length) control.setAttribute('aria-describedby', kept.join(' '));
  else control.removeAttribute('aria-describedby');
};

// Every invalid control whose label holds an inline error gets described by it.
export const linkInlineErrors = (root) => {
  for (const control of root.querySelectorAll('[aria-invalid="true"]')) {
    const note = control.closest('label')?.querySelector('.inline-error');
    if (note) describeError(control, note);
  }
};
