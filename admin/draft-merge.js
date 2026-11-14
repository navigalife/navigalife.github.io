// Three-way merge for "Load their changes, keep mine" (admin/app.js
// reloadAndReapply). `main` has two writers — the owner publishing from this
// admin and the advisor pushing code (AGENTS.md). When main moves under an open
// admin, putting the owner's whole stale copy of a file back on top would quietly
// revert whatever the other writer changed in that file, and the next publish
// would commit the revert. So only what the owner actually changed is carried
// over, measured against the copy the admin loaded (the base):
//
//   lists of items  matched by a stable key (id / src; In therapy patients by
//                   their photographs), each item taken from whichever side
//                   changed it, order from whichever side reordered
//   objects         per key — per field inside each section for content.json
//                   and site-config.json, per top-level key for company.json
//                   (the address fields move together)
//
// When both sides changed the same item or field there is no safe guess: main's
// version is kept and the item is named back to the owner to redo. Pure
// functions, no DOM — app.js owns the state and the staged files.

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// Key-order-insensitive comparison: an editor that rebuilds an object with its
// fields in another order has not changed it.
const canonical = (value) => JSON.stringify(value, (key, inner) => (isObject(inner)
  ? Object.fromEntries(Object.keys(inner).sort().map((name) => [name, inner[name]]))
  : inner));
export const sameValue = (a, b) => canonical(a) === canonical(b);

const fileName = (src) => String(src || '').split('/').pop();

const LISTS = {
  products: { key: 'id', file: 'Products', name: (item) => item.name || item.id },
  protocols: { key: 'id', file: 'Protocols', name: (item) => item.condition || item.id },
  // As the Recoveries list titles a story: its condition, then where.
  testimonials: { key: 'id', file: 'Recoveries', name: (item) => (item.condition || item.name || item.id) + (item.location ? ' (' + item.location + ')' : '') },
  solutions: { key: 'id', file: 'Solutions', name: (item) => item.title || item.id },
  themes: { key: 'id', file: 'Appearance themes', name: (item) => item.label || item.id },
  films: { key: 'src', file: 'Videos', name: (item) => item.caption || fileName(item.src) },
  feedback: { key: 'src', file: 'Voices', name: (item) => 'the photo ' + fileName(item.src) },
  treatment: { match: 'photos', file: 'In therapy', name: (item) => item.label || item.location || 'a patient' },
  blogPosts: { key: 'id', file: 'Blog posts', name: (item) => (item.title ? '“' + item.title + '”' : item.slug || item.id) },
};

// Page tab section names (page-editor.js SECTIONS) and owner words for fields.
const SECTIONS = {
  nav: 'Header & footer nav', cta: 'WhatsApp buttons', hero: 'Hero', recoveries: 'Recoveries section',
  solutions: 'Solutions section', treatment: 'In therapy section', voices: 'Voices section', approach: 'Approach',
  conditions: 'Conditions', watch: 'Symptoms', eligibility: 'Eligibility', act: 'Call to action',
  consult: 'Consultation note', about: 'About', contact: 'Contact', footer: 'Footer', chat: 'Chat assistant',
};
// (content-rules.js FIELDS, minus the leading "the").
const FIELDS = {
  heading: 'heading', accent: 'highlighted word', kicker: 'small label above the heading', lede: 'intro line',
  label: 'header label', footerLabel: 'footer label', message: 'pre-filled message', lead: 'line above the headline',
  recoveriesButton: 'recoveries button label', evidenceLead: 'evidence card title', evidenceBody: 'evidence card text',
  evidenceLink: 'evidence card link label', mottoLine: 'motto', mottoAccent: 'highlighted word in the motto',
  mottoBody: 'text under the motto', caseKicker: 'case highlight label', caseQuote: 'case highlight quote',
  note: 'closing note', noteAccent: 'highlighted word in the closing note', body: 'text', title: 'title', text: 'text',
  location: 'location', disclaimer: 'disclaimer', name: 'assistant name', status: 'status line', legal: 'small print',
  greeting: 'greeting', items: 'list', questions: 'questions',
};
const CONFIG = {
  theme: 'Appearance: site theme', productsEnabled: 'Products: shown on the site', heroHeadline: 'Page: Hero headline',
  heroAccent: 'Page: Hero highlighted word', heroSub: 'Page: Hero text under the headline', heroStats: 'Page: Hero figures',
  eligibility: 'Page: Eligibility', seo: 'Appearance: search listing',
};
const words = (key) => FIELDS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const OBJECTS = {
  content: { depth: 2, label: (path) => 'Page: ' + (SECTIONS[path[0]] || path[0]) + (path[1] ? ', ' + words(path[1]) : '') },
  config: { depth: 2, label: (path) => (CONFIG[path[0]] || words(path[0])) + (path[1] ? ', ' + words(path[1]) : '') },
  company: {
    depth: 1,
    groups: [['address', 'addressParts', 'geo', 'mapsUrl']],
    label: (path) => 'Company: ' + (path[0] === 'address' ? 'address and map location' : words(path[0])),
  },
};

