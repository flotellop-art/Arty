# Arty Workspace — cahier des charges et preuves de livraison

Date : 6 septembre 2026. Statut global : **en cours, non livré**.

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
| W01 | Fondations | DOCX : paragraphes et tableaux ; XLSX : feuilles nommées et cellules identifiées. Contenu réellement injecté, accents conservés ; erreurs visibles sur ancien format, fichier chiffré/corrompu ou limite dépassée. Même résultat en nouvel envoi, historique et retry, dont Android et mode Europe. Aucun macro, formule, lien externe exécuté ; ressources bornées ; aucune pièce jointe en base64 dans localStorage. | Web déployé, PR #439 ; recette visuelle/appareil non vérifiée |
| W02 | Confiance | Essai annoncé conforme au plan servi. BYOK gratuit distinct du Pro optionnel ; conseiller sans licence fictive. Promesses de stockage et de transit exactes FR/EN, page publique cohérente. Aucun quota ni accès serveur élargi implicitement. | Web déployé, PR #437 ; recette visuelle/appareil non vérifiée |
| W03 | Catalogue | Un catalogue partagé aligne comparaison, sélecteurs, labels et éligibilité selon le compte (pas une garantie fournisseur). Modèle demandé, transmis par le proxy et signalé par le fournisseur distingués. Tests contre la dérive et contre l'accès premium hors droit. | Web déployé, PR #440 ; recette visuelle/appareil non vérifiée |
| W04 | Projets | Créer/renommer/supprimer un projet, consignes propres, conversations associées, bibliothèque de documents réutilisables. Sources identifiables dans le contexte. Recherche bornée, absence de fichier et contexte tronqué explicites. Cloisonnement par compte et projet ; mode Europe conservé. | Bibliothèque web livrée #443 ; conversations web livrées #444 ; recette visuelle/appareil non vérifiée |
| W05 | Livrables | Export DOCX modifiable et XLSX de tableaux, en plus des exports existants. Téléchargements relus par un parseur indépendant ; cellules dangereuses neutralisées ; aucun HTML actif ni formule arbitraire. Formats et limites documentés. | Web déployé #445 ; recette structurelle vérifiée ; rendu Office/appareil non vérifié |
| W06 | Continuité | Sauvegarde/restauration explicites puis synchronisation optionnelle multi-appareil chiffrée avant upload, avec secret détenu par l'utilisateur et récupération expliquée. Conflits non destructifs ; reprise hors-ligne ; logout/switch/delete et compte invité traités. Un export manuel seul ne valide pas la synchronisation. | A1 #446, galerie #448, verrou document #449, capture/vérification A2 #451, préparation A3a #452, admission froide #453, runtime isolé inactif #454, migrateur journalisé OFF #455, reprise froide d'effacement v2 OFF #456, reçu distant #457, pont froid/fence v5 OFF #458 et reset local v6/v7 OFF #459 livrés ; restauration/synchronisation non livrées |
| W07 | Comparaison | Comparer depuis une conversation avec contexte/documents autorisés ; conserver les résultats et poursuivre la réponse choisie sans perdre l'original. Erreurs/coûts/quotas de chaque panneau visibles ; EU et historique privé jamais contournés. | Web livré #462 ; recette App/navigateur synthétique vérifiée ; APK distribuée, installation physique et OAuth/facturation réels non attestés |
| W08 | Parcours métier | Trois parcours complets : synthèse documentaire, réponse client préparée, planification Agenda avec confirmation avant écriture. Écran de connexions indiquant disponible/non configuré/non pris en charge selon plateforme. Pas de Drive/Gmail OAuth restreint ni relais IMAP serveur. | Socle Google/BYOK #463, transport Agenda #464, pont copie documentaire/Agenda #465, synthèse guidée #466, statut client #467, formulaire client #468/#469 et Connexions #470 livrés web ; recettes App/navigateur synthétiques vérifiées ; APK distribuées, installation physique et intégrations réelles non attestées |
| W09 | Mobile et identité | PWA installable ; identité tryarty cohérente ; distribution Android authentifiée et documentée. Ne pas rediriger vers une app Play homonyme. Toute migration appId inclut signatures/OAuth/Firebase/liens vérifiés ; un APK distribué n'est pas une publication Store. | Transport API historique livré #471, sondes publiques vérifiées ; identité APK et premier reçu réel livrés #472, distribution Firebase réussie ; guide PWA #473 et correctif CDN #474 publiés/vérifiés sur tryarty.com (PWA_INSTALL_GUIDE.md) ; validations appareil/Store non livrées |
| W10 | Mesure | Instrumentation minimale sans contenu utilisateur : activation, succès/échec des parcours, retour D7/D30 et conversion. Marges fondées sur coût serveur, pas un compteur local. Tableau avec période, échantillon et limites ; aucune métrique inventée. | Rapport opérateur local wallet livré #475 (WALLET_MEASUREMENT.md), CI/Pages/Firebase vérifiés ; pas une marge commerciale. Activation, succès métier, D7/D30 et conversion non instrumentés |

## Dépendances et choix de sûreté

Ordre : W01/W02 → W03/W04/W05 → W06/W07 → W08/W09/W10.
Des travaux indépendants peuvent avancer ensemble, mais les livraisons restent
petites et réversibles. W04 et W07 réutilisent le lecteur de W01 ; W06 réutilise
le format versionné des projets. A1 ne change pas les clés existantes ; les
prérequis de coordination/migration d'A2 restent à implémenter selon l'ADR.

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

### W06 — restauration Web, candidat activé et validé localement

Réglages → Restaurer : préparation initiale consentie si stockage legacy,
archive/code → aperçu lié au compte → adoption durable v8 → reprise froide
sans secret → retour ready. Copie additive des conversations/projets/fichiers,
fichiers autonomes accessibles par une conversation reçue. Bornes nouvelles
archives 16 Mio / journaux 32 Mio ; reprises compatibles jusqu'au plafond du
protocole, sans promesse mémoire téléphone. Pas de synchronisation serveur.

`WORKSPACE_RESTORE_PUBLISHER.md` décrit les invariants, limites et repli :
ISOLATED doit rester true ; seul START peut être fermé dans une livraison
compatible, sans bloquer les lectures ou jobs adoptés. Deux contre-revues
indépendantes GO bornés Web ; verify 318 suites / 4 087 tests + 1 sauté.
Chrome réel avec fixtures locales FR/EN 390/1280, reload/back/forward,
exclusion second onglet, A/B relus/réécrits, PDF/TXT comparés à l'octet, reprise
sur nouveau bundle START=false. Aucune donnée réelle ni requête IA.
La livraison Git/CI/Pages reste à attester. Démarrage natif indisponible et
recette appareil absente ; W06 n'est donc pas entièrement clôturé.

### W06 — abandon avant barrière, livré #477 (OFF)

Un quota durable de duplication peut maintenant être quitté, après inspection
et confirmation explicites, uniquement depuis `reserved` avec sources encore
physiquement 0/1. Copies exactes puis payload du plan retirés ; sources et
comptes intacts ; CAS legacy et rechargement obligatoire. Aucun reset, effacement
de compte ou réactivation privée dans le document froid. Confirmation à usage
unique ; après coupure, nouvel aperçu/consentement, pas de baseline réinventé.

`COLD_MIGRATION_CANCELLATION.md` consigne le contrat et les preuves : verify
314 suites / 3 994 tests + 1 sauté ; quota first/last maintenu et B réel
lecture/écriture/relecture ; Chrome isolé 390/1280 avec sources comparées et
flag OFF réel vérifié. PR #477/main `397112c`, Pages `6e1ff81c` et Firebase
`34035652398` réussis ; assets canonical/immuables identiques. CI main
`34035652413` réussie en tentative 2, après timeout D1 d'un test wallet
préexistant, sans modification du code/test/délai. Le reçu conserve cet échec.
L'abandon après barrière,
le publisher de restauration et la synchronisation restent à réaliser ; ce
prérequis ne clôt pas W06.

### W08 — formulaire client, validé localement

Entrée Templates → champs manuels → revue exacte Claude/Mistral → nouveau fil
détaché marqué « préparée, non envoyée ». Aucune bibliothèque, donnée de compte
connecté, action mail/Agenda ni URL téléchargée. Bornes 8192/8192/1600, faits
absents confirmés, choix EU explicite, annulation garde la saisie, consentement
obsolète invalidé. Association de projet interdite, titre conservé au retry.

Admission par union stricte et cycle partagé avec la synthèse ; nouveau shape
initial allowlisté avant lecture IDB. Deux diagnostics et corrections de revue.
49 tests nouveaux (30 service, 8 transport réel simulé, 11 formulaire/revue).
Vrai App FR/EN 390/1440 : deux fournisseurs, double clic un appel, copie et
reload zéro HTTP, DOCX ciblé téléchargé et XML relu. Quota simulé avec ancien
brouillon synthèse : Retour retrouve le client, sans retry automatique.
Voir `CLIENT_REPLY_FORM_RELEASE.md`. Pas encore de livraison de cette tranche.

### W08 — statut durable client, socle livré #467

Mode canonique restrictif, raw modèle intact, projections copie/export,
archives v3 et branches/retry/comparateur. Deux contre-revues, verify 293 suites /
3 550 tests réussis + 1 ignoré, vraie App sur fil fictif FR/EN 390/1440 avec
Word/Excel ciblés téléchargés et XML relus. Détails et limites :
`CLIENT_REPLY_DRAFT_FOUNDATION.md`. Main `225f560`, Pages `e0cd4933`, six assets
publics tryarty.com/immutable identiques ; CI main `34019451600` et Firebase
`34019451598` réussis. Ce socle livré ne constitue pas à lui seul le formulaire.

### W08 — synthèse guidée, livrée #466

Création atomique après revue depuis Templates/Projects, sélection explicite
overview non vide, objectif exact, source/révision/compte gardés, même moteur
documentaire et résultat persistant. Annulation conserve le formulaire sans
créer de fil. Réponse source copiée/exportée explicitement, pas d'Agenda ou
d'outils IA. Accès distinct de CurrentPlan ; cap documentaire sans faux Mistral.

Deux GO readonly. Verify locale : 290 suites / 3 504 réussis + 1 ignoré,
couverture 71,10 / 65,76 / 76,86 / 73,03 %. Recette vraie App FR/EN 390/1440
avec crypto/IDB et client IA réels, HTTP synthétique ; un appel confirmé,
reload sans HTTP et DOCX ciblé téléchargé puis XML relu indépendamment.
Checklist et preuves : `PROJECT_SYNTHESIS_RELEASE.md`. Main `2c114cf`, Pages
`d082fbad`, octets/hash tryarty.com concordants, CI main `34017827612` et APK
Firebase `34017827579` réussies le 6 septembre 2026. Réponse client, connexions,
W06 restauration/sync et W09–W10 restent
incomplets. Aucun appareil physique, OAuth ou compte réel utilisé.

### W08 — copie indépendante vers Agenda, livrée #465

Base `a3724e3`, branche `codex/workflow-calendar-copy`. Source terminée et
grant initial capturés avant attente ; aperçu inerte puis adoption explicite,
champs manuels, revue immuable, une tentative Calendar. Source abandonnée
comme dépendance après adoption, autorité compte/crypto/fence/document/grant
conservée. Pas de fichiers/images incorporés, d'IA, de lecture Agenda ou de
génération/sauvegarde automatique. Anciennes commandes documentaires inertes.
Pending historique annoncé sans attente impossible, succès confirmé monotone,
réentrance des notifications auth et raccourci drawer mobile contrôlés.

Tests permanents et vrai App/router synthétique FR/EN 390/1440 vérifiés ;
état exact de promotion et limites dans `CALENDAR_DOCUMENT_COPY_RELEASE.md`.
Ne valide pas les deux autres parcours guidés, les connexions, la restauration,
la synchronisation, ni OAuth/Agenda réel ou l'installation physique.

Fusion #465 à 05:50:50 UTC, main `59bfbc6`. CI PR `34014732996` et preview
vertes avant fusion. Pages production `11a513c0-58ba-4d15-8560-19e186bd7475`
réussie à 05:51:57 ; GET canonique/immutable identiques à 05:52:23 et 06:00:19.
CI main `34014996455` verte à 05:56:16 : 285 suites / 3 451 réussis + 1 ignoré.
APK `34014996417` signée à 05:59:00 puis distribuée Firebase et secrets
nettoyés à 05:59:07, job terminé 05:59:10. Hashes et limites dans la checklist.
Deux parcours suivants cadrés après diagnostics readonly dans
`PRD_WORKFLOW_DOCUMENT_GUIDES.md` ; aucun de leur code encore implémenté.

### W08 — transport Agenda et consentement initial, web livré #464

Base main `2da5735`, branche `codex/calendar-owned-transport`. Contrat opaque
Google + portée locale/documentaire capturé avant attente ; validation durable
readonly avant le POST et le résultat. Corps allowlisté figé avant confirmation,
compte Google vérifié, calendrier principal et heures Paris explicites. Le
protocole v1 atteste seulement les refus avant appel mutateur ; réponse perdue,
annulation après dispatch ou succès malformé = issue inconnue, sans retry.
Une tentative par contexte, double-clic joint, actualisation readonly distincte.

Appelants raccordés : CalendarView, les deux InputBar avec un mini-formulaire
commun, outils/rapports et useConversation, briefs visuels/proactifs/vocaux.
Reconnexion Google seule, même identité et ABA invalident les anciennes
intentions. Les briefs indisponibles ne deviennent pas des agendas vides ;
Masquer/restaurer une carte courante reste utilisable. Les outils OpenAI restent
interdits, les fils documentaires/Office/comparaisons restent inertes.
Dates v1 bornées/validées, DST ambigu refusé sans offset ; anciens appels sans
version conservés. Pas de migration, tarif, entitlement, scope OAuth ou W06 ON.

Deux GO code readonly, angles produit/mobile et sécurité/lifecycle, après
corrections des hypothèses erronées et des reprises tardives. Recette Chromium
04:35:41 UTC : huit combinaisons FR/EN, 390/1440, InputBar v1/v2, appareil réglé
sur America/New_York. Composants, crypto, baux Google et admission documentaire
réels ; HTTP synthétique, réseau externe interdit. Manifeste Paris exact,
annulation zéro POST, issue inconnue terminale après un POST, suppression avec
focus/Escape, invalidation au relink puis refresh explicite, zéro erreur JS ni
débordement horizontal. Captures relues par root. Pas une recette routeur App,
OAuth réel, dialogue natif de notes longues ou installation physique APK.

Vérification complète, preuves permanentes et checklist de promotion dans
`CALENDAR_TRANSPORT_RELEASE.md`. W08 reste partiel : la transition explicite
depuis une réponse documentaire et les trois parcours guidés/connexions sont
encore à réaliser. Ne pas lever les verrous documentaires pour les simuler.

Avant fusion #464, suppression du faux succès temporisé de l'ancien bouton de
rapport et garde du toast après attente ; double-clic pending refusé, ancien
résultat non publié après relink/switch/démontage. Douze tests supplémentaires,
deux GO finaux readonly ; verify de livraison : 282 suites / 3 388 réussis /
1 ignoré, tous contrôles verts. Recette browser répétée à 04:48:49 UTC avec
bouton de rapport réel, aucune écriture Google réelle. Ce contrôle n'atteste
pas les autres anciens feedbacks de rapport, inchangés par ce lot.

