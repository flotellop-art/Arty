# W06 B3a/B3b — livraison du transport désactivé et de la reprise d'effacement

7 septembre 2026. Code B3a/B3b livré en production, toujours désactivé pour les
nouveaux démarrages sync. Première observation post-déploiement non validée
(timeout de connexion final) ; seconde fenêtre indépendante terminée PASS.
Cahier des charges inchangé : jointure, transport client/ACK,
réception/apply/conflits et recettes multi-appareils restent à réaliser.

## Périmètre

Publication du code via Git/CI/Pages uniquement. Aucune activation de sync,
aucune migration D1 distante (0009 locale seulement), aucun bucket, binding ou
secret ajouté/modifié. Le contrat Wrangler sous `scripts/workspace-sync-contract`
ne doit jamais être utilisé comme configuration de déploiement.

La restauration et les lecteurs isolés livrés restent ON ; upgrade/sync START
reste OFF. Les nouvelles actions d'effacement ne sont proposées que pour un
reçu pending exact. La consultation ne POSTe pas ; la reprise est explicite.

## Préparation vérifiée

- Main relue : `cadf1abc738b949b26ce0cb04a209b00dff8d734` (#485).
- `npm run verify` : 340 suites, 4531 PASS + 1 skip existant, typechecks,
  inventaire OAuth public, build et véritable worker Office réussis. Rejeu du
  dernier delta : 4 suites / 52 PASS.
- Chrome : 5 cas PASS à 01:47:59 UTC (FR390/EN1280 chaud/froid ; document perdu
  avec panneau encore monté). Vrais composants/services/IDB/Web Locks ; HTTP
  et reçu initiaux synthétiques. B relit et écrit, focus résultat, pas d'erreur.
- Backend : vrais handlers/middleware/D1/R2 locaux. La réponse tokeninfo est
  simulée côté serveur ; fake-IDB/Web Locks/getter OAuth/shim Capacitor côté
  client du test. Le navigateur couvre séparément IDB/Web Locks réels.
- Deux contre-revues indépendantes ont validé le checkpoint, puis la publication
  OFF sous conditions CI/preview. Fences CAS froid, scope UI total, succès tardif
  A sur B et reprise locale après confirmation corrigés.
- Configuration Pages téléchargée par la CLI officielle, en lecture seule,
  dans un dossier ignoré : aucun START sync ni binding R2 ; compatibilité
  `2026-04-10`. Banc transport aligné sur cette date avant publication.
- D1 production, SELECT de noms de tables sync seulement : résultat vide,
  `rows_written: 0`, `changed_db: false`. Aucune donnée utilisateur consultée.

## Gates avant fusion

- [x] Commit/PR exacte avec seuls fichiers du lot (documents marketing exclus).
- [x] CI PR application/growth/Android verte ; aucune protection contournée.
- [x] Pages preview du commit candidat réussie.
- [x] Preview HTTP/static/UI publique : upgrade OFF, restauration inchangée,
      aucun départ sync, aucune suppression réelle.
- [x] Sonde anonyme `challenge` refuse OFF avant authentification/body/SQL.

## Après fusion normale

- [x] Main et Pages production reliées au bon commit.
- [x] CI main et pipeline Firebase terminées et attestées.
- [x] Octets servis et UI publique vérifiés ; mêmes gates qu'en preview.
- [x] Observation HTTP anonyme/static 15 minutes terminée, reçus conservés.
- [x] Absence de nouveau schéma sync/R2/START revérifiée ; aucun provisioning.

## Reçus de livraison

- [PR #486](https://github.com/flotellop-art/Arty/pull/486), candidat
  `0a67128296dccf497eea7e7579e2f1e76c3fd00f`, fusion squash normale à
  **02:04:50 UTC**, main `5f1dbe8cc702457f589202597bac370513ccbf4a`.
  Arbres Git candidat/main identiques ; aucune protection contournée.
- [CI PR 34074485776](https://github.com/flotellop-art/Arty/actions/runs/34074485776)
  terminée SUCCESS (application/growth/Android) ; Pages preview
  `7dcc8ef8-d173-4a1b-8506-744ceb5d0a4e` SUCCESS à 01:55:10 UTC.
- [CI main 34075075188](https://github.com/flotellop-art/Arty/actions/runs/34075075188)
  terminée SUCCESS sur les trois jobs. Pages production
  `c3f0b1fa-7cca-4d0d-9de6-4a404400413a`, source `5f1dbe8`, check SUCCESS
  à **02:06:03 UTC**. URL immuable :
  [c3f0b1fa.appfacade.pages.dev](https://c3f0b1fa.appfacade.pages.dev).
- Première sonde à 02:05 UTC trop précoce : ancien bundle encore servi et
  URL immuable non prête, check Pages encore in-progress. Ce n'était pas une
  preuve de livraison. Rejeu après le check terminé : **PASS à 02:06:41 UTC**.
  Les cinq chunks contrôlés sur tryarty et l'URL immuable sont byte-identiques,
  notamment l'entrée `/assets/index-CsqEsKuI.js`, SHA-256
  `803f2ed994fa9330d0b45d4a1b868735693bc3087b3cf9ba5f0cd71c6f479f3e`.
  Présence des voies cleanup contrôlée ; `challenge` anonyme renvoie
  `404 Sync starts unavailable`, `no-store` et CORS attendu. Aucun effacement.
- Chrome production **4 cas PASS à 02:06:55 UTC**, FR/EN, 390/1280 px : upgrade
  OFF, restauration ON, pas d'import de l'App privée ni DB créée sur cette route
  publique, lien de retour, aucun débordement/pageerror. Profils synthétiques,
  polices et beacon tiers bloqués ; pas de compte authentifié.
- [Firebase 34075075292](https://github.com/flotellop-art/Arty/actions/runs/34075075292)
  terminé SUCCESS à 02:14:16 UTC, exécution 382/tentative 1, même commit.
  Étapes signature/identité/distribution et upload du reçu réussies. Seul le
  JSON allowlisté `arty-apk-identity-5f1dbe8cc702457f589202597bac370513ccbf4a-1`
  a été téléchargé ; aucun APK, certificat, secret ou keystore extrait.
  Reçu vérifié à 02:14:05.490 UTC : `com.arty.app`, **1.0.99 (100)**,
  4 414 380 octets, SHA-256 APK
  `2a601bf37b653d98386fcae39d0c243119d7ba811e042268abbee1d497986ced`.
  Signature et assetlinks du checkout attestés ; le succès Firebase prouve
  cette distribution, pas une installation physique ni le fonctionnement OAuth.
- Configuration Pages relue après déploiement : aucune entrée `WORKSPACE_SYNC`
  ni binding R2 ; date de compatibilité `2026-04-10` inchangée. D1 production,
  lecture primaire SELECT de noms de tables seulement : résultat vide,
  `rows_written=0`, `changed_db=false`. Aucune migration/binding/ressource créée.
- Première observation : **15 échantillons réussis, minutes 0 à 14**, de
  02:06:42.692 à 02:20:42.694 UTC, hash inchangé. À la minute 15, le premier
  fetch HTML échoue avant réponse HTTP : `UND_ERR_CONNECT_TIMEOUT`, délai de
  connexion 10 secondes. Processus terminé exit 1, **pas de reçu final PASS**.
  Sonde complète rejouée à 02:22:29.717 UTC : PASS sur les deux origines, mêmes
  cinq chunks et refus OFF. Cela ne localise pas la cause réseau et ne valide
  pas rétroactivement la fenêtre interrompue. CI/Pages/Firebase restent verts.
  Nouvelle fenêtre indépendante de **02:23:09.806 à 02:38:09.794 UTC** :
  **16 mesures réussies, PASS terminal exit 0, durée 900 370 ms**, mêmes octets
  sur les deux origines. L'échec initial reste consigné. Cette preuve HTTP
  anonyme/static n'atteste ni la télémétrie globale, ni les parcours connectés.
- ADB disponible, aucun appareil détecté au contrôle de 02:20 UTC. Aucun test
  physique, changement ou installation sur téléphone pendant cette livraison.

Logs et recettes ignorés dans `.playwright-mcp` :
`workspace-sync-b3-production-probe.log`, `workspace-sync-b3-production-browser.log`,
`workspace-sync-b3-production-observe.log`, `workspace-sync-b3-observation-first-failure.md`,
`workspace-sync-b3-production-probe-after-timeout.log`,
`workspace-sync-b3-production-observe-recheck.log`, `firebase-486-identity/identity-receipt.json`.
Les configurations téléchargées restent locales/ignorées et ne doivent pas être
publiées ou imprimées en entier : elles peuvent contenir des valeurs sensibles.

Pas de télémétrie globale erreurs/latence disponible dans ces sondes : ne pas
la remplacer par une promesse. La disponibilité et l'identité statique mesurées
ne prouvent pas les comptes connectés ni un téléphone physique.

## Repli

Avant tout état sync serveur réel (y compris registry/challenge avant coffre),
un repli vers #485 reste compatible avec le serveur, en gardant les lecteurs
isolés et restauration déjà livrés. Après le premier état réel, ne jamais
revenir à un serveur ignorant les nouvelles gates : correctif en avant avec
START OFF, protections d'effacement et anti-rejeu conservées.

Déclencheurs : endpoint critique cassé, HTML/JS incohérents avec la release,
ou départ sync possible alors que START doit être OFF. Suspendre la fusion si
cela apparaît en preview. Aucun effacement réel ou mutation de compte ne fait
partie des sondes de déploiement.
