/**
 * Traffic tab: reads the visit/enquiry tallies kept by traffic/worker.js (GET /s)
 * and renders the owner's dashboard. Read-only; never touches the draft or the
 * publish flow. Auth is the admin's own GitHub token (the worker checks it with
 * GitHub, so whoever can publish the site can read its traffic).
 */
const LIVE_API = 'https://medivasc-api.puranjai1210.workers.dev';
export const apiBase = () => (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? localStorage.getItem('medivasc-traffic-api') || 'http://127.0.0.1:8787'
  : LIVE_API);
// Set on every unlocked device (app.js) so the site's tracker skips staff visits.
export const STAFF_KEY = 'medivasc-staff';

const glyph = (body, filled = true) => '<svg viewBox="0 0 24 24" aria-hidden="true"' + (filled ? ' fill="currentColor"' : ' fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"') + '>' + body + '</svg>';
const SOURCES = [
  { id: 'youtube', label: 'YouTube', icon: glyph('<path fill-rule="evenodd" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z"/>') },
  { id: 'google', label: 'Google search', icon: glyph('<path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.1L6.4 14Z"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4l3.3 2.6C7.2 7.7 9.4 6 12 6Z"/>') },
  { id: 'ai', label: 'AI assistants', hint: 'ChatGPT, Gemini, Perplexity…', refs: true, icon: glyph('<path d="M12 3c.8 5 3.9 8.2 9 9-5.1.8-8.2 4-9 9-.8-5-3.9-8.2-9-9 5.1-.8 8.2-4 9-9Z"/>', false) },
  { id: 'facebook', label: 'Facebook', icon: glyph('<path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/>') },
  { id: 'instagram', label: 'Instagram', icon: glyph('<rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" fill="none" stroke="currentColor" stroke-width="2.1"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="currentColor" stroke-width="2.1"/><circle cx="17.5" cy="6.5" r="1.3"/>') },
  { id: 'linkedin', label: 'LinkedIn', icon: glyph('<path d="M20.4 20.5h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3ZM5.3 7.4a2.1 2.1 0 1 1 0-4.1 2.1 2.1 0 0 1 0 4.1Zm1.8 13.1H3.6V9h3.5v11.5ZM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0Z"/>') },
  { id: 'x', label: 'X', icon: glyph('<path d="M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9Zm-1.3 19.5h2L6.5 3.2H4.3Z"/>') },
  { id: 'whatsapp', label: 'WhatsApp', icon: glyph('<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/>') },
  { id: 'direct', label: 'Direct', hint: 'Typed, bookmarked, or the app hid it', icon: glyph('<path d="M5 12h14M13 6l6 6-6 6"/>', false) },
  { id: 'other', label: 'Other sites', refs: true, icon: glyph('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>', false) },
];
const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((source) => [source.id, source]));
const RANGES = [{ id: '7', label: '7 days', days: 7 }, { id: '30', label: '30 days', days: 30 }, { id: '90', label: '90 days', days: 90 }, { id: 'all', label: 'All time', days: 0 }];
const TAG_LINKS = [['Instagram bio and posts', 'instagram'], ['YouTube descriptions', 'youtube'], ['Facebook page and posts', 'facebook'], ['LinkedIn', 'linkedin'], ['X', 'x'], ['WhatsApp status and broadcasts', 'whatsapp']];
const REGION_NAMES = { 'National Capital Territory of Delhi': 'Delhi' };
const ENQUIRY = new Set(['w', 'c', 'e']);
const CACHE_MS = 5 * 60000;

const view = { range: '30', source: null, data: null, fetchedAt: 0, error: '', loading: false, allStates: false, allCities: false, token: '', root: null };

const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (value) => new Intl.NumberFormat('en-IN').format(value);
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const pctLabel = (part, whole) => { const p = pct(part, whole); return (p > 0 && p < 1 ? '<1' : Math.round(p)) + '%'; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const spanDays = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
const dateLabel = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...opts }).format(new Date(iso + 'T00:00:00Z'));
const countryName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code || 'Unknown'; } };

// rows: [day, kind, source, ref, device, country, region, city, n]
const sum = (rows, test) => rows.reduce((total, r) => total + (test(r) ? r[8] : 0), 0);

const periodOf = () => {
  const { today, first } = view.data;
  const range = RANGES.find((r) => r.id === view.range);
  if (!range.days) return { from: first || today, to: today, days: spanDays(first || today, today), all: true };
  return { from: addDays(today, -(range.days - 1)), to: today, days: range.days, all: false };
};

