// Script partagé des landing pages pubs Meta (public/lp/*).
// CSP script-src 'self' : ce fichier self-hosted est le SEUL JS autorisé sur
// ces pages — ne JAMAIS ajouter de <script> inline dans les HTML /lp/*.
//
// Rôles (tous best-effort : le clic CTA doit marcher même si localStorage est
// indisponible — WebView Instagram/Facebook en navigation privée) :
//   1. First-touch d'attribution sous la clé RAW 'arty-acquisition' — MÊME
//      littéral que ACQUISITION_KEY dans src/services/acquisition.ts (parité
//      verrouillée par src/__tests__/services/lpPages.test.ts). La SPA
//      l'enverra au serveur au sign-in (trialClient → /api/trial/init).
//   2. Force la locale FR ('arty-locale', clé lue par src/i18n/index.ts) :
//      les pubs ciblent la France — évite pub FR → app détectée EN.
//   3. Forwarde les utm_* de l'URL de la pub sur les CTA (par-dessus les
//      valeurs par défaut du href) — l'attribution survit même sans storage.
(function () {
  var FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
  var params = null;
  try { params = new URLSearchParams(location.search); } catch (e) { /* très vieux navigateur */ }

  var lp = (document.body && document.body.getAttribute('data-lp')) || '';

  // 1. First-touch : n'écrase JAMAIS une attribution existante (la SPA gère
  //    l'expiration TTL 30 jours de son côté).
  try {
    if (!localStorage.getItem('arty-acquisition')) {
      var acq = { ts: Date.now(), lp: lp };
      if (params) {
        for (var i = 0; i < FIELDS.length; i++) {
          var v = params.get(FIELDS[i]);
          if (v) acq[FIELDS[i]] = v.slice(0, 120);
        }
      }
      // Même sans utm (QA, lien direct) le passage par une LP vaut first-touch.
      localStorage.setItem('arty-acquisition', JSON.stringify(acq));
    }
  } catch (e) { /* localStorage indisponible — le forward URL (3) couvre */ }

  // 2. Locale FR forcée pour le funnel pub France.
  try { localStorage.setItem('arty-locale', 'fr'); } catch (e) { /* best-effort */ }

  // 3. Forward des paramètres de la pub vers les CTA.
  if (params) {
    var ctas = document.querySelectorAll('a[data-cta]');
    for (var j = 0; j < ctas.length; j++) {
      try {
        var url = new URL(ctas[j].getAttribute('href'), location.origin);
        for (var k = 0; k < FIELDS.length; k++) {
          var val = params.get(FIELDS[k]);
          if (val) url.searchParams.set(FIELDS[k], val.slice(0, 120));
        }
        ctas[j].setAttribute('href', url.pathname + url.search);
      } catch (e) { /* href par défaut conservé */ }
    }
  }
})();
