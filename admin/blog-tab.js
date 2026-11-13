// The Blog tab (lane W5a): the posts list, the layout picker, and the post view
// that hosts the editor (blog-editor.js), the SEO panel / preview / history
// (blog-seo.js) and the settings + calendar views (blog-manage.js).
// Cross-file contracts: AGENTS.md "The blog".
//
// While a post is open, ONE in-memory object (cur.post) is the truth. Components
// read it with getPost() and write with onChange(patch); this file autosaves it to
// the private drafts store (drafts-api.js, the API worker's D1) ~1.5 s after the
// last change, guarded by If-Match versions. Draft photos live there too, as
// `draft:<name>`; at publish they are rewritten to assets/blog/<slug>/<name> and
// staged into the SAME commit as data/blog/posts.json, through app.js's publish().
// A failed or blocked publish puts posts.json and the staged files back exactly as
// they were, so nothing half-published lingers in the unsaved bar.
//
// The tab keeps its own DOM node (host) across app.js re-renders, so an open
// editor keeps its caret, undo history and pending autosave when the owner visits
// another tab and comes back. Its events are handled here; app.js skips them.

import './content-rules.js';
import './blog-blocks.js';
import { ASSET_MAX_BYTES, createDraftsApi } from './drafts-api.js';
import { intakeImage } from './image-intake.js';

const rules = globalThis.MediVascContentRules;
const blogBlocks = () => globalThis.MediVascBlogBlocks || {};

const AUTOSAVE_MS = 1500;
const RETRY_MS = 8000;
const IST = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const narrowQuery = matchMedia('(max-width: 899px)');

const LAYOUTS = [
  { id: 'editorial', name: 'Editorial', note: 'Headline, photo, then the story. The everyday article.' },
  { id: 'cover', name: 'Cover', note: 'A full-width photo with the headline set over it.' },
  { id: 'split', name: 'Split', note: 'Headline and photo side by side, for a strong image.' },
  { id: 'guide', name: 'Guide', note: 'A long how-to, with a contents list beside the text.' },
];
const STATUS = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', unpublished: 'Unpublished' };
const STATUS_FILTERS = [['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['unpublished', 'Unpublished']];
const VIEWS = [['list', 'Posts'], ['calendar', 'Calendar'], ['settings', 'Settings']];
const PANES = [['write', 'Write'], ['settings', 'Post settings'], ['seo', 'SEO'], ['preview', 'Preview'], ['history', 'History']];

// Literal specifiers (V4's copyAdmin versions literal module paths).
const MODULES = {
  editor: () => import('./blog-editor.js'),
  seo: () => import('./blog-seo.js'),
  manage: () => import('./blog-manage.js'),
};

// ---------------------------------------------------------------- small helpers

const randomId = (length) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
};
const clone = (value) => structuredClone(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validTime = (iso) => Number.isFinite(Date.parse(iso || ''));
// ISO with the India offset, e.g. 2026-11-20T09:00:00+05:30.
const istIso = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19) + '+05:30';
const istDate = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
// <input type="datetime-local"> holds India wall-clock time, whatever the device's zone.
const toLocalInput = (iso) => (validTime(iso) ? new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(0, 16) : '');
const fromLocalInput = (value) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value + ':00+05:30' : '');
const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: 'numeric', month: 'short' });
const yearFormat = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
const clockFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortDate = (ms) => (new Date(ms).getFullYear() === new Date().getFullYear() ? dayFormat : yearFormat).format(ms);
const whenIst = (iso) => (validTime(iso) ? shortDate(Date.parse(iso)) + ', ' + timeFormat.format(Date.parse(iso)).toLowerCase() + ' IST' : '');
const slugify = (text) => (typeof blogBlocks().slugify === 'function'
  ? blogBlocks().slugify(String(text || ''))
  : String(text || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, ''));
const draftName = (src) => (typeof src === 'string' && src.startsWith('draft:') ? src.slice(6) : null);
// Every string in a value, rewritten by fn (asset paths are stored verbatim).
const mapStrings = (value, fn) => {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]));
  return value;
};
// A post that may have been seen by readers: its old address must keep working.
const everLive = (live) => Boolean(live) && (live.status === 'published' || live.status === 'unpublished' ||
  (live.status === 'scheduled' && validTime(live.publishAt) && Date.parse(live.publishAt) <= Date.now()));
// "Blog post “X”: the image …" → "The image …", "Blog post “X” needs …" → "This post needs …".
const ownWords = (message) => {
  const match = /^Blog post (?:“[^”]*”|\d+)(,\s*|:\s*|\s+)/.exec(message);
  if (!match) return message;
  const rest = message.slice(match[0].length);
  return match[1].trim() ? rest.charAt(0).toUpperCase() + rest.slice(1) : 'This post ' + rest;
};

// The type settings validateBlogPosts requires on every post.
// A new post starts with them; a post from before they existed (an older D1 draft,
// a restored revision) gets the same values filled in when it is opened.
const styleDefaults = (layout) => ({ titleSize: 'L', bodySize: 'M', leadIn: layout === 'guide' ? 'none' : 'dropcap' });
const withStyle = (post) => {
  if (!isObject(post)) return post;
  const out = { ...post };
  for (const [key, value] of Object.entries(styleDefaults(post.layout))) if (out[key] == null) out[key] = value;
  return out;
};

const blankPost = (layout, config) => ({
  id: 'p_' + randomId(6),
  slug: '',
  previousSlugs: [],
  status: 'unpublished',
  publishAt: '',
  lang: 'en',
  layout,
  category: (config.categories || [])[0]?.id || '',
  title: '',
  titleAccent: '',
  dek: '',
  ...styleDefaults(layout),
  cover: { src: '', alt: '', caption: '', credit: '', focal: { x: 0.5, y: 0.5 }, patient: false },
  author: (config.authors || [])[0]?.id || '',
  reviewer: null,
  reviewedAt: null,
  about: [],
  seo: { title: '', description: '', focusKeyphrase: '', keywords: [] },
  related: [],
  blocks: [{ type: 'paragraph', text: '' }],
  references: [],
});

// Small CSS-drawn schematic of each layout (the picker and the empty state).
const layoutArt = (id) => {
  const i = (cls) => '<i class="' + cls + '"></i>';
  const lines = (n) => Array.from({ length: n }, (_, k) => i('a-line' + (k === n - 1 ? ' a-line--short' : ''))).join('');
  const parts = {
    editorial: i('a-kick') + i('a-title') + i('a-title a-title--short') + i('a-img') + lines(3),
    cover: '<span class="a-cover">' + i('a-kick') + i('a-title') + i('a-title a-title--short') + '</span>' + lines(2),
    split: '<span class="a-col">' + i('a-kick') + i('a-title') + i('a-title') + i('a-title a-title--short') + lines(2) + '</span>' + i('a-img'),
    guide: i('a-kick') + i('a-title') + i('a-title a-title--short') + '<span class="a-guide"><span class="a-toc">' + i('a-dot') + i('a-dot') + i('a-dot') + i('a-dot') + '</span><span class="a-body">' + lines(5) + '</span></span>',
  };
  return '<span class="bt-art" data-layout="' + id + '" aria-hidden="true">' + parts[id] + '</span>';
};

// ---------------------------------------------------------------- the tab

/**
 * @param {object} ctx from app.js: { state, h, icon, markDirty, clearDirty, renderUnsaved,
 *   showStatus, stageBlob, committedAssetUrl, publish({ message }) → Promise<boolean>,
 *   otherUnsavedTabs() → [tab names], apiBase(), sessionToken() }
 * @returns {{ mount(root), owns(node), hasUnsavedDraft() }}
 */
