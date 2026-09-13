# Modèles Arty : essais sur téléphone du 13 septembre 2026

Sonnet 5 reste compétitif sur ces deux exercices courts. Les Gemini Flash Lite ont répondu plus vite dans cette série et Luna possède des tarifs API inférieurs. Aucun avantage de justesse numérique des modèles les plus chers n'a été observé ; leurs capacités sur des tâches complexes restent hors du test.

## Périmètre et protocole

Les 20 modèles texte des quatre fournisseurs déjà raccordés à Arty ont répondu depuis le comparateur de l'application Android installée sur un OnePlus CPH2609, via débogage Wi-Fi. Les premiers refus Mistral ont été résolus pendant la session ; leur série de réponses est mesurée après ce déblocage.

La série principale ci-dessous contient **60 réponses**, soit trois par modèle : un calcul de devis fictif, un exercice de bornes statistiques sans supposer les répondants représentatifs, puis une répétition du calcul. Les résultats attendus sont respectivement **2171,44 ; 217,14 ; 2388,58 ; 1888,58** et **80 ; 8 ; 98 ; false**. Les prompts complets et les mesures sélectionnées sont conservés dans [le relevé JSON](2026-09-13-models-phone.json). Pour Sonnet, les trois réponses de la première série de base sont remplacées dans ce tableau par les trois réponses obtenues après actualisation de l'APK ; elles restent dans les preuves locales.

Les appels passent réellement du téléphone au serveur puis au fournisseur. Le comparateur n'ajoute ni historique, ni outils, ni navigation, ni fichiers. Les panneaux d'une même série partent ensemble, entre deux et quatre modèles. Les groupes ont été exécutés successivement, pas dans un ordre aléatoire. Le réseau, la charge fournisseur, le budget de raisonnement et la longueur de sortie influencent les durées. L'autocorrection du clavier a parfois changé la casse des clés HT/TVA, sans changer les nombres.

La justesse est vérifiée visuellement sur les valeurs numériques et le booléen. Elle ne représente pas un taux de fiabilité général : seulement deux exercices distincts. Plusieurs réponses ajoutent une clôture Markdown malgré la consigne JSON seul ; le score ne prétend donc pas valider un JSON strict. Les captures brutes et les appels supplémentaires de diagnostic restent dans les preuves locales, sans publication des écrans du téléphone.

## Résultats principaux

Durées médianes affichées par Arty, en secondes. Tarif API standard en USD par million de tokens, entrée fraîche / sortie, contexte court, hors outils et taxes.

| Modèle | Valeurs correctes | Premier token (s) | Réponse complète (s) | USD/M entrée / sortie |
|---|---:|---:|---:|---:|
| Sonnet 5 | 3/3 | 2,26 | 2,46 | 2 / 10 |
| Haiku 4.5 | 0/3 | 1,04 | 1,52 | 1 / 5 |
| Opus 4.8 | 3/3 | 1,41 | 2,03 | 5 / 25 |
| Opus 5 | 3/3 | 3,03 | 3,21 | 5 / 25 |
| Fable 5.1 | 3/3 | 3,37 | 4,60 | 10 / 50 |
| Gemini 3.8 Flash | 3/3 | 2,38 | 2,38 | 0.75 / 3.75 |
| Gemini 3.1 Pro Preview | 3/3 | 7,48 | 7,59 | 2 / 12 |
| Gemini 3.6 Flash | 3/3 | 5,73 | 5,80 | 1.5 / 7.5 |
| Gemini 3.5 Flash | 3/3 | 4,83 | 4,88 | 1.5 / 9 |
| Gemini 3.5 Flash Lite | 3/3 | 0,84 | 0,93 | 0.3 / 2.5 |
| Gemini 3.1 Flash Lite | 3/3 | 0,81 | 0,91 | 0.25 / 1.5 |
| GPT-5.6 Luna | 3/3 | 2,51 | 2,76 | 0.2 / 1.2 |
| GPT-5.6 Terra | 3/3 | 2,04 | 2,18 | 2 / 12 |
| GPT-5.6 Sol | 3/3 | 2,47 | 2,69 | 4 / 20 |
| GPT-6 Astra | 3/3 | 3,05 | 3,38 | 10 / 50 |
| GPT-5 Mini | 3/3 | 7,75 | 8,05 | 0.25 / 2 |
| GPT-5 | 3/3 | 8,62 | 8,72 | 1.25 / 10 |
| Mistral Small 4 | 0/3 | 0,44 | 0,65 | 0.15 / 0.6 |
| Mistral Medium (latest) | 0/3 | 0,77 | 1,02 | 1.5 / 7.5 |
| Mistral Large (latest) | 1/3 | 0,55 | 1,19 | 0.5 / 1.5 |

**49 réponses sur 60** contiennent toutes les valeurs attendues. Haiku 4.5, Mistral Small et Mistral Medium se trompent sur leurs trois appels. Mistral Large réussit l'exercice d'incertitude mais échoue sur les deux calculs de devis. Ce constat vaut pour ces appels, pas pour toutes leurs utilisations.

Exemples vérifiés : Haiku annonce un maximum de satisfaction de 88 % au lieu de 98 %, Mistral Small 92 % et Medium 100 %. Large calcule 2170,44 EUR HT au lieu de 2171,44 sur ses deux essais. Small termine en médiane à 0,65 s, Medium à 1,02 s et Large à 1,19 s ; la rapidité ne compense pas ces erreurs pour ce type de calcul. Les réponses Mistral Large et Medium signalent l'alias latest ; le snapshot interne exact n'est pas confirmé dans leur flux.

