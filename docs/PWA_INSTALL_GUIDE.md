# W09 — guide public d’installation

6 septembre 2026. Validation locale réussie ; publication à confirmer.
Base main `6a1ac3f8e5a5fe045607af7e2fc51508995c9738` (#472).

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
HTTP `arty-cache-*`. Pas de promesse de fonctionnement complet hors ligne.

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
