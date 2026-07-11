const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const icon = (name) => {
  const paths = {
    arrow: '<path d="M5 12h14M14 6l6 6-6 6"/>',
    call: '<path d="M7.4 3.5 10 8 7.8 9.7c1.2 2.6 3.3 4.7 5.9 5.9l1.7-2.2 4.6 2.5-.8 4a2 2 0 0 1-2 1.6C9.1 20.7 3.3 14.9 2.5 6.8a2 2 0 0 1 1.6-2l3.3-.7Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    map: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    message: '<path d="M20 11.5a8 8 0 0 1-11.8 7L3 20l1.5-5.1A8 8 0 1 1 20 11.5Z"/><path d="M8.5 9.3c.8 2 2.2 3.4 4.2 4.2"/>',
    moon: '<path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.5 8.5 0 1 0 11.4 11.4Z"/>',
    sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
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
  return `<img src="${src}" srcset="${srcset}" sizes="${escapeHtml(options.sizes || '(max-width: 720px) 92vw, 40vw')}" width="${options.width || 1200}" height="${options.height || 800}" alt="${escapeHtml(options.alt)}" loading="${loading}" decoding="async"${priority}>`;
};

const chips = (conditions) =>
  `<ul class="chip-list" aria-label="Conditions supported">${conditions
    .map((condition) => `<li>${escapeHtml(condition)}</li>`)
    .join('')}</ul>`;

const renderProductCard = (product, imageMap, index) => `
  <article class="product-card" data-reveal style="--reveal-order:${index % 3}">
    <a class="product-card__image" href="#product/${escapeHtml(product.id)}" data-product-open="${escapeHtml(product.id)}" aria-label="View details for ${escapeHtml(product.name)}">
      ${image(product.images[0], imageMap, { alt: `${product.name} compression therapy device`, sizes: '(max-width: 720px) 92vw, (max-width: 1100px) 45vw, 30vw' })}
    </a>
    <div class="product-card__body">
      <h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(product.tagline)}</p>
      ${chips(product.conditions.slice(0, 3))}
      <a class="text-link" href="#product/${escapeHtml(product.id)}" data-product-open="${escapeHtml(product.id)}">View details ${icon('arrow')}</a>
    </div>
  </article>`;

const renderProductDetail = (product, imageMap, company) => {
  const telephone = phoneHref(company.phone);
  const whatsapp = phoneHref(company.whatsapp).replace('+', '');
  const visibleSpecs = product.specs.filter((spec) => spec.visible);
  return `
    <article class="product-detail" data-product-detail="${escapeHtml(product.id)}" hidden>
      <div class="product-detail__gallery">
        <div class="product-detail__image-frame">
          ${image(product.images[0], imageMap, { alt: `${product.name} compression therapy device`, sizes: '(max-width: 800px) 90vw, 44vw' })}
        </div>
      </div>
      <div class="product-detail__content">
        <p class="product-detail__category">${escapeHtml(product.category)}</p>
        <h2 id="dialog-title-${escapeHtml(product.id)}">${escapeHtml(product.name)}</h2>
        <p class="product-detail__tagline">${escapeHtml(product.tagline)}</p>
        <p>${escapeHtml(product.description)}</p>
        ${chips(product.conditions)}
        <h3>Device specifications</h3>
        <div class="spec-table-wrap">
          <table>
            <tbody>${visibleSpecs.map((spec) => `<tr><th scope="row">${escapeHtml(spec.key)}</th><td>${escapeHtml(spec.value)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="detail-actions">
          ${product.catalogue ? `<a class="button button--quiet" href="catalogues/${escapeHtml(product.id)}.pdf" download>Download catalogue</a>` : ''}
          <a class="button" href="https://wa.me/${whatsapp}?text=${encodeURIComponent(`I would like guidance on the ${product.name}.`)}" target="_blank" rel="noreferrer">${icon('message')} WhatsApp</a>
          <a class="button button--outline" href="tel:${telephone}">${icon('call')} Call</a>
        </div>
      </div>
    </article>`;
};

const renderTestimonial = (testimonial, imageMap, index) => `
  <figure class="testimonial ${testimonial.image ? 'testimonial--photo' : ''}" data-reveal style="--reveal-order:${index % 3}">
    ${testimonial.image ? `<div class="testimonial__portrait">${image(testimonial.image, imageMap, { alt: `Representative portrait of ${testimonial.name}`, sizes: '(max-width: 720px) 88px, 112px', width: 640, height: 640 })}</div>` : ''}
    <blockquote>“${escapeHtml(testimonial.quote)}”</blockquote>
    <figcaption>
      <strong>${escapeHtml(testimonial.name)}</strong>
      <span>${escapeHtml(testimonial.location)}</span>
      <span>${escapeHtml(testimonial.context)}</span>
    </figcaption>
  </figure>`;

const renderJsonLd = ({ company, products, imageMap, siteUrl }) => {
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.legalName,
    url: siteUrl,
    logo: `${siteUrl}assets/brand/logo.svg`,
    telephone: phoneHref(company.phone),
    address: { '@type': 'PostalAddress', streetAddress: company.address, addressCountry: 'IN' },
  };
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Product',
        name: product.name,
        description: product.description,
        image: `${siteUrl}${imageMap[product.images[0]][1200] || imageMap[product.images[0]][640]}`,
        category: product.category,
        url: `${siteUrl}#product/${product.id}`,
        brand: { '@type': 'Brand', name: company.name },
      },
    })),
  };
  return JSON.stringify([organization, itemList]).replaceAll('<', '\\u003c');
};

