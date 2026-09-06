# Rapport des déclarations facultatives — Réponse client Web

État : pilote implémenté localement, **publication fermée** par
`PRODUCT_MEASUREMENT_RELEASED=false`. La préférence utilisateur est un
second contrôle, distinct : elle ne peut pas ouvrir la publication.
Voir [décision, limites et gate de notice](ADR_PRODUCT_MEASUREMENT.md).

## Ce qui est compté

Six issues déclarées par une nouvelle soumission manuelle du guide : copie
locale enregistrée, sortie vide, erreur, arrêt, copie refusée, génération non
démarrée. Une réussite n'est ni un envoi au client, ni une appréciation de la
qualité, ni un reçu du chiffrement différé. Authentification Google stricte
de la requête ; l'identité ne parvient pas au writer d'agrégats.

Une ligne commune par jour UTC, six compteurs et total ≤ 10 000. Une seule
instruction SQL admet et incrémente ; aucune réservation ou journal personnel.
Corps canonique de 256 octets maximum : version/parcours/issue/plateforme.
Le coût total d'authentification/HTTP n'est pas plafonné par ce compteur.

Population limitée : Web, compte Google, participation déjà active avant
soumission, jeton déjà prêt à l'envoi. Pas de renouvellement OAuth pour mesurer,
retry automatique, rattrapage au rechargement, import, comparaison, historique
ou continuation. Changement de compte/clé/fence, retrait, fermeture et passage
en arrière-plan abandonnent le témoin. Un POST déjà reçu peut rester compté
malgré une annulation ultérieure. Pas de déduplication serveur des replays.

Ce ne sont **pas** des utilisateurs uniques, un taux global de réussite,
une activation mesurée, des cohortes D7/D30 ou des conversions. Une date
absente signifie « aucune déclaration reçue », pas « personne n'a utilisé Arty ».
Les totaux communs n'ont ni lien individuel à supprimer ni purge automatique.

## Lecture opérateur sans réseau automatique

Générer une seule requête SELECT, début UTC inclus et fin exclue, 1 à 31 jours :

```powershell
node scripts/product-measurement.mjs sql --from 2026-09-01 --to 2026-10-01 --output rapport-produit.sql
```

La commande n'exécute rien sur Cloudflare. Exécuter la requête avec l'accès D1
autorisé habituel et conserver **son unique agrégat**, pas une copie d'autres
tables. Si le binding/table n'est pas disponible, le rapport est indisponible :
ne pas créer la table en production pour fabriquer un rapport vide.

```powershell
node scripts/product-measurement.mjs render --input agregat-produit.json --format html --locale fr --output rapport-produit.html
node scripts/product-measurement.mjs render --input agregat-produit.json --format csv --locale en --output rapport-produit.csv
```

Entrée directe ou enveloppe Wrangler contenant exactement une requête réussie
et une ligne d'agrégat ; maximum 64 Kio. Schéma, dates, entiers et sommes sont
vérifiés. JSON final n'est pas une entrée d'agrégat réutilisable. `--output`
crée un nouveau fichier uniquement ; sans cette option, sortie standard.
HTML sans script, formulaire ou ressource externe ; ne pas mélanger le
dénominateur avec le [rapport wallet](WALLET_MEASUREMENT.md).

Un import ne prouve pas sa provenance D1. L'outil ne certifie pas l'authenticité
des réponses déclarées, la représentativité, ni la conformité juridique.
