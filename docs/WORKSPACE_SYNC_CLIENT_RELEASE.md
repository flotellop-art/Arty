# W06 — livraison du client et de la réception, démarrages OFF

7 septembre 2026. **Livré sur Pages et Firebase, démarrages OFF ; observation terminée.**
Le CDC Arty/Mammouth et son extension abonnements/crédits restent ouverts.

## Périmètre et provenance

Base main vérifiée par fetch : `5f1dbe8cc702457f589202597bac370513ccbf4a` (#486).
Le lot cumule découverte/jointure, contrôleur client privé, chaîne authentifiée,
validation/projection des contenus, séparation T/M, premier import froid v10
avec barrière state2, puis reprise explicite d'un envoi concurrent terminal.
Il ne livre pas encore l'application générale des mises à jour, la résolution
utilisateur, les suppressions ni une synchronisation multi-appareil activée.

Le dépôt est public. Le bilan personnel `BILAN_PAUSE_2026_09_07.md` reste local :
la branche de livraison doit partir de main et porter un commit cumulé sans
ce fichier, sans publier les anciens commits locaux qui le contiennent.
Les cinq documents marketing non suivis et les configurations/logs ignorés ne
sont pas inclus. Aucun secret ou reçu privé n'est à téléverser avec ce lot.

## Gates avant publication et fusion

- [x] Vérification finale locale : types, inventaire OAuth, tests avec couverture,
  build et worker Office réels. Les tests de panne attendent des erreurs
  synthétiques : seule la sortie terminale atteste le résultat.
- [x] Deux contre-revues indépendantes du dernier raccord ; rapport détaché avant
  révocation et inspection de paire durable corrigés. Pas de GO activation.
- [x] Contre-revues globales du diff cumulé avant PR/preview.
- [x] Branche publique sans bilan privé dans son arbre ni ses ancêtres nouveaux.
- [x] CI PR application, growth et Android terminée SUCCESS, sans contournement.
- [x] Pages preview du commit exact réussie puis sondes HTTP/UI publiques.
- [x] Fusion normale, arbre main égal au candidat vérifié.
- [x] Pages production et CI main sur ce commit, reçus Firebase séparés.
- [x] Observation post-déploiement 15 minutes : sondes HTTP/static bornées,
  sans prétendre à une télémétrie globale ou à une recette connectée.

## Démarrages et données

`ISOLATED_WORKSPACE_ENABLED=true` et restauration ON restent inchangés.
`WORKSPACE_UPGRADE_START_ENABLED=false` et
`WORKSPACE_SYNC_APPLY_START_ENABLED=false`. La configuration Pages actuelle
doit être vérifiée sans l'imprimer : aucun START sync ni nouveau binding R2.
Aucune migration D1 distante, ressource, activation, secret ou configuration
de production ne fait partie de cette livraison. Le contrat de test Wrangler
ne doit jamais remplacer la configuration Pages de production.

START serveur OFF refuse challenge/enroll/join/reserve avant auth/body/SQL.
Il ne coupe pas discover authentifié en lecture seule ni les opérations déjà
admises ; les voies de reprise/effacement restent disponibles. Une préparation
locale de successeur n'atteste pas sa réservation côté serveur.

Les tests à deux profils utilisent les vrais stores/services/crypto et le
serveur workerd D1/R2, mais JSDOM/fake-IDB et Google simulé. Le cas suppression
passe par l'adaptateur causal ; R contenant déjà A est construit par le codec
et le transport HTTP de test, sans rendre M multi-tête. Ce ne sont pas des
preuves de suppression dans l'UI, d'OAuth réel ou d'un téléphone physique.

## Repli et déclencheurs

Avant tout nouvel état, la compatibilité doit être évaluée par profil ET côté
serveur. Après root10, state2 ou un état sync privé v2/v3/pending, ne pas revenir
à un ancien client incapable de les relire : sa fermeture protectrice n'est
pas une reprise utilisable. Garder les lecteurs, la reprise froide et les
sorties d'effacement ; couper les nouveaux starts et corriger en avant.
Après un état serveur réel, garder également les gates d'effacement et
d'anti-rejeu déjà livrées. Aucun revert aveugle vers #485/#486.

Suspendre la fusion si le preview active un démarrage, casse un parcours public,
sert un bundle incohérent ou échoue aux contrôles CI. Après livraison, arrêter
la promotion et appliquer un correctif compatible si ces symptômes apparaissent.
Les sondes ne créent pas de compte, ne publient pas de données utilisateur,
ne modifient pas l'agenda et n'effectuent aucun paiement ou effacement réel.

## Preuves

Local : `npm run verify` terminé exit 0, 349 suites, **4 804 PASS + 1 skip
préexistant**, types/OAuth/build/worker Office verts. Log ignoré
`.playwright-mcp/workspace-sync-supersession-final-verify.log`.

La branche publique porte un seul commit cumulé `9654fa72dd7bd3e3164594c0d0c83c7c41c75d97`
sur la base main. Arbre technique égal au snapshot local vérifié, sans le bilan
personnel ; son ancien commit n'est pas un ancêtre nouvellement publié.

[PR #487](https://github.com/flotellop-art/Arty/pull/487), fusion normale le
7 septembre à 07:27:32 UTC : main `41ab207b1b42072dd369d01516e22986725cb8cb`.
Le diff d'arbre entre candidat public et main fusionné est vide.
[CI PR](https://github.com/flotellop-art/Arty/actions/runs/34094385674) et
[CI main](https://github.com/flotellop-art/Arty/actions/runs/34095563495) : SUCCESS
application, growth et Android sur leurs SHA exacts.

Pages preview : `6df48d88-715e-43fc-89c3-02e552f24278`, source `9654fa7`,
[URL immuable](https://6df48d88.appfacade.pages.dev).
Chrome, profils neufs, FR/EN à 390 et 1280 px : routes publiques de préparation,
démarrage upgrade absent, aucun App privé ni DB créée sur ces routes. Dans la
démo propre au preview : pin, branche, rechargement, contrainte UE et export JSON
conservent leurs invariants ; l'export retire la provenance sync privée tout en
gardant le marqueur historique. Le témoin local a été ajouté à une conversation
fictive : ce test n'est pas une preuve d'import réel. Aucun appel IA ou API privé.

Pages production : `c2f3475d-380e-45a7-9528-8d61c177df2d`, source `41ab207`,
[URL immuable](https://c2f3475d.appfacade.pages.dev). À 07:29:25 UTC, les cinq
chunks publics sondés de tryarty.com sont identiques octet par octet à cette
production immuable et le challenge sync anonyme refuse toujours les starts.
Les quatre cas UI publics passent aussi en production. Deux profils FR/EN de
390 px, avec root v10 synthétique et job placeholder jamais ouvert, montrent
la reprise froide malgré START OFF et empêchent le chargement de l'App privé.
Ce dernier test porte seulement sur l'admission ; aucune reprise/effacement cliqué.

Configuration Pages relue via Wrangler, sans modification : aucun nom
WORKSPACE_SYNC et aucun binding R2 ; compatibility date inchangée `2026-04-10`.
SELECT distant de `sqlite_master` limité aux noms `workspace_sync_%` : résultat
vide, zéro ligne écrite, `changed_db=false`. Aucun contenu utilisateur lu.
Configurations téléchargées et logs restent ignorés, hors de ce dépôt public.

[Firebase](https://github.com/flotellop-art/Arty/actions/runs/34095563506) : SUCCESS
sur main `41ab207`, avec étapes distinctes de vérification du candidat, distribution
et téléversement du reçu d'identité toutes réussies. Le reçu JSON allowlisté
atteste `com.arty.app`, version `1.0.99`/code `100`, 4 424 787 octets,
SHA-256 `3f0c1a4f799610dd9eadde64b6929f28937299335842bf644571adcf66e4623f`,
signature vérifiée et concordance avec assetlinks du checkout. Le succès de
distribution vient de l'étape Firebase, pas du seul reçu d'identité. Aucun APK
téléchargé ou installé ici ; ADB ne détectait aucun appareil à 07:39 UTC.

Observation terminée de 07:29:25 à 07:45:17 UTC, soit 951,966 secondes. Quatre
sondes espacées : les cinq chunks conservent leurs hashes et le challenge reste
OFF. Aucune anomalie dans ce périmètre. Ce n'est ni une télémétrie globale, ni
une recette connectée, ni une validation commerciale ou sur téléphone physique.
Les travaux locaux postérieurs au commit `41ab207` ne font pas partie de cette
livraison ; leur vérification doit rester séparée.
