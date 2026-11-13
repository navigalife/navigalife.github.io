// The Page tab: every heading and line of section copy on the public site, in
// page order. It edits data/content.json plus the hero fields of
// data/site-config.json (heroHeadline / heroAccent / heroSub / heroStats, which
// moved here off the Appearance tab) and its eligibility notice (heading / body
// / accent, which moved here off the Protocols tab).
//
// How it behaves:
// - Edits go into a working copy that survives tab switches; "Save page draft"
//   moves it into the in-memory draft (markDirty), exactly like the Company and
//   Appearance forms, and publish refuses while page edits are still unsaved.
// - Every rule comes from admin/content-rules.js (the validator the build runs
//   too — Lesson 13). Never re-implement one here: errors are placed at their
//   field by the validator's dot path. The hero fields (site-config.json) use
//   validateHeroDetailed, mapped onto the form by heroErrors() below.
// - publishBlock() is the pre-publish gate app.js runs before committing: it
//   validates every loaded data file the shared validator knows, changed or
//   not, and groups the errors by the tab that fixes them.
import './content-rules.js';
import { clearError, describeError } from './a11y.js';

const rules = globalThis.MediVascContentRules;

// Hero counter glyphs the site can render — the shared list template.js also
// reads (content-rules.js STAT_ICONS); an unknown value falls back to `pulse`.
const STAT_ICON_NAMES = rules.STAT_ICONS;
const STAT_ICON_LABELS = { pulse: 'Pulse', clipboard: 'Clipboard', clock: 'Clock', heart: 'Heart', shield: 'Shield', users: 'People' };
const STAT_DEFAULTS = [{ icon: 'pulse' }, { icon: 'clipboard' }, { icon: 'clock' }];

// Add/remove limits for the editable lists. These only switch the buttons off
// at the edges; content-rules.js enforces the same bounds on save and publish.
const LISTS = {
  'hero.chips': { min: 0, max: 8, noun: 'chip', blank: () => '' },
  'approach.steps': { min: 1, max: 6, noun: 'step', blank: () => ({ title: '', body: '' }) },
  'conditions.caseStats': { min: 0, max: 4, noun: 'stat', blank: () => '' },
  'watch.items': { min: 1, max: 16, noun: 'symptom', blank: () => '' },
  'chat.conditions': { min: 0, max: 6, noun: 'chip', blank: () => '' },
};

const NAV_NAMES = { recoveries: 'Recoveries', approach: 'Approach', conditions: 'Conditions', about: 'About', contact: 'Contact' };
const QUESTION_NAMES = { name: 'Name question', age: 'Age question', condition: 'Condition question', city: 'City question' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const deepTrim = (value) => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(deepTrim);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepTrim(item)]));
  return value;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The site strips one pair of quotes the owner types around the hero headline
// and adds its own (template.js, Lesson 23); the preview runs the same strip.
const stripQuotes = (value) => rules.stripHeadlineQuotes(String(value || ''));

