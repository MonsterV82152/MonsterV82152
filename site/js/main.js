/* =====================================================================
   main.js — typewriter, scroll reveal (with stagger), smooth-scroll nav,
             custom cursor halo, scroll-progress bar, subtle hero parallax,
             footer year
   ---------------------------------------------------------------------
   Classic deferred script (no imports). Coordinates small UI behavior.
   All motion is prefers-reduced-motion aware.
   ===================================================================== */

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================================================================
     1) TYPEWRITER — cycles role lines with a blinking caret
     ================================================================ */
  function initTypewriter() {
    const el = document.getElementById('typewriter');
    if (!el) return;

    const roles = [
      'QML — Quantum Machine Learning @ Synthica',
      'FRC Team 610 — Robot Technician (2025–2026)',
      'V5RC 16610V — Lead Programmer (2023–2026)',
      'Neural Network Developer',
      'Co-Founder, Isonome',
    ];

    let line = 0;
    let char = 0;
    let deleting = false;

    const TYPE_SPEED = 42;
    const DEL_AFTER = 1900;   // pause after full line
    const DEL_BETWEEN = 420;  // pause between lines

    function tick() {
      const current = roles[line];

      if (!deleting) {
        char++;
        el.textContent = current.slice(0, char);
        if (char >= current.length) {
          deleting = true;
          setTimeout(tick, DEL_AFTER);
          return;
        }
        setTimeout(tick, TYPE_SPEED + Math.random() * 40);
      } else {
        char--;
        el.textContent = current.slice(0, char);
        if (char <= 0) {
          deleting = false;
          line = (line + 1) % roles.length;
          setTimeout(tick, DEL_BETWEEN);
          return;
        }
        setTimeout(tick, TYPE_SPEED / 1.8);
      }
    }

    if (reduceMotion) {
      // show the first line statically, no cycling
      el.textContent = roles[0];
    } else {
      tick();
    }
  }

  /* ================================================================
     2) SCROLL REVEAL — IntersectionObserver + sibling stagger
        -----------------------------------------------------------------
        - Repeating groups (.roles / .projects / .stack) hand their reveal
          trigger down to their individual items so the items cascade.
        - Each .reveal gets a stagger offset (by sibling index, capped)
          applied by delaying the `.in` class — NOT via transition-delay —
          so element hover transitions stay snappy.
     ================================================================ */
  function initReveal() {
    // Move the reveal trigger from repeating-group containers onto their
    // individual items so each item cascades in on its own.
    const cascadeGroups = [
      ['.roles',    '.roles > li'],
      ['.projects', '.projects > .proj'],
      ['.stack',    '.stack > .stack__group'],
    ];
    cascadeGroups.forEach(function (pair) {
      const container = document.querySelector(pair[0]);
      if (!container) return;
      container.classList.remove('reveal');
      document.querySelectorAll(pair[1]).forEach(function (item) {
        item.classList.add('reveal');
      });
    });

    const reveals = Array.prototype.slice.call(
      document.querySelectorAll('.reveal')
    );

    // Compute a per-element stagger (index among .reveal siblings, capped
    // ~600ms) and stash it for the observer callback.
    reveals.forEach(function (el) {
      const siblings = Array.prototype.filter.call(
        el.parentElement.children,
        function (c) { return c.classList.contains('reveal'); }
      );
      el._revealDelay = Math.min((siblings.indexOf(el) % 10) * 70, 600);
    });

    if (reduceMotion || !('IntersectionObserver' in window)) {
      reveals.forEach(function (e) { e.classList.add('in'); });
      return;
    }

    const io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          io.unobserve(el);
          const delay = el._revealDelay || 0;
          window.setTimeout(function () { el.classList.add('in'); }, delay);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    reveals.forEach(function (e) { io.observe(e); });
  }

  /* ================================================================
     3) SMOOTH-SCROLL NAV — offset for fixed top bar
     ================================================================ */
  function initSmoothScroll() {
    const bar = document.querySelector('.topbar');
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        const id = a.getAttribute('href');
        if (!id || id === '#') return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        const offset = (bar ? bar.offsetHeight : 0) + 8;
        const top =
          target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    });
  }

  /* ================================================================
     4) CUSTOM CURSOR HALO — subtle ring that follows + grows on links
     ================================================================ */
  function initCursor() {
    const halo = document.getElementById('cursor-halo');
    if (!halo || reduceMotion || matchMedia('(hover: none)').matches) return;

    let visible = false;
    window.addEventListener('pointermove', function (e) {
      if (!visible) {
        halo.classList.add('on');
        visible = true;
      }
      halo.style.left = e.clientX + 'px';
      halo.style.top = e.clientY + 'px';
    });

    document.addEventListener('pointerleave', function () {
      halo.classList.remove('on');
      visible = false;
    });

    // grow over interactive elements
    document.querySelectorAll('a, button, .chip, .chips li, .proj, .roles li')
      .forEach(function (el) {
        el.addEventListener('pointerenter', function () { halo.classList.add('big'); });
        el.addEventListener('pointerleave', function () { halo.classList.remove('big'); });
      });
  }

  /* ================================================================
     5) SCROLL-PROGRESS BAR — thin sage bar tracks page scroll
        (RAF-throttled; hidden under reduced motion via CSS)
     ================================================================ */
  function initScrollProgress() {
    const bar = document.getElementById('scroll-progress');
    if (!bar) return;
    if (reduceMotion) { bar.style.display = 'none'; return; }

    let ticking = false;
    function update() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
      bar.style.width = (p * 100) + '%';
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ================================================================
     6) SUBTLE HERO PARALLAX — content drifts gently as you scroll away
        (very small factor; skipped under reduced motion)
     ================================================================ */
  function initHeroParallax() {
    if (reduceMotion) return;
    const heroInner = document.querySelector('.hero__inner');
    if (!heroInner) return;

    let ticking = false;
    function update() {
      const y = window.scrollY;
      // only nudge while the hero is on screen
      if (y < window.innerHeight) {
        heroInner.style.transform = 'translateY(' + (y * -0.12) + 'px)';
      }
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  }

  /* ================================================================
     7b) SECTION PARALLAX — content drifts gently against the fixed
         wireframe as each .section scrolls through the viewport, plus
         a faint horizontal nudge on section labels to lead the eye.
         (RAF-throttled, on-screen only, skipped under reduced motion.)
         Parent (.section) transform composes with child (.reveal)
         transforms, so the entrance reveals are not disturbed.
     ================================================================ */
  function initSectionParallax() {
    if (reduceMotion) return;
    const sections = Array.prototype.slice.call(
      document.querySelectorAll('.section')
    );
    if (!sections.length) return;

    const labels = sections
      .map(function (s) { return s.querySelector('.section__label'); })
      .filter(Boolean);

    sections.forEach(function (s) { s.style.willChange = 'transform'; });
    labels.forEach(function (l) { l.style.willChange = 'transform'; });

    let ticking = false;

    function update() {
      const vh = window.innerHeight;
      const center = vh / 2;

      sections.forEach(function (s) {
        const r = s.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;     // only while on-screen
        const mid = r.top + r.height / 2;
        const distance = mid - center;              // px from viewport center
        // gentle vertical drift, capped so sections never overlap
        const y = Math.max(-24, Math.min(24, distance * -0.035));
        s.style.transform = 'translateY(' + y.toFixed(2) + 'px)';
      });

      labels.forEach(function (l) {
        const r = l.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        const mid = r.top + r.height / 2;
        const distance = mid - center;
        // faint horizontal drift to lead the eye (vertical-only metric,
        // and the nudge is horizontal, so no feedback accumulation)
        const x = Math.max(-8, Math.min(8, distance * 0.012));
        l.style.transform = 'translateX(' + x.toFixed(2) + 'px)';
      });

      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ================================================================
     7) FOOTER YEAR
     ================================================================ */
  function initYear() {
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
  }

  /* --- boot (defer → DOM already parsed) --- */
  initTypewriter();
  initReveal();
  initSmoothScroll();
  initCursor();
  initScrollProgress();
  initHeroParallax();
  initSectionParallax();
  initYear();
})();