Pour Sonnet 5, la médiane est 2,46 s et la moyenne 2,45 s. Gemini 3.8 Flash affiche une médiane légèrement meilleure (2,38 s), mais une moyenne plus lente (2,91 s) à cause d'une réponse à 4,56 s. Il serait donc abusif de le qualifier de systématiquement plus rapide. Gemini 3.1 Flash Lite et 3.5 Flash Lite terminent autour de 0,91 et 0,93 s ; Luna autour de 2,76 s, avec des tarifs sensiblement inférieurs à Sonnet.

Les Opus, Fable, Sol et Astra ont donné les bonnes valeurs mais aucun avantage de justesse n'est démontré ici face aux options économiques. Les appels d'Astra utilisent le texte de Chat Completions ; les outils, qui demandent Responses pour ce modèle, ne sont pas validés par cette campagne.

## Prix et lecture des coûts

Sources officielles consultées le 13 septembre 2026 : [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), [Gemini](https://ai.google.dev/gemini-api/docs/pricing) et [Mistral](https://mistral.ai/pricing/api/).

Le tarif promotionnel de Gemini 3.8 Flash est valable jusqu'au 31 décembre 2026 ; le code conserve la bascule vers 1,50 / 7,50 USD/M ensuite. Le tarif Sol est annoncé au moins jusqu'au 21 novembre 2026. Gemini 3.1 Pro reste explicitement étiqueté Preview. Les tarifs changent : ces montants sont datés, pas un engagement futur.

Les coûts affichés par le comparateur sont des **estimations des tokens visibles**, avec conversion fixe 0,92 EUR/USD. Ils excluent notamment le raisonnement, le prompt système et les effets réels du cache ; ce ne sont pas les montants débités du compte Arty ou facturés par le fournisseur. Une valeur « < 0,0001 € » n'est pas zéro. Les anciens coûts Sonnet de la première série utilisaient encore l'ancien tarif ; ils ne servent pas à comparer les économies. Aucun rapprochement avec une facture réelle n'est revendiqué.

## Intégration et corrections livrées

Sept choix ajoutés : Opus 5, Fable 5.1, Gemini 3.8 Flash, Gemini 3.1 Pro Preview, GPT-5.6 Luna, GPT-5.6 Sol et GPT-6 Astra. Les modèles par défaut restent ceux de l'application. Les versions Mistral récentes étaient déjà représentées dans le catalogue.

Les tarifs Sonnet 5 et Terra sont actualisés ; les nouveaux tarifs, seuils de contexte long, lectures et créations de cache sont traités dans les chemins modifiés de calcul et de réservation. Le parseur OpenAI distingue aussi les écritures de cache. Gemini convertit l'ancien niveau de réflexion minimal en low sur les nouveaux modèles concernés.

Deux corrections découvertes sur le téléphone ont été intégrées :

- Les identifiants de réponse datés de GPT-5 et GPT-5 Mini sont reconnus ; le coût apparaît maintenant dans les deux panneaux. Les snapshots sont confirmés par les fiches officielles [GPT-5](https://developers.openai.com/api/docs/models/gpt-5) et [GPT-5 Mini](https://developers.openai.com/api/docs/models/gpt-5-mini).
- Une limitation Mistral était faussement classée comme crédits épuisés. La classification financière est maintenant séparée du filtre de confidentialité : les détails du compte restent masqués, le statut 429 reste visible et les reprises prévues fonctionnent. Vérifié sur le téléphone : Small et Medium affichent une limite de requêtes après les deux reprises.

## Incident Mistral résolu

Les premiers journaux du téléphone indiquaient **Small et Medium : HTTP 429, rate_limited, code 1300** ; **Large : HTTP 403, tier_not_allowed, code 1910**. Ces refus sont conservés séparément des réponses évaluées et leurs durées sont exclues du classement de rapidité.

L'activation de l'accès API par le propriétaire a été vérifiée avant la reprise. Les neuf appels Mistral suivants ont tous reçu une réponse, en testant un seul panneau Mistral à la fois. La distinction entre crédits et niveau d'accès est documentée par [Mistral](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them). Les erreurs numériques observées ensuite sont donc distinctes des refus d'accès initiaux.

## Validation et livraison

- Série complète sur le premier candidat f34ee827 : **405 fichiers, 5983 tests réussis, 1 ignoré**, avec couverture et concurrence limitée à deux workers.
- Après les alias de snapshots : **88 tests ciblés réussis**. Après la classification : **42 tests sur cinq fichiers réussis**, puis les **16 tests du classificateur final** réussis après l'ajout du cas de priorité au code structuré.
- Vérifications TypeScript source et serveur réussies, compilation web réussie. Android lint et tests unitaires validés sur le candidat initial ; assemblage final signé réussi. Contrôles Gmail sans CASA, add-on phase 0 et export Office réussis.
- APK Android **1.0.106 / code 107** installé, signature identique à l'application précédente. SHA-256 final : 677d74ee1b3c96187be514cf3f6ce6d9b740cc88993175bec00f9380a4f8834c.
- Serveur et web déployés en production sur le commit **0f632c4832fdbd15233764dd791ac529fc46f85d**, déploiement **78c767d0-440b-45ab-a15f-aea5cc94f659**. Domaine public vérifié HTTP 200 et bundle correspondant.

La première série Haiku/Opus 4.8/Gemini 3.5 utilisait l'APK 1.0.103 ; les nouveaux modèles et la nouvelle série Sonnet utilisent 1.0.106. Les deux derniers correctifs ont été vérifiés séparément dans les panneaux concernés. La campagne principale n'a pas été rejouée intégralement après ces changements ciblés. Les sources sont sur codex/model-refresh-20260913 ; fusion et distribution Firebase générale restent distinctes de l'installation vérifiée sur ce téléphone.