// The validator prefixes each message with the section name for the publish
// toast; at the field the section is already obvious, so drop it there.
const fieldMessage = (message) => {
  const text = message.replace(/^[^:“]+:\s+/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// The hero's three counter tiles as the form shows them, and as the site stores
// them: a tile needs both a number and a label (clear both to drop it). An icon
// the site does not draw shows, and saves, as `pulse` — what the picker shows.
const heroFromConfig = (config) => {
  const source = Array.isArray(config.heroStats) ? config.heroStats : [];
  return {
    heroHeadline: config.heroHeadline || '',
    heroAccent: config.heroAccent || '',
    heroSub: config.heroSub || '',
    stats: [0, 1, 2].map((i) => {
      const stat = source[i] || STAT_DEFAULTS[i];
      return { icon: STAT_ICON_NAMES.includes(stat.icon) ? stat.icon : 'pulse', value: stat.value || '', label: stat.label || '' };
    }),
  };
};
// The hero rule is the shared validateHeroDetailed (the build runs it too);
// its paths become `config.<field>`, matching the form's data-page-path.
// heroErrors checks a stored config (the publish gate). formHeroErrors checks
// the working copy: the form always shows three tiles and a wholly blank one
// is hidden (heroToConfig drops it), so a blank row stands in as a filled tile
// — every other row keeps its own number and path in the messages.
const heroErrors = (config) => rules.validateHeroDetailed(config).map((error) => ({ ...error, path: 'config.' + error.path }));
const formHeroErrors = (hero) => heroErrors({
  heroHeadline: hero.heroHeadline,
  heroAccent: hero.heroAccent,
  heroSub: hero.heroSub,
  heroStats: hero.stats.map((stat) => (String(stat.value).trim() || String(stat.label).trim() ? stat : { icon: stat.icon, value: '-', label: '-' })),
});
// What the dirty check compares: every row as typed (trimmed), not the saved
// shape — heroToConfig drops a half-filled tile, so comparing that would let a
// half tile pass as "no edits" and a publish of another file drop it. A wholly
// blank row's icon is left out: it is never stored, so picking one is not an edit.
const heroForm = (hero) => ({
  heroHeadline: hero.heroHeadline.trim(),
  heroAccent: hero.heroAccent.trim(),
  heroSub: hero.heroSub.trim(),
  stats: hero.stats.map((stat) => {
    const value = String(stat.value).trim();
    const label = String(stat.label).trim();
    return value || label ? { icon: stat.icon, value, label } : null;
  }),
});
const heroToConfig = (hero) => ({
  heroHeadline: hero.heroHeadline.trim(),
  heroAccent: hero.heroAccent.trim(),
  heroSub: hero.heroSub.trim(),
  heroStats: hero.stats
    .map((stat) => ({ icon: STAT_ICON_NAMES.includes(stat.icon) ? stat.icon : 'pulse', value: stat.value.trim(), label: stat.label.trim() }))
    .filter((stat) => stat.value && stat.label),
});

// The eligibility notice's heading, text and highlighted words live in
// site-config.json (the small label above it is in content.json). The pair
// rule and the highlight check are the shared validator's validateEligibility.
const eligibilityFromConfig = (config) => {
  const source = isObject(config.eligibility) ? config.eligibility : {};
  return { heading: String(source.heading ?? ''), body: String(source.body ?? ''), accent: String(source.accent ?? '') };
};
const eligibilityToConfig = (eligibility) => ({
  heading: eligibility.heading.trim(),
  body: eligibility.body.trim(),
  accent: eligibility.accent.trim(),
});

export const createPageEditor = ({ state, root, h, icon, markDirty, showStatus, rerender }) => {
  let buf = null;

  // ------------------------------------------------------------ working copy

  const snapshot = () => JSON.stringify([deepTrim(buf.content), heroForm(buf.hero), eligibilityToConfig(buf.eligibility)]);

  const seed = () => {
    buf = {
      content: structuredClone(state.draft.content || {}),
      hero: heroFromConfig(state.draft.config || {}),
      eligibility: eligibilityFromConfig(state.draft.config || {}),
      sourceContent: state.draft.content,
      sourceConfig: state.draft.config,
      open: buf ? buf.open : new Set(),
      pending: new Set(), // just-added list rows: no "empty" error until touched
      tried: false, // a save was attempted with errors showing
    };
    buf.baseline = snapshot();
  };

  // A reload (or lock and unlock) swaps the draft objects; start over from them.
  const ensure = () => {
    if (!buf || buf.sourceContent !== state.draft.content || buf.sourceConfig !== state.draft.config) seed();
  };

  const hasUnsavedEdits = () => Boolean(state.loaded && buf
    && buf.sourceContent === state.draft.content && buf.sourceConfig === state.draft.config
    && snapshot() !== buf.baseline);

  // Paths: content.json dot paths as the validator reports them, plus
  // `config.<field>` for the hero fields that live in site-config.json and
  // `config.eligibility.<field>` for the eligibility notice there.
  const ELIGIBILITY_PATH = 'config.eligibility.';
  const locate = (path) => {
    if (path.startsWith(ELIGIBILITY_PATH)) return [buf.eligibility, path.slice(ELIGIBILITY_PATH.length)];
    return path.startsWith('config.')
      ? [buf.hero, path.slice(7).replace(/^heroStats\b/, 'stats')]
      : [buf.content, path];
  };
  const get = (path) => {
    const [base, rest] = locate(path);
    return rest.split('.').reduce((node, key) => (node == null ? undefined : node[key]), base);
  };
  const set = (path, value) => {
    const [base, rest] = locate(path);
    const keys = rest.split('.');
    const last = keys.pop();
    const parent = keys.reduce((node, key) => {
      if (node[key] == null) node[key] = {};
      return node[key];
    }, base);
    parent[last] = value;
  };
  const text = (path) => String(get(path) ?? '');

  // ------------------------------------------------------------------ errors

  // Errors in page order (the validator reports section copy before lists), so
  // the first one revealed and the first one in the publish message is the
  // highest on the page. The sort is stable: within a part, validator order.
  const partOf = (path) => {
    if (path === 'config.eligibility' || path.startsWith(ELIGIBILITY_PATH)) return 'eligibility';
    return path.startsWith('config.') ? 'hero' : path.split('.')[0];
  };
  const byPageOrder = (errors) => {
    const rank = (error) => PARTS.findIndex((part) => part.id === partOf(error.path));
    return errors.map((error) => [rank(error), error]).sort((a, b) => a[0] - b[0]).map(([, error]) => error);
  };
  // The validator's eligibility paths are relative to site-config.json; the
  // fields here carry them under `config.` (config.eligibility.body).
  const eligibilityErrors = (config) => rules.validateEligibilityDetailed(config).map((error) => ({ ...error, path: 'config.' + error.path }));
  const pageErrors = (content, hero, config) => byPageOrder([...hero, ...rules.validateContentDetailed(content),
    ...eligibilityErrors(config)]);
  const allErrors = () => pageErrors(buf.content, formHeroErrors(buf.hero), { eligibility: buf.eligibility });
  const isPending = (path) => [...buf.pending].some((p) => path === p || path.startsWith(p + '.'));
  const visibleErrors = () => allErrors().filter((error) => !isPending(error.path));

  // ------------------------------------------------------------------ markup

  // The site's own highlight render (content-rules highlightWholeWord), so the
  // preview highlights exactly what the page will.
  const emphasise = (value, accent, tag = 'em') => rules.highlightWholeWord(value, accent, tag);

  const errorSlot = (path, extra = '') => '<span class="field-error' + extra + '" data-error-for="' + path + '"></span>';

  // One labelled field. `long` makes it a textarea; `hint` is a live, non-blocking
  // note under the field (no field uses one at present).
  const field = (path, label, options = {}) => {
    const value = text(path);
    const attrs = ' data-page-path="' + path + '"' + (options.placeholder ? ' placeholder="' + h(options.placeholder) + '"' : '');
    const control = options.long
      ? '<textarea' + attrs + ' rows="' + (options.rows || 3) + '">' + h(value) + '</textarea>'
      : '<input' + attrs + ' value="' + h(value) + '">';
    const prefix = options.srPrefix ? '<span class="visually-hidden">' + h(options.srPrefix) + ' </span>' : '';
    return '<label class="' + (options.className || '') + '"><span class="pg-label">' + prefix + h(label) + (options.optional ? '<small>Optional</small>' : '') + '</span>' + control +
      (options.help ? '<span class="field-help">' + options.help + '</span>' : '') +
      (options.hint ? '<span class="pg-hint" data-hint-for="' + path + '"></span>' : '') +
      errorSlot(path) + '</label>';
  };

  const accentHelp = (where) => 'Shown in italics and the accent colour, as on the site. Must match whole words in ' + where + '.';
  const preview = (id, extra = '') => '<div class="pg-preview' + extra + '"><span class="pg-preview__caption">Preview</span><div data-preview="' + id + '">' + PREVIEWS[id]() + '</div></div>';

  const moveButtons = (list, index, length) => {
    const { noun, min } = LISTS[list];
    const button = (action, direction, name, label, disabled) => '<button class="row-action" type="button" data-page-action="' + action + '" data-list="' + list + '" data-index="' + index + '"' +
      (direction ? ' data-direction="' + direction + '"' : '') + ' aria-label="' + label.replace('%', noun + ' ' + (index + 1)) + '"' + (disabled ? ' disabled' : '') + '>' + icon(name) + '</button>';
    return '<div class="row-actions">' +
      button('move', -1, 'up', 'Move % up', index === 0) +
      button('move', 1, 'down', 'Move % down', index === length - 1) +
      button('remove', 0, 'trash', 'Remove %', length <= min) + '</div>';
  };

  const listHeading = (list, title, help) => {
    const items = get(list) || [];
    const { noun, max } = LISTS[list];
    return '<div class="field-group__heading"><div><h3>' + h(title) + '</h3><p>' + help + '</p></div>' +
      '<div class="pg-list-tools"><span class="pg-count">' + items.length + ' of ' + max + '</span>' +
      '<button class="button button--quiet" type="button" data-page-action="add" data-list="' + list + '"' + (items.length >= max ? ' disabled' : '') + '>Add ' + noun + '</button></div></div>' +
      errorSlot(list);
  };

  // A list of one-line strings (chips, stats, symptoms).
  const stringList = (list, title, help, options = {}) => {
    const items = get(list) || [];
    const { noun } = LISTS[list];
    const rows = items.map((item, index) => '<div class="pg-row"><label><span class="visually-hidden">' + h(noun.charAt(0).toUpperCase() + noun.slice(1)) + ' ' + (index + 1) + '</span>' +
      '<input data-page-path="' + list + '.' + index + '" value="' + h(item) + '"' + (options.placeholder ? ' placeholder="' + h(options.placeholder) + '"' : '') + '>' + errorSlot(list + '.' + index) + '</label>' +
      moveButtons(list, index, items.length) + '</div>').join('');
    return '<div class="pg-sub">' + listHeading(list, title, help) +
      (rows ? '<div class="pg-rows">' + rows + '</div>' : '<p class="pg-empty">' + h(options.empty || 'None yet.') + '</p>') + '</div>';
  };

  const sub = (title, help, body) => '<div class="pg-sub"><div class="field-group__heading"><div><h3>' + h(title) + '</h3>' + (help ? '<p>' + help + '</p>' : '') + '</div></div>' + body + '</div>';

  // kicker / heading / highlighted words / intro line — the common section head.
  const headingSet = (id, options = {}) => preview(id) +
    '<div class="pg-grid pg-grid--accent">' +
    (options.noKicker ? '' : field(id + '.kicker', 'Small label above the heading', { className: 'pg-start', optional: true, help: 'Leave blank to hide it.' })) +
    field(id + '.heading', 'Heading', { className: 'pg-start' }) +
    field(id + '.accent', 'Highlighted words', { optional: true, help: accentHelp('the heading') }) +
    (options.body
      ? field(id + '.' + options.body, options.bodyLabel || 'Text', { className: 'field--full', long: true, rows: 3 })
      : field(id + '.lede', 'Intro line', { className: 'field--full', long: true, rows: 3, optional: true, help: 'Leave blank to hide it.' })) +
    '</div>';

  // ---------------------------------------------------------------- previews

  const kickerPill = (value) => (String(value || '').trim() ? '<span class="pg-preview__kicker">' + h(value) + '</span>' : '');
  const headingPreview = (id) => () => {
    const part = buf.content[id] || {};
    return kickerPill(part.kicker) +
      '<p class="pg-preview__heading">' + emphasise(part.heading || '', part.accent) + '</p>' +
      (String(part.lede || '').trim() ? '<p class="pg-preview__text">' + h(part.lede) + '</p>' : '');
  };
  const bubble = (value, bold) => '<p class="pg-preview__bubble">' + emphasise(value, bold, 'strong') + '</p>';

  const PREVIEWS = {
    hero: () => {
      const hero = buf.content.hero || {};
      return '<p class="pg-preview__lead">' + h(hero.lead || '') + '</p>' +
        '<p class="pg-preview__heading pg-preview__heading--hero">“' + emphasise(stripQuotes(buf.hero.heroHeadline), buf.hero.heroAccent) + '”</p>';
    },
    evidence: () => {
      const hero = buf.content.hero || {};
      const parts = [hero.evidenceLead, hero.evidenceBody, hero.evidenceLink].map((value) => String(value || '').trim());
      if (!parts.some(Boolean)) return '<p class="pg-preview__text">The card shows the featured recovery’s photographs with no caption.</p>';
      return '<p class="pg-preview__text pg-preview__text--ink">' + (parts[0] ? '<strong>' + h(parts[0]) + '</strong> ' : '') + h(parts[1]) + (parts[2] ? ' <span class="pg-preview__link">' + h(parts[2]) + ' →</span>' : '') + '</p>';
    },
    recoveries: headingPreview('recoveries'),
    solutions: headingPreview('solutions'),
    treatment: headingPreview('treatment'),
    voices: headingPreview('voices'),
    approach: headingPreview('approach'),
    motto: () => {
      const approach = buf.content.approach || {};
      return '<p class="pg-preview__heading pg-preview__heading--motto">' + emphasise(approach.mottoLine || '', approach.mottoAccent) + '</p>' +
        '<p class="pg-preview__text">' + h(approach.mottoBody || '') + '</p>';
    },
    conditions: headingPreview('conditions'),
    case: () => {
      const conditions = buf.content.conditions || {};
      if (!String(conditions.caseQuote || '').trim()) return '<p class="pg-preview__text">No quote, so the case highlight is hidden on the site.</p>';
      const stats = (conditions.caseStats || []).filter((stat) => String(stat).trim());
      // As on the site: the quote in body type, with no quote marks added.
      return kickerPill(conditions.caseKicker) + '<p class="pg-preview__text pg-preview__text--ink">' + h(conditions.caseQuote) + '</p>' +
        (stats.length ? '<p class="pg-preview__stats">' + stats.map((stat) => '<span>' + h(stat) + '</span>').join('') + '</p>' : '');
    },
    watch: headingPreview('watch'),
    note: () => {
      const watch = buf.content.watch || {};
      return '<p class="pg-preview__note">' + emphasise(watch.note || '', watch.noteAccent) + '</p>';
    },
    // Kicker and heading only: the notice text is the longest copy on the page
    // and reads the same in its box below, so repeating it here only adds scroll.
    eligibility: () => {
      const { heading, body, accent } = buf.eligibility;
      if (!heading.trim() && !body.trim()) return '<p class="pg-preview__text">No heading or text, so the notice is hidden on the site.</p>';
      return kickerPill((buf.content.eligibility || {}).kicker) + '<p class="pg-preview__heading">' + emphasise(heading, accent) + '</p>';
    },
    act: () => {
      const act = buf.content.act || {};
      return '<p class="pg-preview__heading">' + emphasise(act.heading || '', act.accent) + '</p><p class="pg-preview__text">' + h(act.body || '') + '</p>';
    },
    consult: () => {
      const consult = buf.content.consult || {};
      // Stacked like the site's note: the title over the text (omitted when blank).
      return '<p class="pg-preview__text pg-preview__text--ink"><strong>' + h(consult.title || '') + '</strong></p>' +
        (String(consult.text || '').trim() ? '<p class="pg-preview__text">' + h(consult.text) + '</p>' : '');
    },
    contact: () => {
      const contact = buf.content.contact || {};
      return '<p class="pg-preview__heading">' + emphasise(contact.heading || '', contact.accent) + '</p><p class="pg-preview__text">' + h(contact.body || '') + '</p>';
    },
    greeting: () => bubble((buf.content.chat || {}).greeting || '', (buf.content.chat || {}).greetingBold),
    ...Object.fromEntries([0, 1, 2, 3].map((i) => ['question' + i, () => {
      const question = ((buf.content.chat || {}).questions || [])[i] || {};
      return bubble(question.prompt || '', question.bold);
    }])),
  };

  // One-line summary of each part, shown on its collapsed row.
  const peekHeading = (id) => () => emphasise((buf.content[id] || {}).heading || '', (buf.content[id] || {}).accent);
  const PEEKS = {
    hero: () => '“' + emphasise(stripQuotes(buf.hero.heroHeadline), buf.hero.heroAccent) + '”',
    nav: () => (buf.content.nav || []).map((item) => h(item.label || '')).join(' · '),
    recoveries: peekHeading('recoveries'),
    solutions: peekHeading('solutions'),
    treatment: peekHeading('treatment'),
    voices: peekHeading('voices'),
    approach: peekHeading('approach'),
    conditions: peekHeading('conditions'),
    watch: peekHeading('watch'),
    eligibility: () => (buf.eligibility.heading.trim() ? emphasise(buf.eligibility.heading, buf.eligibility.accent) : 'Hidden on the site'),
    act: peekHeading('act'),
    consult: () => h((buf.content.consult || {}).title || ''),
    about: () => h((buf.content.about || {}).heading || ''),
    contact: peekHeading('contact'),
    footer: () => h((buf.content.footer || {}).disclaimer || ''),
    chat: () => h((buf.content.chat || {}).name || ''),
    cta: () => h((buf.content.cta || {}).message || ''),
  };

  // ------------------------------------------------------------------- parts

  const heroBody = () => preview('hero') +
    '<div class="pg-grid pg-grid--accent">' +
    field('hero.lead', 'Line above the headline', { className: 'field--full' }) +
    field('config.heroHeadline', 'Headline', { className: 'pg-start', help: 'The site adds the quotation marks.' }) +
    field('config.heroAccent', 'Highlighted words', { optional: true, help: accentHelp('the headline') }) +
    field('config.heroSub', 'Supporting line', { className: 'field--full', long: true, rows: 4 }) +
    field('hero.recoveriesButton', 'Recoveries button', { help: 'The button that scrolls down to the recovery stories.' }) +
    '</div>' +
    stringList('hero.chips', 'Condition chips', 'The row of conditions under the buttons. Remove them all to hide the row.', { empty: 'No chips, so the row is hidden on the site.' }) +
    sub('Evidence card', 'The caption on the featured recovery’s photographs. Any field left blank is left out.',
      preview('evidence') +
      '<div class="pg-grid">' +
      field('hero.evidenceLead', 'Title', { optional: true }) +
      field('hero.evidenceLink', 'Link label', { optional: true }) +
      field('hero.evidenceBody', 'Text', { className: 'field--full', optional: true }) +
      '</div>') +
    sub('Hero counter', 'Up to three tiles, each a number and a label, like “500+” and “Recoveries”. Clear both to hide a tile. Saving keeps only what is shown here: a fourth tile or an unknown icon added outside the admin is dropped.',
      '<div class="stat-editor">' + buf.hero.stats.map((stat, i) => '<div class="stat-row">' +
        '<label>Icon<select data-page-path="config.heroStats.' + i + '.icon">' + STAT_ICON_NAMES.map((name) =>
          '<option value="' + name + '"' + (stat.icon === name ? ' selected' : '') + '>' + STAT_ICON_LABELS[name] + '</option>').join('') + '</select></label>' +
        '<label>Number<input data-page-path="config.heroStats.' + i + '.value" value="' + h(stat.value) + '"></label>' +
        '<label>Label<input data-page-path="config.heroStats.' + i + '.label" value="' + h(stat.label) + '"></label>' +
        '</div>' + errorSlot('config.heroStats.' + i)).join('') + '</div>');

  const navBody = () => {
    const nav = buf.content.nav || [];
    return '<div class="pg-nav"><div class="pg-nav__head" aria-hidden="true"><span>Links to</span><span>Header label</span><span>Footer label</span></div>' +
      nav.map((item, i) => '<div class="pg-nav__row"><span class="pg-nav__target">' + h(NAV_NAMES[item.target] || item.target) + '</span>' +
        field('nav.' + i + '.label', 'Header label', { className: 'pg-nav__field', srPrefix: NAV_NAMES[item.target] || item.target }) +
        field('nav.' + i + '.footerLabel', 'Footer label', { className: 'pg-nav__field', srPrefix: NAV_NAMES[item.target] || item.target }) + '</div>').join('') + '</div>';
  };

  const stepsList = () => {
    const steps = get('approach.steps') || [];
    const rows = steps.map((step, i) => '<div class="pg-step"><span class="pg-step__num" aria-hidden="true">' + (i + 1) + '</span><div class="pg-step__fields">' +
      field('approach.steps.' + i + '.title', 'Title', { srPrefix: 'Step ' + (i + 1) }) +
      field('approach.steps.' + i + '.body', 'Text', { long: true, rows: 2, srPrefix: 'Step ' + (i + 1) }) +
      '</div>' + moveButtons('approach.steps', i, steps.length) + '</div>').join('');
    return '<div class="pg-sub">' + listHeading('approach.steps', 'Steps', 'Numbered in this order on the site.') + '<div class="pg-rows">' + rows + '</div></div>';
  };

  const questionBlock = (question, i) => '<div class="pg-question"><span class="pg-question__label">' + h(QUESTION_NAMES[question.key] || 'Question ' + (i + 1)) + '</span>' +
    preview('question' + i, ' pg-preview--chat') +
    '<div class="pg-grid">' +
    field('chat.questions.' + i + '.prompt', 'Question', { className: 'field--full' }) +
    field('chat.questions.' + i + '.bold', 'Bold words', { optional: true, help: 'Must match whole words in the question.' }) +
    field('chat.questions.' + i + '.placeholder', 'Answer hint', { help: question.key === 'condition'
      ? 'Not shown for this question: the empty answer box shows examples from the condition chips instead (“e.g. Diabetic foot, Lymphedema, Venous ulcers…”).'
      : 'Shown faintly in the empty answer box. The site adds a trailing “…”.' }) +
    '</div></div>';

  const chatBody = () => {
    const chat = buf.content.chat || {};
    return sub('Window', 'The chat window’s header and the bubble that invites visitors in.',
      '<div class="pg-grid">' +
      field('chat.name', 'Assistant name') +
      field('chat.status', 'Status line') +
      field('chat.nudgeLead', 'Invitation title') +
      field('chat.nudgeBody', 'Invitation text') +
      field('chat.legal', 'Small print', { className: 'field--full', long: true, rows: 2, help: 'Under the answer box, throughout the chat.' }) +
      '</div>') +
      sub('Greeting', 'The first message.',
        preview('greeting', ' pg-preview--chat') +
        '<div class="pg-grid">' +
        field('chat.greeting', 'Greeting', { className: 'field--full', long: true, rows: 2 }) +
        field('chat.greetingBold', 'Bold words', { optional: true, help: 'Must match whole words in the greeting.' }) +
        '</div>') +
      sub('Questions', 'Asked in this order. The questions themselves are fixed; their wording is yours.',
        (chat.questions || []).map(questionBlock).join('')) +
      stringList('chat.conditions', 'Condition chips', 'Quick answers offered with the condition question. Visitors can still type their own.', { empty: 'No chips, so visitors type the condition.' }) +
      sub('After the questions', '',
        '<div class="pg-grid">' +
        field('chat.done', 'Closing message', { className: 'field--full', long: true, rows: 2, help: 'Shown with the finished request, before it is sent.' }) +
        field('chat.welcomeBack', 'Welcome-back message', { className: 'field--full', long: true, rows: 2, help: 'For a visitor who returns to a request they already set up.' }) +
        field('chat.restart', 'Restart message', { className: 'field--full', help: 'When the visitor chooses to change their details.' }) +
        '</div>') +
      sub('WhatsApp message', 'The visitor’s answers are sent between these two lines.',
        '<div class="pg-grid">' +
        field('chat.messageOpening', 'Opening line', { className: 'field--full' }) +
        field('chat.messageClosing', 'Closing line', { className: 'field--full' }) +
        '</div>');
  };

  const PARTS = [
    { id: 'hero', name: 'Hero', intro: 'The opening screen. The featured recovery’s photographs come from the Recoveries tab.', body: heroBody },
    { id: 'nav', name: 'Header & footer nav', intro: 'The links in the site header and footer. Each one jumps to its section; the destinations and their order are fixed.', body: navBody },
    { id: 'recoveries', name: 'Recoveries', intro: 'The heading over the recovery stories. The stories are on the Recoveries tab.', body: () => headingSet('recoveries') },
    { id: 'solutions', name: 'Solutions', intro: 'The heading over the condition cards. The cards are on the Solutions tab.', body: () => headingSet('solutions') },
    { id: 'treatment', name: 'In therapy', intro: 'The heading over the patients currently in therapy. The patients are on the In therapy tab.', body: () => headingSet('treatment') },
    { id: 'voices', name: 'Voices', intro: 'The heading over the patient messages. The screenshots are on the Voices tab.', body: () => headingSet('voices') },
    {
      id: 'approach', name: 'Approach', intro: 'How the therapy works: the heading, the numbered steps, and the motto under them.',
      body: () => headingSet('approach') + stepsList() +
        sub('Motto', 'The closing line under the steps.', preview('motto') +
          '<div class="pg-grid pg-grid--accent">' +
          field('approach.mottoLine', 'Motto', { className: 'pg-start' }) +
          field('approach.mottoAccent', 'Highlighted words', { optional: true, help: accentHelp('the motto') }) +
          field('approach.mottoBody', 'Text under the motto', { className: 'field--full', long: true, rows: 3 }) +
          '</div>'),
    },
    {
      id: 'conditions', name: 'Conditions', intro: 'The heading over the conditions list, the case highlight beside it, and the two track labels. The conditions themselves are on the Protocols tab.',
      body: () => headingSet('conditions') +
        sub('Case highlight', 'Shown only while the quote is filled in.', preview('case') +
          '<div class="pg-grid">' +
          field('conditions.caseKicker', 'Small label', { optional: true }) +
          field('conditions.caseQuote', 'Quote', { className: 'field--full', long: true, rows: 3, optional: true, help: 'Clear it to hide the case highlight.' }) +
          '</div>') +
        stringList('conditions.caseStats', 'Case stats', 'Short facts under the quote.', { empty: 'No stats under the quote.' }) +
        sub('Track labels', 'The headings over the two groups of protocols.',
          '<div class="pg-grid">' +
          field('conditions.trackDisease', 'Disease-specific protocols') +
          field('conditions.trackElderly', 'Bedridden & elderly care') +
          '</div>'),
    },
    {
      id: 'watch', name: 'Symptoms', intro: 'The signs to watch out for, and the line that closes the list.',
      body: () => headingSet('watch') +
        stringList('watch.items', 'Symptoms', 'Listed in this order.') +
        sub('Closing note', 'The line under the list.', preview('note') +
          '<div class="pg-grid pg-grid--accent">' +
          field('watch.note', 'Note', { className: 'pg-start' }) +
          field('watch.noteAccent', 'Highlighted words', { optional: true, help: accentHelp('the note') }) +
          '</div>'),
    },
    {
      id: 'eligibility', name: 'Eligibility', intro: 'The notice after the symptoms list that says who the protocols are not for.',
      body: () => preview('eligibility') +
        '<div class="pg-grid pg-grid--accent">' +
        field('eligibility.kicker', 'Small label above the heading', { className: 'pg-start', optional: true, help: 'Leave blank to hide it.' }) +
        field('config.eligibility.heading', 'Heading', { className: 'pg-start' }) +
        field('config.eligibility.accent', 'Highlighted words', { optional: true, help: accentHelp('the heading') }) +
        field('config.eligibility.body', 'Notice text', { className: 'field--full', long: true, rows: 6, help: 'A blank line starts a new paragraph. Clear the heading and the text to remove the section.' }) +
        '</div>',
    },
    { id: 'act', name: 'Call to action', intro: 'The panel near the end of the page that asks visitors to get in touch.', body: () => headingSet('act', { noKicker: true, body: 'body', bodyLabel: 'Text' }) },
    {
      id: 'consult', name: 'Consultation note', intro: 'The reassurance shown with the contact buttons in the call to action and contact sections.',
      body: () => preview('consult') + '<div class="pg-grid">' +
        field('consult.title', 'Title') +
        field('consult.text', 'Text', { optional: true }) + '</div>',
    },
    {
      id: 'about', name: 'About', intro: 'The heading beside the about copy. The copy itself is on the Company tab.',
      body: () => '<div class="pg-grid">' + field('about.heading', 'Heading') + field('about.location', 'Location line', { optional: true, help: 'Under the heading. Leave blank to hide it.' }) + '</div>',
    },
    { id: 'contact', name: 'Contact', intro: 'The last section on the page, above the contact details.', body: () => headingSet('contact', { noKicker: true, body: 'body', bodyLabel: 'Text' }) },
    {
      id: 'footer', name: 'Footer', intro: 'The small print at the bottom of the page.',
      body: () => '<div class="pg-grid">' + field('footer.disclaimer', 'Disclaimer', { className: 'field--full', long: true, rows: 3 }) + '</div>',
    },
    { id: 'chat', name: 'Chat assistant', intro: 'The chat that collects a case and opens WhatsApp with it ready to send.', body: chatBody },
    {
      id: 'cta', name: 'WhatsApp buttons', intro: 'The message pre-filled in WhatsApp when a visitor taps one of the site’s WhatsApp buttons.',
      body: () => '<div class="pg-grid">' + field('cta.message', 'Pre-filled message', { className: 'field--full', long: true, rows: 2 }) + '</div>',
    },
  ];

  const partHtml = (part) => '<details class="pg-part" id="pg-' + part.id + '" data-part="' + part.id + '"' + (buf.open.has(part.id) ? ' open' : '') + '>' +
    '<summary><h2 class="pg-part__name">' + h(part.name) + '</h2><span class="pg-part__peek" data-peek="' + part.id + '">' + PEEKS[part.id]() + '</span>' +
    '<span class="pg-flag" data-flag-for="' + part.id + '" hidden></span><span class="pg-part__chevron" aria-hidden="true"></span></summary>' +
    '<div class="pg-part__body"><p class="pg-intro">' + h(part.intro) + '</p>' + errorSlot(part.id) + part.body() + '</div></details>';

  const render = () => {
    ensure();
    return '<section class="pg" data-testid="page-editor"><div class="section-toolbar"><div><h1>Page</h1><p>Every heading and line of copy on the public site, in page order. Photos, patients, and videos keep their own tabs.</p></div></div>' +
      errorSlot('', ' pg-page-error') +
      '<form id="page-form" novalidate><div class="pg-parts">' + PARTS.map(partHtml).join('') + '</div>' +
      '<div class="form-actions pg-actions" data-pg-actions><p class="pg-actions__state" data-pg-state></p>' +
      '<button class="button button--quiet" type="button" data-page-action="discard" hidden>Discard changes</button>' +
      '<button class="button button--primary" type="button" data-page-action="save">Save page draft</button></div></form></section>';
  };

  // ------------------------------------------------------------ live updates

  const scope = () => root.querySelector('[data-testid="page-editor"]');

  const slotFor = (container, path) => {
    for (let p = path; ; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') {
      const slot = container.querySelector('[data-error-for="' + p + '"]');
      if (slot || p === '') return slot;
    }
  };

  const paint = () => {
    const container = scope();
    if (!container) return;
    const errors = visibleErrors();
    for (const slot of container.querySelectorAll('[data-error-for]')) slot.replaceChildren();
    for (const control of container.querySelectorAll('[aria-invalid], [aria-describedby^="err-"]')) clearError(control);
    const counts = {};
    for (const error of errors) {
      const slot = slotFor(container, error.path);
      if (slot) {
        const line = document.createElement('span');
        line.textContent = slot.dataset.errorFor === '' ? error.message : fieldMessage(error.message);
        slot.append(line);
      }
      const control = container.querySelector('[data-page-path="' + error.path + '"]');
      if (control) control.setAttribute('aria-invalid', 'true');
      if (control && slot) describeError(control, slot);
      const part = partOf(error.path);
      if (part) counts[part] = (counts[part] || 0) + 1;
    }
    for (const flag of container.querySelectorAll('[data-flag-for]')) {
      const count = counts[flag.dataset.flagFor] || 0;
      flag.hidden = count === 0;
      flag.textContent = count === 1 ? '1 to fix' : count + ' to fix';
    }
    const dirty = snapshot() !== buf.baseline;
    const actions = container.querySelector('[data-pg-actions]');
    actions.classList.toggle('is-dirty', dirty);
    actions.querySelector('[data-page-action="discard"]').hidden = !dirty;
    const stateLine = actions.querySelector('[data-pg-state]');
    const total = errors.length;
    stateLine.classList.toggle('is-error', buf.tried && total > 0);
    stateLine.textContent = total
      ? (total === 1 ? '1 field needs attention' : total + ' fields need attention') + (buf.tried ? ' before the page can be saved.' : '')
      : (dirty ? 'Unsaved page edits' : '');
  };

  const refresh = () => {
    const container = scope();
    if (!container) return;
    for (const node of container.querySelectorAll('[data-preview]')) node.innerHTML = PREVIEWS[node.dataset.preview]();
    for (const node of container.querySelectorAll('[data-peek]')) node.innerHTML = PEEKS[node.dataset.peek]();
    paint();
  };

  const revealFirstError = () => {
    const container = scope();
    const first = visibleErrors()[0];
    if (!container || !first) return;
    const part = partOf(first.path);
    const details = container.querySelector('[data-part="' + part + '"]');
    if (details && !details.open) {
      details.open = true;
      buf.open.add(part);
    }
    const target = container.querySelector('[data-page-path="' + first.path + '"]') || slotFor(container, first.path);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    if (target.matches('input, textarea, select')) target.focus({ preventScroll: true });
  };

  // ----------------------------------------------------------------- actions

  const save = () => {
    buf.pending.clear();
    if (allErrors().length) {
      buf.tried = true;
      paint();
      revealFirstError();
      return;
    }
    buf.tried = false;
    const content = deepTrim(buf.content);
    const hero = heroToConfig(buf.hero);
    let changed = false;
    if (!same(content, deepTrim(state.draft.content))) {
      state.draft.content = content;
      markDirty('content');
      changed = true;
    }
    // Also rewrite a stored hero the shared rule rejects (a hand edit: a fourth
    // tile, an unknown icon, a half-filled tile) even when the form normalises
    // it to look unchanged — otherwise the publish gate would block on data the
    // owner has no field left to fix.
    if (!same(hero, heroToConfig(heroFromConfig(state.draft.config))) || heroErrors(state.draft.config).length) {
      Object.assign(state.draft.config, hero);
      markDirty('config');
      changed = true;
    }
    // Spread, don't replace: keys this tab does not edit survive the save.
    const eligibility = eligibilityToConfig(buf.eligibility);
    if (!same(eligibility, eligibilityToConfig(eligibilityFromConfig(state.draft.config)))) {
      const existing = state.draft.config.eligibility;
      state.draft.config.eligibility = { ...(isObject(existing) ? existing : {}), ...eligibility };
      markDirty('config');
      changed = true;
    }
    seed();
    rerender();
    if (changed) showStatus('Page draft saved', 'Press Save & Publish to put the changes on the site.');
    else showStatus('Nothing to save', 'There are no new edits on this page.');
  };

  const listAction = (action, list, index, direction) => {
    if (!Array.isArray(get(list))) set(list, []);
    const items = get(list);
    const { min, max, blank } = LISTS[list];
    let focusPath = '';
    buf.pending.clear();
    if (action === 'add' && items.length < max) {
      items.push(blank());
      const path = list + '.' + (items.length - 1);
      buf.pending.add(path);
      focusPath = list === 'approach.steps' ? path + '.title' : path;
    }
    if (action === 'remove' && items.length > min) items.splice(index, 1);
    if (action === 'move') {
      const target = index + direction;
      if (target < 0 || target >= items.length) return;
      const [item] = items.splice(index, 1);
      items.splice(target, 0, item);
    }
    rerender();
    const container = scope();
    if (!container) return;
    if (focusPath) {
      container.querySelector('[data-page-path="' + focusPath + '"]')?.focus();
      return;
    }
    // Keep the keyboard where it was: on the same control of the moved row, or
    // on the list's add button after a removal.
    const selector = action === 'move'
      ? '[data-page-action="move"][data-list="' + list + '"][data-index="' + (index + direction) + '"][data-direction="' + direction + '"]'
      : '[data-page-action="add"][data-list="' + list + '"]';
    const next = container.querySelector(selector);
    if (next && !next.disabled) next.focus();
    else container.querySelector('[data-page-action="add"][data-list="' + list + '"]')?.focus();
  };

  const active = () => state.loaded && state.activeTab === 'page' && !state.editor && buf;

  root.addEventListener('input', (event) => {
    if (!active()) return;
    const control = event.target.closest('[data-page-path]');
    if (!control) return;
    set(control.dataset.pagePath, control.value);
    refresh();
  });

  // A just-added row stays quiet until the owner leaves it (or tries to save).
  root.addEventListener('focusout', (event) => {
    if (!active() || !buf.pending.size) return;
    const path = event.target.dataset?.pagePath;
    if (!path) return;
    for (const pending of [...buf.pending]) {
      if (path === pending || path.startsWith(pending + '.')) {
        // A step has two fields: stay quiet while focus moves within the row.
        const row = event.target.closest('.pg-step, .pg-row');
        if (row && event.relatedTarget && row.contains(event.relatedTarget)) continue;
        buf.pending.delete(pending);
      }
    }
    paint();
  });

  // `toggle` does not bubble; listen in the capture phase to remember open parts.
  root.addEventListener('toggle', (event) => {
    if (!active() || !event.target.matches?.('.pg-part')) return;
    if (event.target.open) buf.open.add(event.target.dataset.part);
    else buf.open.delete(event.target.dataset.part);
  }, true);

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-action]');
    if (!button || !active()) return;
    try {
      const action = button.dataset.pageAction;
      if (action === 'save') return save();
      if (action === 'discard') {
        if (!confirm('Discard your unsaved page edits?')) return;
        seed();
        rerender();
        return;
      }
      listAction(action, button.dataset.list, Number(button.dataset.index), Number(button.dataset.direction || 0));
    } catch (error) {
      showStatus('Could not update the page', h(error.message));
    }
  });

  // Leaving the page with unsaved edits is caught by app.js (hasUnsavedWork,
  // which reads hasUnsavedEdits), along with Lock and the unsaved bar.

  // ---------------------------------------------------------- publish gate

  // Run before every publish, over the data files exactly as they would be
  // committed. First refuse while page edits are unsaved; then run the shared
  // rules on every file they cover that this admin has loaded — all of them,
  // not only the changed ones, because the build validates the whole site and
  // an error in any file fails the deploy. A file this branch does not load
  // (treatment / films until their tabs land) is skipped. Errors come back as
  // one message grouped by the tab where each one is fixed.
  const GATES = [
    { file: 'content', tab: 'page', name: 'Page', check: (draft) => pageErrors(draft.content, heroErrors(draft.config || {}), draft.config || {}).map((error) => error.message) },
    { file: 'treatment', tab: 'treatment', name: 'In therapy', check: (draft) => rules.validateTreatment(draft.treatment) },
    { file: 'films', tab: 'films', name: 'Videos', check: (draft) => rules.validateFilms(draft.films) },
    { file: 'company', tab: 'company', name: 'Company', check: (draft) => rules.validateCompanyLocation(draft.company) },
    { file: 'config', tab: 'appearance', name: 'Appearance', check: (draft) => rules.validateSeo(draft.config.seo) },
    { file: 'blogPosts', tab: 'blog', name: 'Blog posts', check: (draft) => rules.validateBlogPosts(draft.blogPosts, draft.blogConfig, draft.films) },
    { file: 'blogConfig', tab: 'blog', name: 'Blog settings', check: (draft) => rules.validateBlogConfig(draft.blogConfig) },
  ];
  const PER_GROUP = 3;
  const publishBlock = () => {
    if (hasUnsavedEdits()) {
      return { title: 'Page edits not saved', message: 'Save the page draft on the Page tab, or discard those edits, before publishing.', tab: 'page', tabName: 'Page' };
    }
    const groups = GATES
      .filter((gate) => gate.file in state.draft)
      .map((gate) => ({ ...gate, errors: gate.check(state.draft) }))
      .filter((gate) => gate.errors.length);
    if (!groups.length) return null;
    // Each group is its own block so the heading sits on its errors and the
    // space falls between groups (styles.css .status-group).
    const message = groups.map((group) => '<span class="status-group"><strong>' + h(group.name) + ' tab</strong>' +
      group.errors.slice(0, PER_GROUP).map((error) => h(error)).join('<br>') +
      (group.errors.length > PER_GROUP ? '<br>…and ' + (group.errors.length - PER_GROUP) + ' more there.' : '') + '</span>').join('');
    return { title: 'Cannot publish yet', message, tab: groups[0].tab, tabName: groups[0].name };
  };

  // After a blocked publish: open every part with an error and go to the
  // first; with no errors (the block was unsaved edits) go to the save button.
  const revealErrors = () => {
    if (!active()) return;
    const container = scope();
    if (!visibleErrors().length) {
      const saveButton = container && container.querySelector('[data-page-action="save"]');
      if (saveButton) {
        saveButton.scrollIntoView({ block: 'center' });
        saveButton.focus({ preventScroll: true });
      }
      return;
    }
    buf.tried = true;
    for (const error of visibleErrors()) {
      const part = partOf(error.path);
      const details = container && container.querySelector('[data-part="' + part + '"]');
      if (details) details.open = true;
      buf.open.add(part);
    }
    paint();
    revealFirstError();
  };

  return { render, mount: paint, publishBlock, revealErrors, hasUnsavedEdits };
};
