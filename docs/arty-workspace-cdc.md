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
| W01 | Fondations | DOCX : paragraphes et tableaux ; XLSX : feuilles nommées et cellules identifiées. Contenu réellement injecté, accents conservés ; erreurs visibles sur ancien format, fichier chiffré/corrompu ou limite dépassée. Même résultat en nouvel envoi, historique et retry, dont Android et mode Europe. Aucun macro, formule, lien externe exécuté ; ressources bornées ; aucune pièce jointe en base64 dans localStorage. | Code et deux contre-revues OK ; livraison et recette appareil en cours |
| W02 | Confiance | Essai annoncé conforme au plan servi. BYOK gratuit distinct du Pro optionnel ; conseiller sans licence fictive. Promesses de stockage et de transit exactes FR/EN, page publique cohérente. Aucun quota ni accès serveur élargi implicitement. | Web déployé, PR #437 ; recette visuelle/appareil non vérifiée |
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

### W02 — offre et BYOK

- PR [#437](https://github.com/flotellop-art/Arty/pull/437), squash main
  `54a865a040d77a784a862370808673c907284b67`, 5 septembre 03:02 UTC.
- CI PR complète verte (web, Android, orchestrateur), Pages production succès
  `731ad10b-56a3-42df-be57-b9b9587bb3a5`. Vérification HTTP de
  `https://tryarty.com/lp/essai/` : 200, offre Haiku présente, ancienne mention
  Gemini absente ; SPA servie avec `index-YY_3JNd8.js`.
- CI supplémentaire main : flakiness D1 préexistante constatée sur le même
  arbre Git exact que la PR verte (getter wallet limité à 250 ms et appels
  quota concurrents fail-open). Correctif uniquement tests en PR
  [#438](https://github.com/flotellop-art/Arty/pull/438), 24 tests D1 locaux
  verts, deux contre-revues et CI web/Android/Pages verte. Fusion main
  `bf82ff38340a600e3f608cdf54e428e6ebe3d024` à 03:38 UTC. Aucun quota/deadline
  de production modifié.
- Build/distribution Android CI a réussi ; cela ne prouve ni installation
  sur téléphone ni validation Store. Inventaire navigateur de contrôle vide
  à deux reprises ce jour : recette visuelle non effectuée.

### W01 — lecture locale Office, lot en livraison

- Lecteur ZIP/OOXML borné, sans réseau ni moteur Office : DOCX corps/tableaux,
  XLSX feuilles/cellules/formules textuelles et caches typés. Formules jamais
  évaluées ; caches manquants/stales et dates brutes explicites. Racine et
  relations de parties vérifiées ; document non canonique ou ambigu refusé.
- Budgets par requête effective entière : 20 Mio source agrégée, 10 Mio par
  fichier, 2 Mio XML accepté par partie/6 Mio total, 100 000 nœuds/attributs,
  256 attributs par élément, 200 000 caractères (shared strings incluses),
  20 000 cellules, 32 feuilles. DEFLATE contrôlé sur les octets réellement
  produits et CRC réel ; précontrôle avant DOM. Le chunk de décompression
  peut dépasser transitoirement le seuil : 2 Mio n'est pas une garantie de
  pic mémoire exact. Mesure sur WebView réelle encore à faire.
- Parsing avant persistance, dérivés éphémères, originaux chiffrés en IDB ;
  échec/Stop laisse le fil intact. Owner/epoch capturés, contrôle jusque dans
  les headers réseau, sauvegardes partielles et finalisation. Édition/retry
  atomiques. Historique Office interdit locator Terra et route texte-only ;
  Claude hors EU, Mistral en EU, même pour un tour suivant sans pièce jointe.
- Fil Office explicitement lecture seule : pas d'outils, recherche publique,
  compression cloud, géolocalisation, fact-check/récupération de liens,
  mémoire ou tâches automatiques. W08 devra proposer une transition explicite
  et confirmée pour agir ; un prompt dans un document ne lèvera pas ce verrou.
- Deux GO indépendants après corrections des attaques ZIP/XML, confusion de
  namespaces/relations, révisions et AlternateContent, Ruby/phonétique,
  formules partagées, annulation tardive, sauvegardes cross-session et effets
  post-réponse. Tests vrais clients avec `fetch` simulé, pas d'appel payant.
- Fixtures synthétiques émises par python-docx 1.2.0 et openpyxl 3.1.5
  (`scripts/generate-office-fixtures.py`), plus fixtures adversariales.
  Aucun document personnel utilisé. 48 tests d'extraction verts ; suite
  finale du lot : 206 fichiers / 2 090 tests, typecheck front/back,
  couverture, build et no-CASA réussis. 13 tests de cycle Office et 5 tests
  des vrais clients/post-traitements avec réseau simulé. CI à suivre en PR.
- Formats exclus : DOC/XLS, macros, chiffrement, révisions/alternatives Word,
  parties principales non canoniques. Pas de reconstruction du rendu, images,
  annotations, entêtes/pieds, styles de dates ou graphiques. Erreurs FR/EN et
  périmètre visibles dans le composeur. Compatibilité binaire Android à
  compiler en CI ; interaction réelle mobile non vérifiée.
- Audit npm au démarrage : 13 avis sur des dépendances déjà présentes, aucun
  sur fflate ajouté en version 0.8.3. Aucun `audit fix --force` ; traitement
  ciblé à prévoir avant de conclure le CDC global.

### Repli du lot W01

Revert Git de la PR via la chaîne Pages habituelle. Aucun schéma/migration de
données ; originaux conservés. Ne pas remplacer un échec de lecture par un
faux texte analysé. Un APK déjà installé reste son bundle local jusqu'à mise
à jour ; pas de contournement OTA du client natif.

### Repli du lot W02

Lot client/texte uniquement, sans migration ni mutation des données. En cas de
régression : revert Git de la PR puis déploiement Pages par la chaîne habituelle.
Ne pas rétablir l'ancienne affirmation de confidentialité comme « fix » ; couper
temporairement la carte du conseiller si elle est la cause. Les binaires Android
existants restent inchangés tant qu'un nouvel APK n'a pas été installé.