const renderPage = ({
  company,
  products,
  testimonials,
  config,
  themeId,
  imageMap,
  cssPath,
  jsPath,
  ogImage,
  siteUrl,
}) => {
  const featured = products.filter((product) => product.featured).slice(0, 3);
  const groups = [...new Set(products.map((product) => product.category))];
  const telephone = phoneHref(company.phone);
  const whatsapp = phoneHref(company.whatsapp).replace('+', '');
  const aboutParagraphs = company.about.split(/\n\n+/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
  const optionalContact = [
    company.email ? `<a class="contact-row" href="mailto:${escapeHtml(company.email)}">${icon('mail')}<span><small>Email</small>${escapeHtml(company.email)}</span></a>` : '',
    company.hours ? `<div class="contact-row"><span class="contact-row__marker" aria-hidden="true">24</span><span><small>Support hours</small>${escapeHtml(company.hours)}</span></div>` : '',
  ].join('');

  return `<!doctype html>
<html lang="en" data-site-theme="${escapeHtml(themeId)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>(function(){try{var s=localStorage.getItem('naviga-color-scheme');var d=s?s==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.dataset.theme='dark'}catch(e){}})()</script>
  <title>${escapeHtml(config.seo.title)}</title>
  <meta name="description" content="${escapeHtml(config.seo.description)}">
  <meta name="theme-color" content="#F6F4EF">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(config.seo.title)}">
  <meta property="og:description" content="${escapeHtml(config.seo.description)}">
  <meta property="og:url" content="${siteUrl}">
  <meta property="og:image" content="${siteUrl}${ogImage}">
  <link rel="canonical" href="${siteUrl}">
  <link rel="icon" href="assets/brand/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="assets/brand/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="assets/brand/apple-touch-icon.png">
  <link rel="preload" href="assets/fonts/fraunces-latin-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/instrument-sans-latin-400-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${cssPath}">
  <script type="application/ld+json">${renderJsonLd({ company, products, imageMap, siteUrl })}</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header" data-header>
    <div class="container header-inner">
      <a class="wordmark" href="#top" aria-label="Naviga Life home"><span class="wordmark__text" aria-hidden="true">Naviga Life</span></a>
      <button class="icon-button menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-menu-toggle><span class="sr-only">Open navigation</span>${icon('menu')}</button>
      <nav class="site-nav" id="site-nav" aria-label="Main navigation" data-nav>
        <a href="#products">Devices</a>
        <a href="#therapy">Therapy</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
      <div class="header-actions">
        <button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme">
          <span class="theme-toggle__sun">${icon('sun')}</span><span class="theme-toggle__moon">${icon('moon')}</span>
        </button>
        <a class="button header-cta" href="https://wa.me/${whatsapp}?text=${encodeURIComponent('I would like help choosing a compression therapy system.')}" target="_blank" rel="noreferrer">Talk to us</a>
      </div>
    </div>
  </header>

  <main id="main">
    <section class="hero" id="top">
      <div class="container hero__layout">
        <div class="hero__copy" data-reveal>
          <h1>${escapeHtml(config.heroHeadline)}</h1>
          <p>${escapeHtml(config.heroSub)}</p>
          <div class="hero__actions">
            <a class="button" href="#products">Explore the range ${icon('arrow')}</a>
            <a class="text-link" href="#therapy">Understand the therapy</a>
          </div>
        </div>
        <div class="hero__media" aria-label="Featured compression therapy systems" data-reveal style="--reveal-order:1">
          ${featured.map((product, index) => `<figure class="hero-product hero-product--${index + 1}">${image(product.images[0], imageMap, { alt: `${product.name} compression system`, sizes: '(max-width: 720px) 70vw, 34vw', eager: index === 0 })}<figcaption>${escapeHtml(product.name)}</figcaption></figure>`).join('')}
        </div>
      </div>
      <div class="container">
        <dl class="trust-strip" data-reveal>
          <div><dt>Since ${escapeHtml(company.founded)}</dt><dd>Focused on vascular and lymphatic care</dd></div>
          <div><dt>GST-verified</dt><dd>Registered Indian medical-device supplier</dd></div>
          <div><dt>${products.length} devices</dt><dd>Arm, leg, and foot configurations</dd></div>
          <div><dt>Selection support</dt><dd>Call or WhatsApp before you choose</dd></div>
        </dl>
      </div>
    </section>

    <section class="section product-range" id="products">
      <div class="container">
        <div class="section-heading" data-reveal>
          <h2>Compression systems for distinct care plans</h2>
          <p>Compare chamber counts, garment configurations, pressure ranges, and supported conditions. A clinician should guide device selection and treatment settings.</p>
        </div>
        ${groups.map((group) => {
          const groupProducts = products.filter((product) => product.category === group);
          return `<section class="product-group" aria-labelledby="category-${escapeHtml(group.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
            <div class="product-group__heading" data-reveal>
              <h3 id="category-${escapeHtml(group.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(group)}</h3>
              <span>${groupProducts.length} ${groupProducts.length === 1 ? 'device' : 'devices'}</span>
            </div>
            <div class="product-grid">${groupProducts.map((product, index) => renderProductCard(product, imageMap, index)).join('')}</div>
          </section>`;
        }).join('')}
      </div>
    </section>

    <section class="section therapy" id="therapy">
      <div class="container therapy__layout">
        <div class="section-heading" data-reveal>
          <h2>How sequential compression therapy works</h2>
          <p>A controller fills overlapping chambers in a prescribed sequence. The graduated pressure supports fluid movement and circulation during a timed session.</p>
        </div>
        <ol class="therapy-steps">
          <li data-reveal style="--reveal-order:0"><span>01</span><div><h3>Fit the garment</h3><p>Position the prescribed arm, leg, or foot sleeve and connect its air lines to the controller.</p></div></li>
          <li data-reveal style="--reveal-order:1"><span>02</span><div><h3>Set the care plan</h3><p>Use the pressure, mode, and timer settings provided by the treating clinician.</p></div></li>
          <li data-reveal style="--reveal-order:2"><span>03</span><div><h3>Complete the cycle</h3><p>The chambers inflate and release in sequence. Stop and contact a clinician if discomfort occurs.</p></div></li>
        </ol>
      </div>
    </section>

    <section class="section stories" id="stories">
      <div class="container">
        <div class="section-heading section-heading--split" data-reveal>
          <h2>Care routines, in patients’ own words</h2>
          <p>Representative profiles are shown to preview this section. Verified customer experiences will replace them before publication.</p>
        </div>
        <div class="testimonial-grid">${testimonials.map((testimonial, index) => renderTestimonial(testimonial, imageMap, index)).join('')}</div>
      </div>
    </section>

    <section class="section about" id="about">
      <div class="container about__layout">
        <div class="about__title" data-reveal><h2>Built for the practical work of long-term care</h2><p class="about__location">New Delhi, India</p></div>
        <div class="about__copy" data-reveal style="--reveal-order:1">${aboutParagraphs}</div>
      </div>
    </section>

    <section class="contact" id="contact">
      <div class="container contact__layout">
        <div class="contact__intro" data-reveal>
          <h2>Start with the care plan</h2>
          <p>Tell us the prescribed limb, chamber count, and use setting. We can help you narrow the range before you speak with your clinician.</p>
        </div>
        <div class="contact__details" data-reveal style="--reveal-order:1">
          <a class="contact-row" href="tel:${telephone}">${icon('call')}<span><small>Call</small>+91 ${escapeHtml(company.phone)}</span></a>
          <a class="contact-row" href="https://wa.me/${whatsapp}?text=${encodeURIComponent('I would like help choosing a compression therapy system.')}" target="_blank" rel="noreferrer">${icon('message')}<span><small>WhatsApp</small>+91 ${escapeHtml(company.whatsapp)}</span></a>
          ${optionalContact}
          <a class="contact-row" href="${escapeHtml(company.mapsUrl)}" target="_blank" rel="noreferrer">${icon('map')}<span><small>Visit or map</small>${escapeHtml(company.address)}</span></a>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer__top">
      <span class="footer-wordmark" aria-label="Naviga Life">Naviga Life</span>
      <p>${escapeHtml(company.tagline)}</p>
      <nav aria-label="Footer navigation"><a href="#products">Devices</a><a href="#therapy">Therapy</a><a href="#about">About</a><a href="#contact">Contact</a></nav>
    </div>
    <div class="container footer__bottom">
      <p>Individual results may vary. Please consult your physician for guidance specific to your condition.</p>
      <p>© ${new Date().getFullYear()} ${escapeHtml(company.legalName)}</p>
    </div>
  </footer>

  <dialog class="product-dialog" id="product-dialog" aria-labelledby="product-dialog-title">
    <h2 class="sr-only" id="product-dialog-title">Product details</h2>
    <button class="dialog-close icon-button" type="button" data-dialog-close aria-label="Close product details">${icon('close')}</button>
    <div class="dialog-scroll">${products.map((product) => renderProductDetail(product, imageMap, company)).join('')}</div>
  </dialog>

  <noscript><p class="noscript">Product detail overlays and theme controls require JavaScript. All product summaries and contact routes remain available above.</p></noscript>
  <script src="${jsPath}" defer></script>
</body>
</html>`;
};

module.exports = { renderPage };
