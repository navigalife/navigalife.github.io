(() => {
  const root = document.documentElement;
  const dialog = document.querySelector('#product-dialog');
  const details = [...document.querySelectorAll('[data-product-detail]')];
  const themeToggle = document.querySelector('[data-theme-toggle]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const navigation = document.querySelector('[data-nav]');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  let lastFocused = null;

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
      localStorage.setItem('naviga-color-scheme', isDark() ? 'dark' : 'light');
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

  const productIdFromHash = () => {
    const match = location.hash.match(/^#product\/([a-z0-9-]+)$/);
    return match ? match[1] : null;
  };

  const showProduct = (id) => {
    const selected = details.find((detail) => detail.dataset.productDetail === id);
    if (!selected) return false;
    details.forEach((detail) => {
      detail.hidden = detail !== selected;
    });
    dialog.setAttribute('aria-labelledby', `dialog-title-${id}`);
    if (!dialog.open) {
      lastFocused = document.activeElement;
      dialog.showModal();
    }
    dialog.querySelector('[data-dialog-close]')?.focus({ preventScroll: true });
    return true;
  };

  const hideProduct = () => {
    if (!dialog.open) return;
    dialog.close();
    details.forEach((detail) => {
      detail.hidden = true;
    });
    if (lastFocused instanceof HTMLElement) lastFocused.focus({ preventScroll: true });
  };

  const syncProductRoute = () => {
    const id = productIdFromHash();
    if (id && showProduct(id)) return;
    hideProduct();
  };

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-product-open]');
    if (!opener) return;
    event.preventDefault();
    const id = opener.dataset.productOpen;
    const hash = `#product/${id}`;
    if (location.hash === hash) {
      showProduct(id);
      return;
    }
    history.pushState({ productOverlay: true }, '', hash);
    showProduct(id);
  });

  const closeProductRoute = () => {
    if (history.state?.productOverlay) history.back();
    else {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      hideProduct();
    }
  };

  dialog?.querySelector('[data-dialog-close]')?.addEventListener('click', closeProductRoute);
  dialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeProductRoute();
  });
  dialog?.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.closest('[hidden]') && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) closeProductRoute();
  });
  window.addEventListener('popstate', syncProductRoute);
  window.addEventListener('hashchange', syncProductRoute);
  syncProductRoute();

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
})();
