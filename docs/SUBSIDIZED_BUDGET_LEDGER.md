# Budget subventionné — noyau local, non activé

7 septembre 2026. Base publique `96daa8d` (#492). Extension obligatoire du
[CDC anti-abus](FREE_TRIAL_ABUSE_CDC.md). **Ce lot ne protège encore aucune
route de production.** Aucune migration distante, politique provisionnée,
clé, binding, offre ou collecte personnelle modifiée.

## Décision de ce lot

Un cumul commun, stocké dans une D1, indépendant de l'email, de Google/OTP,
du navigateur, de l'IP, du domaine et du jour. Le module impose le scope
`arty-subsidized` ; il ne reçoit pas de scope client. Une politique explicite
contient une révision, l'activation, un plafond en micro-dollars USD et un
nombre maximal de tentatives. Aucune valeur de budget n'est choisie ici.

Contrairement à un quota journalier, aucun changement de jour ne remet le
cumul à zéro. Une future procédure de recharge/plafond devra préserver les
réserves anciennes et documenter le budget supplémentaire autorisé. Il n'y
a actuellement aucune fonction de provisioning, reset, remboursement,
régularisation descendante ou purge de tickets admis.

## Contrat implémenté

1. Le futur raccord doit fournir une enveloppe de coût **maximal vérifiée**,
   son identifiant versionné et la révision de politique attendue. Le module
   ne calcule pas le prix d'une requête. Il ne réutilise pas le calcul wallet.
2. Une réservation correspond à **une seule tentative HTTP fournisseur**.
   Le batch D1 efface un marqueur temporaire, insère un UUID strict, incrémente
   monnaie et tentatives sous garde atomique, supprime le ticket non financé,
   lit le résultat puis efface le marqueur. Aucun résultat intermédiaire
   n'autorise un envoi avant acquittement du batch entier.
3. `dispatchSubsidizedAttempt` gagne une seule transition `reserved → engaged`
   et appelle ensuite le callback. Un ticket déjà engagé ne redonne aucun
   droit. Le callback doit lui-même contenir exactement une tentative bornée.
   Chaque fallback, retry ou branche de recherche aura besoin d'un autre ticket.
4. D1 absente, politique désactivée/révisée, données malformées, ACK inconnu ou
   signal annulé avant le callback refusent l'envoi. Les types et bornes sont
   vérifiés dans les prédicats SQL, pas uniquement dans les CHECK du schéma.
5. Crash, erreur de fetch, HTTP 5xx, abandon ou ACK perdu conservent la réserve.
   Même un engagement finalement non envoyé peut donc immobiliser du budget.
   `sent` indique seulement que le callback a renvoyé une valeur, pas que la
   réponse était réussie ou le coût final connu. Aucun retry automatique.

Le compteur d'essai et le wallet sont distincts et inchangés. Rendre au client
un message non servi ne sera jamais une preuve suffisante pour rendre cette
réserve financière. Aucun transfert automatique vers ses crédits n'est prévu.

## Preuves locales et contre-revues

- Deux challenges indépendants avant et après code, en lecture seule :
  atomicité/coûts et sécurité/pannes. L'objection de marqueur orphelin a conduit
  à son effacement transactionnel initial et final. L'objection de journal
  incohérent a été reproduite (6 échecs, 2 réussites ciblés), puis corrigée dans
  le CAS ; les lignes invalides ne sont pas réparées au passage.
- Première suite du noyau : 58/58 réussites. Après ces compléments :
  **98/98 tests ciblés réussis**, trois suites, 39,65 s (66 sur le noyau).
  Les PK ont ensuite reçu un NOT NULL explicite ; la suite complète suivante
  couvre cette dernière version. Types vérifiés avant ce dernier changement SQL.
- Concurrence sur la dernière unité financière/la dernière tentative, collision
  UUID, marqueur orphelin, rollback après incrément et après SELECT, vrais commits
  puis ACK perdus, engagement concurrent, exception/5xx, annulation, minuit,
  révision changée, entiers limites, schémas sans CHECK volontairement corrompus.
- D1 réelle locale isolée via Miniflare ; callbacks simulés, aucun compte tiers
  créé, aucun appel fournisseur payant, aucune injection distante.
- Vérification complète et éventuelle CI : **en attente**, pas encore une
  preuve de livraison. Aucun import du module dans un handler de production.

La transaction repose sur le contrat officiel [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
Les signatures ont été recontrôlées dans `@cloudflare/workers-types` publié
`5.20260907.1`, téléchargé séparément ; aucune dépendance du projet mise à jour.

## Gates restant obligatoires avant activation

- Matrice de financement réelle (Free/essai/abonné/VIP/wallet/BYOK), routes,
  modèles et modalités. `usingServerKey` seul ne prouve pas une subvention.
- Prix officiels datés et enveloppes correspondant au body effectivement
  envoyé : entrée, sortie, raisonnement, outils, cache, images et grounding.
  Une étiquette d'enveloppe ne prouve ni son coût ni l'unicité HTTP du callback.
- Inventaire des anciens déploiements capables d'utiliser les ressources de
  production, puis fermeture de leurs chemins non équipés. Même scope dans
  deux bases distinctes ne crée pas un budget commun.
- Calibration du plafond, procédure de modification de politique et observabilité
  minimale. La monotonie vaut pour cette API, pas contre une restauration D1 ou
  des écritures administratives qui diminueraient les compteurs.
- Raccord de chaque appel, tests des vrais handlers, refus UX compréhensible,
  CI, Web/Android, déploiement versionné et observation. Pas de promesse de
  plafond couvrant les frais D1/Workers ou d'autres dépenses d'exploitation.
- Éligibilité multi-compte et protection graduée des usages légitimes : un
  abuseur peut encore saturer un budget commun, même si ce budget borne le
  risque financier. Un VPN ne doit pas entraîner un bannissement général.

Le fichier `migrations/0013_subsidized_budget.sql` est **préparatoire** : le
numéro 0012 est réservé par le candidat Creem séparé, non publié. Ne pas lancer
une application globale des migrations. Une future activation doit vérifier
le registre réel, appliquer seulement le delta approuvé et provisionner une
politique calibrée ; rien de cela n'a été exécuté.
