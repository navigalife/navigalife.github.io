const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const icon = (name) => {
  if (name === 'whatsapp') {
    // Official WhatsApp glyph is a filled path, not a stroke; the old stroked
    // chat-bubble stand-in rendered as a malformed squiggle.
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></svg>';
  }
  const paths = {
    arrow: '<path d="M5 12h14M14 6l6 6-6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    call: '<path d="M7.4 3.5 10 8 7.8 9.7c1.2 2.6 3.3 4.7 5.9 5.9l1.7-2.2 4.6 2.5-.8 4a2 2 0 0 1-2 1.6C9.1 20.7 3.3 14.9 2.5 6.8a2 2 0 0 1 1.6-2l3.3-.7Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    map: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    moon: '<path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.5 8.5 0 1 0 11.4 11.4Z"/>',
    sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    // Hero counter glyphs (editable per-stat in the admin Appearance tab).
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    clipboard: '<path d="M9 4h6v3H9z"/><path d="M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3"/><path d="M9 12h6M9 16h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.5 2"/>',
    heart: '<path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5c0 5-7 9.5-7 9.5Z"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.8M15.5 20a5.5 5.5 0 0 0-2-4.2"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};

// Curated glyphs the hero counter tiles may use; anything else falls back to
// `pulse` so an unexpected admin value can never break the render.
const STAT_ICONS = new Set(['pulse', 'clipboard', 'clock', 'heart', 'shield', 'users']);

// Wraps the first whole-word occurrence of `accentWord` in <em> (escaped text
// in, HTML out). Degrades to plain text when the word is absent, so admin
// edits to the headline can never break the render.
const accentuate = (text, accentWord) => {
  const safe = escapeHtml(text);
  if (!accentWord) return safe;
  const target = escapeHtml(accentWord).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`\\b(${target})\\b`, 'i'), '<em>$1</em>');
};

const phoneHref = (number) => {
  const digits = String(number || '').replace(/\D/g, '');
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
};

const image = (source, imageMap, options = {}) => {
  const variants = imageMap[source];
  if (!variants) throw new Error(`Missing built image: ${source}`);
  const widths = Object.keys(variants).map(Number).filter(Boolean).sort((a, b) => a - b);
  const src = variants[widths[0]];
  const srcset = widths.map((width) => `${variants[width]} ${width}w`).join(', ');
  const loading = options.eager ? 'eager' : 'lazy';
  const priority = options.eager ? ' fetchpriority="high"' : '';
  return `<img src="${src}" srcset="${srcset}" sizes="${escapeHtml(options.sizes || '(max-width: 720px) 92vw, 30vw')}" width="${options.width || 640}" height="${options.height || 800}" alt="${escapeHtml(options.alt)}" loading="${loading}" decoding="async"${priority}>`;
};

const stageSlug = (stage) => {
  const value = String(stage).toLowerCase();
  if (value.includes('before')) return 'before';
  if (value.includes('during')) return 'during';
  return 'after';
};

const evidenceFrame = (entry, testimonial, imageMap, options = {}) => {
  const slug = stageSlug(entry.stage);
  return `
    <figure class="evidence" data-stage="${slug}">
      <div class="evidence__image">
        <div class="evidence__fill" aria-hidden="true">${image(entry.src, imageMap, { alt: '', sizes: options.sizes, eager: options.eager })}</div>
        ${image(entry.src, imageMap, {
          alt: `${entry.stage} photograph: ${testimonial.condition}`,
          sizes: options.sizes,
          eager: options.eager,
        })}
      </div>
      <figcaption class="evidence__stage">${escapeHtml(entry.stage.split(' ')[0])}</figcaption>
    </figure>`;
};

const caseNote = (remark) => `
  <p class="case-note"><span class="case-note__label">Case note</span>${escapeHtml(remark)}</p>`;

// Identity line: a real name when we have one, otherwise "Patient aged N" when
// an age is on record, otherwise nothing. No "Identity protected" placeholder.
const patientLabel = (testimonial) => {
  if (testimonial.name) return testimonial.name;
  if (testimonial.age) return `Patient aged ${testimonial.age}`;
  return '';
};

