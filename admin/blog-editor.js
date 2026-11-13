/* admin/blog-editor.js — W5b: the blog post DOCUMENT editor (title, accent, dek,
 * cover, typography presets, all 16 block types, references).
 *
 * Contract: src/blog/CONTRACT.md (session-3 addendum). Hand-built, dependency-free.
 * The model never holds HTML: every contenteditable is serialized DOM → Inline
 * runs ({t, b, i, hl, href} | {cite}) through an allowlist walk, and rendered
 * back with createElement/textContent only. The host (W5a) owns the post; this
 * module emits shallow patches of the top-level fields it changed via onChange.
 *
 *   mountBlockEditor(root, { post, onChange, stageImage, resolveSrc, films, h, icon })
 *     → { setPost, undo, redo, canUndo, canRedo, focus, destroy }
 *
 * Extras (additive, optional): opts.historyButtons === false hides the built-in
 * undo/redo buttons; root fires a 'bed:history' CustomEvent { canUndo, canRedo }.
 */

const NS = 'http://www.w3.org/2000/svg';
const rules = () => globalThis.MediVascContentRules || null;

const OWN = ['title', 'titleAccent', 'dek', 'cover', 'titleSize', 'bodySize', 'leadIn', 'blocks', 'references'];
const LABELS = {
  paragraph: 'Paragraph', lead: 'Intro paragraph', heading: 'Heading', list: 'List',
  quote: 'Quote', pullquote: 'Pull quote', image: 'Image', gallery: 'Gallery',
  imageText: 'Image with text', callout: 'Callout box', takeaways: 'Key takeaways',
  divider: 'Divider', table: 'Table', video: 'Video', faq: 'Questions', cta: 'Contact button',
};
const labelOf = (type) => rules()?.BLOCK_LABELS?.[type] || LABELS[type] || type;
const GROUPS = [
  ['Text', ['paragraph', 'lead', 'heading', 'list', 'quote', 'pullquote']],
  ['Images', ['image', 'gallery', 'imageText']],
  ['Boxes', ['callout', 'takeaways', 'table', 'faq']],
  ['Media & actions', ['video', 'cta', 'divider']],
];
const HINTS = {
  paragraph: 'Body text', lead: 'Larger opening text', heading: 'Section title', list: 'Bullets or numbers',
  quote: 'Quotation with its source', pullquote: 'One large highlighted line', image: 'Photo with caption',
  gallery: 'Two or three photos', imageText: 'Photo beside text', callout: 'Doctor, tip or note',
  takeaways: 'Summary points', table: 'Rows and columns', faq: 'Expandable answers',
  video: 'Site film or YouTube', cta: 'WhatsApp, call or contact', divider: 'A quiet section break',
};
const CALLOUT_TITLES = { doctor: 'When to see a doctor', tip: 'Tip', note: 'Note' };
const CTA_LABELS = { whatsapp: 'Chat on WhatsApp', call: 'Call us', contact: 'Contact us' };

const ICONS = {
  paragraph: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  lead: '<path d="M4 6.5h16M4 12h16M4 17.5h10" stroke-width="2.3"/>',
  heading: '<path d="M6.5 5v14M17.5 5v14M6.5 12h11"/>',
  list: '<path d="M9.5 7h10.5M9.5 12h10.5M9.5 17h10.5"/><circle cx="5" cy="7" r=".9" fill="currentColor"/><circle cx="5" cy="12" r=".9" fill="currentColor"/><circle cx="5" cy="17" r=".9" fill="currentColor"/>',
  quote: '<path d="M5 6v12M10 8h9M10 12h9M10 16h6"/>',
  pullquote: '<path d="M10 7.5c-2.6.6-4.5 2.6-4.5 5.4V17H10v-4.3H7.2M18.5 7.5c-2.6.6-4.5 2.6-4.5 5.4V17h4.5v-4.3h-2.8"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17.5 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  gallery: '<rect x="3" y="6" width="8" height="12" rx="1.6"/><rect x="13" y="6" width="8" height="12" rx="1.6"/>',
  imageText: '<rect x="3" y="6" width="8.5" height="12" rx="1.6"/><path d="M14.5 8h6.5M14.5 12h6.5M14.5 16h4.5"/>',
  callout: '<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><path d="M12 8.5v4.2M12 15.6v.01"/>',
  takeaways: '<path d="m4 8 1.6 1.6L8.5 6.7M4 15.5l1.6 1.6 2.9-2.9M11.5 8h8.5M11.5 15.5h8.5"/>',
  divider: '<path d="M3 12h5.5M15.5 12H21"/><path d="m12 9.2 2.8 2.8-2.8 2.8L9.2 12Z"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M3.5 10h17M3.5 14.5h17M10 10v9"/>',
  video: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.6"/><path d="m10.5 9.3 4.3 2.7-4.3 2.7Z"/>',
  faq: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.7a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.5v.3M12 16.4v.01"/>',
  cta: '<rect x="3" y="7.5" width="18" height="9" rx="4.5"/><path d="M8.5 12h7M13 9.5 15.5 12 13 14.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M7 7l1 12.5h8L17 7M10 11v5M14 11v5"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  drag: '<circle cx="9" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="17.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="17.5" r="1.1" fill="currentColor" stroke="none"/>',
  undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3"/>',
  redo: '<path d="m15 14 4.5-4.5L15 5"/><path d="M19.5 9.5H9a4.5 4.5 0 0 0 0 9h3"/>',
  bold: '<path d="M7.5 5h5.25a3.5 3.5 0 0 1 0 7H7.5zM7.5 12h6.25a3.5 3.5 0 0 1 0 7H7.5z" stroke-width="1.9"/>',
  italic: '<path d="M11 5h7M6 19h7M14.6 5l-5.2 14"/>',
  highlight: '<path d="m8.5 14.5 7.8-7.8a2 2 0 0 0-2.8-2.8l-7.8 7.8-.9 3.7Z"/><path d="M4 20h16"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1-1"/>',
  cite: '<path d="M4 18.5 10.5 9M4 9l6.5 9.5"/><path d="M14.5 6.2a2 2 0 1 1 3.3 1.5L14.5 11h4.5"/>',
  accent: '<path d="M6 19 11 5h2l5 14M8.2 13.5h7.6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4.5 3 19.5h18Z"/><path d="M12 10v4.2M12 16.8v.01"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  type: '<path d="M4.5 7.5V5h11v2.5M10 5v14M7.5 19h5M14.5 12.5V11h6v1.5M17.5 11v8M16 19h3"/>',
  film: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>',
};
const svg = (name, cls = 'bed-ic') => {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
};

// ---------------------------------------------------------------- dom helper
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid);
  }
  return n;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blank = (v) => typeof v !== 'string' || v.trim() === '';

// ------------------------------------------------------------------- hrefs
const LOCAL_HREFS = [
  /^https:\/\/[^\s<>"]+$/,
  /^mailto:[^\s<>"@]+@[^\s<>"@]+$/,
  /^tel:\+?[0-9][0-9 ()-]*$/,
  /^blog\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:#[A-Za-z0-9_-]+)?$/,
  /^#[A-Za-z0-9][A-Za-z0-9_-]*$/,
];
const hrefAllowed = (href) => {
  if (typeof href !== 'string') return false;
  const r = rules();
  return r?.blogHrefAllowed ? r.blogHrefAllowed(href) : LOCAL_HREFS.some((re) => re.test(href));
};
const HREF_HELP = 'Use a full https:// address, mailto:, tel:, another post (blog/post-address/) or a #section link.';
// Owner input → an allowed href, or { error }. Bare domains/emails/phones get their scheme.
function normalizeHref(raw) {
  const v = String(raw || '').trim();
  if (!v) return { error: 'Type or paste a link address.' };
  if (/^(javascript|data|vbscript|file|blob):/i.test(v)) return { error: 'That kind of link is not allowed.' };
  if (/^http:\/\//i.test(v)) return { error: 'Use the secure https:// version of this address.' };
  let href = v;
  if (/^[^\s@:/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) href = `mailto:${v}`;
  else if (/^\+?[0-9][0-9 ()-]{6,}$/.test(v)) href = `tel:${v}`;
  else if (/^\/?blog\/[a-z0-9]+(?:-[a-z0-9]+)*\/?(#[A-Za-z0-9_-]+)?$/.test(v)) href = v.replace(/^\//, '').replace(/^(blog\/[a-z0-9-]+)\/?/, '$1/');
  else if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i.test(v)) href = `https://${v}`;
  return hrefAllowed(href) ? { href } : { error: HREF_HELP };
}

// --------------------------------------------------------- inline run model
const MARKS = ['b', 'i', 'hl'];
const isCiteRun = (r) => r && r.cite !== undefined;
const runsOf = (inline) => {
  if (typeof inline === 'string') return inline ? [{ t: inline }] : [];
  if (!Array.isArray(inline)) return [];
  return inline.filter((r) => r && typeof r === 'object').map((r) => ({ ...r }));
};
const runLen = (r) => (isCiteRun(r) ? 1 : String(r.t || '').length);
const runsLen = (runs) => runs.reduce((n, r) => n + runLen(r), 0);
const sameMarks = (a, b) => !isCiteRun(a) && !isCiteRun(b)
  && MARKS.every((m) => !!a[m] === !!b[m]) && (a.href || '') === (b.href || '');
function cleanRun(r) {
  if (isCiteRun(r)) return { cite: String(r.cite) };
  const o = { t: String(r.t || '') };
  for (const m of MARKS) if (r[m]) o[m] = true;
  if (r.href) o.href = r.href;
  return o;
}
function normRuns(runs) {
  const out = [];
  for (const raw of runs) {
    const r = cleanRun(raw);
    if (!isCiteRun(r) && !r.t) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, r)) last.t += r.t;
    else out.push(r);
  }
  return out;
}
function trimRuns(runs) {
  const n = normRuns(runs);
  while (n.length && !isCiteRun(n[0])) {
    n[0].t = n[0].t.replace(/^\s+/, '');
    if (n[0].t) break;
    n.shift();
  }
  while (n.length && !isCiteRun(n[n.length - 1])) {
    const last = n[n.length - 1];
    last.t = last.t.replace(/\s+$/, '');
    if (last.t) break;
    n.pop();
  }
  return n;
}
// Runs → the contract's Inline: '' | 'plain string' | [runs].
function toInline(runs) {
  const n = normRuns(runs);
  if (!n.length) return '';
  if (n.length === 1 && !isCiteRun(n[0]) && Object.keys(n[0]).length === 1) return n[0].t;
  return n;
}
const inlineText = (inline) => runsOf(inline).map((r) => (isCiteRun(r) ? '' : r.t)).join('');
function splitRuns(runs, at) {
  const left = [];
  const right = [];
  let pos = 0;
  for (const r of runs) {
    const len = runLen(r);
    if (pos + len <= at) left.push(r);
    else if (pos >= at) right.push(r);
    else {
      const k = at - pos;
      left.push({ ...r, t: r.t.slice(0, k) });
      right.push({ ...r, t: r.t.slice(k) });
    }
    pos += len;
  }
  return [left, right];
}
function rangeRuns(runs, start, end) {
  const [a, rest] = splitRuns(runs, start);
  const [mid, c] = splitRuns(rest, end - start);
  return [a, mid, c];
}
// Every text character in [start,end) carries `mark`? (href → the shared href or '')
function markState(runs, start, end, mark) {
  const [, mid] = rangeRuns(runs, start, end);
  const text = mid.filter((r) => !isCiteRun(r) && r.t);
  if (!text.length) return mark === 'href' ? '' : false;
  if (mark === 'href') return text.every((r) => r.href && r.href === text[0].href) ? text[0].href : '';
  return text.every((r) => r[mark]);
}
function applyMark(runs, start, end, mark, value) {
  // copies: callers' runs are never changed (_internals are pure)
  const [a, mid, c] = rangeRuns(runs.map((r) => ({ ...r })), start, end);
  const on = value !== undefined ? value : !markState(runs, start, end, mark);
  for (const r of mid) {
    if (isCiteRun(r)) continue;
    if (on) r[mark] = mark === 'href' ? on : true;
    else delete r[mark];
  }
  return normRuns([...a, ...mid, ...c]);
}

// ------------------------------------------------- DOM ⇄ runs (allowlist)
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'template', 'noscript', 'iframe',
  'object', 'embed', 'img', 'picture', 'svg', 'math', 'video', 'audio', 'source', 'track', 'canvas', 'input', 'button',
  'select', 'option', 'textarea', 'xml', 'o:p', 'form', 'frame', 'frameset', 'map', 'area', 'base', 'dialog']);
const isCiteEl = (n) => n.nodeType === 1 && n.localName === 'sup' && n.hasAttribute('data-cite');
const BOLD_OFF = /font-weight\s*:\s*(normal|lighter|[1-4]00)\b/i;
const BOLD_ON = /font-weight\s*:\s*(bold|bolder|[6-9]00)\b/i;
function marksFor(node, marks) {
  const tag = node.localName;
  const style = node.getAttribute('style') || '';
  const next = { ...marks };
  if ((tag === 'b' || tag === 'strong') && !BOLD_OFF.test(style)) next.b = true;
  if ((tag === 'i' || tag === 'em') && !/font-style\s*:\s*normal/i.test(style)) next.i = true;
  if (tag === 'mark') next.hl = true;
  if (BOLD_ON.test(style)) next.b = true;
  else if (BOLD_OFF.test(style) && tag !== 'b' && tag !== 'strong') delete next.b;
  if (/font-style\s*:\s*italic/i.test(style)) next.i = true;
  if (tag === 'a') {
    const href = (node.getAttribute('href') || '').trim();
    if (hrefAllowed(href)) next.href = href;
    else delete next.href;
  }
  return next;
}
// Our own contenteditable → runs. Text lengths match DOM offsets 1:1 (cite = 1).
function domToRuns(root) {
  const out = [];
  const walk = (node, marks) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = child.data.replace(/[ \n\r\t]/g, ' ');
        if (t) out.push({ t, ...marks });
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (isCiteEl(child)) { out.push({ cite: child.getAttribute('data-cite') }); continue; }
      const tag = child.localName;
      if (SKIP_TAGS.has(tag) || tag === 'br') continue;
      walk(child, marksFor(child, marks));
    }
  };
  walk(root, {});
  return normRuns(out);
}
function citeNode(id, refs) {
  const k = (refs || []).findIndex((r) => r && r.id === id);
  return el('sup', { class: k < 0 ? 'bed-cite is-missing' : 'bed-cite', contenteditable: 'false', 'data-cite': id,
    title: k < 0 ? 'This reference was removed' : (refs[k].text || '').slice(0, 120), text: k < 0 ? '?' : String(k + 1) });
}
function runsToDom(target, inline, refs) {
  target.textContent = '';
  for (const r of runsOf(inline)) {
    if (isCiteRun(r)) { target.append(citeNode(r.cite, refs)); continue; }
    let node = document.createTextNode(r.t || '');
    if (r.hl) node = el('mark', { class: 'bed-hl' }, node);
    if (r.i) node = el('em', null, node);
    if (r.b) node = el('strong', null, node);
    if (r.href) node = el('a', { class: 'bed-a', href: r.href, title: r.href }, node);
    target.append(node);
  }
  markAdjacentCites(target);
}
// Back-to-back citations read "1,2" like the site; CSS `+` would also match across a text node, so flag it here.
function markAdjacentCites(scope) {
  for (const s of scope.querySelectorAll('sup[data-cite]')) {
    let prev = s.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.data) prev = prev.previousSibling;
    s.classList.toggle('is-adj', !!(prev && prev.nodeType === 1 && prev.matches('sup[data-cite]')));
  }
}

// ---------------------------------------------------------- paste sanitiser
// text/html (Word, Google Docs, web pages) → pieces [{ kind: p|h2|h3|li, style, runs }].
const PIECE_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'tr', 'td', 'th',
  'dt', 'dd', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'table', 'tbody', 'thead', 'ul', 'ol',
  'dl', 'hr', 'address', 'main', 'aside', 'nav', 'caption']);
