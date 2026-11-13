// Admin Blog tab — search & sharing panel, live post preview and version history.
// Interfaces pinned in src/blog/CONTRACT.md ("Admin components"); styles in
// blog-seo.css, every selector under the one root class `.bseo`.
//
//   mountSeoPanel(root, { getPost, onChange, allPosts, config, h, icon, resolveSrc? })
//     → { refresh(), destroy() }
//   mountPostPreview(root, { getPost, config, films, resolveSrc, allPosts?, controls? })
//     → { refresh(), setMode({ device: 'phone'|'desktop', theme: 'light'|'dark' }), destroy() }
//   mountRevisions(root, { postId, gh, onRestore }) → { destroy() }
//
// The host (W5a) owns the one post object. These components read it through
// getPost() and write a shallow patch of the top-level fields they changed
// ({ slug }, { seo }, { about }, { related }) through onChange(patch). Optional
// extras beyond the pinned signatures: `resolveSrc` on the panel (share-card
// cover), `allPosts` on the preview (rail cards) and `controls: false` (host
// draws its own device/theme chips and calls setMode).

import './content-rules.js';
import './blog-blocks.js';
import './blog-checks.js';

// ---------------------------------------------------------------- helpers

const escape = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const list = (v) => (Array.isArray(v) ? v : []);
const blocksApi = () => globalThis.MediVascBlogBlocks;
const checksApi = () => globalThis.MediVascBlogChecks;
const slugify = (text) => (blocksApi() ? blocksApi().slugify(text) : str(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

const SITE = 'https://medivasc.in/';
const SITE_HOST = 'medivasc.in';
let seq = 0;

const PATHS = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 7v6.5"/><path d="M12 17h.01"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  restore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;

// '12 Nov 2026' in IST (matches the site's publishedLabel).
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const STAMP = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const toDate = (v) => { const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const dayLabel = (v) => { const d = toDate(v); return d ? DAY.format(d) : ''; };
const stampLabel = (v) => { const d = toDate(v); return d ? `${STAMP.format(d).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase())} IST` : ''; };

const wordCount = (post) => {
  if (!isObj(post)) return 0;
  const text = blocksApi() ? blocksApi().plainText(post) : '';
  return (str(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
};

// Same rule as src/blog/seo.js withSuffix: "<base> | <journal>" when it fits
// 60 characters, else "<base> | MediVasc", else the base alone.
const TITLE_MAX = 60;
const googleTitle = (base, config) => {
  for (const suffix of [str(config && config.name).trim() || 'Journal', 'MediVasc']) {
    const candidate = `${base} | ${suffix}`;
    if (base && candidate.length <= TITLE_MAX) return candidate;
  }
  return base;
};

// Google measures in pixels, not characters. Arial is what Google's result
// fonts fall back to and what the common ~580px rule is measured in, so the
// estimate and the snippet mock both use it (a simulation, not our UI type).
const SERP = {
  titleFont: '20px Arial, Helvetica, sans-serif',
  titleMax: 580,
  mobileTitleFont: '18px Arial, Helvetica, sans-serif',
  mobileTitleMax: 620,  // two lines on a ~360px phone
  descFont: '14px Arial, Helvetica, sans-serif',
  descMax: 920,         // ~2 lines on desktop (≈155–160 characters)
  mobileDescMax: 680,   // ≈120 characters on a phone
};
let measurer = null;
const textWidth = (text, font) => {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  if (!measurer) return str(text).length * 9;
  measurer.font = font;
  return measurer.measureText(str(text)).width;
};
const truncatePx = (text, max, font) => {
  const value = str(text).trim();
  if (!value || textWidth(value, font) <= max) return value;
  let out = '';
  for (const word of value.split(/\s+/)) {
    const next = out ? `${out} ${word}` : word;
    if (textWidth(`${next} ...`, font) > max) break;
    out = next;
  }
  if (!out) {
    let cut = value;
    while (cut && textWidth(`${cut}...`, font) > max) cut = cut.slice(0, -1);
    return `${cut}...`;
  }
  return `${out.replace(/[\s,.;:!?–—-]+$/u, '')} ...`;
};

// A post that has been live keeps its address unless the owner changes it.
const hasBeenLive = (post) => post.status === 'published' || post.status === 'unpublished' || list(post.previousSlugs).length > 0;

// Site-root URL (admin/ sits one level below it) — absolute, so it works inside
// an iframe srcdoc and when the bundle is versioned with ?v=.
const siteRoot = () => new URL('../', import.meta.url).href;

// Any post image src → a displayable absolute URL ('' when it cannot be shown).
const imageUrl = (src, resolveSrc) => {
  const value = str(src).trim();
  if (!value) return '';
  const siteRelative = !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('/');
  let out = '';
  if (typeof resolveSrc === 'function') {
    try { out = str(resolveSrc(value)); } catch { out = ''; }
    if (out === value && siteRelative) out = siteRoot() + value;
  } else if (siteRelative) {
    out = siteRoot() + value;
  } else if (!value.startsWith('draft:')) {
    out = value;
  }
  if (!out) return '';
  try { return new URL(out, document.baseURI).href; } catch { return ''; }
};

const keywordsOf = (post) => new Set(
  [str(post.seo && post.seo.focusKeyphrase), ...list(post.seo && post.seo.keywords).map(str)]
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean),
);
const isLivePost = (p) => isObj(p) && p.status === 'published';
const byNewest = (a, b) => (toDate(b.publishAt) || 0) - (toDate(a.publishAt) || 0);
// Mirrors build-blog.js related(): manual picks, then same category, then shared keywords.
const relatedOf = (post, posts) => {
  const live = list(posts).filter(isLivePost).sort(byNewest);
  const byId = new Map(live.map((p) => [p.id, p]));
  const picked = [];
  const add = (p) => { if (p && p.id !== post.id && !picked.includes(p) && picked.length < 4) picked.push(p); };
  list(post.related).forEach((id) => add(byId.get(id)));
  live.filter((p) => p.category === post.category).forEach(add);
  const mine = keywordsOf(post);
  if (mine.size) {
    live.map((p) => [p, [...keywordsOf(p)].filter((k) => mine.has(k)).length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .forEach(([p]) => add(p));
  }
  return picked;
};

const COMMON_CONDITIONS = [
  'Diabetic foot ulcer', 'Diabetic neuropathy', 'Peripheral arterial disease', 'Venous leg ulcer',
  'Chronic venous insufficiency', 'Varicose veins', 'Deep vein thrombosis', 'Lymphoedema',
  'Lymphatic filariasis', 'Chronic wound',
];

// ================================================================ SEO panel

export function mountSeoPanel(root, { getPost, onChange, allPosts = [], config = {}, h = escape, icon, resolveSrc } = {}) {
  const esc = typeof h === 'function' ? h : escape;
  const id = `bseo${(seq += 1)}`;
  const state = { postId: undefined, auto: false, snippet: 'desktop', keys: {}, destroyed: false, slugQueued: false };
  const read = () => (typeof getPost === 'function' && isObj(getPost()) ? getPost() : {});
  const others = () => list(typeof allPosts === 'function' ? allPosts() : allPosts).filter((p) => isObj(p) && p.id !== read().id);
  const allList = () => list(typeof allPosts === 'function' ? allPosts() : allPosts);
  const change = (patch) => { if (typeof onChange === 'function') onChange(patch); update(); };
  const seoPatch = (fields) => change({ seo: { ...(isObj(read().seo) ? read().seo : {}), ...fields } });
  const iconOr = (name) => (typeof icon === 'function' && (name === 'check' || name === 'up' || name === 'down') ? icon(name) : svg(name));

  root.classList.add('bseo', 'bseo--panel');
  root.innerHTML = `
    <div class="bseo-cols">
      <div class="bseo-col">
        <section class="bseo-sec" aria-labelledby="${id}-addr">
          <h3 class="bseo-sec__title" id="${id}-addr">Web address</h3>
          <div class="bseo-field">
            <div class="bseo-field__top"><label for="${id}-slug">Address of this post</label><button type="button" class="bseo-link" data-reset-slug hidden>Reset to title</button></div>
            <div class="bseo-url" data-url-box>
              <span class="bseo-url__base" aria-hidden="true">${esc(SITE_HOST)}/blog/</span>
              <input id="${id}-slug" class="bseo-url__slug" data-f="slug" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" aria-describedby="${id}-slug-help ${id}-slug-err">
              <span class="bseo-url__end" aria-hidden="true">/</span>
            </div>
            <p class="field-help" id="${id}-slug-help" data-slug-help></p>
            <p class="inline-error" id="${id}-slug-err" data-slug-err hidden></p>
          </div>
        </section>

        <section class="bseo-sec" aria-labelledby="${id}-search">
          <h3 class="bseo-sec__title" id="${id}-search">On Google</h3>
          <div class="bseo-field">
            <div class="bseo-field__top"><label for="${id}-title">Search title</label><span class="bseo-field__aside" data-title-src></span></div>
            <input id="${id}-title" data-f="title" autocomplete="off" aria-describedby="${id}-title-meter">
            <div class="bseo-meter" id="${id}-title-meter" data-meter="title"><span class="bseo-meter__track"><span class="bseo-meter__fill"></span></span><span class="bseo-meter__text"></span></div>
          </div>
          <div class="bseo-field">
            <div class="bseo-field__top"><label for="${id}-desc">Search description</label><span class="bseo-field__aside" data-desc-src></span></div>
            <textarea id="${id}-desc" data-f="description" rows="3" aria-describedby="${id}-desc-meter"></textarea>
            <div class="bseo-meter" id="${id}-desc-meter" data-meter="description"><span class="bseo-meter__track"><span class="bseo-meter__fill"></span></span><span class="bseo-meter__text"></span></div>
          </div>
          <div class="bseo-field">
            <label for="${id}-kp">Focus keyphrase</label>
            <input id="${id}-kp" data-f="focusKeyphrase" autocomplete="off" placeholder="e.g. diabetic foot warning signs" aria-describedby="${id}-kp-help">
            <p class="field-help" id="${id}-kp-help">The words you most want this post to be found for. The checklist shows where it already appears.</p>
          </div>
        </section>

        <section class="bseo-sec" aria-labelledby="${id}-topics">
          <h3 class="bseo-sec__title" id="${id}-topics">Topics</h3>
          ${chipsMarkup(esc, `${id}-kw`, 'keywords', 'Keywords', 'Add a keyword, then press Enter', 'Other words people search for. Used to suggest related posts.')}
          ${chipsMarkup(esc, `${id}-about`, 'about', 'Conditions this post is about', 'Add a condition, then press Enter', 'Tells Google which medical conditions the post covers. Use the plain medical name.')}
        </section>

        <section class="bseo-sec" aria-labelledby="${id}-rel">
          <h3 class="bseo-sec__title" id="${id}-rel">Related posts</h3>
          <p class="bseo-sec__lede">Shown at the end of the post. Pick up to four, or leave it to the site.</p>
          <ol class="bseo-related" data-related></ol>
          <div class="bseo-search" data-rel-search>
            <span class="bseo-search__icon">${svg('search')}</span>
            <input id="${id}-relq" type="search" data-relq autocomplete="off" placeholder="Search posts by title" aria-label="Search posts to add as related" aria-controls="${id}-relres">
          </div>
          <ul class="bseo-results" id="${id}-relres" data-rel-results></ul>
          <p class="field-help" data-rel-auto></p>
        </section>
      </div>

      <div class="bseo-col">
        <section class="bseo-sec" aria-labelledby="${id}-checks">
          <div class="bseo-sec__head"><h3 class="bseo-sec__title" id="${id}-checks">Checklist</h3><p class="bseo-sum" data-sum></p></div>
          <ul class="bseo-checks" data-checks aria-live="polite"></ul>
          <h4 class="bseo-kicker">Health-claim wording</h4>
          <ul class="bseo-checks" data-claims></ul>
          <p class="bseo-note" data-claims-note></p>
        </section>

        <section class="bseo-sec" aria-labelledby="${id}-serp">
          <div class="bseo-sec__head">
            <h3 class="bseo-sec__title" id="${id}-serp">Google result</h3>
            <div class="bseo-seg" role="group" aria-label="Result size">
              <button type="button" data-snippet="desktop" aria-pressed="true">Desktop</button>
              <button type="button" data-snippet="mobile" aria-pressed="false">Phone</button>
            </div>
          </div>
          <div class="bseo-serp-wrap" data-serp></div>
          <p class="bseo-note">Approximate. Google sometimes rewrites the title or picks its own sentence.</p>
        </section>

        <section class="bseo-sec" aria-labelledby="${id}-share">
          <h3 class="bseo-sec__title" id="${id}-share">When it is shared</h3>
          <div class="bseo-share" data-share></div>
          <p class="bseo-note">Approximate — the real share image is generated when the site builds.</p>
        </section>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const field = (name) => root.querySelector(`[data-f="${name}"]`);
  const els = {
    slug: field('slug'), title: field('title'), description: field('description'), focusKeyphrase: field('focusKeyphrase'),
    reset: $('[data-reset-slug]'), slugHelp: $('[data-slug-help]'), slugErr: $('[data-slug-err]'),
    titleSrc: $('[data-title-src]'), descSrc: $('[data-desc-src]'),
    related: $('[data-related]'), relq: $('[data-relq]'), relResults: $('[data-rel-results]'), relAuto: $('[data-rel-auto]'), relSearch: $('[data-rel-search]'),
    checks: $('[data-checks]'), claims: $('[data-claims]'), claimsNote: $('[data-claims-note]'), sum: $('[data-sum]'),
    serp: $('[data-serp]'), share: $('[data-share]'),
  };
  const chipsRoots = { keywords: $('[data-chips="keywords"]'), about: $('[data-chips="about"]') };
  const setValue = (el, value) => { if (el && document.activeElement !== el && el.value !== value) el.value = value; };

  // ---- slug: follows the title until the owner edits it -------------------
  const deriveAuto = (post) => !str(post.slug) || (!hasBeenLive(post) && post.slug === slugify(post.title));
  const typingSlug = (v) => v.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 80);
  const followTitle = () => {
    if (!state.auto || state.slugQueued) return;
    const post = read();
    const want = slugify(post.title);
    if (!want || want === post.slug) return;
    state.slugQueued = true;
    queueMicrotask(() => {
      state.slugQueued = false;
      if (state.destroyed || !state.auto) return;
      const current = read();
      const next = slugify(current.title);
      if (next && next !== current.slug) change({ slug: next });
    });
  };
  els.slug.addEventListener('input', () => {
    const value = typingSlug(els.slug.value);
    if (value !== els.slug.value) {
      const pos = Math.min(els.slug.selectionStart || value.length, value.length);
      els.slug.value = value;
      els.slug.setSelectionRange(pos, pos);
    }
    state.auto = false;
    change({ slug: value });
  });
  els.slug.addEventListener('change', () => {
    const final = slugify(els.slug.value);
    if (!final) {
      state.auto = true;
      const fromTitle = slugify(read().title);
      els.slug.value = fromTitle;
      change({ slug: fromTitle });
      return;
    }
    if (final !== els.slug.value) els.slug.value = final;
    if (final !== read().slug) change({ slug: final });
  });
  // The address box reads as one field: a click on the fixed part puts the
  // caret at the end of the editable part.
  $('[data-url-box]').addEventListener('mousedown', (e) => {
    if (e.target === els.slug) return;
    e.preventDefault();
    els.slug.focus();
    const end = els.slug.value.length;
    els.slug.setSelectionRange(end, end);
  });
  els.reset.addEventListener('click', () => {
    state.auto = true;
    const fromTitle = slugify(read().title);
    els.slug.value = fromTitle;
    change({ slug: fromTitle });
    els.slug.focus();
  });

  // ---- search fields ------------------------------------------------------
  for (const name of ['title', 'description', 'focusKeyphrase']) {
    els[name].addEventListener('input', () => seoPatch({ [name]: els[name].value }));
    els[name].addEventListener('change', () => {
      const trimmed = els[name].value.replace(/\s+/g, ' ').trim();
      if (trimmed !== els[name].value) { els[name].value = trimmed; seoPatch({ [name]: trimmed }); }
    });
  }

  // ---- chips --------------------------------------------------------------
  const chipValues = (key) => {
    const post = read();
    return key === 'keywords' ? list(post.seo && post.seo.keywords).map(str).filter(Boolean) : list(post.about).map(str).filter(Boolean);
  };
  const writeChips = (key, values) => (key === 'keywords' ? seoPatch({ keywords: values }) : change({ about: values }));
  const addChips = (key, raw) => {
    const current = chipValues(key);
    const seen = new Set(current.map((v) => v.toLowerCase()));
    const next = [...current];
    for (const part of String(raw).split(/[,\n;]/)) {
      const value = part.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (value && !seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); next.push(value); }
    }
    if (next.length !== current.length) writeChips(key, next);
  };
  for (const [key, box] of Object.entries(chipsRoots)) {
    const input = box.querySelector('input');
    box.querySelector('.bseo-chips').addEventListener('click', (e) => { if (e.target === e.currentTarget) input.focus(); });
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) {
        e.preventDefault();
        if (input.value.trim()) { addChips(key, input.value); input.value = ''; renderSuggest(key); }
      }
    });
    input.addEventListener('paste', (e) => {
      const text = e.clipboardData && e.clipboardData.getData('text');
      if (text && /[,\n;]/.test(text)) { e.preventDefault(); addChips(key, input.value + text); input.value = ''; }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) { addChips(key, input.value); input.value = ''; } });
    input.addEventListener('input', () => renderSuggest(key));
    box.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const values = chipValues(key);
        values.splice(Number(remove.dataset.remove), 1);
        writeChips(key, values);
        input.focus();
        return;
      }
      const suggestion = e.target.closest('[data-suggest-value]');
      if (suggestion) { addChips(key, suggestion.dataset.suggestValue); input.value = ''; renderSuggest(key); input.focus(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target.closest('[data-suggest-value]')) e.preventDefault(); });
  }
  const renderChips = (key) => {
    const values = chipValues(key);
    const sig = values.join('\u0001');
    if (state.keys[`chips-${key}`] === sig) return;
    state.keys[`chips-${key}`] = sig;
    const ul = chipsRoots[key].querySelector('.bseo-chips__list');
    ul.innerHTML = values.map((v, i) => `<li><span class="bseo-chip">${esc(v)}<button type="button" class="bseo-chip__x" data-remove="${i}" aria-label="Remove ${esc(v)}">${svg('close')}</button></span></li>`).join('');
    renderSuggest(key);
  };
  const renderSuggest = (key) => {
    const box = chipsRoots[key].querySelector('[data-suggest]');
    if (key !== 'about') { box.hidden = true; return; }
    const chosen = new Set(chipValues(key).map((v) => v.toLowerCase()));
    const query = chipsRoots[key].querySelector('input').value.trim().toLowerCase();
    const pool = [...new Set([...allList().flatMap((p) => list(isObj(p) ? p.about : []).map(str)), ...COMMON_CONDITIONS])]
      .filter((v) => v && !chosen.has(v.toLowerCase()) && (!query || v.toLowerCase().includes(query)))
      .slice(0, 6);
    box.hidden = !pool.length;
    box.innerHTML = pool.length ? `<span class="bseo-suggest__label">Suggestions</span>${pool.map((v) => `<button type="button" class="bseo-suggest__chip" data-suggest-value="${esc(v)}">${svg('plus')}${esc(v)}</button>`).join('')}` : '';
  };

  // ---- related ------------------------------------------------------------
  const titleOf = (p) => str(p && p.title).trim() || str(p && p.slug) || 'Untitled post';
  const categoryName = (p) => (list(config && config.categories).find((c) => isObj(c) && c.id === p.category) || {}).name || '';
  const statusNote = (p) => (p.status === 'published' ? '' : p.status === 'scheduled' ? 'Scheduled' : 'Not live');
  const writeRelated = (ids) => change({ related: ids });
  els.related.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    const ids = [...list(read().related)];
    const i = Number(button.dataset.i);
    if (button.dataset.act === 'remove') ids.splice(i, 1);
    if (button.dataset.act === 'up' && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    if (button.dataset.act === 'down' && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
    writeRelated(ids);
    const again = els.related.querySelector(`button[data-act="${button.dataset.act}"][data-i="${button.dataset.act === 'up' ? i - 1 : button.dataset.act === 'down' ? i + 1 : i}"]`);
    (again && !again.disabled ? again : els.relq).focus();
  });
  els.relq.addEventListener('input', () => renderResults());
  els.relq.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { els.relq.value = ''; renderResults(); }
    if (e.key === 'Enter') { e.preventDefault(); const first = els.relResults.querySelector('button'); if (first) first.click(); }
  });
  els.relResults.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-add]');
    if (!button) return;
    const ids = list(read().related);
    if (ids.length >= 4 || ids.includes(button.dataset.add)) return;
    writeRelated([...ids, button.dataset.add]);
    els.relq.value = '';
    renderResults();
    els.relq.focus();
  });
  const renderRelated = () => {
    const post = read();
    const ids = list(post.related);
    const byId = new Map(allList().filter(isObj).map((p) => [p.id, p]));
    const sig = `${ids.join(',')}|${ids.map((i) => titleOf(byId.get(i))).join(',')}`;
    if (state.keys.related !== sig) {
      state.keys.related = sig;
      els.related.innerHTML = ids.map((rid, i) => {
        const p = byId.get(rid);
        const note = p ? statusNote(p) : 'Missing';
        return `<li class="bseo-related__row">
          <span class="bseo-related__n" aria-hidden="true">${i + 1}</span>
          <span class="bseo-related__text"><span class="bseo-related__title">${esc(p ? titleOf(p) : rid)}</span><span class="bseo-related__meta">${esc([p && categoryName(p), note].filter(Boolean).join(' · ') || (p ? `blog/${p.slug}/` : 'This post no longer exists — remove it'))}</span></span>
          <span class="bseo-related__acts">
            <button type="button" class="bseo-icon" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${iconOr('up')}</button>
            <button type="button" class="bseo-icon" data-act="down" data-i="${i}" aria-label="Move down" ${i === ids.length - 1 ? 'disabled' : ''}>${iconOr('down')}</button>
            <button type="button" class="bseo-icon" data-act="remove" data-i="${i}" aria-label="Remove ${esc(p ? titleOf(p) : rid)}">${svg('close')}</button>
          </span></li>`;
      }).join('');
      els.related.hidden = !ids.length;
    }
    const full = ids.length >= 4;
    els.relq.disabled = full;
    els.relq.placeholder = full ? 'Four picked — remove one to add another' : 'Search posts by title';
    const auto = relatedOf(post, allList()).filter((p) => !ids.includes(p.id));
    els.relAuto.textContent = full ? ''
      : ids.length
        ? (auto.length ? `The site fills the remaining ${4 - ids.length === 1 ? 'place' : 'places'} with: ${auto.map((p) => `“${titleOf(p)}”`).join(', ')}.` : '')
        : (auto.length ? `Left empty, readers see: ${auto.map((p) => `“${titleOf(p)}”`).join(', ')} (same topic first, then shared keywords).` : 'Left empty, the site picks posts on the same topic once there are some.');
    renderResults();
  };
  const renderResults = () => {
    const post = read();
    const ids = list(post.related);
    const q = els.relq.value.trim().toLowerCase();
    if (!q || ids.length >= 4) { els.relResults.innerHTML = ''; els.relResults.hidden = true; return; }
    const words = q.split(/\s+/);
    const matches = others()
      .filter((p) => !ids.includes(p.id))
      .filter((p) => { const hay = `${titleOf(p)} ${str(p.slug)} ${str(p.seo && p.seo.focusKeyphrase)}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .slice(0, 6);
    els.relResults.hidden = false;
    els.relResults.innerHTML = matches.length
      ? matches.map((p) => `<li><button type="button" data-add="${esc(p.id)}"><span class="bseo-results__title">${esc(titleOf(p))}</span><span class="bseo-results__meta">${esc([categoryName(p), statusNote(p)].filter(Boolean).join(' · '))}</span><span class="bseo-results__add">${svg('plus')}Add</span></button></li>`).join('')
      : `<li class="bseo-results__none">No post matches “${esc(els.relq.value.trim())}”.</li>`;
  };

  // ---- meters -------------------------------------------------------------
  const meter = (name, { ratio, good, text }) => {
    const el = root.querySelector(`[data-meter="${name}"]`);
    el.dataset.state = good ? 'good' : 'warn';
    el.querySelector('.bseo-meter__fill').style.setProperty('--fill', String(Math.max(0.02, Math.min(1, ratio))));
    el.querySelector('.bseo-meter__text').textContent = text;
  };
  const renderMeters = (post) => {
    const seo = isObj(post.seo) ? post.seo : {};
    const own = str(seo.title).trim();
    const base = own || str(post.title).trim();
    const shown = googleTitle(base, config);
    const px = Math.round(textWidth(shown, SERP.titleFont));
    const n = base.length;
    const titleGood = n > 0 && n <= TITLE_MAX && px <= SERP.titleMax;
    meter('title', {
      ratio: Math.max(n / TITLE_MAX, px / SERP.titleMax),
      good: titleGood,
      text: !n ? 'Add a title — Google needs one to show.'
        : `${n} characters (aim for ${TITLE_MAX} or fewer) · about ${px} of ${SERP.titleMax} px wide on Google${px > SERP.titleMax ? ', so it will be cut' : ''}`,
    });
    els.titleSrc.textContent = own ? '' : 'Using the post title';
    const ownDesc = str(seo.description).trim();
    const desc = ownDesc || str(post.dek).trim();
    const d = desc.length;
    meter('description', {
      ratio: d / 155,
      good: d >= 120 && d <= 160,
      text: !d ? 'Add a description — or Google picks a sentence for you.'
        : `${d} characters · aim for 120–155${d > 160 ? ' — Google cuts the rest' : d < 120 ? ' — room for a little more' : ''}`,
    });
    els.descSrc.textContent = ownDesc ? '' : (str(post.dek).trim() ? 'Using the summary under the title' : '');
  };

  // ---- checklist ----------------------------------------------------------
  const checkItem = (item, extra = '') => `<li class="bseo-check" data-status="${item.status === 'good' ? 'good' : 'warn'}" data-id="${esc(item.id)}"><span class="bseo-mark" aria-hidden="true">${item.status === 'good' ? iconOr('check') : svg('warn')}</span><span class="bseo-check__text"><span class="bseo-sr">${item.status === 'good' ? 'Good: ' : 'To look at: '}</span>${extra || esc(item.message)}</span></li>`;
  const renderChecks = (post) => {
    const api = checksApi();
    if (!api) { els.checks.innerHTML = '<li class="bseo-check">Checks are still loading.</li>'; return; }
    const seo = api.seoChecklist(post, allList());
    const claims = api.claimsCheck(post);
    const note = str(api.CLAIMS_NOTE);
    const sig = JSON.stringify([seo, claims]);
    if (state.keys.checks === sig) return;
    state.keys.checks = sig;
    const goodCount = seo.filter((i) => i.status === 'good').length;
    const warnCount = seo.length - goodCount;
    els.sum.innerHTML = `<span class="bseo-sum__good">${goodCount} good</span>${warnCount ? `<span class="bseo-sum__warn">${warnCount} to look at</span>` : ''}`;
    els.checks.innerHTML = seo.map((item) => checkItem(item)).join('');
    els.claims.innerHTML = claims.map((item) => {
      if (item.status === 'good') return checkItem({ ...item, message: str(item.message).replace(note, '').trim() });
      const prefix = `In ${item.where}: “${item.phrase}”. `;
      const advice = str(item.message).startsWith(prefix) ? str(item.message).slice(prefix.length) : str(item.message);
      return checkItem(item, `<span class="bseo-claim"><span class="bseo-claim__phrase">“${esc(item.phrase)}”</span> <span class="bseo-claim__where">in ${esc(item.where)}</span></span><span class="bseo-claim__advice">${esc(advice)}</span>`);
    }).join('');
    els.claimsNote.textContent = `Legal advice on this wording is still pending, so treat these as cautions, not rulings. ${note}`.trim();
  };

  // ---- Google + share previews -------------------------------------------
  const favicon = new URL('../assets/brand/favicon.svg', import.meta.url).href;
  const shareFallback = new URL('../assets/brand/og-image.png', import.meta.url).href;
  root.querySelector('.bseo-seg').addEventListener('click', (e) => {
    const button = e.target.closest('[data-snippet]');
    if (!button) return;
    state.snippet = button.dataset.snippet;
    root.querySelectorAll('[data-snippet]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    state.keys.serp = '';
    renderPreviews(read());
  });
  // Google's desktop result column is ~600px. Draw it at that width and zoom
  // it to fit, so the truncation shown is the one Google would make.
  const fitSerp = () => {
    const inner = els.serp.clientWidth - 40; // .bseo-serp-wrap side padding
    if (inner > 0) els.serp.style.setProperty('--serp-zoom', String(Math.min(1, inner / 600)));
  };
  const serpObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(fitSerp) : null;
  if (serpObserver) serpObserver.observe(els.serp);
  if (root.clientWidth && root.clientWidth < 640) {
    state.snippet = 'mobile';
    root.querySelectorAll('[data-snippet]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snippet === 'mobile')));
  }
  const renderPreviews = (post) => {
    const seo = isObj(post.seo) ? post.seo : {};
    const base = str(seo.title).trim() || str(post.title).trim() || 'Untitled post';
    const full = googleTitle(base, config);
    const desc = str(seo.description).trim() || str(post.dek).trim();
    const slug = str(post.slug) || 'your-post';
    const date = dayLabel(post.publishAt) || dayLabel(new Date());
    const mobile = state.snippet === 'mobile';
    const title = mobile ? truncatePx(full, SERP.mobileTitleMax, SERP.mobileTitleFont) : truncatePx(full, SERP.titleMax, SERP.titleFont);
    const shownDesc = desc ? truncatePx(desc, mobile ? SERP.mobileDescMax : SERP.descMax, SERP.descFont) : '';
    const cover = isObj(post.cover) ? post.cover : null;
    const coverUrl = cover && !cover.patient ? imageUrl(cover.src, resolveSrc) : '';
    const sig = JSON.stringify([state.snippet, title, shownDesc, slug, date, coverUrl, cover && cover.patient, full, desc]);
    if (state.keys.serp === sig) return;
    state.keys.serp = sig;
    els.serp.innerHTML = `<div class="bseo-serp" data-device="${mobile ? 'mobile' : 'desktop'}">
      <div class="bseo-serp__site"><span class="bseo-serp__icon"><img src="${esc(favicon)}" alt=""></span><span class="bseo-serp__src"><span class="bseo-serp__name">MediVasc</span><span class="bseo-serp__url">https://${esc(SITE_HOST)} › blog › ${esc(slug)}</span></span></div>
      <p class="bseo-serp__title">${esc(title)}</p>
      <p class="bseo-serp__desc">${shownDesc ? `<span class="bseo-serp__date">${esc(date)} — </span>${esc(shownDesc)}` : '<span class="bseo-serp__empty">No description yet — Google will pick a sentence from the post.</span>'}</p>
    </div>`;
    const image = coverUrl || (cover && cover.patient ? shareFallback : '');
    const media = image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async">` : '<span class="bseo-share__noimg">No cover image yet</span>';
    const shareDesc = desc || 'No description yet.';
    const url = `${SITE}blog/${slug}/`;
    els.share.innerHTML = `
      <figure class="bseo-wa">
        <figcaption class="bseo-kicker">WhatsApp</figcaption>
        <div class="bseo-wa__chat"><div class="bseo-wa__bubble">
          <div class="bseo-wa__card"><div class="bseo-wa__img">${media}</div><div class="bseo-wa__text"><p class="bseo-wa__title">${esc(full)}</p><p class="bseo-wa__desc">${esc(shareDesc)}</p><p class="bseo-wa__host">${esc(SITE_HOST)}</p></div></div>
          <p class="bseo-wa__msg"><span class="bseo-wa__link">${esc(url)}</span><span class="bseo-wa__time">10:24</span></p>
        </div></div>
      </figure>
      <figure class="bseo-x">
        <figcaption class="bseo-kicker">X</figcaption>
        <div class="bseo-x__card"><div class="bseo-x__media">${media}<span class="bseo-x__label">${esc(full)}</span></div></div>
        <p class="bseo-x__from">From ${esc(SITE_HOST)}</p>
      </figure>
      ${cover && cover.patient ? '<p class="bseo-note bseo-share__patient">The cover is a patient photo, so it never goes on a share card — the site’s standard share image is used instead.</p>' : ''}`;
  };

  // ---- slug status --------------------------------------------------------
  const renderSlug = (post) => {
    setValue(els.slug, str(post.slug));
    const fromTitle = slugify(post.title);
    els.reset.hidden = state.auto || !fromTitle || fromTitle === post.slug;
    els.slugHelp.textContent = state.auto
      ? 'Follows the title until you edit it.'
      : hasBeenLive(post)
        ? 'This post has been live. If you change the address, the old one keeps sending readers here.'
        : 'Set by you — it no longer follows the title.';
    const slug = str(post.slug);
    const owner = slug && others().find((p) => p.slug === slug || list(p.previousSlugs).includes(slug));
    const empty = !slug && document.activeElement !== els.slug;
    els.slugErr.hidden = !owner && !empty;
    els.slugErr.textContent = owner ? `Another post already uses this address: “${titleOf(owner)}”. Pick a different one.` : empty ? 'Add an address — or a title, and it fills in.' : '';
    els.slug.setAttribute('aria-invalid', String(Boolean(owner || empty)));
  };

  // ---- update -------------------------------------------------------------
  const update = () => {
    if (state.destroyed) return;
    const post = read();
    if (post.id !== state.postId) {
      state.postId = post.id;
      state.auto = deriveAuto(post);
      state.keys = {};
    }
    followTitle();
    const seo = isObj(post.seo) ? post.seo : {};
    renderSlug(post);
    setValue(els.title, str(seo.title));
    setValue(els.description, str(seo.description));
    setValue(els.focusKeyphrase, str(seo.focusKeyphrase));
    els.title.placeholder = str(post.title).trim() || 'Uses the post title';
    els.description.placeholder = str(post.dek).trim() || 'Uses the summary under the title';
    renderMeters(post);
    renderChips('keywords');
    renderChips('about');
    renderRelated();
    renderChecks(post);
    renderPreviews(post);
  };

  update();
  return {
    refresh: update,
    destroy() {
      state.destroyed = true;
      if (serpObserver) serpObserver.disconnect();
      root.innerHTML = '';
      root.classList.remove('bseo', 'bseo--panel');
    },
  };
}

function chipsMarkup(esc, fid, key, label, placeholder, help) {
  return `<div class="bseo-field" data-chips="${key}">
    <label for="${fid}">${esc(label)}</label>
    <div class="bseo-chips"><ul class="bseo-chips__list"></ul><input id="${fid}" class="bseo-chips__input" autocomplete="off" enterkeyhint="done" placeholder="${esc(placeholder)}" aria-describedby="${fid}-help"></div>
    <div class="bseo-suggest" data-suggest hidden></div>
    <p class="field-help" id="${fid}-help">${esc(help)}</p>
  </div>`;
}

// ============================================================ post preview

const DEVICES = { phone: { w: 390, h: 844 }, desktop: { w: 1280, h: 800 } };
let rendererPromise = null;
// The renderer bundle is a classic script (V4); it needs the blog-blocks and
// content-rules globals, which this module's imports have already set.
const loadRenderer = () => {
  if (globalThis.MediVascBlogRender && typeof globalThis.MediVascBlogRender.renderPost === 'function') return Promise.resolve(globalThis.MediVascBlogRender);
  if (!rendererPromise) {
    rendererPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./preview/blog-render.js', import.meta.url).href;
      script.async = false;
      script.dataset.bseoRenderer = '';
      script.onload = () => (globalThis.MediVascBlogRender && typeof globalThis.MediVascBlogRender.renderPost === 'function'
        ? resolve(globalThis.MediVascBlogRender)
        : reject(new Error('blog-render.js loaded but did not set MediVascBlogRender.')));
      script.onerror = () => { script.remove(); rendererPromise = null; reject(new Error('The preview files were not found (admin/preview/blog-render.js).')); };
      document.head.append(script);
    });
  }
  return rendererPromise;
};

// The post enriched the way build-blog.js does (the bits renderPost reads).
const enrichPost = (post, config, depth) => {
  const tax = (item, kind) => (isObj(item) ? { ...item, url: `blog/${kind}/${item.slug}/`, href: `${depth}blog/${kind}/${item.slug}/`, absUrl: `${SITE}blog/${kind}/${item.slug}/` } : null);
  const find = (items, fid) => list(items).find((x) => isObj(x) && x.id === fid);
  const at = toDate(post.publishAt) || new Date();
  const updated = post.updatedAt ? toDate(post.updatedAt) : null;
  const updatedValid = Boolean(updated) && dayLabel(updated) !== dayLabel(at);
  return {
    ...post,
    url: `blog/${str(post.slug)}/`,
    href: `${depth}blog/${str(post.slug)}/`,
    absUrl: `${SITE}blog/${str(post.slug)}/`,
    categoryObj: tax(find(config && config.categories, post.category), 'category'),
    authorObj: tax(find(config && config.authors, post.author), 'author'),
    reviewerObj: post.reviewer ? tax(find(config && config.authors, post.reviewer), 'author') : null,
    readingMinutes: blocksApi() ? blocksApi().readingMinutes(post) : 1,
    published: at,
    publishedLabel: dayLabel(at),
    updated: updatedValid ? updated : null,
    updatedLabel: updatedValid ? dayLabel(updated) : '',
  };
};

export function mountPostPreview(root, { getPost, config = {}, films = [], resolveSrc, allPosts, controls = true, contactHref } = {}) {
  const state = { device: 'phone', theme: 'light', ready: false, timer: 0, last: 0, html: '', destroyed: false, ratio: 0 };
  // V4 ctx: depth '../'. The block renderer only accepts a '../'-style depth
  // (an absolute one is dropped, which sent film posters and internal links to
  // admin/assets/…), so the srcdoc gets an explicit <base> at this module's
  // folder (admin/) and every depth-prefixed path lands on the site root.
  const depth = '../';
  const baseUrl = new URL('./', import.meta.url).href;
  const cssUrl = new URL('./preview/blog-preview.css', import.meta.url).href;
  root.classList.add('bseo', 'bseo--preview');
  root.innerHTML = `
    <div class="bseo-pv__bar">
      ${controls ? `<div class="bseo-seg" role="group" aria-label="Preview device"><button type="button" data-device="phone" aria-pressed="true">Phone</button><button type="button" data-device="desktop" aria-pressed="false">Desktop</button></div>
      <div class="bseo-seg" role="group" aria-label="Preview colours"><button type="button" data-ptheme="light" aria-pressed="true">Light</button><button type="button" data-ptheme="dark" aria-pressed="false">Dark</button></div>` : ''}
      <span class="bseo-pv__url" data-url></span>
    </div>
    <div class="bseo-pv__stage" data-stage>
      <div class="bseo-pv__frame" data-frame data-device="phone">
        <div class="bseo-pv__screen" data-screen><iframe title="Preview of the post as readers will see it" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe></div>
        <p class="bseo-pv__msg" data-msg role="status" hidden></p>
      </div>
    </div>`;
  const stage = root.querySelector('[data-stage]');
  const frame = root.querySelector('[data-frame]');
  const screen = root.querySelector('[data-screen]');
  const iframe = root.querySelector('iframe');
  const msg = root.querySelector('[data-msg]');
  const urlEl = root.querySelector('[data-url]');

  const esc = escape;
  const hrefs = () => (typeof contactHref === 'function' ? contactHref() : contactHref);
  const ctx = () => {
    const pool = typeof allPosts === 'function' ? allPosts() : allPosts;
    const live = list(pool).filter(isLivePost);
    const enriched = new Map(live.map((p) => [p.id, enrichPost(p, config, depth)]));
    return {
      depth,
      blog: config,
      films: list(films),
      img: (src, { alt = '', className = '' } = {}) => {
        const url = imageUrl(src, resolveSrc);
        return `<img src="${esc(url)}" alt="${esc(alt)}"${className ? ` class="${esc(className)}"` : ''} loading="eager" decoding="async">`;
      },
      // Links never navigate the preview, so these only steer which CTA the
      // renderer draws. Default = the live site today (a WhatsApp number, no
      // public phone); a host with company.json passes the real hrefs.
      contactHref: { whatsapp: 'https://wa.me/', call: '', contact: `${depth}#contact`, ...(isObj(hrefs()) ? hrefs() : {}) },
      related: (post) => (live.length ? relatedOf(post, live).map((p) => enriched.get(p.id)).filter(Boolean) : []),
      featured: list(config && config.featured).map((fid) => enriched.get(fid)).filter(Boolean),
    };
  };
  const docHtml = (main) => `<!doctype html><html lang="en" class="js" data-theme="${state.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${esc(baseUrl)}"><link rel="stylesheet" href="${esc(cssUrl)}"></head><body class="page-blog page-blog--post"><main id="main">${main}</main></body></html>`;

  const showMsg = (text) => { msg.textContent = text; msg.hidden = !text; };
  const win = () => { try { return iframe.contentWindow; } catch { return null; } };
  const doc = () => { try { return iframe.contentDocument; } catch { return null; } };
  const scrollRatio = () => {
    const w = win(); const d = doc();
    if (!w || !d || !d.documentElement) return 0;
    const max = d.documentElement.scrollHeight - w.innerHeight;
    return max > 0 ? w.scrollY / max : 0;
  };
  const restoreRatio = (ratio) => {
    const w = win(); const d = doc();
    if (!w || !d || !d.documentElement) return;
    const max = d.documentElement.scrollHeight - w.innerHeight;
    if (max > 0) w.scrollTo(0, Math.round(ratio * max));
  };

  // No scripts run in the frame (sandbox without allow-scripts); the parent
  // keeps in-page anchors working and stops links navigating the preview away.
  const onFrameClick = (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') && href.length > 1) {
      const target = doc() && doc().getElementById(decodeURIComponent(href.slice(1)));
      if (target) target.scrollIntoView({ block: 'start' });
    }
  };
  iframe.addEventListener('load', () => {
    const d = doc();
    if (!d || !d.getElementById('main')) return;
    state.ready = true;
    d.documentElement.dataset.theme = state.theme;
    d.addEventListener('click', onFrameClick, true);
    if (state.ratio) requestAnimationFrame(() => restoreRatio(state.ratio));
  });

  const layout = () => {
    if (state.destroyed) return;
    const { w, h } = DEVICES[state.device];
    const avail = Math.max(240, stage.clientWidth);
    let scale = Math.min(1, avail / w);
    let height = h;
    if (state.device === 'phone') {
      const maxH = Math.max(460, Math.min(h, window.innerHeight - 150));
      scale = Math.min(scale, maxH / h);
    } else {
      height = Math.min(h, Math.max(480, (window.innerHeight - 150) / scale));
    }
    frame.dataset.device = state.device;
    frame.style.width = `${Math.round(w * scale)}px`;
    frame.style.height = `${Math.round(height * scale)}px`;
    screen.style.width = `${w}px`;
    screen.style.height = `${height}px`;
    screen.style.transform = `scale(${scale})`;
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  if (observer) observer.observe(stage);
  window.addEventListener('resize', layout);

  const settle = (main, minHeight) => {
    const pending = [...main.querySelectorAll('img')].filter((img) => !img.complete);
    if (!pending.length) { main.style.minHeight = ''; return; }
    const done = () => { if (!state.destroyed) main.style.minHeight = ''; };
    Promise.race([
      Promise.all(pending.map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))),
      new Promise((r) => setTimeout(r, 2000)),
    ]).then(done);
    main.style.minHeight = minHeight;
  };

  const render = async () => {
    state.timer = 0;
    state.last = performance.now();
    let api;
    try {
      api = await loadRenderer();
    } catch (error) {
      if (!state.destroyed) showMsg(`Preview unavailable. ${error.message}`);
      return;
    }
    if (state.destroyed) return;
    const post = typeof getPost === 'function' ? getPost() : null;
    if (!isObj(post)) { showMsg('Nothing to preview yet.'); return; }
    urlEl.textContent = `${SITE_HOST}/blog/${str(post.slug) || '…'}/`;
    let html;
    try {
      html = api.renderPost(ctx(), enrichPost(post, config, depth));
    } catch (error) {
      console.error('[blog preview]', error);
      showMsg('Preview paused — part of the post can’t be drawn yet. It updates as soon as it can.');
      return;
    }
    showMsg('');
    if (state.ready && html === state.html) return;
    state.html = html;
    const d = state.ready ? doc() : null;
    const main = d && d.getElementById('main');
    if (main) {
      const w = win();
      const y = w ? w.scrollY : 0;
      const before = `${main.offsetHeight}px`;
      main.innerHTML = html;
      settle(main, before);
      if (w) w.scrollTo(0, y);
    } else {
      state.ratio = state.ready ? scrollRatio() : state.ratio;
      state.ready = false;
      iframe.srcdoc = docHtml(html);
    }
  };

  // Throttled: at most one render every ~500 ms while the owner types, always
  // with a trailing render so the last keystroke shows.
  const refresh = () => {
    if (state.destroyed || state.timer) return;
    const wait = Math.max(0, 500 - (performance.now() - state.last));
    state.timer = setTimeout(render, wait);
  };

  const syncControls = () => {
    root.querySelectorAll('[data-device]').forEach((b) => { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.device === state.device)); });
    root.querySelectorAll('button[data-ptheme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ptheme === state.theme)));
  };
  const setMode = ({ device, theme } = {}) => {
    if (state.destroyed) return;
    if (device && DEVICES[device] && device !== state.device) {
      const ratio = scrollRatio();
      state.device = device;
      layout();
      requestAnimationFrame(() => requestAnimationFrame(() => restoreRatio(ratio)));
    }
    if ((theme === 'light' || theme === 'dark') && theme !== state.theme) {
      state.theme = theme;
      const d = doc();
      if (state.ready && d) d.documentElement.dataset.theme = theme;
    }
    syncControls();
  };
  root.querySelector('.bseo-pv__bar').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.device) setMode({ device: button.dataset.device });
    if (button.dataset.ptheme) setMode({ theme: button.dataset.ptheme });
  });

  layout();
  refresh();
  return {
    refresh,
    setMode,
    destroy() {
      state.destroyed = true;
      clearTimeout(state.timer);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', layout);
      root.innerHTML = '';
      root.classList.remove('bseo', 'bseo--preview');
    },
  };
}

