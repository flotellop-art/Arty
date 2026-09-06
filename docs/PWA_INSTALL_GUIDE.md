# W09 — guide public d’installation

6 septembre 2026. Guide #473 et correctif des transformations CDN #474 publiés
et vérifiés. Base du guide : main `6a1ac3f8e5a5fe045607af7e2fc51508995c9738` (#472).

## Contrat livré par ce lot

Deux vrais documents statiques FR `/install/` et EN `/install/en/`, feuille CSS
locale et polices système. Ni script, formulaire, manifeste propre, enregistrement
de service worker, import App/auth/crypto, ni lecture ou écriture de données
privées. Les liens de la Landing et de son secours public déclenchent une
navigation documentaire. Aucun changement de routeur privé, manifeste, appId,
signature, API, quota ou scope ; aucune entrée native Login ajoutée.

La rédaction UX distingue installation, compte et données. Les avertissements
précèdent les instructions : conserver l’ancienne application et son espace,
pas de transfert automatique, restauration/synchronisation non disponibles.
Ouvrir **tryarty.com avant le menu d’installation**, pas installer ce guide.
Android Chrome, Safari iPhone/iPad et Chrome ordinateur sont présentés sans
détection forcée ; intitulés variables et maintien de l’accès navigateur.

La carte APK décrit uniquement Firebase **sur invitation**. App Tester est
facultatif, compte Google utilisé pour accepter l’invitation, accès non garanti.
Pas de téléchargement public APK, recherche Play homonyme, mise à jour automatique
promise ni parité PWA/native : IMAP demeure Android natif uniquement. L’installation
ne restaure pas un droit VIP ; absence de données ne justifie aucune purge.
Les services IA/Google nécessitent internet. Ce guide n’installe et ne connecte rien.

Sources primaires consultées le 6 septembre 2026 :
[Chrome Android FR/EN](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=fr),
[Chrome ordinateur](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=fr),
[Apple iPhone](https://support.apple.com/fr-fr/guide/iphone/iphea86e5236/ios),
[Apple iPad](https://support.apple.com/fr-fr/guide/ipad/ipadc602b75b/ipados),
[Firebase testeurs Android](https://firebase.google.com/docs/app-distribution/get-set-up-as-a-tester?platform=android).

## Service worker : correctifs bornés

`arty-cache-v54` remplace v53 pour le nouveau statique non hashé. Exclusion
précoce des non-GET et de `/api` exact en plus de `/api/…` ; cross-origin inchangé.
L’ancien fallback utilisait une Promise truthy à la place de son résultat et
pouvait servir `/` à la place d’un guide public.

En cas d’échec réseau de navigation :

- `/install`, `/install/`, `/install/en`, `/install/en/` : uniquement requête exacte
  dans le cache courant, jamais le shell racine ni un ancien cache ;
- autre chemin sous `/install/` : 503 public même si un faux shell y a été caché ;
- autres navigations : shell `/` du cache courant, sinon 503 ;
- cache absent ou rejeté : réponse texte 503 FR/EN, no-store ;
- réponse HTTP 404/500 : conservée, pas remplacée par du cache ;
- échec d’écriture cache : absorbé dans waitUntil, réponse réseau préservée.

Le guide ne s’enregistre pas lui-même comme application/SW. Un SW existant peut
le contrôler. Ces garanties commencent **après activation de v54** : un appareil
restant hors ligne avec v53 n’est pas réparé rétroactivement. Aucune purge de
localStorage/IndexedDB ; l’activation existante ne retire que les anciens caches
CacheStorage `arty-cache-*`, pas le cache HTTP du navigateur. Pas de promesse de
fonctionnement complet hors ligne.

## Validation et limites

Deux challenges indépendants readonly avant/après code, produit et sécurité :
absence de route React publique dans le verrou privé, conservation des données,
comptes Firebase distincts, allowlist de documents réels et cache courant,
non-GET/API exact et attente effective du cache intégrés. Aucun P1/P2 restant.

45 tests ciblés passent : vrai sw.js exécuté en VM avec Request simulée et vraies
Response/URL, cas adverses d’absence/rejet/cache ancien/faux shell/HTTP/non-GET,
structure des deux HTML, parité et liens des composants publics. La VM ne prouve
ni installation physique ni activation d’un SW dans un appareil réel.

Recette Chrome headless isolée : HTML/CSS/SW réels servis par un serveur de test
local allowlisté, racine **sentinelle synthétique**, jamais App/compte utilisateur.
FR/EN en 320/390/1440 px, JavaScript désactivé, ancres/détails/clavier, aucun script
ni requête API/provider, aucun débordement, texte agrandi 200 %. Un débordement
des mots longs à 320 px/200 % a été reproduit et corrigé par overflow-wrap.
Inspection visuelle des captures FR 390 px et EN 1440 px effectuée.
Cette recette complète passe sur `public` à 10:50:49.145 UTC, puis sur les fichiers
construits dans `dist` à 10:54:18.864 UTC (`install-guide-browser-dist.log`).

Seconde recette avec vrai SW enregistré/activé/contrôlant ce profil isolé : guide
FR puis EN en cache disponibles hors ligne ; EN absent ignore v53 ; URL inconnue
avec faux shell dans v54 retourne le 503 public. Ce n’est pas un test de migration
réelle d’un ancien appareil v53.

Entrées Landing FR/EN et secours FR : vrais composants/i18n, navigation de document
dans Chrome, aucun App/API. Le serveur SPA Vite ne résout pas les dossiers publics
comme Pages : la réponse de destination utilise les octets HTML exacts dans le
harnais. Le routage **réel Pages** doit être vérifié séparément sur la preview puis
en production, pas déduit de cette recette.

`npm run verify` exit 0 : **307 suites, 3 805 tests réussis + 1 sauté**,
couverture 71,58 / 66,42 / 77,24 / 73,44 %. Typechecks front/back, no-CASA/scopes,
build et worker Office réel isolé verts. App 930,31 Ko gzip 286,05 ; avertissement
historique >500 Ko inchangé. Logs ignorés `install-guide-verify.log`,
`install-guide-browser-public.log`, `install-entry-browser.log` ; captures
`install-{fr,en}-{320,390,1440}.png` dans `.playwright-mcp/`.

W06 reste OFF. W09 reste partiel : installation Safari/Android physique, réception
testeur, association de liens/Store et droits VIP réels ne sont pas attestés.

## Publication #473 et écart réel du domaine canonique

PR [#473](https://github.com/flotellop-art/Arty/pull/473), main
`f91954b21d32bb8642709fee54f2e9e77c821db2`, fusion 11:02:45 UTC.
CI PR `34028802568` et main `34029100459` réussies. Pages production
`c950149c-0ed1-41b5-aaf8-e186d2268f28` succès 11:03:49 UTC. Android/Firebase
`34029100477` réussi à 11:09:43 UTC, vérification du candidat et upload du reçu
JSON réussis. Ce succès n'atteste pas une installation physique.

La preview `044b6416.appfacade.pages.dev` passe les sondes d'octets à
10:58:06.873 UTC et le navigateur réel sans JS à 10:59:09.677 UTC. Après fusion,
l'immutable `c950149c.appfacade.pages.dev` reste propre mais **tryarty.com ne
respecte pas encore le contrat sans script** : injection de Web Analytics et
du décodeur d'adresses email par Cloudflare. Le second réécrit les liens mailto ;
bloquer son exécution seul laisserait donc le lien de support dégradé.
La sonde de production échoue volontairement sur ces scripts ; elle n'a pas été
assouplie. Aucun import privé App n'est en cause.

## Correctif ciblé de la politique CDN

`public/_headers` ajoute seulement `/install` et `/install/*` :

- `Cache-Control: public, no-cache, no-transform` pour interdire les deux
  transformations et permettre la revalidation ; pas de désactivation globale
  de l'analytics, du WAF, de Turnstile ou des protections de l'application ;
- CSP supplémentaire : aucun script ni connexion ; CSS et images de même
  origine seulement, aucune base, aucun formulaire/cadre. Pages cumule les
  politiques correspondantes avec une virgule ; elles s'appliquent toutes.
  La politique globale reste intacte, sans détachement ni `sandbox` ;
- SW v55 : les guides de v54 ne sont plus une source de fallback après
  activation ; les réponses stockées conservent leurs en-têtes ;
- nouveaux octets HTML FR/EN (commentaire de version), pour changer aussi le
  validateur HTTP. Le bump SW seul ne vide pas le cache HTTP du navigateur.

Les réponses canoniques transformées observées n'ont **pas d'ETag**. Les ETags
immuables #473 sont conservés pour tester la revalidation après publication :
FR `W/"d3161169420d8093002e27b567799ab0"`, EN
`W/"f9ebd2b8e0d71e91859e05ea99a898da"`. Ancien validateur attendu : 200 propre,
jamais 304 ; nouveau : 304 ou 200 identique. Ce contrôle n'est pas une preuve
de migration d'un ancien appareil réel.

Pas de modification de `_routes.json` ou du middleware : les pages historiques
conservent leur redirection canonique et les API leur transport #471. Les
Functions qui créent elles-mêmes une Response ne reçoivent pas `_headers` ;
les en-têtes finaux des guides doivent être **constatés sur le réseau**.

Sources primaires consultées le 6 septembre 2026 :
[Analytics/no-transform](https://developers.cloudflare.com/web-analytics/faq/),
[obfuscation/no-transform](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/),
[Pages headers](https://developers.cloudflare.com/pages/configuration/headers/),
[Pages ETag](https://developers.cloudflare.com/pages/configuration/serving-pages/#behavior),
[CSP multiples](https://www.w3.org/TR/CSP3/#multiple-policies).

52 tests ciblés passent : périmètre des règles, HTML, SW réel en VM et conservation
des en-têtes offline. Recette Chrome locale réussie sur `public` avec les vraies
règles `_headers` cumulées : six vues sans JS, deux mailto intacts, CSS/clavier,
scripts inline/self/beacon volontairement injectés dans une **fixture modifiée**
et bloqués, `connect-src 'none'` effectif, vrai v55 hors ligne conservant la CSP,
ancien guide transformé v54 ignoré. Ce harnais simule l'application des en-têtes,
pas les transformations de Cloudflare ; la preuve canonique reste indispensable.

Logs/sondes ignorés : `install-edge-browser-public.log`, `install-edge-verify.log`,
`install-edge-http-probe.mjs`, `install-guide-release-probe.mjs`. Validation
complète locale réussie : `npm run verify` exit 0, **308 suites, 3 823 tests réussis
+ 1 sauté**, couverture 71,58 / 66,42 / 77,24 / 73,44 %. Typechecks, no-CASA,
build et worker Office isolé verts ; recette Chrome également passée sur `dist`.
Preview, promotion et preuve canonique du correctif consignées ci-dessous.
Les anciens documents déjà ouverts
et appareils encore hors ligne ne sont pas corrigés rétroactivement. Aucune
purge de données utilisateur ni désinstallation demandée.

### Reçu final #474 — 6 septembre 2026

PR [#474](https://github.com/flotellop-art/Arty/pull/474), head
`d084bdf821588862b917120904494fa085419f93`, squash main
`48840dc4c962d70ee19df7b2f5e2dcaed5d9a1f4`, fusion 11:26:52 UTC. Deux GO
readonly indépendants, y compris le périmètre réel du TTL CSS décrit ci-dessous.
CI PR `34029984857` et main `34030279084` réussies. Pages preview
`902b60c4-b76b-4def-a516-29c8ba0a3b28` réussie ; octets, en-têtes et Chrome
distant JS activé/désactivé passent à 11:22:08–11 UTC avant promotion.

Pages production `522af73b-9a28-4c56-8dd0-0b7599f7c7fa`, succès 11:27:52 UTC.
Sondes **tryarty.com réel**, pas seulement immutable :

- 11:31:05.448 UTC, les quatre fichiers HTML FR/EN, CSS et SW ont les mêmes
  octets/hash que l'immutable et les sources normalisées. Aucun script,
  décodeur ou data-cfemail ; deux liens mailto intacts par document ;
- 11:31:06.277 UTC, deux CSP complètes séparées par virgule, no-transform et
  no-cache sur les HTML ; alias/slash/query également propres. Anciens
  validateurs #473 → 200 nouveaux octets ; nouveaux validateurs → 304.
  Racine, login, installation et SW conservent exactement la CSP globale ;
- 11:31:08.534 UTC, Chrome isolé distant FR/EN, JS activé et désactivé,
  navigation linguistique, CSS utilisable et aucune requête inattendue ;
- les sept sondes publiques GET/OPTIONS du transport API #471 passent encore,
  sans compte, token ou écriture chez un fournisseur.

Le premier contrôle du correctif s'est arrêté sur **no-cache de la CSS** : la
politique existante de zone lui donne `public, max-age=14400` sur tryarty.com,
alors que l'immutable conserve no-cache. La CSS est inchangée et conserve
no-transform, les deux CSP et les octets exacts. Après double revue, l'exigence
de revalidation immédiate est bornée aux **documents HTML**, qui la respectent ;
le TTL CSS de quatre heures est consigné, pas modifié globalement. Aucune
assertion zéro script/mailto n'a été retirée ou affaiblie. Le SW possède aussi
le TTL de zone existant ; aucune mise à jour immédiate d'ancien appareil attestée.

FR SHA-256 `14f3b3f8bc39eddbef9ba6cb584b3e2c2c8add549b7d139a8c6bd9a08363be1f`,
EN `dc6babd637aecf963ab828934247b2bd07659f29097aa7d69470538a9343aecd`.
Logs ignorés `install-edge-production-{bytes,http,browser}.log` et
`install-edge-legacy-api.log`.

Android/Firebase `34030279123` réussi 11:35:45 UTC : identité du candidat
11:35:36, distribution 11:35:42, reçu JSON uploadé 11:35:43. Réussite du pipeline,
pas installation physique. Ce reçu ferme le correctif documentaire, pas W09
global ni les validations externes appareil/Store.
