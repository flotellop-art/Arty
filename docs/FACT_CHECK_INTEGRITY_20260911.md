# Fact-checking : intégrité des résultats et corrections

Lot autorisé le 11 septembre 2026 : validations trompeuses, remplacements
automatiques dangereux et couverture silencieusement limitée.
Branche `codex/fact-check-integrity-20260911`, base
`9d01e34e81d3e228c2bf41dfdcccd4cfc957d6cd` de `origin/main`.

## Résultat

- Un format invalide, un tableau à la place du résultat, une fin interrompue
  ou une confiance basse sans conclusion correspondante ne devient plus un
  succès vert. Un résultat vide explicite, cohérent et terminé reste accepté.
- La fin du fournisseur et la présence de sources web sont attestées par le
  serveur. Les citations web Anthropic restent reconnues quand les résultats
  bruts sont exclus. Gemini doit fournir une source web structurée avec URL
  HTTP(S) valide ; une requête seule ou un objet vide ne suffisent pas.
- Une recherche nécessaire échouée, un quota de seconde passe épuisé, un
  secours sans recherche ou une fin non attestée produisent un résultat partiel.
  Des sources de première passe ne masquent pas l'échec de la seconde.
- Seul un passage unique d'au moins dix caractères peut être remplacé dans
  du texte. Code, liens, URL, chevauchements et ambiguïtés restent protégés.
  Les corrections utilisent toutes la réponse originale, sans cascade.
  La structure Markdown/GFM doit rester identique ; sinon les propositions
  restent visibles sans modifier le texte. Les décalages Unicode sont couverts.
- Un résultat partiel n'applique aucune correction automatique. Ses propositions
  sont affichées en ambre comme des propositions à vérifier.
- Les 6 000 caractères transmis et le plafond de dix points sont explicités.
  Cette mesure décrit le texte fourni au vérificateur, sans prétendre que chaque
  caractère a effectivement été vérifié. Ces limites survivent aux sauvegardes
  et à la synchronisation.

## Validation

- Deux contre-revues indépendantes en lecture seule ; objections sur les sources,
  la confiance, Unicode, Markdown et la persistance intégrées et revérifiées.
- `npm run typecheck` : réussi pour le client et les fonctions serveur.
- `npm test -- --maxWorkers=2` : 5 685 réussites, un test ignoré, deux échecs
  par dépassement de 5 000 ms dans `d1.subsidizedBudget.test.ts` (384 fichiers).
  Le code et les tests de ce budget sont identiques à la base du lot.
- Recontrôle des deux tests de concurrence D1 avec `--maxWorkers=1
  --testTimeout=15000` : deux réussites. Aucun changement de leurs assertions
  ni des délais du produit. La campagne complète initiale n'est pas déclarée verte.
- Après les derniers ajustements de parsing et d'affichage : 402 tests ciblés
  réussis, un ignoré, dans 17 fichiers (fact-checking, affichage, sauvegarde et
  chemins de synchronisation concernés). La suite complète n'a pas été relancée.
- `npm run build`, contrôle du worker d'export Office, manifestes de l'add-on
  et contrôle des autorisations Google : réussis. Le build garde son avertissement
  de taille de certains fichiers JavaScript.

## Livraison et limites

Ce lot est préparé pour revue ; il ne constitue pas une mise en production.
La migration de modèles, les budgets de temps, la comptabilisation complète des
coûts et l'analyse de fidélité des vidéos restent hors de ce lot.
Aucun appel payant supplémentaire ni changement de plafond n'est ajouté.

Les anciens résultats sont lisibles par le nouveau client. En revanche, un ancien
lecteur d'archives peut refuser les nouveaux champs : ce n'est pas une compatibilité
avec toutes les anciennes versions. Les clients doivent être mis à jour avec le
serveur pour bénéficier des nouveaux contrôles. Un nouveau client face à un ancien
serveur conserve un état partiel lorsque la fin ne peut pas être attestée.
Pas de test fournisseur réel payant ni de validation sur appareil Android dans ce lot.