// ========================================================= version history

const POSTS_PATH = 'data/blog/posts.json';
const fileCache = new Map(); // sha → parsed posts.json (a commit's content never changes)
const isRateLimit = (e) => Boolean(e) && (e.status === 429 || (e.status === 403 && /rate limit|secondary/i.test(String(e.message))));
const friendlyError = (e) => {
  if (isRateLimit(e)) return 'GitHub’s hourly allowance for looking up history is used up. It refills on its own — try again in a little while.';
  if (e && (e.name === 'AuthError' || e.status === 401)) return 'Your GitHub sign-in has expired. Sign in again to see the history.';
  if (e && e.status === 0) return 'GitHub can’t be reached right now. Check the connection, then try again.';
  return `The history couldn’t be loaded${e && e.message ? ` (${e.message.replace(/\.$/, '')})` : ''}.`;
};

export function mountRevisions(root, { postId, gh, onRestore } = {}) {
  const state = { commits: null, versions: new Map(), error: null, loading: false, destroyed: false, confirm: null, wanted: 6, notice: '' };
  root.classList.add('bseo', 'bseo--revisions');
  root.innerHTML = `
    <div class="bseo-rev__head">
      <h3 class="bseo-sec__title">Version history</h3>
      <p class="bseo-sec__lede">Every published change to this post. Restoring puts an older version back in the editor — nothing on the site changes until you publish.</p>
    </div>
    <div data-rev-body></div>
    <p class="bseo-rev__status" data-rev-status role="status"></p>`;
  const body = root.querySelector('[data-rev-body]');
  const status = root.querySelector('[data-rev-status]');

  const versionAt = async (sha) => {
    if (fileCache.has(sha)) return fileCache.get(sha);
    const text = await gh.getFileAt(POSTS_PATH, sha);
    let posts;
    try { posts = JSON.parse(text); } catch { posts = null; }
    const value = Array.isArray(posts) ? posts : null;
    fileCache.set(sha, value);
    return value;
  };

  // Load file contents for commits [0, wanted) one by one (newest first).
  const loadVersions = async () => {
    if (state.loading || !state.commits) return;
    state.loading = true;
    for (let i = 0; i < Math.min(state.wanted, state.commits.length); i += 1) {
      if (state.destroyed) return;
      const commit = state.commits[i];
      const known = state.versions.get(commit.sha);
      if (known && known.state === 'ok') continue;
      try {
        const posts = await versionAt(commit.sha);
        if (state.destroyed) return;
        const post = posts ? posts.find((p) => isObj(p) && p.id === postId) || null : null;
        state.versions.set(commit.sha, { state: 'ok', post, unreadable: !posts });
      } catch (error) {
        if (state.destroyed) return;
        state.versions.set(commit.sha, { state: 'error', error });
        if (isRateLimit(error) || error.name === 'AuthError') state.error = error;
        break;
      }
      draw();
    }
    state.loading = false;
    draw();
  };

  const load = async () => {
    state.error = null;
    state.commits = null;
    draw();
    try {
      if (!gh || typeof gh.listCommits !== 'function') throw new Error('history is not available in this admin build');
      const commits = await gh.listCommits(POSTS_PATH, { perPage: 30 });
      if (state.destroyed) return;
      state.commits = list(commits).filter((c) => isObj(c) && c.sha);
    } catch (error) {
      if (state.destroyed) return;
      state.error = error;
      draw();
      return;
    }
    draw();
    loadVersions();
  };

  // Rows newest → oldest. A commit shows when the post exists at it and differs
  // from the next older loaded version; the boundary row waits for its neighbour.
  const rows = () => {
    const out = [];
    const commits = state.commits || [];
    let pending = false;
    for (let i = 0; i < commits.length; i += 1) {
      const v = state.versions.get(commits[i].sha);
      if (!v) { pending = i < state.wanted; break; }
      if (v.state === 'error') { out.push({ i, commit: commits[i], error: v.error }); break; }
      if (!v.post) continue;
      const olderCommit = commits[i + 1];
      if (!olderCommit) { out.push({ i, commit: commits[i], post: v.post, first: commits.length < 30 }); continue; }
      const older = state.versions.get(olderCommit.sha);
      // Unknown neighbour: this row can't be shown yet (it may be unchanged).
      // A failed neighbour stops the list there; its error row (or the banner,
      // for rate-limit / sign-in errors) carries the Try again.
      if (!older) { pending = i + 1 < state.wanted; break; }
      if (older.state === 'error') { out.push({ i: i + 1, commit: olderCommit, error: older.error }); break; }
      if (!older.post) { out.push({ i, commit: commits[i], post: v.post, first: true }); continue; }
      if (JSON.stringify(older.post) === JSON.stringify(v.post)) continue;
      out.push({ i, commit: commits[i], post: v.post, delta: wordCount(v.post) - wordCount(older.post) });
    }
    return { out, pending };
  };

  const deltaText = (row) => {
    if (row.first) return `First version · ${wordCount(row.post)} words`;
    if (row.delta === null || row.delta === undefined) return `${wordCount(row.post)} words`;
    if (row.delta === 0) return 'Same length';
    return `${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta)} word${Math.abs(row.delta) === 1 ? '' : 's'}`;
  };

  // Lazy loads redraw the list; keep keyboard focus on the same control.
  const FOCUS_ATTRS = ['data-restore', 'data-confirm', 'data-cancel', 'data-more', 'data-retry', 'data-retry-more', 'data-retry-version'];
  const draw = () => {
    const active = document.activeElement;
    const attr = active && body.contains(active) ? FOCUS_ATTRS.find((a) => active.hasAttribute(a)) : null;
    const value = attr ? active.getAttribute(attr) : null;
    paint();
    if (attr && !body.contains(active)) {
      const again = body.querySelector(value ? `[${attr}="${CSS.escape(value)}"]` : `[${attr}]`);
      if (again) again.focus();
    }
  };
  const paint = () => {
    if (state.destroyed) return;
    status.textContent = state.notice;
    if (state.error && !state.commits) {
      body.innerHTML = `<div class="bseo-rev__error"><p>${escape(friendlyError(state.error))}</p><button type="button" class="button button--quiet" data-retry>Try again</button></div>`;
      return;
    }
    if (!state.commits) {
      body.innerHTML = `<ol class="bseo-rev__list" aria-busy="true">${'<li class="bseo-rev__row bseo-rev__row--ghost"><span></span><span></span></li>'.repeat(3)}</ol>`;
      return;
    }
    const { out, pending } = rows();
    const latestShown = out.length ? out[0].i : -1;
    const more = state.commits.length > state.wanted && !state.error;
    const items = out.map((row) => {
      const when = escape(stampLabel(row.commit.date));
      const message = escape(str(row.commit.message).split('\n')[0].trim() || 'No description');
      if (row.error) {
        if (state.error) return ''; // the banner below already says it, with Try again
        return `<li class="bseo-rev__row bseo-rev__row--error"><div class="bseo-rev__main"><p class="bseo-rev__when"><time>${when}</time></p><p class="bseo-rev__meta">${escape(friendlyError(row.error))}</p></div><button type="button" class="button button--quiet" data-retry-version="${escape(row.commit.sha)}">Try again</button></li>`;
      }
      const confirming = state.confirm === row.commit.sha;
      return `<li class="bseo-rev__row${confirming ? ' is-confirming' : ''}" data-sha="${escape(row.commit.sha)}">
        <div class="bseo-rev__main">
          <p class="bseo-rev__when"><time datetime="${escape(str(row.commit.date))}">${when}</time>${row.i === latestShown && row.i === 0 ? '<span class="badge badge--active">Live now</span>' : ''}</p>
          <p class="bseo-rev__title">${escape(str(row.post.title) || 'Untitled post')}</p>
          <p class="bseo-rev__meta"><span>${message}</span><span class="bseo-rev__delta" data-delta>${escape(deltaText(row))}</span></p>
        </div>
        <button type="button" class="button button--text bseo-rev__restore" data-restore="${escape(row.commit.sha)}" ${confirming ? 'hidden' : ''}>${svg('restore')}Restore this version</button>
        ${confirming ? `<div class="bseo-rev__confirm" role="group" aria-label="Confirm restore">
          <p>Put this version back in the editor? It replaces what is in the editor now, including changes you have not published.</p>
          <div class="bseo-rev__confirm-acts"><button type="button" class="button button--primary" data-confirm="${escape(row.commit.sha)}">Restore</button><button type="button" class="button button--text" data-cancel>Keep current</button></div>
        </div>` : ''}
      </li>`;
    }).join('');
    const ghost = pending ? '<li class="bseo-rev__row bseo-rev__row--ghost"><span></span><span></span></li>' : '';
    const empty = !out.length && !pending && !state.error
      ? `<p class="bseo-rev__empty">${state.commits.length ? 'No earlier versions of this post yet.' : 'No published versions yet — the history starts the first time this post is published.'}</p>` : '';
    const banner = state.error ? `<div class="bseo-rev__error"><p>${escape(friendlyError(state.error))}</p><button type="button" class="button button--quiet" data-retry-more>Try again</button></div>` : '';
    body.innerHTML = `${items || ghost ? `<ol class="bseo-rev__list">${items}${ghost}</ol>` : ''}${empty}${banner}${more && !pending ? '<button type="button" class="button button--quiet bseo-rev__more" data-more>Show older versions</button>' : ''}`;
  };

  body.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    if (target.hasAttribute('data-retry')) { load(); return; }
    if (target.hasAttribute('data-retry-more') || target.dataset.retryVersion) {
      state.error = null;
      if (target.dataset.retryVersion) state.versions.delete(target.dataset.retryVersion);
      for (const [sha, v] of state.versions) if (v.state === 'error') state.versions.delete(sha);
      draw();
      loadVersions();
      return;
    }
    if (target.hasAttribute('data-more')) { state.wanted += 5; draw(); loadVersions(); return; }
    if (target.dataset.restore) {
      state.confirm = target.dataset.restore;
      state.notice = '';
      draw();
      const primary = body.querySelector('[data-confirm]');
      if (primary) primary.focus();
      return;
    }
    if (target.hasAttribute('data-cancel')) {
      const sha = state.confirm;
      state.confirm = null;
      draw();
      const back = body.querySelector(`[data-restore="${CSS.escape(sha)}"]`);
      if (back) back.focus();
      return;
    }
    if (target.dataset.confirm) {
      const sha = target.dataset.confirm;
      const v = state.versions.get(sha);
      const commit = (state.commits || []).find((c) => c.sha === sha);
      state.confirm = null;
      if (v && v.post && typeof onRestore === 'function') {
        onRestore(clone(v.post));
        state.notice = `The version from ${stampLabel(commit && commit.date)} is back in the editor. Review it, then publish when you are ready.`;
      }
      draw();
      const back = body.querySelector(`[data-restore="${CSS.escape(sha)}"]`);
      if (back) back.focus();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.confirm) {
      const cancel = body.querySelector('[data-cancel]');
      if (cancel) cancel.click();
    }
  });

  load();
  return {
    destroy() {
      state.destroyed = true;
      root.innerHTML = '';
      root.classList.remove('bseo', 'bseo--revisions');
    },
  };
}
