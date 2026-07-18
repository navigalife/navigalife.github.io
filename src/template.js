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

// One carousel slide — the same evidence frame the recoveries use (4:5, blurred
// cover fill behind a contained photo), minus the stage caption.
const solutionSlide = (item, imageMap, condition, index, total) => `
        <li class="solution-slide">
          <div class="evidence">
            <div class="evidence__image">
              <div class="evidence__fill" aria-hidden="true">${image(item.src, imageMap, { alt: '', sizes: '(max-width:1000px) 92vw, 45vw', width: item.width, height: item.height })}</div>
              ${image(item.src, imageMap, {
                alt: `${condition}: photograph ${index + 1} of ${total}`,
                sizes: '(max-width:1000px) 92vw, 45vw',
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
  return `
    <article class="solution-card" data-reveal style="--reveal-order:${index}">
      ${solutionCarousel(card.images, imageMap, card.condition)}
      <div class="solution-card__body">
        <h3>${escapeHtml(card.title)}</h3>
        ${body}
        <a class="button solution-card__cta" href="${card.cta.href}"${card.cta.external ? ' target="_blank" rel="noreferrer"' : ''}>${card.cta.icon} ${escapeHtml(card.cta.label)}</a>
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

// MediVasc Assistant — a conversational lead form that lives at bottom-right on every
// viewport. The shell is server-rendered (no layout shift); site.js drives the
// chat and, on completion, builds a wa.me deep-link with the case prefilled.
// html.js-gated in CSS, so without JS the page's own contact routes take over.
const renderChatbot = ({ wa, email, conditions }) => {
  const xIcon =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const chatIcon =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.4a7.6 7.6 0 0 1-11 6.8L4.5 19.6l1.4-4.4A7.6 7.6 0 1 1 20 11.4Z"/><circle cx="8.5" cy="11.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="12" cy="11.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.5" cy="11.6" r="1.05" fill="currentColor" stroke="none"/></svg>';
  const sendIcon =
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.5 3.5c-.5-.2-1 .3-.85.82L4.4 11 14 12 4.4 13l-1.75 6.68c-.14.51.36 1 .85.82l17.2-7.55c.5-.22.5-.94 0-1.16L3.5 3.5Z"/></svg>';
  const config = JSON.stringify({ wa: wa || '', email: email || '', conditions: conditions || [] }).replaceAll('<', '\\u003c');
  return `
  <div class="mvbot" data-mvbot data-mvbot-state="closed">
    <div class="mvbot__panel" id="mvbot-panel" data-mvbot-panel role="dialog" aria-label="MediVasc Assistant" aria-modal="false" aria-hidden="true">
      <header class="mvbot__head">
        <span class="mvbot__avatar" aria-hidden="true"><img src="assets/brand/icon-192.png" alt="" width="42" height="42" loading="lazy" decoding="async"></span>
        <span class="mvbot__id">
          <span class="mvbot__name">MediVasc Assistant</span>
          <span class="mvbot__status"><span class="mvbot__status-dot" aria-hidden="true"></span>Online · replies personally</span>
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
      <p class="mvbot__legal">Opens WhatsApp with your details ready to send. A person replies. This isn’t medical advice.</p>
    </div>
    <div class="mvbot__nudge" data-mvbot-nudge hidden>
      <button type="button" class="mvbot__nudge-x" data-mvbot-nudge-x aria-label="Dismiss">${xIcon}</button>
      <strong>Have a case?</strong> Request a customized solution in ~30 seconds.
    </div>
    <button type="button" class="mvbot__launcher" data-mvbot-toggle aria-expanded="false" aria-controls="mvbot-panel" aria-label="Chat with MediVasc Assistant">
      <span class="mvbot__launcher-ico mvbot__launcher-ico--chat" aria-hidden="true">${chatIcon}</span>
      <span class="mvbot__launcher-ico mvbot__launcher-ico--close" aria-hidden="true">${xIcon}</span>
      <span class="mvbot__launcher-ping" aria-hidden="true"></span>
    </button>
    <script type="application/json" data-mvbot-config>${config}</script>
  </div>`;
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
  markPaths,
  markPathsTm,
  markPathsTmLg,
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
  // Once there are more than three non-featured case cards the row collapses to
  // the first three and a "View more" toggle (site.js) animates the rest open.
  const collapsibleRecoveries = pairStories.length > 3;
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
  // The four conditions the chatbot offers as quick-reply chips (owner-curated).
  // Kept separate from heroChips so the bot's tappable options stay short.
  const botConditions = ['Diabetic foot', 'Lymphedema', 'Venous ulcers', 'Mastectomy'];
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
        <div class="section-heading" data-reveal>
          <div>
            <p class="kicker">Complications we treat</p>
            <h2>Two conditions, <em>up close</em></h2>
          </div>
          <p>Post-mastectomy arm lymphedema, and elephantiasis with filariasis: the two we are asked about most. See what they look like, and how a customized protocol changes their course.</p>
        </div>
        <div class="solution-grid">
          ${solutionCards.map((card, index) => renderSolutionCard(card, imageMap, index)).join('')}
        </div>
      </div>
    </section>`
    : '';
  const voices = Array.isArray(feedbackImages) ? feedbackImages : [];
  const voicesSection = voices.length
    ? `<section class="section voices" id="voices">
      <div class="container">
        <div class="section-heading" data-reveal>
          <div>
            <p class="kicker">In their words</p>
            <h2>What patients <em>say</em> about us</h2>
          </div>
          <p>Unedited messages from patients and their families, shared with their permission. Tap any note to read it in full.</p>
        </div>
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
  // Single source for the primary nav — rendered inline in the header (desktop)
  // and inside the mobile slide-in drawer (below); keep the two in sync via this.
  const navItems = [
    ['#recoveries', 'Recoveries'],
    ['#approach', 'Our approach'],
    ['#conditions', 'Conditions'],
    ['#about', 'About'],
    ['#contact', 'Contact'],
  ];
  const navLinksHtml = navItems.map(([href, label]) => `<a href="${href}">${label}</a>`).join('');
  const heroStats = Array.isArray(config.heroStats)
    ? config.heroStats.filter((stat) => stat && stat.value && stat.label)
    : [];
  const aboutParagraphs = company.about
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
  // The hero headline is wrapped in styled curly quotes below. The admin CMS is a
  // co-writer and the owner sometimes types their own quotes into the headline —
  // strip any surrounding straight/curly quotes (and stray whitespace) here so the
  // render always shows exactly one styled set, never a doubled "«…»".
  const heroHeadlineText = String(config.heroHeadline || '')
    .replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, '');
  const lockup = (context) => `<span class="lockup" aria-hidden="true">
    <img class="lockup--ink" src="${markPaths.ink}" alt="" width="512" height="257" loading="${context === 'header' ? 'eager' : 'lazy'}" decoding="async">
    <img class="lockup--paper" src="${markPaths.paper}" alt="" width="512" height="257" loading="${context === 'header' ? 'eager' : 'lazy'}" decoding="async">
  </span>`;
  // Footer-only lockup: the ™ is baked into these variants at the 'c' shoulder
  // (see assets/brand/logo-*-tm*.png) rather than positioned in CSS, so it stays
  // pixel-tight to the letterform. Two size wrappers — '-lg' (larger ™) for the
  // 54px desktop render, base for the 64px phone render — swapped by breakpoint in
  // CSS (.lockup__size--sm hidden on desktop, --lg hidden ≤760px). Wider canvas
  // than the plain mark → each img carries its own intrinsic width/height.
  const tmImg = (mark) =>
    `<img class="lockup--ink" src="${mark.ink.src}" alt="" width="${mark.ink.width}" height="${mark.ink.height}" loading="lazy" decoding="async">
    <img class="lockup--paper" src="${mark.paper.src}" alt="" width="${mark.paper.width}" height="${mark.paper.height}" loading="lazy" decoding="async">`;
  const footerLockup = () => `<span class="lockup" aria-hidden="true">
    <span class="lockup__size lockup__size--lg">${tmImg(markPathsTmLg)}</span>
    <span class="lockup__size lockup__size--sm">${tmImg(markPathsTm)}</span>
  </span>`;
  // The bot deep-links to WhatsApp when a number is on record, else composes an
  // email; if neither exists it is omitted (site.js no-ops on a missing config).
  const chatbot = whatsapp || company.email
    ? renderChatbot({ wa: whatsapp, email: company.email, conditions: botConditions })
    : '';

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

  <main id="main">
    <section class="hero" id="top">
      <div class="container hero__layout">
        <div class="hero__copy" data-reveal>
          <h1><span class="hero__lead">Prevention of foot and leg amputation</span>“${accentuate(heroHeadlineText, config.heroAccent)}”</h1>
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
        ${pairStories.length ? `<div class="pair-story-row${collapsibleRecoveries ? ' pair-story-row--collapsible is-collapsed' : ''}"${collapsibleRecoveries ? ' data-recovery-list' : ''}>${pairStories.map((testimonial, index) => renderPairStory(testimonial, imageMap, index)).join('')}</div>` : ''}
        ${collapsibleRecoveries ? `<div class="recoveries__more"><button type="button" class="button button--outline recoveries__more-btn" data-recovery-toggle aria-expanded="false" data-label-more="View more" data-label-less="View less"><span data-recovery-toggle-label>View more</span>${icon('arrowDown')}</button></div>` : ''}
        ${quoteStories.length ? `<div class="quote-story-grid">${quoteStories.map((testimonial, index) => renderQuoteStory(testimonial, index)).join('')}</div>` : ''}
      </div>
    </section>

    ${solutionsSection}

    ${voicesSection}

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
      <span class="footer-brand">${footerLockup()}<span class="sr-only">MediVasc™</span></span>
      <p>${escapeHtml(company.tagline)}</p>
      <nav aria-label="Footer navigation"><a href="#recoveries">Recoveries</a><a href="#approach">Approach</a><a href="#conditions">Conditions</a><a href="#about">About</a><a href="#contact">Contact</a></nav>
    </div>
    <div class="container footer__bottom">
      <p>Results may vary depending on the history, cause and onset of the disease.</p>
      <p>© ${new Date().getFullYear()} ${escapeHtml(company.legalName)}</p>
    </div>
  </footer>

  ${chatbot}

  <noscript><p class="noscript">Theme controls require JavaScript. All recovery stories, protocols, and contact routes remain available above.</p></noscript>
  <script src="${jsPath}" defer></script>
</body>
</html>`;
};

module.exports = { renderPage };
