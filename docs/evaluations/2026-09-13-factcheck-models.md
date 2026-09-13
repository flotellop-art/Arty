# Vérifications ponctuelles : sept modèles, huit dossiers

56 appels réels aux API, le 13 septembre 2026. Même prompt de base du correcteur Arty et mêmes dossiers documentaires, figés avant les appels. Aucun repli ni nouvel essai après un échec. Ce test mesure le jugement sur des preuves fournies, pas une recherche web autonome, ni la chaîne complète Arty sur téléphone.

| Modèle | Dossiers réussis | Temps médian, tous les essais | Coût estimé des 8 essais, USD |
|---|---:|---:|---:|
| Haiku 4.5 | 7/8 | 2,23 s | 0,0256 $ |
| Sonnet 4.6 | 7/8 | 3,37 s | 0,0736 $ |
| Gemini 3.6 Flash | 8/8 | 3,59 s | 0,0315 $ |
| Sonnet 5 | 8/8 | 2,51 s | 0,0799 $ |
| Gemini 3.8 Flash | 7/8 | 1,84 s | 0,0321 $ |
| Luna | 7/8 | 2,50 s | 0,0046 $ |
| Terra | 7/8 | 2,09 s | 0,0394 $ |

Total estimé : **0,287 $**. Les modèles servis sont attestés par les identifiants retournés par les fournisseurs et correspondent aux modèles demandés.

## Erreurs qui comptent

- **Citation rapportée, F05 :** Haiku, Sonnet 4.6, Luna et Terra proposent de remplacer 324 par 330 dans une citation pourtant fidèlement attribuée à un témoin fictif. Expliquer que le témoin se trompe serait approprié ; modifier ses propos rapportés ne l'est pas. Cela décrit la proposition brute du modèle, pas une modification effectivement appliquée dans Arty.
- **Sortie tronquée, F07 :** Gemini 3.8 atteint la limite de 3 000 tokens, avec 2 879 tokens de raisonnement et 117 de réponse. Son JSON s'arrête au milieu d'un champ. Le parseur le refuse ; le dossier est compté comme un échec, sans refaire l'appel avec un budget plus élevé.
- **Contexte historique, approximation, preuves manquantes et archive du Louvre :** les sept modèles conservent les faits exacts ou s'abstiennent comme attendu. Aucun ne propose de remplacer les horaires actuels par ceux du mini-site Ingres de 2006.
- **Format :** Haiku entoure ses huit réponses de balises Markdown. Le parseur existant d'Arty les accepte : elles ne sont donc pas pénalisées pour cela. Une réponse Sonnet 4.6 est traitée de la même façon. Les corrections sans objet sur des verdicts `verified`/`uncertain` sont retirées par le normaliseur existant.
- **Confiance globale :** Haiku renvoie quatre fois `high` malgré un verdict `wrong`, Sonnet 5 et Terra une fois chacun. Ce défaut de cohérence est conservé séparément du score du verdict ; une couleur globale seule ne permet pas d'évaluer la réponse.

## Ce que ce test justifie

Luna est un bon candidat économique pour les discussions et les premières vérifications, avec une vigilance particulière sur les citations. Son coût dans ce lot est environ 8,6 fois inférieur à Terra et 17,5 fois inférieur à Sonnet 5. Sonnet 5 et Gemini 3.6 sont de bons candidats à une contre-vérification sur des dossiers déjà documentés. Le résultat ne prouve pas qu'ils seront meilleurs sur toutes les recherches ou tous les sujets.

Le correcteur de production n'est pas remplacé à partir de ce seul lot. La chaîne de lecture des pages, confrontation des preuves, contrôles sensibles et application des corrections doit être évaluée séparément. Le cas F05 est prioritaire pour cette validation.

## Méthode et limites

Le [protocole](2026-09-13-factcheck-protocol.json) contient les huit dossiers, les références, les résultats attendus et les bornes définies avant exécution. Deux dossiers sont des exercices fictifs explicitement signalés. Les preuves publiques sont des résumés courts de pages vérifiées, identiques pour chaque modèle ; leur sélection facilite la tâche par rapport à une recherche libre. Le score exige au moins un fait : une liste vide n'est jamais une réussite.

Les réponses ont été traitées par le parseur et le normaliseur réels du candidat Arty. Pour une erreur, la correction doit viser un passage exact et rétablir la bonne valeur ; la conversion correcte en km/s est acceptée pour F03. Les explications ont également été lues. Les résultats bruts, les tokens, les verdicts normalisés, les identifiants et les empreintes de protocole sont conservés dans le [JSON détaillé](2026-09-13-factcheck-models.json).

Budget commun de sortie : 3 000 tokens. OpenAI utilise `reasoning_effort: none` comme le chemin texte avec outils actuellement validé ; Gemini conserve son raisonnement par défaut. Cette différence de configuration fait partie du résultat, elle empêche d'en déduire une vitesse intrinsèque universelle. Pas de schéma JSON supplémentaire, d'outils web, de fact-check secondaire ou de réparation d'un JSON tronqué. La durée inclut toute la réponse HTTP, sans saisie ni interface du téléphone.

Les coûts utilisent les tokens déclarés et les tarifs standard sans réduction de cache ; ils sont des estimations, pas des factures. Tokens de raisonnement Gemini inclus, recherches externes absentes de cette série. Le plafond conservateur réservé par le script est de 4 $, fixé pour borner cette campagne, sans achat de crédits. Tarifs consultés le 13 septembre 2026 : [OpenAI](https://developers.openai.com/api/docs/pricing), [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing). Les tarifs Gemini utilisés sont promotionnels et datés.

Les [40 recherches effectuées précédemment sur le téléphone](2026-09-13-web10-phone.md) restent une campagne distincte. Leurs durées et leurs scores ne sont pas additionnés à ceux de ce test.
