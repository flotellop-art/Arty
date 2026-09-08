# Chat Anthropic — protection du financement et des continuations

## Candidat isolé — 8 septembre 2026

Base publiée `9d01e34`, branche `codex/anthropic-funding-release-20260908`.
Port local du checkpoint de recherche `990d1c7`. Aucun push, déploiement,
budget, achat ou changement de base distante effectué pour ce port.

### Reprise bornée — 8 septembre, 14:18 Paris

Mission : fermer le lot Anthropic uniquement et préparer sa revue. L'ancien
objectif automatique reste arrêté ; aucun chantier annexe n'est repris.
Les règles anti-boucle de `AGENTS.md` sont conservées dans ce candidat.

La contre-revue a reproduit une bascule payante sur réessai initial : dernier
message Google gratuit, portefeuille positif, réponse fournisseur 500/529.
Le client réessayait sans catégorie de financement imposée. Deux canaris
client → vrai handler → D1 locale échouaient avant correction.

Correction : catégorie figée dès la première réponse attestée, y compris en
erreur ; route versionnée et header restrictif sur le réessai. Sans attestation,
pas de réessai automatique. Un refus métier conserve son message. Le compteur
commun borne à 30 tous les POST, réessais et pauses inclus ; aucun outil client
ni préparation documentaire après épuisement ou Stop.

Preuves de cette reprise : types front/Functions réussis ; campagne ciblée
`anthropic-resume-targeted.json`, 54 tests réussis (6 intégrés D1, 31 parcours
client et 17 intégrité), terminée le 8 septembre à 14:17 Paris. Les deux
contre-revues finales n'ont plus d'objection matérielle sur ce delta.
La campagne complète du candidat final reste à recevoir via la CI habituelle ;
ne pas lancer en parallèle une campagne complète locale équivalente.

Barrière de publication maintenue : sans politique budgétaire autorisée et
attestée, ce lot couperait Free/essai. Préparation en brouillon uniquement,
aucune fusion ni activation implicite. Ne pas appeler les routes payantes ou
configurer la base réelle pour tester un aperçu. La prochaine action est la
réception de la CI du candidat, puis un bilan du blocage, pas un nouveau plan.

Les corrections de synchronisation, mémoire et consignes de la base sont
conservées. Ce lot ne reprend pas les modifications Creem, regroupement Gmail,
géocodage ou financement serveur de la mémoire de la branche de recherche.
Il ne clôt ni W01–W10 ni l'anti-abus complet.

## Périmètre et adaptation à main

- Qualification du corps Anthropic final et réservation du budget commun pour
  chaque appel réellement financé par Arty en Free/essai.
- Route de continuation versionnée et catégorie recalculée côté serveur.
  Veto avant nouveau débit d'essai ou réservation de crédits si elle a changé :
  aucun repli vers l'ancienne route, aucune bascule payante silencieuse.
- Lecture du portefeuille distinguant absence et indisponibilité.
- SSE avec historique natif, signatures et citations conservés ; fin logique
  requise avant reprise, autorisations d'outils strictes, Stop et limite globale
  de 30 tentatives. Une entrée ambiguë est conservée mais non rejouée.
- Middleware limité aux headers de financement ; cinq ajouts par langue.
- `readTrialCounterRemaining` : adaptation SELECT-only, identité exacte et
  tables Google/email séparées. Aucun regroupement Gmail ni changement de
  consommation. Absence de ligne = essai non épuisé ; panne, corruption ou
  dépassement de 250 ms = état inconnu, jamais permission de payer.

`readWalletBalance`, le noyau `subsidizedBudget` et la migration `0013`
existent déjà dans main. Aucun nouveau binding, secret, champ Env, schéma ou
migration n'est ajouté. Présence du SQL dans Git ne prouve pas son application distante.

## Contrat financier qualifié, pas autorisation de dépense

Le qualificateur ferme le modèle daté Haiku 4.5, champs racine, outils, betas,
cache 5 minutes/1 heure et capacité standard. Les modificateurs inconnus,
dont `inference_geo`, sont refusés. Images, documents, signatures et historique
compatible sont conservés. Un outil serveur encore ouvert doit être couvert ;
un ancien résultat complet reste inerte.

