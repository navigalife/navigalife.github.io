const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

// Brand glyphs for the footer social row — filled, so they read as logos
// rather than another stroked UI icon. Keys match data/company.json `social`.
const socialIcons = {
  x: { label: 'X', svg: '<path d="M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9Zm-1.3 19.5h2L6.5 3.2H4.3Z"/>' },
  linkedin: { label: 'LinkedIn', svg: '<path d="M20.4 20.5h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.3ZM5.3 7.4a2.1 2.1 0 1 1 0-4.1 2.1 2.1 0 0 1 0 4.1Zm1.8 13.1H3.6V9h3.5v11.5ZM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0Z"/>' },
  instagram: { label: 'Instagram', svg: '<rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" fill="none" stroke="currentColor" stroke-width="2.1"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="currentColor" stroke-width="2.1"/><circle cx="17.5" cy="6.5" r="1.3"/>' },
  facebook: { label: 'Facebook', svg: '<path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"/>' },
  youtube: { label: 'YouTube', svg: '<path fill-rule="evenodd" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z"/>' },
};

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
    close: '<path d="M6 6 18 18M18 6 6 18"/>',
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
// `pulse` so an unexpected admin value can never break the render. The list
// lives in admin/content-rules.js (the build's validator and the admin's icon
// picker read the same one); each name needs a path in icon() above.
const { STAT_ICONS: STAT_ICON_LIST, parseHours, languagesOf, alternateNameOf, readPhone, highlightWholeWord, stripHeadlineQuotes } = require('../admin/content-rules.js');
const STAT_ICONS = new Set(STAT_ICON_LIST);

// Wraps the first whole-word occurrence of `accentWord` in <em> (raw text in,
// escaped HTML out). Degrades to plain text when the word is absent, so admin
// edits to the headline can never break the render. It is the content rules'
// own highlightWholeWord — the test accentMatches() runs — so an accent the
// admin accepts is one the page highlights.
const accentuate = (text, accentWord) => highlightWholeWord(text, accentWord, 'em');

// Optional copy (data/content.json — kickers, ledes, the case highlight, …): a
// blank or whitespace-only value omits its element entirely, never an empty tag.
const filled = (value) => typeof value === 'string' && value.trim() !== '';

// The stock section header — kicker + accented heading, then the lede (or a
// caller-supplied `side` block) in the right-hand column. Blank optional fields
// drop out together with their line. `pad` is the indent of the opening tag.
const sectionHeading = (copy, { pad = 8, reveal = true, side } = {}) => {
  const i = ' '.repeat(pad);
  const kicker = filled(copy.kicker) ? `\n${i}    <p class="kicker">${escapeHtml(copy.kicker)}</p>` : '';
  const aside = side !== undefined ? side : filled(copy.lede) ? `<p>${escapeHtml(copy.lede)}</p>` : '';
  return `<div class="section-heading"${reveal ? ' data-reveal' : ''}>
${i}  <div>${kicker}
${i}    <h2>${accentuate(copy.heading, copy.accent)}</h2>
${i}  </div>${aside ? `\n${i}  ${aside}` : ''}
${i}</div>`;
};

// "+<digits>" for tel:, wa.me and JSON-LD telephone, read by the one rule the
// build validator and the Company tab use (content-rules.js readPhone), so a
// number the build accepts is the number the site dials. Blank -> ''.
const phoneHref = (number) => readPhone(number).number;

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

// Reassurance line shown in both contact prompts (the #act panel and the #contact
// block bracketing #about): no fee is charged to review a case or during follow-up.
// `variant` = 'on-dark' restyles it for the dark #act panel. Copy: content.consult
// (the title is required, the supporting line optional).
const freeConsultNote = (consult, variant = '') => `
        <p class="free-consult${variant ? ` free-consult--${variant}` : ''}">
          <span class="free-consult__icon" aria-hidden="true">${icon('shield')}</span>
          <span class="free-consult__text"><strong>${escapeHtml(consult.title)}</strong>${filled(consult.text) ? escapeHtml(consult.text) : ''}</span>
        </p>`;

// One carousel slide — the same evidence frame the recoveries use (4:5, blurred
// cover fill behind a contained photo), minus the stage caption.
const solutionSlide = (item, imageMap, condition, index, total) => `
        <li class="solution-slide">
          <div class="evidence">
            <div class="evidence__image">
              <div class="evidence__fill" aria-hidden="true">${image(item.src, imageMap, { alt: '', sizes: '(max-width:1000px) 92vw, 380px', width: item.width, height: item.height })}</div>
              ${image(item.src, imageMap, {
                alt: `${condition}: photograph ${index + 1} of ${total}`,
                sizes: '(max-width:1000px) 92vw, 380px',
                width: item.width,
                height: item.height,
              })}
            </div>
          </div>
        </li>`;

// Scroll-snap photo carousel: swipe on touch, arrows on desktop, with a "NN / NN"
// fraction and a thin progress bar. site.js keeps the index in sync (nearest slide).
const solutionCarousel = (items, imageMap, condition) => `
      <div class="solution-carousel" data-carousel role="group" aria-roledescription="carousel" aria-label="${escapeHtml(condition)} photographs">
        <div class="solution-carousel__viewport">
          <ul class="solution-carousel__track" data-carousel-track>
            ${items.map((item, index) => solutionSlide(item, imageMap, condition, index, items.length)).join('')}
          </ul>
          <button type="button" class="solution-carousel__arrow solution-carousel__arrow--prev" data-carousel-prev aria-label="Previous photograph">${icon('arrow')}</button>
          <button type="button" class="solution-carousel__arrow solution-carousel__arrow--next" data-carousel-next aria-label="Next photograph">${icon('arrow')}</button>
          <span class="solution-carousel__hint" data-carousel-hint aria-hidden="true">${icon('arrow')}<span>Swipe</span>${icon('arrow')}</span>
        </div>
        <div class="solution-carousel__meta">
          <span class="solution-carousel__bar" aria-hidden="true"><span data-carousel-progress></span></span>
          <span class="solution-carousel__count"><span data-carousel-index>1</span> / ${items.length}</span>
        </div>
      </div>`;

