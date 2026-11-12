// Content rules — the ONE validator for data/content.json, data/treatment.json
// and data/films.json. Both sides run this same file, so the admin and the
// build cannot drift apart (AGENTS.md Lesson 13, lockstep by construction):
//
//   build (Node 22):  const rules = require('../admin/content-rules.js');
//                     src/build.js validate() throws on any error.
//   admin (browser):  import './content-rules.js';   // side-effect import
//                     const rules = globalThis.MediVascContentRules;
//                     the admin blocks save/publish on any error.
//
// It is a classic script on purpose (no import/export): Node can require() it
// and the browser can load it as a module or a <script> — both end up with the
// same object. Keep it dependency-free.
//
// API — each returns owner-readable error strings ([] = valid):
//   validateContent(content)   validateTreatment(list)   validateFilms(list)
//   validateSeo(config.seo)    validateCompany(company)   validateCompanyLocation(company)
//   validateHero(config)       (the site-config.json hero fields)
//   validateEligibility(config)  (site-config.json → eligibility)
// and a *Detailed twin returning [{ path, message }] so an editor can place
// each error next to its field (path is dot-separated: "approach.steps.1.title").
//
// languagesOf(company) / alternateNameOf(seo) apply the code defaults for the
// optional "Languages spoken" and "Also known as" fields (absent = default).
//
// parseHours(company.hours) reads the Company tab's "Support hours" into
// schema.org opening hours (the build's JSON-LD and the tab's "Read as" line);
// validateCompanyLocation reports its error.
//
// readPhone(value, 'phone' | 'whatsapp') turns a Company phone or WhatsApp
// field into the "+<digits>" the site dials (template.js phoneHref) and reports
// a number that cannot dial; validateCompany reports its error.
//
// highlightWholeWord(text, word, tag) is the ONE highlight render: the build's
// accentuate() (src/template.js) and the admin Page previews call it, and
// src/site.js carries a verbatim copy for the chatbot's bold part (site.js
// ships as a standalone script). accentMatches(text, accent) is its test, so an
// accent that passes here is one the page will actually highlight.
// stripHeadlineQuotes(headline) is likewise the one hero-headline quote strip
// (template.js render, admin preview, validateHero).
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- helpers

  // Same output as src/template.js escapeHtml.
  const escapeHtml = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  // The first case-insensitive whole-word occurrence of `word` in `text`, or
  // null. It runs on the raw text, so an accent can never land inside an
  // escaped entity ("amp" in "Q&A"). A word is letters, marks, digits and _ in
  // any script; the boundary applies only on a side where the word itself
  // starts/ends with one, so "60+", "today!", "patients’" and "café" match as
  // typed, and "café" does not match inside "cafés".
  // src/site.js wholeWordMatch is a verbatim copy — change both together.
  const wholeWordMatch = (text, word) => {
    const target = String(word);
    if (!target) return null;
    const edge = /[\p{L}\p{M}\p{N}_]/u;
    const chars = Array.from(target);
    const source = target.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const re = new RegExp(
      (edge.test(chars[0]) ? '(?<![\\p{L}\\p{M}\\p{N}_])' : '') + source + (edge.test(chars[chars.length - 1]) ? '(?![\\p{L}\\p{M}\\p{N}_])' : ''),
      'iu',
    );
    const match = re.exec(String(text));
    return match ? { index: match.index, length: match[0].length } : null;
  };

  // Escaped HTML with the first whole-word `word` wrapped in <tag>; plain
  // escaped text when the word is blank or absent, so an edit can never break
  // the render. The word is trimmed, exactly as the validators trim it.
  const highlightWholeWord = (text, word, tag = 'em') => {
    const value = String(text ?? '');
    const match = wholeWordMatch(value, String(word ?? '').trim());
    if (!match) return escapeHtml(value);
    const end = match.index + match.length;
    return escapeHtml(value.slice(0, match.index)) + `<${tag}>` + escapeHtml(value.slice(match.index, end)) + `</${tag}>` + escapeHtml(value.slice(end));
  };

  const accentMatches = (text, accent) => wholeWordMatch(text, accent) !== null;

  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const blank = (value) => typeof value !== 'string' || value.trim() === '';

  // One error collector per validation run.
  const collector = () => {
    const errors = [];
    return {
      errors,
      add: (path, message) => errors.push({ path, message }),
    };
  };

  // Section names as the owner sees them in the admin's Page tab. Used only in
  // error messages; a name that is also an admin tab (index.html tab nav) gets
  // " section" so "In therapy section: …" is not read as the In therapy tab.
  const LABELS = {
    nav: 'Header & footer nav',
    cta: 'WhatsApp buttons',
    hero: 'Hero',
    recoveries: 'Recoveries section',
    solutions: 'Solutions section',
    treatment: 'In therapy section',
    voices: 'Voices section',
    approach: 'Approach',
    conditions: 'Conditions',
    watch: 'Symptoms',
    eligibility: 'Eligibility',
    act: 'Call to action',
    consult: 'Consultation note',
    about: 'About',
    contact: 'Contact',
    footer: 'Footer',
    chat: 'Chat assistant',
  };

  // Field names as the owner sees them.
  const FIELDS = {
    heading: 'the heading',
    accent: 'the highlighted word',
    kicker: 'the small label above the heading',
    lede: 'the intro line',
    label: 'the header label',
    footerLabel: 'the footer label',
    message: 'the pre-filled message',
    lead: 'the line above the headline',
    recoveriesButton: 'the recoveries button label',
    evidenceLead: 'the evidence card title',
    evidenceBody: 'the evidence card text',
    evidenceLink: 'the evidence card link label',
    mottoLine: 'the motto',
    mottoAccent: 'the highlighted word in the motto',
    mottoBody: 'the text under the motto',
    caseKicker: 'the case highlight label',
    caseQuote: 'the case highlight quote',
    trackDisease: 'the disease-specific protocols label',
    trackElderly: 'the bedridden & elderly care label',
    note: 'the closing note',
    noteAccent: 'the highlighted word in the closing note',
    body: 'the text',
    title: 'the title',
    text: 'the text',
    location: 'the location',
    disclaimer: 'the disclaimer',
    name: 'the assistant name',
    status: 'the status line',
    nudgeLead: 'the invitation title',
    nudgeBody: 'the invitation text',
    legal: 'the small print',
    greeting: 'the greeting',
    greetingBold: 'the bold part of the greeting',
    done: 'the closing message',
    welcomeBack: 'the welcome-back message',
    restart: 'the restart message',
    messageOpening: 'the WhatsApp message opening line',
    messageClosing: 'the WhatsApp message closing line',
  };
  const field = (key) => FIELDS[key] || key;

  // ------------------------------------------------------------ content.json

  // Every section and the role of each of its string fields. Lists are
  // validated separately below. A field not listed here is not editable copy.
  //   'req' — must be non-empty
  //   'opt' — blank is allowed; the element is omitted from the page
  //   ['accent', 'textKey'] — optional, but if set must occur in content[s][textKey]
  const SECTIONS = {
    cta: { message: 'req' },
    hero: {
      lead: 'req',
      recoveriesButton: 'req',
      evidenceLead: 'opt',
      evidenceBody: 'opt',
      evidenceLink: 'opt',
    },
    recoveries: { kicker: 'opt', heading: 'req', accent: ['accent', 'heading'], lede: 'opt' },
    solutions: { kicker: 'opt', heading: 'req', accent: ['accent', 'heading'], lede: 'opt' },
    treatment: { kicker: 'opt', heading: 'req', accent: ['accent', 'heading'], lede: 'opt' },
    voices: { kicker: 'opt', heading: 'req', accent: ['accent', 'heading'], lede: 'opt' },
    approach: {
      kicker: 'opt',
      heading: 'req',
      accent: ['accent', 'heading'],
      lede: 'opt',
      mottoLine: 'req',
      mottoAccent: ['accent', 'mottoLine'],
      mottoBody: 'req',
    },
    conditions: {
      kicker: 'opt',
      heading: 'req',
      accent: ['accent', 'heading'],
      lede: 'opt',
      caseKicker: 'opt',
      caseQuote: 'opt',
      trackDisease: 'req',
      trackElderly: 'req',
    },
    watch: {
      kicker: 'opt',
      heading: 'req',
      accent: ['accent', 'heading'],
      lede: 'opt',
      note: 'req',
      noteAccent: ['accent', 'note'],
    },
    eligibility: { kicker: 'opt' },
    act: { heading: 'req', accent: ['accent', 'heading'], body: 'req' },
    consult: { title: 'req', text: 'opt' },
    about: { heading: 'req', location: 'opt' },
    contact: { heading: 'req', accent: ['accent', 'heading'], body: 'req' },
    footer: { disclaimer: 'req' },
    chat: {
      name: 'req',
      status: 'req',
      nudgeLead: 'req',
      nudgeBody: 'req',
      legal: 'req',
      greeting: 'req',
      greetingBold: ['accent', 'greeting'],
      done: 'req',
      welcomeBack: 'req',
      restart: 'req',
      messageOpening: 'req',
      messageClosing: 'req',
    },
  };

  const NAV_TARGETS = ['recoveries', 'approach', 'conditions', 'about', 'contact'];
  const QUESTION_KEYS = ['name', 'age', 'condition', 'city'];
  const QUESTION_NAMES = { name: 'name', age: 'age', condition: 'condition', city: 'city' };

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // A list of plain strings: an array, count within [min, max], no blank entries.
  const checkStringList = (add, value, path, where, what, min, max) => {
    if (!Array.isArray(value)) {
      add(path, `${where}: the ${what} list is missing.`);
      return;
    }
    if (value.length < min) add(path, `${where}: add at least ${plural(min, what.replace(/s$/, ''), what)}.`);
    if (value.length > max) add(path, `${where}: at most ${plural(max, what.replace(/s$/, ''), what)} (there are ${value.length}).`);
    value.forEach((item, i) => {
      if (blank(item)) add(`${path}.${i}`, `${where}: ${what.replace(/s$/, '')} ${i + 1} is empty — fill it in or remove it.`);
    });
  };

  const validateContentDetailed = (content) => {
    const { errors, add } = collector();
    if (!isObject(content)) {
      add('', 'Page content is missing or unreadable.');
      return errors;
    }

    // Section string fields.
    for (const [section, fields] of Object.entries(SECTIONS)) {
      const where = LABELS[section];
      const data = content[section];
      if (!isObject(data)) {
        add(section, `${where}: this section is missing from the page content.`);
        continue;
      }
      for (const [key, role] of Object.entries(fields)) {
        const path = `${section}.${key}`;
        const value = data[key];
        if (value !== undefined && typeof value !== 'string') {
          add(path, `${where}: ${field(key)} must be text.`);
          continue;
        }
        if (role === 'req' && blank(value)) {
          add(path, `${where}: ${field(key)} is required.`);
        } else if (Array.isArray(role) && !blank(value)) {
          const text = data[role[1]];
          if (!blank(text) && !accentMatches(text, value.trim())) {
            const noun = key === 'greetingBold' ? 'the bold part' : 'the highlighted word';
            add(path, `${where}: ${noun} “${value.trim()}” does not appear as a whole word in ${field(role[1])}.`);
          }
        }
      }
    }

    // Nav: exactly the five targets, in page order; both labels required.
    const nav = content.nav;
    if (!Array.isArray(nav)) {
      add('nav', `${LABELS.nav}: the nav list is missing.`);
    } else {
      const targets = nav.map((item) => (isObject(item) ? item.target : undefined));
      if (targets.join('|') !== NAV_TARGETS.join('|')) {
        add('nav', `${LABELS.nav}: the nav must link to ${NAV_TARGETS.join(', ')} in that order (labels are editable, links are not).`);
      }
      nav.forEach((item, i) => {
        if (!isObject(item)) return;
        const name = item.target || `item ${i + 1}`;
        if (blank(item.label)) add(`nav.${i}.label`, `${LABELS.nav}: the header label for “${name}” is required.`);
        if (blank(item.footerLabel)) add(`nav.${i}.footerLabel`, `${LABELS.nav}: the footer label for “${name}” is required.`);
      });
    }

    const hero = isObject(content.hero) ? content.hero : {};
    checkStringList(add, hero.chips, 'hero.chips', LABELS.hero, 'chips', 0, 8);

    // Approach steps: 1–6, title + body each.
    const approach = isObject(content.approach) ? content.approach : {};
    if (!Array.isArray(approach.steps)) {
      add('approach.steps', `${LABELS.approach}: the steps list is missing.`);
    } else {
      const steps = approach.steps;
      if (steps.length < 1) add('approach.steps', `${LABELS.approach}: add at least 1 step.`);
      if (steps.length > 6) add('approach.steps', `${LABELS.approach}: at most 6 steps (there are ${steps.length}).`);
      steps.forEach((step, i) => {
        const s = isObject(step) ? step : {};
        if (blank(s.title)) add(`approach.steps.${i}.title`, `${LABELS.approach}: step ${i + 1} needs a title.`);
        if (blank(s.body)) add(`approach.steps.${i}.body`, `${LABELS.approach}: step ${i + 1} needs its text.`);
      });
    }

    const conditions = isObject(content.conditions) ? content.conditions : {};
    checkStringList(add, conditions.caseStats, 'conditions.caseStats', LABELS.conditions, 'case stats', 0, 4);

    const watch = isObject(content.watch) ? content.watch : {};
    checkStringList(add, watch.items, 'watch.items', LABELS.watch, 'symptoms', 1, 16);

    // Chat: condition chips 0–6; exactly the four fixed questions, in order.
    const chat = isObject(content.chat) ? content.chat : {};
    checkStringList(add, chat.conditions, 'chat.conditions', LABELS.chat, 'condition chips', 0, 6);
    if (!Array.isArray(chat.questions)) {
      add('chat.questions', `${LABELS.chat}: the questions list is missing.`);
    } else {
      const keys = chat.questions.map((q) => (isObject(q) ? q.key : undefined));
      if (keys.join('|') !== QUESTION_KEYS.join('|')) {
        add('chat.questions', `${LABELS.chat}: the questions must be ${QUESTION_KEYS.join(', ')} in that order (wording is editable, the questions are not).`);
      }
      chat.questions.forEach((q, i) => {
        if (!isObject(q)) return;
        const name = QUESTION_NAMES[q.key] || `question ${i + 1}`;
        if (blank(q.prompt)) add(`chat.questions.${i}.prompt`, `${LABELS.chat}: the ${name} question is required.`);
        if (blank(q.placeholder)) add(`chat.questions.${i}.placeholder`, `${LABELS.chat}: the ${name} answer hint is required.`);
        if (!blank(q.bold) && !blank(q.prompt) && !accentMatches(q.prompt, q.bold.trim())) {
          add(`chat.questions.${i}.bold`, `${LABELS.chat}: the bold part “${q.bold.trim()}” does not appear as a whole word in the ${name} question.`);
        }
      });
    }

    return errors;
  };

  // ---------------------------------------------------------- treatment.json

  const TREATMENT_PHOTO = /^assets\/treatment\/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/;

  const validateTreatmentDetailed = (list) => {
    const { errors, add } = collector();
    if (!Array.isArray(list)) {
      add('', 'In therapy: the patient list is missing or is not a list.');
      return errors;
    }
    const seen = new Map(); // photo path -> patient number that first used it
    list.forEach((patient, i) => {
      const who = `patient ${i + 1}`;
      if (!isObject(patient)) {
        add(`${i}`, `In therapy: ${who} is not a valid entry.`);
        return;
      }
      if (blank(patient.location)) add(`${i}.location`, `In therapy: ${who} needs a location.`);
      if (patient.label !== undefined && typeof patient.label !== 'string') {
        add(`${i}.label`, `In therapy: ${who}'s label must be text.`);
      }
      const photos = patient.photos;
      if (!Array.isArray(photos) || photos.length < 1) {
        add(`${i}.photos`, `In therapy: ${who} needs at least 1 photo.`);
        return;
      }
      if (photos.length > 3) add(`${i}.photos`, `In therapy: ${who} has ${photos.length} photos — at most 3.`);
      photos.forEach((photo, j) => {
        const path = `${i}.photos.${j}`;
        if (typeof photo !== 'string' || !TREATMENT_PHOTO.test(photo)) {
          add(path, `In therapy: ${who}, photo ${j + 1} must be a .webp under assets/treatment/ (got “${String(photo)}”).`);
          return;
        }
        if (seen.has(photo)) {
          const first = seen.get(photo);
          add(path, first === i
            ? `In therapy: ${who} uses the same photo twice (${photo}).`
            : `In therapy: ${who} reuses patient ${first + 1}'s photo (${photo}).`);
        } else {
          seen.set(photo, i);
        }
      });
    });
    return errors;
  };

  // -------------------------------------------------------------- films.json

  const FILM_SRC = /^assets\/conditions\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/;
  const FILM_POSTER = /^assets\/conditions\/[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/;
  // Up to 999 minutes: media-tools formatDuration writes 100:05 for a long clip.
  const FILM_DURATION = /^\d{1,3}:[0-5]\d$/;

  const validateFilmsDetailed = (list) => {
    const { errors, add } = collector();
    if (!Array.isArray(list)) {
      add('', 'Videos: the video list is missing or is not a list.');
      return errors;
    }
    const srcs = new Map();
    let featured = 0;
    list.forEach((film, i) => {
      const which = `video ${i + 1}`;
      if (!isObject(film)) {
        add(`${i}`, `Videos: ${which} is not a valid entry.`);
        return;
      }
      if (typeof film.src !== 'string' || !FILM_SRC.test(film.src)) {
        add(`${i}.src`, `Videos: ${which} must be an .mp4 under assets/conditions/ (got “${String(film.src)}”).`);
      } else if (srcs.has(film.src)) {
        add(`${i}.src`, `Videos: ${which} is the same clip as video ${srcs.get(film.src) + 1} (${film.src}).`);
      } else {
        srcs.set(film.src, i);
      }
      if (typeof film.poster !== 'string' || !FILM_POSTER.test(film.poster)) {
        add(`${i}.poster`, `Videos: ${which} needs a .jpg poster under assets/conditions/ (got “${String(film.poster)}”).`);
      }
      if (typeof film.duration !== 'string' || !FILM_DURATION.test(film.duration)) {
        add(`${i}.duration`, `Videos: ${which}'s duration must look like 0:06 (got “${String(film.duration)}”).`);
      }
      if (blank(film.caption)) add(`${i}.caption`, `Videos: ${which} needs a caption.`);
      if (film.featured !== undefined && typeof film.featured !== 'boolean') {
        add(`${i}.featured`, `Videos: ${which}'s featured flag must be true or false.`);
      }
      if (film.featured === true) featured += 1;
    });
    if (featured > 1) add('', `Videos: only one video can be featured (${featured} are).`);
    return errors;
  };

  // ------------------------------------------- site-config.json seo extras

  // seo.knowsAbout / seo.areaServed feed the Organization JSON-LD; seo.imageAlt
  // is the og:image:alt + twitter:image:alt text. title and description are the
  // page <title> and meta/share description: required, and a value of only
  // spaces is blank. Optional: seo.alternateName ("Also known as", absent =
  // DEFAULT_ALTERNATE_NAME, blank = none) and seo.googleVerification (the
  // Search Console HTML-tag code, blank = no tag).
  const DEFAULT_ALTERNATE_NAME = 'MediVasc India';
  const alternateNameOf = (seo) => {
    const value = isObject(seo) ? seo.alternateName : undefined;
    return typeof value === 'string' ? value.trim() : DEFAULT_ALTERNATE_NAME;
  };
  // Google's codes are letters, digits, "-" and "_" (about 43 characters).
  const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{10,100}$/;

  const validateSeoDetailed = (seo) => {
    const { errors, add } = collector();
    if (!isObject(seo)) {
      add('', 'SEO: the SEO settings are missing.');
      return errors;
    }
    const lines = (key, what, min, max) => {
      const list = seo[key];
      if (!Array.isArray(list)) {
        add(key, `SEO: the ${what} list is missing.`);
        return;
      }
      if (list.length < min) add(key, `SEO: ${what} needs at least ${min === 1 ? 'one line' : `${min} lines`}.`);
      if (list.length > max) add(key, `SEO: at most ${max} ${what} (there are ${list.length}).`);
      list.forEach((item, i) => {
        if (blank(item)) add(`${key}.${i}`, `SEO: ${what} line ${i + 1} is empty.`);
      });
      const seen = new Set();
      list.forEach((item, i) => {
        const k = String(item).trim().toLowerCase();
        if (k && seen.has(k)) add(`${key}.${i}`, `SEO: “${String(item).trim()}” is listed twice in ${what}.`);
        seen.add(k);
      });
    };
    if (blank(seo.title)) add('title', 'SEO: the SEO title is required.');
    if (blank(seo.description)) add('description', 'SEO: the SEO description is required.');
    lines('knowsAbout', 'conditions treated', 1, 30);
    lines('areaServed', 'areas served', 1, 10);
    if (blank(seo.imageAlt)) add('imageAlt', 'SEO: the share-image description is required.');
    if (seo.alternateName !== undefined) {
      if (typeof seo.alternateName !== 'string') add('alternateName', 'SEO: “also known as” must be text.');
      else if (seo.alternateName.trim().length > 80) add('alternateName', 'SEO: “also known as” is too long (80 characters at most).');
    }
    if (seo.googleVerification !== undefined && seo.googleVerification !== '') {
      if (typeof seo.googleVerification !== 'string' || !VERIFICATION_TOKEN.test(seo.googleVerification)) {
        add('googleVerification', 'SEO: the Google Search Console code does not look right. Paste the code from the HTML tag (the part inside content="…").');
      }
    }
    return errors;
  };

  // ------------------------------------------- site-config.json hero copy

  // heroHeadline / heroAccent / heroSub / heroStats, edited on the admin Page tab.
  //
  // The site wraps the headline in its own curly quotes and strips any the owner
  // typed (src/template.js, Lesson 23), so the headline checks run on the
  // stripped text: a headline of only quote marks is blank, and the highlight
  // must match the text accentuate() is actually given.
  //
  // Counter tiles: src/styles.css lays .hero__stats out as a fixed three-column
  // grid at every breakpoint, so a fourth tile would wrap onto an orphan row —
  // at most three. Zero is fine (the template omits the strip), and so are one
  // or two (the admin lets the owner hide a single tile). The template silently
  // drops a tile missing its number or label; here that is an error, so a
  // half-filled tile cannot vanish unnoticed. An absent icon falls back to
  // `pulse` on the site; a present one must be a glyph the site draws.
  // STAT_ICONS is the one list of those glyphs: template.js and the admin's
  // icon picker both read it from here.
  const STAT_ICONS = ['pulse', 'clipboard', 'clock', 'heart', 'shield', 'users'];
  const HERO_STATS_MAX = 3;
  // Only ONE matching pair that wraps the whole headline is removed ("…", “…”,
  // '…', ‘…’), so the closing mark of an inner quotation stays: `Doctors said
  // "amputate"` is left as typed. The pair wraps the whole headline when the
  // opening mark's partner is the last character — no unmatched closing mark
  // in between. An apostrophe between two letters (Don’t) is not a mark.
  const QUOTE_PAIRS = { '"': '"', '“': '”', "'": "'", '‘': '’' };
  const stripHeadlineQuotes = (value) => {
    const text = String(value ?? '').trim();
    const chars = Array.from(text);
    const open = chars[0];
    const close = QUOTE_PAIRS[open];
    if (!close || chars.length < 2 || chars[chars.length - 1] !== close) return text;
    const inner = chars.slice(1, -1);
    const letter = /[\p{L}\p{N}]/u;
    let depth = 0;
    for (let i = 0; i < inner.length; i += 1) {
      const c = inner[i];
      if (c !== open && c !== close) continue;
      if ((c === '’' || c === "'") && letter.test(inner[i - 1] || '') && letter.test(inner[i + 1] || '')) continue;
      if (c === open && open !== close) depth += 1;
      else if (depth === 0) return text;
      else depth -= 1;
    }
    return depth === 0 ? inner.join('').trim() : text;
  };

  const validateHeroDetailed = (config) => {
    const { errors, add } = collector();
    const where = LABELS.hero;
    if (!isObject(config)) {
      add('', `${where}: the site settings are missing.`);
      return errors;
    }
    // A text field's value ('' when absent), or null when it is not text.
    const text = (key, what) => {
      const value = config[key];
      if (value === undefined) return '';
      if (typeof value === 'string') return value;
      add(key, `${where}: ${what} must be text.`);
      return null;
    };
    const rawHeadline = text('heroHeadline', 'the headline');
    const headline = rawHeadline === null ? '' : stripHeadlineQuotes(rawHeadline);
    if (rawHeadline !== null && !headline) add('heroHeadline', `${where}: the headline is required.`);
    const accent = (text('heroAccent', 'the highlighted words') || '').trim();
    if (accent && headline && !accentMatches(headline, accent)) {
      add('heroAccent', `${where}: the highlighted words “${accent}” do not appear as whole words in the headline.`);
    }
    const sub = text('heroSub', 'the supporting line');
    if (sub !== null && blank(sub)) add('heroSub', `${where}: the supporting line is required.`);

    const stats = config.heroStats;
    if (stats === undefined) return errors;
    if (!Array.isArray(stats)) {
      add('heroStats', `${where}: the counter tiles are not a valid list.`);
      return errors;
    }
    if (stats.length > HERO_STATS_MAX) {
      add('heroStats', `${where}: at most ${HERO_STATS_MAX} counter tiles fit the hero (there are ${stats.length}).`);
    }
    stats.forEach((stat, i) => {
      const tile = `counter tile ${i + 1}`;
      if (!isObject(stat)) {
        add(`heroStats.${i}`, `${where}: ${tile} is not valid.`);
        return;
      }
      if (stat.icon !== undefined && !STAT_ICONS.includes(stat.icon)) {
        add(`heroStats.${i}.icon`, `${where}: ${tile}'s icon “${String(stat.icon)}” is not one the site draws (use ${STAT_ICONS.join(', ')}).`);
      }
      for (const [key, what] of [['value', 'number'], ['label', 'label']]) {
        const value = stat[key];
        if (value !== undefined && typeof value !== 'string') add(`heroStats.${i}.${key}`, `${where}: ${tile}'s ${what} must be text.`);
        else if (blank(value)) add(`heroStats.${i}.${key}`, `${where}: ${tile} needs a ${what}.`);
      }
    });
    return errors;
  };

  // --------------------------------------------- company.json hours (JSON-LD)

  // company.hours is the Company tab's "Support hours", written the way people
  // write opening hours. The build publishes it as schema.org
  // openingHoursSpecification; the Company tab shows how it was read. Accepted:
  //   segments split by ; , & or "and"     Mon–Fri 9am–6pm; Sat 10am–2pm
  //   days: Mon…Sun or full names, ranges with - – — "to" "through", Daily,
  //         Every day, Weekdays, Weekends; several days: "Mon, Wed, Fri 10–14"
  //   times: 24-hour (10:00, 10.30, 19) or am/pm (9am, 6:30 pm, noon), joined
  //         by - – — "to". "9–6pm": the bare side takes the am/pm that keeps
  //         opening before closing (9am–6pm).
  //   a times-only segment adds a second window to the days before it
  //   ("Mon–Fri 9am–1pm, 2pm–6pm"); "Sun closed" / "Closed Sunday" is allowed
  //   and publishes nothing for that day (unlisted days read as closed anyway).
  // Rejected with an owner-readable message: closing at or before opening (so
  // no hours past midnight; "10–7" must be written 10am–7pm or 10:00–19:00),
  // overlapping times on one day, a day both open and closed, unknown words.
  const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const HOURS_EXAMPLE = '“Mon–Sat 10:00–19:00”';
  const DAY_GROUPS = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [0, 1, 2, 3, 4], weekends: [5, 6] };
  const TIME = '(?:\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm)?|noon|midday)';
  const TIME_RANGE = `(${TIME})\\s*(?:-|to|until|till)\\s*(${TIME})`;
  const RANGE_AT_END = new RegExp(`^(.*?)\\s*${TIME_RANGE}$`);
  const RANGE_AT_START = new RegExp(`^${TIME_RANGE}\\s*(.*)$`);

  const hoursError = (text) => ({ specs: [], closed: [], reading: '', error: `Company: in the support hours, ${text}` });

  // A day word the owner typed that is not a day, quoted as typed; a piece
  // with no digits at all is not hours text, so it is quoted whole.
  const notADay = (piece, word) => {
    if (!/\d/.test(piece)) return hoursError(`“${piece}” cannot be read as days and times. Write it like ${HOURS_EXAMPLE}.`);
    const typed = piece.slice(piece.toLowerCase().indexOf(word), piece.toLowerCase().indexOf(word) + word.length) || word;
    return hoursError(`“${typed}” is not a day. Use Mon, Tue, Wed, Thu, Fri, Sat, Sun, or Daily.`);
  };

  const dayIndex = (word) => {
    if (word === 'weds') return 2;
    if (word.length < 3) return -1;
    return WEEK.findIndex((day) => day.toLowerCase().startsWith(word));
  };

  // "mon-sat", "mon wed fri", "weekdays" -> [0..6] indexes, or { bad: word }.
  const readDays = (spec) => {
    const text = spec
      .replace(/\b(every ?day|all days|all week|(?:7|seven) days(?: a week)?)\b/g, 'daily')
      .replace(/\s*\b(?:to|through|thru|till|until)\b\s*/g, '-')
      .replace(/\s*-\s*/g, '-')
      .replace(/[:/]/g, ' ')
      .trim();
    const days = [];
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (DAY_GROUPS[word]) { days.push(...DAY_GROUPS[word]); continue; }
      const ends = word.split('-').map((part) => part.replace(/\.$/, ''));
      if (ends.length > 2 || ends.some((part) => dayIndex(part) < 0)) {
        return { bad: ends.find((part) => dayIndex(part) < 0) || word };
      }
      const [from, to = from] = ends.map(dayIndex);
      for (let i = from; ; i = (i + 1) % 7) { days.push(i); if (i === to) break; }
    }
    return { days: [...new Set(days)].sort((a, b) => a - b) };
  };

  // "9", "6:30 pm", "19.00", "noon" -> { hour, minute, half } (half = am/pm or '').
  const readTime = (text) => {
    if (/^(noon|midday)$/.test(text)) return { hour: 12, minute: 0, half: 'pm' };
    const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(text);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const half = match[3] || '';
    if (minute > 59 || (half ? hour < 1 || hour > 12 : hour > 23)) return null;
    return { hour, minute, half };
  };
  const minutesOf = ({ hour, minute }, half) => {
    if (!half) return hour * 60 + minute;
    return ((hour % 12) + (half === 'pm' ? 12 : 0)) * 60 + minute;
  };
  const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  // Opening/closing in minutes. A bare hour (1-12, no am/pm) next to an am/pm
  // one takes the same half when that keeps opening first, else the other half.
  const readWindow = (openText, closeText) => {
    const open = readTime(openText);
    const close = readTime(closeText);
    if (!open || !close) return { badTime: !open ? openText : closeText };
    let opens = minutesOf(open, open.half);
    let closes = minutesOf(close, close.half);
    const flip = (half) => (half === 'am' ? 'pm' : 'am');
    if (!open.half && close.half && open.hour >= 1 && open.hour <= 12) {
      opens = minutesOf(open, close.half);
      if (opens >= closes) opens = minutesOf(open, flip(close.half));
    } else if (open.half && !close.half && close.hour >= 1 && close.hour <= 12) {
      closes = minutesOf(close, open.half);
      if (closes <= opens) closes = minutesOf(close, flip(open.half));
    }
    return { opens, closes };
  };

  const listWords = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
  const dayList = (days) => {
    if (days.length === 7) return 'Every day';
    const runs = [];
    for (const day of days) {
      const run = runs[runs.length - 1];
      if (run && day === run[run.length - 1] + 1) run.push(day);
      else runs.push([day]);
    }
    return listWords(runs.flatMap((run) => (run.length >= 3
      ? [`${WEEK[run[0]]} to ${WEEK[run[run.length - 1]]}`]
      : run.map((day) => WEEK[day]))));
  };

  // -> { specs: [{ days: ['Monday', …], opens: 'HH:MM', closes: 'HH:MM' }],
  //      closed: ['Sunday'], reading: 'Monday to Saturday, 10:00 to 19:00', error }
  // Blank text -> no specs, no error. error is an owner-readable message.
  const parseHours = (value) => {
    const source = typeof value === 'string' ? value.trim() : '';
    if (!source) return { specs: [], closed: [], reading: '', error: null };
    const pieces = source.split(/\s*(?:[;,&\n]|\band\b)\s*/i).filter(Boolean);
    const windows = [];
    const closed = new Set();
    let pending = [];
    let pendingText = '';
    let lastDays = null;
    for (const piece of pieces) {
      const text = piece.toLowerCase()
        .replace(/[–—−]/g, '-')
        .replace(/\b([ap])\.?\s?m\b\.?/g, '$1m')
        .replace(/\b12\s*noon\b/g, 'noon')
        .replace(/\s+/g, ' ')
        .replace(/[.:]$/, '')
        .trim();
      if (/\bclosed\b/.test(text)) {
        const read = readDays(text.replace(/\bclosed\b/, ' ').trim());
        if (read.bad) return notADay(piece, read.bad);
        for (const day of [...pending, ...(read.days || [])]) closed.add(day);
        pending = [];
        pendingText = '';
        continue;
      }
      const atEnd = RANGE_AT_END.exec(text);
      const atStart = atEnd ? null : RANGE_AT_START.exec(text);
      if (!atEnd && !atStart) {
        if (/\d/.test(text)) return hoursError(`the times in “${piece}” cannot be read. Write them as opening–closing, e.g. 10:00–19:00.`);
        const read = readDays(text);
        if (read.bad) return notADay(piece, read.bad);
        pending.push(...read.days);
        pendingText = pendingText ? `${pendingText}, ${piece}` : piece;
        continue;
      }
      const [daysText, openText, closeText] = atEnd ? atEnd.slice(1) : [atStart[3], atStart[1], atStart[2]];
      const read = readDays(daysText);
      if (read.bad) return notADay(piece, read.bad);
      let days = [...new Set([...pending, ...read.days])].sort((a, b) => a - b);
      if (!days.length) {
        if (!lastDays) return hoursError(`“${piece}” does not say which days. Put the days first, e.g. ${HOURS_EXAMPLE}.`);
        days = lastDays;
      }
      const window = readWindow(openText.trim(), closeText.trim());
      if (window.badTime) return hoursError(`“${window.badTime}” is not a time. Use 24-hour (19:00) or am/pm (7pm).`);
      if (window.closes <= window.opens) {
        return hoursError(`“${piece}” closes before it opens (${clock(window.opens)} to ${clock(window.closes)}). Write it as 10am–7pm or 10:00–19:00; hours past midnight are not supported.`);
      }
      windows.push({ days, opens: window.opens, closes: window.closes });
      lastDays = days;
      pending = [];
      pendingText = '';
    }
    if (pending.length) return hoursError(`“${pendingText}” has no times. Add them, e.g. “${pendingText} 10:00–19:00”.`);
    if (!windows.length) return hoursError(`only closed days are listed. Add the open hours, e.g. ${HOURS_EXAMPLE}.`);
    for (let day = 0; day < 7; day += 1) {
      const open = windows.filter((window) => window.days.includes(day)).sort((a, b) => a.opens - b.opens);
      if (open.length && closed.has(day)) return hoursError(`${WEEK[day]} is listed as both open and closed.`);
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].opens < open[i - 1].closes) return hoursError(`${WEEK[day]} is listed twice with overlapping times.`);
      }
    }
    // Reading: consecutive windows on the same days share one phrase.
    const phrases = [];
    for (const window of windows) {
      const times = `${clock(window.opens)} to ${clock(window.closes)}`;
      const last = phrases[phrases.length - 1];
      if (last && last.days.join() === window.days.join()) last.times.push(times);
      else phrases.push({ days: window.days, times: [times] });
    }
    const closedDays = [...closed].sort((a, b) => a - b);
    const reading = phrases.map((phrase) => `${dayList(phrase.days)}, ${listWords(phrase.times)}`)
      .concat(closedDays.length ? [`closed ${dayList(closedDays)}`] : [])
      .join('; ');
    return {
      specs: windows.map((window) => ({ days: window.days.map((day) => WEEK[day]), opens: clock(window.opens), closes: clock(window.closes) })),
      closed: closedDays.map((day) => WEEK[day]),
      reading,
      error: null,
    };
  };

  // ------------------------------------- company.json identity and numbers

  // readPhone is the one reading of a phone number for the whole site: the
  // build's tel: and wa.me links and JSON-LD telephone (src/template.js
  // phoneHref), this validator and the Company tab all use it. Numbers are
  // read the way people write them in India:
  //   spaces, dashes, dots and brackets are ignored, and "(0)" is dropped
  //   00 starts a country code, like +           0091 81309 81199
  //   a leading 0 is the trunk prefix: India     081309 81199, 011-4567 8901
  //   10 digits with no code: India              81309 81199
  //   91 and 10 digits: India                    91 81309 81199
  //   any other number needs + and its country code
  // Returns { number, error }: number is "+" and digits ('' for a blank field),
  // error is the owner-readable problem or null. A valid number has 8–15
  // digits after the +, an Indian (+91) one exactly 10, and a WhatsApp number
  // in India must be a mobile (starting 6–9).
  const PHONE_EXAMPLE = '81309 81199 or +91 81309 81199';

  const readPhone = (value, kind = 'phone') => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return { number: '', error: null };
    const what = kind === 'whatsapp' ? 'WhatsApp number' : 'phone number';
    const text = raw.replace(/\(\s*0\s*\)/g, '').replace(/[\s.()\-‐-―]/g, '');
    let number = text.replace(/^00/, '+');
    // Digits with no code are only read as Indian (10 digits, trunk 0, or 91
    // and 10 digits); anything else without a + is a mistyped number, not a
    // foreign one (9 digits must not dial Japan).
    const guessed = !number.startsWith('+') && !number.startsWith('0') && number.length !== 10 && !/^91\d{10}$/.test(number);
    if (!number.startsWith('+')) number = number.startsWith('0') ? `+91${number.slice(1)}` : number.length === 10 ? `+91${number}` : `+${number}`;
    // "+91 0 81309 81199": the trunk 0 kept after the country code.
    if (/^\+910\d{10}$/.test(number)) number = `+91${number.slice(4)}`;
    const fail = (message) => ({ number, error: `Company: ${message}` });
    if (/[/,;&|]|\bor\b/i.test(raw)) return fail(`the ${what} field holds more than one number (“${raw}”). Keep one number here.`);
    if (!/^\+\d+$/.test(number)) return fail(`the ${what} “${raw}” has characters that are not part of a number. Write it as ${PHONE_EXAMPLE}.`);
    const digits = number.slice(1);
    if (digits.startsWith('91') && digits.length !== 12 && digits.length >= 8) {
      return fail(`the ${what} “${raw}” has ${digits.length - 2} digits after +91. Indian numbers have 10.`);
    }
    if (digits.length > 15) return fail(`the ${what} “${raw}” has too many digits for one number. Keep one number here.`);
    if (guessed || !/^[1-9]\d{7,14}$/.test(digits)) {
      return fail(`the ${what} “${raw}” is not a complete number. Write it as ${PHONE_EXAMPLE}; for a number outside India, start with + and the country code.`);
    }
    if (kind === 'whatsapp' && digits.startsWith('91') && !/^91[6-9]/.test(digits)) {
      return fail(`the WhatsApp number “${raw}” is not a mobile number. WhatsApp needs a mobile; in India those start with 6, 7, 8 or 9.`);
    }
    return { number, error: null };
  };

  // The Company tab's identity and contact fields. Names and the address are
  // printed on the page (title, footer, Location row) and in the JSON-LD, so a
  // value of only spaces is blank. Phone and WhatsApp are optional, but a
  // number that is there must dial (readPhone above).
  const COMPANY_REQUIRED = [
    ['name', 'Company: the display name is required.'],
    ['legalName', 'Company: the legal name is required.'],
    ['address', 'Company: the address is required. The site shows it as your location.'],
  ];

  const validateCompanyDetailed = (company) => {
    const { errors, add } = collector();
    if (!isObject(company)) {
      add('', 'Company: the company details are missing.');
      return errors;
    }
    for (const [key, message] of COMPANY_REQUIRED) if (blank(company[key])) add(key, message);
    for (const [key, kind, what] of [['phone', 'phone', 'phone number'], ['whatsapp', 'whatsapp', 'WhatsApp number']]) {
      const value = company[key];
      if (value !== undefined && typeof value !== 'string') {
        add(key, `Company: the ${what} must be text.`);
        continue;
      }
      const { error } = readPhone(value, kind);
      if (error) add(key, error);
    }
    return errors;
  };

  // ------------------------------------------ company.json location (JSON-LD)

  // Both optional. addressParts (schema.org PostalAddress keys) replaces the
  // plain-address fallback in the JSON-LD; geo adds GeoCoordinates. Absent =
  // the build keeps its fallback. Present = must be complete enough to be true.
  const ADDRESS_KEYS = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'];

  // company.founded: blank or a four-digit year (JSON-LD foundingDate).
  // company.languages: the languages spoken, one per line in the admin; absent =
  // DEFAULT_LANGUAGES, an empty list = none published (llms.txt + JSON-LD).
  const DEFAULT_LANGUAGES = ['English', 'Hindi'];
  const languagesOf = (company) => {
    const list = isObject(company) ? company.languages : undefined;
    return Array.isArray(list) ? list.map((item) => String(item).trim()).filter(Boolean) : DEFAULT_LANGUAGES.slice();
  };

  const validateCompanyLocationDetailed = (company) => {
    const { errors, add } = collector();
    if (!isObject(company)) {
      add('', 'Company: the company details are missing.');
      return errors;
    }
    const parts = company.addressParts;
    if (parts !== undefined) {
      if (!isObject(parts)) {
        add('addressParts', 'Company: the structured address is not valid.');
      } else {
        for (const key of Object.keys(parts)) {
          if (!ADDRESS_KEYS.includes(key)) add(`addressParts.${key}`, `Company: unknown address field “${key}”.`);
          else if (typeof parts[key] !== 'string') add(`addressParts.${key}`, `Company: address field “${key}” must be text.`);
        }
        if (blank(parts.addressLocality)) add('addressParts.addressLocality', 'Company: the structured address needs a city / locality.');
        if (typeof parts.addressCountry !== 'string' || !/^[A-Z]{2}$/.test(parts.addressCountry)) {
          add('addressParts.addressCountry', 'Company: the address country must be a two-letter code, e.g. IN.');
        }
      }
    }
    const geo = company.geo;
    if (geo !== undefined) {
      const lat = isObject(geo) ? geo.latitude : undefined;
      const lng = isObject(geo) ? geo.longitude : undefined;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
        add('geo.latitude', 'Company: latitude must be a number between -90 and 90.');
      }
      if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        add('geo.longitude', 'Company: longitude must be a number between -180 and 180.');
      }
    }
    // Support hours (parseHours above): blank = no openingHoursSpecification.
    if (company.hours !== undefined && typeof company.hours !== 'string') {
      add('hours', 'Company: support hours must be text.');
    } else {
      const { error } = parseHours(company.hours);
      if (error) add('hours', error);
    }
    const founded = company.founded;
    if (founded !== undefined && founded !== null && !/^(\d{4})?$/.test(String(founded).trim())) {
      add('founded', 'Company: the founding year must be four digits, e.g. 2025, or left blank.');
    }
    const languages = company.languages;
    if (languages !== undefined) {
      if (!Array.isArray(languages)) {
        add('languages', 'Company: the languages spoken list is not valid.');
      } else {
        if (languages.length > 10) add('languages', `Company: at most 10 languages spoken (there are ${languages.length}).`);
        const seen = new Set();
        languages.forEach((item, i) => {
          if (blank(item)) add(`languages.${i}`, `Company: languages spoken line ${i + 1} is empty.`);
          const k = String(item).trim().toLowerCase();
          if (k && seen.has(k)) add(`languages.${i}`, `Company: “${String(item).trim()}” is listed twice in languages spoken.`);
          seen.add(k);
        });
      }
    }
    return errors;
  };

  // ------------------------------------- site-config.json eligibility notice

  // The "who is not eligible" notice after the symptoms list (edited on the
  // Page tab). Optional: heading and text both blank = no section. One without
  // the other is a half-configured section, not a way to hide it. The
  // highlighted words are optional; when set they must match whole words in
  // the heading, or the site would silently show it plain. Paths are relative
  // to site-config.json ("eligibility.body").
  const ELIGIBILITY_FIELDS = { heading: 'the heading', body: 'the notice text', accent: 'the highlighted word' };

  const validateEligibilityDetailed = (config) => {
    const { errors, add } = collector();
    const where = LABELS.eligibility;
    const eligibility = isObject(config) ? config.eligibility : undefined;
    if (eligibility == null) return errors;
    if (!isObject(eligibility)) {
      add('eligibility', `${where}: the notice settings are not valid.`);
      return errors;
    }
    for (const [key, name] of Object.entries(ELIGIBILITY_FIELDS)) {
      const value = eligibility[key];
      if (value !== undefined && typeof value !== 'string') add(`eligibility.${key}`, `${where}: ${name} must be text.`);
    }
    if (errors.length) return errors;
    const { heading, body, accent } = eligibility;
    if (!blank(heading) && blank(body)) add('eligibility.body', `${where}: add the notice text, or clear the heading to remove the section.`);
    if (blank(heading) && !blank(body)) add('eligibility.heading', `${where}: add a heading, or clear the notice text to remove the section.`);
    if (!blank(accent) && !blank(heading) && !accentMatches(heading, accent.trim())) {
      add('eligibility.accent', `${where}: the highlighted word “${accent.trim()}” does not appear as a whole word in the heading.`);
    }
    return errors;
  };

  // ------------------------------------------------------------------ export

  const messages = (detailed) => (value) => detailed(value).map((error) => error.message);

  const api = Object.freeze({
    validateContent: messages(validateContentDetailed),
    validateTreatment: messages(validateTreatmentDetailed),
    validateFilms: messages(validateFilmsDetailed),
    validateSeo: messages(validateSeoDetailed),
    validateHero: messages(validateHeroDetailed),
    validateCompany: messages(validateCompanyDetailed),
    validateCompanyLocation: messages(validateCompanyLocationDetailed),
    validateEligibility: messages(validateEligibilityDetailed),
    validateContentDetailed,
    validateTreatmentDetailed,
    validateFilmsDetailed,
    validateSeoDetailed,
    validateHeroDetailed,
    validateCompanyDetailed,
    validateCompanyLocationDetailed,
    validateEligibilityDetailed,
    accentMatches,
    highlightWholeWord,
    stripHeadlineQuotes,
    parseHours,
    languagesOf,
    alternateNameOf,
    DEFAULT_LANGUAGES: Object.freeze(DEFAULT_LANGUAGES.slice()),
    DEFAULT_ALTERNATE_NAME,
    readPhone,
    STAT_ICONS: Object.freeze(STAT_ICONS.slice()),
    ADDRESS_KEYS: Object.freeze(ADDRESS_KEYS.slice()),
    NAV_TARGETS: Object.freeze(NAV_TARGETS.slice()),
    QUESTION_KEYS: Object.freeze(QUESTION_KEYS.slice()),
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MediVascContentRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
