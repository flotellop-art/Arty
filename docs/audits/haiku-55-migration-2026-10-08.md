# Migration Haiku 5.5 — 8 octobre 2026

Mission autorisée : remplacer le petit Claude par Haiku 5.5 après la nouvelle
comparaison fournisseur. Branche `codex/haiku-55-migration-20261008`, issue de
`origin/main` `7abcaa416ca0ea49ed771e7dc58bc0c45bab19f5`. Les changements de
recherche ou lecteurs des autres branches restent hors de cette livraison.

## Choix et comportement

Le [benchmark figé](../evaluations/2026-10-08-small-model-competence.md)
observe 40/40 contrats complets pour Haiku 5.5 adaptive/low sur 20 dossiers
univoques répétés deux fois. Ce résultat délimité justifie la promotion ;
il ne mesure pas toute l'application ni toutes les capacités du fournisseur.

Le chat, le comparateur, le brief proactif et le premier niveau du fact-checker
utilisent désormais `claude-haiku-5-5`, adaptive/low, sans sampling.
La substitution serveur des appels premium en essai impose le même effort low.
Le routage des tâches Sonnet/Opus reste inchangé.
L'amélioration du prompt et l'extraction de mémoire, sans outils, utilisent
disabled/low avec 650 et 520 tokens respectivement, pour conserver environ
la capacité texte antérieure avec le nouveau tokenizer.
Les refus, troncatures et extractions dont l'identité ne correspond pas sont
rejetés ; un `pause_turn` serveur poursuit avec les blocs assistant intacts,
dans la limite existante de 30 itérations. L'épuisement de la boucle signale
une réponse incomplète.

## Coût et quotas

Prix USD/MTok : entrée 0,10, sortie 0,50, lecture cache 0,01, écriture 5m 0,125.
Au-delà de 100 000 tokens de prompt, toutes ces composantes sont multipliées
par cinq, pour toute la requête. Le seuil comprend les tokens frais, lus et
écrits en cache ; le suivi local reçoit ce total indépendamment de l'entrée
pondérée utilisée pour calculer le coût.
Arty normalise les TTL 1h en 5m avant la réservation, y compris dans les
résultats d'outils et documents imbriqués. Le tarif 1h n'est pas proposé ici.

Les compteurs d'admission Haiku 4.5 alias, 4.5 daté et 5.5 sont partagés ;
la limite explicite 5.5 prévaut, sinon la limite historique est héritée.
Les lignes comptables et prix 4.5 demeurent distincts. Free conserve son
plafond familial 10/jour ; les caps auxiliaires ne changent pas.
Les requêtes explicites d'anciens clients 4.5 et les historiques restent
compatibles : la mise à jour du client apporte le nouveau défaut.

## Preuves fournisseur

`scripts/smoke-haiku55.mjs` appelle les véritables handlers et le client
enhancer, avec frontières d'authentification synthétiques et D1 local workerd,
puis la vraie API Anthropic. Six cas auxiliaires sont figés et répétés deux
fois, suivis d'un aller-retour d'outil : 14 appels réels, 13 contrôles réussis.
Le protocole SHA-256 est
`4a9f0a67c052eb26a1c4d76a6526d55eef921bc3eb2feeeee8b753bd7cd66459`.
Preuves brutes locales ignorées par Git :
`.playwright-mcp/haiku55-smoke/evidence.json` et `protocol.json`.
Les clés et en-têtes fournisseur ne sont jamais persistés.
SHA-256 du fichier de preuves :
`5e40392b79acabc73858b81626968ed30b07852c2679f8ea191379bbcb022212`.
Usages cumulés : 13 442 tokens d'entrée, 4475 de sortie, soit environ
0,003582 USD au tarif public court ; ce montant est une estimation, sans facture.

Les 14 réponses confirment exactement Haiku 5.5 : 13 `end_turn`, un
`tool_use`. Mémoire : préférences explicites conservées, remplacement de
l'ID transmis, informations sensibles exclues. Enhancer : entrée dense
reformulée sans troncature. Fact-check : dix affirmations fictives et sans
preuve restent `uncertain` aux deux passages ; 1297 et 1709 tokens de sortie
dans le budget 3000, latences 5,0 et 6,7 secondes.
L'outil additionne 13 et 29 puis restitue 42. Ce smoke n'a pas produit de bloc
thinking signé ; leur préservation est attestée par les fixtures SSE.

Le premier passage du harnais a rencontré un 403 avant l'appel fact-check
car son identité synthétique n'avait pas l'abonnement requis. Le fixture
d'abonnement a été ajouté et seuls les cas restants ont repris ; les cinq
appels déjà réussis sont conservés. Aucun retry fournisseur ni fallback.

Deux contre-revues indépendantes, transport et facturation, ont précédé le
code puis examiné le diff. Leurs objections pertinentes ont été intégrées :
effort, budgets courts, parsing par type, pauses, seuil cache réel et TTL
imbriqués.

## Validation et livraison

La campagne ciblée initiale passe : 13 fichiers, 430 tests. Types, garde OAuth
public, manifeste add-on, build web et worker Office passent.
La première CI complète sur `ae8d1ede` passe 6107 tests, échoue sur deux
attentes encore 4.5 (libellé du comparateur et thinking fact-check), et ignore
un test. Les deux attentes sont corrigées ; les 60 tests des deux fichiers
passent localement. La CI du candidat corrigé constitue le gate final.
La campagne Windows complète a été interrompue après ce diagnostic CI ;
elle ne constitue pas une validation complète acquise.
Android lint/tests/compilation/permissions et le service secondaire passent
sur ce premier candidat. L'aperçu Cloudflare sert bien le défaut 5.5 et la
version 1.0.112. Aucun téléphone réel ni distribution APK n'est déduit de ces
preuves.
Version préparée : 1.0.112, code Android 113.

Contrôle vision complémentaire direct API, distinct du benchmark de sélection :
image synthétique 10/20/30, deux lectures exactes et somme 60, modèle 5.5
et fins normales attestés. Les deux réponses entourent le JSON de Markdown :
2/2 sur les valeurs, 0/2 sur le format strict. Une première tentative avait
échoué dans le parseur du harnais avant sauvegarde brute ; elle reste non
notée sur les valeurs. Après ce constat, la capture précède la notation et
la récupération de l'enveloppe est une mesure secondaire, pas un succès strict.
Protocole SHA-256
`1bacb19614ccfb6d7b7c779f88cd31fdb9bde81163878d7559b426ee8c68bf07`,
preuves locales `.playwright-mcp/haiku55-vision-evidence.json`.
Ce contrôle ne valide ni l'OCR de documents réels ni la chaîne Android.

Retour arrière : revenir au défaut Haiku 4.5 et à son transport legacy ;
conserver la tarification 5.5 et les quotas partagés pour les clients déjà
mis à jour. Ne pas effacer ni recalculer les coûts historiques.

Sources officielles consultées le 8 octobre :
[guide de migration](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide),
[tarifs et spécifications](https://platform.claude.com/docs/en/models/haiku-5-5/overview),
[thinking](https://platform.claude.com/docs/en/build-with-claude/thinking),
[fins de réponse](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).
