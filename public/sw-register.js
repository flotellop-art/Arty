// Enregistrement (et purge preview) du Service Worker. Externalisé car la
// CSP (script-src 'self', sans 'unsafe-inline') BLOQUE tout <script> inline :
// la version inline historique de index.html n'a jamais tourné en prod — le
// SW ne s'enregistrait chez personne (découvert à l'audit LP du 15 juillet
// 2026). Ce fichier est le SEUL point d'enregistrement du SW.
(function () {
  // Skip SW registration on Capacitor native — the SW persists across APK
  // updates and serves stale JS/CSS, forcing users to clear app data.
  // See BUG 45 in CLAUDE.md.
  var isCapacitorNative =
    (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() === true) ||
    (location.protocol === 'https:' && location.hostname === 'localhost');

  // Previews Cloudflare Pages (*.appfacade.pages.dev) : NE PAS garder de
  // Service Worker. Le SW (assets cache-first) servait du JS périmé aux
  // testeurs à chaque déploiement (BUG 45) sans moyen de s'en défaire. On le
  // purge ACTIVEMENT (désenregistrement + suppression des caches arty-cache-*)
  // puis on recharge UNE fois pour repartir sur le build frais. La prod
  // (tryarty.com) garde son SW (PWA).
  var isPreview = location.hostname.endsWith('.appfacade.pages.dev');
  if (isPreview && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      if (!regs.length) return;
      Promise.all(regs.map(function (r) { return r.unregister(); }))
        .then(function () {
          return window.caches && caches.keys ? caches.keys() : Promise.resolve([]);
        })
        .then(function (keys) {
          return Promise.all(keys.map(function (k) {
            return k.indexOf('arty-cache-') === 0 ? caches.delete(k) : null;
          }));
        })
        .then(function () {
          try {
            if (!sessionStorage.getItem('sw-purged')) {
              sessionStorage.setItem('sw-purged', '1');
              location.reload();
            }
          } catch (e) { location.reload(); }
        });
    }).catch(function () {});
  } else if ('serviceWorker' in navigator && !isCapacitorNative) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
