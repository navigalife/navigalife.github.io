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