Fusion #464 normale à 04:56:39 UTC, main `a3724e3`. CI PR `34012491974`
verte, preview vérifiée avant fusion. Pages production
`30358b9f-28ff-4705-9792-e7c902e936b5` réussie à 04:57:40 UTC ; GET
readonly canonique/immutable identiques à 04:58:22 UTC. Assets, SHA et limites
dans `CALENDAR_TRANSPORT_RELEASE.md`. CI main `34012751897` réussie à
05:01:38 UTC (282 suites, 3 388 réussis +1 ignoré), Android/growth verts ;
APK `34012751898` réussie : signée à 05:04:41 UTC, distribuée Firebase et
secrets temporaires nettoyés à 05:04:47, job terminé à 05:04:50. Pas de preuve
d'installation physique ni Store. Second GET production identique à 05:04:49.
Suite retenue après deux diagnostics : copie explicite d'une réponse terminée
vers un brouillon Agenda indépendant, puis synthèse/réponse client guidées ;
`ADR_WORKFLOW_DOCUMENT_COPY.md` ne constitue pas encore leur implémentation.

### W06 A3b.8 — préparation de migrations incomplètes avant effacement, OFF

Livré par #461 le 6 septembre ; activation isolée toujours OFF. Cette
préparation consentie complète le journal/copies jusqu'à v3 verified sans v2
ready ni session privée. Un nouveau document garde donc le choix d'effacer A
même si sa clé manque. Inspection readonly, plan/header/snapshot privé figés ;
progression limitée aux headers exacts du même acteur. Un premier inventaire
non conservé exige consentement distinct et absence de fragments sans plan.
Le CAS verified est protégé contre LS/document tardifs, puis réattesté ; son
acquittement perdu est readonly. Aucun nouvel effacement ou format ajouté.

UI : choix mutuellement exclusifs reprise normale/préparation/effacement ;
consentement à écrire les copies de tous les comptes, puis confirmation locale
distincte après reload. Notice sans compte effaçable (dont données uniquement
anonymes), zéro préparation et reprise normale conservée. Pas de promesse de
libérer de l'espace : un quota durable doit être résolu séparément.

Tests ciblés : 93 tests existants verts, puis 55 et 76 tests de verticale verts
avant les trois derniers négatifs de progression. Typecheck front/back vert.
Six phases d'interruption réelles en fake-IDB : pas de journal, reserved sans
plan, reserved, inventoried, barrier, copied partiel ; A sans clé dès avant le
snapshot, B login/déchiffrement/écriture/relecture après nouveau document.
Pertes d'acquittement plan/checkpoints, quota partiel sans nouveau baseline,
CAS verified et première journalisation avec mutation LS, aperçu modifié,
fragments sans plan, v2 étranger et rollback de progression ; six ordres de
clics UI et démontages. Digests permis, KDF/déchiffrement/réseau interdits avant
v7. Les deux contre-revues readonly ont levé leurs réserves ; root exécute les
tests, ce ne sont pas deux exécutions indépendantes.

Validation finale : `npm run verify` exit 0, 268 suites, 3 153 tests verts et
1 ignoré ; typechecks front/back, add-on/no-CASA, build et worker Office réel
verts. Couverture statements 68,28 %, branches 63,23 %, fonctions 74,02 %,
lignes 70,02 %. Les trois derniers négatifs rollback/révision/v2 après commit
incertain font partie de cette exécution. Avertissement de gros chunks
préexistant, non bloquant. Aucun code modifié après cette vérification.

Checklist de livraison : verify complète, CI web/orchestrateur/Android et
preview avant fusion normale ; reçus main/Pages/APK et GET publics ensuite.
Flag intrinsèque `ISOLATED_WORKSPACE_ENABLED=false` inchangé, aucun D1/scopes
OAuth ni données utilisateur modifiés. Repli par PR de revert et même CI,
jamais downgrade/purge des journaux. Pas de télémétrie globale disponible.
W06 reste partiel : capacité durable, sources divergentes, anonymat, recette
UI/appareil, restauration et synchronisation restent distincts. La preuve
JSDOM/fake-IDB ne vaut pas une recette navigateur ou APK installé.

Reçus #461 : head `07702cb00e237dea8a5243af38637fb2cade8961`, CI PR
`34002162619` entièrement verte ; preview `f2b33676-6819-4980-bc02-c37a9342b286`
et GET lecture seule verts avant fusion normale à 00:52:30 UTC. Main
`ca31dceac79e82a5c778d8769068e8b71a1529cf`, CI main `34002424719` réussie
à 00:58:01 UTC. Run APK `34002424730` réussi à 00:59:51 UTC : APK signé
à 00:59:42, distribution Firebase à 00:59:48, nettoyage des secrets réussi.
Ce reçu ne prouve pas une installation ni une publication Play Store.

Pages production `c0b92ac0-ae70-41ae-a660-00f77210389d`, URL immutable
<https://c0b92ac0.appfacade.pages.dev>. GET à 00:55:37.429 puis 01:06:55.896 UTC :
tryarty.com et immutable servent le même `index-DFpdRDPW.js` (285 736 octets,
SHA-256 `a8e721849f4cee36a44ced897be0523eca02d25cba4c5212ed031bd85613daa0`)
et `App-DCOXHnlX.js` (SHA-256
`6377ff61358ad437cb264b0b19fee6c7ef728ff3d9f1a36a25ea7d4245ae8719`).
Consultation du reçu invalide 400/no-store ; opération synthétique aléatoire
200/unknown/no-store. Aucun POST, authentification ou effacement de compte.

### W07 — comparaison contextuelle, web livré #462

Branche `codex/contextual-comparison`, base main #461. Les deux contre-revues
indépendantes ont imposé : deux modèles admissibles, pas nécessairement deux
fournisseurs ; préparation documentaire commune ; réservation atomique locale
avant HTTP ; registre de streams partagé ; inertie documentaire durable et
absence d'autorité de navigation importée. Décision et limites dans
`ADR_CONTEXTUAL_COMPARISON.md`. W06 demeure ouvert en parallèle.

Socle local : extraction de `prepareProjectPayload` sans retirer le contrat
de commit/post-auth du chat projet ; capture du préfixe d'une question existante,
Office lu une seule fois, même sélection actuelle de projet pour les deux
panneaux, branches profondes gardant les références de fichiers, publication
commune avec garde propriétaire. Quota avant commit ne crée aucune branche ;
échec de nettoyage après commit ne transforme plus un succès en échec annoncé.
Les liens de comparaison sont exclus des JSON importés/exportés et du mapping
backup existant ; la branche reste documentaire sans eux.

L'interface est désormais reliée à la première question et aux suivantes,
avec deux modèles compatibles, consentement documentaire explicite et route
`/compare/:branchId`. Les deux invocations partagent le plafond du chat. Chaque
réponse/erreur/arrêt est conservé avec son attribution et ses métriques ; un
quota local final affiche « non conservé » et ne feint pas un succès durable.
Reload et « Poursuivre cette réponse » ne relancent rien. Une régénération ou
édition du préfixe crée une nouvelle branche pour préserver le tableau initial.

Deux GO code readonly (sécurité/lifecycle et produit/mobile). Objections
intégrées : invalidation crypto même cache chaud, reprise initiale bornée,
focus entre deux dialogues, leases réentrantes, coût sans réserve fictive,
notification non levante après commit et rafraîchissement des compteurs serveur.
Le chargement du plan reste inactif tant que le comparateur n'est pas ouvert.

Preuve locale : vrais comptes/epochs de test, Web Crypto, transactions IDB,
extraction Office/projet, GC et relecture déchiffrée ; clé/plan/transports simulés
dans la suite dédiée et verrou documentaire admis par le setup de tests.
App/ConversationScreen/router réels également testés dans Chrome isolé :
390 × 844 et 1440 × 1000, annulation, deux appels, succès A/échec B, reload,
continuation et retour au tableau sans nouvel appel. Aucun compte personnel
ni API payante utilisé. Ce n'est pas une preuve OAuth/facturation production.

Verify locale : exit 0, 271 suites, 3 234 tests verts + 1 ignoré, typechecks,
add-on/no-CASA, build et worker Office réel en VM verts. Couverture 68,75 %
statements / 63,62 % branches / 74,53 % fonctions / 70,48 % lignes. Quatre cas
de test supplémentaires (peer absent/non réciproque, modèle retiré, retry HTTP
révoqué) ont ensuite passé : 54 tests ciblés verts, aucun code produit changé.
Le premier run avait détecté l'appel de plan trop précoce ; il a été corrigé,
pas masqué. Second run limité à quatre workers après un worker local interrompu.
Checklist et preuves : `CONTEXTUAL_COMPARISON_RELEASE.md`. W06 et W08–W10
restent ouverts.

Publication #462 : head `8cd65461d641867b4ce48eab40a2d8ba6605ba2f`, CI PR
`34005734631` verte, preview `94eecd22-03a9-4407-bc4f-c1d1b4e21d37` et GET
du chunk/route verts. Squash main `d80efb413769b1a0ad818143f3dee0c306207a61`
à 02:14:32 UTC ; CI main `34005972879` verte (271 suites, 3 238 tests, 1 ignoré).
Pages `973ff4b1-1b0d-4e11-b1ab-a95340936017` ; tryarty.com et immutable
servent exactement les mêmes index/App/contextualCompare, vérifié à
02:16:30.907 et 02:22:13.496 UTC. Hashes dans la checklist. APK
`34005972893` signé puis distribué via Firebase à 02:21:41 UTC ; pas une
preuve d'installation physique ni de publication Store.

### W08 — socle Google livré web, transport Agenda et parcours restant à faire

Deux audits readonly produit/mobile et sécurité ont accepté le découpage de
`ADR_WORKFLOW_AGENDA_OWNERSHIP.md`. Avant la nouvelle UI, corriger les réponses
de refresh Google tardives pouvant déconnecter le compte suivant, les retries
qui relisent un autre grant et la capture des requêtes Agenda après attente.
Préserver la mutualisation du refresh, l'effacement Google autorisé et la
distinction grant logique/génération d'écriture ; tester relink et ABA.
Le mini-formulaire InputBar contourne aujourd'hui calendarClient et doit être
raccordé au même contrat. Le socle #463 implémente la propriété du grant, le refresh
partagé durable, la reprise explicite après modification BYOK et les reçus de
reconnexion. Tests à crypto réelle, modules rechargés et hook réel sous HTTP
simulé ; aucune connexion Google réelle ni écriture Agenda. Détail et limites
du marqueur d'interruption dans l'ADR. 273 suites / 3 303 tests passent et les
deux revues ont donné GO. Fusion `2da5735`, Pages production `4682e2dd` et
GET canonique/immutable identiques attestés dans `GOOGLE_OWNERSHIP_RELEASE.md`.
CI main verte ; APK signé et distribué Firebase à 03:37:05 UTC (run
`34009120945`). Pas une preuve d'installation physique ou Play Store.
Le transport Agenda reste non raccordé.

Les parcours guidés ne seront pas trois prompts supplémentaires présentés comme
un résultat livré : préparation/source/confirmation, résultat conservé puis
copie/export, réponse client explicitement non envoyée. Transition Agenda via
formulaire applicatif confirmé, sans lever l'inertie documentaire. Connexions
et issue incertaine distinctes ; aucun nouvel accès Gmail/Drive ou relais IMAP.

### W06 A3b.7 — effacement depuis une migration complète interrompue, candidat OFF

Livré par #460 le 6 septembre, activation isolée toujours OFF.
La supersession v3→v6 locale est proposée uniquement après attestation exacte
source/journal/destinations/targets LS pour verified ou copied physiquement
complet. L'aperçu reste privé et figé jusqu'au CAS. Aucun effacement ni marqueur
préalable ; reload puis nettoyage v6/v7 déjà livré. Copied absent/partiel ou
phase précoce refuse explicitement et conserve les octets. Pas de nouveau
format, ni adoption de compte depuis un simple libellé, ni confirmation serveur.

L'UI lie son premier choix avant l'import différé, affiche l'identifiant opaque
échappé pour les homonymes, et exige un reload pour changer d'action après claim.
« Demande enregistrée » n'annonce pas une purge terminée. Fix adjacent actif sur
le parcours courant : logout supprime les brouillons RAM/LS du seul owner exact,
préserve les voisins a:b/a-b et conserve les anciennes formes ambiguës. Le
parseur froid reste strict ; conv-1 est reconnu seulement par le mode logout.

Preuves ciblées : 105 tests verts sur les quatre suites de services avant les
derniers ajouts UI ; puis 43/43 workspaceResetCycle verts, typecheck front/back
vert. Vrais composants/useAuth/KDF/stores avec fake-IDB/JSDOM : B se connecte,
déchiffre et écrit, A est recréé puis effacé une deuxième fois. Six frontières
de crash du nettoyeur ; snapshot changé, CAS tardif, document perdu, double
confirmation, commit incertain, ancien migrateur et unmount/choix UI exclusif.
Ces preuves ne sont ni une recette navigateur installée ni une recette UI APK.

Validation complète finale : `npm run verify` exit 0, 268 suites, 3 117 tests
verts et 1 ignoré ; typechecks front/back, add-on/no-CASA, build et worker Office
réel verts. Couverture statements 68,16 %, branches 63,06 %, fonctions 73,91 %,
lignes 69,89 %. Avertissements de gros chunks préexistants, non bloquants.
Deux GO finaux indépendants, bornés au candidat OFF, après correction des
objections ; pas de blocage restant sur ce diff. Revues readonly, tests exécutés
par l'agent principal et non indépendamment par les relecteurs.

Checklist de déploiement : deux contre-revues readonly, suite verify complète,
CI PR et preview avant fusion normale, puis reçus Pages/main/APK et GET publics.
`ISOLATED_WORKSPACE_ENABLED=false` inchangé ; aucune migration D1 ni donnée
utilisateur modifiée. Repli en cas de régression login/logout/legacy : PR de
revert par la même CI, jamais downgrade/effacement de reçus v6/v7. Pas d'accès
à une télémétrie globale d'erreurs/latence : ne pas en inventer. W06 reste
incomplet (v3 précoce/partiel, restauration, synchronisation, recette appareil).

