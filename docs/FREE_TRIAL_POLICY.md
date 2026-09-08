# Essai gratuit Arty — politique cible retenue

Décision du 8 septembre 2026 : l'utilisateur retient cette base après avoir
précisé que le chiffrage reste **théorique**, sans groupe de test disponible.
Ce document fixe la cible produit ; il ne configure ni n'active une dépense.

## Offre à préparer

| Paramètre | Cible retenue |
| --- | --- |
| Modèle de l'essai standard | Claude Haiku 4.5 |
| Allocation | 30 messages offerts par personne |
| Budget de lancement proposé et retenu comme base | 100 USD cumulés, sans renouvellement automatique |
| Réponses | Environ 2 000 tokens produits au maximum par réponse |
| Recherche web | Une recherche maximum par question ; recherche approfondie dans l'offre payante |
| Mesure | Observer les premiers usages réels, sans constituer de groupe séparé |

Le budget concerne les dépenses IA prises en charge par Arty pour cette offre,
y compris les recherches et appels auxiliaires nécessaires. Il ne représente
pas un plafond de toutes les dépenses d'exploitation d'Arty. Ni 100 utilisateurs
ni 3 000 messages effectivement servis ne sont garantis par ce montant.
Atteindre le budget doit suspendre le service offert avec un message explicite,
sans bascule silencieuse vers le portefeuille de l'utilisateur.

## Estimation, pas mesure d'usage

Le scénario de référence est 3 000 appels, chacun avec 8 000 tokens entrants
(instructions et historique compris) et 1 000 tokens sortants : **39 USD**
sur Haiku 4.5, aux tarifs de 1 USD / million entrant et 5 USD / million sortant.
Il exclut le cache, les recherches, les images et les appels supplémentaires.
Une recherche native sur chacun de ces appels ajoute 30 USD d'outil, auxquels
s'ajoutent les tokens de traitement des résultats.

Sources tarifaires consultées le 8 septembre 2026 :
[Haiku et cache](https://platform.claude.com/docs/en/about-claude/pricing),
[recherche web](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
Actualiser les tarifs avant le chiffrage d'activation. Les 39 USD ne doivent
devenir ni une moyenne observée ni une promesse commerciale.

## État technique vérifié avant toute mise en œuvre

Lecture du candidat `34fe4e619924d8d96ac764ef283ad91b986e6585`, branche
`codex/anthropic-funding-release-20260908` ; deux contre-revues indépendantes
en lecture seule, financement et produit/routage. Aucun appel fournisseur payant.

- Le routage standard gratuit utilise déjà Haiku, mais le compteur actuel
  porte sur des admissions HTTP et distingue les canaux Google et email.
  Il ne prouve pas encore « 30 réponses visibles par personne ».
  Voir `functions/api/_lib/checkAllowedUser.ts` et `src/services/router/availability.ts`.
- `functions/api/_lib/anthropicSubsidizedRequest.ts` accepte encore jusqu'à
  64 000 tokens sortants et cinq recherches par appel. Un simple plafond de
  2 000 tokens / une recherche par POST ne suffit pas à garantir la même limite
  par question lorsque des outils ou continuations créent plusieurs POST.
- Seul le chat Anthropic est actuellement raccordé au budget subventionné
  dans ce candidat (`functions/api/ai/proxy.ts`). Les routes de mémoire et de
  recherche externe doivent être couvertes ou explicitement désactivées pour
  l'essai avant d'annoncer un plafond global de son coût IA.
- La réserve demeure intégralement retenue après un appel. Même avec un corps
  plafonné à 2 000 tokens et une recherche, sa borne serait encore 4,02 USD
  par POST : ce n'est pas le coût habituel. Ne pas réduire cette borne à une
  moyenne pour faire entrer artificiellement davantage d'appels dans 100 USD.

## Résultat attendu de l'implémentation suivante

1. Appliquer les limites de l'offre côté serveur après détermination du
   financement réel, avec une définition explicite du message et du périmètre
   des continuations. Conserver les parcours payants et BYOK indépendants.
2. Couvrir les coûts de l'offre par un même budget cumulatif. Les refus ne
   réinitialisent ni l'allocation ni le budget et ne déclenchent aucun paiement.
3. Distinguer le coût attesté par l'usage fournisseur, les réserves en cours
   et les issues inconnues. Après preuve complète, restituer une seule fois
   la différence entre réserve et coût attesté, par transaction idempotente.
   Sans preuve complète, conserver la réserve. Le parseur analytics actuel
   ne suffit pas : il n'atteste pas la fin logique, la ventilation cache
   cinq minutes/une heure et tous les frais de recherche.
4. Vérifier en environnement isolé les limites, les continuations, le dernier
   crédit de budget concurrent, les doubles règlements et les flux tronqués.
   Une erreur ou un accusé perdu ne doit ni autoriser un nouvel appel ni
   libérer du budget sur une simple supposition.

## Avancement de la mise en œuvre

Après la demande de poursuivre, le [lot local de rapprochement du chat](SUBSIDIZED_CHAT_GAP.md)
ajoute la preuve de coût et le règlement transactionnel, ainsi que les plafonds
de 2 000 tokens / une recherche **par appel**. Un fichier opérateur prépare
100 USD avec une politique désactivée, sans écrasement ni renouvellement.

L'offre complète reste à terminer : couverture des routes auxiliaires,
comptabilisation par question et allocation entre canaux. La base distante,
les secrets et la configuration de production restent inchangés. Aucun budget
n'a été engagé et aucune activation n'est attestée par ce document.
