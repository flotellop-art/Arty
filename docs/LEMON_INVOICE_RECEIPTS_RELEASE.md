# Factures Lemon : séparation des droits — lot du 7 septembre 2026

Statut : candidat local, tests ciblés réussis ; livraison distante non attestée
dans ce document initial. Ce lot ne termine pas BILLING_OPERATIONAL_CDC.md.

## Défaut reproduit et correction

Une notification signée `subscription_payment_failed` portant une facture, sans
abonnement préexistant, créait une ligne `subscriptions` : plan `subscription`,
statut `past_due`, identifiant de facture à la place de celui de l'abonnement.
Le test D1 a échoué avant la correction, puis réussi après.

Les quatre événements `subscription_payment_*` connus écrivent maintenant
uniquement des observations dans `lemon_invoice_receipt_v1`. Les événements
d'abonnement conservent leur chemin distinct. Chaque chemin traité contrôle
le type d'objet fournisseur ; une facture étiquetée `subscription_updated`
est rejetée. Les horloges d'abonnement ne reçoivent plus celles des factures.

## Contrat documentaire, pas comptable

- HMAC sur les octets reçus avant traitement ; le nom signé dans le corps fait
  autorité, pas l'en-tête `X-Event-Name`.
- Empreinte SHA-256 des octets authentifiés comme clé du reçu. Seul le replay
  exact est dédupliqué. Sérialisations, événements, boutiques, modes et révisions
  différents restent des observations séparées, même à timestamp identique.
- Ne jamais sommer ces observations comme recettes ou remboursements : succès
  et récupération peuvent décrire le même paiement ; le montant remboursé décrit
  un état cumulé de facture, pas une nouvelle opération financière.
- `captured` signifie uniquement champs documentaires normalisés. Cela ne prouve
  ni boutique/mode/produit attendus, ni paiement admissible, ni propriétaire Arty.
  Champ absent/invalide : valeur nulle et `review` avec motifs fixes. Un mode
  inconnu ne devient jamais implicitement live. Le timestamp reste exact.
- Aucun lien autoritaire vers un compte, aucune recherche par email, aucune
  réparation de droits historiques ni initialisation/backfill des abonnements.
- Pas d'email, nom, carte, URL de facture signée ou payload brut conservé.
  Les références fournisseur restent **pseudonymes, non anonymes** ; accès D1
  administratif uniquement, sans nouvelle API de consultation publique.
- Réponse 200 après insertion ou replay confirmé en base. Erreur de stockage
  ou table absente : 500. Les retries Lemon sont bornés, pas une réconciliation.

## Plan de tests et preuves locales

50 tests nouveaux : vrai moteur D1 via Miniflare/workerd, handler invoqué depuis
Node. Des triggers interdisent INSERT/UPDATE/DELETE sur huit tables : abonnements,
licences, packs, wallet, ledger, réservations, événements wallet et remboursements.
Les snapshots complets doivent aussi rester égaux, y compris les dates historiques
nulles et les crédits déjà consommés/réservés.

Couverture ciblée : facture avant abonnement, expiration/Pro/VIP, quatre événements,
replay concurrent, ordre inversé, succès+récupération, remboursements successifs,
collision de boutique/mode/révision, microsecondes, données invalides/personnelles,
faux type, signature invalide, JSON invalide, panne d'insertion/perte d'acquittement,
abonnement canonique après facture future, migration répétée sur ancien schéma.

Commande ciblée : `npx vitest run src/__tests__/functions/d1.lemonInvoiceReceipts.test.ts
src/__tests__/functions/d1.webhookReplay.test.ts src/__tests__/functions/webhookSignatures.test.ts`.
Résultat : **70/70**, dont 50 nouveaux et 20 tests existants. Deux contre-revues
indépendantes en lecture seule ont donné GO au candidat, sous réserve de la
vérification complète et de la migration préalable.

Non prouvé ici : webhook réellement émis par Lemon, statut marchand, paiement
live, rapprochement des notifications perdues ou réparation historique.
Le corps HTTP reste non borné comme avant : hardening séparé, pas de GO global
de sécurité. Aucun test ne nécessite de compte réel ou de paiement.

## Procédure de livraison et repli

1. Figer le code ; faire réussir `npm run verify`, auditer le diff public et la CI.
2. Relire les bindings Pages production/preview. Vérifier la base exacte et le
   schéma sans lire d'identités clients ; ne pas remplacer les variables Pages.
3. Appliquer **uniquement** `0010_lemon_invoice_receipts.sql` sur les bases qui
   recevront ce handler, avant toute preview/production du nouveau code. Ne pas
   appliquer en bloc les migrations précédentes ni rejouer le backfill 0007.
   Vérifier table/index, reçu de migration et schémas des droits inchangés.
4. Livrer par branche publique propre, PR/CI puis chaîne Pages existante. Aucun
   nouveau secret, prix, produit, achat ou flag d'activation sync n'est introduit.
5. Vérifier les routes publiques et le rejet d'un webhook sans signature en
   preview puis production ; ne pas fabriquer de transaction en production.
   Observer pendant 15 minutes, en distinguant sondes et vraie activité marchand.

Seuils de pause/repli : erreur 5xx nouvelle sur les sondes publiques, acquittement
200 d'un webhook non signé, nouvelle erreur de stockage des reçus, ou changement
de droits imputable à une facture. Corriger avant d'avancer et conserver le journal.
**Ne pas revenir aveuglément à l'ancien handler** : il réintroduirait le défaut.
Un repli doit conserver la séparation (ou retourner temporairement 5xx pour les
factures), avec réconciliation nécessaire au-delà des retries fournisseur.
La table additive peut rester ; aucune suppression de données n'est prévue.

Sources fournisseur relues le 7 septembre 2026 :
[événements](https://docs.lemonsqueezy.com/help/webhooks/event-types),
[objet facture](https://docs.lemonsqueezy.com/api/subscription-invoices/the-subscription-invoice-object),
[acquittement et retries](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests).
