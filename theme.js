/* OAAB — shared light/dark theme helper.
   The home page handles its own theme inline (it has a transparent, scroll-aware
   nav); the other pages (FAQ, Releases, Library) use this tiny helper so the
   choice persists across the whole site under one localStorage key. */
(function () {
  var KEY = 'oaab_theme_v1';
  function read() {
    try { var t = localStorage.getItem(KEY); return (t === 'light' || t === 'dark') ? t : 'dark'; }
    catch (e) { return 'dark'; }
  }
  function apply(theme) {
    var light = theme === 'light';
    var r = document.querySelector('[data-root]');
    if (r) r.classList.toggle('theme-light', light);
    if (document.body) document.body.style.background = light ? '#f4ede0' : '#100d0a';
  }
  function set(theme) { try { localStorage.setItem(KEY, theme); } catch (e) {} }
  window.OAAB_THEME = { KEY: KEY, read: read, apply: apply, set: set };
})();
