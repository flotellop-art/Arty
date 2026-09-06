# Abonnements et crédits opérationnels — extension W02

Demande explicite du 6 septembre 2026 : intégrer à l'objectif une solution
pour les abonnements **et** les crédits. L'utilisateur pense que Lemon Squeezy
n'a jamais accepté la boutique. Ce signal doit être vérifié dans le compte
marchand ; il ne constitue pas un refus confirmé.

Cette exigence fait partie de la clôture de l'objectif Arty/Mammouth, en plus
de W01–W10. Ni des tarifs/boutons, ni une URL de checkout, ni un webhook testé
synthétiquement ne suffisent. Statut : **non livré**.

## Résultat attendu

Un utilisateur Web peut souscrire, retrouver son accès Web/Android puis gérer
et annuler l'abonnement auprès du bon prestataire. Il peut acheter des crédits
attribués exactement une fois au bon compte, avec solde/consommation explicables.
Un retour de navigateur ne constitue jamais une preuve de paiement.
Les achats restent fermés dans les versions natives publiques tant qu'un canal
conforme n'est pas implémenté ; vérifier les accès existants ne contourne pas ce verrou.

## P0 et preuves de réception

| Exigence | Preuve requise |
|---|---|
| Prestataire utilisable | État marchand daté, validation et mode live, entité/produits autorisés ; pas seulement sandbox, clés configurées ou commentaire du code. |
| Offre fidèle | Identifiants live, prix, devise, TTC/conditions et cadence conformes à l'interface, sans changement implicite de prix. |
| Rattachement au compte | Intention de checkout liée côté serveur à l'identité Arty vérifiée ; aucun email libre/querystring client ne choisit le destinataire des droits. |
| Cycle abonnement | Achat, retour avant webhook, renouvellement, impayé/grâce bornée, annulation immédiate/fin de période, expiration, reprise, remboursement ; identifiants de facture distincts de l'abonnement. |
| Crédits | Produit/devise/montant/paiement confirmé, ledger idempotent, réservation/débit, remboursements partiels/complets, remboursement reçu avant crédit ; aucun double crédit. |
| Événements sûrs | Signature, boutique/produit/environnement attendus, replay, ordre inversé, réconciliation si événement perdu ; aucun droit durable accordé depuis un simple état local. |
| Parcours client | Checkout fonctionnel, accès constaté après confirmation, erreurs claires, portail réel, annulation accessible, solde à jour et référence de transaction pour le support. |
| Isolation | Switch, reconnexion Google identique, logout, démontage, réponse tardive/focus ne doivent attribuer à un autre compte ni afficher un ancien plan/solde comme courant. |
| Terrain | Recette sandbox isolée puis contrôle live autorisé, avec transaction → webhook → droits/ledger → Web/Android. Toute dépense réelle attend une autorisation spécifique. |

Critères mesurables : zéro double crédit sur replay, zéro attribution au mauvais
compte, zéro droit nouveau après remboursement/révocation applicable, couverture
de chaque événement P0. Mesurer le délai réel de propagation ; attendre deux
secondes ne vaut pas confirmation. Aucun paiement de recette n'a été effectué.

## Diagnostic initial : code, pas état marchand

Contre-revue indépendante `billing_provider_audit` :

- `src/services/checkout.ts` : abonnement/Pro/pack Lemon par URLs statiques
  commentées « test-mode » ; crédits via `openCreemCheckout`.
- `functions/api/webhook/lemonsqueezy.ts` : attribution à `attributes.user_email`,
  non à une intention serveur prouvée ; événements facture traités comme
  abonnement ; remboursement et désactivation de licence incomplets.
- `functions/api/checkout/creem.ts`, `_lib/creemProducts.ts`, `webhook/creem.ts` :
  socle `credits_10`, aucun cycle abonnement Arty. Cela ne prouve pas le mode live.
- `checkAllowedUser.ts` et `subscription/status.ts` : maintien actuel des accès
  pour impayé/pause/date absente à clarifier ; ne pas modifier aveuglément les droits.

## Choix du fournisseur et dépendances

Contrôle du 6 septembre vers 18:00 UTC : l'ouverture de
`https://app.lemonsqueezy.com` aboutit à `https://auth.lemonsqueezy.com/login`.
Aucune session marchande accessible dans ce navigateur ; le statut reste
**non vérifiable**, et non « refusé ». Connexion du propriétaire requise pour
continuer ce contrôle. Aucun contrat, KYC, activation ni paiement effectué.

Références officielles consultées le 6 septembre :
[activation et distinction test/live Lemon](https://docs.lemonsqueezy.com/help/getting-started/activate-your-store),
[événements Lemon](https://docs.lemonsqueezy.com/help/webhooks/event-types),
[objet facture d'abonnement](https://docs.lemonsqueezy.com/api/subscription-invoices/the-subscription-invoice-object),
[portail client Creem](https://docs.creem.io/features/customer-portal).
Ces contrats publics ne prouvent pas l'état du compte marchand Arty.

1. Lire l'état marchand exact Lemon et Creem, sans secret exposé ni achat.
2. Lemon accepté/live : terminer son cycle ; conserver Creem crédits si fiable.
3. Lemon refusé/inexploitable et Creem accepté/live : envisager Creem pour les
   deux, avec vrai cycle serveur/portail, pas un simple remplacement de liens.
   Garder le traitement des anciennes ventes/droits/remboursements.
4. Aucun fournisseur utilisable : qualifier une alternative et son onboarding.
   KYC/validation contractuelle restent externes, jamais inventés ou acceptés
   à la place de l'utilisateur.

Hors extension : nouveaux prix sans décision, migration commerciale irréversible,
acceptation de conditions ou activation payante implicites, campagne de vente,
vidéo/SSO/API additionnelle. Ces limites ne retirent aucun critère W01–W10/P0.
