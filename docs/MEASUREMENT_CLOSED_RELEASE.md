# Livraison fermée W10 et correction Stop — PR #479

## Périmètre

Correction du bouton Stop commun Chat/Home, protections du finaliseur des
réponses et préparation d'un pilote facultatif « réponse client ». Le pilote
reste **fermé en production** : pas de réglage de participation, de nouvelle
collecte, de table créée par le handler, de notice publiée ou de changement
d'infrastructure. Activation/cohortes/D7/D30/conversion restent des exigences
non livrées. Ne pas présenter le pilote comme une instrumentation activée.

## Chaîne de validation

- HEAD PR : `71c10074e624a0c4ac4870d82d56bbb6ed43c93d`.
- Deux contre-revues indépendantes en lecture seule, GO bornés au code fermé
  et au correctif Stop ; objections et preuves dans `ADR_PRODUCT_MEASUREMENT.md`
  et `OFFICE_BROWSER_RECIPE.md`.
- Vérification complète locale sous Node 22.23.2 : 326 suites, 4 185 tests
  réussis, un ignoré, contrôles no-CASA/typecheck/build/worker Office réussis.
- Première CI PR `34046137950` refusée pour l'import SQLite sous Node 22.
  Défaut reproduit puis corrigé dans le test, avec le vrai SQLite conservé.
- Nouvelle CI PR `34046927402` réussie : app 6 min 21 s, Android 3 min 43 s,
  growth 12 s. Aucun contournement ou nouvelle tentative aveugle du même code.
- Preview Pages `4948a490-bc13-4633-953b-0926b3e1c5a1`, commit exact, réussie.
  Sondes du 6 septembre 16:56:40–42 UTC : deux POST anonymes avec Origin autorisée
  → 404, corps vide, no-store ; flag compilé immuable false, UI activée absente.
  Le chemin API reste dans le bundle : sa présence n'est pas une activation.
  Lecteurs/restauration #478 toujours présents ; Chrome vierge FR/EN 390/1280
  montre le consentement sans ouvrir l'App privée ni créer de base. Requête
  de police Google bloquée dans ces contextes isolés, pas de donnée personnelle.
- [PR #479](https://github.com/flotellop-art/Arty/pull/479) fusionnée le
  6 septembre à **17:01:22 UTC**, après ces contrôles :
  `9b491b2858dda13d7fa8e7348510558b5d9c4301`.

## Contrôles post-fusion

- Pages production `7a1a5b21-8f6d-4155-a95e-940eb65f4d70` réussie au commit
  `9b491b2`. Sondes canonique/immuable du **6 septembre 17:03:39–41 UTC** :
  deux POST anonymes sur chaque origine → 404/no-store/corps vide, flag de
  disponibilité compilé false et UI de participation absente.
- Huit assets d'entrée/restauration comparés octet à octet entre tryarty.com
  et `7a1a5b21.appfacade.pages.dev`, identiques. Entrée
  `index-Bp3SxQis.js`, 328 544 octets, SHA-256
  `6ae35e6ccc209fab9cba675405a2a6ba2360a731b4cf93d8783e08d65f54093d` ;
  App `App-BKe-URD5.js`, 940 591 octets, SHA-256
  `d4a8669d22e97341355db275962d126fa6b547d9b031a9260d8eb7d2ec185e4e`.
  Lecteurs/recovery v8 et bornes de préparation 16/32 Mio conservés.
- Chrome vierge sur tryarty.com, FR/EN 390/1280 : consentement de préparation
  visible, pas d'App privée chargée ni de base créée, aucun débordement ou
  erreur JavaScript. Les ressources externes préexistantes Google Fonts et
  Cloudflare Insights ont été bloquées par la recette isolée : ne pas en
  déduire une absence universelle de trafic/mesure préexistante du site.
- CI main `34047281347` réussie en première tentative sur ce commit :
  app 5 min 37 s, Android 4 min 27 s, growth 13 s.
- Fabrication/distribution Firebase `34047281334` réussie en première tentative,
  9 min 22 s. Reçu `arty-apk-identity-9b491b2858dda13d7fa8e7348510558b5d9c4301-1`
  téléchargé et vérifié : bon commit/run, `com.arty.app`, version 1.0.99/code100,
  4 395 947 octets, signature vérifiée par la CI et empreinte du signataire
  identique au reçu précédent. SHA-256 de l'APK indiqué par le reçu :
  `441cbbaee1d7381c26bd4b82c365f348bc99737357d5d61c3e1c90e261cd00d0`.
  Vérification artefact datée `2026-09-06T17:10:38.383Z` ; ce JSON seul n'est
  pas un reçu de distribution, celle-ci est attestée séparément par le job.
  Aucun téléphone ADB connecté lors de cette recette : ni installation physique,
  OAuth, vérification Android du domaine, mise à jour automatique ni publication
  Play Store attestées. Le numéro de version inchangé ne remplace pas le hash.

## Repli et limites

Préférer retirer le pilote sur une base récente en gardant le correctif Stop.
Revenir à `36d432d` conserve la restauration #478 mais réintroduit Stop cassé.
Ne pas déployer de lecteur antérieur à #478 : `ISOLATED_WORKSPACE_ENABLED=true`
et lecteurs/reprise v8 doivent rester compatibles. Aucun nouveau format de
conversation/archive n'est ajouté par ce lot fermé.

La chaîne Git→Pages fonctionne sans nouvelle autorisation de configuration.
La session Wrangler distincte avait expiré ; aucune reconnexion/binding/secret
n'a été créée ou récupérée par un autre canal dans ce lot. La synchronisation
distante, l'activation de collecte après décision sur l'information préalable,
les intégrations réelles et les validations physiques ne sont pas débloquées
par ce reçu. Aucun taux d'erreur, délai de réponse ou résultat utilisateur réel
non observé n'est déclaré nominal.
