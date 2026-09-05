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
| W01 | Fondations | DOCX : paragraphes et tableaux ; XLSX : feuilles nommées et cellules identifiées. Contenu réellement injecté, accents conservés ; erreurs visibles sur ancien format, fichier chiffré/corrompu ou limite dépassée. Même résultat en nouvel envoi, historique et retry, dont Android et mode Europe. Aucun macro, formule, lien externe exécuté ; ressources bornées ; aucune pièce jointe en base64 dans localStorage. | Web déployé, PR #439 ; recette visuelle/appareil non vérifiée |
| W02 | Confiance | Essai annoncé conforme au plan servi. BYOK gratuit distinct du Pro optionnel ; conseiller sans licence fictive. Promesses de stockage et de transit exactes FR/EN, page publique cohérente. Aucun quota ni accès serveur élargi implicitement. | Web déployé, PR #437 ; recette visuelle/appareil non vérifiée |
| W03 | Catalogue | Un catalogue partagé aligne comparaison, sélecteurs, labels et éligibilité selon le compte (pas une garantie fournisseur). Modèle demandé, transmis par le proxy et signalé par le fournisseur distingués. Tests contre la dérive et contre l'accès premium hors droit. | Web déployé, PR #440 ; recette visuelle/appareil non vérifiée |
| W04 | Projets | Créer/renommer/supprimer un projet, consignes propres, conversations associées, bibliothèque de documents réutilisables. Sources identifiables dans le contexte. Recherche bornée, absence de fichier et contexte tronqué explicites. Cloisonnement par compte et projet ; mode Europe conservé. | Bibliothèque web livrée #443 ; conversations web livrées #444 ; recette visuelle/appareil non vérifiée |
| W05 | Livrables | Export DOCX modifiable et XLSX de tableaux, en plus des exports existants. Téléchargements relus par un parseur indépendant ; cellules dangereuses neutralisées ; aucun HTML actif ni formule arbitraire. Formats et limites documentés. | Implémentation et recette structurelle locale ; validation finale/publication en cours ; rendu Office/appareil non vérifié |
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

### W05 — livrables modifiables, validation finale

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

### Repli du lot W02

Lot client/texte uniquement, sans migration ni mutation des données. En cas de
régression : revert Git de la PR puis déploiement Pages par la chaîne habituelle.
Ne pas rétablir l'ancienne affirmation de confidentialité comme « fix » ; couper
temporairement la carte du conseiller si elle est la cause. Les binaires Android
existants restent inchangés tant qu'un nouvel APK n'a pas été installé.