const renderSolutionCard = (card, imageMap, index) => {
  const body = card.body
    .map((paragraph) => `<p class="solution-card__p${paragraph.variant === 'warn' ? ' solution-card__p--warn' : ''}">${escapeHtml(paragraph.text)}</p>`)
    .join('');
  // Order is heading → photographs → copy → CTA: the case photo is the hook, so it
  // sits directly under the title and above the explanatory copy.
  return `
    <article class="solution-card" data-reveal style="--reveal-order:${index}">
      <h3 class="solution-card__title">${escapeHtml(card.title)}</h3>
      ${solutionCarousel(card.images, imageMap, card.condition)}
      <div class="solution-card__body">
        ${body}
      </div>
      <a class="button solution-card__cta" href="${card.cta.href}"${card.cta.external ? ' target="_blank" rel="noreferrer"' : ''}>${card.cta.icon} ${escapeHtml(card.cta.label)}</a>
    </article>`;
};

// Patients currently in therapy (#treatment, directly below #solutions) —
// data/treatment.json, one entry per patient, photos in display order. build.js
// builds the responsive variants from the same file, and the section renders
// nothing when it is empty. When a patient's after photographs arrive they belong
// in #recoveries, not here.

// One in-therapy photograph — the recoveries' evidence frame (4:5, blurred cover
// fill behind a contained photo) with an "In therapy" stage pill (accent dot).
const treatmentFrame = (src, imageMap, alt) => {
  const sizes = '(max-width: 760px) 44vw, (max-width: 1000px) 16vw, 210px';
  return `
          <figure class="evidence" data-stage="during">
            <div class="evidence__image">
              <div class="evidence__fill" aria-hidden="true">${image(src, imageMap, { alt: '', sizes })}</div>
              ${image(src, imageMap, { alt, sizes })}
            </div>
            <figcaption class="evidence__stage">In therapy</figcaption>
          </figure>`;
};

// One card per patient. --n (photo count) drives the card's share of the row so
// every photograph in the row renders at the same width (see styles.css).
const renderTreatmentGroup = (patient, imageMap, index) => {
  const count = patient.photos.length;
  // A blank label falls back to the numbered "Patient NN" (identity withheld).
  const named = filled(patient.label);
  const label = named ? patient.label : `Patient ${String(index + 1).padStart(2, '0')}`;
  const name = named ? patient.label : `Patient ${index + 1}`;
  return `
      <article class="treatment-group${count === 1 ? ' treatment-group--single' : ''}" data-reveal style="--n:${count};--reveal-order:${index}" aria-label="${escapeHtml(name)}, ${escapeHtml(patient.location)}">
        <div class="treatment-group__photos">${patient.photos
          .map((src, photoIndex) =>
            treatmentFrame(
              src,
              imageMap,
              `In-therapy photograph${count > 1 ? ` ${photoIndex + 1} of ${count}` : ''}: MediVasc patient from ${patient.location}`,
            ),
          )
          .join('')}
        </div>
        <div class="treatment-group__caption">
          <span class="treatment-group__label">${escapeHtml(label)}</span>
          <h3 class="treatment-group__place">${icon('map')}<span>${escapeHtml(patient.location)}</span></h3>
        </div>
      </article>`;
};

// A patient-message screenshot slide in the voices carousel — one row, natural
// aspect at a shared height (no crop), opens the full-resolution image in a
// lightbox (site.js). `sizes` is keyed to orientation so previews load a
// large-enough variant to stay crisp (the lightbox uses the full image).
const voiceCard = (item, imageMap, index, total) => {
  const wide = Number(item.width) > Number(item.height);
  return `
      <li class="voice-slide">
        <button type="button" class="voice-card" data-voice="${index}" data-voice-full="${escapeHtml(item.full)}" aria-label="Read patient message ${index + 1} of ${total}">
          ${image(item.src, imageMap, {
            alt: `Patient message ${index + 1}`,
            sizes: wide ? '(max-width:640px) 88vw, 780px' : '(max-width:640px) 88vw, 240px',
            width: item.width,
            height: item.height,
          })}
          <span class="voice-card__zoom" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"/></svg></span>
        </button>
      </li>`;
};

