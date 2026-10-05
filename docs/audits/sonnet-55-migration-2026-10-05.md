# Sonnet 5.5 et provenance des recherches — 5 octobre 2026

## Candidat et périmètre

Branche `codex/sonnet55-provenance-20261005`, créée depuis
`origin/main@7ff45900fd2de7a2c8633039c65bf407a414d173` (Arty 1.0.105).
Le correctif de provenance de la recherche hybride est porté par
`d016bbf07a566e8371f4756c7390115a1fafddf6`, avec les gardes de session et
les reçus d'accès du main conservés. Le checkout original et ses changements
utilisateur restent préservés.

Résultat attendu : Sonnet 5.5 utilisé dans les chemins Sonnet configurés,
attribution explicite du contexte ajouté par Arty, transport compatible,
pas de deuxième plafond journalier à la migration, tarifs courants cohérents.

## Changements

- ID live `claude-sonnet-5-5` : chat, comparateur, compression et vérification
  factuelle, y compris la contre-vérification documentaire indépendante.
- Appels rapides/imposés/documentaires et compression : `between_tools`,
  effort `medium`. Analyses approfondies : `adaptive`, effort du routeur et
  `display: omitted`. Les statuts d'outils restent visibles ; les notes de
  réflexion entre outils ne sont pas affichées comme réponse utilisateur.
- Préfixes de conversation et blocs signés conservés pendant les outils.
  Un refus explicite ou une troncature ne déclenche pas une fin réussie.
  Le texte partiel refusé est retiré du stockage et du contexte suivant ;
  les images déjà générées sont conservées.
- Tarifs courants 5 et 5.5 : 2/10 USD par million de tokens, lecture de cache
  0,20 USD, écriture 5 minutes 2,50 USD. Les montants historiques persistés
  ne sont pas recalculés ; les anciens messages restent étiquetés Sonnet 5.
- En quota journalier par modèle, admission sur la somme Sonnet 5 + 5.5.
  La limite 5.5 explicite prime, sinon la limite 5 est reprise. Comptabilité
  et remboursements restent sous l'ID réellement servi. Le contrat de statut
  expose `quotaCount` séparément du nombre d'appels attribué à chaque modèle.
- Les plafonds premium, trial et vérification de fond sont conservés.

## Objections examinées

Deux agents indépendants ont challengé transport et facturation en lecture
seule avant les modifications et après le diff. Leurs objections sur la
réflexion activée par défaut, les budgets courts, le relais du compteur API
et le texte partiel refusé ont été intégrées. `stop_details` n'est pas
nécessaire au refus générique ; aucun fallback par catégorie n'est ajouté.

Le quota quotidien conserve son comportement existant en cas de panne D1 :
la requête est admise si la base est indisponible. La garantie de compteur
partagé suppose donc une lecture D1 réussie. Des requêtes concurrentes à
la dernière unité peuvent être refusées de manière conservatrice ; elles
ne gagnent pas un deuxième plafond.

## Vérification fournisseur réelle

Appels directs vers `api.anthropic.com/v1/messages`, avec la clé déjà présente
dans l'environnement, sans l'enregistrer dans les preuves :

- SSE `between_tools`/`medium`, 128 tokens maximum : HTTP 200, modèle confirmé
  `claude-sonnet-5-5`, `end_turn`, réponse `OK.` à la consigne `OK`.
- SSE `adaptive`/`omitted`/`high`, 768 tokens maximum : HTTP 200, modèle confirmé,
  calcul 17 × 19 = 323 correctement rendu, `end_turn`.
- Trois appels SSE avec outil synthétique `lookup`, configuration stable et
  historique ajouté à la suite : HTTP 200 à chaque appel ; `tool_use`,
  `tool_use`, puis `end_turn`. Le fournisseur a demandé un outil par tour.

Ces petits essais n'ont émis aucun bloc de réflexion. La conservation des
signatures et blocs vides est vérifiée par les tests de transport simulés.
Les essais directs ne prouvent ni le parcours authentifié Arty en production,
ni l'intégration Android, ni l'absence générale d'hallucinations.

Les tests ciblés initiaux ont réussi (276 tests), puis 134 tests ciblés après
contre-revue et correction des attentes périmées. La CI complète du candidat
`ca0d6ea01524e23df10a19d45449077903ebea95` réussit : 409 fichiers, 5 986 tests
réussis et un ignoré, types, couverture, build, scopes Google, worker Office
et contrôles Android.

La publication a été explicitement demandée le 5 octobre. Firebase confirme
en lecture authentifiée que la dernière version distribuée est 1.0.105/code
106 (`5i1dajfnpgj6g`, 13 septembre). Le candidat de livraison est donc
versionné 1.0.106/code 107 dans package, lock et Gradle, avant fusion. La
fusion sur main déclenche le workflow Firebase existant ; ne pas démarrer
une seconde distribution concurrente. Les reçus de déploiement web et APK
restent distincts d'une installation physique sur les téléphones.

Après diffusion de l'APK, un retour arrière doit préserver les tarifs 5.5
et le quota partagé. Un rollback complet vers l'ancien backend ne couvre
pas les nouveaux clients : il peut traiter leur ID 5.5 comme inconnu et
appliquer un tarif de repli inadapté. Préférer un revert ciblé du routage ou
du transport en conservant la compatibilité et la facturation du nouvel ID.

## Sources officielles

- https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
- https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/build-with-claude/preserved-thinking
- https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals

Sol 6.1 et son adaptation Responses ne font pas partie de ce lot.