const storyMeta = (testimonial) => {
  const lead = patientLabel(testimonial);
  const parts = [testimonial.location, testimonial.duration].filter(Boolean);
  const items = [
    ...(lead ? [`<strong>${escapeHtml(lead)}</strong>`] : []),
    ...parts.map((part) => escapeHtml(part)),
  ];
  if (!items.length) return '';
  return `<p class="story-meta">${items.join('<span aria-hidden="true">·</span>')}</p>`;
};

const renderJourney = (testimonial, imageMap) => `
  <article class="journey" data-reveal aria-labelledby="journey-title">
    <div class="journey__intro">
      <h3 id="journey-title">${escapeHtml(testimonial.condition)}</h3>
      ${storyMeta(testimonial)}
    </div>
    <div class="journey__stages">
      ${testimonial.images
        .map((entry) => evidenceFrame(entry, testimonial, imageMap, { sizes: '(max-width: 720px) 88vw, 28vw' }))
        .join('')}
    </div>
    ${caseNote(testimonial.remark)}
    ${testimonial.quote ? `<blockquote class="story-quote">${escapeHtml(testimonial.quote)}</blockquote>` : ''}
  </article>`;

const renderPairStory = (testimonial, imageMap, index) => `
  <article class="pair-story" data-reveal style="--reveal-order:${index % 2}">
    <div class="pair-story__pair">
      ${testimonial.images
        .map((entry) => evidenceFrame(entry, testimonial, imageMap, { sizes: '(max-width: 720px) 44vw, 22vw' }))
        .join('')}
    </div>
    <h3>${escapeHtml(testimonial.condition)}</h3>
    ${storyMeta(testimonial)}
    ${caseNote(testimonial.remark)}
    ${testimonial.quote ? `<blockquote class="story-quote">${escapeHtml(testimonial.quote)}</blockquote>` : ''}
  </article>`;

const renderQuoteStory = (testimonial, index) => `
  <figure class="quote-story" data-reveal style="--reveal-order:${index % 3}">
    <blockquote>${escapeHtml(testimonial.quote)}</blockquote>
    <figcaption>${patientLabel(testimonial) ? `<strong>${escapeHtml(patientLabel(testimonial))}</strong>` : ''}<span>${escapeHtml(testimonial.location)}</span><span>${escapeHtml(testimonial.condition)}</span></figcaption>
  </figure>`;

const renderJsonLd = ({ company, siteUrl }) => {
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'MedicalOrganization',
    name: company.legalName,
    url: siteUrl,
    logo: `${siteUrl}assets/brand/icon-512.png`,
    // Only publish a phone number when one is on record — no dangling "+".
    ...(company.phone ? { telephone: phoneHref(company.phone) } : {}),
    address: { '@type': 'PostalAddress', streetAddress: company.address, addressCountry: 'IN' },
    medicalSpecialty: 'Vascular and lymphatic care',
  };
  return JSON.stringify(organization).replaceAll('<', '\\u003c');
};

const renderPage = ({
  company,
  protocols,
  testimonials,
  config,
  themeId,
  imageMap,
  markPaths,
  cssPath,
  jsPath,
  ogImage,
  siteUrl,
  criticalCss,
  themeBg,
}) => {
  const featured = testimonials.find((testimonial) => testimonial.featured);
  const pairStories = testimonials.filter(
    (testimonial) => !testimonial.featured && testimonial.images.length >= 2,
  );
  const quoteStories = testimonials.filter((testimonial) => !testimonial.images.length);
  const tracks = [
    { id: 'disease', label: 'Disease-specific protocols' },
    { id: 'elderly', label: 'Bedridden and elderly care' },
  ];
  const heroChips = [
    'Diabetic foot',
    'Lymphedema',
    'Venous ulcers',
    'Varicose veins',
    'Filariasis & elephantiasis',
    'DVT prevention',
    'Bedridden & elderly care',
  ];
  const telephone = phoneHref(company.phone);
  const whatsapp = phoneHref(company.whatsapp).replace('+', '');
  const waPatient = company.whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent('I would like to discuss my case with MediVasc.')}`
    : '';
  const mailHref = company.email ? `mailto:${escapeHtml(company.email)}` : '';
  // Primary call-to-action degrades gracefully: WhatsApp when a number is on
  // record, otherwise email, otherwise the contact section. Refilling the
  // WhatsApp number in the admin restores every WhatsApp button automatically.
  const cta = company.whatsapp
    ? { href: waPatient, icon: icon('whatsapp'), label: 'WhatsApp us', external: true }
    : mailHref
      ? { href: mailHref, icon: icon('mail'), label: 'Email us', external: false }
      : { href: '#contact', icon: '', label: 'Contact us', external: false };
  const ctaAttrs = cta.external ? ' target="_blank" rel="noreferrer"' : '';
  const heroStats = Array.isArray(config.heroStats)
    ? config.heroStats.filter((stat) => stat && stat.value && stat.label)
    : [];
  const aboutParagraphs = company.about
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
  const lockup = (context) => `<span class="lockup" aria-hidden="true">
    <img class="lockup--ink" src="${markPaths.ink}" alt="" width="512" height="257" loading="${context === 'header' ? 'eager' : 'lazy'}" decoding="async">
    <img class="lockup--paper" src="${markPaths.paper}" alt="" width="512" height="257" loading="${context === 'header' ? 'eager' : 'lazy'}" decoding="async">
  </span>`;

  return `<!doctype html>
