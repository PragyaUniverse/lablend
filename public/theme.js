// Applied before first paint so there is no light/dark flash.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('lablend-theme'); } catch (e) { /* storage blocked */ }
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
