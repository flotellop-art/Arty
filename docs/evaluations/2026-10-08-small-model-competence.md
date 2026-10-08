# Petits modèles Arty : nouvelle comparaison avec Haiku 5.5

Bilan du benchmark avant migration. La bascule intégrée est décrite dans
[l'audit de migration](../audits/haiku-55-migration-2026-10-08.md).

Les **260 cellules et 300 requêtes réelles** du 8 octobre 2026 sont terminées.
Haiku 5.5 et Gemini 3.8 Flash réussissent les 20 dossiers aux consignes
univoques, chacun aux deux passages. Haiku 5.5 est le premier candidat à
évaluer dans le rôle du petit Claude : il réussit ce lot avec un coût et une
latence inférieurs à Gemini. Luna 6 reste le moins cher sur ce banc, avec une
erreur de calcul observée. Aucun routage de l'application n'a été modifié.

## Résultats principaux

Le tableau porte sur **40 observations par modèle** : 14 exercices originaux
non ambigus et les six exercices explicités de la campagne précédente,
répétés deux fois. Six autres exercices originaux, aux champs ambigus, sont
conservés et publiés séparément. Cette séparation est fixée avant les appels.

« Contenu » vérifie tous les champs demandés, l'identité du modèle, une fin
normale et les appels d'outils autorisés/requis. Un bloc JSON récupéré peut
réussir cette vérification. « Contrat complet » exige également JSON seul.
La prose éventuellement ajoutée n'est pas intégralement notée.

| Modèle et réglage | Contenu | Contrat complet | Dossiers corrects aux deux passages | Médiane par cellule | P95 | Coût estimé de ces 40 cellules |
|---|---:|---:|---:|---:|---:|---:|
| Haiku 5.5, adaptive / low | **40/40** | **40/40** | **20/20** | **1,447 s** | 2,046 s | **0,043156 USD** |
| Gemini 3.8 Flash, low | **40/40** | **40/40** | **20/20** | 3,006 s | 7,740 s | 0,193055 USD |
| GPT-6 Luna, none | 39/40 | 39/40 | 19/20 | 1,747 s | 3,149 s | 0,004322 USD |
| GPT-5.6 Luna, none | 38/40 | 38/40 | 19/20 | 1,151 s | 2,500 s | 0,008910 USD |
| Haiku 4.5, sans thinking explicite | 34/40 | **0/40** | 17/20 | 2,261 s | 3,718 s | 0,338544 USD |

La médiane mesure la durée complète d'une cellule, incluant deux requêtes
quand un outil est utilisé. Ce n'est ni le premier token, ni la vitesse de
l'application, ni une mesure sous charge. Les modèles tournent avec des
réglages économiques différents ; les budgets de raisonnement ne sont pas
équivalents. Deux répétitions ne constituent pas 40 tâches indépendantes.

| Cohorte, contenu puis contrat complet | Haiku 4.5 | Haiku 5.5 | Luna 5.6 | Luna 6 | Gemini 3.8 |
|---|---:|---:|---:|---:|---:|
| 14 originaux univoques × 2 | 24/28 ; 0/28 | 28/28 ; 28/28 | 26/28 ; 26/28 | 27/28 ; 27/28 | 28/28 ; 28/28 |
| 6 explicités × 2 | 10/12 ; 0/12 | 12/12 ; 12/12 | 12/12 ; 12/12 | 12/12 ; 12/12 | 12/12 ; 12/12 |
| 6 originaux ambigus × 2, diagnostic | 8/12 ; 0/12 | 9/12 ; 8/12 | 5/12 ; 5/12 | 8/12 ; 8/12 | 10/12 ; 10/12 |
| Total conservé, toutes cohortes | 42/52 ; 0/52 | 49/52 ; 48/52 | 43/52 ; 43/52 | 47/52 ; 47/52 | 50/52 ; 50/52 |

## Défauts observés et choix pour Arty

- **Haiku 5.5** : aucun défaut dans la cohorte principale. Dans le diagnostic,
  le booléen d'unité est interprété différemment aux deux passages, alors que
  la valeur en m/s est correcte. Le cas explicitant ce booléen réussit deux
  fois. Une réponse ajoute Markdown malgré JSON seul ; une autre cite S5 et
  S6 au lieu de S5 uniquement. Les versions explicitées réussissent. Cela ne
  permet pas de promettre un JSON toujours strict ou l'absence d'hallucinations.
- **Gemini 3.8 Flash** : aucun défaut dans la cohorte principale. Dans le
  diagnostic, il exprime deux fois 1 kg au lieu de 1000 g : conversion
  équivalente, unité de sortie non imposée dans cette ancienne consigne.
  Le cas explicitant l'unité réussit deux fois.
- **Luna 6** : un taux de marque de **28,28 % au lieu de 28,26 %** au premier
  passage ; le second est juste. Le très faible coût ne supprime pas ce défaut.
- **Luna 5.6** : taux de marge de **39,40 % au lieu de 39,39 %** au premier
  passage ; au second, taux de marque de **28,27 %** et taux de marge de
  **39,41 %**, au lieu de 28,26 % et 39,39 %.
- **Haiku 4.5** : total **1999,50 au lieu de 2000** deux fois ; taux de marque
  **28,27 % au lieu de 28,26 %** deux fois ; au second passage, taux de marge
  **39,38 % au lieu de 39,39 %**. Le cas explicitant EQTP ne retrouve pas le
  **14 %** fourni, aux deux passages. Toutes les réponses ajoutent une
  enveloppe ou de la prose. Une justification d'unité parle également d'un
  facteur 1 000 000 au lieu de 1 000 ; le score de champs ne mesure pas cette
  prose.

Les huit cellules d'outils par modèle réussissent sur le contenu : lecture du
dossier, résistance à l'instruction d'envoi malveillante et restitution des
reçus de création refusée. Aucun appel d'envoi non autorisé n'est observé.
Les outils sont exécutés par des fixtures locales ; aucun message ou rapport
réel n'a été envoyé ou créé.

**Recommandation limitée au lot testé** : prioriser Haiku 5.5 pour une prochaine
validation intégrée des tâches courtes avec preuves fournies et outils simples.
Gemini reste un autre candidat solide. Luna 6 est intéressant pour le volume
où une validation déterministe peut contrôler les nombres. Le calculateur
d'Arty doit être validé séparément : ce banc n'offre pas `code_execution`.

## Coûts, cache et réflexion

Les coûts ci-dessous couvrent **52 cellules / 60 requêtes par modèle**, donc
aussi les cas ambigus. Ils sont calculés depuis les usages fournisseur aux
tarifs publics du 8 octobre, sans facture ni frais de recherche externe.

| Modèle | Coût avec cache effectivement déclaré | Projection des mêmes tokens sans cache |
|---|---:|---:|
| Haiku 4.5 | 0,422543 USD | 0,422543 USD |
| Haiku 5.5 | 0,055061 USD | 0,055061 USD |
| Luna 5.6 | 0,010560 USD | 0,058807 USD |
| Luna 6 | 0,005119 USD | 0,029242 USD |
| Gemini 3.8 Flash | 0,239396 USD | 0,239396 USD |

**Total : 0,732678 USD estimé.** Les Luna lisent 271 472 / 284 004 tokens
d'entrée en cache, soit **95,59 %**, et en écrivent 12 352. Les écritures
OpenAI 5.6 et ultérieures coûtent 1,25 fois l'entrée normale ; elles sont
soustraites de l'entrée ordinaire et comptées à leur propre tarif. Le calcul
initial omettait ce supplément : 0,731752 USD reste conservé dans le résumé
gelé, puis est corrigé dans l'audit final depuis les mêmes réponses brutes.
La projection sans cache n'est pas une seconde campagne mesurée.

Haiku 5.5 déclare 490 401 tokens d'entrée et 12 041 de sortie, dont **9 266
de réflexion**. Ces derniers sont déjà inclus dans la sortie facturable ;
ils ne sont pas ajoutés une seconde fois. Gemini déclare 2 693 tokens de
réflexion, inclus dans les 4 325 tokens de sortie comptés. Aucun cache
Anthropic ou Gemini n'est déclaré dans cette campagne. À résultat principal
égal, le lot Haiku 5.5 coûte environ 4,47 fois moins que le lot Gemini et
7,84 fois moins que Haiku 4.5 ; cela ne prédit pas l'économie en production.

Le runner impose une réserve conservatrice avant chaque requête : limite
technique **6 USD**, réserve utilisée **5,858572 USD**. Cette limite locale
porte sur cette campagne, pas sur les dépenses du compte fournisseur.

## Protocole, contre-revues et preuves

Le système et les dossiers gelés le 5 octobre sont repris à l'identique :
empreinte système `5048a052e89082c58f1c8b9535029e76f9dd472931ae6f3962d4e9efc06501fe`.
Ce système provient du candidat `de9f45983e591672c6faa6ca21cdf82b109dab38`,
inchangé dans le candidat application `ca0d6ea` de cette campagne antérieure.
Le checkout de départ actuel est `045453f2767dac0d768b113656a21efd5cc5f0c5`.
Le test appelle directement les fournisseurs, avec 4096 tokens maximum,
concurrence 2, deux tours maximum, une seule tentative par cellule/passage,
aucun fallback. Il ne teste pas ce checkout via son transport application.

Les deux contre-revues indépendantes ont été examinées avant le runner puis
sur ses réponses. Elles ont entraîné : schémas Gemini corrigés, comparaison
structurelle des arguments, contrôle des outils au dernier tour, identités
servies exactes et fins normales exigées, tolérance numérique de **1e-8**,
coût du cache et de la réflexion séparé. Le barème précédent acceptait
`< 0,011` : ses scores ne sont donc pas directement comparables aux nouveaux.

Un audit uniforme après observation récupère un unique bloc JSON après un
bloc Python. Il corrige une seule cellule de contenu, Haiku 4.5
`calculation-B`, passage 1, dont les nombres sont exacts. Son contrat strict
reste en échec. Les scores initiaux, tous les textes et le runner exécuté
restent conservés. Le Python proposé n'est jamais exécuté pour fabriquer
une autre réponse. Un JSON ambigu parmi plusieurs blocs n'est pas choisi.

Déroulement UTC : **05:11:25 à 05:16:06**, environ 4 min 41 s.
Identités servies confirmées pour les cinq modèles, **300 HTTP 200**, aucun
incident de transport, aucun refus, aucune réponse incomplète. Les contrôles
locaux de notation, récupération JSON, arguments et coûts cache passent ;
les trois scripts passent la vérification de syntaxe. Les tests de l'ensemble
de l'application ne sont pas nécessaires à cette comparaison isolée.

Le [manifeste](2026-10-08-small-model-competence.json) contient les scores,
coûts et SHA-256. Le [protocole figé](2026-10-08-small-model-protocol.json)
contient les prompts et attentes écrits avant appels. Les preuves locales
sont sous `.playwright-mcp/competence-20261008/run/` : `results.jsonl`,
`summary.json`, `audited.json`, `audited-final.json` et le runner exécuté.
Ce dossier de preuves est ignoré par Git ; les clés et en-têtes ne sont
jamais persistés dans ces fichiers. Les scripts corrigés restent dans
`scripts/evaluate-small-models.mjs`, `scripts/audit-small-model-evaluation.mjs`
et `scripts/prepare-small-model-retest.mjs`.

Non validé : recherche web autonome, vision/vidéo, longues conversations,
outils authentifiés Arty, quotas, proxy, production et Android. Aucune
activation, publication ou distribution n'a été faite.

Le client actuel traite tous les IDs Haiku comme 4.5 :
`src/services/anthropicClient.ts:926-928,1005` désactive l'effort et envoie
température 0,7 ; `functions/api/ai/proxy.ts:68-69` supprime thinking et
`output_config`. Une migration 5.5 exige d'adapter ce transport, les outils,
le catalogue et les coûts avant toute activation. Elle reste une mission
distincte ; un simple remplacement d'ID serait incompatible.

Sources officielles consultées le 8 octobre :

- [Haiku 5.5 : tarifs et spécifications](https://platform.claude.com/docs/en/models/haiku-5-5/overview), sorti le 7 octobre, entrée/sortie 0,10/0,50 USD par million jusqu'à 100 000 tokens d'entrée.
- [Migration Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide) : adaptive, effort, suppression des paramètres de sampling et conservation des signatures.
- [Haiku 4.5](https://platform.claude.com/docs/en/models/haiku-4-5/overview).
- [Luna 5.6](https://developers.openai.com/api/docs/models/gpt-5.6-luna) et [Luna 6](https://developers.openai.com/api/docs/models/gpt-6-luna).
- [Cache OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) : lecture et écriture distinctes dans l'entrée totale, écriture facturée à 1,25×.
- [Gemini : tarifs](https://ai.google.dev/gemini-api/docs/pricing), 3.8 Flash à 0,75/3,75 USD par million jusqu'au 31 décembre 2026.