<html lang="en" data-site-theme="${escapeHtml(themeId)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>(function(){document.documentElement.classList.add('js');try{var s=localStorage.getItem('medivasc-color-scheme')||localStorage.getItem('naviga-color-scheme');var d=s?s==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.dataset.theme='dark'}catch(e){}})()</script>
  <title>${escapeHtml(config.seo.title)}</title>
  <meta name="description" content="${escapeHtml(config.seo.description)}">
  <meta name="robots" content="index,follow">
  <meta name="theme-color" content="${escapeHtml(themeBg)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(company.name)}">
  <meta property="og:title" content="${escapeHtml(config.seo.title)}">
  <meta property="og:description" content="${escapeHtml(config.seo.description)}">
  <meta property="og:url" content="${siteUrl}">
  <meta property="og:image" content="${siteUrl}${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="MediVasc: prevention of foot and leg amputation">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(config.seo.title)}">
  <meta name="twitter:description" content="${escapeHtml(config.seo.description)}">
  <meta name="twitter:image" content="${siteUrl}${ogImage}">
  <meta name="twitter:image:alt" content="MediVasc: prevention of foot and leg amputation">
  <link rel="canonical" href="${siteUrl}">
  <link rel="icon" href="assets/brand/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="assets/brand/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="assets/brand/apple-touch-icon.png">
  <link rel="preload" href="assets/fonts/fraunces-latin-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/fraunces-latin-600-italic.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/instrument-sans-latin-400-600.woff2" as="font" type="font/woff2" crossorigin>
  <style>${criticalCss}</style>
  <link rel="stylesheet" href="${cssPath}">
  <script type="application/ld+json">${renderJsonLd({ company, siteUrl })}</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header" data-header>
    <div class="container header-inner">
      <a class="wordmark" href="#top" aria-label="MediVasc home">${lockup('header')}</a>
      <button class="icon-button menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-menu-toggle><span class="sr-only">Open navigation</span>${icon('menu')}</button>
      <nav class="site-nav" id="site-nav" aria-label="Main navigation" data-nav>
        <a href="#recoveries">Recoveries</a>
        <a href="#approach">Our approach</a>
        <a href="#conditions">Conditions</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
      <div class="header-actions">
        <button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme">
          <span class="theme-toggle__sun">${icon('sun')}</span><span class="theme-toggle__moon">${icon('moon')}</span>
        </button>
        <a class="button header-cta" href="${cta.href}"${ctaAttrs}>${cta.icon} ${cta.label}</a>
      </div>
    </div>
  </header>

  <main id="main">
    <section class="hero" id="top">
      <div class="container hero__layout">
        <div class="hero__copy" data-reveal>
          <p class="kicker">Prevention of foot and leg amputation</p>
          <h1>${accentuate(config.heroHeadline, config.heroAccent)}</h1>
          <p>${escapeHtml(config.heroSub)}</p>
          <div class="hero__actions">
            <a class="button" href="#recoveries">See the recoveries ${icon('arrowDown')}</a>
            <a class="button button--outline" href="${cta.href}"${ctaAttrs}>${cta.icon} ${cta.label}</a>
          </div>
          <ul class="chip-list hero__chips" aria-label="Conditions we treat">
            ${heroChips.map((chip) => `<li>${escapeHtml(chip)}</li>`).join('')}
          </ul>
        </div>
        ${featured ? `
        <a class="hero__evidence" href="#recoveries" data-reveal style="--reveal-order:1" aria-label="See documented recoveries">
          <div class="hero__evidence-strip">
            ${featured.images
              .map((entry) => evidenceFrame(entry, featured, imageMap, { sizes: '(max-width: 720px) 30vw, 13vw', eager: true }))
              .join('')}
          </div>
          <p><strong>A documented MediVasc recovery.</strong> Below-knee amputation was advised. Therapy prevented it. See the full story ${icon('arrow')}</p>
        </a>` : ''}
      </div>
      ${heroStats.length ? `
      <div class="container hero__stats-wrap">
        <ul class="hero__stats" aria-label="MediVasc at a glance">
          ${heroStats
            .map(
              (stat, index) => `<li class="hero__stat" data-reveal style="--reveal-order:${index}">
            <span class="hero__stat-icon" aria-hidden="true">${icon(STAT_ICONS.has(stat.icon) ? stat.icon : 'pulse')}</span>
            <span class="hero__stat-body"><span class="hero__stat-value" data-count>${escapeHtml(stat.value)}</span><span class="hero__stat-label">${escapeHtml(stat.label)}</span></span>
          </li>`,
            )
            .join('')}
        </ul>
      </div>` : ''}
    </section>

    <section class="section recoveries" id="recoveries">
      <div class="container">
        <div class="section-heading" data-reveal>
          <div>
            <p class="kicker">Documented recoveries</p>
            <h2>Recoveries you can <em>see</em></h2>
          </div>
          <p>Every story below is a real MediVasc case, shown exactly as photographed: before, during, and after therapy. We never generate or edit outcome images. Names are withheld where patients asked for privacy.</p>
        </div>
        ${featured ? renderJourney(featured, imageMap) : ''}
        ${pairStories.length ? `<div class="pair-story-row">${pairStories.map((testimonial, index) => renderPairStory(testimonial, imageMap, index)).join('')}</div>` : ''}
        ${quoteStories.length ? `<div class="quote-story-grid">${quoteStories.map((testimonial, index) => renderQuoteStory(testimonial, index)).join('')}</div>` : ''}
      </div>
    </section>

    <section class="section approach" id="approach">
      <div class="container">
        <div class="section-heading" data-reveal>
          <div>
            <p class="kicker">What to expect</p>
            <h2>The therapy comes <em>to you</em></h2>
          </div>
          <p>Hospital and clinic therapy for these conditions runs long, and every session means a visit. Many patients never manage it: there is no clinic in the vicinity, mobility is already limited, a family member must give up the whole day, and the travel and therapy costs deter treatment altogether. Our approach removes every one of those barriers.</p>
        </div>
        <ol class="pathway" aria-label="How a MediVasc engagement works">
          <li data-reveal style="--reveal-order:0"><span>01</span><div><h3>Detailed case study</h3><p>We begin with your individual case: the condition, its history, current treatment, and reports. No two protocols are the same because no two cases are.</p></div></li>
          <li data-reveal style="--reveal-order:1"><span>02</span><div><h3>A customized, affordable solution</h3><p>Where required, we customize the medical device modalities for your therapy, designed around your case, your home, and your budget.</p></div></li>
          <li data-reveal style="--reveal-order:2"><span>03</span><div><h3>Therapy at home, under our guidance</h3><p>You take the therapy at home, guided by us, without any break: no travel, no waiting rooms, no dependence on anyone to get you there.</p></div></li>
          <li data-reveal style="--reveal-order:3"><span>04</span><div><h3>Follow-ups until the result</h3><p>We stay in touch at predefined regular intervals, monitor progress, take your feedback, and change the modalities if required, until the desired result is achieved.</p></div></li>
        </ol>
        <aside class="motto" data-reveal>
          <p class="motto__line">A solution is not a solution unless it is <em>affordable</em></p>
          <p>That is our motto, and we mean it literally. The solutions are designed not to pinch the pockets of patients and families already struggling with rising medical expenses.</p>
        </aside>
      </div>
    </section>

    <section class="section conditions" id="conditions">
      <div class="container">
        <div class="section-heading" data-reveal>
          <div>
            <p class="kicker">Protocols available</p>
            <h2>Conditions we treat</h2>
          </div>
          <p>Every protocol starts with the same detailed case study. If your condition is not listed here, ask us. The case study decides what is possible.</p>
        </div>
        <div class="condition-tracks">
          ${tracks
            .map((track) => ({
              track,
              trackProtocols: protocols.filter((protocol) => protocol.audience === track.id),
            }))
            .filter(({ trackProtocols }) => trackProtocols.length > 0)
            .map(({ track, trackProtocols }) => `<section class="condition-track" aria-labelledby="track-${track.id}-title">
              <h3 id="track-${track.id}-title">${escapeHtml(track.label)}</h3>
              <ul class="condition-list">
                ${trackProtocols.map((protocol) => `<li>${icon('check')}${escapeHtml(protocol.condition)}</li>`).join('')}
              </ul>
            </section>`)
            .join('')}
        </div>
      </div>
    </section>

    <section class="section act" id="act">
      <div class="container">
        <div class="act__panel" data-reveal>
          <div class="act__layout">
            <div>
              <h2>If amputation has been advised, talk to us <em>today</em></h2>
              <p>The recovery shown above began after a vascular surgeon had already referred the patient for below-knee amputation. The earlier therapy starts, the shorter it is and the more of the limb it protects. One message is enough to begin.</p>
            </div>
            <div class="act__actions">
              <a class="button button--inverse" href="${cta.href}"${ctaAttrs}>${cta.icon} ${cta.label}</a>
              ${company.phone ? `<a class="button button--inverse-outline" href="tel:${telephone}">${icon('call')} Call us</a>` : ''}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- "Join hands with us" (fraternity / For doctors) section archived per owner
         request 2026-07-13. Markup preserved in git history; restore this block and
         the #fraternity nav link + For doctors nav item together. -->

    <section class="section about" id="about">
      <div class="container about__layout">
        <div class="about__title" data-reveal><h2>About MediVasc</h2><p class="about__location">New Delhi, India</p></div>
        <div class="about__copy" data-reveal style="--reveal-order:1">${aboutParagraphs}</div>
      </div>
    </section>

    <section class="contact" id="contact">
      <div class="container contact__layout">
        <div class="contact__intro" data-reveal>
          <h2>Start with <em>your case</em></h2>
          <p>Tell us the condition, how long it has persisted, and what treatment has been tried. We will study the case and tell you honestly what a protocol can do.</p>
        </div>
        <div class="contact__details" data-reveal style="--reveal-order:1">
          ${company.phone ? `<a class="contact-row" href="tel:${telephone}">${icon('call')}<span><small>Phone</small>Call us</span></a>` : ''}
          ${company.whatsapp ? `<a class="contact-row" href="${waPatient}" target="_blank" rel="noreferrer">${icon('whatsapp')}<span><small>WhatsApp</small>WhatsApp us</span></a>` : ''}
          ${company.email ? `<a class="contact-row" href="mailto:${escapeHtml(company.email)}">${icon('mail')}<span><small>Email</small>${escapeHtml(company.email)}</span></a>` : ''}
          <div class="contact-row contact-row--static">${icon('map')}<span><small>Location</small>${escapeHtml(company.address)}</span></div>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer__top">
      <span class="footer-brand">${lockup('footer')}<span class="sr-only">MediVasc</span></span>
      <p>${escapeHtml(company.tagline)}</p>
      <nav aria-label="Footer navigation"><a href="#recoveries">Recoveries</a><a href="#approach">Approach</a><a href="#conditions">Conditions</a><a href="#about">About</a><a href="#contact">Contact</a></nav>
    </div>
    <div class="container footer__bottom">
      <p>Individual results may vary. Please consult your physician for guidance specific to your condition.</p>
      <p>© ${new Date().getFullYear()} ${escapeHtml(company.legalName)}</p>
    </div>
  </footer>

  <noscript><p class="noscript">Theme controls require JavaScript. All recovery stories, protocols, and contact routes remain available above.</p></noscript>
  <script src="${jsPath}" defer></script>
</body>
</html>`;
};

module.exports = { renderPage };