function msoListStyle(node) {
  const marker = node.querySelector('[style*="mso-list"]');
  const text = marker ? marker.textContent.trim() : '';
  return /^[0-9ivxlc]+[.)]/i.test(text) || /^[a-z][.)]/i.test(text) ? 'number' : 'bullet';
}
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const pieces = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      const runs = trimRuns(cur.runs);
      if (runs.some((r) => !isCiteRun(r) && r.t.trim())) pieces.push({ kind: cur.kind, style: cur.style, runs });
    }
    cur = null;
  };
  const walk = (node, marks, ctx) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const t = c.data.replace(/[\s ]+/g, ' ');
        if (!t) continue;
        if (!cur) {
          if (!t.trim()) continue;
          cur = { kind: ctx.kind, style: ctx.style, runs: [] };
        }
        cur.runs.push({ t, ...marks });
        continue;
      }
      if (c.nodeType !== 1) continue;
      const tag = c.localName;
      if (SKIP_TAGS.has(tag)) continue;
      const style = c.getAttribute('style') || '';
      if (/mso-list\s*:\s*ignore/i.test(style)) continue;
      if (tag === 'br') { flush(); continue; }
      if (tag === 'sup' && /^\s*\[?\d+\]?\s*$/.test(c.textContent)) continue; // foreign footnote markers
      const m = marksFor(c, marks);
      if (!PIECE_TAGS.has(tag)) { walk(c, m, ctx); continue; }
      let { kind, style: st } = ctx;
      if (tag === 'h1' || tag === 'h2') kind = 'h2';
      else if (/^h[3-6]$/.test(tag)) kind = 'h3';
      else if (tag === 'li') {
        kind = 'li';
        st = c.parentElement && c.parentElement.localName === 'ol' ? 'number' : 'bullet';
      } else if (/mso-list\s*:/i.test(style) || /MsoListParagraph/i.test(c.getAttribute('class') || '')) {
        kind = 'li';
        st = msoListStyle(c);
      } else if (!['ul', 'ol', 'table', 'tbody', 'thead', 'tr', 'dl'].includes(tag) && kind !== 'li') kind = 'p';
      flush();
      walk(c, m, { kind, style: st });
      flush();
    }
  };
  walk(doc.body || doc.documentElement, {}, { kind: 'p', style: undefined });
  flush();
  return pieces;
}
// text/plain → pieces: blank lines separate paragraphs; "- x" / "1. x" lines become list items.
function piecesFromText(text) {
  const pieces = [];
  const chunks = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.replace(/[\t ]+/g, ' ').trim()).filter(Boolean);
    if (!lines.length) continue;
    const bullet = /^([-*•●▪◦–])\s+/;
    const num = /^\d{1,3}[.)]\s+/;
    if (lines.every((l) => bullet.test(l) || num.test(l))) {
      for (const l of lines) {
        const isNum = num.test(l);
        pieces.push({ kind: 'li', style: isNum ? 'number' : 'bullet', runs: [{ t: l.replace(isNum ? num : bullet, '') }] });
      }
    } else pieces.push({ kind: 'p', runs: [{ t: lines.join(' ').replace(/\s+/g, ' ') }] });
  }
  return pieces;
}

// ------------------------------------------------------------ caret offsets
const lenOf = (n) => {
  if (n.nodeType === 3) return n.data.length;
  if (n.nodeType !== 1) return 0;
  if (isCiteEl(n)) return 1;
  if (n.localName === 'br') return 0;
  let k = 0;
  for (const c of n.childNodes) k += lenOf(c);
  return k;
};
function offsetOf(root, node, offset) {
  if (!root.contains(node)) return 0;
  if (node === root) {
    let k = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i++) k += lenOf(root.childNodes[i]);
    return k;
  }
  let count = 0;
  let done = false;
  const visit = (n) => {
    if (done) return;
    if (n === node) {
      if (n.nodeType === 3) count += offset;
      else for (let i = 0; i < offset && i < n.childNodes.length; i++) count += lenOf(n.childNodes[i]);
      done = true;
      return;
    }
    if (n.nodeType === 3) { count += n.data.length; return; }
    if (n.nodeType !== 1) return;
    if (isCiteEl(n)) {
      count += 1;
      if (n.contains(node)) done = true;
      return;
    }
    for (const c of n.childNodes) { visit(c); if (done) return; }
  };
  for (const c of root.childNodes) { visit(c); if (done) break; }
  return count;
}
function posAt(root, target) {
  let count = 0;
  const walk = (n) => {
    for (let k = 0; k < n.childNodes.length; k++) {
      const c = n.childNodes[k];
      if (c.nodeType === 3) {
        if (count + c.data.length >= target) return [c, target - count];
        count += c.data.length;
      } else if (c.nodeType === 1) {
        if (isCiteEl(c)) {
          if (count >= target) return [n, k];
          count += 1;
        } else if (c.localName !== 'br') {
          const r = walk(c);
          if (r) return r;
        }
      }
    }
    return null;
  };
  return walk(root) || [root, root.childNodes.length];
}
function getOffsets(field) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!field.contains(r.startContainer) || !field.contains(r.endContainer)) return null;
  return { start: offsetOf(field, r.startContainer, r.startOffset), end: offsetOf(field, r.endContainer, r.endOffset) };
}
function setOffsets(field, start, end = start) {
  const sel = document.getSelection();
  if (!sel) return;
  const [sn, so] = posAt(field, start);
  const [en, eo] = posAt(field, end);
  const range = document.createRange();
  range.setStart(sn, so);
  range.setEnd(en, eo);
  sel.removeAllRanges();
  sel.addRange(range);
}

// Whole-word match (verbatim logic of content-rules.js wholeWordMatch, which is not exported).
function wholeWordMatch(text, word) {
  const target = String(word || '');
  if (!target) return null;
  const edge = /[\p{L}\p{M}\p{N}_]/u;
  const chars = Array.from(target);
  const source = target.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp((edge.test(chars[0]) ? '(?<![\\p{L}\\p{M}\\p{N}_])' : '') + source
    + (edge.test(chars[chars.length - 1]) ? '(?![\\p{L}\\p{M}\\p{N}_])' : ''), 'iu');
  const m = re.exec(String(text));
  return m ? { index: m.index, length: m[0].length } : null;
}
// YouTube URL or bare id → the 11-char id, or ''.
function parseYouTube(raw) {
  const v = String(raw || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  const m = v.match(/(?<![\w-])(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i);
  return m ? m[1] : '';
}

// Every Inline-run array anywhere under `value` (blocks are walked generically).
function mapRunArrays(value, fn) {
  if (Array.isArray(value)) {
    const isRuns = value.length > 0 && value.every((r) => r && typeof r === 'object' && !Array.isArray(r) && ('t' in r || 'cite' in r));
    if (isRuns) return fn(value);
    return value.map((v) => mapRunArrays(v, fn));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapRunArrays(v, fn);
    return out;
  }
  return value;
}
function citeCounts(blocks) {
  const counts = new Map();
  mapRunArrays(blocks, (runs) => {
    for (const r of runs) if (isCiteRun(r)) counts.set(r.cite, (counts.get(r.cite) || 0) + 1);
    return runs;
  });
  return counts;
}
function wordCount(doc) {
  let text = `${doc.title || ''} ${doc.dek || ''} `;
  const walk = (v) => {
    if (typeof v === 'string') text += ` ${v}`;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.t === 'string') text += v.t;
      for (const [k, x] of Object.entries(v)) if (!['type', 'src', 'href', 'cite', 'alt', 'width', 'align', 'size', 'style', 'tone', 'kind', 'source', 'youtube', 'side', 'level', 'anchor', 't', 'credit'].includes(k)) walk(x);
    }
  };
  walk(doc.blocks || []);
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

function newBlock(type, films) {
  switch (type) {
    case 'paragraph': case 'lead': case 'quote': case 'pullquote': return { type, text: '' };
    case 'heading': return { type, level: 2, text: '' };
    case 'list': return { type, style: 'bullet', items: [''] };
    case 'image': return { type, src: '', alt: '', width: 'column', align: 'center' };
    case 'gallery': return { type, images: [{ src: '', alt: '' }, { src: '', alt: '' }] };
    case 'imageText': return { type, image: { src: '', alt: '' }, side: 'left', text: [''] };
    case 'callout': return { type, tone: 'doctor', text: '' };
    case 'takeaways': return { type, items: [''] };
    case 'divider': return { type };
    case 'table': return { type, header: ['', ''], rows: [['', ''], ['', '']] };
    case 'video': return (films && films.length) ? { type, source: 'film', src: '' } : { type, source: 'youtube', youtube: '' };
    case 'faq': return { type, items: [{ q: '', a: '' }] };
    case 'cta': return { type, kind: 'whatsapp' };
    default: return { type: 'paragraph', text: '' };
  }
}

function getPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
}
function setPath(obj, path, value, optional) {
  const parts = path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) o[parts[i]] = typeof parts[i + 1] === 'number' ? [] : {};
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (optional && (value === '' || value === undefined || value === null) && !Array.isArray(o)) delete o[last];
  else o[last] = value;
}