// One value, three versions. Main's version wins a real conflict.
const pick = (base, ours, theirs) => {
  if (sameValue(ours, base)) return { value: theirs };
  if (sameValue(theirs, base) || sameValue(ours, theirs)) return { value: ours };
  return { value: theirs, conflict: true };
};

const mergeObject = (spec, base, ours, theirs, depth, path, conflicts) => {
  const units = new Map(); // first key of a unit -> its keys
  const grouped = new Map();
  for (const group of (path.length ? [] : spec.groups || [])) for (const key of group) grouped.set(key, group);
  const allKeys = [...new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(base)])];
  for (const key of allKeys) {
    const group = grouped.get(key);
    const head = group ? group[0] : key;
    if (!units.has(head)) units.set(head, group || [key]);
  }
  const result = {};
  const taken = {};
  for (const [head, keys] of units) {
    const slice = (side) => Object.fromEntries(keys.filter((key) => key in side).map((key) => [key, side[key]]));
    if (keys.length === 1 && depth > 1 && isObject(base[head]) && isObject(ours[head]) && isObject(theirs[head])) {
      taken[head] = mergeObject(spec, base[head], ours[head], theirs[head], depth - 1, [...path, head], conflicts);
      continue;
    }
    const outcome = pick(slice(base), slice(ours), slice(theirs));
    if (outcome.conflict) conflicts.push(spec.label([...path, head]));
    Object.assign(taken, outcome.value);
  }
  // Main's key order, then anything only the owner has, in the owner's order.
  for (const key of [...Object.keys(theirs), ...Object.keys(ours)]) if (key in taken && !(key in result)) result[key] = taken[key];
  return result;
};

// Stable identity for each item of a list, or null when the list can't be
// keyed safely (missing or repeated keys) — then the file is merged whole.
const keysFor = (spec, items, baseItems, side) => {
  if (!Array.isArray(items)) return null;
  let keys;
  if (spec.key) keys = items.map((item) => (isObject(item) && typeof item[spec.key] === 'string' && item[spec.key] ? 'k:' + item[spec.key] : null));
  else {
    // In therapy patients have no id. A patient's photographs are uploaded to
    // unique paths, so a patient is the base patient it shares a photo with.
    keys = items.map((item, index) => {
      const hits = new Set();
      for (const photo of (isObject(item) && Array.isArray(item.photos) ? item.photos : [])) {
        baseItems.forEach((candidate, at) => { if ((candidate.photos || []).includes(photo)) hits.add(at); });
      }
      if (hits.size > 1) return null;
      return hits.size ? 'b:' + [...hits][0] : side + ':' + index;
    });
  }
  if (keys.includes(null) || new Set(keys).size !== keys.length) return null;
  return keys;
};

const sameOrder = (a, b) => {
  const inB = new Set(b); const inA = new Set(a);
  return sameValue(a.filter((key) => inB.has(key)), b.filter((key) => inA.has(key)));
};

