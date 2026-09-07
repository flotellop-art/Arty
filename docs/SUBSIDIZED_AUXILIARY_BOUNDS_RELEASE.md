# Bornes des appels auxiliaires — lot candidat du 7 septembre 2026

Statut : **local, non livré**. Base publique `7339bff` (#491).
Suite du [CDC anti-abus](FREE_TRIAL_ABUSE_CDC.md), sans modifier le nombre
de messages offerts, les droits payants, les prix, le wallet ou les identités.

## Corrections

- Recherche vérifiée : six sources et cinq pages par source pouvaient lancer
  36 appels en réservant seulement 12 unités du quota. Réservation préalable
  désormais de 36, ou 41 avec cinq résolutions de liens. Sans vérification,
  les redirects non exécutés ne consomment plus d'unité. Le quota compte une
  enveloppe maximale de tentatives, pas une facture réelle ; les appels non
  exécutés ne sont pas restitués. Les abonnements restent exemptés de ce cap.
- Extraction mémoire : les identifiants et le nombre de faits vides pouvaient
  dépasser la borne annoncée du prompt. Corps HTTP limité à 256 KiB réellement
  reçus ; 80 faits, identifiants de 64 unités maximum, contenu de 200 unités
  par fait et 5000 unités cumulées comme auparavant. Les lignes finales de
  faits, identifiants et séparateurs compris, sont aussi bornées à 32768 octets
  UTF-8. Ce dernier plafond ne décrit pas le JSON fournisseur complet.
- Une requête malformée, trop grande ou trop courte pour une extraction ne
  consomme plus le quota d'extraction ni de fournisseur IA.
- Le client projette uniquement les données transmises : préfixe historique
  de 6000 unités pour le transcript, contenus des faits bornés et IDs invalides
  ignorés, jamais raccourcis. Aucun message ou fait stocké n'est modifié.
  Les limites de chaîne utilisent les unités UTF-16 historiques ; une coupure
  au milieu d'un emoji conserve donc le comportement serveur précédent.

## Preuves et livraison

Deux contre-revues indépendantes avant et après code : correction du fan-out,
sécurité et compatibilité du transport. Compléments intégrés : transcript
total côté client, IDs sans collision par troncature, redirects conditionnels,
limites exactes/+1, stockage gelé inchangé et arrêt du parcours après saturation.

Première recette discriminante avant correction : 16 échecs, 2 réussites.
Après correction, première recette ciblée : 31/31 tests réussis. Recette étendue :
**213/213 tests réussis, huit suites, 134,80 s**, dont les garde-fous d'admission
du lot491 et la publication/restauration du workspace. Un dernier canari d'arrêt
du parcours ajouté ensuite : suite transport **4/4 réussie**, sans nouveau
changement de code de production. Types, compilation et worker Office compilé
exécuté en VM isolée réussis. La preuve complète CI reste exigée avant fusion.
Tests sans appels payants, identités synthétiques, D1 réel local isolé.

- [x] Tests ciblés finaux, types, compilation, worker Office (pas Office natif).
- [ ] Suite complète CI et Android ; preview sans événement financier signé.
- [ ] Fusion normale, version publique vérifiée, observation production.

## Limites explicites

Ce lot ne crée ni budget monétaire global ni règle d'éligibilité multi-compte.
Les contrats de prix, coûts internes fournisseur et anciens déploiements
financés restent à traiter avant cette revendication. Aucune configuration,
migration, nouvelle collecte, clé ou ressource distante n'est modifiée.

Un ancien client sans projection peut recevoir 413 sur une extraction très
volumineuse : il peut avancer son suivi d'extraction sans créer de nouveau
souvenir. Les souvenirs déjà stockés ne sont pas supprimés. Ne pas promettre
une compatibilité transparente de ces extractions anciennes volumineuses ni
une recette sur téléphone physique sur la seule base des tests automatisés.
