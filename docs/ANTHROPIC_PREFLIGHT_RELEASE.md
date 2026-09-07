# Anthropic — validation du transport avant débit

## Périmètre et état

Candidat du 7 septembre 2026, basé sur main `69dd37e` (PR493).
Pas encore livré à ce stade. Deux contre-revues indépendantes en lecture seule
ont été intégrées avant et pendant le développement. Vérification complète,
CI, déploiement et recette publique restent requis avant livraison.

Le handler `/api/ai/proxy` authentifie d'abord, lit une seule fois le JSON,
puis seulement vérifie/consomme les droits. Les refus de ce précontrôle ne
débitent ni essai Google/OTP, ni quotas, ni crédits, et ne lancent pas les
nettoyages/compensations du wallet. Aucune compensation n'est nécessaire pour
ces refus. Le plan est résolu après la lecture : aucun nouveau peek de plan
suivi d'un débit fondé sur une classe potentiellement périmée.

## Contrat explicite

- Maximum **32 000 000 octets réellement reçus**. Content-Length n'est qu'un
  raccourci de refus ; absence ou sous-déclaration ne contourne pas la borne.
  La documentation [Anthropic](https://platform.claude.com/docs/en/api/errors)
  annonce 32 MB, pas une valeur attestée de 32 MiB.
- JSON racine objet, EOF réel exigé ; UTF-8 fatal. Refus 400 des syntaxes
  invalides, racines multiples, propriétés dupliquées, clés `__proto__`
  (même échappées), nombres non finis et surrogates échappés orphelins.
  Ces dernières formes peuvent être acceptées par JSON.parse : leur refus
  supplémentaire est intentionnel, pas une préservation annoncée de tout JSON.
- Maximum 64 niveaux, 50 000 tokens syntaxiques et 128 caractères par scalaire
  non-string ; dépassement 413 `payload_too_complex`. Ce sont des limites de
  structure Arty, pas des limites de tokens IA.
- Flux découpé en fragments de 4096 octets avant tokenisation ; buffers de
  chaînes et de nombres explicites. Le parseur n'émet que la racine, sans
  copies répétées de parents. Aucune string JSON brute géante n'est conservée.
- Un objet est transformé par les règles existantes, puis sérialisé une fois
  avant fournisseur. La copie racine du candidat wallet évite de modifier le
  véritable Free lorsque le wallet n'est pas utilisé.
- Formats actuels conservés : images/PDF base64, résultats d'outils imbriqués,
  recherche native, outils personnalisés, cache et blocs signés. Substitution
  Sonnet→Haiku et suppression des options déjà incompatibles restent identiques.
  BYOK/abonnés/VIP/crédits conservent les règles de financement précédentes.
- Après identité valide, un corps rejeté a désormais priorité sur les anciennes
  réponses clé manquante / essai épuisé. Les requêtes valides gardent ces réponses.
  Annulation pendant lecture ou constatée à sa sortie : aucun débit du handler.

## Limites non closes par ce lot

Ce n'est ni le schéma complet Anthropic, ni un contrôle du contenu binaire, ni
une enveloppe financière. Les modèles par famille, en-têtes beta, nombre de
recherches natives, coût cumulé, tokens/cache et modalités restent à borner
dans le raccord financier dédié. Le budget global est toujours dormant.

La borne d'entrée n'est pas une garantie de taille du JSON **final** : nombres
normalisés, modèle substitué ou défaut wallet peuvent l'agrandir. Un JSON objet
accepté peut encore être refusé par le fournisseur et consommer un essai.
Le cas valide sans clé serveur et les compensations après admission restent
également ouverts. Ne pas annoncer « tout échec non servi est remboursé ».

La mémoire [Workers](https://developers.cloudflare.com/workers/platform/limits/#memory)
est partagée dans l'isolate. Réduire les copies et borner chaque demande ne
prouve pas un plafond RAM global sous une concurrence arbitraire. Les tests
workerd ci-dessous sont des exécutions, pas une mesure de pic mémoire.
Pas de nouveau sémaphore global, donnée collectée, secret, dépendance,
configuration distante ou migration. Pas d'affirmation d'unicité humaine.

## Preuves et contre-revues

- Tests parser/align initiaux : 48/48 PASS. Canaris racines tardives,
  UTF-8 coupé octet par octet, surrogates, prototypes, valeurs non finies,
  exact plafond, dépassement réel, structure dense et annulation.
- Workerd local : 43/43 PASS avec suite parser ; corps exactement 32 MB
  lu et réémis, deux requêtes simultanées de taille pièce jointe 11 MB avec
  Unicode, structure dense et longue fraction finie refusées.
- Premier lot handler/D1 : 202 PASS, 1 FAIL dû à une attente de test erronée
  (8192 est le défaut wallet, pas son plafond ; un max_tokens demandé de
  64000 était déjà conservé). Assertion corrigée, comportement non modifié.
- Matrice D1 : 49/49 PASS, huit financements, absence d'admission SQL et
  de background sur refus, compteurs durables, contenu/en-têtes réellement
  reçus par le faux fournisseur, transformation Sonnet selon financement.
  Deux canaris supplémentaires Free/wallet sans max_tokens ajoutés ensuite ;
  leur résultat sera attesté dans la vérification complète.
- Objections intégrées : vrai EOF, petit fragment avant queue tokenizer,
  prototype/doublons, nombres finis et longueur lexicale, UTF-8/surrogates,
  copie wallet, absence de seconde lecture/parsing, annulation après lecture.

Les fixtures et fournisseurs sont synthétiques, uniquement locaux. Aucun
message payant, solde privé, session mobile ou événement financier distant
n'est utilisé comme preuve.
