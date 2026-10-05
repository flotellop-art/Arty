# Confusion de provenance dans la recherche hybride Arty

Mission : expliquer le cas exporté sur les inégalités salariales et corriger le
transport qui attribue une recherche interne à l'utilisateur. Critère de fin
local : question et pièces jointes préservées, provenance explicite, synthèse
Gemini sans sources exploitables refusée, contrôles de transport réussis.

Branche : `codex/hybrid-research-provenance-20261005`.
Base : `56b1fdb4b9188abdbbb4da72f1127180cbf0ad18`.
Deux contre-revues indépendantes en lecture seule ont été examinées avant
l'implémentation puis sur le correctif. Les autres changements présents dans
le dossier sont conservés et ne font pas partie de cette mission.

## Diagnostic et limites de preuve

L'export fourni contient une seule question humaine avant la réponse Sonnet 5.
La mention d'un document ou d'un bloc Gemini collé par l'utilisateur est fausse.
La route AUTO peut néanmoins faire une recherche Gemini en arrière-plan :
`aiRouter.ts` reconnaît « analyse les données », puis `resolveRoute.ts` choisit
le chemin hybride si Gemini est disponible. Ce chemin ajoutait sa synthèse dans
le texte du dernier message `user`, sous l'étiquette « données Gemini, à jour ».
C'est une cause probable précise, sans trace runtime de ce tour pour la confirmer.

L'export omet l'enrichissement interne et les résultats des outils. Il ne prouve
donc ni l'absence de recherche ni l'invention du rapport. `generate_report`
construit réellement un lien depuis l'origine de l'application ; localhost est
compatible avec Android. La réponse Luna reconnaît la fausse attribution mais
ne dispose pas de preuve pour déclarer également les recherches et le rapport
inventés. Le rapport stocké et les appels de ce tour restent non vérifiables.

Les trois chiffres Insee sont exacts pour le secteur privé en 2024 : 21,8 % en
revenu salarial, 14,0 % en EQTP et 3,6 % pour un même emploi dans un même
établissement. Publication du 26 février 2026, consultée le 5 octobre 2026 :
https://www.insee.fr/fr/statistiques/8743657
Ce contrôle ne certifie pas toutes les autres affirmations de la réponse.

## Correction locale

- La recherche est une option propre au stream ; le message humain n'est plus
  remplacé. Ses blocs et pièces jointes restent présents.
- La politique de provenance fixe est dans le système. Le résumé externe et
  les URLs fournisseur restent des données dans un bloc de contexte distinct
  du texte humain. L'objection à placer le résumé dans le système a été retenue
  pour éviter d'augmenter l'autorité des instructions externes.
- Une synthèse Gemini exige un résultat complet et une source HTTP(S) dans les
  métadonnées fournisseur. Les URLs avec identifiants et les pensées sont exclues.
  Sans résultat exploitable, le contexte dit explicitement `unavailable`.
- Les sources retournées ne certifient pas les affirmations ni leur actualité.
- Les modes documentaire et comparateur excluent ce contexte. Le routage reste
  calculé sur la question originale. Les gardes Stop/session sont conservées.
- La règle commune distingue attribution erronée et exécution non vérifiable.

Le bloc reste dans le rôle API `user` avec sa provenance explicite. Les tests
de transport ne prouvent pas que le fournisseur ne reproduira jamais l'erreur.
Les enrichissements PDF/pages Europe ne passent actuellement pas par cette
branche ; TikTok est déjà inclus dans les messages préparés. Un futur ajout
uniquement dans `outgoingText` devra préserver cette propriété.

## Modèles récents

Sonnet 5.5 est le premier candidat pour le rôle Claude. Les tarifs officiels
annoncent 2 dollars en entrée et 10 dollars en sortie par million de tokens.
Sa migration présente des changements de thinking, de tool use et de streaming :
https://platform.claude.com/docs/en/models/sonnet-5-5/overview
GPT-6 Luna est un candidat pour le volume ; GPT-6.1 Sol pour les tâches plus
exigeantes, après adaptation du transport et évaluation sur les mêmes cas :
https://developers.openai.com/api/docs/models/gpt-6-luna
https://developers.openai.com/api/docs/models/gpt-6.1-sol
https://developers.openai.com/api/docs/guides/function-calling

Aucun modèle, tarif ni quota n'est changé par ce correctif. Une migration doit
mettre à jour transport, catalogue, facturation, outils et tests ensemble.

## Validation et reprise

Les 17 nouveaux tests passent : prompt exact via le hook et transport Anthropic
réel avec HTTP simulé, sources Gemini présentes/absentes/invalides, pensée ou
réponse tronquée, échec HTTP/réseau, fichiers, modes restreints, streams concurrents
et arrêt/session pendant la recherche. Les 32 contrôles existants Gemini,
Anthropic, origine des rapports, TikTok et synthèse documentaire passent aussi,
soit 49 tests ciblés au total. `npm run typecheck` et le contrôle de diff passent.

Non livré : publication, déploiement, distribution Android et essai fournisseur
sur ce correctif. Aucun taux d'hallucination amélioré n'est revendiqué.
Prochaine action de livraison : reproduire la question sur le candidat déployé
avec le modèle servi et les résultats de recherche/rapport réellement observés.
Hors périmètre conservé : persistance des reçus d'outils entre modèles et
vérification du contenu HTML des rapports par le fact-checker.
