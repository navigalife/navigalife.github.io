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
//   validateBlogConfig(config)   (data/blog/config.json)
//   validateBlogPosts(posts, config, films?)  (data/blog/posts.json [+ samples.json];
//                                films = data/films.json, optional, checks video clips)
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
  // `fix` (optional) is the short "what to do here" line the admin shows under
  // the field itself; `message` stays the full sentence that says which item
  // (publish gate list, toasts, the build). Only set where a field shows it.
  const collector = () => {
    const errors = [];
    return {
      errors,
      add: (path, message, fix) => errors.push(fix ? { path, message, fix } : { path, message }),
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
      if (blank(item)) add(`${path}.${i}`, `${where}: ${what.replace(/s$/, '')} ${i + 1} is empty. Fill it in or remove it.`);
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
      if (photos.length > 3) add(`${i}.photos`, `In therapy: ${who} has ${photos.length} photos. The most it can have is 3.`);
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

  // -------------------------------------------------------------------- blog
  // data/blog/config.json and posts.json (+ samples.json). These validators ARE the
  // schema (AGENTS.md "The blog" points here); renderers and admin follow these enums.

  const TINTS = ['teal', 'clay', 'sage', 'ochre', 'slate', 'plum'];
  const LAYOUTS = ['editorial', 'cover', 'split', 'guide'];
  const BLOCK_TYPES = [
    'paragraph', 'lead', 'heading', 'list', 'quote', 'pullquote', 'image', 'gallery',
    'imageText', 'callout', 'takeaways', 'divider', 'table', 'video', 'faq', 'cta',
  ];
  const BLOG_ENUMS = {
    status: ['published', 'scheduled', 'unpublished'],
    titleSize: ['S', 'M', 'L', 'XL'],
    bodySize: ['S', 'M', 'L'],
    leadIn: ['dropcap', 'smallcaps', 'boldwords', 'none'],
    headingSize: ['S', 'M', 'L'],
    imageWidth: ['column', 'wide', 'full'],
    imageAlign: ['center', 'left', 'right'],
    imageSize: ['S', 'M', 'L'],
    side: ['left', 'right'],
    calloutTone: ['doctor', 'tip', 'note'],
    listStyle: ['bullet', 'number'],
    ctaKind: ['whatsapp', 'call', 'contact'],
    videoSource: ['film', 'youtube'],
  };
  // Owner-facing block names (the editor's block picker uses the same words).
  const BLOCK_LABELS = {
    paragraph: 'Paragraph', lead: 'Intro paragraph', heading: 'Heading', list: 'List',
    quote: 'Quote', pullquote: 'Pull quote', image: 'Image', gallery: 'Gallery',
    imageText: 'Image with text', callout: 'Callout box', takeaways: 'Key takeaways',
    divider: 'Divider', table: 'Table', video: 'Video', faq: 'Questions', cta: 'Contact button',
  };
  // Post addresses that would collide with the blog's own pages.
  const RESERVED_BLOG_SLUGS = ['category', 'author', 'feed.xml'];
  const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const BLOG_ID = /^[A-Za-z0-9_-]+$/;
  const BLOG_ANCHOR = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  const BLOG_IMAGE = /^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:webp|jpe?g|png|avif)$/i;
  const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
  const ISO_WITH_OFFSET = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
  // Raw HTML in text (renderers escape everything, so a tag would show as code).
  const HTML_TAG = /<\/?[A-Za-z][^<>]*>|<!--/;
  const INLINE_KEYS = ['t', 'b', 'i', 'hl', 'href', 'cite'];
  const MARK_NAMES = { b: 'bold', i: 'italic', hl: 'highlight' };
  // Link targets the renderers keep: anything else is dropped.
  const BLOG_HREFS = [
    /^https:\/\/[^\s<>"]+$/,
    /^mailto:[^\s<>"@]+@[^\s<>"@]+$/,
    /^tel:\+?[0-9][0-9 ()-]*$/,
    /^blog\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:#[A-Za-z0-9_-]+)?$/,
    /^#[A-Za-z0-9][A-Za-z0-9_-]*$/,
  ];

  const isIsoWithOffset = (value) =>
    typeof value === 'string' && ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value));
  const blogHrefAllowed = (href) => typeof href === 'string' && BLOG_HREFS.some((re) => re.test(href));

  // THE "was this post updated?" rule, shared by the build (src/blog/seo.js
  // re-exports it for the byline, article:modified_time, JSON-LD dateModified,
  // sitemap lastmod, RSS lastBuildDate) and the admin preview (blog-seo.js
  // enrichPost), so the preview never shows an "Updated" the site won't.
  // updatedAt counts only when its calendar day in IST (the clinic's zone, like
  // every date label) is LATER than the publish day. A same-day republish (the
  // admin stamps updatedAt on every save) and an updatedAt left from before a
  // republish or reschedule (earlier than publishAt) both count as no update.
  // Returns the raw value (a typed +05:30 offset survives into JSON-LD), or ''.
  // Reads updatedAt/publishAt, or the enriched post's updated/published Dates.
  const blogDateOf = (value) => {
    const date = value instanceof Date ? value : new Date(typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const istDay = (date) => new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
  const updatedAtOf = (post) => {
    const raw = post ? post.updatedAt || post.updated : '';
    const updated = raw ? blogDateOf(raw) : null;
    const published = post ? blogDateOf(post.publishAt || post.published) : null;
    return updated && published && istDay(updated) > istDay(published) ? raw : '';
  };
  const asList = (value) => (Array.isArray(value) ? value : []);
  const shortTitle = (title) => {
    const t = title.trim();
    return t.length > 60 ? `${t.slice(0, 58).replace(/\s+\S*$/, '')}…` : t;
  };
  const optionalText = (obj, key, path, label, add) => {
    if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] !== 'string') add(path, `${label} must be text.`);
  };
  const tagIn = (text) => {
    const match = HTML_TAG.exec(text);
    return match ? match[0].slice(0, 40) : null;
  };

  // Inline text: a plain string, or runs [{ t, b, i, hl, href } | { cite }].
  // Reports problems through add(); returns true when it carries visible text.
  const checkInline = (value, path, where, add, refIds) => {
    if (typeof value === 'string') {
      const tag = tagIn(value);
      if (tag) add(path, `${where} contains HTML code (“${tag}”). Use the editor's formatting buttons instead.`);
      return value.trim() !== '';
    }
    if (!Array.isArray(value)) {
      add(path, `${where} is not valid text.`);
      return false;
    }
    let visible = false;
    value.forEach((run, k) => {
      const at = `${path}.${k}`;
      if (!isObject(run)) {
        add(at, `${where}: part ${k + 1} of the text is not valid.`);
        return;
      }
      const unknown = Object.keys(run).filter((key) => !INLINE_KEYS.includes(key));
      if (unknown.length) add(at, `${where}: part ${k + 1} has unknown formatting (${unknown.join(', ')}).`);
      if (run.cite !== undefined) {
        if (Object.keys(run).some((key) => key !== 'cite')) {
          add(at, `${where}: a citation number cannot also carry text, a link or formatting.`);
        }
        if (blank(run.cite)) add(`${at}.cite`, `${where}: a citation does not say which reference it points to.`);
        else if (!refIds.has(run.cite)) {
          add(`${at}.cite`, `${where}: cites reference “${run.cite}”, which is not in this post's references list.`);
        }
        return;
      }
      if (typeof run.t !== 'string') {
        add(`${at}.t`, `${where}: part ${k + 1} of the text is empty or not text.`);
        return;
      }
      const tag = tagIn(run.t);
      if (tag) add(`${at}.t`, `${where} contains HTML code (“${tag}”). Use the editor's formatting buttons instead.`);
      if (run.t.trim() !== '') visible = true;
      for (const mark of Object.keys(MARK_NAMES)) {
        if (run[mark] !== undefined && typeof run[mark] !== 'boolean') {
          add(`${at}.${mark}`, `${where}: the ${MARK_NAMES[mark]} setting on “${run.t.slice(0, 30)}” is not valid.`);
        }
      }
      if (run.href !== undefined && !blogHrefAllowed(run.href)) {
        add(`${at}.href`, `${where}: the link “${String(run.href).slice(0, 60)}” is not allowed. Use a full https:// address, mailto:, tel:, another post (blog/post-address/) or a #section link.`);
      }
    });
    return visible;
  };

  // No words and no citation: an empty paragraph or list item (Enter at the end
  // of the text). blog-blocks.js renders nothing for it, so it never blocks.
  const blankInline = (value) => (typeof value === 'string' ? value.trim() === ''
    : Array.isArray(value) && value.every((run) => isObject(run) && run.cite === undefined && typeof run.t === 'string' && run.t.trim() === ''));

  const requireInline = (value, path, where, add, refIds, what) => {
    if (value === undefined || value === null) {
      add(path, `${where} needs ${what}.`);
      return;
    }
    if (!checkInline(value, path, where, add, refIds) && (typeof value === 'string' || Array.isArray(value))) {
      add(path, `${where} needs ${what}.`);
    }
  };

  const checkInlineList = (items, path, where, add, refIds, { min = 1, what = 'item', skipBlank = false } = {}) => {
    if (!Array.isArray(items) || items.length < min) {
      add(path, `${where} needs at least ${min} ${what}${min === 1 ? '' : 's'}.`);
      return;
    }
    items.forEach((item, k) => {
      if (skipBlank && blankInline(item)) return;
      requireInline(item, `${path}.${k}`, `${where}, ${what} ${k + 1}`, add, refIds, 'some text');
    });
  };

  const checkBlogImage = (img, path, where, add, refIds) => {
    if (!isObject(img)) {
      add(path, `${where}: choose an image.`);
      return;
    }
    if (blank(img.src)) {
      add(`${path}.src`, `${where}: choose an image.`);
      return; // one problem for an empty photo slot, not one per field
    }
    if (!BLOG_IMAGE.test(img.src)) {
      add(`${path}.src`, `${where}: the image “${img.src}” must be a .webp, .jpg, .png or .avif file inside assets/.`);
    }
    if (blank(img.alt)) {
      add(`${path}.alt`, `${where}: fill in “Describe the photo” (it is read aloud to people who cannot see the photo, and Google reads it too).`);
    } else {
      const tag = tagIn(img.alt);
      if (tag) add(`${path}.alt`, `${where}: the photo description contains HTML code (“${tag}”).`);
    }
    if (img.caption !== undefined && img.caption !== null) checkInline(img.caption, `${path}.caption`, `${where} caption`, add, refIds);
    optionalText(img, 'credit', `${path}.credit`, `${where}: the photo credit`, add);
    if (img.patient !== undefined && typeof img.patient !== 'boolean') add(`${path}.patient`, `${where}: the “patient photo” setting is not valid.`);
    // A patient photo is marked the moment it is ticked (patient: true keeps it out
    // of share cards and search images at once); consent is its own tick, and
    // only consent: false blocks publishing. A patient photo saved before the
    // consent field existed was only ever marked after consent, so it passes.
    if (img.consent !== undefined && typeof img.consent !== 'boolean') add(`${path}.consent`, `${where}: the “consent on file” setting is not valid.`);
    else if (img.patient === true && img.consent === false) {
      const post = /^(Blog post (?:“[^”]*”|\d+(?: \([^)]*\))?))(?:,\s*|:\s*)(.*)$/.exec(where);
      const name = blank(img.alt) ? (post ? post[2] : where) : img.alt.trim().slice(0, 60);
      add(`${path}.consent`, `${post ? `${post[1]}: ` : ''}Tick the consent box for the patient photo “${name}” before publishing.`);
    }
  };

  const checkEnum = (value, allowed, path, label, add, { required = true } = {}) => {
    if (value === undefined || value === null) {
      if (required) add(path, `${label} is not set (choose ${allowed.join(', ')}).`);
      return false;
    }
    if (!allowed.includes(value)) {
      add(path, `${label} “${String(value)}” is not one of: ${allowed.join(', ')}.`);
      return false;
    }
    return true;
  };

  // How a message names a block: the editor shows no block numbers, so name it the way the admin sees it,
  // by its kind and opening words: “paragraph 2 (“Compression stockings help…”)”. The number counts blocks
  // of that kind and only appears when the post has more than one.
  const WORDLESS_KEYS = new Set(['type', 'level', 'size', 'style', 'width', 'align', 'tone', 'kind', 'side',
    'source', 'src', 'youtube', 'anchor', 'focal', 'patient', 'credit', 'href', 'cite']);
  const firstWords = (value) => {
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
    if (Array.isArray(value)) {
      if (value.some((r) => isObject(r) && typeof r.t === 'string')) {
        return value.map((r) => (isObject(r) && typeof r.t === 'string' ? r.t : '')).join('').replace(/\s+/g, ' ').trim();
      }
      for (const item of value) { const words = firstWords(item); if (words) return words; }
      return '';
    }
    if (isObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (WORDLESS_KEYS.has(key)) continue;
        const words = firstWords(item);
        if (words) return words;
      }
    }
    return '';
  };
  const blockKind = (block) => (block.type === 'heading' && block.level === 3 ? 'Subheading' : BLOCK_LABELS[block.type]);
  const blockName = (blocks, j) => {
    const block = blocks[j];
    if (!isObject(block) || !BLOCK_TYPES.includes(block.type)) return `section ${j + 1}`;
    const kind = blockKind(block);
    const same = blocks.filter((b) => isObject(b) && BLOCK_TYPES.includes(b.type) && blockKind(b) === kind);
    const n = same.length > 1 ? ` ${same.indexOf(block) + 1}` : '';
    let words = firstWords(block);
    if (words.length > 32) {
      const cut = words.slice(0, 32);
      const space = cut.lastIndexOf(' ');
      words = `${(space > 12 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
    }
    return `${kind.charAt(0).toLowerCase()}${kind.slice(1)}${n}${words ? ` (“${words}”)` : ''}`;
  };

  const checkBlock = (block, path, where, add, env) => {
    const { refIds, filmSrcs, headings } = env;
    if (!isObject(block)) {
      add(path, `${where} is not a valid block.`);
      return;
    }
    if (!BLOCK_TYPES.includes(block.type)) {
      add(`${path}.type`, `${where} has an unknown block type “${String(block.type)}”.`);
      return;
    }
    const label = where;
    const E = BLOG_ENUMS;
    switch (block.type) {
      case 'paragraph':
      case 'lead':
        if (blankInline(block.text)) break; // empty: renders nothing
        requireInline(block.text, `${path}.text`, label, add, refIds, 'some text');
        break;
      case 'heading': {
        if (block.level !== 2 && block.level !== 3) {
          add(`${path}.level`, `${label}: choose Heading or Subheading.`);
        } else if (block.level === 3 && !headings.seenH2) {
          add(`${path}.level`, `${label} cannot come before the first Heading. Make it a Heading, or add a Heading above it.`);
        }
        if (block.level === 2) headings.seenH2 = true;
        if (blank(block.text)) add(`${path}.text`, `${label} needs text.`);
        else if (tagIn(block.text)) add(`${path}.text`, `${label} contains HTML code (“${tagIn(block.text)}”).`);
        checkEnum(block.size, E.headingSize, `${path}.size`, `${label}: size`, add, { required: false });
        if (block.anchor !== undefined && block.anchor !== null && block.anchor !== '') {
          if (typeof block.anchor !== 'string' || !BLOG_ANCHOR.test(block.anchor)) {
            add(`${path}.anchor`, `${label}: the section link name “${String(block.anchor)}” may only use letters, digits, - and _.`);
          } else if (headings.anchors.has(block.anchor)) {
            add(`${path}.anchor`, `${label}: the section link name “${block.anchor}” is already used by another heading in this post.`);
          } else headings.anchors.add(block.anchor);
        }
        break;
      }
      case 'list':
        if (Array.isArray(block.items) && block.items.every(blankInline)) break; // empty: renders nothing
        checkEnum(block.style, E.listStyle, `${path}.style`, `${label}: list style`, add);
        checkInlineList(block.items, `${path}.items`, label, add, refIds, { what: 'item', skipBlank: true });
        break;
      case 'quote':
        requireInline(block.text, `${path}.text`, label, add, refIds, 'the quoted words');
        optionalText(block, 'cite', `${path}.cite`, `${label}: who said it`, add);
        break;
      case 'pullquote':
        if (blank(block.text)) add(`${path}.text`, `${label} needs the quoted words (plain text).`);
        else if (tagIn(block.text)) add(`${path}.text`, `${label} contains HTML code (“${tagIn(block.text)}”).`);
        optionalText(block, 'cite', `${path}.cite`, `${label}: who said it`, add);
        break;
      case 'image': {
        checkBlogImage(block, path, label, add, refIds);
        const widthOk = checkEnum(block.width, E.imageWidth, `${path}.width`, `${label}: width`, add);
        const alignOk = checkEnum(block.align, E.imageAlign, `${path}.align`, `${label}: position`, add);
        checkEnum(block.size, E.imageSize, `${path}.size`, `${label}: size`, add, { required: false });
        if (widthOk && alignOk && block.align !== 'center' && block.width !== 'column') {
          add(`${path}.align`, `${label}: only a column-width image can sit to the left or right of the text. Make it column width, or centre it.`);
        }
        break;
      }
      case 'gallery':
        if (!Array.isArray(block.images) || block.images.length < 2 || block.images.length > 3) {
          add(`${path}.images`, `${label} needs 2 or 3 images (has ${Array.isArray(block.images) ? block.images.length : 0}).`);
        }
        asList(block.images).forEach((img, k) => checkBlogImage(img, `${path}.images.${k}`, `${label}, image ${k + 1}`, add, refIds));
        if (block.caption !== undefined && block.caption !== null) checkInline(block.caption, `${path}.caption`, `${label} caption`, add, refIds);
        break;
      case 'imageText':
        checkBlogImage(block.image, `${path}.image`, label, add, refIds);
        checkEnum(block.side, E.side, `${path}.side`, `${label}: image side`, add);
        checkInlineList(block.text, `${path}.text`, label, add, refIds, { what: 'paragraph' });
        break;
      case 'callout':
        checkEnum(block.tone, E.calloutTone, `${path}.tone`, `${label}: style`, add);
        optionalText(block, 'title', `${path}.title`, `${label}: the title`, add);
        requireInline(block.text, `${path}.text`, label, add, refIds, 'some text');
        break;
      case 'takeaways':
        optionalText(block, 'title', `${path}.title`, `${label}: the title`, add);
        checkInlineList(block.items, `${path}.items`, label, add, refIds, { what: 'point' });
        break;
      case 'divider':
        break;
      case 'table': {
        optionalText(block, 'caption', `${path}.caption`, `${label}: the caption`, add);
        const header = block.header;
        if (!Array.isArray(header) || header.length < 1) {
          add(`${path}.header`, `${label} needs column headings.`);
        } else {
          header.forEach((cell, k) => {
            if (blank(cell)) add(`${path}.header.${k}`, `${label}: column ${k + 1} needs a heading.`);
          });
        }
        if (!Array.isArray(block.rows) || block.rows.length < 1) {
          add(`${path}.rows`, `${label} needs at least 1 row.`);
          break;
        }
        block.rows.forEach((row, r) => {
          if (!Array.isArray(row)) {
            add(`${path}.rows.${r}`, `${label}: row ${r + 1} is not valid.`);
            return;
          }
          if (Array.isArray(header) && row.length !== header.length) {
            add(`${path}.rows.${r}`, `${label}: row ${r + 1} has ${row.length} cells but the table has ${header.length} columns.`);
          }
          row.forEach((cell, c) => checkInline(cell, `${path}.rows.${r}.${c}`, `${label}, row ${r + 1} cell ${c + 1}`, add, refIds));
        });
        break;
      }
      case 'video':
        if (checkEnum(block.source, E.videoSource, `${path}.source`, `${label}: source`, add)) {
          if (block.source === 'film') {
            if (blank(block.src)) add(`${path}.src`, `${label}: choose one of the site's videos.`);
            else if (filmSrcs && !filmSrcs.has(block.src)) {
              add(`${path}.src`, `${label}: “${block.src}” is not one of the site's videos (Videos tab).`);
            }
          } else if (typeof block.youtube !== 'string' || !YOUTUBE_ID.test(block.youtube)) {
            add(`${path}.youtube`, `${label}: the YouTube video id must be the 11 characters after “v=” in the video's address (got “${String(block.youtube)}”).`);
          }
        }
        if (block.caption !== undefined && block.caption !== null) checkInline(block.caption, `${path}.caption`, `${label} caption`, add, refIds);
        break;
      case 'faq':
        optionalText(block, 'title', `${path}.title`, `${label}: the title`, add);
        if (!Array.isArray(block.items) || block.items.length < 1) {
          add(`${path}.items`, `${label} needs at least 1 question.`);
          break;
        }
        block.items.forEach((item, k) => {
          const at = `${path}.items.${k}`;
          if (!isObject(item)) {
            add(at, `${label}: question ${k + 1} is not valid.`);
            return;
          }
          if (blank(item.q)) add(`${at}.q`, `${label}: question ${k + 1} needs the question.`);
          else if (tagIn(item.q)) add(`${at}.q`, `${label}: question ${k + 1} contains HTML code (“${tagIn(item.q)}”).`);
          requireInline(item.a, `${at}.a`, `${label}, question ${k + 1}`, add, refIds, 'an answer');
        });
        break;
      case 'cta':
        checkEnum(block.kind, E.ctaKind, `${path}.kind`, `${label}: button type`, add);
        optionalText(block, 'label', `${path}.label`, `${label}: the button label`, add);
        optionalText(block, 'text', `${path}.text`, `${label}: the text`, add);
        break;
      default:
        break;
    }
  };

  const validateBlogConfigDetailed = (config) => {
    const { errors, add } = collector();
    const where = 'Blog settings';
    if (!isObject(config)) {
      add('', `${where}: the blog settings file is missing or not valid.`);
      return errors;
    }
    if (blank(config.name)) add('name', `${where}: the blog needs a name.`);
    if (blank(config.navLabel)) add('navLabel', `${where}: the menu label for the blog is empty.`);
    optionalText(config, 'intro', 'intro', `${where}: the intro`, add);
    if (config.seo !== undefined) {
      if (!isObject(config.seo)) add('seo', `${where}: the search settings are not valid.`);
      else {
        optionalText(config.seo, 'title', 'seo.title', `${where}: the search title`, add);
        optionalText(config.seo, 'description', 'seo.description', `${where}: the search description`, add);
      }
    }

    const checkSlugged = (list, key, noun, extra) => {
      if (!Array.isArray(list) || list.length < 1) {
        add(key, `${where}: add at least one ${noun}.`);
        return;
      }
      const ids = new Map();
      const slugs = new Map();
      list.forEach((item, i) => {
        const at = `${key}.${i}`;
        const who = isObject(item) && !blank(item.name) ? `${noun} “${item.name.trim()}”` : `the unnamed ${noun} (number ${i + 1} in the list)`;
        if (!isObject(item)) {
          add(at, `${where}: ${who} is not valid.`);
          return;
        }
        if (blank(item.id) || !BLOG_ID.test(item.id)) add(`${at}.id`, `${where}: ${who} has a missing or invalid id.`);
        else if (ids.has(item.id)) add(`${at}.id`, `${where}: ${who} has the same id as ${ids.get(item.id)}.`);
        else ids.set(item.id, who);
        if (blank(item.name)) add(`${at}.name`, `${where}: ${who} needs a name.`, 'Add a name.');
        if (blank(item.slug)) add(`${at}.slug`, `${where}: ${who} needs a web address.`, 'Add a web address.');
        else if (typeof item.slug !== 'string' || !BLOG_SLUG.test(item.slug)) {
          add(`${at}.slug`, `${where}: the web address “${String(item.slug)}” for ${who} may only use lowercase letters, digits and single hyphens.`, 'Use only lowercase letters, digits and single hyphens.');
        } else if (slugs.has(item.slug)) {
          add(`${at}.slug`, `${where}: ${who} has the same web address as ${slugs.get(item.slug)}.`, `Another ${noun} already uses this address. Choose a different one.`);
        } else slugs.set(item.slug, who);
        extra(item, at, who);
      });
    };

    checkSlugged(config.categories, 'categories', 'category', (cat, at, who) => {
      optionalText(cat, 'intro', `${at}.intro`, `${where}: ${who}’s intro`, add);
      optionalText(cat, 'metaDescription', `${at}.metaDescription`, `${where}: ${who}’s search description`, add);
      checkEnum(cat.tint, TINTS, `${at}.tint`, `${where}: ${who}’s colour`, (path, message) => add(path, message, 'Choose a colour.'));
    });

    checkSlugged(config.authors, 'authors', 'author', (author, at, who) => {
      for (const [key, name] of [['role', 'role'], ['credentials', 'credentials'], ['bio', 'bio'], ['photo', 'photo']]) {
        optionalText(author, key, `${at}.${key}`, `${where}: ${who}’s ${name}`, add);
      }
      if (!blank(author.photo) && !BLOG_IMAGE.test(author.photo)) {
        add(`${at}.photo`, `${where}: ${who}’s photo “${author.photo}” must be an image file inside assets/.`, 'Choose the photo again.');
      }
      if (author.sameAs !== undefined) {
        if (!Array.isArray(author.sameAs)) add(`${at}.sameAs`, `${where}: ${who}’s profile links are not a list.`);
        else author.sameAs.forEach((url, k) => {
          if (typeof url !== 'string' || !/^https:\/\/[^\s<>"]+$/.test(url)) {
            add(`${at}.sameAs.${k}`, `${where}: ${who}’s profile link “${String(url)}” must be a full https:// address.`, `“${String(url)}” needs to be a full address that starts with https://.`);
          }
        });
      }
    });

    if (config.featured !== undefined) {
      if (!Array.isArray(config.featured)) add('featured', `${where}: the featured posts are not a list.`);
      else {
        const seen = new Set();
        config.featured.forEach((id, k) => {
          if (blank(id)) add(`featured.${k}`, `${where}: featured post ${k + 1} is empty.`);
          else if (seen.has(id)) add(`featured.${k}`, `${where}: a post is featured twice (“${id}”).`);
          else seen.add(id);
        });
      }
    }

    if (config.redirects !== undefined) {
      // Exactly three address forms: a post (blog/<slug>/), a category
      // (blog/category/<slug>/) or an author (blog/author/<slug>/). A bare
      // blog/category/ or blog/author/ is not a page.
      const URL_FORM = /^blog\/(?:(?:category|author)\/)?[a-z0-9]+(?:-[a-z0-9]+)*\/$/;
      const urlOk = (url) => typeof url === 'string' && URL_FORM.test(url) && !/^blog\/(?:category|author)\/$/.test(url);
      if (!Array.isArray(config.redirects)) add('redirects', `${where}: the redirects are not a list.`);
      else {
        const froms = new Set();
        config.redirects.forEach((r, k) => {
          const at = `redirects.${k}`;
          if (!isObject(r)) {
            add(at, `${where}: redirect ${k + 1} is not valid.`);
            return;
          }
          for (const key of ['from', 'to']) {
            if (!urlOk(r[key])) {
              add(`${at}.${key}`, `${where}: redirect ${k + 1} “${key}” must look like blog/post-address/, blog/category/category-address/ or blog/author/author-address/ (got “${String(r[key])}”).`);
            }
          }
          if (r.from === r.to) add(at, `${where}: redirect ${k + 1} points to itself.`);
          else if (froms.has(r.from)) add(`${at}.from`, `${where}: ${r.from} is redirected twice.`);
          froms.add(r.from);
        });
      }
    }
    return errors;
  };

  const validateBlogPostsDetailed = (posts, config, films) => {
    const { errors, add } = collector();
    if (!Array.isArray(posts)) {
      add('', 'Blog: the post list is missing or is not a list.');
      return errors;
    }
    const cfg = isObject(config) ? config : {};
    const categoryIds = new Set(asList(cfg.categories).filter(isObject).map((c) => c.id));
    const authorIds = new Set(asList(cfg.authors).filter(isObject).map((a) => a.id));
    const filmSrcs = Array.isArray(films)
      ? new Set(films.map((f) => (isObject(f) ? f.src : f)).filter((s) => typeof s === 'string'))
      : null;
    const ids = new Map(); // post id -> label
    const addresses = new Map(); // slug -> "“Title” (current address)"
    const E = BLOG_ENUMS;

    posts.forEach((post, i) => {
      const fallback = `Blog post ${i + 1}`;
      if (!isObject(post)) {
        add(`${i}`, `${fallback} is not valid.`);
        return;
      }
      const who = blank(post.title) ? fallback : `Blog post “${shortTitle(post.title)}”`;
      const p = (key) => `${i}.${key}`;

      if (blank(post.id) || !BLOG_ID.test(post.id)) add(p('id'), `${who} has a missing or invalid id.`);
      else if (ids.has(post.id)) add(p('id'), `${who} has the same id as ${ids.get(post.id)}.`);
      else ids.set(post.id, who);

      // Addresses: the current slug and every old one are unique across all posts.
      const claim = (slug, path, kind) => {
        if (typeof slug !== 'string' || !BLOG_SLUG.test(slug)) {
          add(path, `${who}: the ${kind} web address “${String(slug)}” may only use lowercase letters, digits and single hyphens.`);
          return;
        }
        if (RESERVED_BLOG_SLUGS.includes(slug)) {
          add(path, `${who}: “${slug}” is reserved for the blog’s own pages. Choose another web address.`);
          return;
        }
        if (addresses.has(slug)) {
          add(path, `${who}: the web address blog/${slug}/ is already used by ${addresses.get(slug)}.`);
          return;
        }
        addresses.set(slug, `${who.replace(/^Blog post /, '')}${kind === 'old' ? ' (as an old address)' : ''}`);
      };
      claim(post.slug, p('slug'), 'current');
      if (post.previousSlugs !== undefined) {
        if (!Array.isArray(post.previousSlugs)) add(p('previousSlugs'), `${who}: the old addresses are not a list.`);
        else post.previousSlugs.forEach((slug, k) => claim(slug, p(`previousSlugs.${k}`), 'old'));
      }

      if (checkEnum(post.status, E.status, p('status'), `${who}: status`, add)) {
        if (post.status !== 'unpublished' && !isIsoWithOffset(post.publishAt)) {
          add(p('publishAt'), `${who}: ${post.status === 'scheduled' ? 'a scheduled' : 'a published'} post needs a publish date and time with its time zone (for example 2026-11-20T09:00:00+05:30).`);
        }
      }
      if (post.status === 'unpublished' && post.publishAt !== undefined && post.publishAt !== null && post.publishAt !== '' && !isIsoWithOffset(post.publishAt)) {
        add(p('publishAt'), `${who}: the publish date “${String(post.publishAt)}” is not a valid date and time with a time zone.`);
      }
      if (post.updatedAt !== undefined && post.updatedAt !== null && post.updatedAt !== '' && !isIsoWithOffset(post.updatedAt)) {
        add(p('updatedAt'), `${who}: the “Updated” date “${String(post.updatedAt)}” is not a valid date and time with a time zone.`);
      }
      if (post.lang !== undefined && (typeof post.lang !== 'string' || !/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(post.lang))) {
        add(p('lang'), `${who}: the language “${String(post.lang)}” is not a language code such as en or hi.`);
      }

      checkEnum(post.layout, LAYOUTS, p('layout'), `${who}: layout`, add);
      checkEnum(post.titleSize, E.titleSize, p('titleSize'), `${who}: title size`, add);
      checkEnum(post.bodySize, E.bodySize, p('bodySize'), `${who}: text size`, add);
      checkEnum(post.leadIn, E.leadIn, p('leadIn'), `${who}: opening style`, add);

      if (blank(post.category)) add(p('category'), `${who} needs a category.`);
      else if (!categoryIds.has(post.category)) add(p('category'), `${who}: its category “${post.category}” no longer exists. Choose another.`);
      if (blank(post.author)) add(p('author'), `${who} needs an author.`);
      else if (!authorIds.has(post.author)) add(p('author'), `${who}: its author “${post.author}” no longer exists. Choose another.`);
      if (post.reviewer !== undefined && post.reviewer !== null && post.reviewer !== '') {
        if (typeof post.reviewer !== 'string' || !authorIds.has(post.reviewer)) {
          add(p('reviewer'), `${who}: its medical reviewer “${String(post.reviewer)}” is not one of the blog's authors.`);
        }
      }
      if (post.reviewedAt !== undefined && post.reviewedAt !== null && post.reviewedAt !== '') {
        if (typeof post.reviewedAt !== 'string' || !(ISO_DATE.test(post.reviewedAt) || isIsoWithOffset(post.reviewedAt))) {
          add(p('reviewedAt'), `${who}: the review date “${String(post.reviewedAt)}” is not a valid date.`);
        }
      }

      if (blank(post.title)) add(p('title'), `${fallback} needs a title.`);
      else if (tagIn(post.title)) add(p('title'), `${who}: the title contains HTML code (“${tagIn(post.title)}”).`);
      if (post.titleAccent !== undefined && post.titleAccent !== null && post.titleAccent !== '') {
        if (typeof post.titleAccent !== 'string') add(p('titleAccent'), `${who}: the highlighted words must be text.`);
        else if (!blank(post.title) && !accentMatches(post.title, post.titleAccent.trim())) {
          add(p('titleAccent'), `${who}: the highlighted words “${post.titleAccent.trim()}” do not appear as whole words in the title.`);
        }
      }
      if (blank(post.dek)) add(p('dek'), `${who} needs a short summary under the title.`);
      else if (tagIn(post.dek)) add(p('dek'), `${who}: the summary contains HTML code (“${tagIn(post.dek)}”).`);

      // References first: citations in the text point at them.
      const refIds = new Set();
      if (post.references !== undefined) {
        if (!Array.isArray(post.references)) add(p('references'), `${who}: the references are not a list.`);
        else post.references.forEach((ref, k) => {
          const at = p(`references.${k}`);
          if (!isObject(ref)) {
            add(at, `${who}: reference ${k + 1} is not valid.`);
            return;
          }
          if (blank(ref.id)) add(`${at}.id`, `${who}: reference ${k + 1} has no id.`);
          else if (refIds.has(ref.id)) add(`${at}.id`, `${who}: two references share the id “${ref.id}”.`);
          else refIds.add(ref.id);
          if (blank(ref.text)) add(`${at}.text`, `${who}: reference ${k + 1} needs its title or description.`);
          else if (tagIn(ref.text)) add(`${at}.text`, `${who}: reference ${k + 1} contains HTML code (“${tagIn(ref.text)}”).`);
          if (ref.url !== undefined && ref.url !== null && ref.url !== '' && (typeof ref.url !== 'string' || !/^https:\/\/[^\s<>"]+$/.test(ref.url))) {
            add(`${at}.url`, `${who}: reference ${k + 1}'s link “${String(ref.url)}” must be a full https:// address.`);
          }
        });
      }

      if (!isObject(post.cover) || blank(post.cover.src)) add(p(isObject(post.cover) ? 'cover.src' : 'cover'), `${who}: add a cover photo.`);
      else {
        checkBlogImage(post.cover, p('cover'), `${who}: cover image`, add, refIds);
        const focal = post.cover.focal;
        if (focal !== undefined && focal !== null) {
          const inUnit = (n) => typeof n === 'number' && n >= 0 && n <= 1;
          if (!isObject(focal) || !inUnit(focal.x) || !inUnit(focal.y)) {
            add(p('cover.focal'), `${who}: the cover's focus point is not valid.`);
          }
        }
      }

      if (post.seo !== undefined) {
        if (!isObject(post.seo)) add(p('seo'), `${who}: the search settings are not valid.`);
        else {
          for (const [key, name] of [['title', 'search title'], ['description', 'search description'], ['focusKeyphrase', 'focus keyphrase']]) {
            optionalText(post.seo, key, p(`seo.${key}`), `${who}: the ${name}`, add);
          }
          if (post.seo.keywords !== undefined && (!Array.isArray(post.seo.keywords) || post.seo.keywords.some((k) => typeof k !== 'string'))) {
            add(p('seo.keywords'), `${who}: the keywords must be a list of words or phrases.`);
          }
        }
      }
      if (post.about !== undefined && (!Array.isArray(post.about) || post.about.some(blank))) {
        add(p('about'), `${who}: the “conditions covered” list must contain condition names only.`);
      }

      if (!Array.isArray(post.blocks) || post.blocks.length < 1) {
        add(p('blocks'), `${who} has no content yet.`);
      } else {
        const headings = { seenH2: false, anchors: new Set(), h2: 0 };
        post.blocks.forEach((block, j) => {
          checkBlock(block, p(`blocks.${j}`), `${who}, ${blockName(post.blocks, j)}`, add, { refIds, filmSrcs, headings });
          if (isObject(block) && block.type === 'heading' && block.level === 2) headings.h2 += 1;
        });
        if (post.layout === 'guide' && headings.h2 < 2) {
          add(p('layout'), `${who}: the Guide layout builds its table of contents from Headings. Add at least 2, or choose another layout.`);
        }
      }
    });

    // Cross-post references, once every id is known.
    posts.forEach((post, i) => {
      if (!isObject(post) || post.related === undefined) return;
      const who = blank(post.title) ? `Blog post ${i + 1}` : `Blog post “${shortTitle(post.title)}”`;
      if (!Array.isArray(post.related)) {
        add(`${i}.related`, `${who}: the related posts are not a list.`);
        return;
      }
      // A related id with no live post (deleted, unpublished, not due) is skipped
      // by the build, so another post's action never blocks this one.
      post.related.forEach((id, k) => {
        if (id === post.id) add(`${i}.related.${k}`, `${who} lists itself as a related post.`);
      });
    });
    // Featured ids: like related ids, one with no live post is skipped by the
    // build (deleting or unpublishing a featured post never fails the build).
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
    validateBlogConfig: messages(validateBlogConfigDetailed),
    validateBlogPosts: (posts, config, films) =>
      validateBlogPostsDetailed(posts, config, films).map((error) => error.message),
    validateBlogConfigDetailed,
    validateBlogPostsDetailed,
    blogHrefAllowed,
    updatedAtOf,
    TINTS: Object.freeze(TINTS.slice()),
    LAYOUTS: Object.freeze(LAYOUTS.slice()),
    BLOCK_TYPES: Object.freeze(BLOCK_TYPES.slice()),
    BLOCK_LABELS: Object.freeze(Object.assign({}, BLOCK_LABELS)),
    BLOG_ENUMS: Object.freeze(Object.fromEntries(Object.entries(BLOG_ENUMS).map(([k, v]) => [k, Object.freeze(v.slice())]))),
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
