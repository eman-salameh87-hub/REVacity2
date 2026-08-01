/* ============================================================
   REVacity shared page transition — continuous starfield
   ------------------------------------------------------------
   Pairs with transitions.css. There is no overlay markup for this
   version — it works purely by toggling classes on <body>
   (is-loading / pt-exit), which transitions.css turns into opacity
   changes on real content. .stage (canvas#gl + .vignette) — each
   page's own real starfield — is never touched, so it reads as
   continuous straight through the navigation.

   Exit: adds .pt-exit to <body>, which fades out all real content
   except .stage (see transitions.css), then navigates. Navigation
   is driven by a plain setTimeout — never a GSAP/transitionend
   callback — so a stalled animation or missing library can never
   strand a click. An earlier version of this transition system
   depended entirely on a GSAP onComplete callback for navigation,
   and a failure there left the page permanently stuck; that's why
   this file doesn't even require GSAP to be present at all.

   Entrance: each page already has its own "ready" hook that used to
   dissolve the old #page-transition veil — revealPage() on
   index.html, playHeaderIn() on about.html. Those now just remove
   'is-loading' from <body> instead (see the CSS), which is enough
   to fade the real content in. No shared reveal function is needed
   here; each page keeps driving its own timing exactly as before.

   Usage on each page: include this script once, after <body> exists
   (or anywhere — it only attaches a document-level click listener).
   It self-attaches to every same-origin, same-tab link: no modifier-
   clicks, no #hash/mailto/tel, no target=_blank, no download links,
   no same-URL links.
   ============================================================ */
(function () {
  var transitioning = false;

  document.addEventListener('click', function (e) {
    if (transitioning) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href]');
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
    transitioning = true;

    document.documentElement.classList.add('loader-active');
    document.body.classList.add('loader-active');
    document.body.classList.add('pt-exit');

    // Guaranteed navigation — matches the .pt-exit fade duration in
    // transitions.css (0.45s) plus a small buffer.
    setTimeout(function () {
      window.location.href = url.href;
    }, 480);
  });
})();
