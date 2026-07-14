(() => {
  const root = document.documentElement;
  const themeToggle = document.querySelector('[data-theme-toggle]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const navigation = document.querySelector('[data-nav]');
  const themeColor = document.querySelector('meta[name="theme-color"]');

  const isDark = () => root.dataset.theme === 'dark';

  const refreshThemeControl = () => {
    if (!themeToggle) return;
    const next = isDark() ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
    if (themeColor) {
      themeColor.content = getComputedStyle(root).getPropertyValue('--bg').trim();
    }
  };

  themeToggle?.addEventListener('click', () => {
    if (isDark()) delete root.dataset.theme;
    else root.dataset.theme = 'dark';
    try {
      localStorage.setItem('medivasc-color-scheme', isDark() ? 'dark' : 'light');
      localStorage.removeItem('naviga-color-scheme');
    } catch (error) {
      // Theme still applies for this visit when storage is unavailable.
    }
    refreshThemeControl();
  });
  refreshThemeControl();

  const closeMenu = () => {
    navigation?.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  };

  menuToggle?.addEventListener('click', () => {
    const open = navigation?.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(Boolean(open)));
  });
  navigation?.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navigation?.classList.contains('is-open')) closeMenu();
  });

  const header = document.querySelector('[data-header]');
  const refreshHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  document.addEventListener('scroll', refreshHeader, { passive: true });
  refreshHeader();

  const revealItems = [...document.querySelectorAll('[data-reveal]')];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -7% 0px', threshold: 0.08 },
    );
    revealItems.forEach((item) => observer.observe(item));
  }

  // Hero counters ease up to their target the first time they scroll into view.
  // The authored text (e.g. "500+", "7.5k+") is parsed into prefix/number/suffix
  // so any admin-entered value animates without hard-coding the format.
  const counters = [...document.querySelectorAll('[data-count]')];
  if (counters.length) {
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parse = (text) => {
      const match = text.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/s);
      if (!match) return null;
      const value = Number(match[2].replace(/,/g, ''));
      if (!Number.isFinite(value)) return null;
      const fraction = match[2].includes('.') ? match[2].split('.')[1].length : 0;
      return { prefix: match[1], suffix: match[3], value, fraction, group: match[2].includes(',') };
    };
    const format = (n, spec) =>
      spec.prefix +
      n.toLocaleString('en-US', {
        minimumFractionDigits: spec.fraction,
        maximumFractionDigits: spec.fraction,
        useGrouping: spec.group,
      }) +
      spec.suffix;
    const specs = counters.map((element) => {
      const spec = parse(element.textContent.trim());
      if (spec && !reduceMotion) element.textContent = format(0, spec);
      return spec;
    });
    const countUp = (element, spec) => {
      const duration = 2000;
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = spec.fraction ? spec.value * eased : Math.round(spec.value * eased);
        element.textContent = format(current, spec);
        if (progress < 1) requestAnimationFrame(step);
        else element.textContent = format(spec.value, spec);
      };
      requestAnimationFrame(step);
    };
    if (!reduceMotion && 'IntersectionObserver' in window) {
      const counterObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const index = counters.indexOf(entry.target);
            counterObserver.unobserve(entry.target);
            if (specs[index]) countUp(entry.target, specs[index]);
          });
        },
        { threshold: 0.6 },
      );
      counters.forEach((element, index) => {
        if (specs[index]) counterObserver.observe(element);
      });
    }
  }
})();