La [documentation pause_turn](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons#pause_turn)
décrit dix échantillonnages par requête, distincts du nombre de recherches.
La [borne max_tokens](https://platform.claude.com/docs/en/build-with-claude/task-budgets#interaction-with-other-parameters)
porte sur la sortie totale d'une requête, pas toutes ses continuations.
Déduction conservatrice depuis [Haiku 4.5](https://platform.claude.com/docs/en/models/haiku-4-5/overview)
et les [tarifs de recherche](https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool) :

`10 × 200000 × 2 + max_tokens × 5 + max_uses × 10000` microUSD avec recherche.

Sans outil serveur : une inférence. Au maximum accepté (64000 tokens de sortie,
cinq recherches), 4370000 microUSD, soit 4,37 USD par tentative. Borne haute,
pas coût habituel, débit client ou budget approuvé. Aucun cache hit supposé ni
remboursement depuis un parseur qui n'atteste pas tous les frais de recherche.
Contrat daté du 8 septembre 2026, à requalifier si le fournisseur change ses limites ou tarifs.

## Invariants et limites

1. Corps sérialisé avant toute attente. Chaque POST, retry ou continuation
   possède une réservation et un engagement propres.
2. Abonnement, VIP, BYOK et crédits réellement réservés sont indépendants du
   budget gratuit. Une clé personnelle ne finance que les appels qui l'utilisent.
3. Issue inconnue, erreur, annulation après engagement ou accusé perdu :
   réserve subventionnée conservée. Aucune redirection du POST fournisseur.
4. Refus certain avant envoi : compensation au plus une fois du débit d'essai
   confirmé. Best-effort : un crash peut laisser un message consommé. La garantie
   durable exige un reçu du débit exact ou une admission couplée, encore à traiter.
   Jamais de décrémentation rejouée aveuglément par email.
5. Quotas journaliers = compteurs de tentatives. Un refus budgétaire n'est
   ni relancé ni transformé en expiration d'essai.
6. `x-arty-funding` atteste une catégorie, pas un paiement réglé. Le header
   restrictif client ne constitue pas une autorisation : le serveur recalcule.

## Réception propre au port

Deux contre-revues indépendantes sécurité/facturation reçoivent le périmètre
du port, pas sa publication. Leurs demandes sont intégrées :

- Deux identités vérifiées et deux hôtes partageant la même base locale :
  un ticket engagé et un appel fournisseur ; refus exact
  `subsidized_budget_exhausted`, pas simplement un HTTP 503 quelconque.
- Vrai handler, essai épuisé et crédits positifs : snapshot trial échoué,
  corrompu ou tardif => `admission_unavailable`, zéro nouveau débit,
  réservation ou appel fournisseur, même après résolution de la promesse exacte.
- Helper : identité/table exactes, valeurs invalides et résultat tardif inconnus,
  aucune écriture ni relance et aucun timer conservé.

Types front/Functions reçus sur ce port. Campagnes précédentes terminées :
`anthropic-release-admission.json`, 81 tests réussis ;
`anthropic-release-client.json`, 170 tests réussis. Ces reçus précèdent le
delta de réessai décrit en tête et ne sont pas une validation globale finale.
`anthropic-release-creem-diagnostic.json` ne contient aucun test exécuté et
n'est pas une preuve de réussite. Aucun de ces anciens processus n'est actif.
Réception globale, build et contrôles publiés restent à obtenir.

### Preuves de recherche distinctes, non transposables

L'arbre `codex/subsidized-memory-20260908`, checkpoint `990d1c7`, conserve
les reproductions et ses reçus ciblés (115 puis 82 tests).
Son `npm run verify` 78540 est TERMINÉ : 6061 réussites, quatre délais dépassés,
un test ignoré, 397 suites, 1696,44 secondes. Délais de 5000 ms : litiges Creem
chargeback/chargedBack, déduplication remboursement et pagination au-delà de 100 lignes.
Cette campagne n'est pas verte et n'a pas atteint build/worker Office.
Elle ne valide pas ce port et ne doit plus être considérée active.
Le test chat/mémoire reste dans cet arbre : ne pas importer un backend inédit
uniquement pour faire passer un test du lot chat.

## Livraison et reste de l'objectif

Ce garde s'applique réellement à Free/essai. Politique absente, désactivée,
invalide ou base indisponible => refus avant fournisseur. Publier sans financement
autorisé couperait ce parcours : ce n'est pas une activation neutre.
Aucune configuration synthétique des tests ne peut être utilisée en production.

Avant ouverture : plafond total explicitement autorisé, configuration et base
commune attestées sur les hôtes concernés, chaîne normale Git/CI/Pages, aperçu
du commit exact, vérification web/PWA/anciens et nouveaux APK. Le refus D1 reste
une barrière de permission, sans contournement ni nouvelle identité.

Restent financement des autres routes gratuites, anti-multicompte complet,
abonnements/crédits, compensation durable des essais non servis, synchronisation,
recette physique et mesures W10. Les attentes marchandes et de dépense
n'interdisent pas les travaux locaux indépendants.