export const createBlogTab = (ctx) => {
  const { state, h, icon, showStatus } = ctx;
  let draftsApi = null;
  const api = () => (draftsApi ||= createDraftsApi({ endpoint: ctx.apiBase(), getToken: () => ctx.sessionToken() }));

  const host = document.createElement('div');
  host.className = 'bt';
  host.dataset.blogRoot = '';
  host.innerHTML = '<div class="bt-alert-slot"></div><div class="bt-view"></div>';
  const alertSlot = host.firstElementChild;
  const viewEl = host.lastElementChild;

  const tab = { view: 'list', filter: { status: 'all', category: 'all', q: '' }, mounted: false };
  let draftList = null; // drafts-api list() rows; null until the first load
  let draftsError = null;
  let draftsLoading = null;
  const draftPosts = new Map(); // id -> { updated_at, post, assets }
  const assetUrls = new Map(); // 'id/name' -> object URL
  const assetLoads = new Map(); // 'id/name' -> pending promise
  const contexts = new Set(); // open or still-saving post contexts
  let cur = null; // the open post
  let viewParts = {}; // settings / calendar component handles
  let alert = { handle: null, api: null };
  let busy = false;
  let seenPosts = null;

  // ---------------------------------------------------------------- data

  const posts = () => (Array.isArray(state.draft.blogPosts) ? state.draft.blogPosts.filter(isObject) : []);
  const config = () => (isObject(state.draft.blogConfig) ? state.draft.blogConfig : { categories: [], authors: [] });
  const films = () => (Array.isArray(state.draft.films) ? state.draft.films : []);
  const categories = () => (Array.isArray(config().categories) ? config().categories.filter(isObject) : []);
  const authors = () => (Array.isArray(config().authors) ? config().authors.filter(isObject) : []);
  const categoryById = (id) => categories().find((category) => category.id === id);
  // The preview's call-to-action hrefs, from the company draft exactly as the build
  // makes ctx.contactHref (src/template.js contactHrefs), at the blog's depth '../'.
  const contactHref = () => {
    const company = isObject(state.draft.company) ? state.draft.company : {};
    const message = String(state.draft.content?.cta?.message || '');
    const dial = (value) => (typeof rules?.readPhone === 'function' ? rules.readPhone(value).number : '');
    return {
      whatsapp: company.whatsapp ? 'https://wa.me/' + dial(company.whatsapp).replace('+', '') + '?text=' + encodeURIComponent(message) : '',
      call: company.phone ? 'tel:' + dial(company.phone) : '',
      contact: '../#contact',
    };
  };

  // posts.json entries merged with the private drafts (same id = edits to a live post).
  const entries = () => {
    const map = new Map();
    for (const post of posts()) if (post.id) map.set(post.id, { id: post.id, live: post, draft: null });
    for (const meta of draftList || []) {
      const entry = map.get(meta.id) || { id: meta.id, live: null, draft: null };
      entry.draft = meta;
      map.set(meta.id, entry);
    }
    return [...map.values()].map((entry) => ({ ...entry, post: draftPosts.get(entry.id)?.post || entry.live || null }));
  };
  const statusOf = (entry) => (entry.live ? entry.live.status : 'draft');
  // Sort key: a post scheduled ahead sorts by its date, so upcoming posts lead.
  const updatedOf = (entry) => Math.max(entry.draft?.updated_at || 0, Date.parse(entry.live?.updatedAt || '') || 0, Date.parse(entry.live?.publishAt || '') || 0);
  // The row's date line: the last real change. A publish date still ahead is not
  // one (it would read "Updated 16 Nov" on the 13th; the status already shows it).
  const touchedOf = (entry) => {
    const publishAt = Date.parse(entry.live?.publishAt || '') || 0;
    return Math.max(entry.draft?.updated_at || 0, Date.parse(entry.live?.updatedAt || '') || 0, publishAt <= Date.now() ? publishAt : 0);
  };
  const titleOf = (entry) => String(entry.post?.title || entry.draft?.title || '').trim();
  // Every post the components should know about: live ones as published, plus drafts.
  const allPosts = () => entries().map((entry) => {
    if (entry.live) return entry.live;
    return { ...(entry.post || { id: entry.id, slug: entry.draft?.slug || '', title: entry.draft?.title || '' }), status: 'draft' };
  });

  const noteDraft = (id, post, updatedAt) => {
    draftPosts.set(id, { updated_at: updatedAt, post: clone(post), assets: draftPosts.get(id)?.assets || [] });
    const meta = { id, slug: post.slug || '', title: post.title || '', updated_at: updatedAt };
    draftList = [meta, ...(draftList || []).filter((row) => row.id !== id)];
  };
  const forgetDraft = (id) => {
    draftPosts.delete(id);
    if (draftList) draftList = draftList.filter((row) => row.id !== id);
  };

  const refreshDrafts = () => {
    draftsLoading ||= (async () => {
      try {
        const list = await api().list();
        await Promise.all(list.map(async (meta) => {
          if (draftPosts.get(meta.id)?.updated_at === meta.updated_at) return;
          try {
            const got = await api().get(meta.id);
            draftPosts.set(meta.id, { updated_at: got.updated_at, post: got.post, assets: got.assets || [] });
          } catch {
            // Listed but unreadable right now: the row still shows its title.
          }
        }));
        draftList = list;
        draftsError = null;
      } catch (error) {
        draftsError = error;
      } finally {
        draftsLoading = null;
      }
      if (tab.view === 'list') paintList();
    })();
    return draftsLoading;
  };

  // ---------------------------------------------------------------- images

  const assetKey = (id, name) => id + '/' + name;
  const loadAsset = (id, name) => {
    const key = assetKey(id, name);
    if (assetUrls.has(key)) return Promise.resolve(assetUrls.get(key));
    if (!assetLoads.has(key)) {
      assetLoads.set(key, api().assetUrl(id, name)
        .then((url) => { assetUrls.set(key, url); return url; })
        .catch(() => null)
        .finally(() => assetLoads.delete(key)));
    }
    return assetLoads.get(key);
  };
  const releaseAssets = (id) => {
    for (const [key, url] of assetUrls) {
      if (key.startsWith(id + '/')) {
        URL.revokeObjectURL(url);
        assetUrls.delete(key);
      }
    }
  };
  // A committed asset: the staged copy if one is waiting to publish, else the repo
  // copy (served next to the admin when running locally).
  const committedUrl = (path) => state.assetPreviews.get(path) ||
    (LOCAL ? new URL('../' + path, location.href).href : ctx.committedAssetUrl(path));
  const resolveFor = (id, src, onLoaded) => {
    if (!src || typeof src !== 'string') return '';
    const name = draftName(src);
    if (name !== null) {
      const url = assetUrls.get(assetKey(id, name));
      if (url) return url;
      loadAsset(id, name).then((loaded) => { if (loaded && onLoaded) onLoaded(loaded); });
      return '';
    }
    if (/^(https?:|blob:|data:)/.test(src)) return src;
    return committedUrl(src.replace(/^\/+/, ''));
  };
  const prefetchAssets = (id, assets) => Promise.all((assets || []).map((asset) => loadAsset(id, asset.name)));
  const assetBlob = async (id, name) => {
    const url = await loadAsset(id, name);
    if (!url) throw new Error('A photo in this post (' + name + ') could not be read from the drafts store. Add it again, then publish.');
    return (await fetch(url)).blob();
  };

  // ---------------------------------------------------------------- components

  const loadedModules = {};
  const loadModule = (name) => {
    loadedModules[name] ||= MODULES[name]().catch((error) => {
      console.warn('[blog] ' + name + ' module did not load', error);
      delete loadedModules[name];
      return null;
    });
    return loadedModules[name];
  };
  const placeholder = (el, what) => {
    el.innerHTML = '<div class="bt-placeholder" role="note"><strong>' + h(what) + ' isn’t available right now</strong>' +
      '<span>Reload the page to try again. Your draft is safe.</span></div>';
  };
  // Mount one component; a missing module or a throwing mount leaves a calm note.
  const mountPart = async (module, exportName, el, options, label, stillWanted) => {
    const mod = await loadModule(module);
    if (!stillWanted()) return null;
    const factory = mod && mod[exportName];
    if (typeof factory !== 'function') {
      placeholder(el, label);
      return null;
    }
    try {
      el.replaceChildren();
      return factory(el, options) || null;
    } catch (error) {
      console.warn('[blog] ' + exportName + ' failed', error);
      placeholder(el, label);
      return null;
    }
  };
  const call = (handle, method, ...args) => {
    try {
      return handle && typeof handle[method] === 'function' ? handle[method](...args) : undefined;
    } catch (error) {
      console.warn('[blog] ' + method + ' failed', error);
      return undefined;
    }
  };

  // ---------------------------------------------------------------- shared markup

  const chip = (action, value, label, pressed, extra = {}) => '<button class="bt-chip" type="button" data-bt="' + action + '" data-value="' + h(value) + '" aria-pressed="' + String(Boolean(pressed)) + '"' +
    (extra.tint ? ' data-tint="' + h(extra.tint) + '"' : '') + (extra.attrs || '') + '>' +
    (extra.tint ? '<span class="bt-dot" aria-hidden="true"></span>' : '') + h(label) +
    (extra.count != null ? '<span class="bt-chip__n">' + extra.count + '</span>' : '') + '</button>';
  const tintChip = (category) => '<span class="bt-tint" data-tint="' + h(category.tint || 'slate') + '">' + h(category.name) + '</span>';
  // `publishedOn` (a list row of a live post with no pending edits): the status and
  // its date are one line, "● Published 4 Nov", read once by a screen reader.
  const statusChip = (status, publishAt, publishedOn = '') => (publishedOn
    ? '<span class="bt-status bt-status--dated" data-status="published">Published ' + h(publishedOn) + '</span>'
    : '<span class="bt-status" data-status="' + h(status) + '"><span>' + h(STATUS[status] || 'Draft') +
      (status === 'scheduled' && validTime(publishAt) ? '<span class="bt-status__when"> · ' + h(whenIst(publishAt)) + '</span>' : '') + '</span></span>');

  // DOM order = reading order (WCAG 2.4.3): kicker, title, then New post (it sits on
  // the title's row), the intro, then the view tabs right above the filters. The
  // grid areas in blog-admin.css place each child; there are no wrappers to reorder.
  const toolbar = () => '<div class="bt-head"><p class="auth-kicker">' + h(config().name || 'Blog') + '</p><h1>Blog</h1>' +
    '<button class="button button--primary bt-head__new" type="button" data-bt="new">' + icon('plus') + 'New post</button>' +
    '<p class="bt-head__intro">Write, schedule and publish articles. A post stays a private draft until you publish it.</p>' +
    '<div class="bt-seg" role="group" aria-label="Blog views">' +
    VIEWS.map(([view, label]) => '<button type="button" data-bt="view" data-value="' + view + '" aria-pressed="' + String(tab.view === view) + '">' + label + '</button>').join('') +
    '</div></div>';

  // ---------------------------------------------------------------- list view

  const thumb = (entry) => {
    const url = resolveFor(entry.id, entry.post?.cover?.src, (loaded) => {
      const slot = viewEl.querySelector('[data-thumb="' + CSS.escape(entry.id) + '"]');
      if (slot) slot.innerHTML = '<img src="' + h(loaded) + '" alt="">';
    });
    return '<span class="bt-thumb" data-thumb="' + h(entry.id) + '">' + (url ? '<img src="' + h(url) + '" alt="" loading="lazy">' : '<span class="bt-thumb__empty"></span>') + '</span>';
  };

  const rowHtml = (entry) => {
    const status = statusOf(entry);
    const post = entry.post || {};
    const category = categoryById(post.category);
    const updated = touchedOf(entry);
    const title = titleOf(entry);
    const publishedOn = status === 'published' && !entry.draft && updated ? shortDate(updated) : '';
    return '<li><button class="bt-row" type="button" data-bt="open" data-id="' + h(entry.id) + '">' + thumb(entry) +
      '<span class="bt-row__body"><span class="bt-row__title' + (title ? '' : ' bt-row__title--empty') + '">' + h(title || 'Untitled post') + '</span>' +
      '<span class="bt-row__meta">' + (category ? tintChip(category) : '') +
      (post.slug ? '<span class="bt-row__slug">blog/' + h(post.slug) + '/</span>' : '') + '</span></span>' +
      '<span class="bt-row__side">' + statusChip(status, entry.live?.publishAt, publishedOn) +
      (entry.live && entry.draft ? '<span class="bt-edits">Unpublished edits</span>' : '') +
      (updated && !publishedOn ? '<span class="bt-row__date">Updated ' + h(shortDate(updated)) + '</span>' : '') +
      '</span></button></li>';
  };

  const filtered = (all) => {
    const q = tab.filter.q.trim().toLowerCase();
    return all
      .filter((entry) => tab.filter.status === 'all' || statusOf(entry) === tab.filter.status)
      .filter((entry) => tab.filter.category === 'all' || entry.post?.category === tab.filter.category)
      .filter((entry) => !q || (titleOf(entry) + ' ' + (entry.post?.slug || '')).toLowerCase().includes(q))
      .sort((a, b) => updatedOf(b) - updatedOf(a));
  };

  const rowsHtml = (all) => {
    const rows = filtered(all);
    if (!rows.length) {
      return '<div class="bt-none"><p>No posts match these filters.</p><button class="button button--quiet" type="button" data-bt="clear-filters">Show all posts</button></div>';
    }
    return '<ul class="bt-rows" data-testid="blog-list">' + rows.map(rowHtml).join('') + '</ul>';
  };

  // No kicker here: the page head right above already names the journal.
  const emptyHtml = () => '<div class="bt-empty">' + layoutArt('editorial') + '<h2>Write the first article</h2>' +
    '<p>Choose a layout, write in plain words, and add photos straight from your phone. It stays a private draft until you publish it.</p>' +
    '<button class="button button--primary" type="button" data-bt="new">' + icon('plus') + 'Start a post</button></div>';

  const draftsNote = () => {
    if (draftsError) {
      return '<div class="notice notice--warning bt-note" role="alert"><strong>Drafts didn’t load.</strong> ' + h(draftsError.message) +
        ' <button class="button button--text bt-inline" type="button" data-bt="retry-drafts">Try again</button></div>';
    }
    return draftList === null ? '<p class="bt-loading" role="status">Loading drafts…</p>' : '';
  };

  const paintList = () => {
    if (tab.view !== 'list') return;
    const all = entries();
    const counts = { all: all.length };
    for (const entry of all) counts[statusOf(entry)] = (counts[statusOf(entry)] || 0) + 1;
    if (tab.filter.status !== 'all' && !counts[tab.filter.status]) tab.filter.status = 'all';
    if (tab.filter.category !== 'all' && !categoryById(tab.filter.category)) tab.filter.category = 'all';
    let body;
    if (!all.length && draftList !== null) body = draftsNote() + emptyHtml();
    else {
      const statusChips = STATUS_FILTERS.filter(([key]) => key === 'all' || counts[key])
        .map(([key, label]) => chip('filter-status', key, label, tab.filter.status === key, { count: counts[key] || 0 })).join('');
      const categoryChips = chip('filter-category', 'all', 'All categories', tab.filter.category === 'all') +
        categories().map((category) => chip('filter-category', category.id, category.name, tab.filter.category === category.id, { tint: category.tint || 'slate' })).join('');
      body = draftsNote() + '<div class="bt-filters"><div class="bt-chips" role="group" aria-label="Filter by status">' + statusChips + '</div>' +
        '<label class="bt-search">' + icon('search') + '<span class="visually-hidden">Search posts</span><input type="search" data-bt-search placeholder="Search posts" value="' + h(tab.filter.q) + '" autocomplete="off"></label></div>' +
        (categories().length ? '<div class="bt-chips bt-chips--cats" role="group" aria-label="Filter by category">' + categoryChips + '</div>' : '') +
        '<div data-bt-rows>' + rowsHtml(all) + '</div>';
    }
    const focused = document.activeElement && viewEl.contains(document.activeElement) ? document.activeElement : null;
    const key = focused && focused.dataset.bt ? '[data-bt="' + focused.dataset.bt + '"][data-value="' + CSS.escape(focused.dataset.value || '') + '"]' : null;
    viewEl.innerHTML = '<section class="bt-list">' + toolbar() + body + '</section>';
    if (key) viewEl.querySelector(key)?.focus();
  };

  const paintRows = () => {
    const slot = viewEl.querySelector('[data-bt-rows]');
    if (slot) slot.innerHTML = rowsHtml(entries());
  };

  // ---------------------------------------------------------------- picker view

  const paintPicker = () => {
    viewEl.innerHTML = '<section class="bt-picker"><div class="editor-header"><div><p class="auth-kicker">New post</p><h1>Choose a layout</h1>' +
      '<p class="bt-sub">It sets how the top of the article looks. You can change it later in Post settings.</p></div>' +
      '<button class="button button--quiet" type="button" data-bt="view" data-value="list">Cancel</button></div>' +
      '<div class="bt-layouts">' + LAYOUTS.map((layout) => '<button class="bt-layout" type="button" data-bt="create" data-value="' + layout.id + '">' +
        layoutArt(layout.id) + '<span class="bt-layout__name">' + h(layout.name) + '</span><span class="bt-layout__note">' + h(layout.note) + '</span></button>').join('') +
      '</div></section>';
    viewEl.querySelector('.bt-layout')?.focus();
  };

  // ---------------------------------------------------------------- settings / calendar views

  const destroyViewParts = () => {
    for (const handle of Object.values(viewParts)) call(handle, 'destroy');
    viewParts = {};
  };

  const movePosts = async (from, to) => {
    let moved = 0;
    const next = posts().map((post) => {
      if (post.category !== from) return post;
      moved += 1;
      return { ...post, category: to };
    });
    if (moved) {
      state.draft.blogPosts = next;
      ctx.markDirty('blogPosts');
    }
    if (cur && cur.post.category === from) change(cur, { category: to }, 'settings');
    let failed = 0;
    for (const meta of draftList || []) {
      if (cur && meta.id === cur.id) continue;
      const cached = draftPosts.get(meta.id);
      if (!cached || cached.post.category !== from) continue;
      try {
        const post = { ...cached.post, category: to };
        const saved = await api().save(meta.id, post, cached.updated_at);
        noteDraft(meta.id, post, saved.updated_at);
        moved += 1;
      } catch {
        failed += 1;
      }
    }
    if (failed) showStatus('Some drafts kept the old category', failed + ' draft' + (failed === 1 ? '' : 's') + ' could not be updated. Open ' + (failed === 1 ? 'it' : 'them') + ' and choose a category.');
    return moved;
  };

  const paintManaged = async (view) => {
    destroyViewParts();
    viewEl.innerHTML = '<section class="bt-list">' + toolbar() + '<div class="bt-managed" data-part="' + view + '"><p class="bt-loading">Opening…</p></div></section>';
    const el = viewEl.querySelector('[data-part]');
    const wanted = () => tab.view === view && el.isConnected;
    const handle = view === 'settings'
      ? await mountPart('manage', 'mountBlogSettings', el, {
        getConfig: () => state.draft.blogConfig,
        onChange: (next) => {
          state.draft.blogConfig = next;
          ctx.markDirty('blogConfig');
        },
        posts: allPosts,
        stageAsset,
        unstageAsset: (src) => ctx.unstageAsset?.(src),
        onMovePosts: movePosts,
        h,
        icon,
      }, 'Blog settings', wanted)
      : await mountPart('manage', 'mountCalendar', el, { posts: allPosts, onOpen: (id) => openPost(id) }, 'The calendar', wanted);
    if (handle) viewParts[view] = handle;
  };

  // Blog settings photos (authors) are committed files, not drafts: they are
  // staged straight into the next publish. The pinned form is
  // stageAsset(file, { purpose }) → { src }; an older (path, blob) call still works.
  // blog-manage.js has already resized the photo and named it <author-slug>.<ext>,
  // so the blob is staged as it is, at assets/blog/authors/<author-slug>.<ext>.
  // The same author uploading again lands on the same path, and the newer bytes
  // replace the staged ones (app.js stageEncoded keys staged files by path).
  const stageAsset = async (file, options) => {
    if (typeof file === 'string') {
      await ctx.stageBlob(file, options);
      return { src: file };
    }
    const purpose = /^[a-z]+$/.test(options?.purpose || '') ? options.purpose : 'author';
    const named = /^(.+)\.([a-z0-9]+)$/i.exec(String(file?.name || ''));
    const stem = named ? named[1].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) : '';
    const nameExt = named ? named[2].toLowerCase().replace(/^jpeg$/, 'jpg') : '';
    const typeExt = file?.type === 'image/webp' ? 'webp' : file?.type === 'image/png' ? 'png' : 'jpg';
    const ext = ['webp', 'jpg', 'png'].includes(nameExt) ? nameExt : typeExt;
    const src = 'assets/blog/' + (purpose === 'author' ? 'authors' : purpose) + '/' + (stem || purpose + '-' + randomId(8)) + '.' + ext;
    await ctx.stageBlob(src, file);
    return { src };
  };

  const mountAlert = async () => {
    if (!state.api || alert.api === state.api) return;
    call(alert.handle, 'destroy');
    alert = { handle: null, api: state.api };
    alertSlot.replaceChildren();
    const mod = await loadModule('manage');
    if (alert.api !== state.api || !mod || typeof mod.mountScheduleAlert !== 'function') return;
    try {
      alert.handle = mod.mountScheduleAlert(alertSlot, { gh: state.api }) || null;
    } catch (error) {
      console.warn('[blog] mountScheduleAlert failed', error);
    }
  };

  // ---------------------------------------------------------------- post view: autosave

  const paintSave = (c) => {
    if (c !== cur) return;
    const el = viewEl.querySelector('[data-bt-save]');
    if (!el) return;
    let html;
    let mode = c.saveState;
    if (mode === 'saving' || mode === 'pending') html = 'Saving…';
    else if (mode === 'saved' && c.savedAt) html = 'Saved · ' + clockFormat.format(c.savedAt);
    else if (mode === 'error') html = 'Not saved <button class="button button--text bt-inline" type="button" data-bt="retry-save">Retry</button>';
    else if (mode === 'conflict') html = 'Changed elsewhere';
    else {
      mode = 'idle';
      html = c.hasDraft ? 'Saved' : c.live ? 'No unpublished edits' : 'Not saved yet';
    }
    el.dataset.state = mode;
    el.innerHTML = html;
    paintConflict(c);
    if (mode === 'error' && c.error) setNote(c, 'save', '<div class="notice notice--warning bt-note" role="alert"><strong>Your latest changes aren’t saved yet.</strong> ' + h(c.error.message) + '</div>');
    else setNote(c, 'save', '');
  };

  const scheduleSave = (c) => {
    c.dirty = true;
    if (c.saveState !== 'conflict') c.saveState = 'pending';
    clearTimeout(c.timer);
    c.timer = setTimeout(() => saveNow(c), AUTOSAVE_MS);
    contexts.add(c);
    paintSave(c);
  };

  const saveNow = async (c) => {
    clearTimeout(c.timer);
    c.timer = null;
    if (c.saving) {
      await c.saving;
      return c.dirty && c.saveState !== 'conflict' && c.saveState !== 'error' ? saveNow(c) : undefined;
    }
    if (!c.dirty || c.saveState === 'conflict') return undefined;
    c.dirty = false;
    const body = clone(c.post);
    const ifMatch = c.force ? '*' : c.version ?? null;
    c.saveState = 'saving';
    paintSave(c);
    c.saving = (async () => {
      try {
        const saved = await api().save(c.id, body, ifMatch);
        c.version = saved.updated_at;
        c.hasDraft = true;
        c.force = false;
        c.savedAt = Date.now();
        c.error = null;
        c.saveState = c.dirty ? 'pending' : 'saved';
        noteDraft(c.id, body, saved.updated_at);
      } catch (error) {
        c.dirty = true;
        c.error = error;
        if (error.code === 'conflict') {
          c.saveState = 'conflict';
          c.conflict = error;
        } else {
          c.saveState = 'error';
          if (error.code === 'network' || error.code === 'server') {
            clearTimeout(c.timer);
            c.timer = setTimeout(() => saveNow(c), RETRY_MS);
          }
        }
      } finally {
        c.saving = null;
        paintSave(c);
        if (c === cur) paintBar();
        if (!c.dirty && c !== cur) contexts.delete(c);
      }
    })();
    await c.saving;
    if (c.dirty && c.saveState === 'pending') scheduleSave(c);
    return undefined;
  };

  // Everything typed so far is in the drafts store (or the save failed and says so).
  const flushSave = async (c) => {
    for (let round = 0; round < 4 && (c.dirty || c.saving); round += 1) {
      if (c.saveState === 'conflict') return false;
      await saveNow(c);
      if (c.saveState === 'error') return false;
    }
    return !c.dirty;
  };

  const paintConflict = (c) => {
    if (c.saveState !== 'conflict') return setNote(c, 'conflict', '');
    const deleted = c.conflict && c.conflict.serverUpdatedAt == null;
    const who = c.conflict && c.conflict.updatedBy ? ' by ' + h(c.conflict.updatedBy) : '';
    setNote(c, 'conflict', '<div class="bt-conflict" role="alert"><div><strong>' +
      (deleted ? 'This draft was deleted on another device or tab.' : 'This draft was changed on another device or tab' + who + '.') + '</strong>' +
      '<span>' + (deleted ? 'Keep your copy to save it again, or close it.' : 'Choose which version to keep. Your edits here are not lost until you choose.') + '</span></div>' +
      '<div class="bt-conflict__actions"><button class="button button--primary" type="button" data-bt="keep-mine">Keep mine</button>' +
      (deleted ? '<button class="button button--quiet" type="button" data-bt="back">Close it</button>'
        : '<button class="button button--quiet" type="button" data-bt="load-theirs">Load theirs</button>') + '</div></div>');
  };

  const keepMine = async (c) => {
    c.force = true;
    c.saveState = 'pending';
    c.dirty = true;
    await saveNow(c);
  };

  const replacePost = async (c, post, { version = c.version, hasDraft = c.hasDraft, assets = [] } = {}) => {
    c.post = { ...withStyle(clone(post)), id: c.id };
    c.version = version;
    c.hasDraft = hasDraft;
    await prefetchAssets(c.id, assets);
    if (c !== cur) return;
    call(c.handles.editor, 'setPost', clone(c.post));
    call(c.handles.seo, 'refresh');
    call(c.handles.preview, 'refresh');
    paintSettings(c);
    paintBar();
  };

  const loadTheirs = async (c) => {
    try {
      const got = await api().get(c.id);
      clearTimeout(c.timer);
      c.dirty = false;
      c.saveState = 'saved';
      c.savedAt = got.updated_at;
      c.conflict = null;
      noteDraft(c.id, got.post, got.updated_at);
      await replacePost(c, got.post, { version: got.updated_at, hasDraft: true, assets: got.assets });
      paintSave(c);
    } catch (error) {
      showStatus('Couldn’t load their version', h(error.message));
    }
  };

  // ---------------------------------------------------------------- post view: changes

  let previewTimer = null;
  const change = (c, patch, source) => {
    if (!isObject(patch)) return;
    Object.assign(c.post, clone(patch));
    c.post.id = c.id;
    scheduleSave(c);
    if (c !== cur) return;
    if (source !== 'seo') call(c.handles.seo, 'refresh');
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => call(c.handles.preview, 'refresh'), 350);
    if (c.problems) showProblems(c, c.problems.intent);
    paintBar();
  };

  // ---------------------------------------------------------------- post view: images

  const stageImage = async (c, file, { purpose = 'block' } = {}) => {
    const progress = (p) => setNote(c, 'progress', '<div class="bt-progress" role="status"><span>' + h(p.label || 'Adding the photo…') + '</span>' +
      '<span class="bt-progress__bar"><i style="--p:' + Math.max(0.03, Math.min(1, p.fraction || 0)).toFixed(3) + '"></i></span></div>');
    progress({ label: 'Reading the photo…', fraction: 0 });
    try {
      if (!c.hasDraft) {
        c.dirty = true;
        await flushSave(c);
        if (!c.hasDraft) throw new Error('The draft couldn’t be saved yet, so the photo can’t be added. ' + (c.error ? c.error.message : 'Try again in a moment.'));
      }
      let out = await intakeImage(file, { onProgress: progress });
      // Rare: a detailed 2400px photo over the store's 1.9 MB row limit.
      for (const options of [{ quality: 0.76 }, { maxEdge: 1800, quality: 0.78 }, { maxEdge: 1400, quality: 0.74 }]) {
        if (out.blob.size <= ASSET_MAX_BYTES) break;
        out = await intakeImage(file, { ...options, onProgress: progress });
      }
      if (out.blob.size > ASSET_MAX_BYTES) throw new Error('This photo is still too large after resizing. Try another photo.');
      const ext = out.type === 'image/webp' ? 'webp' : out.type === 'image/png' ? 'png' : 'jpg';
      const name = (purpose === 'cover' ? 'cover' : 'photo') + '-' + randomId(8) + '.' + ext;
      progress({ label: 'Uploading…', fraction: 0.995 });
      await api().putAsset(c.id, name, out.blob);
      assetUrls.set(assetKey(c.id, name), URL.createObjectURL(out.blob));
      setNote(c, 'progress', '');
      return { src: 'draft:' + name, width: out.width, height: out.height };
    } catch (error) {
      setNote(c, 'progress', '<div class="notice notice--warning bt-note" role="alert"><strong>Photo not added.</strong> ' + h(error.message) + '</div>');
      setTimeout(() => setNote(c, 'progress', ''), 9000);
      throw error;
    }
  };

  // ---------------------------------------------------------------- post view: markup

  const setNote = (c, slot, html) => {
    if (c !== cur) return;
    const el = viewEl.querySelector('[data-note="' + slot + '"]');
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };

  const stats = (post) => {
    try {
      const words = (String(blogBlocks().plainText ? blogBlocks().plainText(post) : '').match(/\S+/g) || []).length;
      const minutes = blogBlocks().readingMinutes ? blogBlocks().readingMinutes(post) : Math.max(1, Math.round(words / 220));
      return words.toLocaleString('en-IN') + ' word' + (words === 1 ? '' : 's') + ' · ' + minutes + ' min read';
    } catch {
      return '';
    }
  };

  const actionsFor = (c) => {
    const status = c.live ? c.live.status : 'draft';
    const edits = c.hasDraft || c.dirty;
    const out = [];
    if (!c.live) out.push(['delete', 'Delete draft', 'button--text']);
    else if (edits) out.push(['discard', 'Discard edits', 'button--text']);
    if (c.live && status !== 'unpublished') out.push(['unpublish', status === 'scheduled' ? 'Unschedule' : 'Unpublish', 'button--quiet']);
    out.push(['schedule', status === 'scheduled' ? 'Reschedule' : 'Schedule', 'button--quiet']);
    if (status === 'published') out.push(['publish', 'Publish changes', 'button--primary', !edits]);
    else out.push(['publish', 'Publish now', 'button--primary']);
    return out;
  };

  const paintBar = () => {
    const c = cur;
    if (!c) return;
    const status = viewEl.querySelector('[data-bt-status]');
    if (!status) return;
    const statusHtml = statusChip(c.live ? c.live.status : 'draft', c.live?.publishAt) + (c.live && (c.hasDraft || c.dirty) ? '<span class="bt-edits">Unpublished edits</span>' : '');
    if (status.innerHTML !== statusHtml) status.innerHTML = statusHtml;
    viewEl.querySelector('[data-bt-meta]').textContent = stats(c.post);
    const actions = viewEl.querySelector('[data-bt-actions]');
    const html = '<button class="icon-button bt-undo" type="button" data-bt="undo" aria-label="Undo">' + icon('undo') + '</button>' +
      '<button class="icon-button bt-undo" type="button" data-bt="redo" aria-label="Redo">' + icon('redo') + '</button>' +
      actionsFor(c).map(([action, label, cls, disabled]) => '<button class="button ' + cls + '" type="button" data-bt="' + action + '"' + (disabled ? ' disabled' : '') + '>' + h(label) + '</button>').join('');
    if (actions.dataset.html !== html) {
      const focusedAction = actions.contains(document.activeElement) ? document.activeElement.dataset.bt : null;
      actions.innerHTML = html;
      actions.dataset.html = html;
      if (focusedAction) actions.querySelector('[data-bt="' + focusedAction + '"]')?.focus();
    }
    const editor = c.handles.editor;
    actions.querySelector('[data-bt="undo"]').disabled = !editor || !call(editor, 'canUndo');
    actions.querySelector('[data-bt="redo"]').disabled = !editor || !call(editor, 'canRedo');
    // Set both ways: the markup above is only rewritten when it changes, so a
    // button disabled while busy must be re-enabled here (else a failed publish
    // leaves "Publish changes" dead until the post is reopened).
    for (const [action, , , disabled] of actionsFor(c)) {
      const button = actions.querySelector('[data-bt="' + action + '"]');
      if (button) button.disabled = busy || Boolean(disabled);
    }
  };

  const option = (value, label, selected) => '<option value="' + h(value) + '"' + (selected ? ' selected' : '') + '>' + h(label) + '</option>';

  const settingsHtml = (c) => {
    const p = c.post;
    const cats = categories();
    const people = authors();
    const authorKnown = people.some((person) => person.id === p.author);
    return '<div class="bt-form">' +
      '<div class="bt-field"><span class="field-label">Layout</span><div class="bt-chips" role="group" aria-label="Layout">' +
      LAYOUTS.map((layout) => chip('set-layout', layout.id, layout.name, p.layout === layout.id)).join('') + '</div></div>' +
      '<div class="bt-field"><span class="field-label">Category</span>' + (cats.length
        ? '<div class="bt-chips" role="group" aria-label="Category">' + cats.map((category) => chip('set-category', category.id, category.name, p.category === category.id, { tint: category.tint || 'slate' })).join('') + '</div>'
        : '<p class="help">Add a category under Blog → Settings first.</p>') + '</div>' +
      '<label>Author<select data-bt-field="author">' + (authorKnown ? '' : option('', 'Choose an author', true)) +
      people.map((person) => option(person.id, person.name, p.author === person.id)).join('') + '</select></label>' +
      '<label>Medical reviewer<select data-bt-field="reviewer">' + option('', 'No reviewer', !p.reviewer) +
      people.map((person) => option(person.id, person.name + (person.credentials ? ', ' + person.credentials : ''), p.reviewer === person.id)).join('') +
      '</select><span class="help">The post shows who checked it medically, and when.</span></label>' +
      (p.reviewer ? '<label>Reviewed on<input type="date" data-bt-field="reviewedAt" value="' + h(String(p.reviewedAt || '').slice(0, 10)) + '"></label>' : '') +
      '<label>Publish date and time<input type="datetime-local" data-bt-field="publishAt" value="' + h(toLocalInput(p.publishAt)) + '">' +
      '<span class="help">India time (IST). Used by Schedule: the post goes live within about 30 minutes of this time.</span></label>' +
      '<p class="inline-error" data-bt-error="publishAt" hidden></p></div>';
  };

  const paintSettings = (c) => {
    if (c !== cur) return;
    const pane = viewEl.querySelector('[data-pane-id="settings"]');
    if (pane) pane.innerHTML = settingsHtml(c);
  };

  const historyAvailable = (c) => everLive(c.live);

  const paintPost = () => {
    const c = cur;
    const panes = PANES.filter(([key]) => key !== 'history' || historyAvailable(c));
    viewEl.innerHTML = '<section class="bt-post" data-pane="' + c.pane + '">' +
      '<div class="bt-bar"><button class="bt-back" type="button" data-bt="back">' + icon('back') + '<span>All posts</span></button>' +
      '<div class="bt-bar__state"><span class="bt-bar__status" data-bt-status></span><span class="bt-bar__meta" data-bt-meta></span>' +
      '<span class="bt-save" data-bt-save role="status" aria-live="polite"></span></div>' +
      '<div class="bt-bar__actions" data-bt-actions></div></div>' +
      '<div class="bt-notes"><div data-note="conflict"></div><div data-note="save"></div><div data-note="problems"></div><div data-note="progress"></div></div>' +
      '<div class="bt-panes bt-chips" role="group" aria-label="Post sections">' +
      panes.map(([key, label]) => '<button class="bt-chip" type="button" data-bt="pane" data-value="' + key + '"' + (key === 'write' ? ' data-narrow' : '') + '>' + label + '</button>').join('') + '</div>' +
      '<div class="bt-main"><div class="bt-editor" data-part="editor"><p class="bt-loading">Opening the editor…</p></div></div>' +
      '<aside class="bt-side" aria-label="Post details">' +
      '<section class="bt-pane" data-pane-id="settings">' + settingsHtml(c) + '</section>' +
      '<section class="bt-pane" data-pane-id="seo"><div data-part="seo"><p class="bt-loading">Opening…</p></div></section>' +
      '<section class="bt-pane" data-pane-id="preview"><div class="bt-preview-modes">' +
      '<div class="bt-chips" role="group" aria-label="Preview size">' + chip('preview-device', 'phone', 'Phone', c.mode.device === 'phone') + chip('preview-device', 'desktop', 'Desktop', c.mode.device === 'desktop') + '</div>' +
      '<div class="bt-chips" role="group" aria-label="Preview theme">' + chip('preview-theme', 'light', 'Light', c.mode.theme === 'light') + chip('preview-theme', 'dark', 'Dark', c.mode.theme === 'dark') + '</div></div>' +
      '<div data-part="preview" class="bt-preview"><p class="bt-loading">Opening…</p></div></section>' +
      (historyAvailable(c) ? '<section class="bt-pane" data-pane-id="history"><div data-part="history"><p class="bt-loading">Opening…</p></div></section>' : '') +
      '</aside></section>';
    syncPanes();
    paintSave(c);
    paintBar();
    mountComponents(c);
  };

  const syncPanes = () => {
    const c = cur;
    const root = viewEl.querySelector('.bt-post');
    if (!c || !root) return;
    const narrow = narrowQuery.matches;
    const side = c.pane === 'write' ? c.sidePane : c.pane;
    root.dataset.pane = c.pane;
    for (const pane of root.querySelectorAll('[data-pane-id]')) pane.hidden = pane.dataset.paneId !== side;
    for (const button of root.querySelectorAll('[data-bt="pane"]')) {
      button.setAttribute('aria-pressed', String(narrow ? button.dataset.value === c.pane : button.dataset.value === side));
    }
    if (side === 'preview') call(c.handles.preview, 'refresh');
  };
  narrowQuery.addEventListener('change', syncPanes);

  const mountComponents = (c) => {
    const wanted = () => cur === c && viewEl.contains(viewEl.querySelector('[data-part="editor"]'));
    const part = (name) => viewEl.querySelector('[data-part="' + name + '"]');
    const getPost = () => c.post;
    const resolveSrc = (src) => resolveFor(c.id, src, () => call(c.handles.preview, 'refresh'));
    // The top bar draws undo / redo, so the editor's own buttons are off and its
    // history events keep ours current.
    part('editor')?.addEventListener('bed:history', () => { if (cur === c) paintBar(); });
    mountPart('editor', 'mountBlockEditor', part('editor'), {
      post: clone(c.post),
      onChange: (patch) => change(c, patch, 'editor'),
      stageImage: (file, options) => stageImage(c, file, options),
      resolveSrc,
      films: films(),
      historyButtons: false,
      h,
      icon,
    }, 'The editor', wanted).then((handle) => {
      c.handles.editor = handle;
      if (cur === c) {
        paintBar();
        if (c.fresh) call(handle, 'focus');
      }
    });
    mountPart('seo', 'mountSeoPanel', part('seo'), {
      getPost,
      onChange: (patch) => change(c, patch, 'seo'),
      allPosts,
      config: config(),
      resolveSrc,
      h,
      icon,
    }, 'The SEO panel', wanted).then((handle) => { c.handles.seo = handle; });
    mountPart('seo', 'mountPostPreview', part('preview'), { getPost, config: config(), films: films(), resolveSrc, allPosts, controls: false, contactHref: contactHref() }, 'The preview', wanted).then((handle) => {
      c.handles.preview = handle;
      call(handle, 'setMode', { ...c.mode });
    });
    if (historyAvailable(c)) {
      mountPart('seo', 'mountRevisions', part('history'), {
        postId: c.id,
        gh: state.api,
        onRestore: (post) => restoreRevision(c, post),
      }, 'History', wanted).then((handle) => { c.handles.revisions = handle; });
    }
  };

  const destroyPost = (c) => {
    for (const handle of Object.values(c.handles)) call(handle, 'destroy');
    c.handles = {};
  };

  const restoreRevision = async (c, post) => {
    if (!isObject(post)) return;
    const keep = { id: c.id };
    await replacePost(c, { ...post, ...keep });
    scheduleSave(c);
    showStatus('Older version restored as a draft', 'It is not live yet. Check it, then press Publish changes to put it on the site.');
  };

  // ---------------------------------------------------------------- open / close

  const openPost = async (id, { fresh = null } = {}) => {
    if (cur) closePost();
    destroyViewParts();
    tab.view = 'post';
    const c = {
      id,
      post: null,
      live: posts().find((post) => post.id === id) || null,
      version: null,
      hasDraft: false,
      dirty: false,
      saveState: 'idle',
      pane: narrowQuery.matches ? 'write' : 'settings',
      sidePane: 'settings',
      mode: { device: 'phone', theme: 'light' },
      handles: {},
      fresh: Boolean(fresh),
    };
    cur = c;
    contexts.add(c);
    if (fresh) c.post = fresh;
    else if (draftList === null || draftList.some((row) => row.id === id) || !c.live) {
      viewEl.innerHTML = '<p class="bt-loading" role="status">Opening the draft…</p>';
      try {
        const got = await api().get(id);
        c.post = got.post;
        c.version = got.updated_at;
        c.hasDraft = true;
        c.savedAt = got.updated_at;
        draftPosts.set(id, { updated_at: got.updated_at, post: clone(got.post), assets: got.assets || [] });
        await prefetchAssets(id, got.assets);
      } catch (error) {
        if (error.code !== 'not-found' || !c.live) {
          if (cur === c) {
            cur = null;
            contexts.delete(c);
            tab.view = 'list';
            paintList();
          }
          showStatus('Couldn’t open that draft', h(error.message));
          return;
        }
        forgetDraft(id);
      }
    }
    if (cur !== c) return;
    c.post = withStyle(c.post || clone(c.live));
    c.post.id = id;
    paintPost();
    document.querySelector('#admin-main')?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  };

  const closePost = () => {
    const c = cur;
    if (!c) return;
    cur = null;
    destroyPost(c);
    if (c.dirty || c.saving) flushSave(c).finally(() => { if (!c.dirty) contexts.delete(c); });
    else contexts.delete(c);
  };

  const setView = (view) => {
    if (view === 'post') return;
    if (cur) closePost();
    destroyViewParts();
    tab.view = view;
    if (view === 'list') {
      paintList();
      refreshDrafts();
    } else if (view === 'new') paintPicker();
    else paintManaged(view);
  };

  const createPost = (layout) => {
    const post = blankPost(LAYOUTS.some((item) => item.id === layout) ? layout : 'editorial', config());
    openPost(post.id, { fresh: post });
  };

  // ---------------------------------------------------------------- delete / discard

  const stopSaving = async (c) => {
    clearTimeout(c.timer);
    c.dirty = false;
    if (c.saving) await c.saving;
    clearTimeout(c.timer);
    c.dirty = false;
  };

  const deleteDraft = async (c) => {
    if (!confirm('Delete this draft? It can’t be brought back.')) return;
    await stopSaving(c);
    try {
      if (c.hasDraft || c.version != null) await api().remove(c.id);
    } catch (error) {
      if (error.code !== 'not-found') {
        showStatus('Draft not deleted', h(error.message));
        return;
      }
    }
    forgetDraft(c.id);
    releaseAssets(c.id);
    contexts.delete(c);
    setView('list');
    showStatus('Draft deleted', 'It has been removed from your drafts.');
  };

  const discardEdits = async (c) => {
    if (!confirm('Discard your unpublished edits? The post on the site stays as it is.')) return;
    await stopSaving(c);
    try {
      if (c.hasDraft) await api().remove(c.id);
    } catch (error) {
      if (error.code !== 'not-found') {
        showStatus('Edits not discarded', h(error.message));
        return;
      }
    }
    forgetDraft(c.id);
    releaseAssets(c.id);
    contexts.delete(c);
    cur = null;
    destroyPost(c);
    openPost(c.id);
  };

  // ---------------------------------------------------------------- publish / schedule / unpublish

  const showProblems = (c, intent, problems = null) => {
    if (!problems) {
      const next = buildNext(c, intent);
      problems = next ? check(next.nextPosts, next.index) : { mine: [], others: [], config: [] };
    }
    const all = [...problems.mine, ...problems.config.map((message) => ({ message, path: '' })), ...problems.others.map((message) => ({ message, path: '' }))];
    c.problems = all.length ? { intent } : null;
    if (!all.length) return setNote(c, 'problems', '');
    const shown = all.slice(0, 6);
    setNote(c, 'problems', '<div class="bt-problems" role="alert"><strong>' + (intent === 'schedule' ? 'Before this can be scheduled' : 'Before this can go live') + '</strong><ul>' +
      shown.map(({ message, path }) => '<li>' + h(message) +
        (path ? ' <button class="button button--text bt-inline" type="button" data-bt="jump" data-value="' + h(path) + '">Fix this</button>' : '') + '</li>').join('') + '</ul>' +
      (all.length > shown.length ? '<span>…and ' + (all.length - shown.length) + ' more.</span>' : '') + '</div>');
    return undefined;
  };

  const check = (nextPosts, index) => {
    const detailed = typeof rules.validateBlogPostsDetailed === 'function'
      ? rules.validateBlogPostsDetailed(nextPosts, config(), films())
      : rules.validateBlogPosts(nextPosts, config(), films()).map((message) => ({ path: '', message }));
    const mine = [];
    const others = [];
    for (const problem of detailed) {
      const [at, ...rest] = String(problem.path).split('.');
      if (at === String(index)) mine.push({ message: ownWords(problem.message), path: rest.join('.') });
      else others.push(problem.message);
    }
    return { mine, others, config: rules.validateBlogConfig(config()) };
  };

  // "Fix this" in the problems list: show the pane that holds the field, then
  // focus it. Paths are validateBlogPostsDetailed's, minus the post index.
  const SETTINGS_FIELDS = new Set(['layout', 'category', 'author', 'reviewer', 'reviewedAt', 'publishAt']);
  const SEO_FIELDS = new Set(['slug', 'previousSlugs', 'seo', 'about', 'related']);
  const focusEl = (el) => {
    if (!el) return false;
    // The editor's file inputs are hidden; its "Add a photo" button opens them.
    if (el.matches('input[type="file"]')) el = (el.closest('.bed-media') || el.parentElement)?.querySelector('[data-act="pick"]') || el;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    return document.activeElement === el || el.contains(document.activeElement);
  };
  const byPath = (scope, path) => {
    if (!scope) return null;
    const parts = path.split('.');
    for (let n = parts.length; n > 0; n -= 1) {
      const key = parts.slice(0, n).join('.');
      const hit = [...scope.querySelectorAll('[data-f], [data-file], [data-bt-field]')].find((el) => (el.dataset.f || el.dataset.file || el.dataset.btField) === key);
      if (hit) return hit;
    }
    return null;
  };
  const jumpTo = (c, path) => {
    const top = path.split('.')[0];
    const show = (pane) => {
      c.pane = pane;
      if (pane !== 'write') c.sidePane = pane;
      syncPanes();
    };
    if (SETTINGS_FIELDS.has(top)) {
      show('settings');
      const pane = viewEl.querySelector('[data-pane-id="settings"]');
      return focusEl(byPath(pane, top) || pane?.querySelector('[data-bt="set-' + top + '"][aria-pressed="true"], [data-bt="set-' + top + '"]'));
    }
    if (SEO_FIELDS.has(top)) {
      show('seo');
      const part = viewEl.querySelector('[data-part="seo"]');
      return focusEl(byPath(part, path) || part?.querySelector('input, textarea, select, button'));
    }
    if (narrowQuery.matches) show('write');
    const editor = viewEl.querySelector('[data-part="editor"]');
    if (!editor) return false;
    const block = /^blocks\.(\d+)(?:\.(.+))?$/.exec(path);
    if (block) {
      const wrap = editor.querySelectorAll('.bed-block')[Number(block[1])];
      if (!wrap) return focusEl(null) || call(c.handles.editor, 'focus');
      return focusEl((block[2] && byPath(wrap, block[2])) || wrap.querySelector('[data-f], input, textarea, select, button'));
    }
    if (top === 'cover' && !byPath(editor, path)) {
      // No cover yet: the alt / caption fields appear once a photo is chosen.
      return focusEl(editor.querySelector('[data-file="cover"]'));
    }
    return focusEl(byPath(editor, path)) || call(c.handles.editor, 'focus');
  };

  // The posts.json that a publish / schedule / unpublish of this post would commit.
  const buildNext = (c, intent) => {
    const now = Date.now();
    const before = posts();
    const index = before.findIndex((post) => post.id === c.id);
    const live = index >= 0 ? before[index] : null;
    const images = [];
    let next;
    if (intent === 'unpublish') {
      if (!live) return null;
      next = { ...clone(live), status: 'unpublished' };
    } else {
      next = clone(c.post);
      next.id = c.id;
      if (!next.slug) next.slug = slugify(next.title);
      // Redirect baseline = the committed record, not this draft's copy. posts() is
      // what the last successful publish committed (a failed one rolls back to it),
      // so every address it ever had carries forward even when the draft is older
      // than that publish (a leftover draft, or one saved on another device).
      const arr = (value) => (Array.isArray(value) ? value : []);
      const previous = new Set([...arr(live?.previousSlugs), ...arr(next.previousSlugs)]);
      if (live && everLive(live) && live.slug && live.slug !== next.slug) previous.add(live.slug);
      previous.delete(next.slug);
      next.previousSlugs = [...previous].filter(Boolean);
      if (intent === 'publish') {
        if (live && live.status === 'published' && validTime(live.publishAt)) {
          next.publishAt = validTime(next.publishAt) ? next.publishAt : live.publishAt;
          next.updatedAt = istIso(now);
        } else next.publishAt = istIso(now);
        next.status = 'published';
      } else next.status = 'scheduled';
      next = mapStrings(next, (value) => {
        const name = draftName(value);
        if (name === null) return value;
        if (!images.includes(name)) images.push(name);
        return 'assets/blog/' + next.slug + '/' + name;
      });
    }
    const nextPosts = index >= 0 ? before.map((post, i) => (i === index ? next : post)) : [next, ...before];
    return { next, nextPosts, index: index >= 0 ? index : 0, images, before };
  };

  const rollback = (snapshot) => {
    state.draft.blogPosts = snapshot.posts;
    if (!snapshot.wasDirty) ctx.clearDirty('blogPosts');
    const keep = new Set(snapshot.previews.values());
    for (const url of state.assetPreviews.values()) if (!keep.has(url)) URL.revokeObjectURL(url);
    state.assetChanges = snapshot.assets;
    state.assetPreviews = snapshot.previews;
    ctx.renderUnsaved();
  };

  const commitPost = async (c, intent) => {
    if (busy || !c) return;
    const title = String(c.post.title || '').trim() || 'Untitled post';
    if (intent === 'schedule') {
      const at = Date.parse(c.post.publishAt || '');
      const error = viewEl.querySelector('[data-bt-error="publishAt"]');
      if (!Number.isFinite(at) || at <= Date.now() + 60 * 1000) {
        c.pane = 'settings';
        c.sidePane = 'settings';
        syncPanes();
        const field = viewEl.querySelector('[data-bt-field="publishAt"]');
        const message = validTime(c.post.publishAt) ? 'That time has already passed. Choose a date and time in the future, then press Schedule.' : 'Choose the date and time it should go live, then press Schedule.';
        if (error) {
          error.textContent = message;
          error.hidden = false;
        }
        field?.setAttribute('aria-invalid', 'true');
        field?.focus();
        return;
      }
      if (error) error.hidden = true;
      if (c.live && c.live.status === 'published' && !confirm('“' + title + '” is live now. Scheduling it takes it off the site until ' + whenIst(c.post.publishAt) + '. Continue?')) return;
    }
    if (intent === 'unpublish' && !confirm('Take “' + title + '” off the site? It stays here, and you can publish it again any time.')) return;
    if (c.saving) await c.saving;
    const built = buildNext(c, intent);
    if (!built) return;
    const problems = check(built.nextPosts, built.index);
    if (problems.mine.length || problems.others.length || problems.config.length) {
      showProblems(c, intent, problems);
      if (narrowQuery.matches) viewEl.querySelector('[data-note="problems"]')?.scrollIntoView({ block: 'center' });
      return;
    }
    setNote(c, 'problems', '');
    c.problems = null;
    const others = ctx.otherUnsavedTabs();
    if (others.length && !confirm('This also publishes your unsaved changes on the ' + others.join(', ') + (others.length === 1 ? ' tab' : ' tabs') + '. Continue?')) return;

    busy = true;
    paintBar();
    const snapshot = { posts: built.before, wasDirty: state.dirty.has('blogPosts'), assets: new Map(state.assetChanges), previews: new Map(state.assetPreviews) };
    let ok = false;
    try {
      if (built.images.length) setNote(c, 'progress', '<div class="bt-progress" role="status"><span>Preparing photos…</span><span class="bt-progress__bar"><i style="--p:.5"></i></span></div>');
      for (const name of built.images) await ctx.stageBlob('assets/blog/' + built.next.slug + '/' + name, await assetBlob(c.id, name));
      setNote(c, 'progress', '');
      state.draft.blogPosts = built.nextPosts;
      ctx.markDirty('blogPosts');
      const verb = intent === 'publish' ? (c.live && c.live.status === 'published' ? 'Update' : 'Publish') : intent === 'schedule' ? 'Schedule' : 'Unpublish';
      ok = await ctx.publish({ message: 'Blog: ' + verb + ' “' + title.slice(0, 72) + '”' });
    } catch (error) {
      showStatus('Not published', h(error.message) + ' Nothing changed on the site.');
    } finally {
      busy = false;
      if (!ok) {
        setNote(c, 'progress', '');
        rollback(snapshot);
        paintBar();
      }
    }
    if (!ok) return;
    c.live = built.next;
    if (intent !== 'unpublish') {
      await stopSaving(c);
      try {
        if (c.hasDraft) await api().remove(c.id);
      } catch {
        // The post is live; a leftover draft only shows as "Unpublished edits".
      }
      forgetDraft(c.id);
      releaseAssets(c.id);
      c.hasDraft = false;
      c.version = null;
    }
    contexts.delete(c);
    if (cur === c) {
      cur = null;
      destroyPost(c);
    }
    tab.view = 'list';
    tab.filter.status = 'all';
    paintList();
    refreshDrafts();
  };

  // ---------------------------------------------------------------- events

  const onClick = (event) => {
    const button = event.target.closest('[data-bt]');
    if (!button || !host.contains(button) || button.closest('[data-part]')) return;
    const { bt: action, value, id } = button.dataset;
    const c = cur;
    const run = async () => {
      if (action === 'view') return setView(value);
      if (action === 'new') return setView('new');
      if (action === 'create') return createPost(value);
      if (action === 'open') return openPost(id);
      if (action === 'back') return setView('list');
      if (action === 'retry-drafts') {
        draftsError = null;
        draftList = draftList || null;
        paintList();
        return refreshDrafts();
      }
      if (action === 'filter-status' || action === 'filter-category') {
        tab.filter[action === 'filter-status' ? 'status' : 'category'] = value;
        return paintList();
      }
      if (action === 'clear-filters') {
        tab.filter = { status: 'all', category: 'all', q: '' };
        return paintList();
      }
      if (!c) return undefined;
      if (action === 'pane') {
        c.pane = value;
        if (value !== 'write') c.sidePane = value;
        syncPanes();
        if (narrowQuery.matches) viewEl.querySelector('.bt-panes')?.scrollIntoView({ block: 'nearest' });
        return undefined;
      }
      if (action === 'preview-device' || action === 'preview-theme') {
        c.mode[action === 'preview-device' ? 'device' : 'theme'] = value;
        for (const chipEl of button.parentElement.querySelectorAll('.bt-chip')) chipEl.setAttribute('aria-pressed', String(chipEl === button));
        return call(c.handles.preview, 'setMode', { ...c.mode });
      }
      if (action === 'set-layout' || action === 'set-category') {
        change(c, { [action === 'set-layout' ? 'layout' : 'category']: value }, 'settings');
        paintSettings(c);
        return viewEl.querySelector('[data-bt="' + action + '"][data-value="' + CSS.escape(value) + '"]')?.focus();
      }
      if (action === 'undo' || action === 'redo') {
        call(c.handles.editor, action);
        return paintBar();
      }
      if (action === 'publish' || action === 'schedule' || action === 'unpublish') return commitPost(c, action);
      if (action === 'delete') return deleteDraft(c);
      if (action === 'discard') return discardEdits(c);
      if (action === 'retry-save') {
        c.saveState = 'pending';
        return saveNow(c);
      }
      if (action === 'jump') return jumpTo(c, value || '');
      if (action === 'keep-mine') return keepMine(c);
      if (action === 'load-theirs') return loadTheirs(c);
      return undefined;
    };
    run().catch((error) => showStatus('Couldn’t do that', h(error.message)));
  };

  const fieldValue = (field, value) => {
    if (field === 'reviewer') return value || null;
    if (field === 'reviewedAt') return value || null;
    if (field === 'publishAt') return fromLocalInput(value);
    return value;
  };

  const onInput = (event) => {
    const target = event.target;
    if (!host.contains(target) || target.closest('[data-part]')) return;
    if (target.matches('[data-bt-search]')) {
      tab.filter.q = target.value;
      paintRows();
    }
  };

  const onChange = (event) => {
    const target = event.target;
    if (!host.contains(target) || target.closest('[data-part]') || !cur) return;
    const field = target.dataset.btField;
    if (!field) return;
    const patch = { [field]: fieldValue(field, target.value) };
    if (field === 'reviewer' && patch.reviewer && !cur.post.reviewedAt) patch.reviewedAt = istDate(Date.now());
    if (field === 'reviewer' && !patch.reviewer) patch.reviewedAt = null;
    if (field === 'publishAt') {
      target.removeAttribute('aria-invalid');
      const error = viewEl.querySelector('[data-bt-error="publishAt"]');
      if (error) error.hidden = true;
    }
    change(cur, patch, 'settings');
    if (field === 'reviewer') {
      paintSettings(cur);
      viewEl.querySelector('[data-bt-field="reviewer"]')?.focus();
    }
  };

  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  // Clicks inside a component can change undo state; keep the buttons current.
  host.addEventListener('keyup', () => { if (cur) paintBar(); });
  // Leaving or reloading inside the autosave pause: save now rather than in
  // 1.5 s. app.js's beforeunload prompt holds the page while the PUT lands, and
  // a hidden tab (phone switched apps) may never come back to finish the timer.
  // (The editor batches its onChange ~240 ms; a flush() on its handle, when it
  // has one, hands over the last keystrokes first.)
  const saveBeforeLeaving = () => {
    if (cur) call(cur.handles.editor, 'flush');
    for (const c of contexts) if (c.dirty && !c.saving && c.timer && c.saveState === 'pending') saveNow(c);
  };
  window.addEventListener('beforeunload', saveBeforeLeaving);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveBeforeLeaving(); });

  // ---------------------------------------------------------------- app.js hooks

  const mount = (root) => {
    root.replaceChildren(host);
    mountAlert();
    const postsNow = state.draft.blogPosts;
    if (!tab.mounted) {
      tab.mounted = true;
      seenPosts = postsNow;
      paintList();
      refreshDrafts();
      return;
    }
    if (postsNow !== seenPosts) {
      // The draft files were reloaded (their changes loaded, or a fresh sign-in).
      seenPosts = postsNow;
      if (cur) {
        cur.live = posts().find((post) => post.id === cur.id) || null;
        paintBar();
      } else if (tab.view === 'list') paintList();
    }
    if (tab.view === 'list') refreshDrafts();
  };

  return {
    mount,
    owns: (node) => Boolean(node && node.closest && node.closest('[data-blog-root]')),
    // A draft edit not yet in the drafts store (debounce, in flight, failed or in conflict).
    hasUnsavedDraft: () => [...contexts].some((c) => c.dirty || c.saving || c.saveState === 'error' || c.saveState === 'conflict'),
  };
};
