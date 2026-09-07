# W06 B3a/B3b — livraison du transport désactivé et de la reprise d'effacement

7 septembre 2026. Ce reçu est un état de préparation, pas encore une attestation
de production. Cahier des charges inchangé : jointure, transport client/ACK,
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

- [ ] Commit/PR exacte avec seuls fichiers du lot (documents marketing exclus).
- [ ] CI PR application/growth/Android verte ; aucune protection contournée.
- [ ] Pages preview du commit candidat réussie.
- [ ] Preview HTTP/static/UI publique : upgrade OFF, restauration inchangée,
      aucun départ sync, aucune suppression réelle.
- [ ] Sonde anonyme `challenge` refuse OFF avant authentification/body/SQL.

## Après fusion normale

- [ ] Main et Pages production reliées au bon commit.
- [ ] CI main et pipeline Firebase terminées et attestées.
- [ ] Octets servis et UI publique vérifiés ; mêmes gates qu'en preview.
- [ ] Observation HTTP anonyme/static 15 minutes terminée, reçus conservés.
- [ ] Absence de nouveau schéma sync/R2/START revérifiée ; aucun provisioning.

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
