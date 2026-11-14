// Blog settings, the publishing calendar and the paused-schedule alert (W5d).
// Browser ES module, hosted by admin/blog-tab.js; cross-file contracts in
// AGENTS.md "The blog". Every component here works on
// data the host hands it and reports back through callbacks — nothing in this
// file touches admin state, publishes, or calls GitHub except the alert's
// two workflow calls through `gh`.
//
//   mountBlogSettings(root, { getConfig, onChange, onMovePosts, posts, stageAsset, unstageAsset, getCompany, h, icon })
//     → { refresh(), revealErrors(), destroy() }      onChange(config) gets the WHOLE new config.
//     getCompany() → the company draft (optional); the clinic's own author mirrors its name.
//     stageAsset(file, { purpose: 'author' }) → Promise<{ src }>; unstageAsset(src) is optional.
//   mountCalendar(root, { posts, onOpen }) → { refresh(posts), destroy() }
//   `posts` (both mounts) is an array or a zero-arg getter returning one.
//   mountScheduleAlert(root, { gh, posts, compact }) → { destroy() }
//     compact: the one-line banner the admin shows on every other tab.
//
// All styling lives in blog-manage.css under the `.bm` root class, which each
// mount adds to its root and removes on destroy.
import './content-rules.js';
import { intakeImage } from './image-intake.js';

const rules = () => globalThis.MediVascContentRules || {};
const TINT_FALLBACK = ['teal', 'clay', 'sage', 'ochre', 'slate', 'plum'];
const tintList = () => (Array.isArray(rules().TINTS) && rules().TINTS.length ? rules().TINTS : TINT_FALLBACK);
const titleCase = (word) => String(word).charAt(0).toUpperCase() + String(word).slice(1);

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

