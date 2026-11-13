// The Journal post reader (W2b). Progressive only — the article reads fully with
// JS off. Concatenated into blog.<hash>.js with landing.js; no-ops on pages
// without a .post. Reading progress, guide TOC highlight, copy link with a toast,
// YouTube facade → youtube-nocookie iframe, and fading the sticky TOC/rail while a
// wide or full-bleed block passes underneath them.
(function () {
  'use strict';
  var post = document.querySelector('article.post');
  if (!post) return;
  var body = post.querySelector('.post-body');
  var bar = document.querySelector('.post-progress__bar');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- table of contents ---------------------------------------------------
  var tocLinks = Array.prototype.slice.call(post.querySelectorAll('.post-toc a[href^="#"], .post-toc-m a[href^="#"]'));
  var targets = [];
  var seen = {};
  tocLinks.forEach(function (link) {
    var id = decodeURIComponent(link.getAttribute('href').slice(1));
    if (seen[id]) return;
    var el = document.getElementById(id);
    if (el) { seen[id] = true; targets.push({ id: id, el: el }); }
  });
  var activeId = null;
  var setActive = function (id) {
    if (id === activeId) return;
    activeId = id;
    tocLinks.forEach(function (link) {
      if (link.getAttribute('href') === '#' + id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  };
  var mobileToc = post.querySelector('.post-toc-m');
  if (mobileToc) {
    mobileToc.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('a')) mobileToc.open = false;
    });
  }

  // ---- sticky rails vs wide/full blocks -------------------------------------
  var stickies = Array.prototype.slice.call(post.querySelectorAll('.post-toc__inner, .post-rail__inner'));
  var breakouts = body ? Array.prototype.slice.call(body.querySelectorAll(':scope > .b-wide, :scope > .b-full')) : [];
  var overlaps = function (a, b) {
    return a.top < b.bottom - 8 && a.bottom > b.top + 8 && a.left < b.right && a.right > b.left;
  };

  // ---- one scroll pass per frame ------------------------------------------------
  var ticking = false;
  var update = function () {
    ticking = false;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (bar && body) {
      var r = body.getBoundingClientRect();
      var total = r.height - vh * 0.6;
      var p = total > 0 ? (vh * 0.4 - r.top) / total : 1;
      bar.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
    }
    if (targets.length) {
      var line = vh * 0.32;
      var current = targets[0].id;
      for (var i = 0; i < targets.length; i += 1) {
        if (targets[i].el.getBoundingClientRect().top - line <= 0) current = targets[i].id;
        else break;
      }
      if (targets[0].el.getBoundingClientRect().top - line > 0) current = null;
      setActive(current);
    }
    if (stickies.length && breakouts.length) {
      var rects = breakouts.map(function (el) { return el.getBoundingClientRect(); });
      stickies.forEach(function (el) {
        var hit = false;
        if (getComputedStyle(el).position === 'sticky') {
          var s = el.getBoundingClientRect();
          hit = rects.some(function (b) { return overlaps(s, b); });
        }
        el.classList.toggle('is-occluded', hit);
      });
    }
  };
  var request = function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  request();

  // ---- copy link + toast ---------------------------------------------------------
  var toast;
  var toastTimer;
  var say = function (text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'post-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove('is-on'); }, reduced ? 2600 : 2200);
  };
  var fallbackCopy = function (text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  };
  post.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-copy-url]');
    if (!button) return;
    var url = button.getAttribute('data-copy-url') || window.location.href.split('#')[0];
    var done = function () { say('Link copied'); };
    var fail = function () { say(fallbackCopy(url) ? 'Link copied' : 'Could not copy the link'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, fail);
    else fail();
  });

  // ---- YouTube facade -> privacy-enhanced iframe on click ----------------------
  post.addEventListener('click', function (event) {
    var facade = event.target.closest && event.target.closest('a.yt[data-yt]');
    if (!facade) return;
    var id = facade.getAttribute('data-yt') || '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    event.preventDefault();
    var frameBox = document.createElement('div');
    frameBox.className = facade.className + ' is-playing';
    var rect = facade.getBoundingClientRect();
    if (rect.height) frameBox.style.minHeight = Math.round(rect.height) + 'px';
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1&playsinline=1';
    iframe.title = facade.getAttribute('aria-label') || facade.getAttribute('title') || 'YouTube video';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frameBox.appendChild(iframe);
    facade.parentNode.replaceChild(frameBox, facade);
    iframe.focus();
  });
})();
