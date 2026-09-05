# Arty Workspace — cahier des charges et preuves de livraison

Date : 5 septembre 2026. Statut global : **en cours, non livré**.

## Mandat et résultat attendu

Mettre en œuvre les priorités de l'audit Arty/Mammouth du 4 septembre,
autorisé par Florent le 5 septembre (« terminer ton cahier des charges en toute
autonomie »). Ici, terminer signifie une capacité utilisable, testée et livrée,
pas seulement du code ou un bouton. Supplanter Mammouth est une ambition de
marché, pas un résultat que des tests logiciels peuvent garantir.

L'utilisateur cible est un indépendant francophone : il apporte ses documents,
travaille dans un projet, obtient un livrable modifiable, retrouve son travail
et comprend le modèle, les limites et les coûts. Aucune suppression des données
actuelles n'est nécessaire pour commencer ; les migrations sont additives.

Ce document complète le plan de juin et la roadmap d'avril. Le mandat actuel
reprend explicitement les projets et la synchronisation alors différés. Il ne
relance pas les anti-objectifs vidéo, catalogue pléthorique, prix bradé,
premium illimité, comparateur en première étape d'onboarding ou scopes Google
restreints. Aucun envoi commercial, recrutement ou abonnement fournisseur
supplémentaire n'est implicite dans ce mandat.

## Exigences et critères d'acceptation

| ID | Lot | Résultat observable et recette | État |
|---|---|---|---|
| W01 | Fondations | DOCX : paragraphes et tableaux ; XLSX : feuilles nommées et cellules identifiées. Contenu réellement injecté, accents conservés ; erreurs visibles sur ancien format, fichier chiffré/corrompu ou limite dépassée. Même résultat en nouvel envoi, historique et retry, dont Android et mode Europe. Aucun macro, formule, lien externe exécuté ; ressources bornées ; aucune pièce jointe en base64 dans localStorage. | À faire |
| W02 | Confiance | Essai annoncé conforme au plan servi. BYOK gratuit distinct du Pro optionnel ; conseiller sans licence fictive. Promesses de stockage et de transit exactes FR/EN, page publique cohérente. Aucun quota ni accès serveur élargi implicitement. | Code et contre-revues OK ; livraison en cours |
| W03 | Catalogue | Un catalogue partagé aligne comparaison, sélecteurs, labels et disponibilité réelle. Modèle demandé et modèle effectivement servi distingués. Tests contre la dérive et contre l'accès premium hors droit. | À faire |
| W04 | Projets | Créer/renommer/supprimer un projet, consignes propres, conversations associées, bibliothèque de documents réutilisables. Sources identifiables dans le contexte. Recherche bornée, absence de fichier et contexte tronqué explicites. Cloisonnement par compte et projet ; mode Europe conservé. | À faire |
| W05 | Livrables | Export DOCX modifiable et XLSX de tableaux, en plus des exports existants. Téléchargements relus par un parseur indépendant ; cellules dangereuses neutralisées ; aucun HTML actif ni formule arbitraire. Formats et limites documentés. | À faire |
| W06 | Continuité | Sauvegarde/restauration explicites puis synchronisation optionnelle multi-appareil chiffrée avant upload, avec secret détenu par l'utilisateur et récupération expliquée. Conflits non destructifs ; reprise hors-ligne ; logout/switch/delete et compte invité traités. Un export manuel seul ne valide pas la synchronisation. | À faire |
| W07 | Comparaison | Comparer depuis une conversation avec contexte/documents autorisés ; conserver les résultats et poursuivre la réponse choisie sans perdre l'original. Erreurs/coûts/quotas de chaque panneau visibles ; EU et historique privé jamais contournés. | À faire |
| W08 | Parcours métier | Trois parcours complets : synthèse documentaire, réponse client préparée, planification Agenda avec confirmation avant écriture. Écran de connexions indiquant disponible/non configuré/non pris en charge selon plateforme. Pas de Drive/Gmail OAuth restreint ni relais IMAP serveur. | À faire |
| W09 | Mobile et identité | PWA installable ; identité tryarty cohérente ; distribution Android authentifiée et documentée. Ne pas rediriger vers une app Play homonyme. Toute migration appId inclut signatures/OAuth/Firebase/liens vérifiés ; un APK distribué n'est pas une publication Store. | À faire |
| W10 | Mesure | Instrumentation minimale sans contenu utilisateur : activation, succès/échec des parcours, retour D7/D30 et conversion. Marges fondées sur coût serveur, pas un compteur local. Tableau avec période, échantillon et limites ; aucune métrique inventée. | À faire |

## Dépendances et choix de sûreté