const groupBy = (rows, keyOf) => {
  const groups = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key) || { key, visits: 0, enquiries: 0 };
    if (r[1] === 'v') g.visits += r[8]; else if (ENQUIRY.has(r[1])) g.enquiries += r[8];
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.visits - a.visits || b.enquiries - a.enquiries);
};

// Buckets for the trend: daily up to 45 days, weekly (Monday start) up to ~2 years, then monthly.
const buckets = (from, to) => {
  const days = spanDays(from, to);
  const unit = days <= 45 ? 'day' : days <= 730 ? 'week' : 'month';
  const startOf = (iso) => {
    if (unit === 'day') return iso;
    if (unit === 'month') return iso.slice(0, 8) + '01';
    const dow = (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
    return addDays(iso, -dow);
  };
  const list = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = startOf(d);
    if (!list.length || list[list.length - 1].key !== key) list.push({ key, from: d, to: d, visits: 0, enquiries: 0 });
    list[list.length - 1].to = d;
  }
  return { unit, list, index: (iso) => list.findIndex((b) => iso >= b.from && iso <= b.to) };
};

const niceMax = (value) => {
  if (value <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= value && (m * p) % 2 === 0) return m * p;
  return 10 * p;
};

const rankedList = (groups, labelOf, { limit, expanded, action, emptyText }) => {
  const visible = groups.filter((g) => g.visits || g.enquiries);
  if (!visible.length) return '<p class="tr-empty-line">' + emptyText + '</p>';
  const max = Math.max(...visible.map((g) => g.visits), 1);
  const shown = expanded ? visible : visible.slice(0, limit);
  const rows = shown.map((g) => '<li class="tr-rank__row"><span class="tr-rank__name">' + labelOf(g) + '</span>' +
    '<span class="tr-rank__bar" aria-hidden="true"><span style="width:' + Math.max((g.visits / max) * 100, g.visits ? 1.5 : 0) + '%"></span></span>' +
    '<span class="tr-rank__num">' + num(g.visits) + '</span><span class="tr-rank__num tr-rank__num--muted">' + num(g.enquiries) + '</span></li>').join('');
  const more = visible.length > limit
    ? '<button class="button button--text tr-more" type="button" data-traffic="' + action + '">' + (expanded ? 'Show fewer' : 'Show all ' + visible.length) + '</button>'
    : '';
  return '<div class="tr-rank__head" aria-hidden="true"><span></span><span></span><span>Visits</span><span>Enquiries</span></div><ol class="tr-rank">' + rows + '</ol>' + more;
};

