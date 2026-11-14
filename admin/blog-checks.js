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
// content-rules.js and keeps its own text extraction, so it never depends
// on the renderer.
//
// API — each item is { id, status: 'good' | 'warn', message } in plain words:
//   seoChecklist(post, allPosts)   search-engine checklist for one post
//   claimsCheck(post)              risky health-claim wording, with safer wording
//   linkCheck(post, allPosts, config?, now?)
//                                  links to other posts that will show as plain
//                                  words (the target is not live, or no post has
//                                  that address); warn items only, never a blocker
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
      push('the cover photo description', 'alt', post.cover.alt);
      push('the cover caption', 'caption', inlineText(post.cover.caption));
    }
    list(post.blocks).forEach((block, j) => {
      if (!isObject(block)) return;
      const where = `block ${j + 1} (${BLOCK_NAMES[block.type] || 'Block'})`;
      const image = (img, label) => {
        if (!isObject(img)) return;
        push(`${label} description`, 'alt', img.alt);
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
      warn('keyphrase', 'Add a focus keyphrase: the words you most want this post to be found for on Google (for example “diabetic foot warning signs”).');
    } else {
      good('keyphrase', `Focus keyphrase: “${phrase}”.`);
      const place = (id, found, where, missing) => {
        if (found === 'exact') good(id, `Your focus keyphrase appears in ${where}.`);
        else if (found === 'words') good(id, `All the words of your focus keyphrase appear in ${where} (in a different order, which is fine).`);
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
        `Your focus keyphrase is not in the ${descSource}. Google often shows this text under your title, so include the keyphrase so searchers see it.`);
      place('keyphrase-alt', alts.some((a) => phraseIn(a, phrase)) ? 'exact' : null, 'the description of at least one photo',
        'Use your focus keyphrase in the description of at least one photo (only where it honestly describes the picture).');

      const key = norm(phrase);
      const others = list(allPosts).filter((other) =>
        isObject(other) && other !== post && other.id !== post.id && isObject(other.seo) && norm(other.seo.focusKeyphrase) === key);
      if (others.length) {
        const names = others.map((o) => `“${str(o.title).trim() || o.id}”`).join(', ');
        warn('keyphrase-unique', `Another post already targets this focus keyphrase: ${names}. Two posts chasing the same search compete with each other. Pick a different keyphrase, or merge the posts.`);
      } else {
        good('keyphrase-unique', 'No other post targets this focus keyphrase.');
      }
    }

    // Title and description length.
    if (!title) warn('title-length', 'Add a title.');
    else if (title.length <= TITLE_MAX) good('title-length', `The ${titleSource} is ${title.length} characters, short enough to show in full on Google (up to ${TITLE_MAX}).`);
    else warn('title-length', `The ${titleSource} is ${title.length} characters. Google usually cuts titles after about ${TITLE_MAX}, so shorten it${titleSource === 'title' ? ' or add a shorter search title' : ''}.`);

    if (!description) warn('description-length', 'Add a search description (or a summary under the title). It is the text Google shows under your title.');
    else if (description.length < DESC_MIN) warn('description-length', `The ${descSource} is ${description.length} characters. Aim for ${DESC_MIN}–${DESC_MAX} so Google has a full sentence or two to show.`);
    else if (description.length > DESC_MAX) warn('description-length', `The ${descSource} is ${description.length} characters. Google usually cuts it after about ${DESC_MAX}, so trim it a little.`);
    else good('description-length', `The ${descSource} is ${description.length} characters, a good length for Google (${DESC_MIN}–${DESC_MAX}).`);

    // Length and readability (body text only).
    const body = units.filter((u) => u.kind === 'body' || u.kind === 'heading' || u.kind === 'label' || u.kind === 'caption');
    const wordCount = body.reduce((n, u) => n + wordsOf(u.text).length, 0);
    if (wordCount >= WORDS_GOOD) good('length', `The post is about ${wordCount} words, enough depth for Google to take it seriously.`);
    else if (wordCount >= WORDS_MIN) warn('length', `The post is about ${wordCount} words. Posts of ${WORDS_GOOD}+ words tend to rank better. Is there more a patient would want to know?`);
    else warn('length', `The post is only about ${wordCount} words. Aim for at least ${WORDS_GOOD} so it fully answers the reader's question.`);

    const sentences = units.filter((u) => u.kind === 'body').flatMap((u) => sentencesOf(u.text));
    if (sentences.length) {
      const avg = sentences.reduce((n, s) => n + wordsOf(s).length, 0) / sentences.length;
      const long = sentences.filter((s) => wordsOf(s).length > 30).length;
      if (avg <= SENTENCE_MAX && long <= Math.max(1, Math.round(sentences.length * 0.1))) {
        good('readability', `Sentences average ${Math.round(avg)} words, easy to read.`);
      } else {
        warn('readability', `Sentences average ${Math.round(avg)} words${long ? `, and ${long} are over 30 words` : ''}. Shorter sentences (under ${SENTENCE_MAX} words on average) are easier to read, especially on a phone.`);
      }
    }

    // Links and images.
    // Every inline link run anywhere in the post body (captions included).
    const hrefs = [];
    const collect = (value) => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (isObject(value)) {
        if (typeof value.href === 'string') hrefs.push(value.href);
        Object.keys(value).forEach((key) => { if (key !== 'href') collect(value[key]); });
      }
    };
    collect(post.blocks);
    if (isObject(post.cover)) collect(post.cover.caption);
    const internal = hrefs.filter((h) => /^blog\//.test(h)).length;
    if (internal) good('internal-link', `The post links to ${internal} other post${internal === 1 ? '' : 's'} on the blog, which helps readers and Google find more of your writing.`);
    else warn('internal-link', 'Link to at least one other post on the blog. It keeps readers reading and helps Google understand your site.');

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
    if (!images) warn('alt-text', 'Add a cover image: posts with a picture get noticed far more in search and when shared.');
    else if (missingAlt) warn('alt-text', `${missingAlt} of ${images} image${images === 1 ? ' has' : 's have'} no description. Describe each one in a few words: it is read aloud to people who can’t see the photo, and Google reads it too.`);
    else good('alt-text', `All ${images} image${images === 1 ? ' has' : 's have'} a description.`);

    return items;
  };

  // -------------------------------------------------------------- claimsCheck

  const CLAIMS_NOTE = 'This checker only looks for common risky wording (in English, and a few Hindi and Hinglish phrases). It is a helper, not legal advice. Before publishing anything unusual, check with someone who knows the Drugs and Magic Remedies Act and the ASCI healthcare guidelines.';

  // Advice shared by the English, Hinglish and Hindi forms of one claim.
  const ADVICE = {
    cure: 'Avoid promising a cure. Indian advertising rules (the Drugs and Magic Remedies Act, whose list includes diabetes, and the ASCI healthcare guidelines) do not allow cure claims for many conditions. Say what care can do instead: “help manage”, “treat”, “help heal” or “improve”.',
    guarantee: 'Avoid guarantees about health results: no one can promise how a body will respond. Try “aims to”, “can help” or “in many cases”.',
    miracle: 'Words like “miracle” or “magic” suggest a remedy beyond ordinary medicine, which the Drugs and Magic Remedies Act does not allow in health advertising. Describe plainly what the treatment does.',
  };

  // [pattern, advice]. English patterns are case-insensitive and whole-word.
  // Negated uses ("there is no cure", "help prevent amputation") are skipped:
  // they are honest wording, not promises.
  const CLAIMS = [
    [/(?<!\b(?:no|not|never|cannot|can't|can’t|isn't|isn’t|without|nor)\s+(?:(?:a|an|any|be|been|yet|known|real|permanent)\s+){0,2})\b(?:cure|cures|cured|curing|curable)\b/gi, ADVICE.cure],
    [/\bpakk?a\s+ila+j\b|\bjad+\s+se\s+(?:khatam|khatm|khtm|mita\w*|theek)\b|(?:पक्का|पक्की)\s*(?:इलाज|उपचार)|ज\S{1,2}\s+से\s+(?:ख\S{1,4}|मिटा\S*|समाप्त)|स्थायी\s+(?:इलाज|उपचार)/gi, ADVICE.cure],
    [/\bguarantee[sd]?\b|\bgaa?rant(?:ee|i)\b|गारंटी/gi, ADVICE.guarantee],
    [/\b100\s?%|\b100\s+per\s?cent\b|\bhundred\s+per\s?cent\b/gi,
      'Avoid 100% claims: results differ from person to person. Describe what is typical, or what the care aims to do.'],
    [/\bpermanent(?:ly)?\s+(?:fix(?:es|ed)?|solutions?|relief|results?|cure[sd]?|heal(?:s|ed|ing)?|recovery|remed(?:y|ies)|removal|ila+j)\b|\b(?:fix(?:es|ed)?|solve[sd]?|heal(?:s|ed)?|remove[sd]?|gone|cure[sd]?)\s+(?:it\s+|them\s+)?(?:for good|forever|for ever|permanently|for life)\b/gi,
      'Avoid promising permanent results. Try “long-lasting improvement for many people” or “helps keep it under control”.'],
    [/\bmiracle\b|\bmiraculous(?:ly)?\b|\bmagic(?:al)?\b|\bchamatkar\w*|चमत्कार\S*/gi, ADVICE.miracle],
    [/\bno (?:more |need for (?:an? )?)?amputations?(?: ever)?\b|\bnever (?:need|have|face|undergo) (?:an )?amputations?\b|(?<!\bhelps? (?:to )?)\b(?:prevents?|eliminates?|avoids?|stops?) (?:all |any )?amputations?\b|(?<!\bhelps? (?:to )?)\bsaves? (?:your |the |every |a )?(?:legs?|feet|foot|limbs?)\b|\bamputation[- ]free\b/gi,
      'Avoid promising that an amputation will not happen; that depends on each person. Try “help lower the risk of amputation” or “help protect the limb”.'],
    [/\breverse[sd]?\s+(?:your\s+|the\s+)?(?:diabetes|neuropathy|nerve damage|pad|peripheral arterial disease|blockages?)\b|\bdiabetes reversal\b|\b(?:get rid of|free from|freedom from|beat|defeat)\s+(?:your\s+)?diabetes\b|\bdiabetes[- ]free\b|\b(?:sugar|diabetes)\s+(?:ko\s+)?(?:jad+\s+se\s+)?khatam\b/gi,
      'Avoid saying diabetes (or nerve or artery damage) can be reversed or ended. Diabetes is on the Drugs and Magic Remedies Act’s list, so claims like this are not allowed in health advertising. Try “help manage” or “improve control”.'],
    [/\bwithout (?:any )?(?:surgery|operations?|amputations?)\b|\bno (?:need for )?(?:surgery|operation)\b|\bavoid(?:s|ing)? (?:surgery|an operation)\b|\bbina operation\b/gi,
      'Avoid promising that surgery will not be needed; that depends on each person. Describe what the treatment involves, or say it may be an option “before surgery is considered”.'],
    [/\b(?:no|zero|without (?:any )?)\s*side[- ]effects?\b|\brisk[- ]free\b|\bno risks?\b|\b(?:100% |completely |perfectly |totally )safe\b/gi,
      'Every treatment can have side effects. Say who it suits and that a doctor will check, rather than calling it risk-free.'],
    [/\b(?:instant|immediate|overnight)\s+(?:relief|results?|cure|healing|recovery)\b/gi,
      'Avoid promising instant results: healing takes time and varies. Try “many people notice a difference over weeks”.'],
    [/\b(?:heal(?:s|ed)?|cure[sd]?|recover(?:s|ed)?|results?|relief|gone|walking again)\s+(?:with)?in\s+(?:just\s+|only\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|ten|a few)\s+(?:days?|weeks?|months?)\b/gi,
      'Promising a result within a set time is risky: healing time differs for each person. If this is one patient’s story, say so (“in this patient’s case…”) and add that results vary.'],
    [/\b(?:fully|completely|totally)\s+(?:heal(?:s|ed)?|cure[sd]?|recover(?:s|ed)?|gone|normal)\b/gi,
      'Avoid absolute promises of a complete recovery. Try “heal well”, “improve” or describe one person’s experience as their own.'],
    [/\bbest (?:doctors?|treatments?|hospitals?|clinics?|results?|specialists?|surgeons?)\b|\bnumber one\b|\bno\.? ?1\b|\b(?:top|leading)\s+(?:doctors?|specialists?|surgeons?|hospitals?|clinics?)\b|\bindia['’]?s\s+(?:best|top|first|only|leading)\b|\bthe only (?:treatment|cure|solution|clinic|hospital|centre|center|place)\b/gi,
      '“Best”, “top”, “number one” or “only” claims need independent proof under the ASCI guidelines. Describe what you offer instead.'],
    [/\bclinically proven\b|\bscientifically proven\b/gi,
      'Only say “proven” if you cite the study in the references. Otherwise try “supported by guidelines” or “used in clinics for…”.'],
    [/\bbefore[- ]and[- ]after\s+(?:photos?|pictures?|images?|pics?|shots?|results?|stories|story|transformations?)\b|\bbefore-and-after\b|\bbefore\s*(?:&|\/|–)\s*after\b/gi,
      'Before-and-after pictures or stories must be real, unedited, shared with the patient’s written consent and typical of what people can expect. Say clearly that results differ from person to person.'],
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

  // -------------------------------------------------------------- linkCheck
  // The page renders a link to a post that is not on the site as its plain
  // words (blog-blocks.js postLinks), so the build never fails on one. This says
  // so before publishing. "On the site" = published or scheduled, with a publish
  // time that has come by the time THIS post goes live.
  const POST_HREF = /^blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(?:#[A-Za-z0-9][A-Za-z0-9_-]*)?$/;
  const POST_ADDRESS = /^blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/;
  const POST_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const shortName = (value) => {
    const t = str(value).trim().replace(/\s+/g, ' ');
    return t.length > 60 ? `${t.slice(0, 58).replace(/\s+\S*$/, '')}…` : t;
  };
  const linkCheck = (post, allPosts, config, now) => {
    const items = [];
    if (!isObject(post)) return items;
    // This post as edited stands in for its saved copy in allPosts.
    const same = (p) => p === post || (Boolean(post.id) && p.id === post.id);
    const others = list(allPosts).filter((p) => isObject(p) && !same(p));
    const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now();
    const mine = Date.parse(post.publishAt);
    const by = Math.max(nowMs, Number.isNaN(mine) ? 0 : mine);
    const onSite = (p) => (p.status === 'published' || p.status === 'scheduled') && Date.parse(p.publishAt) <= by;
    // Address → post, built exactly like blog-blocks.js postLinks: current
    // slugs, then old slugs, then settings redirects whose target resolves.
    const redirects = list(isObject(config) ? config.redirects : null);
    const addresses = (pool) => {
      const map = new Map();
      const posts = pool.filter((p) => POST_SLUG.test(str(p.slug)));
      posts.forEach((p) => { if (!map.has(p.slug)) map.set(p.slug, p); });
      posts.forEach((p) => list(p.previousSlugs).forEach((old) => {
        if (POST_SLUG.test(str(old)) && !map.has(old)) map.set(old, p);
      }));
      redirects.forEach((r) => {
        const from = isObject(r) ? POST_ADDRESS.exec(str(r.from)) : null;
        const to = isObject(r) ? POST_ADDRESS.exec(str(r.to)) : null;
        if (from && to && !map.has(from[1]) && map.has(to[1])) map.set(from[1], map.get(to[1]));
      });
      return map;
    };
    // live: what the page links to once this post is on the site (warn ⇔ plain
    // words). known: every post the admin has, to say why a link will not work.
    const live = addresses([post, ...others.filter(onSite)]);
    const known = addresses([post, ...others]);

    // Every link run (adjacent runs with one href are one link), with its words.
    const links = [];
    const walk = (value) => {
      if (Array.isArray(value)) {
        let open = null;
        value.forEach((v) => {
          if (isObject(v) && typeof v.href === 'string') {
            if (open && open.href === v.href) open.text += str(v.t);
            else links.push(open = { href: v.href, text: str(v.t) });
          } else {
            open = null;
            walk(v);
          }
        });
      } else if (isObject(value)) Object.keys(value).forEach((key) => walk(value[key]));
    };
    walk(post.blocks);
    if (isObject(post.cover)) walk(post.cover.caption);

    // One warning per address that will not work (per link wording, for an
    // address no post has), with a unique id each.
    const seen = new Set();
    for (const link of links) {
      const m = POST_HREF.exec(link.href.trim());
      if (!m || live.has(m[1])) continue;
      const target = known.get(m[1]);
      if (target && same(target)) continue;
      if (!target) {
        const key = `unknown|${m[1]}|${link.text.trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ id: `link-unknown-${m[1]}-${seen.size}`, status: 'warn', message: `The link “${shortName(link.text) || `blog/${m[1]}/`}” goes to a post address that doesn’t exist, so it shows as plain words.` });
      } else {
        const key = `later|${target.id || target.slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ id: `link-not-live-${m[1]}`, status: 'warn', message: `This post links to “${shortName(target.title) || `blog/${m[1]}/`}”, which isn’t on the site yet. Until it is, that link shows as plain words.` });
      }
    }
    return items;
  };

  const api = Object.freeze({ seoChecklist, claimsCheck, linkCheck, textUnits, CLAIMS_NOTE });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MediVascBlogChecks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
