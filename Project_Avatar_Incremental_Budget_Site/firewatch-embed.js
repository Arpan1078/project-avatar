/*
  Firewatch embed mode.
  When this calculator is shown inside the Firewatch dashboard (in an iframe),
  mark the page with class "fw-embed" so firewatch-embed.css restyles it to
  match the dashboard. Opened on its own, the calculator looks exactly as before.
  This file contains no calculator logic.
*/
(function () {
  var embedded;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
  if (!embedded) return;
  document.documentElement.classList.add('fw-embed');
  // The dashboard's fonts (Barlow). Loaded only in embed mode.
  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600&display=swap';
  document.head.appendChild(font);
})();