Livraison : [PR #460](https://github.com/flotellop-art/Arty/pull/460), head
`f6040510795d7565f63be17769da7eea2b3340f4`, squash normal le 06/09 à 00:14:46 UTC,
main `68a80ef63952eed3a5bef3a6a4fcb1a74531d991`. CI PR `34000596175` entièrement
verte (web, Android, orchestrateur), preview Pages
`a6ac5405-1df0-4819-b01c-7f5bee642be0` et sonde GET à 00:13:33.619 UTC réussies.
Pages production `1f5d3cb2-25b2-422e-9673-2fd73be4b8ff` réussi ; sonde publique
00:16:11.627 UTC sur tryarty.com et https://1f5d3cb2.appfacade.pages.dev : mêmes
assets `index-3CCF14PE.js` (282 484 octets) et `App-C-KfLNs9.js`, SHA-256
respectifs `44d42a04d72207ea37e7022670576c85347da949a7cc6c090aa14a1cf5cd0493`
et `e0e1c832ec52e366ed8165ed76b1701f86416d4a08cd64c12d63007baa5320fe`.
GET reçu invalide 400/no-store ; consultation synthétique 200/unknown/no-store.
Aucun POST, authentification ou effacement réel. CI main `34000778082` et
build/distribution APK `34000778099` encore en cours à cette sonde. CI main
entièrement réussie à 00:18:53 UTC. Build/distribution APK ensuite réussi à
00:22:13 UTC : compilation signée terminée à 00:22:01, transfert Firebase à
00:22:08, nettoyage des fichiers de secrets réussi. Pas une installation sur
téléphone utilisateur ni une publication Store. Sonde répétée à 00:22:32.695 UTC :
mêmes assets, empreintes et réponses GET. Aucune télémétrie générale attestée.

### W06 A3b.6 — nouvel espace local après effacement, candidat OFF

Livré via #459, activation isolée toujours OFF ; reçus ci-dessous.
Le vrai bouton isolé conserve l'autorité puis ferme irréversiblement l'ancien
document, même si le rechargement tarde. Le nouveau document froid purge les
copies avant de publier atomiquement un droit borné de nouvel espace local.

- V6 pour les nouvelles suppressions, ready v7 avec droits A/B versionnés.
  V4/v5 historiques inchangés et sans nouveau droit. A reste requiredOwner.
  Seul le login explicite alloue une fois sel/check/version et consomme le droit
  avant de publier crypto/grants/session. Reprises après écritures partielles,
  refus de mauvaise clé ou de marqueur consommé disparu, aucun reset universel.
- 17 tests de cycle : vrai bouton/useAuth/KDF et stores, A migré/post-cutover,
  deux effacements, nouveau A et B déchiffrent/créent/modifient/relisent ; six
  coupures, mutation LS pendant la transaction, CAS direct après ABA/perte du
  document, grant échoué après consommation. Simulation IDB/documents/navigation,
  pas une recette navigateur/Android de bout en bout.
- Android : SharedPreferences commit atomique compte+reçu protocole2, incarnation
  durable obligatoire après reset, anciens clear/reopen/tickets refusés, cache
  JS protégé contre réponses tardives. Keystore partagé conservé et synchronisé.
- Quatre tests d'instrumentation exécutés sur AVD API35 synthétique neuf, puis
  rejoués après installation de test vierge : absence initiale d'alias vérifiée,
  huit demandes concurrentes de chiffrement, deux cycles avec changements de PID,
  autres scopes a-b/a:b conservés et déchiffrables, commits perdus/échoués et
  reçus malformés. Tests JVM et compilation APK debug/test verts. Ni téléphone
  utilisateur, ni IMAP réseau, ni parcours visuel WebView testés par ces essais.
- Deux contre-revues GO limitées après corrections, dont race LS avant CAS,
  garde ABA intrinsèque, grammaire historique et fermeture définitive du document.
  Pré-requis restant identifié : logout et brouillons voisins a:b (hors diff),
  à corriger avant activation ; pas de preuve générale du logout multi-compte.

`npm run verify` réussi : 268 suites, 3 087 tests verts et 1 ignoré ; types
front/back, no-CASA/add-on, couverture, build, worker Office réel. Couverture :
statements 67,97 %, branches 62,91 %, fonctions 73,68 %, lignes 69,73 %.
Décision et reproduction native détaillées dans `ADR_WORKSPACE_BACKUP.md` A3b.6.

Checklist de livraison : deux GO et validation locale acquis ; CI et preview
requises avant fusion, puis preuve Pages/GET publics et build APK. Flag
`ISOLATED_WORKSPACE_ENABLED=false` inchangé, aucune migration/effacement réel.
Repli sur régression legacy/login/natif : revert normal par PR/CI/Pages, aucun
downgrade v6/v7 ni suppression de reçus. Sans télémétrie globale disponible,
ne pas revendiquer de mesure générale d'erreurs/latence. W06 reste incomplet :
supersession v3, restauration, synchronisation et recette UI/appareil restantes.

Livraison : [PR #459](https://github.com/flotellop-art/Arty/pull/459), head
`71504c9ee890eef6517a85c3beb31966a6eb3925`, squash normal 05/09 23:31:27 UTC,
main `91455ca6c31602064f11293c09cba1d6bf894e4c`. CI PR `33998666762`
entièrement verte (web, Android et orchestrateur). Preview Cloudflare
`a80e44b8-3a70-4de3-9f29-767b15748763` puis production
`2c54a605-d85d-4808-99d8-70d9639316b3` réussies.

Recette IAB preview : profil synthétique, paramètres, choix d'effacement
appareil-only, texte de confirmation puis Annuler ; retour au choix attesté.
Aucune suppression ni appel IA. Onglet 17 fermé, onglet utilisateur et brouillon
non touchés ; émulateur synthétique également arrêté après les tests natifs.
Pas de recette isolée dans le navigateur puisque le drapeau reste OFF.

Sonde GET 23:33:54.335 UTC : tryarty.com et alias immuable
`2c54a605.appfacade.pages.dev` servent le même `index-B08hZL4N.js`,
279 054 octets, SHA256
`2077c8e8b4b3e77cc231835d4593362f22493c342f718cb2933a10074a801a38`,
et `App-DZDfWsCr.js`, SHA256
`8de871bdd8a850a915fea8b29ee249a193739ed03bd409cba93bdd249eaaed6e`.
GET invalide 400/no-store, consultation op/cap synthétiques aléatoires
200/protocol1/unknown/no-store. Aucun POST ni credential de production.
CI main `33998898958` entièrement réussie, terminée à 23:36:01 UTC.
Distribution APK `33998898953` réussie, terminée à 23:39:19 UTC : APK signé
23:39:07, transfert Firebase 23:39:15, nettoyage des fichiers de secrets réussi.
Cela ne prouve ni installation sur téléphone utilisateur ni publication Store.
Sonde répétée à 23:39:47.166 UTC : mêmes assets, empreintes et réponses GET.
Pas d'accès à la télémétrie générale ; ces sondes ne mesurent pas un taux global
d'erreur/latence. Préparation du prochain gate v3 consignée dans l'ADR ; aucun
code de supersession v3 n'est encore implémenté à ce checkpoint.

### W06 A3b.5b — reçu froid et fence v5, candidat OFF

Implémentation complète du pont froid, de son UI et de deux recettes verticales,
sans activation de l'espace isolé ni changement de la route serveur de #457.

- Admission isolée liée au snapshot exact génération/reçu ; aucun import de
  session, crypto privée, App ou OAuth pour consulter le reçu. GET seulement,
  secret dans les headers, réponse bornée, aucune nouvelle demande de suppression.
  Confirmation durable par CAS du record entier (nonce/cap/sujet compris).
- Nettoyage local explicite distinct de la preuve serveur ; secret incertain
  conservé dans l'autorité v5 jusqu'à la fin, même après panne native. Reprise
  UI locale explicite après échec. Ancien inconnu ne crée pas de nouvelle intention.
- Annulation d'une intention réellement `not-sent` sans aucune purge ; contrôle
  exact du reçu et des fences. Un acquittement de résultat perdu ne peut pas
  être présenté comme un nettoyage réussi.
- Réservation v5 avant réparation IDB/LS, cible unique et preuve B immuable,
  checkpoint avant purge. Anciennes preuves v4 inchangées ; aucune conversion
  d'un v4 divergent. Seuls les deux emplacements exacts du fence actif sont
  exclus des nouveaux hashes et attestés séparément, jusque devant le commit.
- Verticale runtime/KDF/crypto réels : vrai `purgeProjectsForAccount` interrompu
  avec événement `abort` attesté après LS ; nouveau document → réparation →
  nouveau document B déchiffre historique/fichier/projet ET crée/modifie/relit
  un projet. L'échec pré-réparation est bien le fence `cancelled`, crypto prête.
- Verticale D1 workerd : vrai POST du client, réponse perdue après commit et
  révocation effective du token email ; nouveau document avec admission privée
  interdite → GET froid sans auth → nouveau B peut lire/créer un projet.
- 82 tests ciblés verts : ces recettes, fixture v4 indépendante, cinq phases
  d'interruption v5, quota LS, valeurs présentes invalides, changement de reçu
  avant consentement/pendant GET/entre retries, perte de document, mutations B
  et fences legacy/journal/actif, race avant réparation/publication et annulation.
  Deux contre-revues indépendantes ; objections corrigées dans ces tests.

Validation générale : `npm run verify` réussi, 265 suites / 3 042 tests verts
et 1 ignoré ; front/back, no-CASA/add-on, build et worker Office réel verts.
Couverture statements 67,60 %, branches 62,42 %, fonctions 73,44 %, lignes
69,33 %. Deux GO finaux limités au candidat OFF, sans objection bloquante.
Reçus Git/CI/Pages ci-dessous. Aucun
test d'effacement en production, aucune prétention de recette APK réelle.
`ISOLATED_WORKSPACE_ENABLED=false` inchangé. W06 reste partiel : supersession
v3, métadonnées/recréation, recette native, restauration et synchronisation
restent distinctement à réaliser.

Checklist de déploiement du lot (6 septembre) : suite complète/typechecks,
deux GO, CI et preview avant fusion ; Git/Pages habituels, pas de migration D1.
Repli sur régression d'admission ou de suppression courante : revert normal de
la PR, flag toujours OFF ; conserver journaux et tombstones. Un stockage v5 ne
doit pas être rétrogradé ni purgé pour revenir en arrière. Vérifier les assets
servis après publication et les réponses publiques GET non destructives ; sans
accès à la télémétrie globale, ne pas prétendre mesurer un taux d'erreur général.

Livraison : [PR #458](https://github.com/flotellop-art/Arty/pull/458), head
`94423888467ee47c689d21376b910e4edb1ed4e6`, fusion normale 05/09 22:21:48 UTC,
main `f41725bce242dd9f8f5ed5b6ea379cbc9fe8db54`. CI PR `33995467699` et CI
main `33995692955` réussies (main terminé 22:25:55 UTC), dont Android et
orchestrateur. Preview `828082ff-2cfe-4631-8809-cf0e9830d543` et production
`57f1dbac-da8f-41aa-8ab7-ff245ddddf7f` réussies.

Recette IAB preview : démarrage du profil synthétique, paramètres, confirmation
appareil-only puis Annuler. Aucun effacement ni appel IA ; onglet test refermé,
onglet utilisateur et brouillon préservés. Sonde 22:23:54.884 UTC : tryarty.com
et alias immuable `57f1dbac.appfacade.pages.dev` servent exactement le même
`index-DVWlPy9K.js` (273 587 octets), SHA256
`31c88cd840f91279372968f6f5d031907526eb3856c01948a274251870d347ed`, et
`App-CFZsFFc6.js`, SHA256
`fa0a7208aea2a8dcfe5981d4c7d292cb69e6145cfacd02baf0bc906328f3269f`.
GET invalide 400/no-store ; op/cap synthétiques aléatoires donnent
200/protocol1/unknown/no-store. Ni POST ni auth de production utilisés.
Sonde répétée 22:28:17.552 UTC : mêmes empreintes/réponses. Build/distribution
APK `33995692845` réussi, terminé 22:29:13 UTC : APK signé 22:29:01, Firebase
22:29:08. Ceci ne prouve ni installation sur téléphone ni publication Store.

### W06 A3b.5a — reçu distant d'effacement, parcours courant

Correction séparée de la future reprise froide v5 : le parcours actuel pouvait
perdre sa dernière intention après une réponse réseau perdue, alors que D1
avait déjà révoqué le jeton email. Une erreur HTTP, y compris 401, ne prouve pas
l'absence d'effet. Ce lot ne livre ni restauration ni synchronisation.

- Nouvelle route `/api/account/erasure-v1`, sans repli vers `/delete`. POST
  authentifié, sujet Google/email-trial lié à l'identité capturée avant tout
  DELETE. Consultation GET sans jeton, secret 256 bits dans un header uniquement,
  réponse `no-store`, aucun CREATE/DELETE dans GET.
- Intention locale enregistrée avant l'envoi ; `uncertain` committé avant fetch.
  Reprise incertaine = GET seulement, même après reload ou jeton révoqué.
  HTTP 200, ancien JSON, HTML, mauvais sujet/opération/protocole et corps trop
  grand ne constituent pas une confirmation. Limite réponse 512 octets, timeout
  30 secondes. Aucune lecture réseau lors de l'ouverture des réglages.
- D1 : chaque DELETE exige le ticket gagnant. Reçu terminé et suppressions
  partagent le même batch transactionnel. Doublons et anciens POST ne peuvent
  supprimer les données recréées. Le témoin opaque est permanent : ne pas
  supprimer/expirer cette table. Elle ne contient ni email, token, secret brut,
  contenu ou date ; le hash du sujet est salé par le secret client.
- Confirmation validée puis écriture IDB atomique de l'ancien format exact
  autorisant le nettoyage ; retrait du secret seulement à cette étape. Ancien
  `true` reste une autorité locale historique, pas une preuve distante.
  Ancien `false` sans secret reste invérifiable, jamais converti en nouvel envoi.
- UI FR/EN : lecture locale impossible distincte d'absence ; vérification et
  nettoyage, nettoyage déjà autorisé, choix local-only avec confirmation
  séparée. Ce dernier annonce l'abandon du moyen local de vérifier le distant ;
  une purge locale interrompue conserve encore le secret et l'incertitude.
  BYOK/démo n'inventent plus de confirmation serveur.
- Preuves : Miniflare/workerd D1 avec vrai trigger d'échec au milieu du batch,
  concurrence/rejeu et données recréées ; vrai client + journal IDB + vraie
  route D1, perte de réponse après commit, révocation effective du jeton email,
  nouveau graphe JS puis GET et purge projet. Fichiers/natif simulés dans cette
  dernière recette ; ce n'est pas une recette navigateur ou APK physique.
- Deux contre-revues indépendantes en lecture seule : ticket/sujet/legacy et
  produit/reprises. Corrections : double verrou BYOK/démo, interprétation du
  vieux `true`, ledger qui ne doit pas croître à chaque GET, ancienne preuve de
  rollback remplacée par un vrai échec SQL. Cas A→B→A et prises concurrentes
  vérifiés. `npm run verify` avant recette visuelle : 263 suites, 2 989 tests verts + 1 ignoré,
  typecheck front/back, no-CASA, add-on, build et vrai worker Office verts.
  Couverture globale : statements 67,36 %, branches 61,99 %, fonctions 73,20 %,
  lignes 69,13 %. La recette preview a fait préciser la description locale
  BYOK/démo (sans promesse serveur), avec un test UI supplémentaire.
  Reçus de validation finale/CI/production à consigner après publication.

Limites : `unknown` ne prouve pas un échec ; si aucun commit distant n'a eu lieu,
la vérification ne relance pas le serveur. Support/local-only restent explicites.
Pas encore de réauthentification/retry serveur universel. Les anciens APK
peuvent toujours utiliser la route legacy : aucune barrière générale contre
leurs écritures n'est revendiquée. Activation isolée toujours OFF ; extensions
incertaines/local-only refusées par les parsers froids stricts. Fence v5, migration
v3 interrompue, métadonnées/recréation, restauration/sync et recette native restent
à fermer.

Déploiement/repli : schéma additif créé paresseusement uniquement après auth,
contrat ancien endpoint conservé, aucun secret/binding nouveau. Ne jamais
effacer les tombstones pour revenir en arrière, ni rétablir un client qui
réémettrait un POST legacy après incertitude. Préférer une correction en avant
ou un client laissant la vérification disponible et l'envoi désactivé. Les
clients v1 gardent l'intention si la route devient indisponible. Une panne de
stockage/lecture ou une divergence de reçu bloque l'effacement, sans faux succès.

Livraison A3b.5a : [PR #457](https://github.com/flotellop-art/Arty/pull/457),
head `741049a71c32fb429f8ad48024f8fb9cad105430`, fusion main
`7cbede54c322dd5416b103c61f1e60949e129dae` le 5 septembre à 21:34:54 UTC.
CI PR `33993213963` et CI main `33993458989` réussies (web, Android,
orchestrateur). Verify local final sur ce head : 263 suites / 2 990 tests verts
et 1 ignoré ; couverture statements 67,37 %, branches 62 %, fonctions 73,20 %,
lignes 69,14 % ; front/back/no-CASA/add-on/build/worker Office verts.

Pages preview finale `fc65d8cf-1d95-4087-b3c6-3e9578db6cf8` et production
`0d38a60f-f8cf-4d1b-8845-4643d39a660a` réussies. Recette navigateur sur l'aperçu
isolé : accueil, réglages, description appareil-only, confirmation puis annulation
sans effacement ; onglets de test fermés, onglet utilisateur conservé.
Deux contrôles HTTP publics à 21:36:54 et 21:40:01 UTC attestent les mêmes assets
sur tryarty.com et l'URL immuable de production :

- `/assets/index-Czk5vSdC.js`, 267 651 octets, SHA-256
  `ea5cb06c1d49af4b93932a0f892101a1487de0faacc15f74027eaf87479e5afe`.
- `assets/App-BsDzYnxX.js`, SHA-256
  `828c06a0a029736bcccf5eedc9bf1489398ff329ae7f28c4c79154cc09a8559b`,
  contenant le nouveau chemin de protocole.
- GET invalide → 400/no-store ; GET opId/capability aléatoires synthétiques →
  200, protocole1/unknown/no-store. Aucun POST, aucun compte réel effacé, aucun
  secret utilisateur manipulé. Cela ne mesure pas le taux d'erreurs réel global.

Build/distribution APK `33993459116` réussi : compilation signée terminée
21:41:27 UTC, distribution Firebase réussie 21:41:33 UTC, workflow terminé
21:41:38 UTC. Cela ne prouve pas une installation sur téléphone ni une
publication Store. Aucun APK personnel/appareil réel manipulé dans ce lot.

### W06 A3b.4 — reprise froide d'effacement v2, candidat OFF

Décision du 5 septembre 2026 : terminer le nettoyage déjà engagé dans une
génération **v2 prête et cohérente**, sans authentification ni nouveau POST.
Le `serverConfirmed: true` historique autorise la reprise locale seulement :
BYOK/demo pouvaient le poser sans requête serveur. Aucune confirmation distante
n'est inventée. Un seul reçu strict est accepté ; reçu incertain/falsy/multiple
ou format inconnu refuse avant purge.

Options examinées : réutiliser le nettoyeur connecté (rejeté : dépendance à A,
préfixe ambigu a/a-b, copies legacy/journal oubliées) ; supprimer le job entier
(rejeté : contient B) ; réserver un contrôle v4 puis purger les seules données
attribuables à A (retenu). La réservation précède toute suppression et devient
l'autorité durable, même après disparition du reçu source et de la session A.

- Preuves B immuables **par copie** : legacy, génération active, journal ;
  les trois copies peuvent légitimement différer après cutover. Scan complet
  paginé des cinq stores, pas seulement les index owner.
- Plan du journal expurgé : owners/localSource de A retirés, anciens compteurs
  et hashes inclusifs abandonnés ; format distinct non consommable par v3.
- Auth/réglages/brouillons attribués exactement ; rapports globaux non attribués
  et sel global conservés. Google A ne possède pas le hash Email B de la même
  adresse. Les formes ambiguës/anciennes non couvertes bloquent explicitement.
- Contrôle final v2, même génération, `requiredOwners ∪ {A}` conservé : B se
  rouvre dans un nouveau document ; **A ne peut pas recréer un sel**. Ce lot
  n'est donc ni une purge de toutes les métadonnées d'identité ni une autorisation
  de recréation de compte.
- Android : nouveau clear protocole1, blocage terminal process-static de A,
  ticket avant executor/réseau et contrôle+commit dans la même section critique.
  Un clear historique ne lève pas le blocage terminal. Retry JS ancien invalidé
  même après release ; Unicode malformé refusé sans normalisation. Aucun fallback
  vers l'ancien plugin, aucune suppression de la clé Keystore partagée.
- UI froide FR/EN : reprise explicite, retour OAuth intact, aucune ouverture
  d'App/KDF ; fin « Recharger », jamais « compte supprimé ».

Deux contre-revues indépendantes ont fait corriger avant finalisation : collision
report-conversations, ambiguïté de brouillon a:conversation:home et adoption
possible d'une écriture LS tardive au checkpoint verified. Les tests injectent
ces cas et exigent refus sans finalisation v2.

Preuves locales : migration réelle → nettoyage → déchiffrement B (historique,
fichier, projet/document, capture d'archive) ; A post-cutover refuse un nouveau
sel ; interruptions de stores/phases, reçu source déjà supprimé, quota LS,
commit final réellement effectué puis timeout, perte du document pendant le
clear natif, méthode ancienne/échec/mauvais protocole, modifications B, owners
opaques et email partagé. Aucun compte utilisateur réel utilisé ou effacé.
Verify final : 261 suites / 2 959 tests verts + 1 ignoré, front/back,
no-CASA, addon, build, worker Office et couverture OK (statements 67,16 %, branches 61,64 %, fonctions
73,08 %, lignes 68,91 %). Tests UI/quota/fin incertaine/perte document : 43/43.
Gradle compile Java et tests JVM OK, dont les 5 tests du nouveau fence ; les tests de concurrence
du kernel et de branchement source ne sont **pas** une recette de deux véritables
instances du plugin/SharedPreferences ni d'un APK installé.

Limites bloquant l'activation : fence LS/IDB déjà désaccordé (refus sans mutation
testé, réparation dédiée restante), effacement pendant migration v3, résultat
serveur incertain, générations non déclarées, purge des métadonnées/recréation,
recettes native intégrée et capacité/performance WebView. Aucun import de
sauvegarde ni synchronisation ajouté. W06 reste partiel.

Checklist de livraison : politique intrinsèque OFF inchangée ; aucun nouveau
package, endpoint, permission ou secret ; CI exacte requise avant fusion,
preview puis sondes production. Repli : revert du lot par PR si admission legacy
ou connexion régresse ; aucun downgrade/suppression de DB de clients candidats.
Mesures privées de taux d'erreur/latence non attestées par les sondes publiques.

Livraison A3b.4 : [PR #456](https://github.com/flotellop-art/Arty/pull/456)
fusionnée le 5 septembre à 20:43:13 UTC, head
`78751fcd4479971ff38a981072e192cd861c81be`, main
`fc93795853f1a07c41c9ea306d0093e657455f6f`. CI PR `33990716993` réussie.
Pages preview `ec256fab-a3be-4ecc-91db-7d78754aa11c` : accueil et paramètres
ouverts en données d'exemple. Pages production
`3ebabb9c-b3b0-4c9e-b8af-aa7ca9e826be` et tryarty.com servent à 20:44:59 puis 20:48:50 UTC
le même `index-B0jtzXqm.js` (264 767 octets), SHA-256
`2e979491e3e4423bac67d2951dccf93d63e4b30029852cd17f43479dab2926f6`, HTTP 200.
Origine production vierge : accueil → vrai écran de connexion après admission,
aucune clé saisie. Onglet utilisateur préservé, onglets de test fermés. Le build
OFF élimine le writer de purge ; protections natives/JS de writes tardifs livrées.
CI main `33990942362` réussie (20:46:59 UTC). APK `33990942328` réussi
(20:50:50 UTC), étapes build signé et distribution Firebase toutes deux réussies.
Aucune installation sur téléphone ni recette native intégrée revendiquée.

### W06 A3b.3 — migrateur brut journalisé livré (#455), activation OFF

Implémentation candidate publiée, sans activation. La
verticale utilise les vrais lecteurs : stockage legacy chiffré → inventaire →
barrières v2 → journal/copie isolée → nouveau document → conversation, fichier,
projet/document et capture d'archive vérifiée. Aucun compte réel n'est migré.

- Réservation froide exclusive : impossible pendant une admission privée déjà
  lancée ; aucun App/useAuth/crypto importé par le migrateur. La politique OFF
  interdit intrinsèquement start et reprise, pas seulement le bouton.
- Journal v3 dans le contrôle physique v1, un seul UUID pour job/génération ;
  DB journal dérivable du descripteur final, non orpheline après commit.
- Inventaire de toutes les lignes des cinq stores, sept slots et indices
  d'owners des sessions/réglages/auth historiques, y compris hors sessions.
  Valeurs auth/réglages inchangées, non copiées dans le journal ; signature de
  stabilité de tout LS. Salt global effectif conservé ; aucun check global
  promu en check d'un compte. Sel absent/ambigu : refus avant réservation.
- Copie raw paginée, empreintes déterministes par ligne, vérification complète
  des sources, du journal et des destinations. Champs supplémentaires et
  undefined préservés ; formes exotiques explicitement refusées. Divergence
  refusée sans écraser la cible ni effacer la source.
- Reprise testée à chaque phase, journal absent/étranger, quota LS avant
  barrières, versions legacy partiellement relevées, upgrade bloqué tardif,
  changement de credential/source/cible et timeout après commit réel.
- Écran froid FR/EN pour header reconnu, sans import privé, sans consommation
  du retour OAuth et sans boucle de rechargement lorsque la reprise est OFF.

Limites bloquant toujours l'activation : purge de toutes les générations et du
journal, reprise froide d'effacement (dont IMAP natif), résolution explicite
d'une source modifiée, annulation prébarrière sans perte de références,
recettes capacité/performance WebView. Un quota LS peut laisser le journal et
une copie partielle réessayable : pas de retour automatique en legacy. Après
la première barrière v2, pas de downgrade. Aucun import/restauration de sauvegarde
ni synchronisation n'est livré par ce lot. W06 global reste **partiel**.

Prépublication : deux contre-revues indépendantes GO limité OFF, après
correction des owners session-only/orphelins, ordre Unicode, fermeture de
connexion et fin incertaine après commit. `npm run verify` : 258 fichiers /
2 908 tests verts + 1 ignoré, typecheck front/back, no-CASA, addon, couverture,
build et worker Office réussis. Après les derniers petits correctifs de
classification `report-`, typecheck et 49 tests migration/politique verts
(dont 41 scénarios migration). La CI finale doit revalider l'exact commit.
Couverture du verify : statements 66,66 %, branches 61,07 %, fonctions 72,48 %,
lignes 68,42 %. Aucun nouveau package, secret ni workflow de déploiement.

Livraison : PR #455 fusionnée le 5 septembre à 19:51:16 UTC, head
`fe0245f80e53f59c4848a0f285ae2796e0b7fb6f`, main
`4ae048fbab81396ba1315a96eb3314396a1246b3`. CI PR `33988126768` et main
`33988357913` réussies. Pages preview `e8bdb185-95fb-4c68-b05b-569573ddb449` :
accueil et paramètres ouverts en données d'exemple. Pages production
`a47c4c39-7a99-45c6-a683-6900453213b7` et tryarty.com servent aux sondes de
19:52:37 et 19:56:38 UTC le même `index-BpgGTd56.js` (259 680 octets), SHA-256
`798331d9ed8e342f0446b1e66001090fb9b4faf980fc0894c41ade68ffd9611f`, HTTP 200.
Sur origine production vierge : accueil → connexion réellement ouvert après
admission, aucune clé saisie. Onglet utilisateur connecté préservé. Le build
OFF élimine le writer de migration et conserve seulement l'écran froid
d'information. Cela ne mesure ni latence terrain ni taux d'erreurs sur 15 min.
Distribution APK `33988357984` réussie à 19:57:11 UTC : compilation signée et
étape « Distribute to Firebase App Distribution » confirmées success.
Aucune recette sur APK installé n'est revendiquée.

### W06 A3b.2 — runtime isolé livré (#454), activation OFF

Contrat de génération globale implémenté : résolveurs histoire/crypto/assets,
parser strict, bases déclarées obligatoirement existantes, provisioning neuf
non destructeur et garde d'effacement partagée. Les accès Google ne sont plus
supprimés lors d'un refus crypto pré-bootstrap ; le compteur provisoire n'est
adopté qu'après ouverture du chiffrement. Auth/réglages restent à leurs adresses
existantes. Les anciens rapports ne sont pas nettoyés au boot isolé.

51 tests de runtime candidat avec vrai parser/admission/KDF/stores/hooks et
API Web Locks simulée ; politique réelle OFF testée séparément avec la même
fixture valide. A→B→A, logout/relogin/reload, sauvegarde relue, quarantaine et
reprise crypto, courses/erreurs/effacement sont couverts. Deux GO readonly
limités, après correction des objections de sûreté et de preuve.

Pas encore une livraison de restauration : aucun migrateur ni writer du
registre ; aucun override de la constante de release. La purge testée est
celle de la génération active, pas celle des copies retenues. Recréation d'un
owner inventorié, reprise froide, purge multigénération et import exact restent
à terminer. Décisions et repli : `ADR_WORKSPACE_BACKUP.md`, section A3b.2.
`npm run verify` final réussi : 257 fichiers / 2 866 tests + 1 ignoré,
typecheck front/back, no-CASA/addon, couverture, build et worker Office verts.
Couverture lignes 67,75 %, branches 60,45 %. Log local
`../arty-isolated-readers-verify-final-20260905.log`.

- PR [#454](https://github.com/flotellop-art/Arty/pull/454), head
  `6413e307f8d4240f1cd613da549744ceacf62d61`, squash main
  `9981e5fe290711eb1f9b114cca8ef50afac17240`, fusion 18:58:51 UTC.
- CI PR `33985479466` et main `33985705847` réussies (web, Android,
  orchestrateur). Preview Pages `a0b24acb-ec64-4af7-9725-1f2b9d88215c`
  et production `9dd0152d-b0ad-42d7-88e6-4bb3a2fea755` réussies.
- Distribution Android `33985705852` réussie, étapes APK signé et Firebase
  App Distribution confirmées. Aucune installation/recette native déduite.
- tryarty.com et URL immuable production servent le même
  `/assets/index-pT3N8hdK.js`, HTTP 200, 255 968 octets, SHA-256
  `cb9afe4cf5ed91acaf84f5fe7e03cded2de29c42bdc33f287b7e52f0dffcd71b`
  à 19:01:34 UTC. Marqueurs admission froide et contrat isolé présents.
  Sonde répétée à 19:04:51 UTC : mêmes HTTP 200 et empreinte.
- Préversion navigateur : accueil/paramètres build 18:54 ouverts, en mode
  aperçu synthétique. Production sur origine vierge : landing puis bouton
  « Se connecter », contrôle froid et vraie page de connexion ouverts, sans
  saisie de credentials. Pas de recette de session Google ni de migration
  isolée. Les deux onglets de test ont été fermés ; l'onglet tryarty utilisateur
  et son brouillon n'ont pas été modifiés.
- Pas de métriques de production latence/taux d'erreur : contrôle ponctuel de
  version/disponibilité uniquement. Reçus Cloudflare lus par GitHub, pas
  d'accès API Cloudflare direct ni contournement d'authentification.

### W06 A3b.1 — admission du stockage livrée (#453)

- PR [#453](https://github.com/flotellop-art/Arty/pull/453), head
  `39405506857888966c659f806835e55ee3087bf0`, squash main
  `ffd9bf69ee5a0d09ceed219c84e03fab5fa2efdc` ; fusion 18:07:07 UTC.
- CI PR `33982796853` et main `33983051454` réussies (web, Android,
  orchestrateur). Pages preview `49d1726c-ef33-465e-a216-d3a905963890` et
  production `1e1b6381-9e51-4c20-864f-e8964f0aac17` réussis.
- Distribution Android `33983051469` réussie, étapes APK signé et Firebase
  App Distribution confirmées ; pas de recette APK installé sur appareil.
- tryarty.com et URL immuable production servent le même asset d'entrée
  `/assets/index-_bsPvJWd.js`, HTTP 200, 254 221 octets, SHA-256
  `4c1ee5b4c3a30bb185d0a04989ce45352436aba0dce37bba40b52b507ae9cd2d`
  (sonde publique 18:10:26 UTC). Connexion du build principal ouverte en
  navigateur sur origine vierge, sans compte réel ni seed démo.
- Sonde répétée à 18:16 UTC : mêmes HTTP 200 et empreinte. Pas de mesure
  continue de latence/taux d'erreur ; API Cloudflare directe non authentifiée,
  reçus de déploiement lus via les check-runs GitHub autorisés.

Contrôle readonly avant tout chargement privé, deadline/cancellation et
résolveur explicite legacy-v1. Aucune migration, écriture de contrôle,
restauration ou synchronisation ajoutée. Décisions, limites et repli dans
`ADR_WORKSPACE_BACKUP.md`, section A3b.1.

Deux GO indépendants après prise en compte du getter de fichier à owner
explicite et du libellé Android. `npm run verify` : 255 fichiers / 2 806 tests
réussis + 1 ignoré, typecheck front/back, couverture, no-CASA, build et worker
Office verts. Log `../arty-workspace-admission-verify-final-20260905.log`.
Recette navigateur locale synthétique : maintenance puis reload avec URL et
state/verifier conservés, zéro chargement privé ; format incompatible expliqué,
pages publiques accessibles, vraie connexion ouverte sur origine vierge.
L'onglet tryarty de l'utilisateur et son brouillon n'ont pas été modifiés.

Compromis produit explicite : si IDB ne peut pas être contrôlé, le login privé
reste fermé même pour une première visite ; une connexion indépendante des
stores nécessiterait un autre lot. Pas de validation OAuth/APK réel, ni de
mesure terrain latence/mémoire. W06 global reste **partiel**.

### W06 A3a — préparation de restauration livrée (#452)

- PR [#452](https://github.com/flotellop-art/Arty/pull/452), head
  `0e176201570524905d51a062e19537114f9dc8d1`, squash main
  `e9275fa920fac16e6b00b929b6aca2ae16f58a15`, fusion le 5 septembre à 17:23 UTC.
  CI PR `33980559723` réussie (web, orchestrateur, Android). Preview Pages
  `fca2ee5a-f3f0-4d61-8076-98f5b0af4e20` réussie ; accueil/paramètres build
  `2026-09-05 17:19` vérifiés dans le navigateur, archive refusée en mode aperçu.
- Pages production `fa34dbe2-6a69-4252-8474-80433ea1b434` réussie pour ce main.
  `tryarty.com` et l'URL immuable servent en HTTP 200 le même
  `/assets/index-CrliE4Mg.js`, 241 763 octets, SHA-256
  `35f34f34cce6b11c8269de7afab320a51bbb200999967d20f3f935aa83a4dc79`.
  CI main `33980833231` et build/distribution APK `33980833236` réussies au
  contrôle final. Cela atteste la chaîne Android, pas un APK installé/testé
  sur appareil. Aucun taux d'erreur/latence de production ni mesure RAM natif
  n'est déduit du smoke HTTP ou de la recette synthétique.

- Service pur de projection A1/v2, graphe multi-conversations/projets conservé,
  nouveaux IDs par domaine/parent, fichiers partagés et références historiques
  absentes remappés. Aucun lookup du compte cible, aucune écriture/migration.
- Marque persistante des messages restaurés : anciens boutons/liens inactifs,
  texte original disponible à la copie/export, vérification historique non
  relancée ; les nouvelles réponses et commandes explicites restent utilisables.
- Reprise de mapping exacte et liée à l'archive, pas une restauration durable.
  Pas de journal, admission de capacité, publication ou synchronisation. W06
  reste non livré dans son ensemble. Détails, conséquences et préconditions
  A3b/A3c dans `ADR_WORKSPACE_BACKUP.md`.
- 30 tests du planner verts. `npm run verify` final : 254 fichiers,
  2 764 tests réussis + 1 ignoré,
  TypeScript front/back, couverture, no-CASA, build et worker Office réels verts.
  Log local `../arty-workspace-restore-verify-final-20260905.log`. Avertissements de
  taille de chunks préexistants ; aucune mesure de pic RAM natif.
  Contre-revues finales sécurité et fidélité : deux GO, après correction d'un
  replay falsy ; 32 tests ciblés revérifiés par le reviewer sécurité. Deux cas
  complémentaires ajoutés sur demande du reviewer produit : archive sans
  aucune conversation et présentations divergentes du même fichier.
- Recette navigateur local réelle sur messages synthétiques : texte/tableau
  lisibles, ancien bouton sans effet, anciennes ancres absentes, pending
  historique affiché ; nouvelle action et commandes export/signalement
  explicites fonctionnelles avec callbacks simulés. Aucun événement Agenda,
  export personnel ni clipboard réel déclenché. Aucun test de restauration
  effective ni d'APK implicite ; l'onglet tryarty.com et son brouillon sont
  restés intacts. Fixture locale ignorée `.playwright-mcp/restore-history.*`.

Repli prévu : revert du lot par Git/CI/Pages tant qu'aucun publisher n'existe.
Ne pas utiliser ultérieurement un ancien bundle sans inertie pour des données
effectivement restaurées. Déclencheurs : régression du chat ordinaire, bouton
historique actif ou traitement réseau automatique d'un message marqué.

### Prérequis W06 — exécution image livrée (#447)

- PR [#447](https://github.com/flotellop-art/Arty/pull/447), squash main
  `0cb637f458afab3b65f9268235223669ffcff132`, fusion le 5 septembre à 09:25 UTC.
  CI PR `33957766155`, main `33957967001` et Android `33957967008` vertes.
  Pages production `861d056a-40a2-4e10-87cc-6968db34d39f`, HTTP 200 et bundle
  `/assets/index-B8PwHIHS.js` attestés à cette livraison avant pause/migration.
  Reprise sur D: : SHA main revérifié, pas de copie écrasée ni d'effacement.

- Défauts reproduits : résultat d'image commencé sous A pouvant être stocké
  sous B après switch ; outil absent du catalogue EU mais exécutable au handler
  global ; annulation de clé/fence convertie en texte puis boucle poursuivie.
- Permission locale hors arguments du modèle, figée à l'invocation Claude,
  non-EU/non-documentaire, hors action rapide, intention cherchée dans le texte
  utilisateur brut. Détection conservatrice, pas garantie de compréhension :
  elle refuse aussi des formulations légitimes (« sans fond », « without text »).
- Compte/epoch/crypto/barrière d'effacement capturés ; token et BYOK ne sont
  pas recapturés sous le compte suivant. Signal réseau et garde avant/après
  attente ; fence durable relue après réponse, avant repli et autour du stockage.
  Propriétaire explicite et garde interne de transaction fichier, abort avant
  commit en cas d'invalidation. Une annulation tardive après commit empêche la
  restitution, mais ne promet pas de supprimer le blob déjà écrit.
- Les exceptions image atteignent le hook : abort/démontage uniquement de
  l'invocation correspondante, pas d'un nouvel essai. Aucune poursuite automatique
  après annulation ni fallback Flux→OpenAI sur échec ambigu. Le repli subsiste
  uniquement pour les refus explicites 403/503 ; quotas et providers inchangés.
  Stop ne garantit pas l'annulation d'une facturation serveur déjà engagée.
- Enveloppe base64 bornée à 10 Mio décodés, signatures PNG/JPEG/WebP et types
  allowlistés ; ce contrôle intervient après JSON et ne prouve ni décodabilité
  complète, ni borne avant allocation JSON, ni protection contre toute bombe
  de dimensions d'image. Aucun média privé utilisé dans les tests.
- Deux GO indépendants après correction de deux catches qui absorbaient encore
  l'annulation. Tests avec vrais hook/dispatcher/handler/crypto et transactions
  fake-indexeddb, réseau simulé : rotation de clé, A→B→A, fence LS/IDB, Stop,
  réponse et stockage tardifs, zéro seconde génération ; pas de recette native.
- Recette finale : `npm run verify` réussi, **237 fichiers / 2 538 tests**
  (49 nouveaux tests), 1 interop sauvegarde ignoré sans fixture. Typecheck
  front/back, couverture, addon/no-CASA, build et smoke worker Office verts.
  Bundle principal 1 019,97 ko / 319,70 ko gzip ; avertissement de taille
  préexistant. Aucun nouvel abonnement, secret serveur, endpoint ou migration.
- Rendu et références locales attestées, image créée avant premier token,
  traitement des orphelins, capture/restauration sont le lot suivant. Aucun
  bouton de sauvegarde ni changement du format A1 dans ce correctif.

### Prérequis W06 — galerie privée livrée (#448)

- PR [#448](https://github.com/flotellop-art/Arty/pull/448), head
  `618eb011ee50fe895f101db07af357312c19c0f2`, squash main
  `6578001886a35fe82ece9319cdbae0d6fe2e12aa`, fusion le 5 septembre à 11:47 UTC.
  CI PR `33964079985` verte : app, orchestrateur et Android. Pages production
  `cbb89bee-5d7f-4304-8601-5c0fb035f9e4` verte. tryarty.com HTTP 200 et asset
  `/assets/index-BXM1jcZL.js` HTTP 200 ; garde d'adoption, invalidation privée,
  omission galerie et concurrence rappel présents dans l'asset réellement servi.
  Le hash du build local diffère du build de production ; il n'est pas présenté
  comme celui servi. CI main `33964266481` et distribution Android `33964266485`
  terminées avec succès. Un APK distribué ne prouve pas son installation ni
  la recette de partage natif sur l'appareil de l'utilisateur.

- Les images reçues par l'outil sont attachées structurellement au message,
  avant poursuite du modèle. Une réponse sans texte reste enregistrable ;
  Stop/erreur après un premier reçu le conserve. Les tentatives, même échouées,
  sont limitées à quatre par invocation et ne sont pas parallélisées. Une
  annulation de session/clé/fence abandonne le flux sans écriture tardive.
- Adoption avec copie avant écriture : quota plein sans reçu fantôme en RAM,
  reçus précédents préservés. Normalisation du placeholder interrompu lors de
  la lecture à froid et avant nouvel envoi, jamais réarmement automatique de
  sa galerie après invalidation. Les rappels locaux réservent aussi leur fil
  et vérifient compte/epoch/historique après attente avant toute réécriture.
- Galerie privée chargée à proximité de la vue, lectures binaires sérialisées,
  déchargement hors écran et révocation des URLs après invalidation. Attente
  du premier démarrage crypto sans renouveler silencieusement une ancienne
  autorisation. Boutons tactiles de 44 px. Téléchargement du format réellement
  stocké (PNG/JPEG/WebP), sans promesse d'original non normalisé.
- Aucun résolveur d'ID dans Markdown/HTML/public. Les exports JSON/MD/PDF,
  partage, livrables Office et signalements indiquent l'omission d'images sans
  incorporer ID ni binaire privé ; le JSON réimporté n'autorise pas de fichiers
  locaux. Un signalement très long reste borné à 2 000 caractères et peut
  tronquer la notice finale ; les images ne sont pas transmises.
- Retry/régénération/édition préservent l'original par une branche si une image
  serait remplacée ; avertissement de nouveau coût, branche sélectionnée et
  navigation alignée. Suppression respectant les références des autres branches,
  texte legacy limité à la rétention. Aucun nettoyage global d'orphelins.
- Deux GO indépendants après objections corrigées : second outil en erreur,
  adoption avec quota plein, amorçage crypto, libération hors écran, réarmement
  live→placeholder, annulation durable IDB et rappel asynchrone concurrent.
  Recette globale : **241 fichiers / 2 596 tests verts**, 1 interop conditionnel
  ignoré sans fixture ; front/back, couverture, addon/no-CASA, build et smoke
  worker Office. 58 tests supplémentaires par rapport à #447, aucune dépendance.
  Build final local : `index-1JMViGZj.js`, 1 030,02 ko / 322,84 ko gzip ;
  avertissement de taille préexistant, pas de nouvelle dépendance.
- Recette visuelle Chrome sur origine localhost isolée avec icône Arty publique
  synthétique : thème clair bureau, sombre à 390 × 844, image sans texte dans
  réponse interrompue, déchargement hors écran (une seule image DOM), invalidation
  (zéro image DOM), Markdown legacy indisponible. Pas de compte réel, d'appel IA,
  ni de publication de données. Le bouton de téléchargement a été activé sans
  erreur dans la page, mais la réception du fichier n'a pas été attestée par
  l'outil navigateur ; elle reste à vérifier. Pas de recette Android native.
  Page de test temporaire retirée, serveur arrêté, viewport Chrome rétabli.
- A2 capture/restauration/UI et synchronisation restent non livrées. Le lot ne
  change ni format A1, ni quota serveur, ni configuration Cloudflare/Google.

### W06 A2 — réservation document livrée (#449)

- PR [#449](https://github.com/flotellop-art/Arty/pull/449), squash main
  `cddf6bc43e3681d625935e5745fcee60971dba44`, fusion le 5 septembre à 12:56 UTC.
  CI PR `33967235536`, CI main `33967461197` et distribution Android
  `33967461234` vertes. Pages production
  `9d081c4c-0ac4-4645-873b-b248e084cbdd` ; tryarty.com HTTP 200 et bundle
  `/assets/index-D64o8VTi.js` servi (232 650 octets, verrou document présent).
  Vérification globale : 245 fichiers, 2 639 tests verts + 1 conditionnel ignoré ;
  front/back, couverture, build, no-CASA et worker Office verts.

- Un seul document privé par origine/profil, avant import App/useAuth/preview,
  connexion comprise. Aucun release sur logout/switch/visibilité/cleanup React.
  Occupé/indisponible/erreur distincts ; Retry explicite, sans voler le verrou.
  Landing publique, discover et partage restent hors authentification ; callback
  Google reste derrière la gate sans consommer son state pendant l'attente.
- Remplace le prototype non intégré de bail par compte ; deux contre-revues GO
  après corrections du fallback lazy, compatibilité `?start` et contraste AA.
  Tokens de compte/époque/crypto existants conservés ; garde document supplémentaire
  aux frontières de persistance et annulation des transactions fichiers/projets.
- 43 tests nouveaux ; recette Chrome réellement multi-onglets : exclusion,
  Retry, fermeture et relecture exacte du titre/fichier, rollback transaction IDB
  à fermeture, reload et détour externe/callback synthétique/Back/Forward. Vrai
  point d'entrée pour les routes publiques et privées ; format mobile 390×844.
  Pas d'échange OAuth réel, de perte forcée dans App complet ni de recette Android.
- Préproduction Pages `8125319c.appfacade.pages.dev` : vrai App démo, renommage
  d'une conversation synthétique dans A, B occupé, fermeture A puis Retry B ;
  relecture du titre exact dans B. Production : deux documents `/login`, le
  second occupé comme attendu. Le premier a révélé une route authentifiée
  `/login` manquante (sidebar seule), corrigée dans le suivi ci-dessous.
- Aucun changement de schéma ou données, pas de protection contre legacy ni de
  journal/restauration/sync. Capture et reprise complète restent non livrées.
  Décision, périmètre de la défense après perte et repli :
  [ADR](ADR_WORKSPACE_BACKUP.md#révision-du-5-septembre--réservation-par-document-lot-coopératif).

### Suivi de recette — entrée login avec session existante livrée (#450)

- PR [#450](https://github.com/flotellop-art/Arty/pull/450), squash main
  `af688a2ddcbddb81931a9ea9ffbaab63cd4719c5`, fusion le 5 septembre à 13:18 UTC.
  CI PR `33968309103`, CI main `33968517141` et distribution APK Firebase
  `33968517033` vertes. Pages production
  `d8ae3cd7-6779-441d-90cd-8e6ffc3b1e0d` ; tryarty.com et son bundle
  `/assets/index-D3rsfy-q.js` HTTP 200 (232 650 octets).

- Route `/login` ajoutée uniquement dans AppContent authentifié : retour `/`
  avec remplacement de l'entrée d'historique. Aucun paramètre `next`/`redirect`
  interprété, ni login relancé, ni state/verifier OAuth consommé. La connexion
  anonyme et `/auth/callback` restent leurs routes distinctes derrière la gate.
- Deux contre-revues préalables en lecture seule ; régression reproduite par
  trois échecs de rendu avant correction, puis cinq tests du vrai routeur App
  verts (hooks privés et corps d'écrans isolés). Inclut `/login/`, query/hash,
  transition anonyme → connecté et callback réel avec handler synthétique.
  Ce test ne prouve ni une authentification réelle, ni le rendu natif.
- `npm run verify` : 246 fichiers, 2 644 tests verts + 1 conditionnel ignoré ;
  types front/back, couverture, build, no-CASA et smoke worker Office verts.
- Deux contre-revues finales GO. Chrome préproduction réelle
  `dd7c758b.appfacade.pages.dev` : `/login/` avec query/hash → accueil `/` ;
  `/discover` → Se connecter → accueil → Back vers `/discover` → Forward vers
  l'accueil, sans boucle ni shell vide. Données démo uniquement.
- Chrome production avec session existante : `/login` → accueil complet `/` ;
  deuxième document occupé, fermeture du premier puis Retry → accueil complet.
  Aucune conversation créée/modifiée, aucun logout ; onglets de recette fermés.
  Ni nouvel échange Google ni recette d'APK installé revendiqués.

### W06 A2 — capture/vérification d'une conversation (5 septembre)

Implémentation locale : menus conversation classique et sheet, projet entier en
option, archive v2, code séparé et acquittement avant remise, fichier re-sélectionné
avec code, contrôle ID/fingerprint. Vérificateur autonome dans les paramètres.
Ce lot n'est ni une restauration, ni une sauvegarde complète du compte, ni une
synchronisation. Il ne migre/efface aucun store utilisateur.

Preuves locales :

- `npm run verify` final vert : 251 fichiers, 2 709 tests réussis, 1 ignoré,
  soit 65 tests supplémentaires depuis #450 ; typechecks frontend/Workers,
  coverage, build et worker Office isolé réussis. Les avertissements de taille
  de chunks restent visibles ; ils ne sont pas une mesure de mémoire mobile.
- Tests réels stores/WebCrypto : toutes les dépendances directes, trois tailles
  historiques/binaire, aucune écriture source ni création de base, galeries
  malformées, aucun accès via Markdown, A→B→A, effacement, erreurs illisibles,
  mutation avec même timestamp ou sans save, snapshot atomique de deux fichiers,
  projet modifié pendant lecture, token readonly fermé, mauvais code/autre
  archive, annulation pendant chiffrement, UTF-16 invalide/BOM valide.
- Hook réel : préparation de fichier suspendue avant stream, vrai pipeline
  fact-check en attente du jeton de récupération de liens avant pending (aucun
  appel réseau), association projet suspendue, compteur isolé par conversation.
- UI : acquittement, code absent du partage, aucune fausse confirmation de
  fichier enregistré, vérification indépendante après mutation, révocation
  terminale sur composant monté, résultat tardif ignoré, fermeture/relance,
  Tab/ShiftTab, paramètres inline, absence d'interception du sous-dialogue mail.
- Chrome réel, harnais local utilisant les vrais stores/composants : menu fermé,
  création de 1 conversation / 2 messages / 1 fichier / 1 projet / 1 document.
  Téléchargement réel de l'archive synthétique
  `b1c05b3e-2cc4-4449-8a87-97db3d3d651c`, 2 281 octets, puis réouverture du
  fichier effectivement enregistré et assertions sur octets, source CRLF et
  texte extrait LF. Aucune donnée personnelle exportée, aucun appel IA.
  Cette lecture fichier n'est pas une recette du sélecteur natif dans l'APK.
- La recette de la vraie app sur Pages a révélé que le mode démo n'a
  intentionnellement ni crypto ni compte connu. Les deux vues montrent désormais
  une notice avant toute saisie, sans assouplir les services ni initialiser une
  clé de démonstration. Détection de la méthode de session, pas de l'hôte : un
  vrai compte sur un hôte preview garde son parcours. Trois tests UI ajoutés.
  Notice contrôlée dans Chrome sur `74c27235.appfacade.pages.dev` : menu
  conversation et vérificateur des paramètres, sans champs de fichier/code
  ni possibilité de création dans cette session de démonstration.

Pré-déploiement / retour arrière :

- Deux contre-revues indépendantes en lecture seule, avec corrections des
  objections de fidélité, course, révocation du code affiché et focus.
- `npm run verify` complet et CI de PR requis avant fusion. Publication par
  la chaîne existante uniquement, contrôle du SHA et des assets Pages.
- Aucun changement de schéma des bases source ni variable serveur requise.
  Ne pas effacer les données/archives pour revenir en arrière : corriger en
  avant ou revert de PR via CI. Un client antérieur à v2 ne relit pas une archive
  v2 ; garder une version du lecteur v2 disponible avant rollback produit.
- Arrêt/retour arrière si une capture écrit la source, divulgue le code au
  partage, remet un artefact après révocation ou si le parcours privé ne charge
  plus. Télémétrie serveur et pic RAM/partage APK non vérifiés localement.

Reçus de livraison du 5 septembre :

- PR [#451](https://github.com/flotellop-art/Arty/pull/451), fusion normale
  après CI/Pages vertes sur `eeacbea98da5e274c3982c3457eac0e6e7ba7b29` ;
  main `7a800462a3eca5faee937f932b87fe9066d65b95`.
- CI PR `33977381905` et CI main `33977643337` réussies
  (app, Android, growth). Aucun contournement de l'échec précédent.
- Pages production `2712747d-fd83-46be-add2-7e2677ba2067` réussie ;
  `tryarty.com` et l'URL immutable servent `/assets/index-iF9m96dT.js`,
  HTTP 200, 241 300 octets. Chrome réel affiche build `2026-09-05 16:22`.
- Session réelle : accueil puis paramètres → vérificateur local, champs
  fichier/code présents, bouton désactivé tant qu'ils sont vides. Aucun export
  personnel, changement de compte, suppression ou appel IA pendant ce smoke.
- Build et distribution APK Firebase `33977643335` réussis sur le même SHA.
  Ce succès n'est pas une recette du partage Android installé.

W06 reste **partiel** : cette livraison permet capture/vérification seulement.
La re-sélection native APK, le pic mémoire Android et la télémétrie serveur
restent non attestés ; aucune restauration/synchronisation annoncée.

### W02 — débit d'essai D1 tardif révélé pendant la CI de #451

- La CI `33974694368` a refusé #451 sur le cas Gemini HTTP 401 :
  `trial_usage.used=1` au lieu de 0. Son journal montre un timeout D1 de
  250 ms immédiatement avant le refus. Défaut préexistant, pas une erreur
  d'archive : le timeout ne termine pas l'UPSERT et son résultat était perdu.
- Reproduction avant correctif : deux tests avec vrai D1/SQL, résultat retenu
  jusqu'après la réponse HTTP 401/200, échouent avec un débit résiduel.
- Politique retenue pour les essais Google et e-mail : timeout = appel offert,
  même si l'IA réussit. La promesse exacte de l'écriture est conservée et suivie
  par `waitUntil` ; seul un `RETURNING` confirmant une consommation déclenche
  une compensation. Aucun rejeu SQL, aucune remise sur résultat nul/rejet,
  aucun marqueur `trialDebited` sur ce chemin déjà compensé. Les cinq proxys
  transmettent le contexte de fond ; sans ce contexte, l'appel direct attend
  et retourne l'issue finale réelle, sans garantie de latence de 250 ms.
- Tests : les timers de quota des cas D1 sont pilotés indépendamment de ceux
  de workerd ; le délai de 250 ms est vérifié avec une horloge virtuelle. Commit avant
  deadline et commit après réponse, HTTP 401/200/fallback 503→200, compteur
  initial 7 et autre appel réussi conservé à 8, espaces Google/e-mail disjoints,
  résultat tardif nul à la limite de 30, rejet tardif, échec d'enregistrement,
  absence de waiter, pas de retry de compensation. Garde d'ordre vision OpenAI
  conservée et adaptée au troisième argument, sans affaiblir ses assertions.
- Deux contre-revues readonly : objections intégrées (double remboursement,
  attente sans contexte, horloge des tests, ancienne signature structurelle).
  Suite complète finale `npm run verify` : 252 fichiers, 2 725 tests réussis
  + 1 ignoré, typechecks app/Workers, coverage, build et worker Office isolé
  verts ; CI finale PR/main verte, correctif inclus dans la livraison #451.
- Limites : `waitUntil` et les remboursements restent best-effort, pas un
  journal durable face à une panne prolongée ou un commit D1 ambigu. Les caps
  premium et compteurs free/rate-limit partagés ne changent pas de politique
  dans ce correctif ; le cap premium garde un risque de débit tardif distinct
  à traiter. Aucun changement de schéma, de secret ni effacement de compteur.

### W06 A2 — contre-revues de préparation après #448 (historique)

- Deux lectures indépendantes (writers/sécurité et inventaire/produit) et
  vérification du code par l'agent principal. Découpage proposé dans l'ADR :
  coordination des écritures et bascule legacy d'abord, puis inventaire exact,
  capture, écriture de restauration journalisée et parcours complet en copies.
- Une archive A1 valide n'est pas nécessairement admise par l'UI de galerie ;
  les contraintes de rôle/nombre/MIME doivent être vérifiées avant staging.
  Les IDs source d'A1 sont remappés, pas refusés parce que non UUID.
- Ne pas utiliser les getters UI permissifs pour conclure à un workspace vide,
  ni `putFile`/réimport projet pour restaurer des octets et textes exacts.
  Différences de métadonnées entre message et fichier à diagnostiquer ; aucun
  choix silencieux. Tags autonomes, chaînes et ordre à conserver.
- Un verrou limité au bouton Restaurer ne protège pas la liste complète
  réécrite depuis un cache ancien. La proposition minimale gardant le CRUD
  synchrone est un writer unique pour toute sa session d'édition. Les autres
  fenêtres doivent attendre ou rester en lecture seule, puis recharger les
  données sous un nouveau bail avant toute écriture. Les effets asynchrones
  doivent conserver le bail initial, pas emprunter celui d'une nouvelle session.
- Pas de changement du stockage applicatif, de migration, d'upgrade IndexedDB
  ni de clé de production effectué pendant cette préparation. Le profil
  d'admission, les erreurs visibles et le périmètre exact seront testés avant UI.

### W06 — fondation de format A1, non utilisable seule

- PR [#446](https://github.com/flotellop-art/Arty/pull/446), squash main
  `4b2c77b733884caf425494afad4ebffb19d65178`, fusion le 5 septembre à 09:04 UTC.
  CI PR `33956368394` verte après relance du seul job en échec (timeout D1
  wallet préexistant, assertion inchangée). CI main `33956985028` et distribution
  Android `33956985027` vertes. Pages production
  `fee141f0-074b-497e-8413-27bbe71541b2` ; tryarty.com HTTP 200, bundle
  `/assets/index-DHRGpiA_.js`. Aucun parcours de sauvegarde n'est encore branché.

- [Décision d'architecture](ADR_WORKSPACE_BACKUP.md) : A1 format/validation
  locale, A2 capture/restauration additive journalisée/UI, B coffre optionnel.
  Les stockages existants ne sont pas migrés par A1. Aucun appel réseau ni
  écriture applicative, aucune clé liée à l'authentification utilisée.
- Conteneur sans compression, HKDF-SHA256/AES-256-GCM avec code de récupération
  aléatoire 32 octets, salt/UUID internes, nonce unique par frame, header/préfixe
  authentifiés. Manifeste chiffré strict et objets binaires SHA-256 ; UTF-8 fatal,
  tailles/ordre/EOF vérifiés, aucun résultat avant validation complète.
- Limites : manifeste 4 Mio, objet 10 Mio, 256 objets, 512 frames, blocs 256 Kio,
  60 Mio plaintext manifeste compris, archive 64 Mio. Limite de frames défensive
  (les autres limites peuvent être atteintes avant). Pas de lecture du fichier
  entier ; hash WebCrypto par objet, donc jusqu'à 10 Mio temporaires et résultat
  Blob jusqu'à 60 Mio, sans promesse de pic RAM équivalent.
- Deux objections reproduites puis corrigées : JSON très profond alloué avant
  contrôle (préflight lexical avant JSON.parse ajouté) et méthode `toJSON`
  cachée dans un tableau (prototype/propriétés vérifiés avant stringify).
  Pas de parser Markdown implicite : `embeddedFiles` déclare les dépendances
  d'image. A1 prouve le graphe déclaré ; A2 devra attester la complétude du
  capteur et interdire tout fallback vers un ID brut du compte destinataire.
- Fidélité : originaux/textes/version/descripteurs liés ; provenance historique
  non incluse admise et signalée, sans prétendre que le fichier est supprimé.
  EU/Google/document conservés, recadrages normalisés et sources non
  relocalisables signalés. Intention rapide et preuve de fact-check allowlistées,
  aucune reprise de traitement. Secrets de configuration exclus, pas les
  secrets volontairement collés dans le texte ; autres exclusions dans l'ADR.
- Vérification de stockage cloud : accès Wrangler local expiré. Pas de login
  forcé, nouveau bucket ni service payant activé. R2/D1 restent à choisir après
  inventaire authentifié ; cette attente n'empêche pas A2 local.
- Recette A1 finale : **76 tests permanents** + **1 interop conditionnel**,
  **77/77** exécutés avec fixture. Python `cryptography` **50.0.1** relit
  l'archive TypeScript, compare 4 objets artificiels octet par octet et produit
  une seconde archive relue par TypeScript. Script reproductible
  `scripts/check-workspace-backup-fixture.py`, variable de test
  `ARTY_BACKUP_FIXTURE_DIR`. Aucun contenu personnel ni vrai code utilisateur.
  Test indépendant du reviewer à exactement 10 Mio également réussi.
- Suite globale finale : **232 fichiers / 2 489 tests réussis**, 1 test interop
  ignoré sans fixture (exécuté séparément ci-dessus). Typecheck front/back,
  couverture, addon/no-CASA, build et smoke du worker Office verts. Un premier
  run a rencontré le timeout D1 du test wallet 4 images (503 au lieu de 402) ;
  7 tests wallet isolés puis suite complète réussis, aucun délai/quota de
  production ni test de facturation modifié. Deux GO indépendants A1 après
  les corrections. Aucun navigateur/appareil disponible dans l'inventaire de
  contrôle ; la recette ne vaut pas validation visuelle ou restauration réelle.
- Repli A1 : revert Git ; aucune migration, aucun changement de route/API,
  aucun composant utilisateur branché. Ne pas annoncer « sauvegarde disponible »
  ni « synchronisation terminée » sur la base de ces tests de format.

### W05 — livrables modifiables, web livré #445

- PR [#445](https://github.com/flotellop-art/Arty/pull/445), squash main
  `a33167afa9ba0ac3b35510b077f1df6afb22f84c`, fusion le 5 septembre à 08:11 UTC.
  CI PR `33953915756`, CI main `33954567051` et distribution Android
  `33954567050` vertes. Pages production
  `dd370ea1-99b6-4a88-a29e-ec16e047e42f`. HTTP tryarty.com : 200, bundle
  `/assets/index-DuS-baT3.js`. Preuve de version servie, pas de recette visuelle.

- Décision de périmètre : export des échanges déjà conservés, pas génération
  d'un nouveau document par une IA ni éditeur intégré. Un bouton par réponse
  assistant stable et une entrée Word/Excel dans les deux menus du fil.
  Fragments `streaming` exclus ; réponses interrompues signalées et confirmées.
- Compétence DOCX appliquée : docx-js **9.7.1** dans un worker externe Vite,
  A4 explicite 11 906 × 16 838 DXA, marges 1 440, Arial, titres natifs avec
  niveaux, listes numérotées/pucées natives et reprises à leur valeur initiale,
  tableaux à largeurs DXA cohérentes, marges internes, fond `CLEAR`.
  `remark-parse` 11.0.0 et `unified` 11.0.5 deviennent dépendances directes,
  versions déjà présentes transitivement. Aucun nouvel avis npm : les 13 avis
  préexistants restent à traiter séparément, sans `audit fix --force`.
- Recette du véritable bundle worker : une VM sans DOM/process/require/fetch
  a détecté la résolution erronée de `decode-named-character-reference` vers
  sa variante navigateur DOM. Alias exact vers l'export pur (version 1.3.0
  déclarée directement), aussi en développement. Le rendu Markdown principal
  utilise le même décodeur pur. `npm run verify` exécute désormais le smoke
  du bundle construit, sans réseau ; fichiers DOCX/XLSX synthétiques produits
  par ce bundle et relus à nouveau avec les trois validateurs : PASS avant
  publication. Cette VM ne constitue pas un navigateur ni une preuve de CSP.
- Markdown/GFM source traité séparément par message, jamais le DOM du rendu.
  HTML/images explicitement omis, liens rendus comme texte sans relation
  externe, tableaux dans du code non reconnus comme tableaux de données.
  Première définition de lien gagnante, même imbriquée ; aucune définition
  d'un tour ne modifie un autre tour. Les annexes `[S1]`, noms, révisions,
  hashes et lignes extraites restent propres au message, non certifiés.
  Bibliothèque supprimée/détachée non relue et non exigée pour cet export.
- XLSX : paquet OOXML minimal via fflate, feuilles sélectionnées et feuille
  Informations, numéros de tableaux d'origine conservés. **Toutes les cellules
  sont du texte typé `inlineStr`**, y compris nombres, `0012`, téléphones,
  dates, expressions `=`, `+`, `@` et longs entiers. Aucune conversion de locale,
  formule, macro, nom calculé ou lien externe. L'utilisateur peut convertir
  les valeurs dans Excel ensuite. Aucun calcul créé, donc pas de formule à
  recalculer. Littéraux `_x0041_` échappés selon ST_Xstring ; caractères XML
  invalides/surrogates isolés refusés, pas remplacés silencieusement.
- Ressources : 50 messages, 200 000 caractères source/métadonnées, 4 000 lignes
  et 4 000 caractères/ligne, précontrôle linéaire des marqueurs/préfixes de
  listes/citations AVANT micromark. Puis 20 000 nœuds/runs, profondeur 24,
  400 000 caractères développés (liens compris), listes sur 6 niveaux,
  32 tableaux/10 000 cellules, 1 000 lignes/16 colonnes par tableau et 8 192
  caractères par cellule ; Word limité à 8 colonnes. Refus explicite sans
  troncature. Worker isolé, concurrence un export, timeout parse 10 s/pack
  30 s, sortie comprimée max 12 Mio. Ce sont des budgets de contenu et de
  durée, pas une garantie absolue de pic mémoire ni de pagination.
- Snapshot allowlisté avant toute attente, compte/epoch/crypto et fence
  d'effacement capturés, contenu relu dans le cache canonique avant effet.
  Changement de session/contenu, annulation, démontage ou timeout terminent
  le worker ; l'aperçu est effacé et le consentement ne se réactive pas.
  Validation durable avant livraison puis avant/après écriture native.
- Livraison locale : téléchargement web ou Cache + FileProvider/feuille
  système sur Android, nom physique UUID avec extension MIME correcte.
  Verrou partagé avec JSON/MD/PDF/GPX ; inventaire doit être lisible ; 32
  copies récentes maximum. Nettoyage des seuls fichiers reconnus âgés de
  24 h au prochain export, pas une promesse de purge quand l'app est arrêtée.
  Une écriture annulée avant partage est supprimée à son chemin exact
  (échec de nettoyage possible : cache OS/prochain passage TTL). Une fois
  le partage engagé, ne pas supprimer immédiatement ce qu'un destinataire
  lit encore. Les fichiers sont non chiffrés ; les copies externes ne sont
  pas révoquées et l'ouverture du partage ne prouve pas un enregistrement.
  La génération reste locale ; un service destinataire peut ensuite uploader.
- Erreurs des anciens exports rendues visibles, y compris GPX ; l'annulation
  explicite Capacitor `Share canceled` reste distincte d'une panne/capacité.
  Barre d'actions des bulles mise sur sa propre ligne repliable. Interface
  de ce lot en français V1 (cible du mandat), traduction anglaise différée.
- Contre-revues intégrées : OOM préparse avec listes/citations répétées,
  expansion de liens, définitions imbriquées, sous-liste sans paragraphe
  parent, course de capacité entre deux formats natifs, erreurs GPX avalées,
  numéros/aperçu Excel incohérents et ancienne session encore affichée.
- Recette locale : 64 tests ciblés/6 suites verts. Fichiers synthétiques
  régénérés puis relus avec **python-docx 1.2.0**, **openpyxl 3.1.5** et
  validateur DOCX/XSD de la compétence : PASS. Encodage UTF-8 explicite du
  validateur Windows ; dépendance defusedxml 0.7.1 isolée dans le répertoire
  temporaire de recette, pas installée globalement. Script reproductible
  `scripts/check-editable-export-fixtures.py`. Cette preuve est structurelle,
  pas une validation visuelle de Word/Excel ou d'une application destinataire.
- Vérification globale finale : **231 fichiers / 2 413 tests**, typecheck
  front/back, contrôles addon/no-CASA, couverture et build verts. Deux GO de
  contre-revue, puis nouvelle revue du décodeur : 2 130 entités comparées sans
  différence entre variantes DOM/pure et 37 tests Markdown/export verts.
  Smoke du vrai worker ajouté à la CI et borné par un processus de 45 s.
  Bundle principal 1 017,68 kB (gzip 318,75) ; Markdown 541,84 kB (gzip
  167,90), coût du décodeur pur ; worker chargé à la demande, pas dans le
  bundle principal. Avertissements de taille préexistants, pas masqués.
- Repli : revert Git du lot, déploiement Pages normal ; aucune migration de
  données. Les fichiers déjà exportés restent des copies utilisateur. Ne pas
  modifier un ancien APK installé en place ; distribution d'un nouveau binaire.

### W04 — conversations documentaires, web livré #444

- Publication confirmée : PR #444, main
  `efc6982fc4129eb7959a981e546668b9dd84537f`. CI `33952270263` et distribution
  Android `33952270239` vertes. Pages production
  `9882cbfd-0120-4002-8f5d-4c7ec507a8b0`. Vérification HTTP tryarty.com : 200,
  bundle `/assets/index-Cm9RW2Mr.js`. Ni le HTTP ni la CI Android ne remplacent
  une recette visuelle ou une installation réellement observée.

- Depuis un projet, ouvrir une conversation liée ; dans un chat, associer ou
  détacher une bibliothèque. État lu à l'ouverture, au focus et sur Gérer :
  prêt, verrouillé, supprimé ou indisponible. Une association disparue reste
  détachable. Association clonée/CAS local de contenu : quota de stockage ou
  suppression pendant attente ne publie ni faux changement ni chat ressuscité.
- `hasProjectContext` durable, dérivé aussi des références historiques. Après
  détachement/suppression, branche et import : lecture seule conservée. EU
  monotone ; impossible de rebaptiser EU un ancien fil non-EU déjà rempli :
  ouvrir un nouveau chat pour ce projet. Pas de nouvelles autorisations serveur.
- Chaque message de chat projet a deux étapes locales : sélection des sources
  et mode recherche/aperçu, puis confirmation du destinataire, question
  effective (action rapide comprise), consignes principales, budget, noms des
  pièces jointes, révision et extraits exacts. Recherche sans résultat n'active
  jamais l'aperçu automatiquement ; envoi sans nouvel extrait explicitement
  libellé. Repères de lignes partielles et sélection partielle visibles.
- Préparation unique propriétaire/epoch/crypto/fence, convo/historique,
  projet/révision et choix de sources. Identité propre de dialogue : un ancien
  clic ne confirme pas la requête suivante. Stop/démontage/changement de compte
  ou refus laisse texte/historique intacts. Retry et édition préparent d'abord
  puis remplacent atomiquement ; les sources sont celles de la bibliothèque
  actuelle, pas une prétendue reproduction identique de l'ancien appel.
- Relire projet/fence après accord, après stockage des pièces et après les
  headers d'authentification juste avant le premier HTTP. Snapshot immuable
  après engagement : un renommage/tag/épingle ne perd pas le flux. Contrôle
  structurel léger, owner/epoch/crypto/fence pendant tokens, sauvegardes
  partielles et finalisation. Modifier/supprimer la bibliothèque ne retire pas
  ce qui est déjà transmis ; copie explicite avant accord.
- Lecture seule généralisée au pipeline Office : Claude hors EU, Mistral en
  EU, aucun locator Terra, enrichissement URL/PDF public, outil, rappel,
  mémoire automatique, tâche extraite ou fact-check/récupération de lien.
  Prompt par invocation, sans mémoire locale/Google ni singleton mutable.
  Les instructions du projet restent subordonnées à cette politique.
- Extraits ajoutés aux messages API construits, jamais en remplacement des
  blocs image/PDF/Office. Les pièces texte sont validées base64/UTF-8 avant
  accord ; MIME JSON/XML et aliases PDF normalisés seulement sur le clone
  éphémère. Fichier manquant/illisible ou format non reconnu : refus explicite.
  PDF natif dans les pièces de chat Claude seulement ; pas de PDF dans la
  bibliothèque et refus des PDF en chat projet EU. Pas d'OCR implicite.
- Budget réel agrégé : 200 000 caractères, incluant instructions/historique/
  fichiers texte/extraits et réserve de 32 000 caractères pour règles/date
  ajoutées par les clients ; 20 Mio binaires à part. Le préfixe `data:` d'un
  texte ne le fait pas compter comme binaire. Pas de troncature silencieuse ni
  compresseur cloud. Ce n'est pas une mesure de tokens ni de pic RAM exact.
- Sources/hash/version/lignes figés **par tour**, présents aussi sur réponse
  partielle persistée. Pas de corps de bibliothèque dans les conversations ;
  ces extraits sont seulement dans la requête RAM. [S1] n'est jamais résolu
  depuis le projet courant. UI : sources jointes, pas certification de chaque
  affirmation ; côté user, contexte approuvé n'est pas un reçu fournisseur.
- Résumé annexe = échanges abrégés (2 000 caractères/message), pas relecture
  des documents. Sans outils, garde EU/droits/session/crypto/fence ; aucun
  contenu tardif publié après switch. Scope d'origine aussi conservé avant
  copie/export. Rapports : clé physique fixée avant sanitisation, contrôle
  après chaque await, UUID pour éviter écrasement entre créations simultanées.
- Import JSON borné et capturé avant lecture ; associations et références
  étrangères retirées mais restrictions conservées. Nouveaux IDs pour les
  pièces : un ID importé n'ouvre jamais le fichier local homonyme. Tags/modèles
  invalides refusés. Partage public toujours whitelist sans source technique,
  mais avertissement sur les citations contenues dans le texte. Accord lié au
  contenu, session et ouverture ; Annuler/Escape avant POST interdit celui-ci.
  Après engagement, fermer ne révoque pas un lien éventuellement créé.
- Deux GO indépendants après traitement des courses de dialogue, stockage,
  suppression, exports et partage. Vérification finale locale : **227 fichiers,
  2 355 tests verts (+62)**, couverture, types front/back, no-CASA/addon, build.
  Tests avec fixtures indépendantes Office et vrais clients à HTTP simulé ;
  aucun appel IA payant, aucune publication utilisateur ou suppression réelle.
  Bundle principal ~1 002 ko brut / 313 ko gzip ; avertissement de taille connu.
  Inventaire navigateur encore vide le 5 septembre : aucune recette visuelle
  ni appareil prétendue. CI/Pages/version servie à relever après publication.
- Repli : désactiver les entrées d'association/conversation projet et refuser
  les envois `hasProjectContext`, sans effacer bibliothèques/chats. Garder les
  protections d'effacement #443, restrictions historiques et références. Un
  simple revert vers un client ignorant ces flags pourrait lever la lecture
  seule ; ne pas le présenter comme un rollback sûr. Les anciennes APK doivent
  être mises à jour : distribution CI n'est pas installation ni publication Store.

### W04 — bibliothèque locale et récupération, sous-lot livré #443

- Écran `/projects` depuis la Sidebar : création, renommage, consignes,
  restriction Europe fixe, import séquentiel, recherche/aperçu local, retrait
  de document et suppression confirmée du projet, y compris verrouillé.
  Les consignes non enregistrées bloquent import, navigation interne, création
  et confirmation de retrait de document ; elles peuvent être enregistrées
  ou annulées explicitement. Résultats d'import précédant un échec conservés
  et comptés à l'écran. Remontage AppContent identifié par compte.
- **La version #443 seule ne relie pas les projets aux conversations.** La copie
  l'annonce : les consignes/Europe ne modifient pas les chats existants ; aucune
  API IA n'est invoquée par la bibliothèque. Cette livraison seule ne validait
  pas W04. Le sous-lot suivant ajoute association et détachement, héritage EU monotone, contexte par
  invocation sans mémoire globale, preview avant envoi, références durables,
  partage/import/branch/retry et verrou documentaire de bout en bout.
- Nouveau schéma additif `arty-projects` v1 : manifestes, originaux et textes
  dérivés chiffrés séparément. Les clés physiques, états et compteurs techniques
  propriétaire/projet/révision/taille sont en clair ; noms, consignes, contenus
  et empreintes des originaux sont dans les payloads chiffrés. Pas de garantie
  E2EE avec la clé actuelle du compte, ni sauvegarde multi-appareil.
- CAS de révision + quotas dans une seule transaction IDB. Les mises à jour
  reconstruisent depuis le manifeste canonique, pas depuis un objet UI arbitraire.
  Les octets sont recomptés via un index technique/key cursor sans charger
  les originaux. Source/texte liés dans leurs payloads au propriétaire, projet,
  ID/révision/hash/extracteur ; substitution refusée. Recherche ne lit pas
  les originaux. Import capturé avant lecture, résultat gelé lié à la même
  opération puis consommé après commit ; pas de résurrection d'un ID supprimé.
- Limites : 20 projets/compte, 16 documents/projet, 64/compte, 10 Mio/source,
  50 Mio de sources/compte, 200 000 caractères/document, 500 000/projet.
  TXT/MD/CSV strictement UTF-8 ; DOCX/XLSX via W01. Pas de PDF/OCR ni DOC/XLS.
  Texte trop long refusé, jamais importé silencieusement en préfixe.
- Recherche lexicale locale déterministe, accents normalisés seulement pour
  le score et chevauchement des longues lignes couvrant 64 points Unicode.
  Aperçu générique uniquement après sélection explicite, jamais comme fallback
  d'une recherche sans résultat. Budget de contexte 20 000 caractères incluant
  consignes/références, 20 extraits maximum ; références hash/version/lignes
  extraites, pas de pages Word inventées. Erreur source distincte de no-hit.
- Tombstones sans contenu, bornés à 100/compte pour cette version locale.
  Avant W06, remplacer cette GC par une stratégie d'acquittement sync : ne pas
  réutiliser telle quelle cette suppression des plus anciens tombstones.
  Supprimer une bibliothèque ne retire pas les citations/résumés des chats,
  ni ce qui a déjà été transmis à un fournisseur ; copie explicite.
- Effacement compte : contexte capturé avant token/POST, contrôle avant fetch
  et chaque phase locale. Succès serveur A ne nettoie jamais B. Annulation du
  travail async local avant purge ; marqueur IDB temporaire bloque une nouvelle
  opération projet pendant l'effacement, même si un autre contexte réinscrit A.
  Un reçu serveur **effectivement persisté** permet une reprise locale après
  rechargement sans réutiliser le jeton email déjà révoqué. Requêtes concurrentes
  partagent un ID d'effacement ; un 401 concurrent ne détruit pas un reçu 200.
- Limite explicite : crash/échec IDB entre 200 et enregistrement du reçu ne
  prouve pas le succès serveur. Aucun 401 n'est assimilé à une confirmation.
  Après erreur, choix séparé puis deuxième confirmation pour effacer uniquement
  cet appareil, sans POST ni affirmation de suppression serveur ; support pour
  le résiduel distant. Ancienne confirmation A→B→A désarmée, pas réattribuée.
- Fence global sans identité, lié à la session et sérialisé LS/IDB par la même
  transaction : protège des résultats préparés avant effacement, y compris si
  une vieille liste de comptes réintroduit A. Effet assumé : les bibliothèques
  des autres comptes ouverts peuvent exiger une reconnexion. Crash entre LS
  et IDB : refus fermé jusqu'à reprise explicite de l'effacement ; pas de
  réconciliation automatique qui pourrait ressusciter un import. Après succès,
  marqueurs et données propres au propriétaire purgés ; seul ce fence global
  sans identité reste. Un ancien client/APK non mis à jour n'est pas couvert.
- Tests : vraie Web Crypto et transactions `fake-indexeddb` 6.2.5 (dépendance
  de développement seulement), faux réseau ; deux graphes de modules distincts
  partageant IDB/localStorage simulent deux fenêtres, pas un E2E navigateur.
  Fixtures DOCX/XLSX produites par outils indépendants déjà utilisées par W01.
  Tests UI du mode verrouillé, brouillons, import partiel/séquentiel, démontage,
  remontage de compte et double confirmation. Inventaire CUA du jour toujours
  vide : aucune recette visuelle/native déclarée.
- Deux GO indépendants après correction des pertes de brouillon, annulations
  ABA, reprise crypto froide, quotas concurrents et recherche Unicode.
  Vérification locale finale : 220 fichiers / 2 293 tests verts (+70 tests),
  couverture, types front/back, no-CASA/addon et build réussis. Nouveau chunk
  bibliothèque ~13,1 ko brut ; bundle principal ~971 ko brut / 303 ko gzip.
  PR [#443](https://github.com/flotellop-art/Arty/pull/443), squash main
  `d48398ad207149cd0c8c8057bda2e177bed0f3fc`, 5 septembre 06:32 UTC.
  CI PR `33949392859`, main `33950081525` et build-and-distribute
  `33950081633` réussis. Pages production succès
  `bfae3458-3892-408a-ae7c-d05fb6c06c3d`. HTTP `/` 200 et asset
  `index-BNZ1W8px.js` servis. Preuve de déploiement, pas de recette visuelle.
- Repli : masquer l'entrée et la route pour désactiver la bibliothèque sans
  détruire la nouvelle base. Conserver le chemin d'effacement du nouveau store
  et des reçus tant qu'il peut exister des données W04 ; un revert aveugle vers
  l'ancien `accountService` laisserait ces données derrière. Ne pas supprimer
  une base ou des sources automatiquement pour restaurer une ancienne UI.

### W04 — prérequis de sauvegarde, livré avant la bibliothèque

- Garde-fou des conversations : clés physiques et compte/epoch capturés,
  générations d'écriture/reset/bootstrap, contrôle avant écriture du résultat
  chiffré et suppression de sa copie de secours. Une opération tardive ne
  remplace plus le ciphertext d'un autre compte ou d'un enregistrement récent.
- Les lectures invalident elles-mêmes un cache d'une autre session. Le mode
  clair forcé et une écriture sans crypto invalident aussi les vieux résultats.
  L'API synchrone historique et la copie de secours en clair restent conservées ;
  ce n'est ni une nouvelle garantie E2EE ni un changement d'enveloppe crypto.
- Quarantaine libérée seulement après sauvegarde durable du contenu fusionné.
  Une écriture/suppression pendant migration ou récupération interrompt cette
  récupération et conserve son slot. Migration Gmail assainie aussi dans le
  ciphertext. Une nouvelle entrée n'est pas ajoutée au cache si son écriture
  synchrone échoue ; les objets déjà mutés en place n'ont pas de rollback.
- 36 tests ciblés verts : vrais modules, crypto/session/stockage factices pour
  les courses, plus tests historiques avec crypto réelle. Pas de données
  utilisateur touchées. Revue indépendante des deux fenêtres de résurrection
  d'une suppression, du quota, des générations et de l'assainissement Gmail.
- Deux GO indépendants ; vérification finale complète réussie : 211 fichiers,
  2 189 tests, couverture, typecheck front/back, no-CASA/addon et build.
  PR [#441](https://github.com/flotellop-art/Arty/pull/441), squash main
  `1fbbe2fe2ae76f498a84cb4c4a71309e7f7d9644`, fusion 04:45 UTC. CI PR et main
  web/Android/orchestrateur/build-and-distribute réussies, Pages production
  succès `1fba6b2a-7fd6-42ac-8468-27c90e293837`. HTTP `/` 200, asset servi
  `index-DBFGp4A3.js`, 940 897 octets.
  Recette visuelle/appareil non vérifiée.
- Limites distinctes : pas de verrou transactionnel inter-onglets de l'ancien
  localStorage ; propriété des clés crypto globales et bootstrap d'auth à
  fiabiliser avant la bibliothèque W04. Celle-ci utilisera un store IDB chiffré
  avant commit, avec révisions contrôlées en transaction, sans copie en clair.

### W04 — prérequis crypto/session, livré

- PR [#442](https://github.com/flotellop-art/Arty/pull/442), squash main
  `acb65e6bdce8ffd523d4c6210816b489cc9e2922`, fusion 5 septembre 05:11 UTC.
  Pages production succès `b1a52c81-c27b-4829-8743-b3f9bc722dee` ; HTTP `/`
  200, bundle `index-Dhv1sxTE.js`. CI PR verte ; CI main verte à la relance
  du job échoué : le test D1 séquentiel a une fois atteint le fail-open
  250 ms (remaining absent), sans échec des tests crypto. Réserve de stabilité
  du harnais conservée. Build/distribution APK réussis, pas de recette appareil.

- Contexte crypto immuable lié au compte, à l'époque de session et à la
  génération d'initialisation. Dérivation et vérification utilisent des
  candidats locaux ; `verifyCrypto` ne remplace plus la clé globale, et la
  version de l'enveloppe est figée avant chiffrement. Les marqueurs physiques
  sont capturés ; anciens ciphertexts v1/v2 et sans enveloppe conservés.
- La disponibilité indique seulement un candidat pour cette session, pas le
  déverrouillage de tous les anciens fichiers. Mauvaise clé : marqueur et
  ciphertext conservés. Pas de rechiffrement massif, suppression de données,
  nouvelle passphrase utilisateur, modification d'algorithme ou promesse E2EE.
- Annulation typée distincte de corruption : bootstraps Google/conversations
  n'effacent ni ne mettent en quarantaine un résultat obsolète. Writers Google
  refusent le fallback en clair après annulation et pendant initialisation ;
  leur cache antérieur est restauré seulement dans la même session. Les
  anciennes copies de secours en clair des conversations restent explicites.
- Garde avant compression/IDB, chiffrement et commit des pièces jointes ;
  propriétaire du `fileId` existant contrôlé dans la même transaction readwrite
  que l'écriture. Aucun nouvel appel payant ou réseau documentaire ajouté.
- Initialisation App redondante supprimée, restauration useAuth annulable,
  switch sans UI A au-dessus du stockage B. Un échec courant remet l'UI hors
  compte sans effacer les historiques ; un échec obsolète ne nettoie pas le
  compte gagnant. Fichiers/conversations restent des chargements optionnels.
- Édition BYOK liée à une seule ouverture et session. Elle attend le bootstrap
  crypto en cours, puis commit synchrone des credentials avant publication de
  la candidate ; fermer annule aussi cette publication. Quota/cancel restaure
  le dernier contexte committé, même avec candidats concurrents. Restauration
  des petits marqueurs best-effort : pas de transaction multi-clés localStorage.
- Après commit/rollback, reprise seulement des stores non prêts ; pas de
  re-décryptage forcé des caches déjà chargés sous une clé volontairement
  différente. Un échec de chargement optionnel ne devient pas une fausse erreur
  de sauvegarde BYOK. Les pipelines non modifiés (ex. préparation d'un rapport
  avant `secureSet`) ne sont pas déclarés globalement isolés par ce lot.
- Nouveaux tests permanents : 17 courses avec vraie Web Crypto, 5 du composant
  BYOK avec crypto réelle, 4 de reprise sélective, 4 auth/StrictMode, 4 fichiers
  avec IDB simulé. Fermeture durant init froide, rollback exact de marqueurs
  v1/v2 sur quota, verification concurrente et annulation du refresh couvertes.
- Deux GO finaux indépendants, dont reproduction Web Crypto de l'ancien
  fallback OAuth en clair puis de son refus après correctif. Vérification
  finale complète : 214 fichiers / 2 223 tests, couverture, typecheck front/back,
  no-CASA/addon et build réussis. CI/Pages vérifiées ci-dessus.


### W03 — catalogue, comparateur et provenance

- Catalogue texte pur partagé : fournisseurs des préférences historiques,
  transports et familles de facturation restent distincts. Les defaults
  clients/routeur, modèles comparateur et labels exacts en dérivent ; les
  labels et tarifs historiques restent lisibles. Terra, Opus et Small2603
  sont déjà utilisés par Arty : aucun nouveau fournisseur ni tarif ajouté.
- Sélection du comparateur réellement appliquée à la factory ; résultat ancien
  effacé seulement si sa configuration change. Initialisation et ajout
  choisissent des modèles accessibles, y compris deux du même fournisseur.
  Un résultat reste visible lorsque les droits expirent, avec motif par panneau.
- Éligibilité prudente au dispatch : identité requise, sentinelle exclue des
  clés personnelles, Pro BYOK uniquement, distinction Free/essai actif/essai
  épuisé/crédits, statut indisponible explicite. Aucun droit, prix, plafond,
  endpoint ou routage Auto/EU/Office serveur élargi par ce lot.
- Comparaison texte explicite : aucun historique/fichier, outil, enrichissement
  vidéo/position ou compression cloud. Les paramètres de génération propres
  aux fournisseurs restent différents : ce n'est pas un benchmark contrôlé.
- Callback d'attribution local par invocation ; demandé, header proxy Gemini
  et ID du flux fournisseur ont des provenances distinctes, même si l'ID reste
  identique. ID absent/malformé non confirmé. Coût uniquement estimé pour un
  ID signalé reconnu exactement ; tarif inconnu = indisponible, jamais zéro.
  Tokens approximatifs, hors raisonnement/cache, conversion fixe, débit réel
  serveur distinct ; nombre d'appels/reprises annoncé avant envoi.
- Champs de message additifs, sans migration : ancien `model` non confirmé.
  `invocationId` empêche une réponse tardive d'un ancien tour d'altérer le
  suivant ; garde propriétaire/epoch sur les sauvegardes partielles. Stop,
  démontage, préparation PDF/URL/fichiers et changement de compte couverts.
  Promesses d'envoi résolues aussi sur annulation/timeout ; drafts privés
  du comparateur effacés au changement de session.
- Deux GO indépendants après reproductions contradictoires : sélection non
  appliquée, faux verrou Free+BYOK, compteur d'essai cross-session, ancienne
  génération/attribution réécrivant la nouvelle, rattachement de contrôleur
  après une préparation obsolète. Les tests permanents utilisent de vrais
  hooks/clients avec DOM et HTTP simulés ; aucun appel IA payant.
- Vérification finale du lot réussie : 210 fichiers / 2 170 tests, couverture,
  typecheck front/back, no-CASA/addon et build. Cas ajoutés : 21 scénarios de
  vrais clients à HTTP simulé, 9 scénarios comparateur, attribution persistée
  par invocation et anciennes préparations PDF/URL après Stop. Bundle principal
  local 937 Ko (gzip 292 Ko), avertissement de taille préexistant conservé.
  PR [#440](https://github.com/flotellop-art/Arty/pull/440), squash main
  `b7d893b0e04c9e20053bc7c8fad0ac2684e70536`, fusion 04:22 UTC. CI PR et main
  web/Android/orchestrateur, build-and-distribute réussis. Pages production
  succès `3498efa8-4424-4964-9351-af82f669d8c1` ; HTTP `/` 200 et asset
  `index-qamcbiN-.js` avec marqueurs `comparisonTextOnly`, `invocationId`,
  `modelSource`. Preuve de version servie, pas de recette visuelle/appareil.
- Hors W03 : historique/contexte du comparateur (W07), projets (W04), nouvelles
  capacités fournisseur ou migration de préférences. Partage public toujours
  limité à son allowlist sans attribution ; ni contenu ni clé ajouté aux logs.
- Repli : revert de la PR par la chaîne Git/Pages. Pas de migration D1/IDB,
  anciens champs conservés. Une ancienne APK garde son code jusqu'à mise à
  jour ; build/distribution CI ne signifie pas mise à jour installée.

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

### W01 — lecture locale Office, web livré

- PR [#439](https://github.com/flotellop-art/Arty/pull/439), squash main
  `eb1e2c0f598163beebdaa084918a9bf21749cf6c`, fusion 03:43 UTC. CI main
  web/Android/orchestrateur et build-and-distribute réussis. Pages production
  succès `6304185a-beb5-456f-80e5-cad68de65e4f`.
- HTTP production : `/` renvoie 200 et charge `index-DNpWEQdI.js` ; marqueurs
  `office_documents` et `DOCUMENT READ-ONLY MODE` présents dans le JS servi.
  Preuve de version publiée, pas d'exécution visuelle du parcours. Troisième
  inventaire navigateur de contrôle du jour encore vide pendant W03.

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
  des vrais clients/post-traitements avec réseau simulé. CI PR et main vertes.
- Formats exclus : DOC/XLS, macros, chiffrement, révisions/alternatives Word,
  parties principales non canoniques. Pas de reconstruction du rendu, images,
  annotations, entêtes/pieds, styles de dates ou graphiques. Erreurs FR/EN et
  périmètre visibles dans le composeur. Compilation/distribution Android CI
  réussies ; interaction réelle mobile non vérifiée.
- Audit npm au démarrage : 13 avis sur des dépendances déjà présentes, aucun
  sur fflate ajouté en version 0.8.3. Aucun `audit fix --force` ; traitement
  ciblé à prévoir avant de conclure le CDC global.

### Repli du lot W01

Revert Git de la PR via la chaîne Pages habituelle. Aucun schéma/migration de
données ; originaux conservés. Ne pas remplacer un échec de lecture par un
faux texte analysé. Un APK déjà installé reste son bundle local jusqu'à mise
à jour ; pas de contournement OTA du client natif.

### Point de contrôle dépendances — 6 septembre 2026

Audit readonly complémentaire `npm audit --omit=dev` : **6 entrées**, 2 high,
4 moderate, aucune critical (ce n'est pas le comptage complet dev compris).
`npm ls --omit=dev` situe @xmldom/xmldom 0.8.13, brace-expansion 5.0.7 et
tar 7.5.19 sous @capacitor/cli 8.3.0 ; DOMPurify 3.4.11 et React Router /
react-router-dom 6.30.4 sont aussi présents. La portée réelle des options
sanitizer, destinations Link/navigate et chemins build doit être examinée,
pas déduite du seul niveau npm. Aucun `audit fix --force` ni mise à jour
silencieuse exécuté. Ces avis préexistants restent un gate avant clôture CDC ;
le correctif de durée de vie des brouillons #476 ne prétend pas les résoudre.

### Repli du lot W02

Lot client/texte uniquement, sans migration ni mutation des données. En cas de
régression : revert Git de la PR puis déploiement Pages par la chaîne habituelle.
Ne pas rétablir l'ancienne affirmation de confidentialité comme « fix » ; couper
temporairement la carte du conseiller si elle est la cause. Les binaires Android
existants restent inchangés tant qu'un nouvel APK n'a pas été installé.