const renderJsonLd = ({ company, config, siteUrl }) => {
  // Any social profiles the owner has filled in (data/company.json) become
  // `sameAs` links, which help Google connect the site to those profiles and
  // disambiguate our name from unrelated "MediVasc" businesses abroad.
  const sameAs = Object.values(company.social || {}).filter(Boolean);
  const orgId = `${siteUrl}#organization`;
  const alternateName = alternateNameOf(config.seo);
  const languages = languagesOf(company);
  const founded = String(company.founded ?? '').trim();
  const hours = parseHours(company.hours).specs.map((spec) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: spec.days.map((day) => `https://schema.org/${day}`),
    opens: spec.opens,
    closes: spec.closes,
  }));
  // MedicalClinic = MedicalOrganization + LocalBusiness (a Place), so `geo`/`hasMap` below are valid on it.
  const organization = {
    '@type': 'MedicalClinic',
    '@id': orgId,
    name: company.legalName,
    // A clear India signal: our name collides with a French clinic, so the
    // machine-readable identity carries "MediVasc India" too. Owner-editable as
    // seo.alternateName ("Also known as", Appearance tab); absent = that default,
    // blank = omitted.
    ...(alternateName ? { alternateName } : {}),
    url: siteUrl,
    logo: `${siteUrl}assets/brand/icon-512.png`,
    description: config?.seo?.description || company.tagline,
    // Only publish a phone number when one is on record — no dangling "+".
    ...(company.phone ? { telephone: phoneHref(company.phone) } : {}),
    ...(company.email ? { email: `mailto:${company.email}` } : {}),
    address: company.addressParts
      ? { '@type': 'PostalAddress', ...company.addressParts }
      : { '@type': 'PostalAddress', streetAddress: company.address, addressCountry: 'IN' },
    ...(company.geo
      ? { geo: { '@type': 'GeoCoordinates', latitude: company.geo.latitude, longitude: company.geo.longitude } }
      : {}),
    ...(company.mapsUrl ? { hasMap: company.mapsUrl } : {}),
    // company.founded (Company tab): published only as a four-digit year.
    ...(/^\d{4}$/.test(founded) ? { foundingDate: founded } : {}),
    // company.hours ("Support hours", admin Company tab) read by the shared
    // parser; blank = no hours published. build.js validate() has already
    // refused text it cannot read.
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
    // seo.areaServed / seo.knowsAbout (data/site-config.json, admin SEO tab): where
    // MediVasc serves and the conditions it treats, so search engines can associate
    // the organisation with the searches patients actually run (docs/LESSONS.md).
    areaServed: config.seo.areaServed,
    // schema.org MedicalSpecialty members only (free text is not valid here):
    // vascular care, and Podiatric for diabetic-foot / amputation prevention.
    medicalSpecialty: ['https://schema.org/Cardiovascular', 'https://schema.org/Podiatric'],
    knowsAbout: config.seo.knowsAbout,
    // WhatsApp is our primary contact channel — expose it as a contact point so
    // it can surface in rich results, not just as a link buried in the page.
    ...(company.whatsapp
      ? {
          contactPoint: {
            '@type': 'ContactPoint',
            telephone: phoneHref(company.whatsapp),
            contactType: 'customer service',
            // company.languages ("Languages spoken"); absent = English, Hindi.
            ...(languages.length ? { availableLanguage: languages } : {}),
          },
        }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
  // The `WebSite` node is what Google reads for the *site name* — the line printed
  // above the blue title in a result (it was falling back to the bare domain,
  // "medivasc.in"). Homepage-only and root-domain-only by Google's rules, which is
  // exactly where this template renders. Deliberately no `alternateName` here:
  // Google may display an alternateName instead of `name`, and we want the header
  // to read "MediVasc", not "MediVasc India" — the India disambiguation stays on
  // the organisation node, which feeds the knowledge panel rather than this line.
  // `name` must also stay consistent with <title> and og:site_name or Google
  // ignores all of them and reverts to the domain.
  const website = {
    '@type': 'WebSite',
    '@id': `${siteUrl}#website`,
    name: company.name,
    url: siteUrl,
    publisher: { '@id': orgId },
    inLanguage: 'en',
  };
  const graph = { '@context': 'https://schema.org', '@graph': [website, organization] };
  return JSON.stringify(graph).replaceAll('<', '\\u003c');
};

// MediVasc Assistant — a conversational lead form that lives at bottom-right on every
// viewport. The shell is server-rendered (no layout shift); site.js drives the
// chat and, on completion, builds a wa.me deep-link with the case prefilled.
// html.js-gated in CSS, so without JS the page's own contact routes take over.
// Copy: content.chat. The shell's strings render here; everything site.js says
// in the conversation travels in the JSON config below, as plain text (site.js
// escapes it and adds the <strong> itself — no markup ever comes from content).
const renderChatbot = ({ wa, email, chat, depth = '' }) => {
  const xIcon =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const chatIcon =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.4a7.6 7.6 0 0 1-11 6.8L4.5 19.6l1.4-4.4A7.6 7.6 0 1 1 20 11.4Z"/><circle cx="8.5" cy="11.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="12" cy="11.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.5" cy="11.6" r="1.05" fill="currentColor" stroke="none"/></svg>';
  const sendIcon =
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.5 3.5c-.5-.2-1 .3-.85.82L4.4 11 14 12 4.4 13l-1.75 6.68c-.14.51.36 1 .85.82l17.2-7.55c.5-.22.5-.94 0-1.16L3.5 3.5Z"/></svg>';
  const config = JSON.stringify({
    wa: wa || '',
    email: email || '',
    conditions: chat.conditions,
    greeting: chat.greeting,
    greetingBold: chat.greetingBold,
    questions: chat.questions.map(({ key, prompt, bold, placeholder }) => ({ key, prompt, bold, placeholder })),
    done: chat.done,
    welcomeBack: chat.welcomeBack,
    restart: chat.restart,
    messageOpening: chat.messageOpening,
    messageClosing: chat.messageClosing,
  }).replaceAll('<', '\\u003c');
  const name = escapeHtml(chat.name);
  return `
  <div class="mvbot" data-mvbot data-mvbot-state="closed">
    <div class="mvbot__panel" id="mvbot-panel" data-mvbot-panel role="dialog" aria-label="${name}" aria-modal="false" aria-hidden="true">
      <header class="mvbot__head">
        <span class="mvbot__avatar" aria-hidden="true"><img src="${depth}assets/brand/icon-192.png" alt="" width="42" height="42" loading="lazy" decoding="async"></span>
        <span class="mvbot__id">
          <span class="mvbot__name">${name}</span>
          <span class="mvbot__status"><span class="mvbot__status-dot" aria-hidden="true"></span>${escapeHtml(chat.status)}</span>
        </span>
        <button type="button" class="mvbot__close" data-mvbot-close aria-label="Close chat">${xIcon}</button>
      </header>
      <div class="mvbot__log" data-mvbot-log role="log" aria-live="polite"></div>
      <div class="mvbot__quick" data-mvbot-quick hidden></div>
      <form class="mvbot__composer" data-mvbot-form autocomplete="off" novalidate hidden>
        <label class="sr-only" for="mvbot-input">Type your answer</label>
        <input class="mvbot__input" id="mvbot-input" data-mvbot-input type="text" name="mvbot-field" autocomplete="off" enterkeyhint="send" placeholder="Type here…">
        <button type="submit" class="mvbot__send" data-mvbot-send aria-label="Send" disabled>${sendIcon}</button>
      </form>
      <p class="mvbot__legal">${escapeHtml(chat.legal)}</p>
    </div>
    <div class="mvbot__nudge" data-mvbot-nudge hidden>
      <button type="button" class="mvbot__nudge-x" data-mvbot-nudge-x aria-label="Dismiss">${xIcon}</button>
      <strong>${escapeHtml(chat.nudgeLead)}</strong> ${escapeHtml(chat.nudgeBody)}
    </div>
    <button type="button" class="mvbot__launcher" data-mvbot-toggle aria-expanded="false" aria-controls="mvbot-panel" aria-label="Chat with ${name}">
      <span class="mvbot__launcher-ico mvbot__launcher-ico--chat" aria-hidden="true">${chatIcon}</span>
      <span class="mvbot__launcher-ico mvbot__launcher-ico--close" aria-hidden="true">${xIcon}</span>
      <span class="mvbot__launcher-ping" aria-hidden="true"></span>
    </button>
    <script type="application/json" data-mvbot-config>${config}</script>
  </div>`;
};

// Contact routes from data/company.json — the one source for the homepage CTAs
// and the blog's ctx.contactHref. `depth` prefixes the in-page #contact fallback
// so the route still lands on the homepage section from a blog page.
const contactHrefs = (company, content, depth = '') => {
  const whatsapp = phoneHref(company.whatsapp).replace('+', '');
  return {
    whatsapp: company.whatsapp
      ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(content.cta.message)}`
      : '',
    call: company.phone ? `tel:${phoneHref(company.phone)}` : '',
    email: company.email ? `mailto:${escapeHtml(company.email)}` : '',
    contact: `${depth}#contact`,
  };
};

