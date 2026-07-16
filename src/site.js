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

  // Expandable recoveries — the non-featured case cards collapse to the first
  // three; the toggle animates the rest open/closed. The resting collapsed state
  // hides the extras via CSS (display:none on :nth-child(n+4)), so it is immune
  // to reflow and late image loads; we only measure heights during the max-height
  // transition itself, then hand back to the CSS resting states.
  const recoveryList = document.querySelector('[data-recovery-list]');
  const recoveryToggle = document.querySelector('[data-recovery-toggle]');
  if (recoveryList && recoveryToggle) {
    const toggleLabel = recoveryToggle.querySelector('[data-recovery-toggle-label]');
    const labelMore = recoveryToggle.dataset.labelMore || 'View more';
    const labelLess = recoveryToggle.dataset.labelLess || 'View less';
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animating = false;

    const setExpandedState = (expanded) => {
      recoveryToggle.setAttribute('aria-expanded', String(expanded));
      if (toggleLabel) toggleLabel.textContent = expanded ? labelLess : labelMore;
    };

    // Bottom edge of the third card, relative to the row — the collapsed clip line.
    const collapsedHeight = () => {
      const cards = [...recoveryList.children];
      if (cards.length <= 3) return recoveryList.scrollHeight;
      const top = recoveryList.getBoundingClientRect().top;
      return Math.round(cards[2].getBoundingClientRect().bottom - top);
    };

    // Run `done` once the max-height transition ends, with a timeout fallback so a
    // dropped transitionend can never leave the row stuck mid-animation.
    const afterTransition = (done) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        recoveryList.removeEventListener('transitionend', onEnd);
        done();
      };
      const onEnd = (event) => {
        if (event.target === recoveryList && event.propertyName === 'max-height') finish();
      };
      recoveryList.addEventListener('transitionend', onEnd);
      setTimeout(finish, 620);
    };

    const expand = () => {
      if (animating) return;
      const startHeight = recoveryList.getBoundingClientRect().height;
      recoveryList.classList.remove('is-collapsed'); // extras take their natural space
      [...recoveryList.children].slice(3).forEach((card) => card.classList.add('is-visible'));
      setExpandedState(true);
      if (reduceMotion) return;
      const endHeight = recoveryList.scrollHeight;
      animating = true;
      recoveryList.style.overflow = 'hidden';
      recoveryList.style.maxHeight = `${startHeight}px`;
      void recoveryList.offsetHeight; // reflow so the start height is committed
      afterTransition(() => {
        recoveryList.style.maxHeight = '';
        recoveryList.style.overflow = '';
        animating = false;
      });
      recoveryList.style.maxHeight = `${endHeight}px`;
    };

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    // Instant re-centre of the toggle (used only on the reduced-motion path).
    const centreToggle = () => {
      const rect = recoveryToggle.getBoundingClientRect();
      const target = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
      window.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
    };

    // Collapse and re-centre as one synchronised motion: a single rAF loop clips the
    // row shut and scrolls the page on the same easing curve, so the toggle glides to
    // the viewport centre exactly as the extra cards close. (Animating the height and
    // then scrolling afterwards read as two disconnected steps.)
    const collapse = () => {
      if (animating) return;
      setExpandedState(false);
      if (reduceMotion) {
        recoveryList.classList.add('is-collapsed');
        centreToggle();
        return;
      }
      const startHeight = recoveryList.getBoundingClientRect().height;
      const targetHeight = collapsedHeight();
      const deltaHeight = startHeight - targetHeight; // how far content below rises as the row closes
      const startScroll = window.scrollY;
      const rect = recoveryToggle.getBoundingClientRect();
      // Scroll offset that lands the button's centre at the viewport centre once the
      // row is fully closed (the button rises by deltaHeight along the way).
      const endScroll = Math.max(
        0,
        startScroll + rect.top + rect.height / 2 - deltaHeight - window.innerHeight / 2,
      );
      const duration = 480;
      const startTime = performance.now();
      const rootStyle = document.documentElement.style;
      const prevAnchor = rootStyle.overflowAnchor;
      rootStyle.overflowAnchor = 'none'; // keep scroll-anchoring from fighting our per-frame scroll
      recoveryList.style.transition = 'none'; // this direction is hand-driven, not the CSS transition
      recoveryList.style.overflow = 'hidden';
      recoveryList.style.maxHeight = `${startHeight}px`;
      animating = true;
      const step = (now) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = easeOutCubic(progress);
        recoveryList.style.maxHeight = `${startHeight + (targetHeight - startHeight) * eased}px`;
        // behavior:'instant' overrides the page's CSS scroll-behavior:smooth so each
        // frame positions immediately — rAF (not the browser) drives the motion.
        window.scrollTo({ top: startScroll + (endScroll - startScroll) * eased, behavior: 'instant' });
        if (progress < 1) {
          requestAnimationFrame(step);
          return;
        }
        recoveryList.classList.add('is-collapsed'); // hand back to the display:none rest state
        recoveryList.style.maxHeight = '';
        recoveryList.style.overflow = '';
        recoveryList.style.transition = '';
        rootStyle.overflowAnchor = prevAnchor;
        animating = false;
      };
      requestAnimationFrame(step);
    };

    recoveryToggle.addEventListener('click', () => {
      if (recoveryList.classList.contains('is-collapsed')) expand();
      else collapse();
    });
  }
})();
