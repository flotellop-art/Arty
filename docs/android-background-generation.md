# Réponses Android pendant l’utilisation d’une autre application

## Comportement

Une génération lancée dans Arty garde son accès réseau pendant que l’utilisateur
ouvre une autre application. La réponse est enregistrée dès sa fin. Une
notification Android discrète indique le traitement en cours, sans contenu de
conversation. La vérification finale conserve la même protection réseau.

Le service est libéré à la fin du traitement, lors d’une annulation, d’un
changement de compte ou de la destruction de la vue. Chaque acquisition expire
après dix minutes. Cette solution couvre le changement d’application sur Android,
pas un arrêt forcé, la mort du processus, une coupure réseau ou la PWA/iOS. Elle
ne relance jamais automatiquement une requête facturable.

## Cause observée et correction

Sur le OnePlus CPH2609 sous Android 16, le processus restait vivant mais la
politique réseau appliquait `APP_BACKGROUND` cinq secondes après le passage dans
la calculatrice. Le flux échouait avec `network error` ou `Failed to fetch`.
Le même scénario au premier plan se terminait normalement.

`BackgroundGenerationService` utilise un service de premier plan `dataSync` et
un verrou de veille partiel borné. Le plugin confirme le démarrage avant tout
appel de génération. Les acquisitions possèdent des identifiants distincts ;
libérer une ancienne génération ne peut pas arrêter une nouvelle acquisition
en attente. Les vérifications finales conservent une référence au service déjà
démarré, sans essayer de démarrer un service depuis l’arrière-plan.

Le cycle de vie est intégré à `useStreaming`, aux préparations Office/vision et
aux comparaisons contextuelles. « Arrêter » reste raccordé à la lecture du corps
HTTP après réception des en-têtes. Un refus de démarrage ou une expiration native
produit un message explicite, y compris avant le premier token.

Une anomalie indépendante a également été corrigée dans `gemini-proxy.ts` : le
délai de 50 secondes portait auparavant sur toute la réponse. `streamBudget.ts`
limite désormais l’attente des en-têtes à 50 secondes, puis l’inactivité entre
lectures à 90 secondes. Les délais parents explicites restent applicables.
Cette modification serveur est locale et n’a pas été déployée.

Références : [type dataSync Android](https://developer.android.com/develop/background-work/services/fgs/service-types),
[démarrage des services](https://developer.android.com/develop/background-work/services/fgs/launch),
[politique réseau AOSP Android 16](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-16.0.0_r1/services/core/java/com/android/server/net/NetworkPolicyManagerService.java).

## Validation du 12 septembre 2026

- Deux reproductions avant correction, puis un contrôle réussi au premier plan.
- Après correction, réponse complète après plus de deux minutes dans la
  calculatrice ; politique réseau `procState=FGS`, `effective=NONE` pendant le flux.
- Test final : envoi à 21:10:01, calculatrice à 21:10:04, service libéré à
  21:11:05, retour à 21:14:26. Réponse complète et analyse terminée, sans erreur
  d’interruption. Le badge « Vérification partielle » concerne les preuves du
  contenu du conte, pas une interruption de génération.
- Test réel « Arrêter » : libération du service et du verrou de veille, réponse
  partielle explicitement interrompue, aucun traitement actif restant.
- Typecheck, build web, lint Android, assemblage signé, contrôles manifeste,
  accès Google public et worker Office réussis.
- Suite large : 399 fichiers, 5 878 tests, initialement six échecs et un test
  ignoré. Tous les échecs ont ensuite été résolus ou validés en relance ciblée
  (dont les tests D1 concurrents avec délai de 15 secondes). La suite complète
  n’a pas été relancée après ces ajustements.
- Relances finales : 120 tests sur cinq fichiers et 210 tests sur seize fichiers
  réussis ; couverture ciblée de l’annulation, des changements de compte, des
  acquisitions concurrentes, des expirations et des budgets de flux.
- Deux revues contradictoires indépendantes en lecture seule ; objections
  pertinentes intégrées, notamment les courses Stop/nouvelle invocation et
  acquisition/libération native.

Preuves locales :
`C:\Users\Tellop\.codex\visualizations\2026\09\12\01a096e1-3e49-7033-b019-fdfb1bdfae70\arty-mobile-background`.
Voir `18-final-background-netpolicy.txt`, `19-final-service-complete.txt` et
`20-final-complete.png`/`.xml`.

## Livraison

APK de test signée installée sur le téléphone, données conservées. Version
locale inchangée : 1.0.101 / code 102. SHA-256 de l’APK finale :
`478C9E022A12B4217312E84B8F8B1F07C7AFA485C29CE3DE34337C9FA16347F4`.
Signature vérifiée et certificat identique à la version précédente sauvegardée.

La dernière compilation ajoute uniquement la protection commune `stopIfIdle`
aux chemins d’erreur natifs ; le scénario nominal ci-dessus a été exécuté sur
l’APK immédiatement précédente. Lint et assemblage de l’APK finale réussis.

Aucune distribution générale ni publication serveur effectuée. Le contrôle de
provenance CI signale `ci_provenance_missing` pour cette construction locale ;
la publication devra suivre le pipeline normal avec ses attestations et son
numéro de version.