// Primary call-to-action degrades gracefully: WhatsApp when a number is on
// record, otherwise email, otherwise the contact section. Refilling the
// WhatsApp number in the admin restores every WhatsApp button automatically.
const primaryCta = (company, content, depth = '') => {
  const hrefs = contactHrefs(company, content, depth);
  return hrefs.whatsapp
    ? { href: hrefs.whatsapp, icon: icon('whatsapp'), label: 'WhatsApp us', external: true }
    : hrefs.email
      ? { href: hrefs.email, icon: icon('mail'), label: 'Email us', external: false }
      : { href: hrefs.contact, icon: '', label: 'Contact us', external: false };
};

// The pre-paint theme script. The homepage follows the OS preference until the
// visitor picks a theme; blog pages (`lightDefault`) open light and only the
// visitor's stored pick (the same localStorage key the toggle writes) turns them dark.
const themeScript = (lightDefault) => lightDefault
  ? `<script>(function(){document.documentElement.classList.add('js');try{var s=localStorage.getItem('medivasc-color-scheme')||localStorage.getItem('naviga-color-scheme');if(s==='dark')document.documentElement.dataset.theme='dark'}catch(e){}})()</script>`
  : `<script>(function(){document.documentElement.classList.add('js');try{var s=localStorage.getItem('medivasc-color-scheme')||localStorage.getItem('naviga-color-scheme');var d=s?s==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.dataset.theme='dark'}catch(e){}})()</script>`;

// JSON-LD entries: a pre-serialised string goes in verbatim (the homepage graph),
// an object is serialised here with `<` escaped so no value can close the script.
const LD_LT = `${String.fromCharCode(92)}u003c`;
const jsonLdScripts = (entries) => (Array.isArray(entries) ? entries : [entries])
  .filter(Boolean)
  .map((entry) => `  <script type="application/ld+json">${typeof entry === 'string' ? entry : JSON.stringify(entry).replaceAll('<', LD_LT)}</script>\n`)
  .join('');

const HOME_NOSCRIPT = 'Theme controls require JavaScript. All recovery stories, protocols, and contact routes remain available above.';