const renderTrend = (rows, period) => {
  const { unit, list, index } = buckets(period.from, period.to);
  for (const r of rows) {
    const i = index(r[0]);
    if (i < 0) continue;
    if (r[1] === 'v') list[i].visits += r[8]; else if (ENQUIRY.has(r[1])) list[i].enquiries += r[8];
  }
  const max = niceMax(Math.max(...list.map((b) => b.visits), 0));
  const unitLabel = { day: 'day', week: 'week', month: 'month' }[unit];
  const bucketLabel = (b) => (unit === 'month' ? dateLabel(b.from, { month: 'long', year: 'numeric' })
    : unit === 'week' ? 'Week of ' + dateLabel(b.key, { day: 'numeric', month: 'short' })
      : dateLabel(b.from, { weekday: 'short', day: 'numeric', month: 'short' }));
  const cols = list.map((b, i) => '<button class="tr-col" type="button" data-tip="' + esc(bucketLabel(b) + '|' + num(b.visits) + ' visit' + (b.visits === 1 ? '' : 's') + '|' + num(b.enquiries) + ' enquir' + (b.enquiries === 1 ? 'y' : 'ies')) + '" aria-label="' + esc(bucketLabel(b) + ': ' + b.visits + ' visits, ' + b.enquiries + ' enquiries') + '" data-i="' + i + '">' +
    '<span class="tr-col__bar" style="height:' + (b.visits ? Math.max((b.visits / max) * 100, 2) : 0) + '%"></span></button>').join('');
  const axis = (iso) => dateLabel(iso, unit === 'month' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
  const table = '<details class="tr-table"><summary>View as table</summary><table><thead><tr><th scope="col">' + (unit === 'day' ? 'Date' : unit === 'week' ? 'Week' : 'Month') + '</th><th scope="col">Visits</th><th scope="col">Enquiries</th></tr></thead><tbody>' +
    list.map((b) => '<tr><td>' + esc(bucketLabel(b)) + '</td><td>' + num(b.visits) + '</td><td>' + num(b.enquiries) + '</td></tr>').join('') + '</tbody></table></details>';
  return '<div class="tr-card"><div class="tr-card__head"><h2>Visits per ' + unitLabel + '</h2></div>' +
    '<div class="tr-chart" data-count="' + list.length + '"><div class="tr-chart__grid" aria-hidden="true">' +
    [max, max / 2, 0].map((v) => '<span><em>' + num(v) + '</em></span>').join('') + '</div>' +
    '<div class="tr-chart__cols">' + cols + '</div><div class="tr-tip" role="status" hidden></div></div>' +
    '<div class="tr-chart__axis" aria-hidden="true"><span>' + axis(list[0].from) + '</span>' + (list.length > 2 ? '<span>' + axis(list[Math.floor(list.length / 2)].from) + '</span>' : '') + '<span>' + axis(list[list.length - 1].from) + '</span></div>' +
    table + '</div>';
};

const renderBody = () => {
  const period = periodOf();
  const inPeriod = view.data.rows.filter((r) => r[0] >= period.from && r[0] <= period.to);
  const scoped = view.source ? inPeriod.filter((r) => r[2] === view.source) : inPeriod;
  const visits = sum(scoped, (r) => r[1] === 'v');
  const taps = { w: sum(scoped, (r) => r[1] === 'w'), c: sum(scoped, (r) => r[1] === 'c'), e: sum(scoped, (r) => r[1] === 'e') };
  const enquiries = taps.w + taps.c + taps.e;
  const mobile = sum(scoped, (r) => r[1] === 'v' && r[4] !== 'desktop');

  // Change vs the previous period of equal length, only once that period is fully counted.
  let delta = '';
  if (!period.all && view.data.first && view.data.first <= addDays(period.from, -period.days)) {
    const prevFrom = addDays(period.from, -period.days);
    const prevTo = addDays(period.from, -1);
    const prev = sum(view.data.rows, (r) => r[1] === 'v' && r[0] >= prevFrom && r[0] <= prevTo && (!view.source || r[2] === view.source));
    if (prev) {
      const change = Math.round(((visits - prev) / prev) * 100);
      delta = '<span class="tr-delta">' + (change > 0 ? '+' : '') + change + '% vs previous ' + period.days + ' days</span>';
    }
  }
  const scopeName = view.source ? SOURCE_BY_ID[view.source].label : '';
  const kpis = '<div class="tr-kpis">' +
    '<div class="tr-kpi"><span class="tr-kpi__label">Visits' + (scopeName ? ' from ' + esc(scopeName) : '') + '</span><strong>' + num(visits) + '</strong>' + (delta || '<span class="tr-delta">' + (visits ? pctLabel(mobile, visits) + ' on phones' : '&nbsp;') + '</span>') + '</div>' +
    '<div class="tr-kpi"><span class="tr-kpi__label">Enquiry taps</span><strong>' + num(enquiries) + '</strong><span class="tr-delta">WhatsApp ' + num(taps.w) + ' · Call ' + num(taps.c) + ' · Email ' + num(taps.e) + '</span></div>' +
    '<div class="tr-kpi"><span class="tr-kpi__label">Visits that enquired</span><strong>' + (visits ? pctLabel(enquiries, visits) : '–') + '</strong><span class="tr-delta">Taps on WhatsApp, call, or email</span></div>' +
    '</div>';

  const bySource = groupBy(inPeriod, (r) => r[2]);
  const totalVisits = sum(inPeriod, (r) => r[1] === 'v');
  const order = SOURCES.map((s) => s.id);
  const tiles = SOURCES.map((s) => bySource.find((g) => g.key === s.id) || { key: s.id, visits: 0, enquiries: 0 })
    .sort((a, b) => b.visits - a.visits || order.indexOf(a.key) - order.indexOf(b.key))
    .map((g) => {
      const s = SOURCE_BY_ID[g.key];
      const share = pct(g.visits, totalVisits);
      return '<button class="tr-tile' + (g.visits ? '' : ' tr-tile--zero') + '" type="button" data-traffic="source" data-value="' + s.id + '" aria-pressed="' + String(view.source === s.id) + '">' +
        '<span class="tr-tile__top"><span class="tr-tile__icon">' + s.icon + '</span><span class="tr-tile__name">' + esc(s.label) + '</span></span>' +
        '<span class="tr-tile__value"><strong>' + num(g.visits) + '</strong><span>' + (g.visits ? pctLabel(g.visits, totalVisits) : '0%') + '</span></span>' +
        '<span class="tr-tile__bar" aria-hidden="true"><span style="width:' + (g.visits ? Math.max(share, 1.5) : 0) + '%"></span></span>' +
        '<span class="tr-tile__foot">' + (s.hint && !g.enquiries ? esc(s.hint) : num(g.enquiries) + ' enquir' + (g.enquiries === 1 ? 'y' : 'ies')) + '</span></button>';
    }).join('');
  // Sources marked `refs` keep a name per row (the other site or tag, the AI assistant).
  // That breakdown sits under the tiles for the selected source, or for "other" when none is.
  const listed = view.source ? (SOURCE_BY_ID[view.source].refs ? view.source : '') : (bySource.some((g) => g.key === 'other' && g.visits) ? 'other' : '');
  const sourcesCard = '<div class="tr-card"><div class="tr-card__head"><h2>Where visitors come from</h2><p>Tap a source to see its trend and locations.</p></div><div class="tr-tiles">' + tiles + '</div>' +
    (listed
      ? '<div class="tr-sub"><h3>' + esc(SOURCE_BY_ID[listed].label) + '</h3>' + rankedList(groupBy(inPeriod.filter((r) => r[2] === listed), (r) => r[3] || 'Unknown'), (g) => esc(g.key), { limit: 6, expanded: true, action: '', emptyText: 'None in this period.' }) + '</div>'
      : '') + '</div>';

  const india = scoped.filter((r) => r[5] === 'IN');
  const states = groupBy(india, (r) => REGION_NAMES[r[6]] || r[6] || 'Unknown');
  const cities = groupBy(india, (r) => (r[7] || 'Unknown') + '|' + (REGION_NAMES[r[6]] || r[6] || ''));
  const countries = groupBy(scoped, (r) => r[5] || '');
  const abroad = countries.filter((g) => g.key !== 'IN' && (g.visits || g.enquiries));
  const placesCard = '<div class="tr-card"><div class="tr-card__head"><h2>Where they are' + (scopeName ? ' <small>· ' + esc(scopeName) + '</small>' : '') + '</h2><p>From the visitor’s network. State is usually right; city is approximate, as mobile networks often route through the nearest big city.</p></div>' +
    '<div class="tr-places"><div class="tr-sub"><h3>States &amp; union territories</h3>' + rankedList(states, (g) => esc(g.key), { limit: 8, expanded: view.allStates, action: 'more-states', emptyText: 'No visits from India in this period.' }) + '</div>' +
    '<div class="tr-sub"><h3>Cities <small>(approximate)</small></h3>' + rankedList(cities, (g) => { const [city, region] = g.key.split('|'); return esc(city) + (region && region !== city ? '<small>' + esc(region) + '</small>' : ''); }, { limit: 8, expanded: view.allCities, action: 'more-cities', emptyText: 'No visits from India in this period.' }) + '</div>' +
    (abroad.length ? '<div class="tr-sub"><h3>Outside India</h3>' + rankedList(abroad, (g) => esc(countryName(g.key)), { limit: 6, expanded: true, action: '', emptyText: '' }) + '</div>' : '') +
    '</div></div>';

  return kpis + sourcesCard + renderTrend(scoped, period) + placesCard;
};

const renderLinks = () => '<div class="tr-card"><div class="tr-card__head"><h2>Links to post</h2><p>Use these wherever you share the website, so every visit is credited to the right place. Google search needs no special link.</p></div><ul class="tr-links">' +
  TAG_LINKS.map(([label, tag]) => {
    const url = 'https://medivasc.in/?utm_source=' + tag;
    return '<li><span><small>' + esc(label) + '</small><code>' + esc(url) + '</code></span><button class="button button--quiet" type="button" data-traffic="copy" data-value="' + esc(url) + '">Copy</button></li>';
  }).join('') + '</ul></div>';

const renderDevice = () => {
  const staff = Boolean(localStorage.getItem(STAFF_KEY));
  return '<p class="tr-device">' + (staff
    ? 'Visits from this device are not counted, because it has opened the admin. <button class="button button--text" type="button" data-traffic="device" data-value="count">Count this device</button>'
    : 'Visits from this device are counted. <button class="button button--text" type="button" data-traffic="device" data-value="skip">Stop counting this device</button>') + '</p>';
};

const render = () => {
  const root = view.root;
  if (!root || !root.isConnected) return;
  const since = view.data?.first ? 'Counting since ' + dateLabel(view.data.first) + '.' : 'Counting starts with the first visit.';
  const head = '<div class="section-toolbar"><div><h1>Traffic</h1><p>Where visitors come from and where they are. ' + esc(view.data ? since : '') + '</p></div>' +
    '<button class="button button--quiet" type="button" data-traffic="refresh"' + (view.loading ? ' disabled' : '') + '>' + (view.loading ? 'Loading…' : 'Refresh') + '</button></div>';
  const controls = '<div class="tr-controls"><div class="tr-seg" role="group" aria-label="Time range">' +
    RANGES.map((r) => '<button type="button" data-traffic="range" data-value="' + r.id + '" aria-pressed="' + String(view.range === r.id) + '">' + r.label + '</button>').join('') + '</div>' +
    (view.source ? '<button class="tr-chip" type="button" data-traffic="source" data-value="' + view.source + '">Showing ' + esc(SOURCE_BY_ID[view.source].label) + ' only <span aria-hidden="true">×</span><span class="visually-hidden">, show all sources</span></button>' : '') + '</div>';
  let body;
  if (view.error) body = '<div class="notice notice--warning">' + esc(view.error) + '</div>';
  else if (!view.data) body = '<div class="tr-loading" aria-busy="true">Loading traffic…</div>';
  else if (!view.data.rows.length) body = '<div class="empty-state"><h2>No visits counted yet</h2><p>Visits appear here a few seconds after they happen. Visits from this device are never counted, so open the site on another phone to try it.</p></div>';
  else body = controls + renderBody();
  root.innerHTML = '<section class="tr">' + head + body + renderLinks() + renderDevice() + '</section>';
};

const load = async () => {
  view.loading = true;
  view.error = '';
  render();
  try {
    const response = await fetch(apiBase() + '/s', { headers: { Authorization: 'Bearer ' + view.token }, cache: 'no-store' });
    if (response.status === 401) throw new Error('Traffic could not confirm your access. Lock the admin, unlock it again, and retry.');
    if (!response.ok) throw new Error('The traffic service answered with an error (' + response.status + '). Try Refresh in a minute.');
    view.data = await response.json();
    view.fetchedAt = Date.now();
  } catch (error) {
    view.error = error instanceof TypeError ? 'Could not reach the traffic service. Check the connection and press Refresh.' : error.message;
  } finally {
    view.loading = false;
    render();
  }
};

const showTip = (root, column) => {
  const tip = root.querySelector('.tr-tip');
  if (!tip) return;
  if (!column) { tip.hidden = true; return; }
  const [when, visits, enquiries] = column.dataset.tip.split('|');
  tip.innerHTML = '<strong>' + esc(when) + '</strong><span>' + esc(visits) + '</span><span>' + esc(enquiries) + '</span>';
  tip.hidden = false;
  const chart = column.closest('.tr-chart').getBoundingClientRect();
  const col = column.getBoundingClientRect();
  const x = col.left - chart.left + col.width / 2;
  tip.style.left = Math.min(Math.max(x, tip.offsetWidth / 2), chart.width - tip.offsetWidth / 2) + 'px';
};

export const mountTraffic = (root, token) => {
  view.root = root;
  if (token !== view.token) { view.token = token; view.data = null; view.fetchedAt = 0; }
  render();
  if (!view.loading && (!view.data || Date.now() - view.fetchedAt > CACHE_MS)) load();
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-traffic]');
    if (!button) return;
    const { traffic: action, value } = button.dataset;
    if (action === 'range') view.range = value;
    else if (action === 'source') view.source = view.source === value ? null : value;
    else if (action === 'refresh') return load();
    else if (action === 'more-states') view.allStates = !view.allStates;
    else if (action === 'more-cities') view.allCities = !view.allCities;
    else if (action === 'device') { if (value === 'count') localStorage.removeItem(STAFF_KEY); else localStorage.setItem(STAFF_KEY, '1'); }
    else if (action === 'copy') {
      try { await navigator.clipboard.writeText(value); button.textContent = 'Copied'; } catch { button.textContent = 'Copy failed'; }
      setTimeout(() => { button.textContent = 'Copy'; }, 1600);
      return;
    }
    render();
  });
  root.addEventListener('pointerover', (event) => showTip(root, event.target.closest('.tr-col')));
  root.addEventListener('focusin', (event) => showTip(root, event.target.closest('.tr-col')));
  root.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') showTip(root, null); });
};
