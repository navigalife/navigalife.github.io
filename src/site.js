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

  const navScrim = document.querySelector('[data-nav-scrim]');
  const menuClose = document.querySelector('[data-menu-close]');

  const setMenu = (open) => {
    navigation?.classList.toggle('is-open', open);
    navScrim?.classList.toggle('is-open', open);
    menuToggle?.setAttribute('aria-expanded', String(open));
    root.classList.toggle('nav-open', open); // locks page scroll behind the drawer
  };
  const closeMenu = () => setMenu(false);

  menuToggle?.addEventListener('click', () => {
    setMenu(!navigation?.classList.contains('is-open'));
  });
  menuClose?.addEventListener('click', closeMenu);
  navScrim?.addEventListener('click', closeMenu);
  // Tapping a destination link closes the drawer; the brand (span) and close
  // control (button) aren't links, so only real nav links trigger this.
  navigation?.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
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

// MediVasc Assistant — the conversational lead form at bottom-right. Walks the visitor
// through name -> condition -> city one message at a time, then hands off to
// WhatsApp (or email) with the case prefilled. Server-rendered shell in
// template.js; this only runs when that shell (and its JSON config) is present.
(() => {
  const root = document.querySelector('[data-mvbot]');
  if (!root) return;
  const panel = root.querySelector('[data-mvbot-panel]');
  const toggle = root.querySelector('[data-mvbot-toggle]');
  const closeBtn = root.querySelector('[data-mvbot-close]');
  const log = root.querySelector('[data-mvbot-log]');
  const form = root.querySelector('[data-mvbot-form]');
  const input = root.querySelector('[data-mvbot-input]');
  const sendBtn = root.querySelector('[data-mvbot-send]');
  const quick = root.querySelector('[data-mvbot-quick]');
  const nudge = root.querySelector('[data-mvbot-nudge]');
  const configEl = root.querySelector('[data-mvbot-config]');
  if (!panel || !toggle || !log || !form || !input || !sendBtn || !quick) return;

  let config = {};
  try {
    config = JSON.parse(configEl.textContent);
  } catch (error) {
    config = {};
  }
  const conditions = Array.isArray(config.conditions) ? config.conditions.filter(Boolean) : [];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AVATAR = 'assets/brand/icon-192.png';
  const WA_ICON =
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></svg>';
  const SPARK =
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.7 5.5L19 9.2l-5.3 1.7L12 16l-1.7-5.1L5 9.2l5.3-1.7L12 2Z"/></svg>';

  const answers = { name: '', condition: '', city: '' };
  const steps = [
    { key: 'name', prompt: 'Who is the therapy for? Please share the <strong>patient’s name</strong>.', placeholder: 'Patient’s name', required: true },
    { key: 'condition', prompt: 'What is the <strong>condition</strong> we’re looking at? Pick one below or type your own.', placeholder: 'Condition', required: true, chips: true, rotate: true },
    { key: 'city', prompt: 'Lastly, which <strong>city</strong> are you in? It helps us plan home-based therapy.', placeholder: 'Your city', required: false, skip: true },
  ];
  let stepIndex = -1;
  let started = false;
  let busy = false;
  let rotateTimer = null;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reduceMotion ? Math.min(ms, 120) : ms));
  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  const botRow = (inner, extraClass = '') => {
    const row = document.createElement('div');
    row.className = `mvbot__msg mvbot__msg--bot${extraClass ? ` ${extraClass}` : ''}`;
    row.innerHTML = `<span class="mvbot__msg-avatar" aria-hidden="true"><img src="${AVATAR}" alt="" width="30" height="30"></span>${inner}`;
    log.appendChild(row);
    scrollDown();
    return row;
  };
  const addBot = (html) => botRow(`<div class="mvbot__bubble">${html}</div>`);
  const addUser = (text) => {
    const row = document.createElement('div');
    row.className = 'mvbot__msg mvbot__msg--user';
    const bubble = document.createElement('div');
    bubble.className = 'mvbot__bubble';
    bubble.textContent = text; // untrusted input — never innerHTML
    row.appendChild(bubble);
    log.appendChild(row);
    scrollDown();
  };
  const botSay = async (html, delay = 680) => {
    const typing = botRow('<div class="mvbot__bubble mvbot__typing"><span></span><span></span><span></span></div>', 'mvbot__msg--typing');
    typing.setAttribute('aria-hidden', 'true');
    await wait(delay);
    typing.remove();
    addBot(html);
  };

  const stopRotate = () => { if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; } };
  const startRotate = (step) => {
    stopRotate();
    if (!step.rotate || reduceMotion || !conditions.length) return;
    let i = 0;
    const cycle = () => {
      if (!(document.activeElement === input && input.value)) {
        input.placeholder = `e.g. ${conditions[i % conditions.length]}`;
        i += 1;
      }
      rotateTimer = setTimeout(cycle, 2200);
    };
    rotateTimer = setTimeout(cycle, 1600);
  };

  const updateSend = () => {
    const step = steps[stepIndex];
    sendBtn.disabled = input.value.trim() === '' && (!step || step.required);
  };

  const clearQuick = () => { quick.innerHTML = ''; quick.hidden = true; };
  const buildQuick = (step) => {
    quick.innerHTML = '';
    if (step.chips) {
      conditions.slice(0, 3).forEach((label) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'mvbot__chip';
        chip.textContent = label;
        chip.addEventListener('click', () => submitValue(label));
        quick.appendChild(chip);
      });
    }
    if (step.skip) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mvbot__chip mvbot__chip--ghost';
      chip.textContent = 'Skip';
      chip.addEventListener('click', () => submitValue('', true));
      quick.appendChild(chip);
    }
    quick.hidden = quick.children.length === 0;
  };

  const openComposer = (step) => {
    form.hidden = false;
    input.value = '';
    input.disabled = false;
    input.placeholder =
      step.key === 'condition' && conditions.length
        ? `e.g. ${conditions.slice(0, 3).join(', ')}…`
        : `${step.placeholder}…`;
    updateSend();
    buildQuick(step);
    startRotate(step);
    // The composer + quick-reply chips just claimed vertical space; re-pin the
    // log to the bottom so the question we just asked isn't left half-hidden.
    scrollDown();
    requestAnimationFrame(scrollDown);
    if (root.dataset.mvbotState === 'open') {
      requestAnimationFrame(() => input.focus());
    }
  };
  const closeComposer = () => {
    stopRotate();
    clearQuick();
    input.blur(); // dismiss the keyboard once we're done collecting input
    form.hidden = true;
  };

  const nudgeInput = () => {
    input.classList.remove('mvbot__input--shake');
    void input.offsetWidth;
    input.classList.add('mvbot__input--shake');
    input.focus();
  };

  const waHref = () => {
    const lines = [
      'Hello MediVasc, I would like to request a solution.',
      '',
      `Patient: ${answers.name}`,
      `Condition: ${answers.condition}`,
    ];
    if (answers.city) lines.push(`City: ${answers.city}`);
    lines.push('', 'Please advise on a possible protocol.');
    const text = encodeURIComponent(lines.join('\n'));
    if (config.wa) return `https://wa.me/${config.wa}?text=${text}`;
    if (config.email) {
      return `mailto:${config.email}?subject=${encodeURIComponent(`Solution request — ${answers.name}`)}&body=${text}`;
    }
    return '#contact';
  };

  const addSummary = () => {
    const rows = [
      ['Patient', answers.name],
      ['Condition', answers.condition],
    ];
    if (answers.city) rows.push(['City', answers.city]);
    const card = document.createElement('div');
    card.className = 'mvbot__card';
    card.innerHTML =
      `<div class="mvbot__card-title">${SPARK}Your request</div>` +
      `<dl class="mvbot__summary">${rows.map(() => '<div><dt></dt><dd></dd></div>').join('')}</dl>` +
      `<a class="mvbot__cta" href="${waHref()}" target="_blank" rel="noreferrer">${WA_ICON}${config.wa ? 'Request Solution' : 'Email your request'}</a>` +
      '<button type="button" class="mvbot__restart" data-mvbot-restart>Edit details</button>';
    card.querySelectorAll('dt').forEach((dt, i) => { dt.textContent = rows[i][0]; });
    card.querySelectorAll('dd').forEach((dd, i) => { dd.textContent = rows[i][1]; });
    log.appendChild(card);
    scrollDown();
    card.querySelector('[data-mvbot-restart]').addEventListener('click', restart);
  };

  const askStep = async (i) => {
    stepIndex = i;
    await botSay(steps[i].prompt, i === 0 ? 520 : 760);
    openComposer(steps[i]);
  };

  const finish = async () => {
    stepIndex = steps.length;
    closeComposer();
    await botSay('Perfect — here’s your request. Send it to us on WhatsApp and we’ll get back to you personally.', 820);
    addSummary();
    root.classList.add('mvbot--engaged');
  };

  async function submitValue(raw, isSkip = false) {
    if (busy) return;
    const step = steps[stepIndex];
    if (!step) return;
    const value = (raw != null ? raw : input.value).trim();
    if (!value && step.required) { nudgeInput(); return; }
    busy = true;
    stopRotate();
    clearQuick();
    if (!value && (isSkip || step.skip)) {
      answers[step.key] = '';
      addUser('Skip');
    } else {
      answers[step.key] = value;
      addUser(value);
    }
    input.value = '';
    updateSend();
    if (stepIndex < steps.length - 1) await askStep(stepIndex + 1);
    else await finish();
    busy = false;
  }

  async function restart() {
    stopRotate();
    answers.name = '';
    answers.condition = '';
    answers.city = '';
    stepIndex = -1;
    log.innerHTML = '';
    root.classList.remove('mvbot--engaged');
    await botSay('No problem — let’s update the details.', 420);
    await askStep(0);
  }

  const runIntro = async () => {
    await botSay('Namaste 🙏 I’m the <strong>MediVasc Assistant</strong>. A few quick taps and I’ll set up your request for a customized solution.', 620);
    await askStep(0);
  };

  const dismissNudge = (remember) => {
    root.classList.remove('mvbot--nudge');
    if (nudge) nudge.hidden = true;
    if (remember) { try { sessionStorage.setItem('mvbot-nudge', '1'); } catch (error) { /* ignore */ } }
  };

  // ── Mobile keyboard + scroll handling ──────────────────────────────────
  // On phones the panel is a bottom sheet. iOS keeps the layout viewport (and
  // dvh) full-height when the keyboard is up, so a fixed bottom:0 sheet gets
  // shoved behind the keyboard and its header/log scroll out of view. We track
  // visualViewport to lift the sheet above the keyboard and cap its height to
  // the visible area, and we lock the page behind it so scrolling the chat log
  // can't move the site underneath. Desktop (floating card) is untouched.
  const mqMobile = matchMedia('(max-width:560px)');
  const vv = window.visualViewport;
  const clearViewportVars = () => {
    root.style.removeProperty('--mvbot-kb');
    root.style.removeProperty('--mvbot-h');
    root.style.removeProperty('--mvbot-maxh');
  };
  const syncViewport = () => {
    if (!vv) return;
    if (root.dataset.mvbotState !== 'open' || !mqMobile.matches) {
      clearViewportVars();
      return;
    }
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (kb > 40) {
      root.style.setProperty('--mvbot-kb', `${kb}px`);
      root.style.setProperty('--mvbot-h', 'auto'); // hug content above the keyboard
      root.style.setProperty('--mvbot-maxh', `${Math.round(vv.height - 8)}px`);
      scrollDown();
    } else {
      clearViewportVars();
    }
  };
  if (vv) {
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
  }

  let scrollLockY = 0;
  let scrollLocked = false;
  const lockScroll = () => {
    if (scrollLocked || !mqMobile.matches) return;
    scrollLocked = true;
    scrollLockY = window.scrollY || window.pageYOffset || 0;
    const b = document.body;
    b.style.top = `-${scrollLockY}px`;
    b.style.position = 'fixed';
    b.style.left = '0';
    b.style.right = '0';
    b.style.width = '100%';
    document.documentElement.classList.add('mvbot-locked');
  };
  const unlockScroll = () => {
    if (!scrollLocked) return;
    scrollLocked = false;
    const b = document.body;
    b.style.position = '';
    b.style.top = '';
    b.style.left = '';
    b.style.right = '';
    b.style.width = '';
    document.documentElement.classList.remove('mvbot-locked');
    window.scrollTo(0, scrollLockY);
  };
  mqMobile.addEventListener?.('change', () => { if (!mqMobile.matches) unlockScroll(); syncViewport(); });

  const open = () => {
    root.dataset.mvbotState = 'open';
    toggle.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-hidden', 'false');
    dismissNudge(true);
    lockScroll();
    syncViewport();
    if (!started) {
      started = true;
      runIntro();
    } else if (!form.hidden) {
      requestAnimationFrame(() => input.focus());
    } else {
      requestAnimationFrame(() => closeBtn.focus());
    }
  };
  const close = () => {
    root.dataset.mvbotState = 'closed';
    toggle.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    stopRotate();
    unlockScroll();
    syncViewport();
    toggle.focus();
  };

  toggle.addEventListener('click', () => {
    if (root.dataset.mvbotState === 'open') close();
    else open();
  });
  closeBtn.addEventListener('click', close);
  form.addEventListener('submit', (event) => { event.preventDefault(); submitValue(); });
  input.addEventListener('input', updateSend);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.dataset.mvbotState === 'open') close();
  });

  if (nudge) {
    const nudgeX = nudge.querySelector('[data-mvbot-nudge-x]');
    nudgeX?.addEventListener('click', (event) => { event.stopPropagation(); dismissNudge(true); });
    nudge.addEventListener('click', () => { open(); });
    let seen = false;
    try { seen = sessionStorage.getItem('mvbot-nudge') === '1'; } catch (error) { seen = false; }
    if (!seen) {
      setTimeout(() => {
        if (root.dataset.mvbotState !== 'open') {
          nudge.hidden = false;
          root.classList.add('mvbot--nudge');
          setTimeout(() => { if (root.dataset.mvbotState !== 'open') dismissNudge(false); }, 9000);
        }
      }, 2800);
    }
  }

  requestAnimationFrame(() => root.classList.add('mvbot--ready'));
})();

/* Content-copy friction (owner directive): block image drag + right-click /
   long-press "save image". Deterrent only — text selection is handled in CSS.
   Scoped to images so links, contact details, and form fields stay usable. */
(() => {
  const overImage = (event) =>
    event.target instanceof Element && event.target.closest('img');
  document.addEventListener('dragstart', (event) => {
    if (overImage(event)) event.preventDefault();
  });
  document.addEventListener('contextmenu', (event) => {
    if (overImage(event)) event.preventDefault();
  });
})();