Ordre : W01/W02 → W03/W04/W05 → W06/W07 → W08/W09/W10.
Des travaux indépendants peuvent avancer ensemble, mais les livraisons restent
petites et réversibles. W04 et W07 réutilisent le lecteur de W01 ; W06 réutilise
le format versionné des projets et ne change pas les clés de stockage existantes.

- Documents importés = données non fiables, jamais instructions système.
- Préserver les garde-fous auth, quota atomique, confirmation d'actions, EU,
  chiffrement local et PKCE déjà présents. Pas d'élargissement des scopes.
- Toute opération asynchrone capture son compte propriétaire ; un changement
  de session invalide les effets UI et n'écrit pas dans le compte suivant.
- Les stores ajoutés ont une politique explicite pour logout, switch, delete.
- Aucun secret API propriétaire dans les assets client ou les journaux.
- Les formats anciens DOC/XLS peuvent être refusés clairement avec conversion
  DOCX/XLSX demandée ; ne pas prétendre les analyser. Les données tronquées ou
  ignorées ne doivent pas être présentées comme une lecture complète.
- L'exécution distante survivant à la fermeture du navigateur est distincte de
  la sauvegarde du résultat partiel : à évaluer après le socle de continuité,
  sans la promettre avec une simple persistance du client.

## Recette et livraison

Pour chaque lot : deux contre-revues indépendantes en lecture seule avant
implémentation, objections consignées et traitées, tests de comportement et
cas négatifs, typecheck front/back, contrôles no-CASA, suite complète, build.
Vérifier les parcours significatifs en navigateur et Android si disponible.
Déploiement par Git/PR/CI/Cloudflare Pages existants, pas par contournement de CI.
Consigner commit, PR, état CI, URL/version réellement servie et repli possible.
« Testé localement » et « livré en production » sont deux états distincts.

Les validations nécessitant un tiers (Google OAuth, stores), un appareil non
accessible ou un panel utilisateur sont signalées séparément. Elles ne sont
jamais cochées à partir d'un test simulé. Continuer les autres lots lorsqu'une
validation externe attend. Aucun effacement ou achat pour débloquer sans
autorisation adaptée.

## Validation produit après livraison

Hypothèses à mesurer, non résultats acquis : premier résultat utile en moins
de 2 minutes, ≥95 % de réussite sur le jeu de recette déterministe des parcours,
puis préférence majoritaire sur un panel de 20 utilisateurs comparant les
mêmes tâches à Mammouth. Le panel et D7/D30 exigent du temps et des participants
réels ; préparer protocole et instrumentation sans fabriquer leurs résultats.

## Journal d'exécution

- 2026-09-05 : base propre `origin/main` = `314cbf3`, branche
  `codex/workspace-cdc-foundations`. Audit revalidé dans le code. Contre-revues
  Office et offre/BYOK lancées, modifications produit non commencées.
- Objection initiale intégrée au design W01 : l'extraction doit vivre dans les
  builders communs, pas seulement dans le sélecteur (partage Android, retry et
  historique le contournent). Conserver les originaux dans IndexedDB, pas de
  texte dérivé ajouté au modèle de conversation/localStorage.
- W02 : deux GO indépendants après correction de toutes les réserves : essai
  épuisé non présenté comme devenant automatiquement gratuit, liste exacte de
  modèles comparables (dont Mistral Small réellement servi), unités crédits,
  licence BYOK fictive supprimée, prix masqués sur la carte native, mentions
  du proxy alignées sur FAQ et cartes FR/EN. Aucun endpoint, prix, quota ou
  droit d'accès modifié. Conseil limité aux données texte comparables ; la
  fenêtre de 30 jours et les données invalides sont contrôlées.
- W02 : 38 tests ciblés verts (conseiller, promesses, rendu carte native,
  écran upgrade natif et verrou checkout). `npm run verify` réussi sur le
  dernier état : 203 fichiers / 2 022 tests, typecheck front/back, couverture,
  build et contrôles no-CASA. Avertissement de taille de bundle préexistant,
  non bloquant. Recette visuelle indisponible : inventaire
  de contrôle navigateur du 5 septembre vide, aucun appareil déclaré.

## Preuves par lot

Aucune livraison du présent CDC à cette date. Ajouter ici les tests, commits,
PR et vérifications de production au fur et à mesure ; ne pas remplacer les
critères d'acceptation par une simple liste de fichiers modifiés.

### Repli du lot W02

Lot client/texte uniquement, sans migration ni mutation des données. En cas de
régression : revert Git de la PR puis déploiement Pages par la chaîne habituelle.
Ne pas rétablir l'ancienne affirmation de confidentialité comme « fix » ; couper
temporairement la carte du conseiller si elle est la cause. Les binaires Android
existants restent inchangés tant qu'un nouvel APK n'a pas été installé.
