// Blog checks — the live SEO checklist and health-claims helper shown beside
// the admin's blog editor. Advice only: nothing here blocks a save (the hard
// rules live in content-rules.js validateBlogPosts).
//
//   admin (browser):  import './blog-checks.js';   // side-effect import
//                     const checks = globalThis.MediVascBlogChecks;
//   Node:             const checks = require('../admin/blog-checks.js');
//
// Classic script on purpose (same pattern as content-rules.js): no
// import/export, no dependencies. It reads posts in the shape pinned by
// src/blog/CONTRACT.md and keeps its own text extraction, so it never depends
// on the renderer.
//
// API — each item is { id, status: 'good' | 'warn', message } in plain words:
//   seoChecklist(post, allPosts)   search-engine checklist for one post
//   claimsCheck(post)              risky health-claim wording, with safer wording
//   textUnits(post)                [{ where, kind, text }] every piece of text
//   CLAIMS_NOTE                    the "helper, not legal advice" line for the panel
(function (root) {
  'use strict';

  // ------------------------------------------------------------ text helpers

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v : '');
  const list = (v) => (Array.isArray(v) ? v : []);

  // Inline = string | [{ t, … } | { cite }] → plain text (citations dropped).
  const inlineText = (value) => {
    if (typeof value === 'string') return value;
    return list(value).map((run) => (isObject(run) && typeof run.t === 'string' ? run.t : '')).join('');
  };
  const inlineLinks = (value) =>
    list(value).filter((run) => isObject(run) && typeof run.href === 'string').map((run) => run.href);

  const BLOCK_NAMES = {
    paragraph: 'Paragraph', lead: 'Intro paragraph', heading: 'Heading', list: 'List',
    quote: 'Quote', pullquote: 'Pull quote', image: 'Image', gallery: 'Gallery',
    imageText: 'Image with text', callout: 'Callout box', takeaways: 'Key takeaways',
    divider: 'Divider', table: 'Table', video: 'Video', faq: 'Questions', cta: 'Contact button',
  };

  // Every piece of text in a post, labelled for messages.
  //   kind: title | dek | seoTitle | seoDescription | heading | body | caption | alt | label
  const textUnits = (post) => {
    const units = [];
    if (!isObject(post)) return units;
    const push = (where, kind, text, extra) => {
      if (typeof text === 'string' && text.trim()) units.push(Object.assign({ where, kind, text }, extra || {}));
    };
    push('the title', 'title', post.title);
    push('the summary under the title', 'dek', post.dek);
    const seo = isObject(post.seo) ? post.seo : {};
    push('the search title', 'seoTitle', seo.title);
    push('the search description', 'seoDescription', seo.description);
    if (isObject(post.cover)) {
      push('the cover image alt text', 'alt', post.cover.alt);
      push('the cover caption', 'caption', inlineText(post.cover.caption));
    }
    list(post.blocks).forEach((block, j) => {
      if (!isObject(block)) return;
      const where = `block ${j + 1} (${BLOCK_NAMES[block.type] || 'Block'})`;
      const image = (img, label) => {
        if (!isObject(img)) return;
        push(`${label} alt text`, 'alt', img.alt);
        push(`${label} caption`, 'caption', inlineText(img.caption));
      };
      switch (block.type) {
        case 'paragraph':
        case 'lead':
          push(where, 'body', inlineText(block.text), { first: block.type });
          break;
        case 'heading':
          push(where, 'heading', block.text, { level: block.level });
          break;
        case 'list':
        case 'takeaways':
          push(where, 'heading', block.title);
          list(block.items).forEach((item) => push(where, 'body', inlineText(item)));
          break;
        case 'quote':
        case 'pullquote':
          push(where, 'body', inlineText(block.text));
          break;
        case 'callout':
          push(where, 'heading', block.title);
          push(where, 'body', inlineText(block.text));
          break;
        case 'image':
          image(block, where);
          break;
        case 'gallery':
          list(block.images).forEach((img, k) => image(img, `${where}, image ${k + 1}`));
          push(`${where} caption`, 'caption', inlineText(block.caption));
          break;
        case 'imageText':
          image(block.image, where);
          list(block.text).forEach((para) => push(where, 'body', inlineText(para)));
          break;
        case 'table':
          push(`${where} caption`, 'caption', block.caption);
          list(block.header).forEach((cell) => push(where, 'label', cell));
          list(block.rows).forEach((row) => list(row).forEach((cell) => push(where, 'label', inlineText(cell))));
          break;
        case 'video':
          push(`${where} caption`, 'caption', inlineText(block.caption));
          break;
        case 'faq':
          push(where, 'heading', block.title);
          list(block.items).forEach((item) => {
            if (!isObject(item)) return;
            push(where, 'body', item.q);
            push(where, 'body', inlineText(item.a));
          });
          break;
        case 'cta':
          push(where, 'label', block.label);
          push(where, 'body', block.text);
          break;
        default:
          break;
      }
    });
    return units;
  };

  const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  const wordsOf = (text) => str(text).match(WORD) || [];
  // Lowercase words joined by single spaces, punctuation and hyphens dropped,
  // so "Check-up" matches "check up" and "check-up".
  const norm = (text) => wordsOf(text).join(' ').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

  const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'with', 'your', 'my', 'is', 'are', 'what', 'when', 'how', 'do', 'does', 'it', 'at', 'by']);
  // 'exact' = the phrase appears as typed; 'words' = every important word
  // appears, in any order; null = missing.
  const phraseIn = (text, phrase) => {
    const hay = ` ${norm(text)} `;
    const needle = norm(phrase);
    if (!needle) return null;
    if (hay.includes(` ${needle} `)) return 'exact';
    const words = needle.split(' ').filter((w) => !STOP.has(w));
    if (words.length && words.every((w) => hay.includes(` ${w} `))) return 'words';
    return null;
  };

  const sentencesOf = (text) =>
    str(text).split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter((s) => wordsOf(s).length > 0);

  // ------------------------------------------------------------ seoChecklist

  const TITLE_MAX = 60;
  const DESC_MIN = 120;
  const DESC_MAX = 160;
  const WORDS_GOOD = 600;
  const WORDS_MIN = 300;
  const SENTENCE_MAX = 20;

  const seoChecklist = (post, allPosts) => {
    const items = [];
    const good = (id, message) => items.push({ id, status: 'good', message });
    const warn = (id, message) => items.push({ id, status: 'warn', message });
    if (!isObject(post)) return items;

    const seo = isObject(post.seo) ? post.seo : {};
    const units = textUnits(post);
    const title = str(seo.title).trim() || str(post.title).trim();
    const titleSource = str(seo.title).trim() ? 'search title' : 'title';
    const description = str(seo.description).trim() || str(post.dek).trim();
    const descSource = str(seo.description).trim() ? 'search description' : 'summary (used because the search description is empty)';
    const phrase = str(seo.focusKeyphrase).trim();
    const firstPara = units.find((u) => u.kind === 'body' && u.first);
    const h2s = list(post.blocks).filter((b) => isObject(b) && b.type === 'heading' && b.level === 2).map((b) => str(b.text));
    const alts = units.filter((u) => u.kind === 'alt').map((u) => u.text);

    // Focus keyphrase checks.
    if (!phrase) {
      warn('keyphrase', 'Add a focus keyphrase — the words you most want this post to be found for on Google (for example “diabetic foot warning signs”).');
    } else {
      good('keyphrase', `Focus keyphrase: “${phrase}”.`);
      const place = (id, found, where, missing) => {
        if (found === 'exact') good(id, `Your focus keyphrase appears in ${where}.`);
        else if (found === 'words') good(id, `All the words of your focus keyphrase appear in ${where} (in a different order — that is fine).`);
        else warn(id, missing);
      };
      place('keyphrase-title', phraseIn(title, phrase), `the ${titleSource}`,
        `Your focus keyphrase is not in the ${titleSource}. Putting it in, ideally near the start, is one of the strongest signals for Google.`);
      const inSlug = norm(str(post.slug).replace(/-/g, ' '));
      const slugHit = (` ${inSlug} `).includes(` ${norm(phrase)} `) ? 'exact' : phraseIn(inSlug, phrase);
      place('keyphrase-slug', slugHit, 'the web address',
        `Your focus keyphrase is not in the web address (blog/${str(post.slug)}/). If the post is not published yet, consider changing the address to include it.`);
      place('keyphrase-intro', firstPara ? phraseIn(firstPara.text, phrase) : null, 'the first paragraph',
        'Use your focus keyphrase in the first paragraph, so readers and Google know straight away what the post is about.');
      const h2Hits = h2s.map((h) => phraseIn(h, phrase));
      place('keyphrase-heading', h2Hits.includes('exact') ? 'exact' : h2Hits.includes('words') ? 'words' : null, 'a main heading (H2)',
        'Use your focus keyphrase (or its main words) in at least one main heading (H2).');
      place('keyphrase-description', phraseIn(description, phrase), `the ${descSource}`,
        `Your focus keyphrase is not in the ${descSource}. Google often shows this text under your title — include the keyphrase so searchers see it.`);
      place('keyphrase-alt', alts.some((a) => phraseIn(a, phrase)) ? 'exact' : null, 'the alt text of at least one image',
        'Describe at least one image using your focus keyphrase in its alt text (only where it honestly describes the picture).');

      const key = norm(phrase);
      const others = list(allPosts).filter((other) =>
        isObject(other) && other !== post && other.id !== post.id && isObject(other.seo) && norm(other.seo.focusKeyphrase) === key);
      if (others.length) {
        const names = others.map((o) => `“${str(o.title).trim() || o.id}”`).join(', ');
        warn('keyphrase-unique', `Another post already targets this focus keyphrase: ${names}. Two posts chasing the same search compete with each other — pick a different keyphrase, or merge the posts.`);
      } else {
        good('keyphrase-unique', 'No other post targets this focus keyphrase.');
      }
    }

    // Title and description length.
    if (!title) warn('title-length', 'Add a title.');
    else if (title.length <= TITLE_MAX) good('title-length', `The ${titleSource} is ${title.length} characters — short enough to show in full on Google (up to ${TITLE_MAX}).`);
    else warn('title-length', `The ${titleSource} is ${title.length} characters. Google usually cuts titles after about ${TITLE_MAX}, so shorten it${titleSource === 'title' ? ' or add a shorter search title' : ''}.`);

    if (!description) warn('description-length', 'Add a search description (or a summary under the title) — it is the text Google shows under your title.');
    else if (description.length < DESC_MIN) warn('description-length', `The ${descSource} is ${description.length} characters. Aim for ${DESC_MIN}–${DESC_MAX} so Google has a full sentence or two to show.`);
    else if (description.length > DESC_MAX) warn('description-length', `The ${descSource} is ${description.length} characters. Google usually cuts it after about ${DESC_MAX} — trim it a little.`);
    else good('description-length', `The ${descSource} is ${description.length} characters — a good length for Google (${DESC_MIN}–${DESC_MAX}).`);

    // Length and readability (body text only).
    const body = units.filter((u) => u.kind === 'body' || u.kind === 'heading' || u.kind === 'label' || u.kind === 'caption');
    const wordCount = body.reduce((n, u) => n + wordsOf(u.text).length, 0);
    if (wordCount >= WORDS_GOOD) good('length', `The post is about ${wordCount} words — enough depth for Google to take it seriously.`);
    else if (wordCount >= WORDS_MIN) warn('length', `The post is about ${wordCount} words. Posts of ${WORDS_GOOD}+ words tend to rank better — is there more a patient would want to know?`);
    else warn('length', `The post is only about ${wordCount} words. Aim for at least ${WORDS_GOOD} so it fully answers the reader's question.`);

    const sentences = units.filter((u) => u.kind === 'body').flatMap((u) => sentencesOf(u.text));
    if (sentences.length) {
      const avg = sentences.reduce((n, s) => n + wordsOf(s).length, 0) / sentences.length;
      const long = sentences.filter((s) => wordsOf(s).length > 30).length;
      if (avg <= SENTENCE_MAX && long <= Math.max(1, Math.round(sentences.length * 0.1))) {
        good('readability', `Sentences average ${Math.round(avg)} words — easy to read.`);
      } else {
        warn('readability', `Sentences average ${Math.round(avg)} words${long ? `, and ${long} are over 30 words` : ''}. Shorter sentences (under ${SENTENCE_MAX} words on average) are easier to read, especially on a phone.`);
      }
    }

    // Links and images.
    const hrefs = [];
    list(post.blocks).forEach((block) => {
      if (!isObject(block)) return;
      for (const value of [block.text, block.caption]) hrefs.push(...inlineLinks(value));
      for (const value of list(block.items)) hrefs.push(...inlineLinks(isObject(value) ? value.a : value));
      if (Array.isArray(block.text)) block.text.forEach((para) => hrefs.push(...inlineLinks(para)));
      list(block.rows).forEach((row) => list(row).forEach((cell) => hrefs.push(...inlineLinks(cell))));
    });
    const internal = hrefs.filter((h) => /^blog\//.test(h)).length;
    if (internal) good('internal-link', `The post links to ${internal} other post${internal === 1 ? '' : 's'} on the blog — that helps readers and Google find more of your writing.`);
    else warn('internal-link', 'Link to at least one other post on the blog — it keeps readers reading and helps Google understand your site.');

    let images = 0;
    let missingAlt = 0;
    const countImage = (img) => {
      if (!isObject(img)) return;
      images += 1;
      if (!str(img.alt).trim()) missingAlt += 1;
    };
    countImage(post.cover);
    list(post.blocks).forEach((block) => {
      if (!isObject(block)) return;
      if (block.type === 'image') countImage(block);
      if (block.type === 'gallery') list(block.images).forEach(countImage);
      if (block.type === 'imageText') countImage(block.image);
    });
    if (!images) warn('alt-text', 'Add a cover image — posts with a picture get noticed far more in search and when shared.');
    else if (missingAlt) warn('alt-text', `${missingAlt} of ${images} image${images === 1 ? ' has' : 's have'} no alt text. Describe each picture in a few words — it is read aloud to blind readers and helps Google.`);
    else good('alt-text', `All ${images} image${images === 1 ? ' has' : 's have'} alt text.`);

    return items;
  };

  // -------------------------------------------------------------- claimsCheck

  const CLAIMS_NOTE = 'This checker looks for common risky wording only. It is a helper, not legal advice — for anything unusual, check with someone who knows the Drugs and Magic Remedies Act and the ASCI healthcare guidelines.';

  // [pattern, advice]. Patterns are case-insensitive and whole-word.
  const CLAIMS = [
    [/\b(?:cure|cures|cured|curing|curable)\b/gi,
      'Promising a cure is not allowed for health services in India. Say what care can do instead — “help manage”, “treat”, “help heal” or “improve”.'],
    [/\bguarantee(?:s|d)?\b|\bguaranteed\b/gi,
      'Avoid guarantees about health results. Try “aims to”, “can help” or “in many cases”.'],
    [/(?:\b100\s?%|\b100 per ?cent\b|\bhundred per ?cent\b)/gi,
      'Avoid 100% claims — results differ from person to person. Describe what is typical, or what the care aims to do.'],
    [/\bpermanent(?:ly)?\s+(?:fix(?:es|ed)?|solutions?|relief|results?|cure[sd]?|healing|recovery)\b|\b(?:fix(?:es|ed)?|solve[sd]?|heal(?:s|ed)?|remove[sd]?|gone)\s+(?:it\s+|them\s+)?(?:for good|forever|permanently)\b/gi,
      'Avoid promising permanent results. Try “long-lasting improvement for many people” or “helps keep it under control”.'],
    [/\bmiracle\b|\bmiraculous(?:ly)?\b|\bmagic(?:al)?\b/gi,
      'Words like “miracle” or “magic” are not allowed for health treatments (Drugs and Magic Remedies Act). Describe plainly what the treatment does.'],
    [/\bno (?:more |need for (?:an? )?)?amputations?\b|\bnever (?:need|have|face) (?:an )?amputations?\b|\b(?:prevents?|eliminates?|avoids?) amputations?\b|\bsaves? (?:your |the |every )?(?:legs?|feet|foot|limbs?)\b/gi,
      'Avoid promising that an amputation will not happen — that depends on each person. Try “help lower the risk of amputation” or “help protect the limb”.'],
    [/\breverse[sd]?\s+(?:your\s+|the\s+)?(?:diabetes|neuropathy|nerve damage|pad|peripheral arterial disease|blockages?)\b|\bdiabetes reversal\b/gi,
      'Avoid “reverse diabetes” style claims (diabetes is a scheduled condition). Try “help manage” or “improve control”.'],
    [/\bwithout (?:any )?(?:surgery|operations?|amputations?)\b|\bno (?:need for )?surgery\b|\bavoid surgery\b/gi,
      'Avoid promising that surgery will not be needed — that depends on each person. Describe what the treatment involves, or say it may be an option “before surgery is considered”.'],
    [/\b(?:no|zero|without (?:any )?)\s*side[- ]effects?\b|\brisk[- ]free\b|\bno risks?\b|\b100% safe\b|\bcompletely safe\b/gi,
      'Every treatment can have side effects. Say who it suits and that a doctor will check, rather than calling it risk-free.'],
    [/\b(?:instant|immediate|overnight)\s+(?:relief|results?|cure|healing|recovery)\b/gi,
      'Avoid promising instant results — healing takes time and varies. Try “many people notice a difference over weeks”.'],
    [/\b(?:fully|completely|totally)\s+(?:heal(?:s|ed)?|cure[sd]?|recover(?:s|ed)?|gone|normal)\b/gi,
      'Avoid absolute promises of a complete recovery. Try “heal well”, “improve” or describe one person’s experience as their own.'],
    [/\bbest (?:doctors?|treatments?|hospitals?|clinics?|results?)\b|\bnumber one\b|\bno\.? ?1\b/gi,
      '“Best” and “number one” claims need proof under ASCI rules. Describe what you offer instead.'],
    [/\bclinically proven\b|\bscientifically proven\b/gi,
      'Only say “proven” if you cite the study in the references. Otherwise try “supported by guidelines” or “used in clinics for…”.'],
  ];

  const claimsCheck = (post) => {
    const items = [];
    const seen = new Set();
    let n = 0;
    for (const unit of textUnits(post)) {
      for (const [pattern, advice] of CLAIMS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(unit.text)) !== null) {
          const phrase = match[0].trim();
          const key = `${unit.where}|${phrase.toLowerCase()}|${advice}`;
          if (seen.has(key)) continue;
          seen.add(key);
          n += 1;
          items.push({
            id: `claim-${n}`,
            status: 'warn',
            message: `In ${unit.where}: “${phrase}”. ${advice}`,
            phrase,
            where: unit.where,
          });
        }
      }
    }
    if (!items.length) {
      items.push({ id: 'claims-clear', status: 'good', message: `No risky health-claim wording found. ${CLAIMS_NOTE}` });
    }
    return items;
  };

  // ------------------------------------------------------------------ export

  const api = Object.freeze({ seoChecklist, claimsCheck, textUnits, CLAIMS_NOTE });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MediVascBlogChecks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