// The page shell every page shares: head, header, mobile drawer, footer, chatbot
// and scripts around a page's own <main> content. `site` carries the site-wide
// data (company, content, config, theme, hashed asset paths, lockups, blog nav);
// the rest is per page. `depth` ('' on the homepage, '../' on /blog/, …) prefixes
// every relative path and turns the homepage section anchors into `${depth}#id`,
// so a blog page's header and footer still land on the homepage sections — and
// the whole site keeps working when it is mounted under a subpath (/changes/).
// The Blog nav link renders only when `site.blogNav` is set (≥1 live post).
const renderShell = ({
  site,
  depth = '',
  lang = 'en',
  title,
  description,
  canonical,
  ogImage,
  ogImageAlt,
  ogType = 'website',
  jsonLd = [],
  robots,
  headExtra = '',
  bodyClass = '',
  main = '',
  extraCss = [],
  extraJs = [],
  lightDefault = false,
  blogCurrent = false,
  noscript = HOME_NOSCRIPT,
}) => {
  const { company, content, config, themeId, themeBg, siteUrl, cssPath, jsPath, markPaths, markPathsTm, markPathsTmLg, blogNav } = site;
  const cta = primaryCta(company, content, depth);
  const ctaAttrs = cta.external ? ' target="_blank" rel="noreferrer"' : '';
  // Single source for the nav (content.nav): the targets are fixed by the content
  // rules, the labels are owner copy — `label` inline in the header (desktop) and
  // in the mobile slide-in drawer (below), `footerLabel` in the footer. The Blog
  // link sits after the locked section anchors, outside that lock.
  const navLink = (item, key) => `<a href="${depth}#${escapeHtml(item.target)}">${escapeHtml(item[key])}</a>`;
  const blogLink = blogNav
    ? `<a href="${depth}blog/"${blogCurrent ? ' aria-current="page"' : ''}>${escapeHtml(blogNav.label)}</a>`
    : '';
  const navLinksHtml = content.nav.map((item) => navLink(item, 'label')).join('') + blogLink;
  const footerNavHtml = content.nav.map((item) => navLink(item, 'footerLabel')).join('') + blogLink;
  // Every lockup variant carries its own measured intrinsic width/height (see
  // prepareMarkSized in build.js) — the aspect differs per variant and moved with
  // the Exotc350 wordmark, so a hard-coded 512x257 would cost a layout shift.
  const lockupImgs = (mark, loading) =>
    `<img class="lockup--ink" src="${depth}${mark.ink.src}" alt="" width="${mark.ink.width}" height="${mark.ink.height}" loading="${loading}" decoding="async">
    <img class="lockup--paper" src="${depth}${mark.paper.src}" alt="" width="${mark.paper.width}" height="${mark.paper.height}" loading="${loading}" decoding="async">`;
  const lockup = (context) => `<span class="lockup" aria-hidden="true">
    ${lockupImgs(markPaths, context === 'header' ? 'eager' : 'lazy')}
  </span>`;
  // Footer-only lockup: the ™ is baked into these variants at the 'c' shoulder
  // (see assets/brand/logo-*-tm*.png) rather than positioned in CSS, so it stays
  // pixel-tight to the letterform. Two size wrappers — '-lg' (larger ™) for the
  // 54px desktop render, base for the 64px phone render — swapped by breakpoint in
  // CSS (.lockup__size--sm hidden on desktop, --lg hidden ≤760px).
  const tmImg = (mark) => lockupImgs(mark, 'lazy');
  const footerSocial = (() => {
    const links = Object.entries(socialIcons)
      .filter(([key]) => company.social?.[key])
      .map(([key, { label, svg }]) => `<a href="${escapeHtml(company.social[key])}" target="_blank" rel="me noopener noreferrer" aria-label="MediVasc on ${label}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${svg}</svg></a>`);
    return links.length ? `<ul class="footer-social" aria-label="MediVasc on social media">${links.map((link) => `<li>${link}</li>`).join('')}</ul>` : '';
  })();
  const footerLockup = () => `<span class="lockup" aria-hidden="true">
    <span class="lockup__size lockup__size--lg">${tmImg(markPathsTmLg)}</span>
    <span class="lockup__size lockup__size--sm">${tmImg(markPathsTm)}</span>
  </span>`;
  // The bot deep-links to WhatsApp when a number is on record, else composes an
  // email; if neither exists it is omitted (site.js no-ops on a missing config).
  const whatsapp = phoneHref(company.whatsapp).replace('+', '');
  const chatbot = whatsapp || company.email
    ? renderChatbot({ wa: whatsapp, email: company.email, chat: content.chat, depth })
    : '';
  // The homepage's robots directive carries its rationale; other pages pass their own.
  const robotsMeta = robots
    ? `<meta name="robots" content="${escapeHtml(robots)}">`
    : `<!-- max-image-preview:none — Google's *mobile* result for medivasc.in was pulling
       the og:image in as a snippet thumbnail and centre-cropping it to a square,
       which sliced the lockup and the kicker ("MediVasc" cut off, "…VENTION OF
       FOOT AND LEG AMP…"). There is no meta that picks a different thumbnail, so
       we opt out of image previews and let the result render as clean text, the
       way desktop already did. og:image itself stays — WhatsApp/LinkedIn/X
       previews are unaffected by this directive, and WhatsApp is our main channel.
       Trade-off: no image thumbnail in Google results or Discover. -->
  <meta name="robots" content="index,follow,max-image-preview:none">`;
  // Search Console verification belongs to the homepage only.
  const verification = !depth && config.seo.googleVerification
    ? `  <meta name="google-site-verification" content="${escapeHtml(config.seo.googleVerification)}">\n`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(lang)}" data-site-theme="${escapeHtml(themeId)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${themeScript(lightDefault)}
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  ${robotsMeta}
${verification}  <meta name="theme-color" content="${escapeHtml(themeBg)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:site_name" content="${escapeHtml(company.name)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(ogImageAlt)}">
${headExtra}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${ogImage}">
  <meta name="twitter:image:alt" content="${escapeHtml(ogImageAlt)}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="${depth}assets/brand/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="${depth}assets/brand/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="${depth}assets/brand/apple-touch-icon.png">
  <link rel="preload" href="${depth}assets/fonts/fraunces-latin-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${depth}assets/fonts/fraunces-latin-600-italic.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${depth}assets/fonts/instrument-sans-latin-400-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${depth}${cssPath}">
${extraCss.map((href) => `  <link rel="stylesheet" href="${depth}${href}">\n`).join('')}${jsonLdScripts(jsonLd)}</head>
<body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ''}>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header" data-header>
    <div class="container header-inner">
      <a class="wordmark" href="${depth || '#top'}" aria-label="MediVasc home">${lockup('header')}</a>
      <button class="icon-button menu-toggle" type="button" aria-expanded="false" aria-controls="nav-drawer" data-menu-toggle><span class="sr-only">Open navigation</span>${icon('menu')}</button>
      <nav class="site-nav" id="site-nav" aria-label="Main navigation">
        ${navLinksHtml}
      </nav>
      <div class="header-actions">
        <button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme">
          <span class="theme-toggle__sun">${icon('sun')}</span><span class="theme-toggle__moon">${icon('moon')}</span>
        </button>
        <a class="button header-cta" href="${cta.href}"${ctaAttrs}>${cta.icon} ${cta.label}</a>
      </div>
    </div>
  </header>

  <!-- Mobile slide-in drawer + scrim: body-level (NOT inside .site-header, whose
       backdrop-filter would trap fixed descendants to its own 84px box and stack
       them below the chatbot). Controlled by site.js; single nav source above. -->
  <div class="nav-scrim" data-nav-scrim></div>
  <nav class="nav-drawer" id="nav-drawer" aria-label="Mobile navigation" data-nav>
    <div class="nav-drawer__head">
      <span class="nav-drawer__brand">${lockup('header')}</span>
      <button class="icon-button nav-drawer__close" type="button" data-menu-close><span class="sr-only">Close navigation</span>${icon('close')}</button>
    </div>
    <div class="nav-drawer__links">
      ${navLinksHtml}
    </div>
    <div class="nav-drawer__foot">
      <a class="button nav-drawer__cta" href="${cta.href}"${ctaAttrs}>${cta.icon} ${cta.label}</a>
    </div>
  </nav>

  <main id="main">${main}</main>

  <footer class="site-footer">
    <div class="container footer__top">
      <span class="footer-brand">${footerLockup()}<span class="sr-only">MediVasc™</span></span>
      <p>${escapeHtml(company.tagline)}</p>
      <nav aria-label="Footer navigation">${footerNavHtml}</nav>
      ${footerSocial}
    </div>
    <div class="container footer__bottom">
      <p>${escapeHtml(content.footer.disclaimer)}</p>
      <p>© ${escapeHtml(company.legalName)}. All rights reserved.</p>
    </div>
  </footer>

  ${chatbot}

  <noscript><p class="noscript">${escapeHtml(noscript)}</p></noscript>
  <script src="${depth}${jsPath}" defer></script>
