// Blog landing enhancements (W2a). Optional: every page reads fully without it.
// - Featured carousel pager: progress thumb, 01/04 count, prev/next on desktop.
// - Archive "Load more": shows rows in pages; without JS every row is visible.
// Guarded IIFE — no-ops on pages without these elements (it is concatenated with
// reader.js into blog.js and loaded on every blog page).
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  document.querySelectorAll('[data-blog-featured]').forEach((root) => {
    const track = root.querySelector('[data-bf-track]');
    const slides = track ? [...track.querySelectorAll('[data-bf-slide]')] : [];
    if (slides.length < 2) return;
    const thumb = root.querySelector('[data-bf-thumb]');
    const indexEl = root.querySelector('[data-bf-index]');
    const prev = root.querySelector('[data-bf-prev]');
    const next = root.querySelector('[data-bf-next]');
    let current = -1;

    const centreOf = (el) => el.offsetLeft + el.offsetWidth / 2;
    const nearest = () => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      slides.forEach((s, i) => { if (Math.abs(centreOf(s) - mid) < Math.abs(centreOf(slides[best]) - mid)) best = i; });
      return best;
    };
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      const progress = max > 0 ? Math.min(1, Math.max(0, track.scrollLeft / max)) : 0;
      if (thumb) thumb.style.transform = `translateX(${progress * (slides.length - 1) * 100}%)`;
      const i = nearest();
      if (i === current) return;
      current = i;
      if (indexEl) indexEl.textContent = String(i + 1).padStart(2, '0');
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === slides.length - 1;
      slides.forEach((s, k) => s.classList.toggle('is-current', k === i));
    };
    const go = (i) => {
      const s = slides[Math.max(0, Math.min(slides.length - 1, i))];
      track.scrollTo({ left: centreOf(s) - track.clientWidth / 2, behavior: reduce.matches ? 'auto' : 'smooth' });
    };
    let frame = 0;
    track.addEventListener('scroll', () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    if (prev) prev.addEventListener('click', () => go(current - 1));
    if (next) next.addEventListener('click', () => go(current + 1));
    // Keyboard focus moving into an off-centre slide brings that slide to centre.
    slides.forEach((s, i) => s.addEventListener('focusin', () => { if (i !== current) go(i); }));
    update();
  });

  document.querySelectorAll('[data-blog-archive]').forEach((root) => {
    const rows = [...root.querySelectorAll('[data-archive-rows] > .blog-row')];
    const more = root.querySelector('[data-archive-more]');
    const PAGE = 8;
    if (!more || rows.length <= PAGE) return;
    let shown = PAGE;
    rows.forEach((row, i) => { row.hidden = i >= shown; });
    more.hidden = false;
    more.addEventListener('click', () => {
      const first = rows[shown];
      shown += PAGE;
      rows.forEach((row, i) => { row.hidden = i >= shown; });
      if (shown >= rows.length) more.hidden = true;
      const link = first && first.querySelector('a.blog-card__link');
      if (link) link.focus({ preventScroll: false });
    });
  });
})();
