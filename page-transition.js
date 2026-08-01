/* ============================================================
   REVacity — cinematic cosmic page transition
   ------------------------------------------------------------
   Reusable module, loaded identically from index.html and
   about.html (after GSAP has loaded). Pairs with page-transition.css.

   THE IDEA
   Leaving a page: the real content fades out in layered groups
   (nav -> headings -> body text -> media/buttons -> everything else),
   a dedicated overlay canvas reveals a breathing field of stars in the
   brand's gradient (purple -> magenta -> gold, sampled from the logo),
   a handful of particles flash brighter for one last moment — then the
   browser navigates. No gathering/convergence and no center glow: the
   field stays a scattered, ambient starfield throughout, it never
   clusters into a blob at the middle of the screen. Arriving on a
   page: the same overlay is already covering the screen (so there's
   no flash of raw content) with that same ambient field already
   breathing, the destination's content reveals in layered order
   (background -> sections -> headings -> small UI), and the stars
   linger for a moment before the whole overlay clears.

   SAFETY (carried over from earlier iterations of this transition,
   learned the hard way — see comments inline for specifics):
   - Never transform document.body/documentElement, and never
     transform any real page content here — only opacity. Transforming
     an ancestor of a position:fixed/pinned element creates a new
     containing block and once broke GSAP ScrollTrigger's pin/scroll
     math site-wide.
   - Navigation on exit, and clearing the scroll-lock on entrance, are
     each driven by a guaranteed setTimeout — never solely by a GSAP
     onComplete callback. GSAP is wrapped in try/catch and treated as
     best-effort visual polish throughout; a stalled tween can never
     strand a click or leave a page permanently hidden/scroll-locked.
   - This overlay uses its own dedicated <canvas>, not the site's
     existing per-page Three.js starfield (canvas#gl in .stage) — so
     it can never conflict with each page's own scene/animation loop.
   ============================================================ */