const mergeList = (spec, base, ours, theirs, conflicts) => {
  const kb = keysFor(spec, base, base, 'b');
  const ko = kb && keysFor(spec, ours, base, 'o');
  const kt = kb && keysFor(spec, theirs, base, 't');
  if (!kb || !ko || !kt) return null;
  const B = new Map(kb.map((key, i) => [key, base[i]]));
  const O = new Map(ko.map((key, i) => [key, ours[i]]));
  const T = new Map(kt.map((key, i) => [key, theirs[i]]));
  const kept = new Map();
  const say = (item, note = '') => conflicts.push(spec.file + ': ' + spec.name(item) + note);
  for (const key of new Set([...kb, ...ko, ...kt])) {
    const b = B.get(key); const o = O.get(key); const t = T.get(key);
    if (B.has(key)) {
      if (O.has(key) && T.has(key)) {
        const outcome = pick(b, o, t);
        kept.set(key, outcome.value);
        if (outcome.conflict) say(o);
      } else if (O.has(key)) {
        if (!sameValue(o, b)) say(o, ' (someone else removed it)');
      } else if (T.has(key) && !sameValue(t, b)) {
        kept.set(key, t);
        say(b, ' (you removed it, but someone else changed it, so it is back)');
      }
    } else if (O.has(key) && T.has(key)) {
      kept.set(key, t);
      if (!sameValue(o, t)) say(o, ' (someone else added one with the same name)');
    } else kept.set(key, O.has(key) ? o : t);
  }
  const ownerMoved = !sameOrder(ko, kb);
  const mainMoved = !sameOrder(kt, kb);
  if (ownerMoved && mainMoved && !sameOrder(ko, kt)) conflicts.push(spec.file + ': the order of the list');
  const primary = ownerMoved && !mainMoved ? ko : kt;
  const secondary = primary === ko ? kt : ko;
  const order = primary.filter((key) => kept.has(key));
  secondary.forEach((key, i) => {
    if (!kept.has(key) || order.includes(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const found = order.indexOf(secondary[j]);
      if (found >= 0) { at = found + 1; break; }
    }
    order.splice(at, 0, key);
  });
  return order.map((key) => kept.get(key));
};

// Blog settings (data/blog/config.json): its lists merge item by item like the
// files above (featured is an ordered list of post ids), the search listing per
// field, and every other setting (name, intro …) as one value.
const BLOG_CONFIG_LISTS = {
  categories: { key: 'id', file: 'Blog settings (categories)', name: (item) => item.name || item.id },
  authors: { key: 'id', file: 'Blog settings (authors)', name: (item) => item.name || item.id },
  redirects: { key: 'from', file: 'Blog settings (redirects)', name: (item) => 'from ' + item.from },
  featured: { key: 'id', file: 'Blog settings (featured posts)', name: (item) => item.id, ids: true },
};
const BLOG_CONFIG_WORDS = { name: 'blog name', navLabel: 'menu label', intro: 'intro text', seo: 'search listing' };
const blogConfigLabel = (path) => 'Blog settings: ' + (path[1] ? 'search listing ' + words(path[1]) : BLOG_CONFIG_WORDS[path[0]] || words(path[0]));

const mergeBlogConfig = (base, ours, theirs, conflicts) => {
  const taken = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(base)])) {
    const spec = BLOG_CONFIG_LISTS[key];
    if (spec && [base, ours, theirs].every((side) => Array.isArray(side[key]))) {
      const wrap = (list) => (spec.ids ? list.map((id) => (typeof id === 'string' ? { id } : id)) : list);
      const merged = mergeList(spec, wrap(base[key]), wrap(ours[key]), wrap(theirs[key]), conflicts);
      if (merged !== null) {
        taken[key] = spec.ids ? merged.map((item) => item.id) : merged;
        continue;
      }
    }
    if (key === 'seo' && [base, ours, theirs].every((side) => isObject(side[key]))) {
      taken[key] = mergeObject({ label: blogConfigLabel }, base[key], ours[key], theirs[key], 1, [key], conflicts);
      continue;
    }
    const outcome = pick(base[key], ours[key], theirs[key]);
    if (outcome.conflict) conflicts.push(blogConfigLabel([key]));
    if (outcome.value !== undefined) taken[key] = outcome.value;
  }
  // Main's key order, then anything only the owner has.
  const result = {};
  for (const key of [...Object.keys(theirs), ...Object.keys(ours)]) if (key in taken && !(key in result)) result[key] = taken[key];
  return result;
};

const FILE_NAMES = { content: 'Page text', config: 'Site settings', company: 'Company', blogConfig: 'Blog settings' };

// Merge one data file. Returns { value, conflicts: [owner-readable strings] }.
export const mergeFile = (fileKey, base, ours, theirs) => {
  const conflicts = [];
  if (base === undefined) return { value: ours, conflicts }; // no base: nothing to compare against
  if (sameValue(ours, base)) return { value: theirs, conflicts };
  if (sameValue(theirs, base) || sameValue(ours, theirs)) return { value: ours, conflicts };
  let value = null;
  if (LISTS[fileKey]) value = mergeList(LISTS[fileKey], base, ours, theirs, conflicts);
  else if (fileKey === 'blogConfig' && isObject(base) && isObject(ours) && isObject(theirs)) value = mergeBlogConfig(base, ours, theirs, conflicts);
  else if (OBJECTS[fileKey] && isObject(base) && isObject(ours) && isObject(theirs)) {
    value = mergeObject(OBJECTS[fileKey], base, ours, theirs, OBJECTS[fileKey].depth, [], conflicts);
  }
  if (value === null) {
    conflicts.length = 0;
    conflicts.push('All your changes to ' + (LISTS[fileKey]?.file || FILE_NAMES[fileKey] || fileKey));
    value = theirs;
  }
  return { value, conflicts };
};

// Every string anywhere in a value — asset paths are stored verbatim.
export const stringsIn = (value, out = new Set()) => {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (isObject(value)) for (const item of Object.values(value)) stringsIn(item, out);
  return out;
};

// Deep copy with every string equal to `from` replaced by `to`.
export const renameString = (value, from, to) => {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((item) => renameString(item, from, to));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameString(item, from, to)]));
  return value;
};

// A free path next to `path` (dir/name-2.ext, -3, …) that `taken` doesn't hold.
export const freePath = (path, taken) => {
  const dot = path.lastIndexOf('.');
  const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
  for (let n = 2; ; n += 1) if (!taken.has(stem + '-' + n + ext)) return stem + '-' + n + ext;
};