${extraJs.map((src) => `  <script src="${depth}${src}" defer></script>\n`).join('')}</body>
</html>`;
};

const renderPage = ({
  company,
  protocols,
  testimonials,
  config,
  themeId,
  imageMap,
  solutions,
  feedbackImages,
  content,
  treatment,
  films,
  markPaths,
  markPathsTm,
  markPathsTmLg,
  cssPath,
  jsPath,
  ogImage,
  siteUrl,
  themeBg,
  blogNav = null,
}) => {
  const featured = testimonials.find((testimonial) => testimonial.featured);
  const pairStories = testimonials.filter(
    (testimonial) => !testimonial.featured && testimonial.images.length >= 2,
  );
  const quoteStories = testimonials.filter((testimonial) => !testimonial.images.length);
  // Once there are more than three non-featured case cards the row collapses to
  // the first three and a "View more" toggle (site.js) animates the rest open.
  const collapsibleRecoveries = pairStories.length > 3;
  const tracks = [
    { id: 'disease', label: content.conditions.trackDisease },
    { id: 'elderly', label: content.conditions.trackElderly },
  ];
  const heroChips = (content.hero.chips || []).filter(filled);
  const telephone = phoneHref(company.phone);
  const whatsapp = phoneHref(company.whatsapp).replace('+', '');
  const waPatient = company.whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(content.cta.message)}`
    : '';
  // Primary call-to-action (WhatsApp → email → #contact) — shared with the shell.
  const cta = primaryCta(company, content);
  const ctaAttrs = cta.external ? ' target="_blank" rel="noreferrer"' : '';
  // Per-condition CTA — same graceful degrade as the primary `cta`, but the
  // WhatsApp/email message is prefilled with the specific condition.
  const conditionCta = (label, message) => {
    if (company.whatsapp) {
      return { href: `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`, icon: icon('whatsapp'), label, external: true };
    }
    if (company.email) {
      return { href: `mailto:${escapeHtml(company.email)}?subject=${encodeURIComponent(message)}`, icon: icon('mail'), label, external: false };
    }
    return { href: '#contact', icon: '', label, external: false };
  };
  // Owner-curated condition cards (data/solutions.json, managed from the admin's
  // Solutions tab). The card copy and photograph order live in the manifest; the
  // template only resolves the CTA to a WhatsApp/email/contact link (same
  // graceful degrade as the primary hero CTA) and drops any card left imageless.
  const solutionCards = (Array.isArray(solutions) ? solutions : [])
    .map((card) => ({
      title: card.title,
      condition: card.condition,
      images: card.images,
      cta: conditionCta(card.cta.label, card.cta.message),
      body: card.body,
    }))
    .filter((card) => card.images && card.images.length);
  const solutionsSection = solutionCards.length
    ? `<section class="section solutions" id="solutions">
      <div class="container">
        ${sectionHeading(content.solutions)}
        <div class="solution-grid">
          ${solutionCards.map((card, index) => renderSolutionCard(card, imageMap, index)).join('')}
        </div>
      </div>
    </section>`
    : '';
  const treatmentPatients = (Array.isArray(treatment) ? treatment : []).filter(
    (patient) => Array.isArray(patient.photos) && patient.photos.length,
  );
  const treatmentSection = treatmentPatients.length
    ? `<section class="section treatment" id="treatment">
      <div class="container">
        ${sectionHeading(content.treatment)}
        <div class="treatment-row">
          ${treatmentPatients.map((patient, index) => renderTreatmentGroup(patient, imageMap, index)).join('')}
        </div>
      </div>
    </section>`
    : '';
  // The one section that says no (data/site-config.json → eligibility, edited
  // on the admin's Page tab). Heading and body are both owner-copy, so
  // the section renders only when both are filled and disappears cleanly when
  // they are cleared — the same graceful degrade as the solutions/voices rows.
  const eligibility = config.eligibility || {};
  const eligibilityHeading = String(eligibility.heading || '').trim();
  const eligibilityBody = String(eligibility.body || '').trim();
  const eligibilitySection = eligibilityHeading && eligibilityBody
    ? `<section class="section eligibility" id="eligibility">
      <div class="container">
        ${sectionHeading(
          { kicker: content.eligibility.kicker, heading: eligibilityHeading, accent: eligibility.accent },
          {
            side: `<div class="eligibility__body">${eligibilityBody
              .split(/\n\n+/)
              .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
              .join('')}</div>`,
          },
        )}
      </div>
    </section>`
    : '';
  const voices = Array.isArray(feedbackImages) ? feedbackImages : [];
  const voicesSection = voices.length
    ? `<section class="section voices" id="voices">
      <div class="container">
        ${sectionHeading(content.voices)}
        <div class="voice-carousel" data-carousel role="group" aria-roledescription="carousel" aria-label="Patient messages">
          <div class="voice-carousel__viewport">
            <ul class="voices-rail" data-carousel-track data-voice-rail aria-label="Patient messages">
              ${voices.map((item, index) => voiceCard(item, imageMap, index, voices.length)).join('')}
            </ul>
            <button type="button" class="voice-carousel__arrow voice-carousel__arrow--prev" data-carousel-prev aria-label="Previous message">${icon('arrow')}</button>
            <button type="button" class="voice-carousel__arrow voice-carousel__arrow--next" data-carousel-next aria-label="Next message">${icon('arrow')}</button>
          </div>
        </div>
      </div>
      <dialog class="voice-lightbox" data-voice-lightbox aria-label="Patient message">
        <div class="voice-lightbox__stage">
          <img class="voice-lightbox__img" data-voice-lightbox-img alt="" decoding="async">
        </div>
        <button type="button" class="voice-lightbox__close" data-voice-close aria-label="Close">${icon('close')}</button>
        <button type="button" class="voice-lightbox__nav voice-lightbox__nav--prev" data-voice-prev aria-label="Previous message">${icon('arrow')}</button>
        <button type="button" class="voice-lightbox__nav voice-lightbox__nav--next" data-voice-next aria-label="Next message">${icon('arrow')}</button>
        <p class="voice-lightbox__counter" data-voice-counter aria-live="polite"></p>
      </dialog>
    </section>`
    : '';
  const heroStats = Array.isArray(config.heroStats)
    ? config.heroStats.filter((stat) => stat && stat.value && stat.label)
    : [];
  const aboutParagraphs = company.about
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
  // The hero headline is wrapped in styled curly quotes below. The admin CMS is a
  // co-writer and the owner sometimes types their own quotes into the headline —
  // strip one pair that wraps the whole headline (content-rules
  // stripHeadlineQuotes, the same strip the validator and the admin preview run)
  // so the render shows exactly one styled set, never a doubled "«…»", while an
  // inner quotation keeps its closing mark.
  const heroHeadlineText = stripHeadlineQuotes(config.heroHeadline || '');

  // The severity-clip case note (content.conditions.case*). Declared once so the
  // desktop figure and the mobile "View more" popup render identical copy (the
  // figure is hidden on phones; the popup carries it there). It exists only when
  // caseQuote is filled; the kicker and the stats are optional inside it.
  const conditionsCopy = content.conditions;
  const hasCase = filled(conditionsCopy.caseQuote);
  const caseKicker = (tag) =>
    filled(conditionsCopy.caseKicker)
      ? `<${tag} class="condition-case__kicker">${escapeHtml(conditionsCopy.caseKicker)}</${tag}>`
      : '';
  const caseStats = (conditionsCopy.caseStats || []).filter(filled);
  // Inner lines of the case note at a given indent: kicker, quote, stats.
  const caseNoteLines = (pad, kickerTag) =>
    [
      caseKicker(kickerTag),
      `<blockquote class="condition-case__quote">${escapeHtml(conditionsCopy.caseQuote)}</blockquote>`,
      caseStats.length ? `<ul class="condition-case__stats">${caseStats.map((stat) => `<li>${escapeHtml(stat)}</li>`).join('')}</ul>` : '',
    ]
      .filter(Boolean)
      .map((line) => `\n${' '.repeat(pad)}${line}`)
      .join('');

  // The severity clips (data/films.json): one list drives both the poster grid
  // and the carousel slides inside the film lightbox, so their order and count
  // never drift. The featured clip's caption carries the phones' "View more" into
  // the case note, so that button (and the popup) exist only when there is a case.
  const filmList = Array.isArray(films) ? films : [];
  const caseOpener = hasCase && filmList.some((film) => film.featured === true);
  // Without both halves the two-column case/clips grid collapses to one column;
  // a case with no clip to open it stays visible on phones instead of hiding.
  const conditionFilmsClass = [
    'condition-films',
    hasCase !== (filmList.length > 0) ? 'condition-films--solo' : '',
    hasCase && !caseOpener ? 'condition-films--case-inline' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // The line under the hero's three-up strip (content.hero.evidence*): bold lead,
  // body, link label + arrow — each optional; all three blank drops the line.
  const heroEvidenceText = [
    filled(content.hero.evidenceLead) ? `<strong>${escapeHtml(content.hero.evidenceLead)}</strong>` : '',
    filled(content.hero.evidenceBody) ? escapeHtml(content.hero.evidenceBody) : '',
    filled(content.hero.evidenceLink) ? `${escapeHtml(content.hero.evidenceLink)} ${icon('arrow')}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Desktop pathway columns: one row for up to four steps, 3 + 2 / 3 + 3 for five
  // or six (never a lone orphan on a second row). Four is the stylesheet default.
  const pathwayCols = content.approach.steps.length > 4 ? 3 : content.approach.steps.length;

  // The homepage body; the shared head/header/drawer/footer come from renderShell.
  const main = `
    <section class="hero" id="top">
      <div class="container hero__layout">
        <div class="hero__copy" data-reveal>
          <h1><span class="hero__lead">${escapeHtml(content.hero.lead)}</span>“${accentuate(heroHeadlineText, config.heroAccent)}”</h1>
          <p>${escapeHtml(config.heroSub)}</p>
          <div class="hero__actions">
            <a class="button" href="#recoveries">${escapeHtml(content.hero.recoveriesButton)} ${icon('arrowDown')}</a>
            <a class="button button--outline" href="${cta.href}"${ctaAttrs}>${cta.icon} ${cta.label}</a>
          </div>${heroChips.length ? `
          <ul class="chip-list hero__chips" aria-label="Conditions we support">
            ${heroChips.map((chip) => `<li>${escapeHtml(chip)}</li>`).join('')}
          </ul>` : ''}
        </div>
        ${featured ? `
        <a class="hero__evidence" href="#recoveries" data-reveal style="--reveal-order:1" aria-label="See documented recoveries">
          <div class="hero__evidence-strip">
            ${featured.images
              .map((entry) => evidenceFrame(entry, featured, imageMap, { sizes: '(max-width: 720px) 30vw, 13vw', eager: true }))
              .join('')}
          </div>${heroEvidenceText ? `
          <p>${heroEvidenceText}</p>` : ''}
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
        ${sectionHeading(content.recoveries)}
        ${featured ? renderJourney(featured, imageMap) : ''}
        ${pairStories.length ? `<div class="pair-story-row${collapsibleRecoveries ? ' pair-story-row--collapsible is-collapsed' : ''}"${collapsibleRecoveries ? ' data-recovery-list' : ''}>${pairStories.map((testimonial, index) => renderPairStory(testimonial, imageMap, index)).join('')}</div>` : ''}
        ${collapsibleRecoveries ? `<div class="recoveries__more"><button type="button" class="button button--outline recoveries__more-btn" data-recovery-toggle aria-expanded="false" data-label-more="View more" data-label-less="View less"><span data-recovery-toggle-label>View more</span>${icon('arrowDown')}</button></div>` : ''}
        ${quoteStories.length ? `<div class="quote-story-grid">${quoteStories.map((testimonial, index) => renderQuoteStory(testimonial, index)).join('')}</div>` : ''}
      </div>
    </section>

    ${solutionsSection}

    ${treatmentSection}

    ${voicesSection}

    <section class="section approach" id="approach">
      <div class="container">
        ${sectionHeading(content.approach)}
        <ol class="pathway"${pathwayCols === 4 ? '' : ` style="--pathway-cols:${pathwayCols}"`} aria-label="How a MediVasc engagement works">
          ${content.approach.steps
            .map(
              (step, index) =>
                `<li data-reveal style="--reveal-order:${index}"><span>${String(index + 1).padStart(2, '0')}</span><div><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p></div></li>`,
            )
            .join('\n          ')}
        </ol>
        <aside class="motto" data-reveal>
          <p class="motto__line">${accentuate(content.approach.mottoLine, content.approach.mottoAccent)}</p>
          <p>${escapeHtml(content.approach.mottoBody)}</p>
        </aside>
      </div>
    </section>

    <section class="section conditions" id="conditions">
      <div class="container">
        ${sectionHeading(content.conditions)}${hasCase || filmList.length ? `
        <div class="${conditionFilmsClass}" data-reveal>${hasCase ? `
          <figure class="condition-case">${caseNoteLines(12, 'figcaption')}
          </figure>` : ''}${filmList.length ? `
          <ul class="condition-films__grid">
            ${filmList.map((film, i) => `<li class="condition-film-item${film.featured ? ' is-featured' : ''}">
              <button class="condition-film" type="button" data-film-src="${escapeHtml(film.src)}" aria-label="Play video ${i + 1}: ${escapeHtml(film.caption)}">
                <span class="condition-film__frame">
                  <span class="condition-film__fill" aria-hidden="true"><img src="${escapeHtml(film.poster)}" alt="" width="480" height="854" loading="lazy" decoding="async"></span>
                  <img class="condition-film__poster" src="${escapeHtml(film.poster)}" alt="" width="480" height="854" loading="lazy" decoding="async">
                  <span class="condition-film__play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>
                  <span class="condition-film__dur">${escapeHtml(film.duration)}</span>
                </span>
              </button>
              <span class="condition-film__cap">${escapeHtml(film.caption)}${film.featured && hasCase ? ` <button type="button" class="condition-film__more" data-case-open><span>View more</span>${icon('arrow')}</button>` : ''}</span>
            </li>`).join('')}
          </ul>` : ''}
        </div>` : ''}
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
      ${filmList.length ? `<dialog class="film-lightbox" data-film-lightbox aria-label="Documented case footage">
        <div class="film-lightbox__stage">
          <div class="film-lightbox__track" data-film-track>
            ${filmList.map((film, i) => `<div class="film-lightbox__slide" data-film-slide>
              <video class="film-lightbox__video" data-film-video data-film-src="${escapeHtml(film.src)}" poster="${escapeHtml(film.poster)}" playsinline preload="none" aria-label="Clip ${i + 1}: ${escapeHtml(film.caption)}"></video>
            </div>`).join('')}
          </div>
        </div>
        <button type="button" class="film-lightbox__nav film-lightbox__nav--prev" data-film-prev aria-label="Previous clip">${icon('arrow')}</button>
        <button type="button" class="film-lightbox__nav film-lightbox__nav--next" data-film-next aria-label="Next clip">${icon('arrow')}</button>
        <p class="film-lightbox__counter" data-film-counter hidden></p>
        <button type="button" class="film-lightbox__close" data-film-close aria-label="Close">${icon('close')}</button>
      </dialog>` : ''}${caseOpener ? `
      <dialog class="case-lightbox" data-case-lightbox aria-label="${filled(conditionsCopy.caseKicker) ? escapeHtml(conditionsCopy.caseKicker) : 'Documented case'}">
        <div class="case-lightbox__card">${caseNoteLines(10, 'p')}
        </div>
        <button type="button" class="case-lightbox__close" data-case-close aria-label="Close">${icon('close')}</button>
      </dialog>` : ''}
    </section>

    <section class="section watch" id="watch">
      <div class="container">
        <div class="watch__panel" data-reveal>
          ${sectionHeading(content.watch, { pad: 10, reveal: false })}
          <ul class="watch-list">
            ${content.watch.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n            ')}
          </ul>
          <aside class="watch-note">
            <p>${accentuate(content.watch.note, content.watch.noteAccent)}</p>
          </aside>
        </div>
      </div>
    </section>

    ${eligibilitySection}

    <section class="section act" id="act">
      <div class="container">
        <div class="act__panel" data-reveal>
          <div class="act__layout">
            <div>
              <h2>${accentuate(content.act.heading, content.act.accent)}</h2>
              <p>${escapeHtml(content.act.body)}</p>
              ${freeConsultNote(content.consult, 'on-dark')}
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
        <div class="about__title" data-reveal><h2>${escapeHtml(content.about.heading)}</h2>${filled(content.about.location) ? `<p class="about__location">${escapeHtml(content.about.location)}</p>` : ''}</div>
        <div class="about__copy" data-reveal style="--reveal-order:1">${aboutParagraphs}</div>
      </div>
    </section>

    <section class="contact" id="contact">
      <div class="container contact__layout">
        <div class="contact__intro" data-reveal>
          <h2>${accentuate(content.contact.heading, content.contact.accent)}</h2>
          <p>${escapeHtml(content.contact.body)}</p>
          ${freeConsultNote(content.consult)}
        </div>
        <div class="contact__details" data-reveal style="--reveal-order:1">
          ${company.phone ? `<a class="contact-row" href="tel:${telephone}">${icon('call')}<span><small>Phone</small>Call us</span></a>` : ''}
          ${company.whatsapp ? `<a class="contact-row" href="${waPatient}" target="_blank" rel="noreferrer">${icon('whatsapp')}<span><small>WhatsApp</small>WhatsApp us</span></a>` : ''}
          ${company.email ? `<a class="contact-row" href="mailto:${escapeHtml(company.email)}">${icon('mail')}<span><small>Email</small>${escapeHtml(company.email)}</span></a>` : ''}
          <div class="contact-row contact-row--static">${icon('map')}<span><small>Location</small>${escapeHtml(company.address)}</span></div>
        </div>
      </div>
    </section>
  `;
  return renderShell({
    site: { company, content, config, themeId, themeBg, siteUrl, cssPath, jsPath, markPaths, markPathsTm, markPathsTmLg, blogNav },
    title: config.seo.title,
    description: config.seo.description,
    canonical: siteUrl,
    ogImage: `${siteUrl}${ogImage}`,
    ogImageAlt: config.seo.imageAlt,
    jsonLd: [renderJsonLd({ company, config, siteUrl })],
    main,
  });
};

module.exports = { renderPage, renderShell, contactHrefs, phoneHref, escapeHtml };