(function () {
  'use strict';

  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var isMobile = window.innerWidth < 700;
  var PARTICLE_COUNT = isMobile ? 70 : 190;

  // Timing (seconds unless noted) — kept inside the brief the user asked
  // for: content fade ~0.6-1.0s, star activation ~0.3-0.6s, destination
  // reveal ~0.8-1.2s, total transition ~2-3s.
  var T = {
    freeze: 0.12,
    fadeStagger: [0.12, 0.18, 0.26, 0.32, 0.40], // tier start offsets inside the timeline
    fadeDur: 0.6,
    starActivate: 0.5,
    lastLight: 0.20,
    hold: 0.5,        // beat of plain ambient starfield before navigating
    revealStagger: [0, 0.16, 0.32, 0.46, 0.52],
    revealDur: 0.6,
    linger: 0.7
  };

  // All stars are plain white.
  var STAR_RGB = '207,207,208'; // #cfcfd0

  var state = {
    transitioning: false,
    mode: 'idle',        // idle | ambient | linger
    modeStart: 0,
    heroFlash: 0,
    particles: null,
    raf: 0,
    ctx: null,
    canvas: null,
    w: 0, h: 0, dpr: 1
  };

  /* ---------------- overlay ---------------- */

  function ensureOverlay() {
    var overlay = document.getElementById('page-transition');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'page-transition';
    overlay.setAttribute('aria-hidden', 'true');
    var canvas = document.createElement('canvas');
    canvas.id = 'transition-canvas';
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);
    return overlay;
  }

  function setupCanvas(canvas) {
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    resizeCanvas();
  }

  function resizeCanvas() {
    if (!state.canvas) return;
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    state.canvas.width = Math.round(state.w * state.dpr);
    state.canvas.height = Math.round(state.h * state.dpr);
    state.canvas.style.width = state.w + 'px';
    state.canvas.style.height = state.h + 'px';
    if (state.ctx) state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }
  window.addEventListener('resize', function () {
    if (state.mode !== 'idle') resizeCanvas();
  });

  /* ---------------- particle field ----------------
     Each particle breathes on its own independent clock (random phase
     + speed) so the field never blinks in unison, and gently drifts
     around its own scattered "home" position — it never travels
     toward a shared point. Colors are sampled per-particle from the
     brand gradient (GRADIENT_STOPS) rather than plain white. */

  function createParticles(w, h, count) {
    var list = [];
    for (var i = 0; i < count; i++) {
      var ox = Math.random() * w;
      var oy = Math.random() * h;
      var p = {
        ox: ox, oy: oy,
        x: ox, y: oy,
        r: 1.3 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.6,
        driftPhase: Math.random() * Math.PI * 2,
        driftSpeed: 0.05 + Math.random() * 0.12,
        driftAmp: 6 + Math.random() * 14,
        floatPhase: Math.random() * Math.PI * 2,
        floatSpeed: 0.06 + Math.random() * 0.1,
        floatAmp: 14 + Math.random() * 26,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.04 + Math.random() * 0.08,
        swayAmp: 5 + Math.random() * 10,
        rgb: STAR_RGB,
        hero: Math.random() < 0.08 // small subset used for the "last light" flash
      };
      list.push(p);
    }
    return list;
  }

  function stepAndDraw(elapsed, dtProgress) {
    var ctx = state.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, state.w, state.h);
    var particles = state.particles;
    if (!particles) return;

    var mode = state.mode;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      // gentle parallax drift around each star's own home position —
      // scattered throughout, never traveling toward a shared point —
      // plus a slower, larger floating bob (mostly vertical, with a
      // little horizontal sway) layered on top, so the whole field
      // reads as gently floating rather than just jittering in place.
      var floatY = Math.sin(elapsed * p.floatSpeed + p.floatPhase) * p.floatAmp;
      var swayX = Math.sin(elapsed * p.swaySpeed + p.swayPhase) * p.swayAmp;
      p.x = p.ox + Math.sin(elapsed * p.driftSpeed + p.driftPhase) * p.driftAmp * 0.5 + swayX;
      p.y = p.oy + Math.cos(elapsed * p.driftSpeed * 0.8 + p.driftPhase) * p.driftAmp * 0.5 + floatY;

      // breathing brightness — peakier than a plain sine so it reads as
      // "mostly dim, brief bright flare" rather than a smooth pulse.
      var s = Math.sin(elapsed * p.speed + p.phase);
      var breathe = 0.25 + 0.75 * Math.pow(Math.max(0, s), 3);
      if (state.heroFlash && p.hero) breathe = Math.min(1, breathe + 0.6);

      var alpha = breathe;
      if (mode === 'linger') alpha *= Math.max(0, 1 - dtProgress);

      var r = p.r * (0.7 + breathe * 0.6);

      // Small soft-edged dot — just enough falloff to avoid a hard
      // rim, without turning into a big diffuse blob.
      var glowR = r * 1.8;
      var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      grad.addColorStop(0,   'rgba(' + p.rgb + ',' + alpha.toFixed(3) + ')');
      grad.addColorStop(0.6, 'rgba(' + p.rgb + ',' + (alpha * 0.7).toFixed(3) + ')');
      grad.addColorStop(1,   'rgba(' + p.rgb + ',0)');
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  var loopStart = 0;
  function loop(now) {
    if (state.mode === 'idle') { state.raf = 0; return; }
    var elapsed = (now - loopStart) / 1000;
    var modeElapsed = (now - state.modeStart) / 1000;
    var modeDur = state.mode === 'linger' ? T.linger : 1; // ambient has no fixed duration; progress unused
    stepAndDraw(elapsed, modeElapsed / modeDur);
    state.raf = requestAnimationFrame(loop);
  }
  function startLoop() {
    if (state.raf) return;
    loopStart = performance.now();
    state.raf = requestAnimationFrame(loop);
  }
  function stopLoop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.mode = 'idle';
    if (state.ctx) state.ctx.clearRect(0, 0, state.w, state.h);
  }

  /* ---------------- content layers ----------------
     Generic, page-shape-agnostic grouping so this works on any page
     without per-page tuning: specific semantic tiers first (nav,
     headings, body text, media/buttons), then every remaining direct
     child of <body> as a catch-all so nothing is left behind. */

  function collectLayers() {
    var used = [];
    function isUsed(el) { return used.indexOf(el) !== -1; }
    function pick(sel) {
      var out = [];
      var found = document.querySelectorAll(sel);
      for (var i = 0; i < found.length; i++) {
        var el = found[i];
        if (isUsed(el)) continue;
        if (el.id === 'page-transition' || (el.closest && el.closest('#page-transition'))) continue;
        used.push(el);
        out.push(el);
      }
      return out;
    }
    var tierNav = pick('header, nav, .main-header, .mobile-slide-menu');
    var tierHeading = pick(
      'h1, h2, h3, .eyebrow, .about-hero-title, .era-name, .manifesto-title, ' +
      '.methodology-heading, .stackless-title, .veracity-title, .three-tier-heading, ' +
      '.outro-heading, .hf-title'
    );
    var tierBody = pick('p, li, .hf-body, .card-description, .footer-bar-text, .origin-label, .era-dates');
    var tierMedia = pick(
      'img, button, a.btn-warrant, a.btn-reward, .btn-warrant, .btn-reward, .card, ' +
      '.landscape-card, a.corner-label, canvas:not(#gl):not(#transition-canvas)'
    );
    var tierRest = [];
    var kids = document.body.children;
    for (var j = 0; j < kids.length; j++) {
      var k = kids[j];
      if (k.id === 'page-transition') continue;
      if (isUsed(k)) continue;
      used.push(k);
      tierRest.push(k);
    }
    return { tierNav: tierNav, tierHeading: tierHeading, tierBody: tierBody, tierMedia: tierMedia, tierRest: tierRest };
  }

  function hasGsap() { return typeof window.gsap !== 'undefined'; }

  /* ---------------- exit ---------------- */

  function lockScroll() {
    document.documentElement.classList.add('loader-active');
    document.body.classList.add('loader-active');
  }
  function unlockScroll() {
    document.documentElement.classList.remove('loader-active');
    document.body.classList.remove('loader-active');
  }

  function playExit(url) {
    if (state.transitioning) return;
    state.transitioning = true;
    lockScroll();

    var overlay = ensureOverlay();
    overlay.classList.add('pt-block');
    var canvas = overlay.querySelector('#transition-canvas');
    setupCanvas(canvas);
    state.particles = createParticles(state.w, state.h, PARTICLE_COUNT);
    state.mode = 'ambient';
    state.modeStart = performance.now();
    startLoop();

    var went = false;
    function go() {
      if (went) return;
      went = true;
      try { sessionStorage.setItem('pt-transitioning', '1'); } catch (err) { /* ignore */ }
      window.location.href = url;
    }

    if (reducedMotion || !hasGsap()) {
      // Simplified path: quick plain fade, no particle choreography.
      overlay.classList.add('pt-active');
      var quick = 0.35;
      try {
        gsap.to(overlay, { opacity: 1, duration: quick, ease: 'power1.out' });
      } catch (err) { overlay.style.transition = 'opacity ' + quick + 's ease'; overlay.style.opacity = '1'; }
      setTimeout(go, Math.round(quick * 1000) + 120);
      return;
    }

    var layers = collectLayers();
    var navDelayMs = Math.round((T.fadeStagger[4] + T.fadeDur * 0.5 + T.starActivate + T.lastLight + T.hold) * 1000);
    setTimeout(go, navDelayMs + 260); // guaranteed fallback, independent of GSAP

    try {
      var tl = gsap.timeline();
      tl.to({}, { duration: T.freeze }); // brief freeze before anything moves

      tl.to(layers.tierNav,     { opacity: 0, duration: T.fadeDur, ease: 'power2.out', stagger: 0.02 }, T.fadeStagger[0]);
      tl.to(layers.tierHeading, { opacity: 0, duration: T.fadeDur, ease: 'power2.out', stagger: 0.03 }, T.fadeStagger[1]);
      tl.to(layers.tierBody,    { opacity: 0, duration: T.fadeDur, ease: 'power2.out', stagger: 0.015 }, T.fadeStagger[2]);
      tl.to(layers.tierMedia,   { opacity: 0, duration: T.fadeDur, ease: 'power2.out', stagger: 0.02 }, T.fadeStagger[3]);
      tl.to(layers.tierRest,    { opacity: 0, duration: T.fadeDur, ease: 'power2.out', stagger: 0.02 }, T.fadeStagger[4]);

      var starAt = T.fadeStagger[4] + T.fadeDur * 0.35;
      overlay.classList.add('pt-active');
      tl.to(overlay, { opacity: 1, duration: T.starActivate, ease: 'power1.out' }, starAt);

      // last light: a handful of particles flash brighter right as the
      // old page fully disappears, then the ambient field just holds
      // (scattered, breathing, never gathering) for a short beat before
      // navigating.
      var flashAt = starAt + T.starActivate * 0.7;
      tl.call(function () { state.heroFlash = 1; }, null, flashAt);
      tl.call(function () { state.heroFlash = 0; }, null, flashAt + T.lastLight);
    } catch (err) {
      /* best-effort visuals only — the setTimeout above still navigates */
    }
  }

  /* ---------------- entrance ---------------- */

  function playEntrance() {
    // index.html has its own older, unrelated anti-FOUC mechanism
    // (body.is-loading, removed automatically ~3s after load) used for
    // its normal first-visit hero reveal. That rule uses !important, so
    // if left in place it would block *this* reveal from showing at all
    // until that 3s timer fires. It's purely class-driven, so it's safe
    // to clear directly here (a no-op on pages that don't use it, and a
    // harmless no-op when that page's own timer fires later too).
    document.body.classList.remove('is-loading');

    var overlay = ensureOverlay();
    overlay.classList.add('pt-active', 'pt-block');
    overlay.style.opacity = '1';
    var canvas = overlay.querySelector('#transition-canvas');
    setupCanvas(canvas);

    lockScroll();

    var layers = collectLayers();
    var allEls = [].concat(layers.tierRest, layers.tierMedia, layers.tierBody, layers.tierHeading, layers.tierNav);

    function finish() {
      document.documentElement.classList.remove('pt-incoming');
      overlay.classList.remove('pt-block');
      unlockScroll();
    }

    if (reducedMotion || !hasGsap()) {
      document.documentElement.classList.remove('pt-incoming');
      if (hasGsap()) {
        try { gsap.to(allEls, { opacity: 1, duration: 0.35, ease: 'power1.out' }); }
        catch (err) { setOpacity(allEls, 1); }
      } else {
        setOpacity(allEls, 1);
      }
      try { gsap && gsap.to(overlay, { opacity: 0, duration: 0.35, delay: 0.1, onComplete: finish }); }
      catch (err) { finish(); }
      setTimeout(finish, 700); // guaranteed unlock regardless of GSAP
      return;
    }

    state.particles = createParticles(state.w, state.h, PARTICLE_COUNT);
    state.mode = 'ambient';
    state.modeStart = performance.now();
    startLoop();

    // Guaranteed unlock/finish — never solely dependent on the GSAP
    // timeline below completing.
    var finishMs = Math.round((0.1 + T.revealStagger[4] + T.revealDur + 0.15) * 1000);
    setTimeout(finish, finishMs + 300);

    try {
      document.documentElement.classList.remove('pt-incoming');
      gsap.set(allEls, { opacity: 0 });

      var tl = gsap.timeline({ delay: 0.1 });
      tl.to(layers.tierRest,    { opacity: 1, duration: T.revealDur, ease: 'power2.out', stagger: 0.02 }, T.revealStagger[0]);
      tl.to(layers.tierBody,    { opacity: 1, duration: T.revealDur, ease: 'power2.out', stagger: 0.015 }, T.revealStagger[1]);
      tl.to(layers.tierHeading, { opacity: 1, duration: T.revealDur, ease: 'power2.out', stagger: 0.03 }, T.revealStagger[2]);
      tl.to(layers.tierNav,     { opacity: 1, duration: T.revealDur, ease: 'power2.out', stagger: 0.02 }, T.revealStagger[3]);
      tl.to(layers.tierMedia,   { opacity: 1, duration: T.revealDur, ease: 'power2.out', stagger: 0.02 }, T.revealStagger[4]);

      tl.to(overlay, { opacity: 0, duration: 0.5, ease: 'power1.out' }, T.revealStagger[4] + T.revealDur * 0.4);

      // release interaction as soon as the page is visually usable —
      // the lingering particles keep animating on top, non-blocking
      tl.call(function () {
        overlay.classList.remove('pt-block');
        unlockScroll();
        state.mode = 'linger';
        state.modeStart = performance.now();
      }, null, T.revealStagger[4] + T.revealDur * 0.4);

      tl.call(function () {
        overlay.classList.remove('pt-active');
        stopLoop();
      }, null, T.revealStagger[4] + T.revealDur * 0.4 + T.linger);
    } catch (err) {
      /* best-effort visuals only — the setTimeout above still finishes */
    }
  }

  function setOpacity(els, v) {
    for (var i = 0; i < els.length; i++) els[i].style.opacity = String(v);
  }

  /* ---------------- click interception ---------------- */

  document.addEventListener('click', function (e) {
    if (state.transitioning) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;
    if (a.target && a.target !== '' && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;

    var url;
    try { url = new URL(href, window.location.href); } catch (err) { return; }
    if (url.origin !== window.location.origin) return;
    if (url.href === window.location.href) return;

    e.preventDefault();
    playExit(url.href);
  });

  /* ---------------- boot ---------------- */

  function boot() {
    var incoming = false;
    try {
      incoming = sessionStorage.getItem('pt-transitioning') === '1';
      sessionStorage.removeItem('pt-transitioning');
    } catch (err) { /* sessionStorage unavailable — just skip the entrance sequence */ }

    if (incoming) {
      playEntrance();
    } else {
      // Not arriving via the transition (direct load, refresh, external
      // link) — make sure nothing is stuck hidden from the anti-FOUC CSS.
      document.documentElement.classList.remove('pt-incoming');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
