# Crédits disponibles et remboursements — 7 septembre 2026

Statut initial : candidat local validé par `npm run verify` le 7 septembre :
354 suites, 4 992 tests réussis et un saut préexistant, compilation/types,
contrôles Google et worker Office réussis. Livraison distante à attester dans
la PR et ses contrôles. Ce lot contribue à W02 et à
BILLING_OPERATIONAL_CDC.md ; les abonnements et crédits opérationnels restent
**non livrés** tant que leurs autres critères ne sont pas satisfaits.

## Changement

Le solde comptable n'est pas nécessairement dépensable. Une réclamation de
remboursement/contestation peut précéder son attribution et rester inconnue
après un crédit commité dont l'acquittement a été perdu.

- Un prédicat SQL commun protège la lecture et les deux opérations atomiques
  d'une nouvelle réservation. Il détecte la dette attribuée non collectée et
  la réclamation de montant inconnu reliée au bon compte par commande/fournisseur.
- Le solde et les anciennes réservations sont conservés. La disponibilité est
  zéro avec `reversalPending: true` jusqu'à régularisation. Aucune suppression,
  remise à zéro, collecte financière par GET ou modification des règles
  historiques d'attribution des achats n'est introduite.
- L'API distingue portefeuille absent (200, zéros confirmés) et lecture impossible
  (503, aucun montant). Les réponses de solde ne sont pas mises en cache HTTP.
  L'identité est celle du jeton Google vérifié, jamais un email de querystring.
- Un blocage connu retourne 409 `wallet_reconciliation_pending`, traduit par
  les quatre clients texte sans nouvelle tentative automatique. Si une course
  rend le refus de réservation obsolète et que la relecture affiche assez de
  crédits, le serveur retourne un échec transitoire plutôt qu'une demande d'achat.
  Le retry Anthropic existant des véritables 503 reste inchangé (2/4/8 secondes).
- Côté client, seul un solde vérifié en mémoire pour le contexte actuel peut
  ouvrir les modèles. Un ancien localStorage, un DTO incomplet ou un changement
  de compte ne fait pas autorité. Les mises à jour du solde propagent le retrait
  de l'accès wallet aux écrans sans nouvelle requête de plan ; les droits payants
  vérifiés et les clés personnelles conservent leurs règles séparées.
- Le badge bloqué ouvre des détails accessibles avec actualisation en lecture
  seule. L'unité de coût fournisseur n'est pas affichée à côté des crédits.
  Une hausse après retour de checkout est décrite comme un solde actualisé, jamais
  comme la preuve d'un nouveau paiement.

## Achat pendant régularisation

L'écran de crédits refuse prudemment de lancer un nouvel achat si le solde ne
peut pas être vérifié ou si un remboursement reste à rapprocher. Cela ne crée
pas un verrou serveur global de vente. Une dette sans fonds peut nécessiter le
support : **actualiser ne rembourse ni ne régularise quoi que ce soit**. Aucun
rachat automatique n'est proposé. L'intention serveur et le gate positif de
création de checkout restent un lot distinct, avec inventaire historique avant
remplacement du handler. Aucun flag commercial, prix ou secret n'est changé ici.

## Preuves et limites

Tests D1/workerd réels : acquittement perdu après commit, dette inconnue,
montants partiellement collectés, statuts trompeurs, ordres/fournisseurs/comptes
distincts, anciennes réservations, course au hold, puis récupération par le
résolveur existant. Les snapshots financiers prouvent que GET/refus ne déplacent
pas d'argent. Le drainer seul ne sait pas attribuer une dette NULL ; ce fait est
testé avant d'appeler explicitement la résolution existante.

Contrat réel D1 → handler avec vérification Google simulée → client wallet →
éligibilité testé pendant blocage et récupération. Tests React séparés avec le
vrai cycle Google chiffré et HTTP synthétique : actualisation wallet seule,
plusieurs lecteurs de plan, droits Free/VIP/abonnement/Pro, perte de contexte,
publication réentrante annulée, absence de double unité, clavier et clic FR/EN.
Tests du stockage défaillant, anciens DTO, délais exacts 249/250 ms, erreur SQL,
et des véritables clients texte 409/non-retry et 503/retry.

Deux contre-revues en lecture seule ont trouvé des cas de concurrence et
d'accessibilité corrigés et couverts par des canaris. Ce n'est pas une recette
d'achat réelle, une validation marchande, une installation APK ou une mesure
globale des incidents. Les anciens APK reçoivent zéro disponible à leur prochaine
lecture, mais pas la nouvelle explication avant mise à jour de leur client.

## Livraison et repli

1. Réussir `npm run verify`, vérifier les deux contre-revues et auditer les seuls
   fichiers autorisés de la branche publique, issue de main.
2. Contrôler les bindings D1 production/preview et le schéma. Appliquer uniquement
   `0011_wallet_spendability_lookup.sql` : index non unique et additif. Ne pas
   appliquer l'ensemble des migrations, ni 0008, ni un backfill historique.
3. PR/CI, preview puis fusion par la chaîne Pages existante, sans remplacement
   des variables distantes. Vérifier les rejets anonymes, artefacts et protections
   existantes. Pas de webhook financier signé artificiel sur une base partagée.
4. Observer les sondes publiques pendant 15 minutes ; une nouvelle erreur 5xx,
   un solde anonyme accessible, une mutation financière par GET ou des droits
   payants retirés par le wallet impose d'arrêter l'avancement et corriger.

Conserver l'index en cas de repli : sa suppression est inutile. Ne pas rouvrir
aveuglément l'ancien calcul de disponibilité ; un repli doit garder le refus
financier (ou une indisponibilité explicite), pas rendre la dette dépensable.
Les sondes anonymes ne remplacent ni télémétrie marchande ni recette autorisée.

Référence de procédure relue : [commandes D1 Wrangler](https://developers.cloudflare.com/d1/wrangler-commands/).