// Same stroke paths as app.js `icon` for the shared names, so a host that passes
// its helper and one that doesn't draw identical glyphs.
const ICON_PATHS = {
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  grip: '<path d="M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.6"/><path d="m4 17 4.8-4.3 3.7 3.2 2.6-2.2L20 17.5"/>',
  pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9.2v5.6M14 9.2v5.6"/>',
};
const HOST_ICONS = new Set(['up', 'down', 'trash', 'check']);
const iconFor = (hostIcon) => (name) => {
  if (hostIcon && HOST_ICONS.has(name)) return hostIcon(name);
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="bm-ico bm-ico--${name}">${ICON_PATHS[name] || ''}</svg>`;
};

// Web-address part from a name: “Circulation & PAD” → circulation-pad.
const slugify = (text) => String(text || '')
  .normalize('NFKD').replace(/\p{M}+/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 64).replace(/-+$/, '');

const uid = (prefix, taken) => {
  let id;
  do id = prefix + Math.random().toString(36).slice(2, 8); while (taken.has(id));
  return id;
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lines = (value) => String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
const plainMessage = (message) => {
  const text = String(message || '').replace(/^Blog settings:\s*/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const listOf = (value) => {
  const resolved = typeof value === 'function' ? value() : value;
  return Array.isArray(resolved) ? resolved.filter((item) => item && typeof item === 'object') : [];
};
const isLive = (post, now = Date.now()) => (post.status === 'published' || post.status === 'scheduled')
  && Number.isFinite(Date.parse(post.publishAt)) && Date.parse(post.publishAt) <= now;
const canFeature = (post) => post.status === 'published' || post.status === 'scheduled';
// The clinic itself as a blog author (AGENTS.md "Author"): never deleted, and its
// name always mirrors data/company.json `name` (src/blog/seo.js matches it by id).
const COMPANY_AUTHOR = 'a_team';
const statusLabel = (post) => {
  if (post.status === 'published' || post.status === 'scheduled') return isLive(post) ? 'Published' : 'Scheduled';
  return post.status === 'unpublished' ? 'Unpublished' : 'Draft';
};
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let mountCount = 0;

// ---------------------------------------------------------------- IST dates
// India has no daylight saving, so IST is a fixed +05:30 and plain UTC
// arithmetic on a shifted timestamp is exact.
const IST_MS = 330 * 60 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pad = (n) => String(n).padStart(2, '0');
const istParts = (ms) => {
  const d = new Date(ms + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), dow: (d.getUTCDay() + 6) % 7 };
};
const dayKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const clock = (hh, mm) => `${((hh + 11) % 12) + 1}:${pad(mm)} ${hh < 12 ? 'am' : 'pm'}`;
const shortDate = (ms) => {
  const p = istParts(ms);
  return `${p.d} ${MONTHS[p.m].slice(0, 3)} ${p.y}`;
};

// ------------------------------------------------------------ list reorder
// Pointer drag on a row's grip. The dragged row never leaves the DOM (its
// neighbours are moved around it instead), so implicit touch pointer capture
// on the grip survives the whole gesture.
const enableDrag = (list, { onDrop }) => {
  const onDown = (event) => {
    const grip = event.target.closest('[data-act="grip"]');
    if (!grip || !list.contains(grip) || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const row = grip.closest('[data-row]');
    if (!row) return;
    event.preventDefault();
    const rows = () => [...list.querySelectorAll(':scope > [data-row]')];
    const from = rows().indexOf(row);
    row.classList.add('is-dragging');
    list.classList.add('is-sorting');
    const flip = (el, before) => {
      if (reducedMotion()) return;
      const delta = before - el.getBoundingClientRect().top;
      if (!delta) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 200ms cubic-bezier(.22,1,.36,1)';
        el.style.transform = '';
      });
    };
    const move = (ev) => {
      const others = rows().filter((r) => r !== row);
      let target = 0;
      for (const other of others) {
        const box = other.getBoundingClientRect();
        if (ev.clientY > box.top + box.height / 2) target += 1;
      }
      let index = rows().indexOf(row);
      while (index > target) {
        const prev = row.previousElementSibling;
        const top = prev.getBoundingClientRect().top;
        list.insertBefore(prev, row.nextElementSibling);
        flip(prev, top);
        index -= 1;
      }
      while (index < target) {
        const next = row.nextElementSibling;
        const top = next.getBoundingClientRect().top;
        list.insertBefore(next, row);
        flip(next, top);
        index += 1;
      }
      const edge = 72;
      if (ev.clientY < edge) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
    };
    const end = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      row.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      const to = rows().indexOf(row);
      if (ev.type === 'pointercancel' || to === from) {
        if (to !== from) onDrop(from, from);
        return;
      }
      onDrop(from, to);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  };
  list.addEventListener('pointerdown', onDown);
  return () => list.removeEventListener('pointerdown', onDown);
};

// ======================================================== mountBlogSettings
export function mountBlogSettings(root, { getConfig, onChange, onMovePosts, posts, stageAsset, unstageAsset, getCompany, h, icon } = {}) {
  const esc = typeof h === 'function' ? h : escapeHtml;
  const ico = iconFor(typeof icon === 'function' ? icon : null);
  const pid = `bm${(mountCount += 1)}`;
  root.classList.add('bm');

  let config;
  const baseSlugs = new Map(); // 'categories:<id>' / 'authors:<id>' → slug when first seen (the published address)
  const baseKey = (list, id) => `${list}:${id}`;
  const followName = new Set(); // ids whose slug still follows the name (new this session, slug untouched)
  const quiet = new Set(); // new rows: no "needs a name" nag until the owner leaves them
  const typing = new Set(); // profile-link fields being typed in: their errors wait for blur
  const open = new Set();
  // Author photos. A photo is either in the base tree (a src from the loaded
  // config — never unstaged here) or staged by this mount (src returned by
  // stageAsset). Legal moves: none|base|staged → staged (choose a file),
  // staged → none (remove, or the author is deleted). Leaving the staged state
  // calls the optional unstageAsset(src); base-tree files are the host's business.
  const photoUrls = new Map(); // staged src → object URL of the blob handed to stageAsset
  const staged = new Set(); // srcs staged by this mount and still referenced
  const unstage = (src) => {
    if (!src || !staged.has(src)) return;
    staged.delete(src);
    const url = photoUrls.get(src);
    if (url) URL.revokeObjectURL(url);
    photoUrls.delete(src);
    if (typeof unstageAsset !== 'function') return;
    Promise.resolve().then(() => unstageAsset(src)).catch((error) => console.warn('[blog settings] unstageAsset failed', error));
  };
  let dragOffs = [];

  const allPosts = () => listOf(posts);
  const postsIn = (id) => allPosts().filter((post) => post.category === id);
  const authoredBy = (id) => allPosts().filter((post) => post.author === id || post.reviewer === id);
  const postsOf = (list, id) => (list === 'categories' ? postsIn(id) : authoredBy(id));

  const load = () => {
    const raw = typeof getConfig === 'function' ? getConfig() : null;
    config = structuredClone(raw && typeof raw === 'object' ? raw : {});
    for (const key of ['categories', 'authors', 'featured', 'redirects']) {
      if (!Array.isArray(config[key])) config[key] = [];
    }
    if (!config.seo || typeof config.seo !== 'object') config.seo = { title: '', description: '' };
    for (const list of ['categories', 'authors']) {
      for (const item of config[list]) {
        if (item && item.id && !baseSlugs.has(baseKey(list, item.id))) baseSlugs.set(baseKey(list, item.id), item.slug);
      }
    }
  };
  // The clinic's name from the Company tab, or '' when the host gives none.
  const companyName = () => {
    const company = typeof getCompany === 'function' ? getCompany() : null;
    return company && typeof company.name === 'string' ? company.name.trim() : '';
  };
  // The clinic's own author carries the clinic's name. True when that changed
  // the config (data saved before the name was mirrored).
  const mirrorCompany = () => {
    const name = companyName();
    const author = config.authors.find((a) => a && a.id === COMPANY_AUTHOR);
    if (!name || !author || author.name === name) return false;
    author.name = name;
    return true;
  };

  const wrap = document.createElement('div');
  wrap.className = 'bm-settings';
  root.append(wrap);

  // ------------------------------------------------------------ markup
  const countBadge = (path, value, max) => (max ? `<span class="bm-count" data-count-for="${path}" data-max="${max}">${String(value || '').length}/${max}</span>` : '');
  const field = ({ label, path, value = '', area = false, rows = 3, help = '', placeholder = '', full = false, max = 0, affix = '', attrs = '' }) => {
    const helpId = help ? `${pid}-help-${path.replaceAll('.', '-')}` : '';
    const describe = helpId ? ` aria-describedby="${helpId}" data-describedby="${helpId}"` : '';
    const control = area
      ? `<textarea data-path="${path}" rows="${rows}" placeholder="${esc(placeholder)}"${describe} ${attrs}>${esc(value)}</textarea>`
      : `<input type="text" data-path="${path}" value="${esc(value)}" placeholder="${esc(placeholder)}"${describe} ${attrs}>`;
    return `<label class="bm-field${full ? ' bm-field--full' : ''}">
      <span class="bm-field__label"><span>${label}</span>${countBadge(path, value, max)}</span>
      ${affix ? `<span class="bm-affix"><span class="bm-affix__pre" aria-hidden="true">${affix}</span>${control}</span>` : control}
      ${help ? `<span class="field-help" id="${helpId}">${help}</span>` : ''}
    </label>`;
  };

  const chip = (tint, name, extra = '') => `<span class="bm-chip${extra}" data-tint="${esc(tint || '')}" title="${esc(name)}">${esc(name || 'Untitled')}</span>`;

  const blogSection = () => `
    <section class="bm-section" id="${pid}-blog" aria-labelledby="${pid}-blog-h">
      <header class="bm-section__head"><div>
        <h2 id="${pid}-blog-h">Blog</h2>
        <p>The blog's name, its menu label and the introduction on its front page.</p>
      </div></header>
      <div class="bm-card"><div class="bm-grid">
        ${field({ label: 'Blog name', path: 'name', value: config.name, help: 'The title on the blog’s front page and in search results.' })}
        ${field({ label: 'Menu label', path: 'navLabel', value: config.navLabel, help: 'The word in the site menu that leads to the blog.' })}
        ${field({ label: 'Introduction', path: 'intro', value: config.intro, area: true, rows: 3, full: true, help: 'A sentence or two under the blog’s name.' })}
        ${field({ label: 'Search title', path: 'seo.title', value: config.seo.title, placeholder: config.name || '', max: 60, help: 'Leave empty to use the blog name.' })}
        ${field({ label: 'Search description', path: 'seo.description', value: config.seo.description, area: true, rows: 3, placeholder: config.intro || '', max: 160, help: 'Leave empty to use the introduction. Google shows about 155 characters.' })}
      </div></div>
    </section>`;

  // A slug follows the name while nothing is on the site at its address yet
  // (new this session, or no live posts and still the name's own slug).
  const hasLive = (list, id) => postsOf(list, id).some((post) => isLive(post));
  const followsName = (list, item, name = item.name) => followName.has(item.id)
    || (!hasLive(list, item.id) && item.id !== COMPANY_AUTHOR && String(item.slug || '') === slugify(name));
  const slugHelp = (list, item) => {
    if (baseSlugs.get(baseKey(list, item.id)) && hasLive(list, item.id)) return 'Changing it sends the old address to the new one.';
    if (item.id === COMPANY_AUTHOR) return 'Lowercase letters, digits and hyphens.';
    return followsName(list, item)
      ? 'Filled in from the name. Lowercase letters, digits and hyphens.'
      : 'Stays the same when you rename it. Change it here if you want.';
  };

  const tintField = (cat, i) => {
    const name = cat.name || 'Category';
    return `<fieldset class="bm-field bm-field--full bm-tints">
      <legend class="bm-field__label"><span>Colour</span></legend>
      <div class="bm-tints__row">
        <div class="bm-swatches">
          ${tintList().map((tint) => `<label class="bm-swatch" data-tint="${tint}">
            <input type="radio" class="bm-vh" name="${pid}-tint-${esc(cat.id)}" value="${tint}" data-path="categories.${i}.tint"${cat.tint === tint ? ' checked' : ''}>
            <span class="bm-swatch__dot" aria-hidden="true">${ico('check')}</span>
            <span class="bm-swatch__name">${titleCase(tint)}</span>
          </label>`).join('')}
        </div>
        <div class="bm-sample" aria-label="How the label looks on the site">
          <div class="bm-sample__pane bm-sample__pane--light"><span class="bm-sample__mode">Light</span>${chip(cat.tint, name, ' bm-chip--light')}</div>
          <div class="bm-sample__pane bm-sample__pane--dark"><span class="bm-sample__mode">Dark</span>${chip(cat.tint, name, ' bm-chip--dark')}</div>
        </div>
      </div>
    </fieldset>`;
  };

  const rowBar = ({ kind, id, i, n, summary, label, reorder = true }) => `
    <div class="bm-row__bar">
      ${reorder ? `<button type="button" class="bm-grip" data-act="grip" aria-label="Reorder ${esc(label)}" aria-describedby="${pid}-grip-help">${ico('grip')}</button>` : '<span class="bm-grip-space" aria-hidden="true"></span>'}
      <button type="button" class="bm-row__toggle" data-act="toggle" aria-expanded="${open.has(id)}" aria-controls="${pid}-${kind}-${esc(id)}">
        ${summary}
        <span class="bm-row__flag">Needs attention</span>
        <span class="bm-row__chev">${ico('chevron')}</span>
      </button>
      ${reorder ? `<div class="bm-row__actions">
        <button type="button" class="row-action" data-act="up" aria-label="Move ${esc(label)} up"${i === 0 ? ' disabled' : ''}>${ico('up')}</button>
        <button type="button" class="row-action" data-act="down" aria-label="Move ${esc(label)} down"${i === n - 1 ? ' disabled' : ''}>${ico('down')}</button>
      </div>` : ''}
    </div>`;

  const categoryRow = (cat, i, n) => {
    const count = postsIn(cat.id).length;
    const label = cat.name || 'this category';
    const summary = `<span class="bm-row__main">
        ${chip(cat.tint, cat.name || 'Untitled category', ' bm-chip--row')}
        <span class="bm-row__meta"><span data-slug-label>blog/category/${esc(cat.slug || '')}/</span><span class="bm-dot" aria-hidden="true"></span><span>${count ? plural(count, 'post') : 'No posts yet'}</span></span>
      </span>`;
    return `<li class="bm-row" data-row="categories" data-id="${esc(cat.id)}">
      ${rowBar({ kind: 'cat', id: cat.id, i, n, summary, label })}
      <div class="bm-row__body" id="${pid}-cat-${esc(cat.id)}"${open.has(cat.id) ? '' : ' hidden'}>
        <div class="bm-grid">
          ${field({ label: 'Name', path: `categories.${i}.name`, value: cat.name, attrs: 'data-role="name"' })}
          ${field({ label: 'Web address', path: `categories.${i}.slug`, value: cat.slug, affix: 'blog/category/', attrs: 'data-role="slug" spellcheck="false" autocapitalize="off"', help: slugHelp('categories', cat) })}
          ${field({ label: 'Introduction', path: `categories.${i}.intro`, value: cat.intro, area: true, rows: 3, full: true, help: 'Opens the category’s page on the blog.' })}
          ${field({ label: 'Search description', path: `categories.${i}.metaDescription`, value: cat.metaDescription, area: true, rows: 2, full: true, max: 160, placeholder: cat.intro || '', help: 'What Google shows under the category page. Leave empty to use the introduction.' })}
          ${tintField(cat, i)}
        </div>
        <div class="bm-row__foot">
          <p class="bm-row__note" data-note role="status"></p>
          <button type="button" class="button button--text bm-delete" data-act="delete">${ico('trash')}Delete category</button>
        </div>
      </div>
    </li>`;
  };

  const avatar = (author, size = '') => {
    const photo = String(author.photo || '');
    const src = photoUrls.get(photo) || (photo && !photo.startsWith('draft:') ? `../${photo}` : '');
    const initials = String(author.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase() || '?';
    return `<span class="bm-avatar${size}" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : esc(initials)}</span>`;
  };

  const authorRow = (author, i) => {
    const count = authoredBy(author.id).length;
    const clinic = author.id === COMPANY_AUTHOR;
    const sub = [author.role, author.credentials].filter((v) => String(v || '').trim()).join(' · ');
    const summary = `<span class="bm-row__main bm-row__main--author">
        ${avatar(author)}
        <span class="bm-row__text">
          <strong class="bm-row__name">${esc(author.name || 'Unnamed author')}</strong>
          <span class="bm-row__meta"><span>${esc(sub || `blog/author/${author.slug || ''}/`)}</span><span class="bm-dot" aria-hidden="true"></span><span>${count ? plural(count, 'post') : 'No posts yet'}</span></span>
        </span>
      </span>`;
    return `<li class="bm-row" data-row="authors" data-id="${esc(author.id)}">
      ${rowBar({ kind: 'author', id: author.id, i, n: 0, summary, label: author.name || 'this author', reorder: false })}
      <div class="bm-row__body" id="${pid}-author-${esc(author.id)}"${open.has(author.id) ? '' : ' hidden'}>
        <p class="bm-note">Role, credentials and photo appear on the site only once you fill them in.</p>
        <div class="bm-grid">
          ${clinic
    ? field({ label: 'Name', path: `authors.${i}.name`, value: author.name, attrs: 'readonly aria-readonly="true"', help: 'This is the clinic itself. Change the clinic name in the Company tab.' })
    : field({ label: 'Name', path: `authors.${i}.name`, value: author.name, attrs: 'data-role="name"' })}
          ${field({ label: 'Web address', path: `authors.${i}.slug`, value: author.slug, affix: 'blog/author/', attrs: 'data-role="slug" spellcheck="false" autocapitalize="off"', help: slugHelp('authors', author) })}
          ${field({ label: 'Role', path: `authors.${i}.role`, value: author.role, placeholder: clinic ? '' : 'e.g. Consultant vascular surgeon' })}
          ${field({ label: 'Credentials', path: `authors.${i}.credentials`, value: author.credentials, placeholder: clinic ? '' : 'e.g. MBBS, MS (General Surgery)' })}
          ${field({ label: 'Bio', path: `authors.${i}.bio`, value: author.bio, area: true, rows: 3, full: true, help: 'Two or three sentences for the author’s page and the end of their posts.' })}
          <div class="bm-field bm-field--full bm-photo">
            <span class="bm-field__label"><span>Photo</span></span>
            <div class="bm-photo__row" data-path="authors.${i}.photo">
              ${avatar(author, ' bm-avatar--lg')}
              <div class="bm-photo__controls">
                <div class="bm-photo__buttons">
                  ${typeof stageAsset === 'function' ? `<label class="button button--quiet bm-upload">${ico('photo')}<span>${author.photo ? 'Replace photo' : 'Choose photo'}</span><input type="file" accept="image/*" class="bm-vh" data-act="photo"></label>` : ''}
                  ${author.photo ? '<button type="button" class="button button--text" data-act="photo-remove">Remove</button>' : ''}
                </div>
                <p class="field-help" data-photo-status role="status">${clinic ? 'The clinic’s logo works best.' : 'A clear head-and-shoulders photo.'} Any size; it is resized here before upload.</p>
              </div>
            </div>
          </div>
          ${field({ label: 'Profile links', path: `authors.${i}.sameAs`, value: (author.sameAs || []).join('\n'), area: true, rows: 2, full: true, placeholder: 'https://', attrs: 'spellcheck="false" autocapitalize="off" data-role="links"', help: 'One full https:// address per line: a hospital profile, LinkedIn, a registry entry. Search engines use them to recognise the author.' })}
        </div>
        <div class="bm-row__foot">
          <p class="bm-row__note" data-note role="status"></p>
          ${clinic ? '' : `<button type="button" class="button button--text bm-delete" data-act="delete">${ico('trash')}Delete author</button>`}
        </div>
      </div>
    </li>`;
  };

  const postById = () => new Map(allPosts().map((post) => [post.id, post]));
  const catById = () => new Map(config.categories.map((cat) => [cat.id, cat]));

  const featuredRow = (id, i, n, byId, cats) => {
    const post = byId.get(id);
    const title = post ? (post.title || 'Untitled post') : 'A post that no longer exists';
    const cat = post && cats.get(post.category);
    const ms = post ? Date.parse(post.publishAt) : NaN;
    const live = post && canFeature(post);
    const state = !post ? 'Missing' : !live ? 'Not published' : Number.isFinite(ms) && ms > Date.now() ? 'Scheduled' : 'Published';
    const cover = post?.cover?.src && /^assets\//.test(post.cover.src) ? `../${post.cover.src}` : '';
    return `<li class="bm-row bm-row--featured${live ? '' : ' is-stale'}" data-row="featured" data-id="${esc(id)}">
      <div class="bm-row__bar">
        <button type="button" class="bm-grip" data-act="grip" aria-label="Reorder “${esc(title)}”" aria-describedby="${pid}-grip-help">${ico('grip')}</button>
        <div class="bm-feat" data-path="featured.${i}">
          <span class="bm-feat__n" aria-hidden="true">${i + 1}</span>
          <span class="bm-feat__thumb" aria-hidden="true">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : ''}</span>
          <span class="bm-feat__text">
            <strong>${esc(title)}</strong>
            <span class="bm-row__meta">${cat ? chip(cat.tint, cat.name, ' bm-chip--sm') : ''}${Number.isFinite(ms) ? `<span>${shortDate(ms)}</span><span class="bm-dot" aria-hidden="true"></span>` : ''}<span class="bm-state" data-state="${state.toLowerCase().replace(/\s+/g, '-')}">${state}</span></span>
          </span>
        </div>
        <div class="bm-row__actions">
          <button type="button" class="row-action" data-act="up" aria-label="Move “${esc(title)}” up"${i === 0 ? ' disabled' : ''}>${ico('up')}</button>
          <button type="button" class="row-action" data-act="down" aria-label="Move “${esc(title)}” down"${i === n - 1 ? ' disabled' : ''}>${ico('down')}</button>
          <button type="button" class="row-action" data-act="unfeature" aria-label="Remove “${esc(title)}” from featured">${ico('close')}</button>
        </div>
      </div>
    </li>`;
  };

  const featuredSection = () => {
    const byId = postById();
    const cats = catById();
    const ids = config.featured;
    const eligible = allPosts()
      .filter((post) => canFeature(post) && !ids.includes(post.id))
      .sort((a, b) => (Date.parse(b.publishAt) || 0) - (Date.parse(a.publishAt) || 0));
    return `<section class="bm-section" id="${pid}-featured" aria-labelledby="${pid}-featured-h">
      <header class="bm-section__head"><div>
        <h2 id="${pid}-featured-h">Featured posts</h2>
        <p>Shown first on the blog’s front page, in this order, and beside each article as more to read. Only published and scheduled posts can be featured.</p>
      </div></header>
      ${ids.length ? `<ol class="bm-list" data-list="featured">${ids.map((id, i) => featuredRow(id, i, ids.length, byId, cats)).join('')}</ol>`
        : '<div class="bm-empty"><p>No featured posts yet. Add one below to lead the blog’s front page.</p></div>'}
      <div class="bm-add">
        <label class="bm-field bm-add__field"><span class="bm-field__label"><span>Feature a post</span></span>
          <select data-act="feature-pick"${eligible.length ? '' : ' disabled'}>
            <option value="">${eligible.length ? 'Choose a post…' : allPosts().some(canFeature) ? 'Every published post is already featured' : 'Publish a post first, then feature it here.'}</option>
            ${eligible.map((post) => `<option value="${esc(post.id)}">${esc(post.title || 'Untitled post')}${Number.isFinite(Date.parse(post.publishAt)) ? `, ${shortDate(Date.parse(post.publishAt))}` : ''}${statusLabel(post) === 'Scheduled' ? ' (scheduled)' : ''}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="button" data-act="feature-add" disabled>${ico('plus')}Add</button>
      </div>
    </section>`;
  };

  const view = () => `
    <nav class="bm-jump" aria-label="Blog settings sections">
      <a href="#${pid}-blog">Blog</a><a href="#${pid}-categories">Categories</a><a href="#${pid}-authors">Authors</a><a href="#${pid}-featured">Featured</a>
    </nav>
    <div class="bm-summary" data-summary hidden>
      <strong>Some settings need attention before you publish</strong>
      <ul></ul>
    </div>
    ${blogSection()}
    <section class="bm-section" id="${pid}-categories" aria-labelledby="${pid}-categories-h">
      <header class="bm-section__head">
        <div><h2 id="${pid}-categories-h">Categories</h2><p>Every post sits in one category. The order here is the order on the blog.</p></div>
        <button type="button" class="button" data-act="add-category">${ico('plus')}Add category</button>
      </header>
      <ol class="bm-list" data-list="categories">${config.categories.map((cat, i, all) => categoryRow(cat, i, all.length)).join('')}</ol>
    </section>
    <section class="bm-section" id="${pid}-authors" aria-labelledby="${pid}-authors-h">
      <header class="bm-section__head">
        <div><h2 id="${pid}-authors-h">Authors</h2><p>The people and teams named on posts. Each gets a page on the blog.</p></div>
        <button type="button" class="button" data-act="add-author">${ico('plus')}Add author</button>
      </header>
      <ol class="bm-list" data-list="authors">${config.authors.map((author, i) => authorRow(author, i)).join('')}</ol>
    </section>
    ${featuredSection()}
    <p class="bm-vh" id="${pid}-grip-help">Drag to reorder, or press the up and down arrow keys.</p>
    <p class="bm-vh" aria-live="polite" data-live></p>
    <dialog class="bm-dialog" aria-labelledby="${pid}-dialog-h">
      <form method="dialog">
        <h2 id="${pid}-dialog-h" data-dialog-title></h2>
        <div class="bm-dialog__body" data-dialog-body></div>
        <div class="bm-dialog__actions">
          <button type="submit" value="cancel" class="button" data-dialog-cancel>Keep it</button>
          <button type="submit" value="ok" class="button button--danger" data-dialog-ok>Delete</button>
        </div>
      </form>
    </dialog>`;

  // ---------------------------------------------------------- rendering
  const focusKey = (el) => {
    if (!el || !wrap.contains(el)) return null;
    return { path: el.dataset.path, act: el.dataset.act, id: el.closest('[data-id]')?.dataset.id, list: el.closest('[data-row]')?.dataset.row, value: el.type === 'radio' ? el.value : null };
  };
  const restoreFocus = (key) => {
    if (!key) return;
    let target = null;
    if (key.id && key.act) {
      const row = wrap.querySelector(`[data-row="${key.list}"][data-id="${CSS.escape(key.id)}"]`);
      target = row?.querySelector(`[data-act="${key.act}"]`);
      if (target?.disabled) target = row.querySelector('[data-act="up"]:not([disabled]), [data-act="down"]:not([disabled]), [data-act="grip"]');
    }
    if (!target && key.act && !key.id) target = wrap.querySelector(`[data-act="${key.act}"]`);
    if (!target && key.path) target = wrap.querySelector(`[data-path="${key.path}"]${key.value ? `[value="${key.value}"]` : ''}`);
    target?.focus({ preventScroll: true });
  };

  const render = () => {
    const key = focusKey(document.activeElement);
    for (const off of dragOffs) off();
    typing.clear();
    wrap.innerHTML = view();
    dragOffs = [...wrap.querySelectorAll('[data-list="categories"], [data-list="featured"]')]
      .map((list) => enableDrag(list, { onDrop: (from, to) => moveItem(list.dataset.list, from, to) }));
    showErrors();
    restoreFocus(key);
  };

  const announce = (text) => {
    const live = wrap.querySelector('[data-live]');
    if (!live) return;
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  };

  // ---------------------------------------------------------- validation
  const fieldFor = (path) => {
    let el = wrap.querySelector(`[data-path="${path}"]`);
    if (!el && /\.sameAs\.\d+$/.test(path)) el = wrap.querySelector(`[data-path="${path.replace(/\.\d+$/, '')}"]`);
    return el;
  };
  const itemIdOf = (path) => {
    const m = /^(categories|authors)\.(\d+)/.exec(path);
    return m ? config[m[1]][Number(m[2])]?.id : null;
  };

  const showErrors = () => {
    const validate = rules().validateBlogConfigDetailed;
    const errors = typeof validate === 'function' ? validate(config) : [];
    for (const note of wrap.querySelectorAll('[data-bm-error]')) note.remove();
    for (const el of wrap.querySelectorAll('[aria-invalid="true"]')) {
      el.removeAttribute('aria-invalid');
      if (el.dataset.describedby) el.setAttribute('aria-describedby', el.dataset.describedby);
      else el.removeAttribute('aria-describedby');
    }
    const general = [];
    const seen = new Set();
    errors.forEach((error, k) => {
      const owner = itemIdOf(error.path);
      if (owner && quiet.has(owner)) return;
      if ([...typing].some((path) => error.path === path || error.path.startsWith(`${path}.`))) return;
      const el = fieldFor(error.path);
      if (!el) {
        general.push(error);
        return;
      }
      const host = el.closest('.bm-field') || el.querySelector('.bm-feat__text') || el.parentElement;
      const noteKey = `${error.path}|${error.message}`;
      if (seen.has(noteKey)) return;
      seen.add(noteKey);
      const note = document.createElement('span');
      note.className = 'inline-error';
      note.dataset.bmError = '';
      note.id = `${pid}-err-${k}`;
      note.textContent = plainMessage(error.message);
      host.append(note);
      const control = el.matches('input, textarea, select') ? el : null;
      if (control) {
        if (control.type === 'radio') {
          for (const radio of wrap.querySelectorAll(`[data-path="${error.path}"]`)) radio.setAttribute('aria-invalid', 'true');
        } else {
          control.setAttribute('aria-invalid', 'true');
          control.setAttribute('aria-describedby', `${control.dataset.describedby || ''} ${note.id}`.trim());
        }
      }
    });
    for (const row of wrap.querySelectorAll('[data-row]')) {
      row.classList.toggle('has-error', Boolean(row.querySelector('[data-bm-error]')));
    }
    const summary = wrap.querySelector('[data-summary]');
    if (summary) {
      summary.hidden = !general.length;
      summary.querySelector('ul').innerHTML = general.map((error) => `<li>${esc(plainMessage(error.message))}</li>`).join('');
    }
    return errors;
  };

  const emit = () => {
    // The Company tab may have renamed the clinic since this mount loaded.
    if (mirrorCompany()) {
      const i = config.authors.findIndex((a) => a && a.id === COMPANY_AUTHOR);
      const row = wrap.querySelector(`[data-row="authors"][data-id="${COMPANY_AUTHOR}"]`);
      const input = row?.querySelector(`[data-path="authors.${i}.name"]`);
      if (input) input.value = config.authors[i].name;
      syncRowLabels(row, 'authors', config.authors[i]);
    }
    showErrors();
    if (typeof onChange === 'function') onChange(structuredClone(config));
  };

  // ------------------------------------------- category and author slugs
  const catUrl = (slug) => `blog/category/${slug}/`;
  const urlOf = (list, slug) => (list === 'categories' ? catUrl(slug) : `blog/author/${slug}/`);
  // Points every redirect into `fromUrl` at `toUrl` (chains collapse) and drops
  // any redirect that now points at itself (renamed back).
  const follow = (fromUrl, toUrl) => {
    for (const redirect of config.redirects) {
      if (redirect && redirect.to === fromUrl) redirect.to = toUrl;
    }
    config.redirects = config.redirects.filter((redirect) => !(redirect && redirect.from === redirect.to));
  };
  const addRedirect = (fromUrl, toUrl) => {
    if (fromUrl === toUrl || config.redirects.some((redirect) => redirect && redirect.from === fromUrl)) return;
    config.redirects.push({ from: fromUrl, to: toUrl });
  };
  // Keeps config.redirects pointing every old address of this category or
  // author at its current one; one with live posts gets a redirect from its
  // published address.
  const retarget = (list, item, prev) => {
    const next = item.slug;
    if (prev === next) return;
    follow(urlOf(list, prev), urlOf(list, next));
    const base = baseSlugs.get(baseKey(list, item.id));
    if (base && base !== next && postsOf(list, item.id).some((post) => isLive(post))) addRedirect(urlOf(list, base), urlOf(list, next));
  };

  const syncRowLabels = (row, list, item) => {
    if (!row) return;
    if (list === 'categories') {
      for (const el of row.querySelectorAll('.bm-chip')) {
        el.textContent = item.name || (el.classList.contains('bm-chip--row') ? 'Untitled category' : 'Category');
        el.title = item.name || '';
        el.dataset.tint = item.tint || '';
      }
      const slugLabel = row.querySelector('[data-slug-label]');
      if (slugLabel) slugLabel.textContent = catUrl(item.slug || '');
    } else if (list === 'authors') {
      const name = row.querySelector('.bm-row__name');
      if (name) name.textContent = item.name || 'Unnamed author';
    }
  };

  // ------------------------------------------------------------- editing
  const setAt = (path, value) => {
    const parts = path.split('.');
    let node = config;
    for (const part of parts.slice(0, -1)) {
      if (node[part] === undefined || node[part] === null) node[part] = {};
      node = node[part];
    }
    node[parts.at(-1)] = value;
  };

  const updateCount = (path, value) => {
    const badge = wrap.querySelector(`[data-count-for="${path}"]`);
    if (!badge) return;
    const max = Number(badge.dataset.max);
    badge.textContent = `${value.length}/${max}`;
    badge.classList.toggle('is-over', value.length > max);
  };

  const onInput = (event) => {
    const el = event.target;
    const path = el.dataset?.path;
    if (!path || el.matches('[data-act]')) return;
    if (el.type === 'radio') {
      if (event.type !== 'change' || !el.checked) return;
    } else if (event.type === 'change' && el.dataset.role !== 'slug' && el.dataset.role !== 'links') return;
    const m = /^(categories|authors)\.(\d+)\.(\w+)$/.exec(path);
    const list = m?.[1];
    const item = m ? config[list][Number(m[2])] : null;
    const row = el.closest('[data-row]');
    let value = el.value;
    const prevName = item ? item.name : '';

    if (el.dataset.role === 'links') {
      // A half-typed address is not an error yet: check it when the field is left.
      if (event.type === 'input') typing.add(path);
      else typing.delete(path);
      setAt(path, lines(value));
    } else if (el.dataset.role === 'slug') {
      const prev = item.slug;
      if (event.type === 'change') value = slugify(value);
      else {
        const tidy = value.toLowerCase().replace(/\s/g, '-');
        if (tidy !== value) {
          const at = el.selectionStart;
          el.value = tidy;
          el.setSelectionRange(at, at);
        }
        value = tidy;
      }
      if (el.value !== value) el.value = value;
      followName.delete(item.id);
      item.slug = value;
      retarget(list, item, prev);
    } else {
      setAt(path, value);
      if (el.dataset.role === 'name' && item && followsName(list, item, prevName)) {
        const prev = item.slug;
        item.slug = slugify(value);
        const slugInput = row?.querySelector('[data-role="slug"]');
        if (slugInput) slugInput.value = item.slug;
        retarget(list, item, prev);
      }
    }

    if (list) syncRowLabels(row, list, item);
    if (path === 'name') { const t = wrap.querySelector('[data-path="seo.title"]'); if (t) t.placeholder = value; }
    if (path === 'intro') { const d = wrap.querySelector('[data-path="seo.description"]'); if (d) d.placeholder = value; }
    if (list === 'categories' && m[3] === 'intro') { const d = row?.querySelector(`[data-path="categories.${m[2]}.metaDescription"]`); if (d) d.placeholder = value; }
    if (el.dataset.role !== 'links') updateCount(path, el.value);
    emit();
  };

  const onFocusOut = (event) => {
    const row = event.target.closest?.('[data-row]');
    if (!row || !quiet.has(row.dataset.id)) return;
    if (event.relatedTarget && row.contains(event.relatedTarget)) return;
    quiet.delete(row.dataset.id);
    showErrors();
  };

  const toggleRow = (row, force) => {
    const button = row.querySelector('[data-act="toggle"]');
    const body = row.querySelector('.bm-row__body');
    if (!button || !body) return;
    const next = force ?? button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(next));
    body.hidden = !next;
    if (next) open.add(row.dataset.id); else open.delete(row.dataset.id);
  };

  const moveItem = (list, from, to) => {
    const items = config[list];
    if (to < 0 || to >= items.length || from === to) {
      render();
      return;
    }
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    emit();
    render();
    const name = list === 'featured' ? (postById().get(item)?.title || 'Post') : (item.name || 'Category');
    announce(`${name} moved to position ${to + 1} of ${items.length}.`);
  };

  const rowNote = (row, text) => {
    const note = row?.querySelector('[data-note]');
    if (note) note.textContent = text;
  };

  // In-page confirmation. Resolves with the dialog's form data, or null.
  // `ok: null` makes it a notice with a single `cancel` button.
  const confirmDialog = ({ title, body, ok, cancel = 'Keep it' }) => new Promise((resolve) => {
    const dialog = wrap.querySelector('.bm-dialog');
    const opener = document.activeElement;
    dialog.querySelector('[data-dialog-title]').textContent = title;
    dialog.querySelector('[data-dialog-body]').innerHTML = body;
    const okButton = dialog.querySelector('[data-dialog-ok]');
    okButton.hidden = !ok;
    okButton.innerHTML = ok ? `${ico('trash')}${esc(ok)}` : '';
    dialog.querySelector('[data-dialog-cancel]').textContent = cancel;
    dialog.returnValue = '';
    const done = () => {
      dialog.removeEventListener('close', done);
      const select = dialog.querySelector('select');
      resolve(dialog.returnValue === 'ok' ? { to: select ? select.value : null } : null);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
    dialog.addEventListener('close', done);
    dialog.showModal();
    (dialog.querySelector('select') || dialog.querySelector('[data-dialog-cancel]')).focus();
  });

  const deleteCategory = async (row) => {
    const id = row.dataset.id;
    const cat = config.categories.find((c) => c.id === id);
    if (!cat) return;
    const others = config.categories.filter((c) => c.id !== id);
    if (!others.length) {
      rowNote(row, 'This is the blog’s only category. Add another one first. Every post needs a category.');
      return;
    }
    const count = postsIn(id).length;
    const name = cat.name || 'this category';
    const named = cat.name ? `“${esc(cat.name)}”` : 'this category';
    const answer = await confirmDialog(count ? {
      title: cat.name ? `Delete “${cat.name}”` : 'Delete this category',
      body: `<p>It has ${plural(count, 'post')}. ${count === 1 ? 'It moves' : 'They move'} to the category you choose, then ${named} is deleted.</p>
        <label class="bm-field"><span class="bm-field__label"><span>Move its ${plural(count, 'post')} to…</span></span>
          <select>${others.map((c) => `<option value="${esc(c.id)}">${esc(c.name || c.slug || c.id)}</option>`).join('')}</select>
        </label>`,
      ok: `Move ${count === 1 ? 'post' : 'posts'} and delete`,
      cancel: 'Keep category',
    } : {
      title: cat.name ? `Delete “${cat.name}”?` : 'Delete this category?',
      body: '<p>It has no posts, so nothing else changes.</p>',
      ok: 'Delete category',
      cancel: 'Keep category',
    });
    if (!answer) return;
    const target = count ? others.find((c) => c.id === answer.to) : null;
    if (count && !target) return;
    // Read before the move: with a `posts` getter, the moved posts leave this category.
    const hadLive = postsIn(id).some((post) => isLive(post));
    if (count && typeof onMovePosts === 'function') await onMovePosts(id, target.id);
    const index = config.categories.findIndex((c) => c.id === id);
    if (index < 0) return;
    if (target) {
      // Its addresses now lead to the category its posts moved to.
      const base = baseSlugs.get(baseKey('categories', id));
      follow(catUrl(cat.slug), catUrl(target.slug));
      if (hadLive) addRedirect(catUrl(base || cat.slug), catUrl(target.slug));
    }
    config.categories.splice(index, 1);
    open.delete(id);
    quiet.delete(id);
    followName.delete(id);
    emit();
    render();
    const nextRow = wrap.querySelectorAll('[data-row="categories"]')[Math.min(index, config.categories.length - 1)];
    (nextRow?.querySelector('[data-act="toggle"]') || wrap.querySelector('[data-act="add-category"]'))?.focus();
    announce(`Deleted ${name}.`);
  };

  const deleteAuthor = async (row) => {
    const id = row.dataset.id;
    const author = config.authors.find((a) => a.id === id);
    if (!author || id === COMPANY_AUTHOR) return;
    const name = author.name || 'this author';
    const named = authoredBy(id);
    if (named.length) {
      rowNote(row, '');
      const shown = named.slice(0, 8);
      const more = named.length - shown.length;
      await confirmDialog({
        title: author.name ? `“${author.name}” can’t be deleted yet` : 'This author can’t be deleted yet',
        body: `<p>${named.length === 1 ? 'This post names them' : `These ${named.length} posts name them`}. Give ${named.length === 1 ? 'it' : 'each one'} another author or reviewer first, then delete.</p>
          <ul class="bm-dialog__posts">${shown.map((post) => `<li><span class="bm-dialog__post">${esc(post.title || 'Untitled post')}</span><span class="bm-dialog__role">${[
            post.author === id ? 'Author' : '',
            post.reviewer === id ? 'Reviewer' : '',
          ].filter(Boolean).join(' and ')} · ${esc(statusLabel(post))}</span></li>`).join('')}</ul>
          ${more ? `<p>And ${plural(more, 'more post')}.</p>` : ''}`,
        ok: null,
        cancel: 'OK',
      });
      return;
    }
    if (config.authors.length < 2) {
      rowNote(row, 'The blog needs at least one author.');
      return;
    }
    const answer = await confirmDialog({ title: author.name ? `Delete “${author.name}”?` : 'Delete this author?', body: '<p>No posts name this author, so nothing else changes.</p>', ok: 'Delete author', cancel: 'Keep author' });
    if (!answer) return;
    const index = config.authors.findIndex((a) => a.id === id);
    if (index < 0) return;
    unstage(config.authors[index].photo);
    config.authors.splice(index, 1);
    open.delete(id);
    quiet.delete(id);
    emit();
    render();
    wrap.querySelector('[data-act="add-author"]')?.focus();
    announce(`Deleted ${name}.`);
  };

  const addItem = (list) => {
    const taken = new Set([...config.categories, ...config.authors].map((item) => item.id));
    const id = uid(list === 'categories' ? 'c_' : 'a_', taken);
    if (list === 'categories') {
      const used = new Set(config.categories.map((c) => c.tint));
      const tint = tintList().find((t) => !used.has(t)) || tintList()[0];
      config.categories.push({ id, name: '', slug: '', intro: '', metaDescription: '', tint });
    } else {
      config.authors.push({ id, name: '', slug: '', role: '', credentials: '', bio: '', photo: '', sameAs: [] });
    }
    followName.add(id);
    quiet.add(id);
    open.add(id);
    emit();
    render();
    const row = wrap.querySelector(`[data-row="${list}"][data-id="${id}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    row?.querySelector('[data-role="name"]')?.focus({ preventScroll: true });
  };

  const stagePhoto = async (input) => {
    const row = input.closest('[data-row]');
    const file = input.files?.[0];
    input.value = '';
    if (!row || !file) return;
    const status = row.querySelector('[data-photo-status]');
    const say = (text, error = false) => {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('inline-error', error);
      status.classList.toggle('field-help', !error);
    };
    const id = row.dataset.id;
    say('Preparing the photo…');
    try {
      const result = await intakeImage(file, { maxEdge: 800, onProgress: (p) => say(p.label || 'Preparing the photo…') });
      const author = config.authors.find((a) => a.id === id);
      if (!author) return;
      if (typeof stageAsset !== 'function') throw new Error('Photos can’t be added here.');
      // Named <slug>-<id>: the id keeps two authors (one taking the other's old
      // address) from landing on the same staged or committed file.
      const idPart = author.id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const slug = slugify(author.slug) || slugify(author.name);
      const ext = result.type === 'image/jpeg' ? 'jpg' : 'webp';
      const resized = new File([result.blob], `${slug ? `${slug}-` : ''}${idPart}.${ext}`, { type: result.type || result.blob.type });
      say('Uploading…');
      const out = await stageAsset(resized, { purpose: 'author' });
      const src = typeof out === 'string' ? out : out?.src;
      if (!src || typeof src !== 'string') throw new Error('The photo couldn’t be added. Try again.');
      // The author may have been deleted while the photo uploaded.
      const current = config.authors.find((a) => a.id === id);
      const previous = current ? current.photo : '';
      const url = URL.createObjectURL(result.blob);
      if (photoUrls.has(src)) URL.revokeObjectURL(photoUrls.get(src));
      photoUrls.set(src, url);
      staged.add(src);
      if (!current) {
        unstage(src);
        return;
      }
      if (previous !== src) unstage(previous);
      current.photo = src;
      emit();
      render();
      const fresh = wrap.querySelector(`[data-row="authors"][data-id="${CSS.escape(id)}"]`);
      const freshStatus = fresh?.querySelector('[data-photo-status]');
      if (freshStatus) freshStatus.textContent = 'Photo ready. It goes live with your next publish.';
      fresh?.querySelector('.bm-upload')?.focus({ preventScroll: true });
    } catch (error) {
      say(error?.message || 'This photo couldn’t be prepared. Try another file.', true);
    }
  };

  const onClick = (event) => {
    const target = event.target.closest('[data-act], .bm-jump a');
    if (!target || !wrap.contains(target)) return;
    if (target.matches('.bm-jump a')) {
      event.preventDefault();
      const section = wrap.querySelector(target.getAttribute('href'));
      section?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      section?.querySelector('h2')?.setAttribute('tabindex', '-1');
      section?.querySelector('h2')?.focus({ preventScroll: true });
      return;
    }
    const row = target.closest('[data-row]');
    const list = row?.dataset.row;
    const index = row ? config[list].findIndex((item) => (list === 'featured' ? item : item.id) === row.dataset.id) : -1;
    switch (target.dataset.act) {
      case 'toggle': toggleRow(row); break;
      case 'up': moveItem(list, index, index - 1); break;
      case 'down': moveItem(list, index, index + 1); break;
      case 'delete': if (list === 'categories') deleteCategory(row); else deleteAuthor(row); break;
      case 'add-category': addItem('categories'); break;
      case 'add-author': addItem('authors'); break;
      case 'photo-remove': {
        const author = config.authors[index];
        if (!author) break;
        unstage(author.photo);
        author.photo = '';
        emit();
        render();
        wrap.querySelector(`[data-row="authors"][data-id="${CSS.escape(row.dataset.id)}"] .bm-upload`)?.focus({ preventScroll: true });
        break;
      }
      case 'unfeature': {
        config.featured.splice(index, 1);
        emit();
        render();
        const rows = wrap.querySelectorAll('[data-row="featured"]');
        (rows[Math.min(index, rows.length - 1)]?.querySelector('[data-act="unfeature"]') || wrap.querySelector('[data-act="feature-pick"]'))?.focus({ preventScroll: true });
        announce('Removed from featured.');
        break;
      }
      case 'feature-add': {
        const pick = wrap.querySelector('[data-act="feature-pick"]');
        const id = pick?.value;
        if (!id || config.featured.includes(id)) break;
        config.featured.push(id);
        emit();
        render();
        wrap.querySelector('[data-act="feature-pick"]')?.focus({ preventScroll: true });
        announce(`${postById().get(id)?.title || 'Post'} added to featured, position ${config.featured.length}.`);
        break;
      }
      default: break;
    }
  };

  const onKeyDown = (event) => {
    const grip = event.target.closest?.('[data-act="grip"]');
    if (!grip || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const row = grip.closest('[data-row]');
    const list = row.dataset.row;
    const index = config[list].findIndex((item) => (list === 'featured' ? item : item.id) === row.dataset.id);
    moveItem(list, index, index + (event.key === 'ArrowUp' ? -1 : 1));
  };

  const onPickChange = (event) => {
    if (event.target.matches?.('[data-act="feature-pick"]')) {
      const add = wrap.querySelector('[data-act="feature-add"]');
      if (add) add.disabled = !event.target.value;
    } else if (event.target.matches?.('[data-act="photo"]')) {
      stagePhoto(event.target);
    }
  };

  wrap.addEventListener('input', onInput);
  wrap.addEventListener('change', onInput);
  wrap.addEventListener('change', onPickChange);
  wrap.addEventListener('click', onClick);
  wrap.addEventListener('keydown', onKeyDown);
  wrap.addEventListener('focusout', onFocusOut);

  // Loads the config; the clinic author's name is put right (and reported) if it
  // fell behind the Company tab.
  const loadMirrored = () => {
    load();
    if (mirrorCompany() && typeof onChange === 'function') onChange(structuredClone(config));
  };
  loadMirrored();
  render();

  return {
    refresh() {
      loadMirrored();
      for (const id of [...open]) {
        if (!config.categories.some((c) => c.id === id) && !config.authors.some((a) => a.id === id)) open.delete(id);
      }
      render();
    },
    // The publish gate's "Open Blog settings": show every problem and go to the first.
    revealErrors() {
      quiet.clear();
      typing.clear();
      showErrors();
      for (const row of wrap.querySelectorAll('[data-row].has-error')) toggleRow(row, true);
      const summary = wrap.querySelector('[data-summary]:not([hidden])');
      const note = wrap.querySelector('[data-bm-error]');
      const control = note && (note.closest('.bm-field')?.querySelector('input, textarea, select')
        || note.closest('[data-row]')?.querySelector('[data-act="toggle"], [data-act="unfeature"]'));
      const target = summary || control;
      if (!target) return;
      if (target === summary) summary.setAttribute('tabindex', '-1');
      target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      target.focus({ preventScroll: true });
    },
    destroy() {
      wrap.removeEventListener('input', onInput);
      wrap.removeEventListener('change', onInput);
      wrap.removeEventListener('change', onPickChange);
      wrap.removeEventListener('click', onClick);
      wrap.removeEventListener('keydown', onKeyDown);
      wrap.removeEventListener('focusout', onFocusOut);
      for (const off of dragOffs) off();
      for (const url of photoUrls.values()) URL.revokeObjectURL(url);
      photoUrls.clear();
      staged.clear();
      wrap.remove();
      if (!root.querySelector('.bm-settings, .bm-cal, .bm-alert-wrap')) root.classList.remove('bm');
    },
  };
}

// ============================================================ mountCalendar
export function mountCalendar(root, { posts, onOpen } = {}) {
  root.classList.add('bm');
  const wrap = document.createElement('div');
  wrap.className = 'bm-cal';
  root.append(wrap);
  let source = posts;
  const today = () => istParts(Date.now());
  let cursor = (({ y, m }) => ({ y, m }))(today());

  const entries = () => listOf(source)
    .filter((post) => (post.status === 'published' || post.status === 'scheduled') && Number.isFinite(Date.parse(post.publishAt)))
    .map((post) => {
      const ms = Date.parse(post.publishAt);
      const p = istParts(ms);
      return { post, ms, key: dayKey(p.y, p.m, p.d), time: clock(p.hh, p.mm), state: ms > Date.now() ? 'scheduled' : 'published' };
    })
    .sort((a, b) => a.ms - b.ms);

  const entryButton = (entry, kind) => `<button type="button" class="bm-cal__post bm-cal__post--${kind}" data-open="${escapeHtml(entry.post.id)}" data-state="${entry.state}">
      <span class="bm-cal__line"><time class="bm-cal__time" datetime="${escapeHtml(entry.post.publishAt)}">${entry.time}</time><span class="bm-state" data-state="${entry.state}">${entry.state === 'scheduled' ? 'Scheduled' : 'Published'}</span></span>
      <span class="bm-cal__title">${escapeHtml(entry.post.title || 'Untitled post')}</span>
    </button>`;

  const render = () => {
    const { y, m } = cursor;
    const now = today();
    const todayKey = dayKey(now.y, now.m, now.d);
    const byDay = new Map();
    for (const entry of entries()) {
      if (!byDay.has(entry.key)) byDay.set(entry.key, []);
      byDay.get(entry.key).push(entry);
    }
    const first = new Date(Date.UTC(y, m, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const weeks = Math.ceil((lead + daysIn) / 7);
    let body = '';
    for (let w = 0; w < weeks; w += 1) {
      body += '<tr>';
      for (let d = 0; d < 7; d += 1) {
        const date = new Date(Date.UTC(y, m, 1 - lead + w * 7 + d));
        const cy = date.getUTCFullYear();
        const cm = date.getUTCMonth();
        const cd = date.getUTCDate();
        const key = dayKey(cy, cm, cd);
        const outside = cm !== m;
        const list = byDay.get(key) || [];
        const label = `${WEEKDAYS[d]} ${cd} ${MONTHS[cm]}${list.length ? `, ${plural(list.length, 'post')}` : ''}`;
        body += `<td class="${outside ? 'is-outside' : ''}${key === todayKey ? ' is-today' : ''}">
          <span class="bm-cal__day"><time datetime="${key}" aria-label="${label}">${cd}</time></span>
          ${list.map((entry) => entryButton(entry, 'cell')).join('')}
        </td>`;
      }
      body += '</tr>';
    }
    const monthEntries = [...byDay.entries()].filter(([key]) => key.startsWith(`${y}-${pad(m + 1)}-`)).sort(([a], [b]) => a.localeCompare(b));
    const agenda = monthEntries.map(([key, list]) => {
      const [, , dd] = key.split('-').map(Number);
      const dow = (new Date(Date.UTC(y, m, dd)).getUTCDay() + 6) % 7;
      return `<li class="bm-agenda__day${key === todayKey ? ' is-today' : ''}">
        <h3 class="bm-agenda__date"><span class="bm-agenda__dow">${WEEKDAYS[dow].slice(0, 3)}</span><span>${dd} ${MONTHS[m].slice(0, 3)}</span>${key === todayKey ? '<span class="bm-agenda__today">Today</span>' : ''}</h3>
        <div class="bm-agenda__posts">${list.map((entry) => entryButton(entry, 'agenda')).join('')}</div>
      </li>`;
    }).join('');
    const monthCount = monthEntries.reduce((sum, [, list]) => sum + list.length, 0);
    const scheduledCount = monthEntries.reduce((sum, [, list]) => sum + list.filter((e) => e.state === 'scheduled').length, 0);
    const isThisMonth = y === now.y && m === now.m;
    // An empty month says so once, in .bm-cal__empty below the grid.
    const summary = monthCount
      ? `${plural(monthCount, 'post')}${scheduledCount ? `, ${scheduledCount} still to go live` : ''}`
      : '';

    const focused = document.activeElement;
    const refocus = focused && wrap.contains(focused) ? (focused.dataset.cal || null) : null;
    wrap.innerHTML = `
      <header class="bm-cal__head">
        <div class="bm-cal__heading">
          <h2 class="bm-cal__month" aria-live="polite">${MONTHS[m]} <span>${y}</span></h2>
          ${summary ? `<p class="bm-cal__summary">${summary}</p>` : ''}
        </div>
        <div class="bm-cal__nav">
          <button type="button" class="icon-button" data-cal="prev" aria-label="Previous month">${iconFor(null)('left')}</button>
          <button type="button" class="button button--quiet" data-cal="today"${isThisMonth ? ' aria-disabled="true"' : ''}>Today</button>
          <button type="button" class="icon-button" data-cal="next" aria-label="Next month">${iconFor(null)('right')}</button>
        </div>
      </header>
      <div class="bm-cal__frame">
        <table class="bm-cal__grid">
          <caption class="bm-vh">${MONTHS[m]} ${y}, India time</caption>
          <thead><tr>${WEEKDAYS.map((day) => `<th scope="col"><abbr title="${day}">${day.slice(0, 3)}</abbr></th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <ol class="bm-cal__agenda">${agenda}</ol>
      ${monthCount ? '' : `<p class="bm-cal__empty">Nothing in ${MONTHS[m]} yet. Scheduled posts appear here on their day.</p>`}
      <p class="bm-cal__foot">Scheduled posts go live within about 30 minutes of the set time. All times are India time (IST).</p>`;
    if (refocus) wrap.querySelector(`[data-cal="${refocus}"]`)?.focus({ preventScroll: true });
  };

  const onClick = (event) => {
    const open = event.target.closest('[data-open]');
    if (open && wrap.contains(open)) {
      if (typeof onOpen === 'function') onOpen(open.dataset.open);
      return;
    }
    const nav = event.target.closest('[data-cal]');
    if (!nav) return;
    const now = today();
    if (nav.dataset.cal === 'today') cursor = { y: now.y, m: now.m };
    else {
      const step = nav.dataset.cal === 'prev' ? -1 : 1;
      const d = new Date(Date.UTC(cursor.y, cursor.m + step, 1));
      cursor = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    }
    render();
  };
  wrap.addEventListener('click', onClick);
  render();

  return {
    refresh(next) {
      if (next !== undefined) source = next;
      render();
    },
    destroy() {
      wrap.removeEventListener('click', onClick);
      wrap.remove();
      if (!root.querySelector('.bm-settings, .bm-cal, .bm-alert-wrap')) root.classList.remove('bm');
    },
  };
}

// ======================================================= mountScheduleAlert
const SCHEDULE_WORKFLOW = 'blog-schedule.yml';
// Every alert on the page (the Blog tab's, and app.js's compact banner on the
// other tabs) shows the same known state: each successful read is broadcast.
const SCHEDULE_EVENT = 'bm:schedule-state';

export function mountScheduleAlert(root, { gh, posts, compact = false } = {}) {
  root.classList.add('bm');
  const wrap = document.createElement('div');
  wrap.className = 'bm-alert-wrap';
  root.append(wrap);
  let destroyed = false;
  let timer = 0;
  const pauseIcon = iconFor(null)('pause');

  const clear = () => { wrap.innerHTML = ''; };

  // Posts still to go live, which wait on the scheduler (a scheduled post whose
  // time has passed counts as published, as everywhere else).
  const waiting = () => listOf(posts).filter((post) => post.status === 'scheduled' && !isLive(post)).length;

  const paused = (state) => {
    const n = waiting();
    const count = n ? ` ${n === 1 ? '1 scheduled post is' : `${n} scheduled posts are`} waiting.` : '';
    const reason = state === 'disabled_manually'
      ? 'Someone switched automatic publishing off.'
      : 'Automatic publishing switches itself off after 60 days with no changes to the website.';
    const copy = compact
      ? `<strong>Scheduled posts are on hold.</strong> Automatic publishing is switched off.${count}`
      : `<strong>Scheduled posts are on hold.</strong> ${reason}${count} Turn it back on so ${n ? (n === 1 ? 'it goes' : 'they go') : 'scheduled posts go'} live on time.`;
    wrap.innerHTML = `<div class="bm-alert${compact ? ' bm-alert--compact' : ''}" role="status" data-state="${escapeHtml(state)}">
      <span class="bm-alert__icon">${pauseIcon}</span>
      <div class="bm-alert__copy">
        <p>${copy}</p>
        <p class="bm-alert__error" data-alert-error hidden></p>
      </div>
      <button type="button" class="button bm-alert__action" data-alert-enable>Turn it back on</button>
    </div>`;
  };

  const show = (state) => {
    if (!state || state === 'active' || state === 'missing') clear();
    else paused(state);
  };
  const onState = (event) => {
    if (destroyed || event.detail?.from === wrap) return;
    clearTimeout(timer);
    show(event.detail?.state);
  };
  document.addEventListener(SCHEDULE_EVENT, onState);

  // A read error stays quiet here (nothing known to show) and is not broadcast.
  const check = async () => {
    let state;
    try {
      state = await gh.workflowState(SCHEDULE_WORKFLOW);
    } catch (error) {
      console.warn('[blog] Could not read the publishing schedule:', error);
      if (!destroyed) clear();
      return null;
    }
    if (destroyed) return state;
    if (state === 'missing') console.info(`[blog] ${SCHEDULE_WORKFLOW} is not on the branch; no schedule alert.`);
    show(state);
    document.dispatchEvent(new CustomEvent(SCHEDULE_EVENT, { detail: { state, from: wrap } }));
    return state;
  };

  // retry false: pressing the button again can't help (the sign-in or its
  // access is the problem), so it goes and the message says what will.
  const showError = (message, { retry = true } = {}) => {
    const box = wrap.querySelector('[data-alert-error]');
    const button = wrap.querySelector('[data-alert-enable]');
    if (box) { box.textContent = message; box.hidden = false; }
    if (button && retry) { button.disabled = false; button.textContent = 'Try again'; }
    else if (button) button.remove();
  };

  const enable = async (button) => {
    button.disabled = true;
    button.textContent = 'Turning it on…';
    const box = wrap.querySelector('[data-alert-error]');
    if (box) box.hidden = true;
    try {
      await gh.enableWorkflow(SCHEDULE_WORKFLOW);
    } catch (error) {
      if (destroyed) return;
      console.warn('[blog] Could not turn the publishing schedule back on:', error);
      // The admin's sign-in is the passcode on the Lock screen (app.js): after
      // Lock, Unlock checks the saved sign-in with GitHub again.
      if (error?.name === 'AuthError' || error?.status === 401) {
        showError('GitHub stopped accepting your sign-in. Press Lock at the top, then unlock with your passcode. If that doesn’t work, choose “Forget this device” and set it up again.', { retry: false });
      } else if ((error?.status === 403 && !/rate limit/i.test(String(error.message))) || error?.status === 404) {
        showError('Your login can’t switch automatic publishing back on. Ask the person who set up the website to do it.', { retry: false });
      } else {
        showError('That didn’t go through. Check the connection and try again.');
      }
      return;
    }
    if (destroyed) return;
    // Re-check: active → a short confirmation; still paused → the banner again
    // with a note; missing or unreadable → check() has already cleared it.
    const state = await check();
    if (destroyed) return;
    if (state === 'active') {
      wrap.innerHTML = `<div class="bm-alert bm-alert--done" role="status">
        <span class="bm-alert__icon">${iconFor(null)('check')}</span>
        <div class="bm-alert__copy"><p><strong>Scheduled posts are back on.</strong> Anything already due goes live within about 30 minutes.</p></div>
      </div>`;
      timer = setTimeout(() => { if (!destroyed) clear(); }, 8000);
    } else if (state && state !== 'missing') {
      showError('The change hasn’t come through yet. Give it a minute, then try again.');
    }
  };

  const onClick = (event) => {
    const button = event.target.closest('[data-alert-enable]');
    if (button && !button.disabled) enable(button);
  };
  wrap.addEventListener('click', onClick);
  if (gh && typeof gh.workflowState === 'function') check();
  else console.warn('[blog] Schedule alert mounted without a GitHub client.');

  return {
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      document.removeEventListener(SCHEDULE_EVENT, onState);
      wrap.removeEventListener('click', onClick);
      wrap.remove();
      if (!root.querySelector('.bm-settings, .bm-cal, .bm-alert-wrap')) root.classList.remove('bm');
    },
  };
}