// ===================================================================== mount
export function mountBlockEditor(root, opts = {}) {
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};
  const stageImage = typeof opts.stageImage === 'function' ? opts.stageImage : null;
  const resolveSrc = typeof opts.resolveSrc === 'function' ? opts.resolveSrc : (s) => s;
  const films = Array.isArray(opts.films) ? opts.films.filter((f) => f && f.src) : [];
  const PT = (() => {
    const d = document.createElement('div');
    try { d.contentEditable = 'plaintext-only'; } catch { return 'true'; }
    return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  })();
  const uidBase = `bed${Math.random().toString(36).slice(2, 7)}`;
  let uidN = 0;
  const uid = (p) => `${uidBase}-${p}-${++uidN}`;
  let keySeq = 0;
  const nextKey = () => `b${++keySeq}`;

  function pick(post) {
    const p = post && typeof post === 'object' ? post : {};
    const blocks = Array.isArray(p.blocks) && p.blocks.length ? clone(p.blocks) : [{ type: 'paragraph', text: '' }];
    return {
      title: typeof p.title === 'string' ? p.title : '',
      titleAccent: typeof p.titleAccent === 'string' ? p.titleAccent : '',
      dek: typeof p.dek === 'string' ? p.dek : '',
      cover: p.cover && typeof p.cover === 'object' ? clone(p.cover) : null,
      titleSize: p.titleSize || 'L',
      bodySize: p.bodySize || 'M',
      leadIn: p.leadIn || 'dropcap',
      blocks,
      references: Array.isArray(p.references) ? clone(p.references) : [],
    };
  }

  // Fields the editor shows with a default but the host's post lacks (typography presets, the implicit
  // first paragraph of an empty post). Not emitted on mount/setPost — they ride the first real edit's patch.
  const seedOf = (post) => {
    const p = post && typeof post === 'object' ? post : {};
    const s = new Set(['titleSize', 'bodySize', 'leadIn'].filter((k) => !p[k]));
    if (!Array.isArray(p.blocks) || !p.blocks.length) s.add('blocks');
    return s;
  };
  let seed = seedOf(opts.post);
  let postId = opts.post && opts.post.id;
  let doc = pick(opts.post);
  let keys = doc.blocks.map(nextKey);
  let selKey = null;
  let typeOpen = false;
  let pendingRefDelete = null;
  let lastCell = null;
  let destroyed = false;
  const pendingPatient = new Set(); // `${key}|${path}` — ticked, consent not yet confirmed
  const uploads = new Map(); // `${key}|${path}` → { state: 'busy'|'error', message }
  const hist = { past: [], future: [], lastKey: null, lastAt: 0, burstAt: 0 };
  const dirty = new Set();
  let flushTimer = 0;

  // ------------------------------------------------------------- shell
  root.classList.add('bed');
  root.textContent = '';
  const bar = el('div', { class: 'bed-bar' });
  const typePanel = el('div', { class: 'bed-typo', id: uid('typo'), 'data-key': 'doc', hidden: true });
  const page = el('div', { class: 'bed-page' });
  const tb = el('div', { class: 'bed-tb', role: 'toolbar', 'aria-label': 'Text formatting', hidden: true });
  const pop = el('div', { class: 'bed-pop', role: 'dialog', hidden: true });
  const menu = el('div', { class: 'bed-menu', role: 'dialog', 'aria-label': 'Add a block', hidden: true });
  const live = el('div', { class: 'bed-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const toast = el('div', { class: 'bed-toast', role: 'status', hidden: true });
  const dropLine = el('div', { class: 'bed-dropline', hidden: true });
  root.append(bar, typePanel, page, tb, pop, menu, live, toast, dropLine);
  let headEl = null;
  let flowEl = null;
  let refsEl = null;

  // ----------------------------------------------------------- history
  const snap = () => ({ doc: JSON.stringify(doc), keys: keys.slice(), focus: captureFocus() });
  function record(coalesce) {
    const now = Date.now();
    if (coalesce && coalesce === hist.lastKey && now - hist.lastAt < 1200 && now - hist.burstAt < 4000) {
      hist.lastAt = now;
      return;
    }
    hist.past.push(snap());
    if (hist.past.length > 300) hist.past.shift();
    hist.future = [];
    hist.lastKey = coalesce || null;
    hist.lastAt = now;
    hist.burstAt = now;
    emitHistory();
  }
  function restore(s) {
    const before = doc;
    doc = JSON.parse(s.doc);
    keys = s.keys.slice();
    for (const f of OWN) if (!same(before[f], doc[f])) dirty.add(f);
    schedule();
    hist.lastKey = null;
    pendingRefDelete = null;
    render();
    restoreFocus(s.focus);
  }
  function undo() {
    if (!hist.past.length) return false;
    const s = hist.past.pop();
    hist.future.push(snap());
    restore(s);
    emitHistory();
    announce('Undone');
    return true;
  }
  function redo() {
    if (!hist.future.length) return false;
    const s = hist.future.pop();
    hist.past.push(snap());
    restore(s);
    emitHistory();
    announce('Redone');
    return true;
  }
  function emitHistory() {
    const u = bar.querySelector('[data-act="undo"]');
    const r = bar.querySelector('[data-act="redo"]');
    if (u) u.disabled = !hist.past.length;
    if (r) r.disabled = !hist.future.length;
    root.dispatchEvent(new CustomEvent('bed:history', { detail: { canUndo: hist.past.length > 0, canRedo: hist.future.length > 0 } }));
  }

  // -------------------------------------------------------- change flow
  function schedule() {
    if (!flushTimer) flushTimer = setTimeout(flush, 240);
  }
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = 0;
    if (!dirty.size) return;
    const patch = {};
    for (const f of dirty) patch[f] = clone(doc[f]);
    if ('title' in patch || 'titleAccent' in patch) {
      patch.title = doc.title;
      patch.titleAccent = doc.titleAccent || '';
    }
    dirty.clear();
    try { onChange(patch); } catch (err) { console.error('blog-editor onChange', err); }
  }
  function change(tops, fn, coalesce) {
    record(coalesce);
    fn();
    for (const t of [].concat(tops)) dirty.add(t);
    for (const t of seed) dirty.add(t);
    seed.clear();
    schedule();
    updateCount();
  }

  // ------------------------------------------------------------ focus
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !root.contains(a)) return null;
    const wrap = a.closest('[data-key]');
    if (!wrap) return null;
    const f = a.closest('[data-f]');
    if (f) {
      let off = null;
      if (f.isContentEditable) { const o = getOffsets(f); off = o ? o.end : null; } else if (typeof a.selectionStart === 'number') off = a.selectionStart;
      return { key: wrap.dataset.key, f: f.dataset.f, off };
    }
    if (a.dataset.act) return { key: wrap.dataset.key, act: a.dataset.act, prop: a.dataset.prop || '', val: a.dataset.val || '' };
    return { key: wrap.dataset.key };
  }
  function wrapOf(key) {
    if (key === 'doc') return root;
    return page.querySelector(`.bed-block[data-key="${key}"]`);
  }
  function restoreFocus(fc) {
    if (!fc) return;
    const w = wrapOf(fc.key);
    if (!w) return;
    if (fc.f) {
      const f = [...w.querySelectorAll('[data-f]')].find((n) => n.dataset.f === fc.f);
      if (f) { focusField(f, fc.off == null ? 'end' : fc.off); return; }
    }
    if (fc.act) {
      const sel = `[data-act="${fc.act}"]${fc.prop ? `[data-prop="${fc.prop}"]` : ''}${fc.val ? `[data-val="${CSS.escape(fc.val)}"]` : ''}`;
      const b = w.querySelector(sel);
      if (b && !b.disabled) { b.focus({ preventScroll: true }); return; }
    }
    const first = w.querySelector('[data-f], .bed-handle--strip, button');
    if (first && w !== root) first.focus({ preventScroll: true });
  }
  function focusField(f, where = 'end') {
    f.focus({ preventScroll: false });
    if (f.isContentEditable) {
      const len = lenOf(f);
      const at = where === 'start' ? 0 : where === 'end' ? len : Math.min(Number(where) || 0, len);
      setOffsets(f, at);
    } else if (typeof f.setSelectionRange === 'function' && where !== 'start') {
      try { const n = where === 'end' ? f.value.length : Number(where); f.setSelectionRange(n, n); } catch { /* type=url */ }
    }
  }
  function focusBlock(key, where = 'start') {
    const w = wrapOf(key);
    if (!w) return;
    const f = w.querySelector('.bed-content [data-f]');
    if (f) focusField(f, where);
    else {
      const b = w.querySelector('.bed-content button, .bed-content [tabindex="0"], .bed-handle--strip');
      if (b) b.focus();
    }
  }
  function announce(msg) {
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 20);
  }
  let toastTimer = 0;
  function showToast(msg, withUndo) {
    toast.textContent = '';
    toast.append(el('span', { text: msg }));
    if (withUndo) toast.append(el('button', { type: 'button', class: 'bed-toast__btn', 'data-act': 'undo' }, 'Undo'));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  // ---------------------------------------------------------- builders
  function iconBtn(name, label, attrs = {}) {
    const { class: extra, ...rest } = attrs;
    return el('button', { type: 'button', class: `bed-ibtn${extra ? ` ${extra}` : ''}`, 'aria-label': label, title: label, ...rest }, svg(name));
  }
  function chips(label, prop, options, value, { disabled, hint } = {}) {
    const g = el('div', { class: `bed-chips${disabled ? ' is-disabled' : ''}`, role: 'group', 'aria-label': label });
    g.append(el('span', { class: 'bed-chips__label', 'aria-hidden': 'true', text: label }));
    for (const [v, text] of options) {
      g.append(el('button', { type: 'button', class: 'bed-chip', 'data-act': 'set', 'data-prop': prop, 'data-val': String(v),
        'aria-pressed': String(String(v) === String(value)), disabled: !!disabled, title: disabled && hint ? hint : false, text }));
    }
    return g;
  }
  function richField(tag, path, value, ph, cls, { opt, label, first } = {}) {
    const f = el(tag, { class: cls, contenteditable: 'true', 'data-f': path, 'data-kind': 'rich', 'data-ph': ph,
      'data-opt': opt ? '' : false, role: 'textbox', 'aria-label': label || ph, 'aria-multiline': 'false', spellcheck: 'true',
      'data-first': first ? '' : false });
    runsToDom(f, value, doc.references);
    return f;
  }
  function plainField(tag, path, value, ph, cls, { opt, label } = {}) {
    const f = el(tag, { class: cls, contenteditable: PT, 'data-f': path, 'data-kind': 'plain', 'data-ph': ph,
      'data-opt': opt ? '' : false, role: 'textbox', 'aria-label': label || ph, spellcheck: 'true' });
    f.textContent = value || '';
    return f;
  }
  function inputField(path, value, ph, { label, opt, req, kind = 'input', type = 'text', cls = '', warn, warnShown } = {}) {
    const id = uid('in');
    const input = el('input', { id, type, class: `bed-input ${cls}`.trim(), 'data-f': path, 'data-kind': kind, 'data-opt': opt ? '' : false,
      'data-req': req ? '' : false, placeholder: ph, autocomplete: 'off', spellcheck: kind === 'input' ? 'true' : 'false',
      'aria-invalid': warnShown ? 'true' : false, 'aria-describedby': warn ? `${id}-w` : false });
    input.value = value || '';
    const wrap = el('label', { class: 'bed-field', for: id }, el('span', { class: 'bed-field__l', text: label }), input);
    if (warn) wrap.append(el('span', { class: 'bed-warn', id: `${id}-w`, 'data-warn-of': path, hidden: !warnShown }, svg('warn'), warn));
    return wrap;
  }
  const sub = (path, k) => (path ? `${path}.${k}` : k);

  function mediaSlot({ key, path, img, purpose, cover }) {
    const id = `${key}|${path}`;
    const up = uploads.get(id);
    const slot = el('div', { class: `bed-media${cover ? ' bed-media--cover' : ''}`, 'data-media': path, 'data-purpose': purpose });
    const file = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'bed-file', 'data-file': path,
      'data-purpose': purpose, tabindex: '-1', 'aria-hidden': 'true' });
    if (img && img.src) {
      const frame = el('div', cover
        ? { class: 'bed-frame bed-frame--focal', tabindex: '0', role: 'group', 'data-focal': '',
          'aria-label': 'Cover photo focus point. Click the photo, or use the arrow keys, to choose what stays in frame.' }
        : { class: 'bed-frame' });
      frame.append(el('img', { src: resolveSrc(img.src), alt: '', draggable: 'false', decoding: 'async' }));
      if (cover) {
        const f = img.focal || { x: 0.5, y: 0.5 };
        const dot = el('span', { class: 'bed-focal', 'aria-hidden': 'true' });
        dot.style.left = `${f.x * 100}%`;
        dot.style.top = `${f.y * 100}%`;
        frame.append(dot);
      }
      const acts = el('div', { class: 'bed-media__acts' },
        el('button', { type: 'button', class: 'bed-btn bed-btn--overlay', 'data-act': 'pick', 'data-p': path }, svg('upload'), cover ? 'Replace' : 'Replace photo'));
      if (cover) acts.append(el('button', { type: 'button', class: 'bed-btn bed-btn--overlay', 'data-act': 'cover-remove' }, svg('trash'), 'Remove'));
      slot.append(frame, acts);
      if (cover) slot.append(el('p', { class: 'bed-help', text: 'Click the photo to set its focus point — crops on the site keep it in frame.' }));
    } else {
      slot.append(el('button', { type: 'button', class: 'bed-drop', 'data-act': 'pick', 'data-p': path },
        svg('upload'), el('span', { class: 'bed-drop__t', text: cover ? 'Add a cover photo' : 'Add a photo' }),
        el('span', { class: 'bed-drop__h', text: 'Any size — it is resized for the web' })));
    }
    if (up) {
      slot.append(up.state === 'busy'
        ? el('p', { class: 'bed-up', role: 'status' }, el('span', { class: 'bed-up__bar', 'aria-hidden': 'true' }), el('span', { text: 'Preparing photo…' }))
        : el('p', { class: 'bed-up is-error', role: 'alert' }, svg('warn'), el('span', { text: up.message })));
    }
    slot.append(file);
    return slot;
  }
  function patientRow(key, path, img) {
    const id = `${key}|${path}`;
    const on = img.patient === true;
    const pending = !on && pendingPatient.has(id);
    const row = el('div', { class: 'bed-patient' });
    const cb = el('input', { type: 'checkbox', 'data-act': 'patient', 'data-p': path });
    cb.checked = on || pending;
    row.append(el('label', { class: 'bed-check' }, cb, el('span', { text: 'Patient photo' })));
    if (on || pending) {
      const cc = el('input', { type: 'checkbox', 'data-act': 'consent', 'data-p': path });
      cc.checked = on;
      row.append(el('label', { class: `bed-check${on ? '' : ' is-needed'}` }, cc, el('span', { text: 'Patient consent is on file' })));
      if (!on) row.append(el('p', { class: 'bed-warn', role: 'alert' }, svg('warn'), 'Confirm consent before this can be marked as a patient photo.'));
    }
    return row;
  }
  function imageMeta(key, path, img, { richCaption = true, credit = false } = {}) {
    const wrap = el('div', { class: 'bed-meta' });
    wrap.append(inputField(sub(path, 'alt'), img.alt, 'Describe the photo for someone who cannot see it',
      { label: 'Alt text', req: true, warn: 'Required — read aloud to blind readers, and it helps Google.', warnShown: blank(img.alt) }));
    if (richCaption) {
      const capId = uid('cap');
      wrap.append(el('div', { class: 'bed-field' }, el('span', { class: 'bed-field__l', id: capId, text: 'Caption' }),
        richField('div', sub(path, 'caption'), img.caption, 'Optional', 'bed-input bed-input--rich', { opt: true, label: 'Caption' })));
    } else {
      // plain-text caption (cover): contenteditable so it wraps like the published caption line
      const capId = uid('cap');
      wrap.append(el('div', { class: 'bed-field' }, el('span', { class: 'bed-field__l', id: capId, text: 'Caption' }),
        plainField('div', sub(path, 'caption'), typeof img.caption === 'string' ? img.caption : inlineText(img.caption), 'Optional', 'bed-input bed-input--rich', { opt: true, label: 'Caption' })));
    }
    if (credit) wrap.append(inputField(sub(path, 'credit'), img.credit, 'Optional — e.g. MediVasc', { label: 'Credit', opt: true }));
    wrap.append(patientRow(key, path, img));
    return wrap;
  }

  // ------------------------------------------------------------ render
  function render() {
    page.textContent = '';
    root.dataset.title = doc.titleSize;
    root.dataset.body = doc.bodySize;
    root.dataset.leadin = doc.leadIn;
    headEl = renderHead();
    flowEl = renderFlow();
    refsEl = renderRefs();
    page.append(headEl, flowEl, refsEl);
    renderBar();
    renderTypo();
  }
  function renderBar() {
    bar.textContent = '';
    const left = el('div', { class: 'bed-bar__group' });
    if (opts.historyButtons !== false) {
      left.append(iconBtn('undo', 'Undo', { 'data-act': 'undo', disabled: !hist.past.length, 'aria-keyshortcuts': 'Meta+Z Control+Z' }),
        iconBtn('redo', 'Redo', { 'data-act': 'redo', disabled: !hist.future.length, 'aria-keyshortcuts': 'Meta+Shift+Z Control+Shift+Z' }));
    }
    bar.append(left, el('span', { class: 'bed-bar__count', 'data-count': '' }),
      el('button', { type: 'button', class: 'bed-typebtn', 'data-act': 'typo', 'aria-expanded': String(typeOpen), 'aria-controls': typePanel.id },
        svg('type'), el('span', { class: 'bed-typebtn__l', text: 'Typography' }), el('span', { class: 'bed-typebtn__sum', 'data-typosum': '', text: typoSummary() })));
    updateCount();
  }
  const LEADINS = [['dropcap', 'Drop cap'], ['smallcaps', 'Small caps'], ['boldwords', 'Bold words'], ['none', 'None']];
  const typoSummary = () => `Title ${doc.titleSize} · Text ${doc.bodySize} · ${(LEADINS.find((l) => l[0] === doc.leadIn) || LEADINS[3])[1]}`;
  function renderTypo() {
    typePanel.textContent = '';
    typePanel.hidden = !typeOpen;
    typePanel.append(
      chips('Title size', 'titleSize', [['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL']], doc.titleSize),
      chips('Text size', 'bodySize', [['S', 'S'], ['M', 'M'], ['L', 'L']], doc.bodySize),
      chips('Opening', 'leadIn', LEADINS, doc.leadIn));
    const sum = bar.querySelector('[data-typosum]');
    if (sum) sum.textContent = typoSummary();
    const btn = bar.querySelector('[data-act="typo"]');
    if (btn) btn.setAttribute('aria-expanded', String(typeOpen));
  }
  function updateCount() {
    const c = bar.querySelector('[data-count]');
    if (c) {
      const n = wordCount(doc);
      c.textContent = '';
      c.append(el('span', { class: 'bed-bar__words', text: n ? `${n.toLocaleString('en-IN')} words · ` : 'No words yet' }), n ? `${Math.max(1, Math.round(n / 220))} min read` : '');
    }
  }
  function paintTitle(t) {
    t.textContent = '';
    const m = doc.titleAccent ? wholeWordMatch(doc.title, doc.titleAccent.trim()) : null;
    if (!m) { t.textContent = doc.title; return; }
    t.append(doc.title.slice(0, m.index), el('em', { class: 'bed-accent', text: doc.title.slice(m.index, m.index + m.length) }), doc.title.slice(m.index + m.length));
  }
  function updateAccentNote() {
    const note = headEl && headEl.querySelector('[data-note="accent"]');
    if (!note) return;
    const a = (doc.titleAccent || '').trim();
    note.textContent = '';
    if (a && !wholeWordMatch(doc.title, a)) {
      note.hidden = false;
      note.append(svg('warn'), el('span', { text: `The accent words “${a}” are no longer in the title.` }),
        el('button', { type: 'button', class: 'bed-link', 'data-act': 'accent-clear' }, 'Clear accent'));
    } else if (a) {
      note.hidden = false;
      note.classList.add('is-quiet');
      note.append(el('span', { text: `Accent: “${a}”` }), el('button', { type: 'button', class: 'bed-link', 'data-act': 'accent-clear' }, 'Remove'));
      return;
    } else note.hidden = true;
    note.classList.remove('is-quiet');
  }
  function renderHead() {
    const head = el('header', { class: 'bed-head', 'data-key': 'doc' });
    const title = el('h1', { class: 'bed-title', contenteditable: PT, 'data-f': 'title', 'data-kind': 'plain', 'data-ph': 'Title',
      role: 'textbox', 'aria-label': 'Title — select words and press Accent to set them in accent italic', spellcheck: 'true' });
    paintTitle(title);
    head.append(title, el('p', { class: 'bed-note', 'data-note': 'accent', hidden: true }),
      plainField('p', 'dek', doc.dek, 'A one- or two-sentence summary under the title', 'bed-dek', { label: 'Summary' }));
    const fig = el('figure', { class: 'bed-cover' });
    fig.append(mediaSlot({ key: 'doc', path: 'cover', img: doc.cover, purpose: 'cover', cover: true }));
    if (doc.cover && doc.cover.src) fig.append(imageMeta('doc', 'cover', doc.cover, { richCaption: false, credit: true }));
    head.append(fig);
    headEl = head;
    updateAccentNote();
    return head;
  }
  function renderFlow() {
    const f = el('div', { class: 'bed-flow' });
    const firstText = doc.blocks.findIndex((b) => b.type === 'paragraph' || b.type === 'lead');
    doc.blocks.forEach((b, i) => f.append(gap(i), blockEl(b, i, i === firstText)));
    f.append(el('div', { class: 'bed-end' }, el('button', { type: 'button', class: 'bed-add', 'data-act': 'insert', 'data-at': String(doc.blocks.length) }, svg('plus'), 'Add block')));
    return f;
  }
  const gap = (i) => el('div', { class: 'bed-gap' }, el('button', { type: 'button', class: 'bed-plus', tabindex: '-1', 'data-act': 'insert',
    'data-at': String(i), 'aria-label': 'Add a block here', title: 'Add a block here' }, svg('plus')));
  function layoutClass(b) {
    if (b.type !== 'image') return '';
    const w = b.width || 'column';
    let c = ` is-${w}`;
    if (w === 'column' && (b.align === 'left' || b.align === 'right')) c += ` is-float is-${b.align} is-size-${b.size || 'M'}`;
    return c;
  }
  function blockEl(b, i, first) {
    const key = keys[i];
    const w = el('section', { class: `bed-block${layoutClass(b)}${key === selKey ? ' is-selected' : ''}`, 'data-key': key, 'data-type': b.type, 'aria-label': labelOf(b.type) });
    w.append(el('div', { class: 'bed-gutter' }, el('button', { type: 'button', class: 'bed-handle', tabindex: '-1', 'data-act': 'handle', 'aria-label': `Move ${labelOf(b.type)}`, title: 'Drag to move' }, svg('drag'))));
    w.append(el('div', { class: 'bed-content' }, bodyOf(b, key, first)));
    if (key === selKey) w.append(stripOf(b, i));
    return w;
  }
  function renderBlock(key) {
    const i = keys.indexOf(key);
    const old = wrapOf(key);
    if (i < 0 || !old) { render(); return; }
    const firstText = doc.blocks.findIndex((b) => b.type === 'paragraph' || b.type === 'lead');
    old.replaceWith(blockEl(doc.blocks[i], i, i === firstText));
  }
  function rerenderFlow() {
    const next = renderFlow();
    flowEl.replaceWith(next);
    flowEl = next;
    rerenderRefs();
  }
  function rerenderRefs() {
    const next = renderRefs();
    refsEl.replaceWith(next);
    refsEl = next;
    updateCiteNumbers();
  }
  function updateCiteNumbers() {
    for (const s of page.querySelectorAll('sup[data-cite]')) {
      const k = doc.references.findIndex((r) => r.id === s.dataset.cite);
      s.textContent = k < 0 ? '?' : String(k + 1);
      s.classList.toggle('is-missing', k < 0);
    }
  }

  function bodyOf(b, key, first) {
    switch (b.type) {
      case 'paragraph':
        return richField('p', 'text', b.text, first ? 'Start writing — or press / to add a block' : 'Write, or press / for blocks', 'bed-p', { label: 'Paragraph', first });
      case 'lead':
        return richField('p', 'text', b.text, 'Intro paragraph — the opening lines', 'bed-lead', { label: 'Intro paragraph', first });
      case 'heading':
        return plainField(b.level === 3 ? 'h3' : 'h2', 'text', b.text, b.level === 3 ? 'Sub-heading' : 'Heading',
          `bed-h bed-h${b.level === 3 ? 3 : 2} bed-h--${b.size || 'M'}`, { label: b.level === 3 ? 'Sub-heading (H3)' : 'Heading (H2)' });
      case 'list': {
        const items = Array.isArray(b.items) && b.items.length ? b.items : [''];
        return el(b.style === 'number' ? 'ol' : 'ul', { class: `bed-list bed-list--${b.style === 'number' ? 'number' : 'bullet'}` },
          items.map((it, k) => richField('li', `items.${k}`, it, 'List item', 'bed-li', { label: `Item ${k + 1}` })));
      }
      case 'quote':
        return el('figure', { class: 'bed-quote' }, el('blockquote', null, richField('p', 'text', b.text, 'The quoted words', 'bed-quote__p', { label: 'Quote' })),
          el('figcaption', null, plainField('span', 'cite', b.cite, 'Who said it (optional)', 'bed-quote__cite', { opt: true, label: 'Who said it' })));
      case 'pullquote':
        return el('figure', { class: 'bed-pull' }, plainField('p', 'text', b.text, 'A line worth repeating', 'bed-pull__p', { label: 'Pull quote' }),
          el('figcaption', null, plainField('span', 'cite', b.cite, 'Who said it (optional)', 'bed-quote__cite', { opt: true, label: 'Who said it' })));
      case 'image':
        return el('figure', { class: 'bed-figure' }, mediaSlot({ key, path: '', img: b, purpose: 'block' }),
          b.src ? imageMeta(key, '', b, { credit: true }) : null);
      case 'gallery': {
        const images = Array.isArray(b.images) ? b.images : [];
        return el('div', { class: 'bed-gallery', 'data-count': String(images.length) },
          el('div', { class: 'bed-gallery__grid' }, images.map((img, k) => el('figure', { class: 'bed-gallery__item' },
            mediaSlot({ key, path: `images.${k}`, img, purpose: 'block' }),
            img.src ? imageMeta(key, `images.${k}`, img) : null,
            images.length > 2 ? el('button', { type: 'button', class: 'bed-btn bed-btn--text', 'data-act': 'gallery-remove', 'data-k': String(k) }, svg('trash'), 'Remove photo') : null))),
          richField('p', 'caption', b.caption, 'Caption for the set (optional)', 'bed-cap', { opt: true, label: 'Gallery caption' }));
      }
      case 'imageText': {
        const img = b.image || { src: '', alt: '' };
        const text = Array.isArray(b.text) && b.text.length ? b.text : [''];
        return el('div', { class: 'bed-it', 'data-side': b.side === 'right' ? 'right' : 'left' },
          el('figure', { class: 'bed-it__media' }, mediaSlot({ key, path: 'image', img, purpose: 'block' }), img.src ? imageMeta(key, 'image', img) : null),
          el('div', { class: 'bed-it__text' }, text.map((t, k) => richField('p', `text.${k}`, t, 'Text beside the photo', 'bed-p', { label: `Paragraph ${k + 1}` }))));
      }
      case 'callout': {
        const tone = ['doctor', 'tip', 'note'].includes(b.tone) ? b.tone : 'doctor';
        return el('aside', { class: `bed-callout bed-callout--${tone}` },
          el('span', { class: 'bed-callout__icon', 'aria-hidden': 'true' }, svg(tone === 'doctor' ? 'plus' : tone === 'tip' ? 'check' : 'callout')),
          plainField('p', 'title', b.title, tone === 'doctor' ? CALLOUT_TITLES.doctor : 'Title (optional)', 'bed-callout__title', { opt: true, label: 'Box title' }),
          richField('p', 'text', b.text, 'What the reader should know', 'bed-callout__text', { label: 'Box text' }));
      }
      case 'takeaways': {
        const items = Array.isArray(b.items) && b.items.length ? b.items : [''];
        return el('aside', { class: 'bed-take' }, plainField('p', 'title', b.title, 'Key takeaways', 'bed-take__title', { opt: true, label: 'Box title' }),
          el('ul', { class: 'bed-take__list' }, items.map((it, k) => richField('li', `items.${k}`, it, 'A point to remember', 'bed-take__li', { label: `Point ${k + 1}` }))));
      }
      case 'divider':
        return el('div', { class: 'bed-divider', tabindex: '0', role: 'separator', 'aria-label': 'Divider' });
      case 'table': {
        const header = Array.isArray(b.header) ? b.header : [];
        const rows = Array.isArray(b.rows) ? b.rows : [];
        return el('figure', { class: 'bed-table' },
          plainField('figcaption', 'caption', b.caption, 'Table title (optional)', 'bed-table__cap', { opt: true, label: 'Table title' }),
          el('div', { class: 'bed-table__scroll' }, el('table', null,
            el('thead', null, el('tr', null, header.map((hd, c) => el('th', null, plainField('div', `header.${c}`, hd, `Column ${c + 1}`, 'bed-cell', { label: `Column ${c + 1} heading` }))))),
            el('tbody', null, rows.map((row, r) => el('tr', null, (Array.isArray(row) ? row : []).map((cell, c) => el('td', null,
              richField('div', `rows.${r}.${c}`, cell, '·', 'bed-cell', { label: `Row ${r + 1}, column ${c + 1}` })))))))));
      }
      case 'video':
        return videoBody(b);
      case 'faq': {
        const items = Array.isArray(b.items) && b.items.length ? b.items : [{ q: '', a: '' }];
        return el('div', { class: 'bed-faq' },
          plainField('h3', 'title', b.title, 'Questions people ask', 'bed-faq__title', { opt: true, label: 'Questions title' }),
          el('div', { class: 'bed-faq__list' }, items.map((it, k) => el('div', { class: 'bed-faq__item' },
            el('div', { class: 'bed-faq__row' }, plainField('p', `items.${k}.q`, it.q, 'The question', 'bed-faq__q', { label: `Question ${k + 1}` }),
              el('div', { class: 'bed-faq__acts' },
                iconBtn('up', `Move question ${k + 1} up`, { 'data-act': 'faq-move', 'data-k': String(k), 'data-d': '-1', disabled: k === 0 }),
                iconBtn('down', `Move question ${k + 1} down`, { 'data-act': 'faq-move', 'data-k': String(k), 'data-d': '1', disabled: k === items.length - 1 }),
                iconBtn('trash', `Remove question ${k + 1}`, { 'data-act': 'faq-remove', 'data-k': String(k), disabled: items.length === 1 }))),
            richField('div', `items.${k}.a`, it.a, 'The answer', 'bed-faq__a', { label: `Answer ${k + 1}` })))),
          el('button', { type: 'button', class: 'bed-btn bed-btn--quiet', 'data-act': 'faq-add' }, svg('plus'), 'Add question'));
      }
      case 'cta': {
        const kind = ['whatsapp', 'call', 'contact'].includes(b.kind) ? b.kind : 'whatsapp';
        return el('div', { class: 'bed-cta' }, plainField('p', 'text', b.text, 'A short line above the button (optional)', 'bed-cta__text', { opt: true, label: 'Text above the button' }),
          el('span', { class: 'bed-cta__btn' }, plainField('span', 'label', b.label, CTA_LABELS[kind], 'bed-cta__label', { opt: true, label: 'Button label' })));
      }
      default:
        return el('p', { class: 'bed-help', text: `Unknown block “${b.type}”.` });
    }
  }
  function videoBody(b) {
    const v = el('figure', { class: 'bed-video' });
    if (b.source !== 'youtube') {
      const film = films.find((f) => f.src === b.src);
      v.append(film
        ? el('div', { class: 'bed-video__frame' }, el('video', { src: resolveSrc(film.src), poster: film.poster ? resolveSrc(film.poster) : false, controls: true, preload: 'none', playsinline: true }))
        : el('div', { class: 'bed-video__empty' }, svg('film'), el('span', { text: films.length ? 'Choose one of the site’s films' : 'The site has no films yet — switch to YouTube' })));
      if (films.length) {
        v.append(el('div', { class: 'bed-films', role: 'group', 'aria-label': 'Site films' }, films.map((f) => el('button', {
          type: 'button', class: 'bed-film', 'data-act': 'film', 'data-val': f.src, 'aria-pressed': String(f.src === b.src) },
        f.poster ? el('img', { src: resolveSrc(f.poster), alt: '', loading: 'lazy' }) : el('span', { class: 'bed-film__ph' }, svg('film')),
        el('span', { class: 'bed-film__cap', text: f.caption || f.src.split('/').pop() }),
        f.duration ? el('span', { class: 'bed-film__dur', text: f.duration }) : null))));
      }
    } else {
      const id = b.youtube && /^[A-Za-z0-9_-]{11}$/.test(b.youtube) ? b.youtube : '';
      v.append(id
        ? el('div', { class: 'bed-yt' }, el('img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: '', loading: 'lazy' }), el('span', { class: 'bed-yt__play', 'aria-hidden': 'true' }, svg('video')))
        : el('div', { class: 'bed-video__empty' }, svg('video'), el('span', { text: 'Paste a YouTube link below' })));
      v.append(inputField('youtube', id ? `https://youtu.be/${id}` : '', 'https://www.youtube.com/watch?v=…',
        { label: 'YouTube link', kind: 'yt', warn: 'That does not look like a YouTube link — paste the address of the video page.', warnShown: false }));
    }
    v.append(richField('figcaption', 'caption', b.caption, 'Caption (optional)', 'bed-cap', { opt: true, label: 'Video caption' }));
    return v;
  }
  function stripOf(b, i) {
    const s = el('div', { class: 'bed-strip', role: 'group', 'aria-label': `${labelOf(b.type)} settings` });
    const set = el('div', { class: 'bed-strip__set' });
    const SML = [['S', 'S'], ['M', 'M'], ['L', 'L']];
    switch (b.type) {
      case 'heading':
        set.append(chips('Level', 'level', [[2, 'H2'], [3, 'H3']], b.level === 3 ? 3 : 2), chips('Size', 'size', SML, b.size || 'M'),
          inputField('anchor', b.anchor || '', 'auto', { label: 'Section link #', opt: true, kind: 'anchor', cls: 'bed-input--sm' }));
        break;
      case 'list':
        set.append(chips('Style', 'style', [['bullet', 'Bullets'], ['number', 'Numbers']], b.style === 'number' ? 'number' : 'bullet'));
        break;
      case 'image': {
        const w = b.width || 'column';
        set.append(chips('Width', 'width', [['column', 'Column'], ['wide', 'Wide'], ['full', 'Full']], w),
          chips('Position', 'align', [['center', 'Centre'], ['left', 'Left'], ['right', 'Right']], b.align || 'center', { disabled: w !== 'column', hint: 'Only a column-width photo can sit beside the text' }));
        if (w === 'column' && (b.align === 'left' || b.align === 'right')) set.append(chips('Size', 'size', SML, b.size || 'M'));
        break;
      }
      case 'imageText':
        set.append(chips('Photo', 'side', [['left', 'Left'], ['right', 'Right']], b.side === 'right' ? 'right' : 'left'));
        break;
      case 'callout':
        set.append(chips('Style', 'tone', [['doctor', 'See a doctor'], ['tip', 'Tip'], ['note', 'Note']], b.tone || 'doctor'));
        break;
      case 'cta':
        set.append(chips('Button', 'kind', [['whatsapp', 'WhatsApp'], ['call', 'Call'], ['contact', 'Contact']], b.kind || 'whatsapp'));
        break;
      case 'video':
        set.append(chips('Source', 'source', [['film', 'Site film'], ['youtube', 'YouTube']], b.source === 'youtube' ? 'youtube' : 'film'));
        break;
      case 'table': {
        const cols = (b.header || []).length;
        const rows = (b.rows || []).length;
        set.append(el('div', { class: 'bed-chips', role: 'group', 'aria-label': 'Rows and columns' },
          el('span', { class: 'bed-chips__label', 'aria-hidden': 'true', text: 'Rows' }),
          el('button', { type: 'button', class: 'bed-chip', 'data-act': 'table', 'data-val': 'row+', text: '+ Row' }),
          el('button', { type: 'button', class: 'bed-chip', 'data-act': 'table', 'data-val': 'row-', disabled: rows <= 1, text: '− Row' }),
          el('span', { class: 'bed-chips__label', 'aria-hidden': 'true', text: 'Columns' }),
          el('button', { type: 'button', class: 'bed-chip', 'data-act': 'table', 'data-val': 'col+', disabled: cols >= 6, text: '+ Column' }),
          el('button', { type: 'button', class: 'bed-chip', 'data-act': 'table', 'data-val': 'col-', disabled: cols <= 1, text: '− Column' })));
        break;
      }
      case 'gallery':
        if ((b.images || []).length < 3) set.append(el('button', { type: 'button', class: 'bed-chip', 'data-act': 'gallery-add' }, '+ Third photo'));
        break;
      default:
        break;
    }
    const acts = el('div', { class: 'bed-strip__acts' },
      el('button', { type: 'button', class: 'bed-ibtn bed-handle bed-handle--strip', 'data-act': 'handle',
        'aria-label': `Move ${labelOf(b.type)}: drag, or press the up or down arrow key`, title: 'Drag, or press ↑ ↓', 'aria-keyshortcuts': 'ArrowUp ArrowDown' }, svg('drag')),
      iconBtn('up', 'Move up', { 'data-act': 'move', 'data-d': '-1', disabled: i === 0 }),
      iconBtn('down', 'Move down', { 'data-act': 'move', 'data-d': '1', disabled: i === doc.blocks.length - 1 }),
      iconBtn('plus', 'Add a block below', { 'data-act': 'insert', 'data-at': String(i + 1) }),
      iconBtn('copy', 'Duplicate', { 'data-act': 'dup' }),
      iconBtn('trash', 'Delete block', { 'data-act': 'del', class: 'is-danger' }));
    s.append(el('span', { class: 'bed-strip__name', text: labelOf(b.type) }), set, acts);
    return s;
  }
  function renderRefs() {
    const sec = el('section', { class: 'bed-refs', 'data-key': 'doc', 'aria-labelledby': `${uidBase}-refs` });
    const counts = citeCounts(doc.blocks);
    sec.append(el('div', { class: 'bed-refs__head' }, el('h2', { class: 'bed-refs__title', id: `${uidBase}-refs`, text: 'References' }),
      el('p', { class: 'bed-help', text: 'Numbered in this order. To cite one, select words in the text and press Cite.' })));
    const list = el('ol', { class: 'bed-refs__list' });
    doc.references.forEach((r, k) => {
      const n = counts.get(r.id) || 0;
      const urlBad = !blank(r.url) && !/^https:\/\/[^\s<>"]+$/.test(r.url);
      const text = el('textarea', { class: 'bed-input bed-ref__text', rows: '2', 'data-f': `references.${k}.text`, 'data-kind': 'input', 'data-req': '',
        placeholder: 'Author, title, journal or website, year', 'aria-label': `Reference ${k + 1}`, 'aria-invalid': blank(r.text) ? 'true' : false });
      text.value = r.text || '';
      const url = el('input', { type: 'url', class: 'bed-input bed-input--sm', 'data-f': `references.${k}.url`, 'data-kind': 'url', 'data-opt': '',
        placeholder: 'https:// link (optional)', 'aria-label': `Reference ${k + 1} link`, autocomplete: 'off', 'aria-invalid': urlBad ? 'true' : false });
      url.value = r.url || '';
      const li = el('li', { class: 'bed-ref', 'data-ref': r.id },
        el('span', { class: 'bed-ref__n', 'aria-hidden': 'true', text: String(k + 1) }),
        el('div', { class: 'bed-ref__body' }, text, url,
          el('span', { class: 'bed-warn', 'data-warn-of': `references.${k}.url`, hidden: !urlBad }, svg('warn'), 'Links must start with https://'),
          el('span', { class: 'bed-ref__meta', text: n ? `Cited ${n} time${n === 1 ? '' : 's'}` : 'Not cited yet' })),
        el('div', { class: 'bed-ref__acts' },
          iconBtn('up', `Move reference ${k + 1} up`, { 'data-act': 'ref-move', 'data-k': String(k), 'data-d': '-1', disabled: k === 0 }),
          iconBtn('down', `Move reference ${k + 1} down`, { 'data-act': 'ref-move', 'data-k': String(k), 'data-d': '1', disabled: k === doc.references.length - 1 }),
          iconBtn('trash', `Delete reference ${k + 1}`, { 'data-act': 'ref-del', 'data-k': String(k), class: 'is-danger' })));
      if (pendingRefDelete === r.id) {
        li.append(el('div', { class: 'bed-confirm', role: 'alert' }, svg('warn'),
          el('span', { text: `Cited ${n} time${n === 1 ? '' : 's'} in the text. Deleting it also removes ${n === 1 ? 'that citation number' : 'those citation numbers'}.` }),
          el('button', { type: 'button', class: 'bed-btn bed-btn--danger', 'data-act': 'ref-del-yes', 'data-k': String(k) }, 'Delete reference'),
          el('button', { type: 'button', class: 'bed-btn bed-btn--text', 'data-act': 'ref-del-no' }, 'Keep')));
      }
      list.append(li);
    });
    sec.append(list, el('button', { type: 'button', class: 'bed-btn bed-btn--quiet', 'data-act': 'ref-add' }, svg('plus'), 'Add reference'));
    return sec;
  }

  // ----------------------------------------------------------- targets
  function targetOf(node) {
    const wrap = node && node.closest('[data-key]');
    if (!wrap || !root.contains(wrap)) return null;
    const key = wrap.dataset.key;
    if (key === 'doc') return { key, index: -1, obj: doc };
    const index = keys.indexOf(key);
    if (index < 0) return null;
    return { key, index, obj: doc.blocks[index] };
  }
  const topOf = (t, path) => (t.key === 'doc' ? path.split('.')[0] : 'blocks');
  const insertAt = (i, b) => { doc.blocks.splice(i, 0, b); keys.splice(i, 0, nextKey()); };
  const removeAt = (i) => { doc.blocks.splice(i, 1); keys.splice(i, 1); };
  const isTextBlock = (b) => b && (b.type === 'paragraph' || b.type === 'lead');
  function fieldIn(key, path) {
    const w = wrapOf(key);
    return w ? [...w.querySelectorAll('[data-f]')].find((n) => n.dataset.f === path) || null : null;
  }
  function focusPath(key, path, where) {
    const f = fieldIn(key, path);
    if (f) focusField(f, where);
  }
  function toggleWarn(f, show) {
    if (show) f.setAttribute('aria-invalid', 'true');
    else f.removeAttribute('aria-invalid');
    const w = f.closest('[data-key]');
    if (!w) return;
    for (const n of w.querySelectorAll('[data-warn-of]')) if (n.dataset.warnOf === f.dataset.f) n.hidden = !show;
  }
  const slugAnchor = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|-+$/g, '');
  function rerenderHead() {
    const old = headEl;
    const next = renderHead();
    old.replaceWith(next);
  }
  const rerenderTarget = (key) => (key === 'doc' ? rerenderHead() : renderBlock(key));

  // ------------------------------------------------------------- typing
  function readField(f) {
    if (f.dataset.kind === 'rich') return toInline(trimRuns(domToRuns(f)));
    if (f.dataset.kind === 'plain') return f.textContent.replace(/[\s ]+/g, ' ').trim();
    return f.value.trim();
  }
  function onInput(e) {
    const f = e.target.closest && e.target.closest('[data-f]');
    if (!f || !page.contains(f)) return;
    const t = targetOf(f);
    if (!t) return;
    const kind = f.dataset.kind;
    if ((kind === 'rich' || kind === 'plain') && !f.textContent && !f.querySelector('sup') && f.innerHTML) f.innerHTML = '';
    if (kind === 'rich' && f.querySelector('sup')) markAdjacentCites(f);
    if (pendingMark && kind === 'rich' && !e.isComposing) {
      if (pendingMark.f === f && f.isConnected) applyPendingMark(f);
      else pendingMark = null;
    }
    let path = f.dataset.f;
    let value;
    if (kind === 'yt') {
      value = parseYouTube(f.value);
      toggleWarn(f, !!f.value.trim() && !value);
      path = 'youtube';
    } else if (kind === 'anchor') value = slugAnchor(f.value);
    else if (kind === 'url') {
      value = f.value.trim();
      toggleWarn(f, !!value && !/^https:\/\/[^\s<>"]+$/.test(value));
    } else value = readField(f);
    if (f.hasAttribute('data-req')) toggleWarn(f, blank(value));
    const cur = getPath(t.obj, path);
    if (same(cur === undefined ? '' : cur, value)) return;
    change(topOf(t, path), () => setPath(t.obj, path, value, f.hasAttribute('data-opt')), `type:${t.key}:${path}`);
    if (t.key === 'doc' && path === 'title') updateAccentNote();
    if (kind === 'yt' && value !== (cur || '')) {
      const off = f.selectionStart;
      renderBlock(t.key);
      const n = fieldIn(t.key, 'youtube');
      if (n) { n.value = f.value; n.focus(); try { n.setSelectionRange(off, off); } catch { /* noop */ } }
    }
  }
  function onBeforeInput(e) {
    const f = e.target.closest && e.target.closest('[data-f]');
    if (!f || !f.isContentEditable || !page.contains(f)) return;
    const type = e.inputType || '';
    if (type === 'historyUndo' || type === 'historyRedo') { e.preventDefault(); if (type === 'historyUndo') undo(); else redo(); return; }
    if (type.startsWith('format')) {
      e.preventDefault();
      if (f.dataset.kind === 'rich' && (type === 'formatBold' || type === 'formatItalic')) { captureSel(f); toggleMark(type === 'formatBold' ? 'b' : 'i'); }
      return;
    }
    if (type === 'insertFromDrop') { e.preventDefault(); return; }
    if (type === 'insertParagraph' || type === 'insertLineBreak') { e.preventDefault(); if (type === 'insertParagraph') onEnter(f); return; }
    if (type === 'deleteContentBackward') {
      const o = getOffsets(f);
      if (o && o.start === 0 && o.end === 0 && onBackspaceAtStart(f)) e.preventDefault();
    }
  }
  function caretOnEdge(f, up) {
    const sel = document.getSelection();
    const o = getOffsets(f);
    if (!o) return false;
    if (up && o.start === 0) return true;
    if (!up && o.end === lenOf(f)) return true;
    const rect = sel.getRangeAt(0).getClientRects()[0];
    if (!rect) return false;
    const fr = f.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(f).lineHeight) || 24;
    return up ? rect.top - fr.top < lh * 0.75 : fr.bottom - rect.bottom < lh * 0.75;
  }
  function onKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;
    const k = (e.key || '').toLowerCase();
    if (mod && !e.altKey && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (e.ctrlKey && !e.metaKey && !e.altKey && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') {
      if (!menu.hidden) { e.preventDefault(); closeMenu(true); return; }
      if (!pop.hidden) { e.preventDefault(); closePop(true); return; }
      if (!tb.hidden) { hideToolbar(); return; }
    }
    if (menu.contains(e.target)) { menuKeys(e); return; }
    const handle = e.target.closest && e.target.closest('.bed-handle');
    if (handle && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const t = targetOf(handle);
      if (t && t.key !== 'doc') moveBlock(t.index, t.index + (e.key === 'ArrowUp' ? -1 : 1), { focus: 'handle' });
      return;
    }
    if (e.target.closest && e.target.closest('[data-focal]') && e.key.startsWith('Arrow')) {
      e.preventDefault();
      nudgeFocal(e.key, e.shiftKey ? 0.01 : 0.05);
      return;
    }
    const f = e.target.closest && e.target.closest('[data-f]');
    if (!f || !f.isContentEditable || !page.contains(f)) return;
    if (e.isComposing || e.keyCode === 229) return;
    const rich = f.dataset.kind === 'rich';
    if (mod && !e.altKey && ['b', 'i', 'u', 'k', 'h'].includes(k)) {
      if (k === 'h' && !e.shiftKey) return;
      e.preventDefault();
      if (!rich || k === 'u') return;
      if (!captureSel(f)) return;
      if (k === 'k') openLink();
      else if (selState.start === selState.end) togglePendingMark(f, selState.start, k === 'h' ? 'hl' : k);
      else toggleMark(k === 'h' ? 'hl' : k);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); if (!e.shiftKey) onEnter(f); return; }
    if (e.key === 'Backspace' && !mod && !e.altKey) {
      const o = getOffsets(f);
      if (o && o.start === 0 && o.end === 0 && onBackspaceAtStart(f)) e.preventDefault();
      return;
    }
    if (e.key === '/' && !mod && f.dataset.f === 'text') {
      const t = targetOf(f);
      if (t && t.obj && t.obj.type === 'paragraph' && !f.textContent.trim() && !f.querySelector('sup')) {
        e.preventDefault();
        openMenu({ at: t.index, replaceKey: t.key, anchor: f, slash: true });
      }
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !mod && !e.altKey) {
      const up = e.key === 'ArrowUp';
      if (!caretOnEdge(f, up)) return;
      const fields = [...page.querySelectorAll('[data-f][contenteditable]')];
      const next = fields[fields.indexOf(f) + (up ? -1 : 1)];
      if (!next) return;
      e.preventDefault();
      focusField(next, up ? 'end' : 'start');
    }
  }
  function nextField(f) {
    const fields = [...page.querySelectorAll('[data-f]')].filter((n) => n.isContentEditable || n.localName === 'input' || n.localName === 'textarea');
    const n = fields[fields.indexOf(f) + 1];
    if (n) focusField(n, 'start');
  }
  function onEnter(f) {
    const t = targetOf(f);
    if (!t) return;
    const path = f.dataset.f;
    if (t.key === 'doc') {
      if (path === 'title') focusPath('doc', 'dek', 'end');
      else if (path === 'dek') focusBlock(keys[0], 'start');
      else nextField(f);
      return;
    }
    const b = t.obj;
    const len = lenOf(f);
    const o = getOffsets(f) || { start: len, end: len };
    const runs = f.dataset.kind === 'rich' ? domToRuns(f) : [{ t: f.textContent }];
    const [before, , after] = rangeRuns(runs, o.start, o.end);
    const plainOf = (rs) => inlineText(rs).replace(/\s+/g, ' ').trim();
    if (isTextBlock(b) && path === 'text') {
      change('blocks', () => { b.text = toInline(trimRuns(before)); insertAt(t.index + 1, { type: 'paragraph', text: toInline(trimRuns(after)) }); });
      selKey = keys[t.index + 1];
      rerenderFlow();
      focusBlock(keys[t.index + 1], 'start');
      return;
    }
    if (b.type === 'heading' && path === 'text') {
      change('blocks', () => { b.text = plainOf(before); insertAt(t.index + 1, { type: 'paragraph', text: plainOf(after) }); });
      selKey = keys[t.index + 1];
      rerenderFlow();
      focusBlock(keys[t.index + 1], 'start');
      return;
    }
    const m = path.match(/^(items|text)\.(\d+)$/);
    if (m && (((b.type === 'list' || b.type === 'takeaways') && m[1] === 'items') || (b.type === 'imageText' && m[1] === 'text'))) {
      const k = Number(m[2]);
      const arr = b[m[1]];
      const empty = !inlineText(runs).trim() && !runs.some(isCiteRun);
      if (empty && b.type !== 'imageText' && k === arr.length - 1) {
        change('blocks', () => {
          if (arr.length > 1) { arr.splice(k, 1); insertAt(t.index + 1, { type: 'paragraph', text: '' }); } else doc.blocks[t.index] = { type: 'paragraph', text: '' };
        });
        const key = arr.length >= 1 && doc.blocks[t.index].type !== 'paragraph' ? keys[t.index + 1] : keys[t.index];
        selKey = key;
        rerenderFlow();
        focusBlock(key, 'start');
        return;
      }
      change('blocks', () => { arr[k] = toInline(trimRuns(before)); arr.splice(k + 1, 0, toInline(trimRuns(after))); });
      renderBlock(t.key);
      focusPath(t.key, `${m[1]}.${k + 1}`, 'start');
      return;
    }
    const fq = path.match(/^items\.(\d+)\.(q|a)$/);
    if (b.type === 'faq' && fq) {
      const k = Number(fq[1]);
      if (fq[2] === 'q') { focusPath(t.key, `items.${k}.a`, 'start'); return; }
      change('blocks', () => b.items.splice(k + 1, 0, { q: '', a: '' }));
      renderBlock(t.key);
      focusPath(t.key, `items.${k + 1}.q`, 'start');
      return;
    }
    const tc = path.match(/^(?:header\.(\d+)|rows\.(\d+)\.(\d+))$/);
    if (b.type === 'table' && tc) {
      const c = Number(tc[1] ?? tc[3]);
      const r = tc[1] != null ? -1 : Number(tc[2]);
      if (r + 1 >= b.rows.length) {
        change('blocks', () => b.rows.push(Array(b.header.length).fill('')));
        renderBlock(t.key);
      }
      focusPath(t.key, `rows.${r + 1}.${c}`, 'start');
      return;
    }
    nextField(f);
  }
  function onBackspaceAtStart(f) {
    const t = targetOf(f);
    if (!t || t.key === 'doc') return false;
    const b = t.obj;
    const path = f.dataset.f;
    const empty = !f.textContent && !f.querySelector('sup');
    if (isTextBlock(b) && path === 'text') {
      const prev = doc.blocks[t.index - 1];
      const prevKey = keys[t.index - 1];
      if (isTextBlock(prev) || (prev && prev.type === 'heading')) {
        const cur = domToRuns(f);
        const prevRuns = prev.type === 'heading' ? [{ t: prev.text || '' }] : runsOf(prev.text);
        const at = runsLen(prevRuns);
        change('blocks', () => {
          if (prev.type === 'heading') prev.text = `${prev.text || ''}${inlineText(cur)}`.replace(/\s+/g, ' ').trim();
          else prev.text = toInline([...prevRuns, ...cur]);
          removeAt(t.index);
        });
        selKey = prevKey;
        rerenderFlow();
        focusPath(prevKey, 'text', at);
        return true;
      }
      if (empty && doc.blocks.length > 1) {
        const to = prevKey || keys[t.index + 1];
        change('blocks', () => removeAt(t.index));
        selKey = to;
        rerenderFlow();
        focusBlock(to, 'end');
        return true;
      }
      return false;
    }
    if (b.type === 'heading' && path === 'text' && empty) {
      change('blocks', () => { doc.blocks[t.index] = { type: 'paragraph', text: '' }; });
      renderBlock(t.key);
      focusPath(t.key, 'text', 0);
      return true;
    }
    const m = path.match(/^(items|text)\.(\d+)$/);
    if (m && ['list', 'takeaways', 'imageText'].includes(b.type)) {
      const k = Number(m[2]);
      const arr = b[m[1]];
      if (k > 0) {
        const prevRuns = runsOf(arr[k - 1]);
        const at = runsLen(prevRuns);
        change('blocks', () => { arr[k - 1] = toInline([...prevRuns, ...domToRuns(f)]); arr.splice(k, 1); });
        renderBlock(t.key);
        focusPath(t.key, `${m[1]}.${k - 1}`, at);
        return true;
      }
      if (b.type === 'list' && arr.length === 1 && empty) {
        change('blocks', () => { doc.blocks[t.index] = { type: 'paragraph', text: '' }; });
        renderBlock(t.key);
        focusPath(t.key, 'text', 0);
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------- paste
  function onPaste(e) {
    const f = e.target.closest && e.target.closest('[data-f]');
    if (!f || !f.isContentEditable || !page.contains(f)) return;
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    const html = cd ? cd.getData('text/html') : '';
    const text = cd ? cd.getData('text/plain') : '';
    // a spreadsheet range (Sheets/Excel/Numbers paste TSV) into a table cell fills the grid from that cell
    const tt = targetOf(f);
    if (tt && tt.obj && tt.obj.type === 'table' && /^(?:header\.\d+|rows\.\d+\.\d+)$/.test(f.dataset.f)
      && (text.includes('\t') || /<table[\s>]/i.test(html)) && /[\t\n]/.test(text.replace(/\s+$/, ''))) {
      pasteGrid(f, tt, text);
      return;
    }
    if (f.dataset.kind !== 'rich') {
      const clean = String(text || '').replace(/\s+/g, ' ');
      if (!clean) return;
      if (!document.execCommand('insertText', false, clean)) {
        const sel = document.getSelection();
        if (!sel.rangeCount) return;
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const node = document.createTextNode(clean);
        r.insertNode(node);
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        onInput({ target: f });
      }
      return;
    }
    let pieces = html ? sanitizeHtml(html) : [];
    if (!pieces.length && text) pieces = piecesFromText(text);
    if (pieces.length) insertPieces(f, pieces);
  }
  function pasteGrid(f, t, text) {
    const b = t.obj;
    const m = f.dataset.f.match(/^(?:header\.(\d+)|rows\.(\d+)\.(\d+))$/);
    const r0 = m[1] != null ? -1 : Number(m[2]);
    const c0 = Number(m[1] ?? m[3]);
    const grid = String(text).replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')
      .map((l) => l.split('\t').map((c) => c.replace(/\s+/g, ' ').trim()));
    const width = Math.min(6, Math.max(b.header.length, c0 + Math.max(...grid.map((r) => r.length))));
    const lost = grid.some((r) => c0 + r.length > 6);
    change('blocks', () => {
      while (b.header.length < width) { b.header.push(''); b.rows.forEach((row) => row.push('')); }
      grid.forEach((cells, i) => {
        const r = r0 + i;
        while (r >= 0 && b.rows.length <= r) b.rows.push(Array(b.header.length).fill(''));
        cells.forEach((v, j) => {
          const c = c0 + j;
          if (c >= b.header.length) return;
          if (r < 0) b.header[c] = v;
          else b.rows[r][c] = v;
        });
      });
    });
    lastCell = null;
    renderBlock(t.key);
    const lr = r0 + grid.length - 1;
    const lc = Math.min(b.header.length - 1, c0 + grid[grid.length - 1].length - 1);
    focusPath(t.key, lr < 0 ? `header.${lc}` : `rows.${lr}.${lc}`, 'end');
    announce(`Pasted ${grid.length} ${grid.length === 1 ? 'row' : 'rows'} into the table${lost ? ' — columns past the sixth were left out' : ''}`);
  }
  function piecesToBlocks(pieces, seenH2) {
    const out = [];
    let h2 = seenH2;
    for (const p of pieces) {
      if (p.kind === 'li') {
        const last = out[out.length - 1];
        const style = p.style === 'number' ? 'number' : 'bullet';
        if (last && last.type === 'list' && last.style === style && last.open) last.items.push(toInline(p.runs));
        else out.push({ type: 'list', style, items: [toInline(p.runs)], open: true });
        continue;
      }
      if (out.length && out[out.length - 1].open) delete out[out.length - 1].open;
      if (p.kind === 'h2' || p.kind === 'h3') {
        const level = p.kind === 'h3' && h2 ? 3 : 2;
        if (level === 2) h2 = true;
        out.push({ type: 'heading', level, text: inlineText(p.runs).replace(/\s+/g, ' ').trim() });
      } else out.push({ type: 'paragraph', text: toInline(p.runs) });
    }
    for (const b of out) delete b.open;
    return out;
  }
  function insertPieces(f, pieces) {
    const t = targetOf(f);
    if (!t) return;
    const path = f.dataset.f;
    const len = lenOf(f);
    const o = getOffsets(f) || { start: len, end: len };
    const [before, , after] = rangeRuns(domToRuns(f), o.start, o.end);
    const b = t.key === 'doc' ? null : t.obj;
    const m = path.match(/^(items|text)\.(\d+)$/);
    const multiText = isTextBlock(b) && path === 'text';
    const multiItems = b && m && ((['list', 'takeaways'].includes(b.type) && m[1] === 'items') || (b.type === 'imageText' && m[1] === 'text'));
    if (pieces.length === 1 && pieces[0].kind !== 'li' && !(multiText && /^h/.test(pieces[0].kind) && !runsLen(before) && !runsLen(after)) || (!multiText && !multiItems)) {
      const joined = pieces.flatMap((p, k) => (k ? [{ t: ' ' }, ...p.runs] : p.runs));
      const runs = normRuns([...before, ...joined, ...after]);
      const caret = runsLen(before) + runsLen(joined);
      runsToDom(f, runs, doc.references);
      change(topOf(t, path), () => setPath(t.obj, path, toInline(trimRuns(runs)), f.hasAttribute('data-opt')));
      setOffsets(f, caret);
      return;
    }
    if (multiItems) {
      const k = Number(m[2]);
      const arr = b[m[1]];
      const items = pieces.map((p) => p.runs.slice());
      const lastLen = runsLen(items[items.length - 1]);
      items[0] = [...before, ...items[0]];
      items[items.length - 1] = [...items[items.length - 1], ...after];
      change('blocks', () => arr.splice(k, 1, ...items.map((r) => toInline(trimRuns(r)))));
      renderBlock(t.key);
      focusPath(t.key, `${m[1]}.${k + items.length - 1}`, items.length === 1 ? runsLen(before) + lastLen : lastLen);
      return;
    }
    const seenH2 = doc.blocks.slice(0, t.index + 1).some((x) => x.type === 'heading' && x.level !== 3);
    const blocks = piecesToBlocks(pieces, seenH2);
    let focusKey = null;
    let focusAt = 'end';
    change('blocks', () => {
      let at = t.index;
      if (blocks[0] && blocks[0].type === 'paragraph') {
        b.text = toInline(trimRuns([...before, ...runsOf(blocks.shift().text)]));
      } else b.text = toInline(trimRuns(before));
      const last = blocks[blocks.length - 1];
      if (runsLen(after)) {
        if (last && last.type === 'paragraph') {
          focusAt = runsLen(trimRuns(runsOf(last.text)));
          last.text = toInline(trimRuns([...runsOf(last.text), ...after]));
        } else blocks.push({ type: 'paragraph', text: toInline(trimRuns(after)) });
      }
      const dropCurrent = !inlineText(b.text).trim() && !runsOf(b.text).some(isCiteRun) && blocks.length;
      blocks.forEach((nb, j) => insertAt(at + 1 + j, nb));
      focusKey = blocks.length ? keys[at + blocks.length] : keys[at];
      if (dropCurrent) { removeAt(at); at -= 1; }
      if (!blocks.length) focusAt = runsLen(trimRuns(runsOf(b.text)));
    });
    selKey = focusKey;
    rerenderFlow();
    focusBlock(focusKey, focusAt);
    announce(`Pasted ${pieces.length} paragraphs`);
  }

  // ---------------------------------------------------- selection toolbar
  let selState = null;
  function captureSel(f) {
    const o = getOffsets(f);
    if (!o) return false;
    selState = { f, start: Math.min(o.start, o.end), end: Math.max(o.start, o.end), title: f.dataset.f === 'title' && !!f.closest('.bed-head') };
    return true;
  }
  function onSelectionChange() {
    if (destroyed || drag) return;
    if (pendingMark) {
      const s = document.getSelection();
      const o = s && s.rangeCount && s.isCollapsed && pendingMark.f.contains(s.anchorNode) ? getOffsets(pendingMark.f) : null;
      if (!o || o.start !== pendingMark.end) pendingMark = null;
    }
    if (!pop.hidden && pop.contains(document.activeElement)) return;
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) {
      if (!tb.contains(document.activeElement) && pop.hidden) hideToolbar();
      return;
    }
    const r = sel.getRangeAt(0);
    const c = r.commonAncestorContainer;
    const node = c.nodeType === 1 ? c : c.parentElement;
    const f = node && node.closest('[data-f]');
    if (!f || !page.contains(f) || !f.isContentEditable) { hideToolbar(); return; }
    const isTitle = f.dataset.f === 'title' && !!f.closest('.bed-head');
    if (f.dataset.kind !== 'rich' && !isTitle) { hideToolbar(); return; }
    if (!captureSel(f) || selState.start === selState.end) { hideToolbar(); return; }
    showToolbar(r.getBoundingClientRect());
  }
  function tbBtn(icon, label, act, pressed, { text, title } = {}) {
    return el('button', { type: 'button', class: `bed-tb__btn${text ? ' has-text' : ''}`, 'data-tb': act, 'aria-label': label,
      'aria-pressed': pressed === undefined ? false : String(!!pressed), title: title || label }, svg(icon), text ? el('span', { text }) : null);
  }
  function showToolbar(rect) {
    tb.textContent = '';
    if (selState.title) {
      tb.append(tbBtn('accent', 'Set these words in accent italic', 'accent', undefined, { text: 'Accent' }));
      if ((doc.titleAccent || '').trim()) tb.append(tbBtn('close', 'Remove the accent', 'accent-clear', undefined, { text: 'Clear' }));
    } else {
      const runs = domToRuns(selState.f);
      const { start, end } = selState;
      const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      const mk = mac ? '⌘' : 'Ctrl+';
      tb.append(tbBtn('bold', 'Bold', 'b', markState(runs, start, end, 'b'), { title: `Bold (${mk}B)` }),
        tbBtn('italic', 'Italic', 'i', markState(runs, start, end, 'i'), { title: `Italic (${mk}I)` }),
        tbBtn('highlight', 'Highlight', 'hl', markState(runs, start, end, 'hl'), { title: `Highlight (${mk}${mac ? '⇧' : 'Shift+'}H)` }),
        el('span', { class: 'bed-tb__sep', 'aria-hidden': 'true' }),
        tbBtn('link', 'Link', 'link', !!markState(runs, start, end, 'href'), { title: `Link (${mk}K)` }),
        tbBtn('cite', 'Cite a reference', 'cite', undefined, { text: 'Cite' }));
    }
    tb.hidden = false;
    place(tb, rect);
  }
  function hideToolbar() {
    tb.hidden = true;
  }
  function place(node, rect, gapPx = 10) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const w = node.offsetWidth;
    const hgt = node.offsetHeight;
    let top = coarse ? rect.bottom + gapPx + 14 : rect.top - hgt - gapPx;
    if (top < 8) top = rect.bottom + gapPx;
    if (top + hgt > innerHeight - 8) top = Math.max(8, rect.top - hgt - gapPx);
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
  }
  // ⌘B / ⌘I / ⌘⇧H with a collapsed caret: the marks apply to whatever is typed next, until the caret moves.
  let pendingMark = null; // { f, at, end, set: { b, i, hl } }
  const MARK_NAMES = { b: 'Bold', i: 'Italic', hl: 'Highlight' };
  function togglePendingMark(f, at, mark) {
    if (pendingMark && pendingMark.f === f && pendingMark.at === at && pendingMark.end === at) {
      pendingMark.set[mark] = !pendingMark.set[mark];
    } else {
      const runs = domToRuns(f);
      const set = {};
      for (const m of MARKS) set[m] = at > 0 ? !!markState(runs, at - 1, at, m) : false;
      set[mark] = !set[mark];
      pendingMark = { f, at, end: at, set };
    }
    announce(`${MARK_NAMES[mark]} ${pendingMark.set[mark] ? 'on' : 'off'}`);
  }
  function applyPendingMark(f) {
    const o = getOffsets(f);
    if (!o || o.start !== o.end || o.start < pendingMark.at) { pendingMark = null; return; }
    if (o.start === pendingMark.at) { pendingMark.end = o.start; return; }
    let runs = domToRuns(f);
    for (const m of MARKS) runs = applyMark(runs, pendingMark.at, o.start, m, pendingMark.set[m]);
    runsToDom(f, runs, doc.references);
    setOffsets(f, o.start);
    pendingMark.end = o.start;
  }
  function commitRich(f, runs) {
    const t = targetOf(f);
    if (!t) return;
    const path = f.dataset.f;
    runsToDom(f, runs, doc.references);
    change(topOf(t, path), () => setPath(t.obj, path, toInline(trimRuns(runs)), f.hasAttribute('data-opt')));
  }
  function toggleMark(mark) {
    if (!selState || !selState.f.isConnected || selState.start === selState.end) return;
    const { f, start, end } = selState;
    commitRich(f, applyMark(domToRuns(f), start, end, mark));
    f.focus({ preventScroll: true });
    setOffsets(f, start, end);
    onSelectionChange();
  }
  function openPop(title) {
    pop.hidden = false;
    pop.setAttribute('aria-label', title);
    const anchor = tb.hidden ? selState.f.getBoundingClientRect() : tb.getBoundingClientRect();
    const coarse = matchMedia('(pointer: coarse)').matches;
    const w = pop.offsetWidth;
    let top = anchor.bottom + 8;
    if (top + pop.offsetHeight > innerHeight - 8 && !coarse) top = Math.max(8, anchor.top - pop.offsetHeight - 8);
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(anchor.left + anchor.width / 2 - w / 2, innerWidth - w - 8)))}px`;
  }
  function closePop(restore) {
    if (pop.hidden) return;
    pop.hidden = true;
    pop.textContent = '';
    if (restore && selState && selState.f.isConnected) {
      selState.f.focus({ preventScroll: true });
      setOffsets(selState.f, selState.start, selState.end);
    }
  }
  const popWarn = () => el('p', { class: 'bed-warn', role: 'alert', hidden: true });
  const showPopWarn = (w, msg) => { w.hidden = false; w.textContent = ''; w.append(svg('warn'), el('span', { text: msg })); };
  function openLink() {
    if (!selState || selState.start === selState.end) return;
    const { f, start, end } = selState;
    const cur = markState(domToRuns(f), start, end, 'href');
    pop.textContent = '';
    const inp = el('input', { class: 'bed-input', type: 'text', placeholder: 'https://…  ·  blog/post-address/  ·  #section', 'aria-label': 'Link address', spellcheck: 'false', autocomplete: 'off', inputmode: 'url' });
    inp.value = cur || '';
    const err = popWarn();
    const form = el('form', { class: 'bed-pop__form' }, inp,
      el('div', { class: 'bed-pop__row' }, el('button', { type: 'submit', class: 'bed-btn bed-btn--primary' }, cur ? 'Update link' : 'Add link'),
        cur ? el('button', { type: 'button', class: 'bed-btn bed-btn--text', 'data-pop': 'unlink' }, 'Remove link') : null,
        el('button', { type: 'button', class: 'bed-btn bed-btn--text', 'data-pop': 'cancel' }, 'Cancel')), err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const r = normalizeHref(inp.value);
      if (r.error) { showPopWarn(err, r.error); inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
      applyLink(r.href);
    });
    pop.append(el('p', { class: 'bed-pop__title', text: cur ? 'Edit link' : 'Link' }), form);
    openPop('Link');
    inp.focus();
    inp.select();
  }
  function applyLink(href) {
    if (!selState) return;
    const { f, start, end } = selState;
    commitRich(f, applyMark(domToRuns(f), start, end, 'href', href || false));
    closePop(false);
    f.focus({ preventScroll: true });
    setOffsets(f, start, end);
    announce(href ? 'Link added' : 'Link removed');
  }
  const nextRefId = () => {
    const ids = new Set(doc.references.map((r) => r.id));
    let n = 1;
    while (ids.has(`r${n}`)) n++;
    return `r${n}`;
  };
  function openCite() {
    if (!selState) return;
    pop.textContent = '';
    const list = el('div', { class: 'bed-pop__list', role: 'group', 'aria-label': 'References' });
    doc.references.forEach((r, k) => list.append(el('button', { type: 'button', class: 'bed-pop__ref', 'data-pop': 'cite', 'data-id': r.id },
      el('span', { class: 'bed-pop__n', text: String(k + 1) }), el('span', { class: 'bed-pop__rt', text: r.text || 'Untitled reference' }))));
    const text = el('input', { class: 'bed-input', type: 'text', placeholder: 'Author, title, source, year', 'aria-label': 'New reference' });
    const url = el('input', { class: 'bed-input bed-input--sm', type: 'url', placeholder: 'https:// link (optional)', 'aria-label': 'New reference link', autocomplete: 'off' });
    const err = popWarn();
    const form = el('form', { class: 'bed-pop__form' }, el('p', { class: 'bed-pop__sub', text: doc.references.length ? 'Or add a new reference' : 'Add the source for this' }), text, url,
      el('div', { class: 'bed-pop__row' }, el('button', { type: 'submit', class: 'bed-btn bed-btn--primary' }, 'Add and cite'),
        el('button', { type: 'button', class: 'bed-btn bed-btn--text', 'data-pop': 'cancel' }, 'Cancel')), err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (blank(text.value)) { showPopWarn(err, 'Describe the source first.'); text.focus(); return; }
      const u = url.value.trim();
      if (u && !/^https:\/\/[^\s<>"]+$/.test(u)) { showPopWarn(err, 'Links must start with https://'); url.focus(); return; }
      const id = nextRefId();
      change('references', () => doc.references.push(u ? { id, text: text.value.trim(), url: u } : { id, text: text.value.trim() }));
      insertCite(id);
    });
    pop.append(el('p', { class: 'bed-pop__title', text: 'Cite a reference' }), doc.references.length ? list : null, form);
    openPop('Cite a reference');
    (list.querySelector('button') || text).focus();
  }
  function insertCite(id) {
    if (!selState || !selState.f.isConnected) return;
    const { f, end } = selState;
    const [a, c] = splitRuns(domToRuns(f), end);
    commitRich(f, normRuns([...a, { cite: id }, ...c]));
    closePop(false);
    hideToolbar();
    rerenderRefs();
    f.focus({ preventScroll: true });
    setOffsets(f, end + 1);
    const k = doc.references.findIndex((r) => r.id === id);
    announce(`Citation ${k + 1} added`);
  }
  function setAccent() {
    if (!selState) return;
    const { f, start, end } = selState;
    const dom = f.textContent;
    const word = /[\p{L}\p{M}\p{N}_'’-]/u;
    let s = start;
    let e = end;
    while (s > 0 && word.test(dom[s - 1])) s--;
    while (e < dom.length && word.test(dom[e])) e++;
    const phrase = dom.slice(s, e).replace(/\s+/g, ' ').trim();
    if (!phrase) return;
    change('titleAccent', () => { doc.titleAccent = phrase; });
    paintTitle(f);
    updateAccentNote();
    hideToolbar();
    announce(`Accent set on “${phrase}”`);
  }
  function clearAccent() {
    change('titleAccent', () => { doc.titleAccent = ''; });
    const t = headEl.querySelector('.bed-title');
    if (t) paintTitle(t);
    updateAccentNote();
    hideToolbar();
    announce('Accent removed');
  }

  // ------------------------------------------------------------ inserter
  let menuCtx = null;
  function openMenu(ctx) {
    menuCtx = ctx;
    menu.textContent = '';
    const search = el('input', { class: 'bed-input bed-menu__search', type: 'search', placeholder: 'Filter blocks…', 'aria-label': 'Filter blocks', autocomplete: 'off', spellcheck: 'false' });
    const body = el('div', { class: 'bed-menu__body' });
    menu.append(el('div', { class: 'bed-menu__head' }, el('p', { class: 'bed-menu__title', text: ctx.replaceKey ? 'Turn this paragraph into' : 'Add a block' }),
      iconBtn('close', 'Close', { 'data-menu': 'close' })), search, body);
    const paint = () => {
      body.textContent = '';
      const q = search.value.trim().toLowerCase();
      let any = false;
      for (const [g, types] of GROUPS) {
        const items = types.filter((t) => !(ctx.replaceKey && t === 'paragraph')).filter((t) => !q || labelOf(t).toLowerCase().includes(q) || HINTS[t].toLowerCase().includes(q) || t.toLowerCase().includes(q));
        if (!items.length) continue;
        any = true;
        body.append(el('p', { class: 'bed-menu__group', text: g }), el('div', { class: 'bed-menu__grid', role: 'group', 'aria-label': g },
          items.map((t) => el('button', { type: 'button', class: 'bed-menu__item', 'data-insert': t },
            el('span', { class: 'bed-menu__ic' }, svg(t)), el('span', { class: 'bed-menu__name', text: labelOf(t) }), el('span', { class: 'bed-menu__hint', text: HINTS[t] })))));
      }
      if (!any) body.append(el('p', { class: 'bed-help', text: 'No block matches that.' }));
      const first = body.querySelector('[data-insert]');
      if (first) first.classList.add('is-active');
      if (!menu.hidden) placeMenu();
    };
    search.addEventListener('input', paint);
    paint();
    menu.hidden = false;
    const sheet = matchMedia('(max-width: 600px)').matches;
    menu.classList.toggle('is-sheet', sheet);
    if (!sheet) placeMenu();
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse && !ctx.slash) { const first = body.querySelector('[data-insert]'); if (first) first.focus({ preventScroll: true }); } else search.focus({ preventScroll: true });
  }
  function placeMenu() {
    if (!menuCtx || !menuCtx.anchor || !menuCtx.anchor.isConnected || menu.classList.contains('is-sheet')) return;
    const r = menuCtx.anchor.getBoundingClientRect();
    const body = menu.querySelector('.bed-menu__body');
    const st = body ? body.scrollTop : 0; // re-measuring must not lose the list's scroll position
    menu.style.maxHeight = '';
    const w = menu.offsetWidth;
    const hgt = menu.offsetHeight;
    // below the anchor, else above; when neither fits, the roomier side with a scrolling body — never over the anchor
    const below = innerHeight - r.bottom - 16;
    const above = r.top - 16;
    let top;
    if (hgt <= below || (hgt > above && below >= above)) {
      top = r.bottom + 8;
      if (hgt > below) menu.style.maxHeight = `${Math.max(220, below)}px`;
    } else {
      const h = Math.min(hgt, above);
      if (hgt > above) menu.style.maxHeight = `${Math.max(220, above)}px`;
      top = Math.max(8, r.top - h - 8);
    }
    const left = Math.max(8, Math.min(menuCtx.slash ? r.left : r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    if (body) body.scrollTop = st;
  }
  function closeMenu(restore) {
    if (menu.hidden) return;
    const ctx = menuCtx;
    menu.hidden = true;
    menu.textContent = '';
    menu.style.maxHeight = '';
    menuCtx = null;
    if (restore && ctx && ctx.anchor && ctx.anchor.isConnected) {
      if (ctx.anchor.isContentEditable) focusField(ctx.anchor, 'end');
      else ctx.anchor.focus();
    }
  }
  function menuKeys(e) {
    const items = [...menu.querySelectorAll('[data-insert]')];
    const search = menu.querySelector('.bed-menu__search');
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Enter' && e.target === search) {
      e.preventDefault();
      if (items[0]) chooseBlock(items[0].dataset.insert);
      return;
    }
    let next = null;
    if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && i >= 0)) next = i < 0 ? 0 : Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && i >= 0)) next = i <= 0 ? -1 : i - 1;
    else if (e.key === 'Tab' && !e.shiftKey && i === items.length - 1) { e.preventDefault(); search.focus(); return; }
    else return;
    e.preventDefault();
    for (const it of items) it.classList.remove('is-active');
    if (next === -1) { search.focus(); if (items[0]) items[0].classList.add('is-active'); return; }
    if (items[next]) { items[next].classList.add('is-active'); items[next].focus(); items[next].scrollIntoView({ block: 'nearest' }); }
  }
  function chooseBlock(type) {
    const ctx = menuCtx;
    closeMenu(false);
    if (!ctx) return;
    const nb = newBlock(type, films);
    let key;
    if (ctx.replaceKey && keys.includes(ctx.replaceKey)) {
      const i = keys.indexOf(ctx.replaceKey);
      change('blocks', () => { doc.blocks[i] = nb; });
      key = ctx.replaceKey;
    } else {
      const at = Math.max(0, Math.min(Number(ctx.at) || 0, doc.blocks.length));
      change('blocks', () => insertAt(at, nb));
      key = keys[at];
    }
    selKey = key;
    rerenderFlow();
    focusBlock(key, 'start');
    announce(`${labelOf(type)} added`);
  }

  // ------------------------------------------------------- block actions
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function select(key) {
    if (key === selKey && (!key || (wrapOf(key) && wrapOf(key).querySelector(':scope > .bed-strip')))) return;
    const prev = selKey && wrapOf(selKey);
    if (prev) {
      prev.classList.remove('is-selected');
      const s = prev.querySelector(':scope > .bed-strip');
      if (s) s.remove();
    }
    selKey = key;
    const w = key && wrapOf(key);
    if (w) {
      const i = keys.indexOf(key);
      w.classList.add('is-selected');
      w.append(stripOf(doc.blocks[i], i));
    }
  }
  function moveBlock(from, to, o = {}) {
    if (from < 0 || to < 0 || to >= doc.blocks.length || to === from) return;
    const key = keys[from];
    change('blocks', () => {
      const [b] = doc.blocks.splice(from, 1);
      const [k] = keys.splice(from, 1);
      doc.blocks.splice(to, 0, b);
      keys.splice(to, 0, k);
    });
    selKey = key;
    rerenderFlow();
    const w = wrapOf(key);
    let target = w.querySelector('.bed-handle--strip');
    if (o.focus === 'move') {
      const b = w.querySelector(`[data-act="move"][data-d="${o.d}"]`);
      if (b && !b.disabled) target = b;
    }
    if (target) target.focus({ preventScroll: true });
    w.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    announce(`${labelOf(doc.blocks[to].type)} moved to position ${to + 1} of ${doc.blocks.length}`);
  }
  function dupBlock(i) {
    change('blocks', () => insertAt(i + 1, clone(doc.blocks[i])));
    selKey = keys[i + 1];
    rerenderFlow();
    focusBlock(keys[i + 1], 'end');
    announce(`${labelOf(doc.blocks[i].type)} duplicated`);
  }
  function delBlock(i) {
    const type = doc.blocks[i].type;
    const near = keys[i + 1] || keys[i - 1];
    change('blocks', () => {
      removeAt(i);
      if (!doc.blocks.length) insertAt(0, { type: 'paragraph', text: '' });
    });
    selKey = null;
    rerenderFlow();
    focusBlock(keys.includes(near) ? near : keys[0], i > 0 && near === keys[i - 1] ? 'end' : 'start');
    showToast(`${labelOf(type)} deleted`, true);
    announce(`${labelOf(type)} deleted. Press Control Z or Command Z to undo.`);
  }
  function setProp(t, prop, raw) {
    if (!t) return;
    if (t.key === 'doc') {
      if (doc[prop] === raw) return;
      change(prop, () => { doc[prop] = raw; });
      root.dataset.title = doc.titleSize;
      root.dataset.body = doc.bodySize;
      root.dataset.leadin = doc.leadIn;
      renderTypo();
      const chip = typePanel.querySelector(`[data-prop="${prop}"][data-val="${CSS.escape(raw)}"]`);
      if (chip) chip.focus({ preventScroll: true });
      return;
    }
    const b = doc.blocks[t.index];
    const val = prop === 'level' ? Number(raw) : raw;
    if (b[prop] === val || (b.type === 'heading' && prop === 'size' && val === 'M' && !b.size)) return;
    change('blocks', () => {
      if (b.type === 'heading' && prop === 'size' && val === 'M') delete b.size;
      else b[prop] = val;
      if (b.type === 'image') {
        if (prop === 'width' && val !== 'column') { b.align = 'center'; delete b.size; }
        if (prop === 'align' && val === 'center') delete b.size;
        if (prop === 'align' && val !== 'center' && !b.size) b.size = 'M';
      }
      if (b.type === 'video' && prop === 'source') {
        if (val === 'film') { delete b.youtube; if (b.src === undefined) b.src = ''; } else { delete b.src; if (b.youtube === undefined) b.youtube = ''; }
      }
    });
    renderBlock(t.key);
    restoreFocus({ key: t.key, act: 'set', prop, val: String(val) });
  }
  function tableOp(t, op) {
    const b = t.obj;
    const cols = b.header.length;
    const cell = lastCell && lastCell.key === t.key ? lastCell.path.match(/^(?:rows\.(\d+)\.(\d+)|header\.(\d+))$/) : null;
    const r = cell && cell[1] != null ? Number(cell[1]) : null;
    const c = cell ? Number(cell[2] ?? cell[3]) : null;
    change('blocks', () => {
      if (op === 'row+') b.rows.splice(r == null ? b.rows.length : r + 1, 0, Array(cols).fill(''));
      if (op === 'row-' && b.rows.length > 1) b.rows.splice(r == null || r >= b.rows.length ? b.rows.length - 1 : r, 1);
      if (op === 'col+' && cols < 6) { const at = c == null ? cols : c + 1; b.header.splice(at, 0, ''); b.rows.forEach((row) => row.splice(at, 0, '')); }
      if (op === 'col-' && cols > 1) { const at = c == null || c >= cols ? cols - 1 : c; b.header.splice(at, 1); b.rows.forEach((row) => row.splice(at, 1)); }
    });
    lastCell = null;
    renderBlock(t.key);
    restoreFocus({ key: t.key, act: 'table', val: op });
  }
  function stripCites(id) {
    doc.blocks = mapRunArrays(doc.blocks, (runs) => toInline(runs.filter((r) => !(isCiteRun(r) && r.cite === id))));
  }
  function refAction(act, k) {
    const refs = doc.references;
    if (act === 'ref-add') {
      change('references', () => refs.push({ id: nextRefId(), text: '' }));
      rerenderRefs();
      const n = [...refsEl.querySelectorAll('textarea[data-f]')].pop();
      if (n) n.focus();
      return;
    }
    if (act === 'ref-move') return;
    if (act === 'ref-del') {
      const id = refs[k].id;
      if ((citeCounts(doc.blocks).get(id) || 0) > 0) {
        pendingRefDelete = id;
        rerenderRefs();
        const y = refsEl.querySelector('[data-act="ref-del-yes"]');
        if (y) y.focus();
        return;
      }
      change('references', () => refs.splice(k, 1));
      rerenderRefs();
      announce('Reference deleted');
      return;
    }
    if (act === 'ref-del-yes') {
      const id = refs[k].id;
      change(['references', 'blocks'], () => { refs.splice(k, 1); stripCites(id); });
      pendingRefDelete = null;
      rerenderFlow();
      announce('Reference and its citations deleted');
      return;
    }
    if (act === 'ref-del-no') {
      pendingRefDelete = null;
      rerenderRefs();
    }
  }
  function moveRef(k, d) {
    const j = k + d;
    if (j < 0 || j >= doc.references.length) return;
    change('references', () => { const [r] = doc.references.splice(k, 1); doc.references.splice(j, 0, r); });
    rerenderRefs();
    const b = refsEl.querySelector(`[data-act="ref-move"][data-k="${j}"][data-d="${d}"]`) || refsEl.querySelector(`[data-act="ref-move"][data-k="${j}"]`);
    if (b && !b.disabled) b.focus();
    announce(`Reference moved to number ${j + 1}`);
  }
  function setFocal(x, y) {
    if (!doc.cover) return;
    const c = (n) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
    change('cover', () => { doc.cover.focal = { x: c(x), y: c(y) }; }, 'focal');
    const dot = headEl.querySelector('.bed-focal');
    if (dot) { dot.style.left = `${doc.cover.focal.x * 100}%`; dot.style.top = `${doc.cover.focal.y * 100}%`; }
    announce(`Focus point ${Math.round(doc.cover.focal.x * 100)}% across, ${Math.round(doc.cover.focal.y * 100)}% down`);
  }
  function nudgeFocal(key, step) {
    const f = (doc.cover && doc.cover.focal) || { x: 0.5, y: 0.5 };
    let { x, y } = f;
    if (key === 'ArrowLeft') x -= step;
    if (key === 'ArrowRight') x += step;
    if (key === 'ArrowUp') y -= step;
    if (key === 'ArrowDown') y += step;
    setFocal(x, y);
  }
  async function stageInto(node, file) {
    const t = targetOf(node);
    if (!t) return;
    const key = t.key;
    const path = node.dataset.file || '';
    const purpose = node.dataset.purpose || 'block';
    const id = `${key}|${path}`;
    if (!stageImage) { uploads.set(id, { state: 'error', message: 'Photo uploads are not available here.' }); rerenderTarget(key); return; }
    if (!/^image\//.test(file.type || '') && !/\.(heic|heif|jpe?g|png|webp|avif)$/i.test(file.name || '')) {
      uploads.set(id, { state: 'error', message: 'That file is not a photo — choose a JPG, PNG, HEIC or WebP image.' });
      rerenderTarget(key);
      return;
    }
    uploads.set(id, { state: 'busy' });
    rerenderTarget(key);
    try {
      const res = await stageImage(file, { purpose });
      if (destroyed) return;
      if (!res || typeof res.src !== 'string' || !res.src) throw new Error('The photo could not be prepared — try another file.');
      uploads.delete(id);
      pendingPatient.delete(id);
      if (key === 'doc') {
        change('cover', () => {
          if (!doc.cover) doc.cover = { src: '', alt: '', caption: '', credit: '', focal: { x: 0.5, y: 0.5 }, patient: false };
          doc.cover.src = res.src;
          doc.cover.focal = { x: 0.5, y: 0.5 };
          doc.cover.patient = false;
        });
      } else {
        const i = keys.indexOf(key);
        if (i < 0) return;
        const b = doc.blocks[i];
        change('blocks', () => {
          const img = path ? getPath(b, path) : b;
          if (img && typeof img === 'object') { img.src = res.src; if (img.patient) img.patient = false; } else setPath(b, `${path}.src`, res.src);
        });
      }
      rerenderTarget(key);
      announce('Photo added. Now describe it in the alt text.');
      focusPath(key, sub(path, 'alt'), 'end');
    } catch (err) {
      if (destroyed) return;
      uploads.set(id, { state: 'error', message: (err && err.message) || 'The photo could not be prepared — try another file.' });
      rerenderTarget(key);
    }
  }
  function patientToggle(n) {
    const t = targetOf(n);
    if (!t) return;
    const path = n.dataset.p || '';
    const id = `${t.key}|${path}`;
    const img = t.key === 'doc' ? doc.cover : (path ? getPath(t.obj, path) : t.obj);
    if (!img) return;
    const top = t.key === 'doc' ? 'cover' : 'blocks';
    const act = n.dataset.act;
    if (act === 'patient') {
      if (n.checked) pendingPatient.add(id);
      else { pendingPatient.delete(id); if (img.patient) change(top, () => { img.patient = false; }); }
    } else if (n.checked) {
      pendingPatient.delete(id);
      change(top, () => { img.patient = true; });
      announce('Marked as a patient photo, consent on file');
    } else {
      pendingPatient.add(id);
      change(top, () => { img.patient = false; });
    }
    rerenderTarget(t.key);
    const w = wrapOf(t.key);
    const back = w && [...w.querySelectorAll(`input[data-act="${act}"]`)].find((x) => (x.dataset.p || '') === path);
    // the cover's details are display:none until it holds focus — land focus inside it first or back.focus() is a no-op
    const frame = t.key === 'doc' && headEl.querySelector('.bed-cover [data-focal]');
    if (back && frame) frame.focus({ preventScroll: true });
    if (back) back.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ events
  function onClick(e) {
    const tbb = e.target.closest('[data-tb]');
    if (tbb && tb.contains(tbb)) {
      const a = tbb.dataset.tb;
      if (a === 'b' || a === 'i' || a === 'hl') toggleMark(a);
      else if (a === 'link') openLink();
      else if (a === 'cite') openCite();
      else if (a === 'accent') setAccent();
      else if (a === 'accent-clear') clearAccent();
      return;
    }
    const pb = e.target.closest('[data-pop]');
    if (pb && pop.contains(pb)) {
      const a = pb.dataset.pop;
      if (a === 'cancel') closePop(true);
      else if (a === 'unlink') applyLink(false);
      else if (a === 'cite') insertCite(pb.dataset.id);
      return;
    }
    if (e.target.closest('[data-menu="close"]')) { closeMenu(true); return; }
    const mi = e.target.closest('[data-insert]');
    if (mi && menu.contains(mi)) { chooseBlock(mi.dataset.insert); return; }
    const focal = e.target.closest('[data-focal]');
    if (focal && e.target.localName === 'img') {
      const r = e.target.getBoundingClientRect();
      setFocal((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn) || btn.disabled || btn.localName === 'input') {
      const w = e.target.closest('.bed-block');
      if (w && page.contains(w)) select(w.dataset.key);
      return;
    }
    const t = targetOf(btn);
    const act = btn.dataset.act;
    const k = Number(btn.dataset.k);
    switch (act) {
      case 'undo': toast.hidden = true; undo(); break;
      case 'redo': redo(); break;
      case 'typo': typeOpen = !typeOpen; renderTypo(); break;
      case 'set': setProp(t, btn.dataset.prop, btn.dataset.val); break;
      case 'insert': openMenu({ at: Number(btn.dataset.at), anchor: btn }); break;
      case 'move': if (t) moveBlock(t.index, t.index + Number(btn.dataset.d), { focus: 'move', d: btn.dataset.d }); break;
      case 'dup': if (t) dupBlock(t.index); break;
      case 'del': if (t) delBlock(t.index); break;
      case 'handle': if (t && t.key !== 'doc') select(t.key); break;
      case 'pick': { const slot = btn.closest('.bed-media'); const input = slot && slot.querySelector('input[type="file"]'); if (input) input.click(); break; }
      case 'cover-remove':
        change('cover', () => { doc.cover = null; });
        pendingPatient.delete('doc|cover');
        rerenderHead();
        { const add = headEl.querySelector('.bed-cover [data-act="pick"]'); if (add) add.focus(); }
        announce('Cover photo removed');
        break;
      case 'accent-clear': clearAccent(); break;
      case 'film':
        if (t && t.obj.src !== btn.dataset.val) {
          change('blocks', () => { t.obj.src = btn.dataset.val; });
          renderBlock(t.key);
          restoreFocus({ key: t.key, act: 'film', val: btn.dataset.val });
        }
        break;
      case 'table': if (t) tableOp(t, btn.dataset.val); break;
      case 'gallery-add':
        if (t && t.obj.images.length < 3) { change('blocks', () => t.obj.images.push({ src: '', alt: '' })); renderBlock(t.key); focusPath(t.key, '', 'start'); const p = wrapOf(t.key).querySelectorAll('.bed-gallery__item [data-act="pick"]'); if (p.length) p[p.length - 1].focus(); }
        break;
      case 'gallery-remove':
        if (t && t.obj.images.length > 2) { change('blocks', () => t.obj.images.splice(k, 1)); renderBlock(t.key); announce('Photo removed from the gallery'); }
        break;
      case 'faq-add':
        if (t) { change('blocks', () => t.obj.items.push({ q: '', a: '' })); renderBlock(t.key); focusPath(t.key, `items.${t.obj.items.length - 1}.q`, 'start'); }
        break;
      case 'faq-move': {
        const d = Number(btn.dataset.d);
        const items = t && t.obj.items;
        if (items && items[k + d]) {
          change('blocks', () => { const [it] = items.splice(k, 1); items.splice(k + d, 0, it); });
          renderBlock(t.key);
          const b = wrapOf(t.key).querySelector(`[data-act="faq-move"][data-k="${k + d}"][data-d="${d}"]`);
          if (b && !b.disabled) b.focus(); else focusPath(t.key, `items.${k + d}.q`, 'end');
        }
        break;
      }
      case 'faq-remove':
        if (t && t.obj.items.length > 1) { change('blocks', () => t.obj.items.splice(k, 1)); renderBlock(t.key); focusPath(t.key, `items.${Math.max(0, k - 1)}.q`, 'end'); }
        break;
      case 'ref-move': moveRef(k, Number(btn.dataset.d)); break;
      case 'ref-add': case 'ref-del': case 'ref-del-yes': case 'ref-del-no': refAction(act, k); break;
      default: break;
    }
  }
  function onChangeEvt(e) {
    const n = e.target;
    if (n.matches('input[type="file"][data-file]')) {
      const file = n.files && n.files[0];
      if (file) stageInto(n, file);
      n.value = '';
      return;
    }
    if (n.matches('input[type="checkbox"][data-act]')) patientToggle(n);
  }
  let selTimer = 0;
  function onFocusIn(e) {
    const f = e.target.closest && e.target.closest('[data-f]');
    const w = e.target.closest && e.target.closest('.bed-block');
    if (f && w && /^(rows|header)\./.test(f.dataset.f)) lastCell = { key: w.dataset.key, path: f.dataset.f };
    if (!page.contains(e.target)) return;
    const key = w ? w.dataset.key : null;
    clearTimeout(selTimer);
    // deferred: the caret lands where the pointer was before the strip moves anything
    selTimer = setTimeout(() => { if (!destroyed && (key === null || keys.includes(key))) select(key); }, 0);
  }
  function onFocusOut(e) {
    if (e.target.classList && e.target.classList.contains('bed-title')) paintTitle(e.target);
  }
  let drag = null;
  function onPointerDown(e) {
    if (tb.contains(e.target)) { e.preventDefault(); return; }
    if (!pop.hidden && !pop.contains(e.target)) closePop(false);
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-act="insert"]')) closeMenu(false);
    const hd = e.target.closest('.bed-handle');
    if (hd && e.button === 0 && page.contains(hd)) {
      const t = targetOf(hd);
      if (!t || t.key === 'doc') return;
      drag = { key: t.key, from: t.index, y0: e.clientY, id: e.pointerId, active: false, to: t.index };
      try { hd.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
    }
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active && Math.abs(e.clientY - drag.y0) < 5) return;
    if (!drag.active) {
      drag.active = true;
      hideToolbar();
      root.classList.add('is-dragging');
      const w = wrapOf(drag.key);
      if (w) w.classList.add('is-dragged');
    }
    const blocks = [...flowEl.querySelectorAll(':scope > .bed-block')];
    let to = blocks.length;
    for (let k = 0; k < blocks.length; k++) {
      const r = blocks[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { to = k; break; }
    }
    drag.to = to;
    const fr = flowEl.getBoundingClientRect();
    const ref = blocks[Math.min(to, blocks.length - 1)].getBoundingClientRect();
    const y = to < blocks.length ? ref.top - 8 : ref.bottom + 8;
    dropLine.hidden = false;
    dropLine.style.top = `${Math.round(y)}px`;
    dropLine.style.left = `${Math.round(fr.left)}px`;
    dropLine.style.width = `${Math.round(fr.width)}px`;
    if (e.clientY < 70) window.scrollBy(0, -14);
    else if (e.clientY > innerHeight - 70) window.scrollBy(0, 14);
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    dropLine.hidden = true;
    root.classList.remove('is-dragging');
    const w = wrapOf(d.key);
    if (w) w.classList.remove('is-dragged');
    if (d.active && e.type === 'pointerup') {
      const to = d.to > d.from ? d.to - 1 : d.to;
      if (to !== d.from) moveBlock(d.from, to, { focus: 'handle' });
    } else if (!d.active) select(d.key);
  }
  function onDragOver(e) {
    const slot = e.target.closest && e.target.closest('.bed-media');
    if (!slot || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    slot.classList.add('is-over');
  }
  function onDragLeave(e) {
    const slot = e.target.closest && e.target.closest('.bed-media');
    if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('is-over');
  }
  function onDrop(e) {
    const slot = e.target.closest && e.target.closest('.bed-media');
    if (!slot || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    slot.classList.remove('is-over');
    const input = slot.querySelector('input[type="file"]');
    if (input) stageInto(input, e.dataTransfer.files[0]);
  }
  function reposition() {
    if (!tb.hidden) {
      const sel = document.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed && selState && selState.f.contains(sel.anchorNode)) place(tb, sel.getRangeAt(0).getBoundingClientRect());
      else if (pop.hidden) hideToolbar();
    }
    if (!menu.hidden) placeMenu();
  }

  const listeners = [
    [root, 'input', onInput], [root, 'beforeinput', onBeforeInput], [root, 'keydown', onKeydown], [root, 'paste', onPaste],
    [root, 'click', onClick], [root, 'change', onChangeEvt], [root, 'focusin', onFocusIn], [root, 'focusout', onFocusOut],
    [root, 'pointerdown', onPointerDown], [root, 'pointermove', onPointerMove], [root, 'pointerup', onPointerUp],
    [root, 'pointercancel', onPointerUp], [root, 'dragover', onDragOver], [root, 'dragleave', onDragLeave], [root, 'drop', onDrop],
    [document, 'selectionchange', onSelectionChange], [window, 'resize', reposition], [window, 'scroll', reposition, true],
  ];
  for (const [t, ev, fn, cap] of listeners) t.addEventListener(ev, fn, cap || false);
  const onDocDown = (e) => {
    if (!root.contains(e.target)) { closeMenu(false); closePop(false); hideToolbar(); }
  };
  document.addEventListener('pointerdown', onDocDown, true);

  render();

  return {
    setPost(post) {
      flush();
      const next = pick(post);
      const sameId = !!post && post.id === postId;
      if (sameId && OWN.every((f) => same(next[f], doc[f]))) return;
      doc = next;
      seed = seedOf(post);
      pendingMark = null;
      keys = doc.blocks.map(nextKey);
      postId = post && post.id;
      selKey = null;
      pendingPatient.clear();
      uploads.clear();
      pendingRefDelete = null;
      if (!sameId) { hist.past = []; hist.future = []; hist.lastKey = null; }
      hideToolbar();
      closeMenu(false);
      closePop(false);
      render();
      emitHistory();
    },
    undo,
    redo,
    canUndo: () => hist.past.length > 0,
    canRedo: () => hist.future.length > 0,
    focus() {
      const t = headEl && headEl.querySelector('.bed-title');
      if (t && !doc.title) focusField(t, 'end');
      else focusBlock(keys[0], 'end');
    },
    destroy() {
      if (destroyed) return;
      flush();
      destroyed = true;
      clearTimeout(toastTimer);
      clearTimeout(selTimer);
      for (const [t, ev, fn, cap] of listeners) t.removeEventListener(ev, fn, cap || false);
      document.removeEventListener('pointerdown', onDocDown, true);
      root.textContent = '';
      root.classList.remove('bed', 'is-dragging');
      delete root.dataset.title;
      delete root.dataset.body;
      delete root.dataset.leadin;
    },
  };
}

// Test seam (pure helpers; no UI). Not part of the pinned contract.
export const _internals = {
  domToRuns, runsToDom, sanitizeHtml, piecesFromText, toInline, normRuns, trimRuns, applyMark, markState,
  splitRuns, normalizeHref, parseYouTube, wholeWordMatch, citeCounts, mapRunArrays, newBlock, getOffsets, setOffsets,
};
