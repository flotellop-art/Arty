# W06 — livraison du client et de la réception, démarrages OFF

7 septembre 2026. **Préparation de livraison, pas encore déployée.**
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
- [ ] Branche publique sans bilan privé dans son arbre ni ses ancêtres nouveaux.
- [ ] CI PR application, growth et Android terminée SUCCESS, sans contournement.
- [ ] Pages preview du commit exact réussie puis sondes HTTP/UI publiques.
- [ ] Fusion normale, arbre main égal au candidat vérifié.
- [ ] Pages production et CI main sur ce commit, reçus Firebase séparés.
- [ ] Observation post-déploiement 15 minutes : sondes HTTP/static bornées,
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

À compléter avec SHA, PR, exécutions CI et URLs immuables réels, après leur
obtention. Ne pas transformer un démarrage de pipeline en reçu SUCCESS.
