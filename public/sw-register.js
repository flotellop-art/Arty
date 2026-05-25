// SW registration. Externalisé car la CSP (script-src 'self') refuse l'inline.
// Skip SW registration on Capacitor native — the SW persists across APK
// updates and serves stale JS/CSS, forcing users to clear app data.
// See BUG 45 in CLAUDE.md.
(function () {
  var isCapacitorNative =
    (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() === true) ||
    (location.protocol === 'https:' && location.hostname === 'localhost');
  if ('serviceWorker' in navigator && !isCapacitorNative) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
