# W06-B — synchronisation chiffrée optionnelle

Date : 7 septembre 2026. **Décision de conception / implémentation partielle**.
La sauvegarde/restauration [W06-A](ADR_WORKSPACE_BACKUP.md) existe ; un upload
d'archive ou un noyau causal isolé **ne valide pas W06-B**. Aucun bucket,
binding, migration serveur, endpoint public ou activation UI ajouté par ce lot.
Le [CDC](arty-workspace-cdc.md) complet, dont abonnements/crédits, reste ouvert.

## Résultat utilisateur à livrer

Opt-in explicite sur un compte vérifié, périmètre choisi, secret utilisateur
confirmé ; connexion d'un second appareil avec ce secret et premier aperçu.
Ensuite : envoi/réception automatiques, continuité des identités et références,
reprise après panne/hors ligne, conflits conservés. Conversations, comparaison
contextuelle, projets, originaux, texte documentaire exact et galerie restent
fidèles. Un historique reçu n'autorise jamais outils, reprise de stream,
fact-check, récupération de liens ni changement de confinement EU/documentaire.

Pour le premier applicateur sûr, réception automatique puis **« Appliquer les
changements reçus » sous maintenance et rechargement par lot**. Compromis
initial visible, pas « synchronisation temps réel transparente ». L'applicateur
chaud nécessite une barrière nouvelle couvrant tous les writers/lecteurs ;
le `persist()` synchrone et son chiffrement différé ne la fournissent pas.
W06-B reste partiel tant que l'ergonomie et les recettes ne sont pas acceptées.

États attendus : local, verrouillé, en attente d'envoi, révision acquittée,
changements reçus, conflit, stockage indisponible, appareil expiré à réconcilier.
Ne pas confondre suspendre, déconnecter cet appareil et effacer le coffre distant.

## Deux autorités, pas une reconnexion magique

- Identité serveur vérifiée, séparée du `userId` local. Premier parcours Google :
  `sub` obligatoire (le vérificateur actuel peut retourner `null`). Email vérifié
  a un espace d'identité distinct. BYOK/demo et invité n'obtiennent pas un coffre
  implicitement par simple association Google : leur effacement est actuellement
  local-only. Toute adoption de données invité exige une confirmation distincte.
- Secret de coffre aléatoire de 256 bits, détenu par l'utilisateur, dérivation
  HKDF et AES-GCM avec domaine distinct de l'archive et de la clé locale. Clé
  en RAM V1, déverrouillage explicite après fermeture/logout ; aucune promesse
  de récupération par Google seul. Pas de secret dans LS, journal ou logs.
- Enveloppes à authentifier : coffre, incarnation serveur, rôle de l'objet,
  identité/révision/parents et version de format. Le serveur ne voit que des
  identifiants opaques de transport, tailles, dates et engagements de ciphertext.
  **IDs logiques, contenu, graphe causal et hashes de plaintext restent chiffrés.**
  TLS/clé locale actuelle ne constituent pas ce chiffrement de bout en bout.
- `vaultId/epoch` dans une structure cliente ne prouve pas une autorisation.
  L'incarnation distante révoquée ne se recrée jamais sur un ancien upload.

## B1 : modèle causal conservatif

Format candidat interne `arty-sync-causal`, version 1. Un manifeste contient
des objets logiques stables (`conversation`, `project`, `file`, sources/textes
documentaires), chacun avec un DAG de révisions UUID v4. Chaque révision lie
identité, intention, parents exacts et valeur immuable : référence opaque de
payload + engagement privé + taille, ou tombstone explicite.

Intentions : création sans parent ; édition/suppression d'une tête vivante ;
restauration explicite d'une tête supprimée ; résolution citant toutes les
têtes présentées. Une résolution ne domine pas une troisième tête arrivée
après cet aperçu. L'UI future reste responsable du consentement, le noyau ne
le fabrique pas. Un retry conserve UUID, parents et valeur ; modifier l'un
sous le même UUID est une équivoque refusée.

Base ACK exacte conservée des deux côtés avant réconciliation. L'union des
révisions garde toutes les variantes concurrentes, y compris les contenus
égaux et suppression/édition ; aucun arbitrage par date, UUID ou LWW.
Les suppressions sont des versions causales, **jamais un getter vide/404**.

Exemple : b→l, b→r, puis z enfant de l et r. Rejouer b/l/r est sans effet.
Une nouvelle r2 enfant de r et créée hors ligne reste concurrente de z,
même si z est une suppression. La chaîne X→Y→X conserve ses trois révisions.
Une base tronquée provoque un refus/rebase ; elle ne devient pas une base vide.

Le graphe est fermé, sans cycle, parent étranger, auto-parent, doublon ni
parents redondants. Une identité de révision ne peut être réutilisée sur un
autre objet ; un payload immutable ne peut changer de commitment/propriétaire.
Sérialisation canonique des ensembles uniquement ; aucun tri des messages
ou documents applicatifs pour calculer leur contenu.

Bornes candidates : 2 000 objets, 10 000 révisions au total, 256 par objet,
16 têtes concurrentes, 4 Mio de manifeste, 10 Mio par payload. Dépassement =
refus sans écriture ni troncature. Ce n'est ni une capacité commerciale ni
un quota cloud activé. Aucune GC des « derniers N » : un futur checkpoint avec
expiration/réconciliation des appareils doit conserver la preuve de domination
et leurs intentions locales. La rétention exacte des payloads des ancêtres
reste à traiter ; aucune purge n'est implémentée ici.

La borne de têtes n'est pas monotone : 16+1 têtes peuvent être refusées, puis
la résolution explicite des 16 permet de rejoindre la 17e comme seconde tête.
L'union mathématique converge ; les propriétés d'associativité/ordre de livraison
du noyau borné valent pour les résultats intermédiaires admis. Sur limite,
conserver l'intention figée et permettre la reprise, sans rebaser ses parents
sur les dernières têtes et sans qualifier tout refus de blocage permanent.

Implémentation B1 : `src/services/workspaceSync/{types,schema,causal}.ts`.
Parse strict par descripteurs sans getters, formes fermées, UUID/hash bornés,
copie détachée, décodage canonique refusant les clés JSON dupliquées ; staging
à parents exacts, retry identique, merge conservatif et variantes maximales.
Ce noyau est pur et non importé par l'application : **pas encore d'E2EE,
d'outbox, d'ACK réseau, de capture fidèle ou de stockage/publisher**. Le payload
est un engagement opaque, pas la validation de son contenu ou de ses dépendances.

## B2a : codec chiffré candidat, non activé

`src/services/workspaceSync/encryption.ts` prépare et ouvre un paquet incrémental
lié à une base B1 exacte : manifeste suivant complet et hash de la base dans le
descripteur privé, puis seulement les nouveaux payloads. Les engagements de
taille et SHA-256 des corps sont vérifiés avant exposition d'un résultat. Aucune
lecture des anciens fichiers applicatifs n'est déclenchée par le codec.

Un paquet n'est **pas autonome** : le récepteur doit disposer de sa base exacte
et conserver les anciens corps nécessaires. Le test D1→D2 sur contexte neuf
ouvre D1 puis D2, garde les anciens payloads via D1 et refuse D2 seul avec une
base vide. Le bootstrap, la rétention et les checkpoints restent à implémenter.

Secret aléatoire `ARTYSYNC1` de 256 bits, différent du code d'archive `ARTY1`.
Racine HKDF non extractible en RAM ; chaque nouvelle préparation tire une
identité d'opération UUID et un sel de 32 octets, puis dérive sa clé AES-256-GCM
non extractible. Le contexte HKDF est le tuple canonique domaine/version,
coffre, incarnation et opération. Voir les contrats de
[WebCrypto](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/) et la
[séparation par `info` de HKDF](https://www.rfc-editor.org/rfc/rfc5869.html#section-3.2).
Nonce de 12 octets, compteur global de frame sans remise à zéro entre objets,
tag de 128 bits ; entête et préfixe de chaque frame dans les données authentifiées.

L'entête public `ARTYSYN1` (104 octets) expose coffre/incarnation/opération,
sel et dimensions. Chaque frame a un préfixe de 9 octets et un tag de 16 octets.
La référence publique n'a que format/version, coffre/incarnation/opération,
taille et hash du **ciphertext**. IDs logiques, parents, catégories applicatives,
contenus et hashes de plaintext restent chiffrés. Les tailles et le nombre de
frames ne sont pas masqués ; il n'y a pas de promesse de résistance à l'analyse
du trafic. Une référence valide n'est pas un ACK, une autorisation serveur ni
une preuve de fraîcheur ; la référence/base attendues viennent d'un ticket
indépendant, jamais des seuls champs de l'entête reçu.

Bornes V1 : frames de 256 Kio ; 256 nouveaux payloads, 10 Mio chacun ;
16 Mio de plaintext agrégé, 17 Mio de ciphertext, 512 frames et métadonnées
limitées à 4 Mio + 1 Kio. Précontrôle cumulé avant lecture des corps/dérivation
de clé d'enveloppe. Ce ne sont ni quotas commerciaux ni garanties de pic RAM
mobile. Format JSON canonique, dimensions, graphes, tags, hashes et fin exacte
sont contrôlés avant de rendre le moindre payload.

`unlock()` importe une capacité de clé, **ne confirme pas le secret du coffre**.
Cette confirmation nécessite d'ouvrir une enveloppe attendue. Le slot RAM est
retiré sur lock, abort, nouvel unlock ou perte d'admission durable ; contrôles
après attentes crypto et autour des callbacks réentrants. Les gardes réelles
owner/epoch/fence restent un adaptateur à intégrer : celles des recettes B2a
sont synthétiques. Un Blob ou une chaîne déjà remis au code appelant ne peut
pas être effacé physiquement par une révocation ultérieure.

Avant adoption durable, `prepareSyncUpdate` reste lié à la fraîcheur de la
capture. Après adoption, `resumeSyncUpdate` ouvre/vérifie une copie sauvegardée
sous un scope compte courant, sans relire la conversation, rechiffrer, changer
le sel, l'ID, la base ni les octets. **Aucun commit d'outbox, transaction
applicative, dispatch, ACK ou stockage de clé n'est implémenté par ce codec.**
Son import n'apparaît dans aucun chemin d'exécution de l'app.

## B2–B5 : verticale restante, pas des exclusions

### Capture, secret, journal et application locale

Extraire la capture stricte sans le nouveau code aléatoire de chaque archive.
Mapping logique/physique persistant et sémantique stable avant scellement :
l'archive actuelle recrée IDs, sel et date ; son fingerprint n'est pas un
signal de modification. Ne pas perdre `Conversation.comparison` (la projection
d'archive ne la conserve pas aujourd'hui). Références exactes par variante,
graphes de dépendances complets, originaux inchangés et flags monotones.

Outbox séparée, owner/génération-scopée et chiffrée ; capture du scope, fence,
secret et activité. Les hooks de suppression doivent produire une intention
explicite. Scan de reprise des vrais stores contre la base ACK pour fermer
la coupure sauvegarde locale/outbox ; une lecture en erreur ne supprime rien.
ACK A après édition B n'acquitte que A ; aucune régression de checkpoint et
aucune suppression globale de l'outbox. Après issue réseau inconnue : consulter
ou rejouer la même opération et les mêmes octets.

Applicateur dédié `sync-apply` versionné, **dans la génération locale active** :
préparer ciphertexts et nouvelles pièces immuables → adopter journal exact et
retirer le document → reprise à froid → CAS ciblés de l'historique et index →
réattestation de toutes les écritures → ready/suppression du journal.
Ne pas assouplir le contrat v8 de restauration additive (IDs tous nouveaux),
ni placer l'outbox dans `control.meta` dont la forme est strictement inventoriée.
Éviter une copie complète de tous les comptes à chaque pull ; B doit rester
intact pendant une application, panne ou suppression de A.

### Publication distante et effacement

R2 privé pour ciphertexts immuables, D1 pour coffre/incarnation/head CAS,
réservations/opérations/budgets et nettoyage durable. Pas de bucket public ou
URL durable ; lecture authentifiée via binding, réponses `no-store`.
R2 est [fortement cohérent](https://developers.cloudflare.com/r2/reference/consistency/),
ses [écritures conditionnelles](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations)
ne constituent pas une transaction commune avec D1.

Réserver l'opération/budget D1 AVANT upload ; écrire/relire les objets exacts ;
publier head+ACK en [batch D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
conditionné par owner/incarnation/base. Un UPDATE à zéro ligne n'est pas une
erreur SQL : toutes les instructions dépendantes doivent partager le gate.
Ne pas supposer qu'un batch D1 annule un PUT R2. Réponse CAS perdue : retrouver
l'opération durable ; réserver les orphelins au nettoyage, pas au head actif.

Effacement : révoquer d'abord l'incarnation, refuser uploads/publications
tardifs, puis purger via inventaire durable. **Un PUT déjà parti peut terminer
après la purge** : injecter ce retard et conserver l'intention jusqu'à preuve
de nettoyage. `waitUntil` seul n'est pas un journal durable. Les deux endpoints
`account/delete.ts` et `account/erasure-v1.ts` doivent intégrer ce protocole ;
ne pas annoncer « effacé » si seul l'accès est révoqué. Nettoyage exact des
journaux/clefs RAM de A, sans B ; un appareil hors ligne n'est pas physiquement
effacé à distance. Recréation volontaire = nouvelle incarnation.

### Activation et preuve de bout en bout

Avant activation : disponibilité/capacité/juridiction R2 confirmées, protocole
d'effacement réel, contrat E2EE et politique publique cohérents. Les pages
confidentialité promettent encore la non-persistance des échanges courants et
un préavis de 30 jours pour modification substantielle. Préparer ce changement
et obtenir l'action propriétaire nécessaire ; **aucun email, accord juridique,
activation facturable ou contournement de permissions déduit de ce lot**.
Le test local Miniflare/R2 ne requiert pas d'activer le bucket en production.

Recette indispensable : deux profils indépendants, vrais stores/crypto,
API locale D1/R2 et identité synthétique vérifiée ; conversation + DOCX/TXT
projet + galerie de A vers B, réponse de B vers A sans doublon, reload,
modifications disjointes/concurrentes hors ligne, suppression et résolution,
ACK perdu/retardé, quota, corruption, owner A→B→A et logout en vol. Injecter
une coupure à chaque frontière upload/CAS/application locale, un PUT après
effacement et un ancien appareil après recréation. Ensuite seulement recette
déployée et APK exact sur appareil réel. Tests purs/fake-IDB ne valent pas
cette validation de bout en bout.

## Challenge et état de preuve

Deux contre-revues indépendantes readonly avant code : produit/continuité et
sécurité/publication. Objections intégrées : DAG fermé conservé après résolution,
replay ancien versus nouvelle branche ancienne, intentions de restauration,
ACK distinct, préavis public et upload tardif pendant effacement. Refus d'un
simple merge de valeurs, de l'import additif répété ou d'un clone global à
chaque pull. Deux GO code bornés après relecture ; aucune écriture déléguée.
La borne non monotone des têtes a été précisée et testée après objection.

Preuves locales sous Node 22.23.2 : **60 tests ciblés réussis**, dont ordre de
livraison, replay après résolution, nouvelle branche hors ligne, suppression/
restauration, ABA, intentions détachées, équivoques, cycles/parents étrangers,
getters/formes hostiles, format JSON canonique et dépassement réel de 4 Mio.
Dernière passe complète `npm run verify` : **331 suites, 4 283 tests réussis,
1 ignoré préexistant**, typechecks front/back, no-CASA, couverture, build et
vrai worker Office isolé réussis. Les quatre derniers cas négatifs de caractères
de fin de ligne ont ensuite été ajoutés et passent dans la suite ciblée à 60 ;
aucun code de production changé après la passe complète. La CI du candidat
exact [#483](https://github.com/flotellop-art/Arty/pull/483) a ensuite réussi :
331 suites / 4 287 tests réussis, 1 ignoré. Fusion main `45b0488`, CI main
`34060733275` et Firebase `34060733266` réussies. Pages production
`fcd8a814-93ab-4a08-892d-93e4609fe878` publié ; cinq assets identiques entre
URL immuable et domaine canonique, contrôles HTTP publics conformes à
21:21 UTC. Ce relevé ponctuel n'est pas un suivi de 15 minutes ni une recette UI.

Reçus locaux ignorés : `workspace-sync-b1-verify-final.log` et
`workspace-sync-b1-unit.log`. Les marqueurs du protocole sont absents du bundle
applicatif compilé, en accord avec l'absence d'import. Pas de recette navigateur,
multi-appareil, crypto, D1/R2 ou APK revendiquée pour B1. Retour arrière : revert
du commit par la chaîne Git habituelle, aucune donnée ni migration à inverser.

### Preuve B2a

Deux contre-revues readonly distinctes (sécurité et produit), GO code bornés
après fermeture d'une révocation synchrone réentrante. Retours intégrés :
scope après callback compte et après garde de capture ; nouveau handle conservé
lors d'un unlock réentrant ; secret importé distinct d'un secret confirmé ;
chaîne D1→D2 et ancien contenu conservé ; fake-IDB identifié comme tel.

57 tests ciblés avec WebCrypto réel sous Node 22.23.2 : round-trip, nouvel ID/sel,
clés non extractibles, nonce global, ancien payload non renvoyé, secret/base/scope
erronés, frames modifiées/réordonnées/dupliquées/tronquées, écrivain de test
indépendant à tags AEAD valides autour de plaintext malformé, métadonnées sur
plusieurs frames, bornes avant lecture/KDF, fermeture/ABA aux étapes crypto et
callbacks réentrants. La sérialisation unitaire utilise **fake-indexeddb**.
Première vérification complète locale : **332 suites, 4 344 tests réussis et
1 ignoré préexistant**, typechecks front/back, no-CASA, couverture, build et vrai
worker Office isolé réussis. Une seconde passe à 23:54 locale a révélé une
fixture d'agenda préexistante dépendante de l'heure : son « maintenant + 10 min »
tombe demain, correctement exclu de l'agenda du jour. Reproduit en heure Paris,
absent en UTC à l'instant correspondant ; deux challenges readonly confirment
le diagnostic. Correctif **tests uniquement** : Date locale figée à midi et
23:55, vrais timers DOM, cleanup/restauration garantis. Le second cas vérifie
le rendu initial tardif, pas l'actualisation d'une page ouverte à minuit.
Passe complète finale après correctif réussie sous Node 22.23.2 : **332 suites,
4 345 tests réussis, 1 ignoré préexistant**, typechecks, couverture, no-CASA,
build et worker Office isolé verts. CI du candidat #484 réussie, fusion main
`77a561a02ec6e19b8f99eee14f5c8a01a5da924c`. CI main `34063135233` et Firebase
`34063135145` revérifiées **success** le 6 septembre à 22:43 UTC.

Recette Chrome 152.0.7977.77 le 6 septembre à 21:55 UTC : WebCrypto et IndexedDB
natifs, page initiale détruite puis coffre synthétique redéverrouillé dans une
nouvelle page ; deux contextes navigateur isolés, deux deltas, ciphertext
identique après reprise, zéro nouvel encrypt/sel et zéro appel externe/API.
Script reproductible `scripts/check-workspace-sync-encryption-browser.mjs`
(Playwright installé ; chemin de paquet configurable par
`ARTY_PLAYWRIGHT_MODULE`, aucun compte de production). Les gardes, corps et
store de cette recette sont synthétiques ; le transfert est effectué par le
harness de test. **Ce n'est pas la capture/restauration Arty, une outbox réelle,
une API de synchronisation, deux appareils physiques ni une recette APK.**

Reçus locaux ignorés : `workspace-sync-b2a-verify.log`,
`workspace-sync-b2a-verify-final.log` (échec diagnostiqué),
`workspace-sync-b2a-verify-release.log`, `workspace-sync-b2a-browser-final.log`.
Aucun bucket, endpoint, migration, dépendance
ou flag activé. Même repli Git que B1 ; l'ADR et W06 complet restent ouverts.

### B2b en cours — barrière physique et reprise froide (7 septembre, local)

Décision : garder les adresses et la génération existantes, ajouter le champ
fermé `projectsVersion: 2` aux contrôles isolés et monter uniquement la DB
projets active de 1 à 2. Absence du champ = version historique 1 ; les valeurs
présentes `undefined`, `null`, `1`, chaînes, getters et versions futures sont
refusées. Versions sémantiques 2/7/8 et effacement 4/5/6 restent distinctes de
cette version physique. Les contrôles de reset/restauration/effacement la
conservent ; le registre v7 complet, y compris son allocation `provisioning`,
n'est jamais reconstruit. Les témoins legacy restent en version 2 et les
fichiers actifs en version 1.

Le vrai acteur `workspaceWriter/upgrade.ts` est raccordé à une entrée froide
`/workspace/upgrade` et à la reprise détectée avant l'import privé. Il réclame
le verrou document exclusif existant ; une fenêtre déjà admise ne peut pas
devenir une fenêtre de maintenance. Aucun store métier, fichier, historique,
clé ou valeur localStorage n'est écrit. Le ticket v9 contient la base complète,
un identifiant et les deux fences bruts (absence préservée), jamais un secret.

| Contrôle | DB projets active | Action autorisée |
|---|---|---|
| ready 2/7 historique | 1, schéma exact, meta vide/fence seul | réservation CAS v9 |
| ticket v9 exact | 1 | versionchange vers 2, sans écriture de lignes |
| ticket v9 exact | 2 | vérification puis CAS final |
| ready 2/7 avec projectsVersion 2 | 2 | admission dans un nouveau document |

Tout autre couple manque/version/schéma est refusé sans création ni réparation.
La transaction d'upgrade refuse explicitement `oldVersion=0`, même si la DB
disparaît entre préflight et ouverture. Une connexion bloquante ou un délai
expiré retire l'ouverture : sa reprise tardive doit aborter. Le CAS final
conserve la base et ajoute seulement le champ physique et deux révisions.
Un résultat de commit incertain n'est retrouvé que comme le final exact déjà
préparé par cet acteur ; un autre ready de même génération ne suffit pas.

Alternative écartée : changer globalement tous les appels `open(1)` en `open(2)`
ou créer une DB outbox indépendante non inventoriée. Cela mélangerait témoins
legacy, copies de migration et stockage actif, sans reprise de crash attestée.
La contrepartie du ticket est une maintenance froide avec rechargement ; les
transactions IDB ne rendent pas atomiques plusieurs DB et localStorage. La
garantie d'exclusion concerne les clients coopératifs utilisant le verrou,
pas un ancien client antérieur au verrou ni un programme malveillant.
Référence de sémantique : [IndexedDB 3, draft W3C du 13 août 2025](https://www.w3.org/TR/2025/WD-IndexedDB-3-20250813/#upgrade-transaction),
complétée par les exécutions navigateur ci-dessous, pas présentée comme une REC.

`WORKSPACE_UPGRADE_START_ENABLED=false` reste intrinsèque et sans override
URL/localStorage. Les nouveaux départs natifs sont également refusés dans le
service, pas seulement l'UI. La reprise d'un v9 adopté reste indépendante de
START, y compris native. Aucun démarrage de synchronisation ni envoi n'est
exposé par cette préparation. La grammaire d'enveloppe B2a a été extraite dans
`envelopeFormat.ts`, pure et sans capacités de clé ; son API reste réexportée.

Preuves locales : 32 tests de protocole/acteur, 4 tests UI réels de la porte
froide (StrictMode/double clic, retour OAuth inchangé, démontage pendant import,
reprise START OFF). Les cas d'intégration exercent les vrais services de clé,
historique, fichiers et projets : allocation interrompue après le seul sel,
upgrade, reprise de la même allocation, lecture/écriture de B et nouvel
effacement/reset ; restauration de vraies archives v1/v2/v3 après upgrade.
Ces suites unitaires utilisent fake-indexeddb, pas un moteur natif.

Recette indépendante `scripts/check-workspace-upgrade-browser.mjs`, Chrome
152.0.7977.77 à 22:43 UTC : vrai IndexedDB + Web Locks, destruction des pages,
cinq scénarios (succès, coupure après ticket, coupure après montée physique,
connexion tenue, disparition de la DB). Données synthétiques intactes, aucune
DB disparue recréée, zéro erreur de page et zéro appel externe/API. Le harness
active START **dans son seul build de test**, pas dans le dépôt. Le codec B2a
a aussi été rejoué dans Chrome à 22:43:53 UTC après extraction : deux contextes,
deux deltas, zéro rechiffrement et aucun appel externe.

Deux challenges readonly avant code puis après code : réserve Web-only fermée
dans le service ; canaris de remplacement du ticket et de fences modifiés
pendant les deux CAS ajoutés. Deux GO code bornés après fermeture des réserves.
`npm run verify` sous Node 22.23.2 réussi : **334 suites, 4 387 tests réussis,
1 ignoré préexistant**, typechecks front/back, couverture, no-CASA, build et
vrai worker Office isolé. Reçu local ignoré
`.playwright-mcp/workspace-sync-b2b-upgrade-verify.log` ; recettes navigateur
`workspace-upgrade-browser.log` et `workspace-sync-b2b-codec-browser.log`.
Ce candidat n'est ni poussé ni déployé à ce stade ; la CI de B2a ci-dessus ne
constitue pas la CI de B2b. Les avertissements préexistants de taille de chunks
et les erreurs synthétiques des tests de refus ne sont pas des échecs de suite.

Suite obligatoire B2b, non réalisée par cette barrière : grammaire d'ownership
des lignes sync + inventaire/purge/provisioning/reset/restore, état privé sous
secret sync, capture fidèle des vrais stores et mapping durable, adoption
atomique état/opération, reprise des octets exacts puis rescan des modifications
ultérieures. Ensuite transport/ACK, applicateur et recettes W06 complètes.
Le secret verrouillé ne doit pas bloquer le chat local ; une opération déjà
préparée ne doit pas être remplacée par une édition ultérieure. Il ne faut pas
activer START ou un writer outbox sur la seule preuve de cette montée.

### B2b — outbox locale réellement persistante (7 septembre, non déployée)

`localOutbox.ts` adopte maintenant un **instantané historique détaché** dans la
DB projets active physique 2. Il ne lit pas encore les conversations/projets :
le futur adaptateur de capture doit produire ce snapshot puis organiser le
rescan. Ce contrat n'atteste ni une lecture atomique de localStorage et deux DB,
ni la fraîcheur des sources à l'instant du commit. Aucune capture fidèle ou
politique automatique de sélection n'est déduite des fixtures ci-dessous.

Les lignes fermées `['sync-state', owner]` et
`['sync-operation', owner, operationId]` sont ajoutées à `meta`, avec une seule
opération en attente. L'état chiffré conserve la **base ACK exacte**, distincte
de la tête proposée, et un mapping local/logique immuable par domaine et parent.
Les références non sélectionnées peuvent réserver une identité sans importer
leur contenu ; l'adoption ordinaire ne peut réattribuer ni retirer ces identités.
L'état privé utilise le secret utilisateur du coffre sync, un domaine HKDF
distinct, un sel et un IV frais et AES-GCM ; l'AAD lie owner, génération,
inscription, coffre, époque, révision et référence complète du paquet pending
(identifiant, longueur et hash du ciphertext). Les engagements en clair et les
identifiants physiques restent dans le ciphertext. L'état est borné à 8 Mio,
le paquet à 17 Mio ; base64 canonique contrôlé avant décodage, chaque ligne
reste dans la borne brute existante de 32 Mio. Référence API consultée :
[Web Cryptography Level 2, draft W3C du 22 avril 2025](https://www.w3.org/TR/2025/WD-webcrypto-2-20250422/),
pas une preuve de sécurité du produit ni une REC finale de niveau 2.

L'outbox capture elle-même le vrai compte, epoch, clé locale, verrou document,
layout, fence et garde d'effacement. Le client ne fournit ni owner, garde
d'autorisation, callback de transaction, ni objet `Prepared` structurel faisant
autorité. Elle prépare le paquet en interne, chiffre hors transaction puis
adopte état et opération dans **la même transaction RW meta**, avec CAS de la
paire précédente, fence et absence par clé du reçu d'effacement (même falsy).
Un quota entre les écritures abort les deux. Une reprise de commit incertain
ne reconnaît que cette paire exacte ; une opération A ne peut être remplacée
par B. Pas d'ACK local fictif ni d'avancement implicite de la base.

L'inscription et les vues RAM ne sont publiées qu'après commit et nouvelle
vérification de génération. Logout, changement de compte/clé, perte du document
ou constatation d'un fence IDB divergent retirent la capacité ; un mauvais
secret ne réinitialise aucune ligne. Verrouiller le coffre conserve la paire
durable et ne bloque pas les sauvegardes locales ordinaires. La réouverture
vérifie état privé, base, mapping et paquet puis `resumeSyncUpdate` reprend les
octets persistés, sans recapture ni nouvel appel de chiffrement.

Les inventaires utilisent le même parseur **pur**, sans importer la clé :
admission, provisioning, effacement froid, reset, restauration et purge chaude.
Version 2 seule ne suffit pas : nom actif et génération doivent correspondre
au layout déclaré ; legacy et journal de migration refusent ces familles.
La présence d'une opération orpheline interdit le provisioning comme compte
neuf ; son propriétaire vérifiable peut cependant la purger. Admission et
reprise exigent une paire cohérente, après priorité à la récupération d'un
effacement confirmé. Les ciphertexts des autres comptes sont inclus, non
filtrés, dans les preuves de restauration/effacement. L'admission parcourt les
clés et lit les lignes une par une, en ne gardant que les identités des paires.

Restauration et outbox partagent une exclusion de publication du même document
et un compteur monotone : une écriture déjà terminée invalide aussi un ancien
préflight. L'exclusion est prise avant la preuve finale de restauration et
relâchée à la fin de la tentative. Dès l'entrée dans l'adoption control, la
retraite du document précède cette libération, même en erreur ; un échec de
préflight antérieur ne nécessite pas de retraite. Le travail d'adoption est aussi
annoncé au registre d'activité existant. Ce mécanisme ne revendique toujours
pas de transaction globale entre bases.

Deux challenges readonly avant et après code ont notamment fait corriger :
références historiques non sélectionnées, réattribution de mapping, publication
RAM après verrouillage réentrant, inscription RAM avant commit, fence durable
refusé mais clé encore accessible, et course restauration/outbox. GO code bornés,
sans affirmation de W06 complet.

Preuves : suites nouvelles `workspaceSyncLocalFormat.test.ts` et
`workspaceSyncLocalOutbox.test.ts`, vrais services de compte/crypto/admission,
WebCrypto réel et fake-indexeddb. A pending puis vraie sauvegarde B et reboot ;
mauvais secret ; quota entre les deux writes ; CAS concurrent ; commit perdu ;
ABA ; falsy erasing ; DB supprimée non recréée ; verrouillage dans le dernier
retour de validation ; fresh `initCrypto` avec sel absent et state/orphan ;
purge de A préservant `a-b` et `a:b`. La vraie publication d'archives v1/v2/v3
préserve une paire B qui se rouvre ensuite. Le vrai cycle effacement froid et
reset est testé avec paire A complète **et opération A orpheline**, B lisant,
écrivant et reprenant son paquet inchangé. Une tentative sync pendant le vrai
commit control de restauration est refusée et la reprise froide reste valide.

Recette `scripts/check-workspace-sync-outbox-browser.mjs`, Chrome 152.0.7977.77,
le 6 septembre à **23:26:23 UTC** (rejeu final) : vrais IndexedDB, Web Locks et WebCrypto,
profils synthétiques jetables, pages détruites. Trois scénarios passent :
réouverture, quota entre writes, coupure après commit avant réponse ; lignes et
référence exactes, aucun encrypt/aléa à la reprise, sauvegarde locale B coffre
fermé, zéro erreur de page et zéro appel externe/API. La coupure native est
enregistrée avant le gestionnaire Promise IDB pour tenir compte du checkpoint
microtask entre listeners Chrome, différent de fake-indexeddb. Aucune donnée
de production, aucun override de START, aucun APK ni appareil physique testé.

Vérification complète finale Node 22.23.2 : 336 suites, **4 427 PASS et
1 ignoré préexistant**, typechecks front/back, couverture, no-CASA, build et
vrai worker Office. Les deux canaris ajoutés après la première passe à 4 425
tests sont inclus dans cette dernière passe réussie. Reçus ignorés :
`workspace-sync-outbox-verify.log`, `workspace-sync-outbox-verify-final.log`,
`workspace-sync-outbox-targeted.log`, `workspace-sync-outbox-browser.log`,
`workspace-sync-outbox-browser-final.log`.

Au commit `ebe94b9`, l'outbox n'était pas appelée par l'UI et ne capturait pas
les sources réelles. La tranche ci-dessous raccorde ces sources ; transport,
ACK, applicateur et activation restent à livrer.

### B2b — capture applicative réelle et rescan explicite (7 septembre)

`localOutbox.capture` prend une sélection explicite, copiée synchroniquement
avant toute attente. Le service lit les vraies conversations admises, leurs
fichiers/galeries chiffrés et les projets sélectionnés avec originaux et textes
extraits, via les readers readonly existants. Aucun reader fourni par le caller,
réextraction, accès réseau ou lookup d'URI Markdown. Les objets non sélectionnés
et toute leur ascendance sont conservés ; absence, quota, verrouillage et
conflits ne deviennent jamais des suppressions ou résolutions implicites.

La projection sync est dédiée, fermée et par descripteurs de données : champs
inconnus/exécutables refusés. Elle conserve ordre et texte UTF-16 exact, valeurs
nulles/vides/fausses/zéro, métadonnées brutes de comparaison (pas les statuts
reconstruits à l'affichage), fact-check, attribution, `restoredArchive`, flags
EU/Google/documentaires et restriction de sortie. Une incohérence du couple
restriction/documentaire ou la suppression du marqueur par alias est refusée.

Le mapping durable est étendu par domaine et parent : branches, groupe,
original/peer/réponse absents, messages, fichiers, crops et provenance projet.
Une référence historique absente réserve un binding `reference`, sans importer
son contenu. L'identité du document est celle de son record `project-source`,
liée séparément au record `project-text` ; le même ID physique dans deux projets
ne désigne pas le même document logique. Le propriétaire et la révision CAS du
projet restent locaux ; les révisions historiques documentaires sont conservées.

Le conteneur privé `ARTYSOBJ1` v1 contient un header, des métadonnées JSON
canoniques et les octets binaires **sans inflation base64**. Les 10 Mio portent
sur le conteneur complet ; la capture reste bornée à 16 Mio/256 objets, sans
troncature (une sélection plus petite est nécessaire au-delà). Texte extrait
vide, BOM, CRLF et surrogate isolé restent exacts grâce au framing JSON. Un
fichier durable non-image vide est représenté comme zéro octet, pas comme absent.
Taille réelle, ancienne taille enregistrée et présentations par message restent
distinctes. La galerie exige les vrais reçus et octets d'image valides. Le texte
brut, y compris une URI dans la prose ou du code, n'est **jamais réécrit** ; une
table privée typée `galleryAliases` lie token historique, message et fichier
logiques pour le futur applicateur. Elle ne constitue pas une autorité de lookup.

Seule écriture source de cette capture : stabiliser un ancien ID `streaming`
déjà normalisé au boot. Le suivi privé porte sur le couple exact conversation/ID
alloué, pas une heuristique texte/date ni un WeakSet perdu après spread. Sous
garde réelle et hors travail actif, la safety-net complète est écrite avant
création des tickets. Échec de quota : M1 reste en RAM, ancien ciphertext intact,
aucune adoption ni quarantaine. Le garde de l'historique complet a son budget
propre (32 Mio/1 million de nœuds), distinct d'un payload sélectionné. Un boot
plaintext qui a déjà publié le bon ciphertext acquitte les seuls IDs concernés
**après** suppression effective de l'ancien plaintext prioritaire, ou preuve que
celui-ci contient exactement la forme normalisée. Un nettoyage refusé ne doit
jamais permettre adoption M1 puis reboot M2.

Le résultat est explicitement **historique**, pas une transaction globale ni une
promesse d'état courant à l'instant d'adoption. Les tickets de conversation et
leurs alias restent vérifiés jusqu'au retour de capture ; les révisions de tous
les projets encadrent les lectures ; les fichiers viennent d'un seul instantané
IDB antérieur. Leur remplacement après cet instant est détecté au scan suivant.
Owner/clé/fence/document et annulation restent gardés jusqu'au commit. Annuler
l'adaptateur retire sa capacité, y compris pendant le chiffrement/adoption.

La tête locale déchiffrée (`localHead`) est distincte de la base ACK et disponible
après réouverture de l'outbox. Le rescan compare hash/longueur des octets canoniques
au head live unique **avant** d'allouer payload/révision. Un scan inchangé n'écrit
pas et ne crée ni ID ni ciphertext. Après A pending puis modification locale B,
le résultat est `pending-changes` : B reste local, A reste exact, pas de faux ACK,
pas d'écrasement. `adopted` signifie seulement commit local de cette capture.

Preuves : `workspaceSyncCapture.test.ts` utilise vrais compte, crypto, bootstrap,
files/projects et outbox avec fake-indexeddb. Deux boots de partiel sans save
fixture, quota, refus de cleanup puis reboot/quota, gros historique voisin,
comparaisons liées avec original/réponse absents, rescan identique/réduit,
présentations divergentes, fichier vide, galerie malformée, getters, restriction
par alias, source étrangère, texte vide/BOM/CRLF/UTF-16, documents homonymes dans
deux projets, extra de descriptor, mutations, ABA/fence/abort, activité, conflit
et tombstone refusés. Remplacement réel d'un fichier entre lecture et capture
puis rescan ; annulation pendant le vrai chiffrement. Avec outbox et archive :
**84 tests ciblés réussis**. Deux contre-revues indépendantes readonly ont fait
fermer les cas sélection mutable, restrictions, extras, fichiers vides et
acquittement trop précoce du plaintext.

Chrome 152.0.7977.77, rejeu final à **23:57:29 UTC le 6 septembre** (7 septembre
en France) : quatre scénarios natifs passent. Aux trois scénarios outbox déjà
documentés s'ajoute capture réelle projet/texte/source, fichier vide, galerie et
partiel → destruction de page → réouverture/rescan sans UUID ni chiffrement →
vraie modification B, paquet A inchangé. Zéro erreur de page et zéro appel
externe/API. Log ignoré `workspace-sync-capture-browser-final.log`.

Vérification complète **finale** Node 22.23.2 : **337 suites / 4 458 PASS et
1 ignoré préexistant**, types front/back, couverture, no-CASA, build et vrai
worker Office réussis (exit 0). Cette passe inclut les quatre derniers canaris
après la première passe à 4 454 tests. Log ignoré
`workspace-sync-capture-verify-final.log`. Deux GO readonly locaux bornés après
fermeture de la dernière course plaintext/identité ; aucun défaut bloquant
résiduel identifié dans leur périmètre, pas une preuve de sécurité générale.

START reste OFF, service interne sans activation UI ; aucun endpoint, bucket,
migration distante, checkout ou secret de production modifié. Candidat local
non poussé/non déployé. Le rescan est explicite, pas un ordonnanceur automatique.
Transport, ACK authentifié, rattrapage après ACK, applicateur sans ping-pong
(y compris alias galerie et restrictions), effacement serveur, consentement UI
et recettes à deux appareils restent des obligations W06, pas des exclusions.

### Livraison B2b — stockage récupérable, outbox et capture (7 septembre)

Les candidats locaux ci-dessus sont maintenant livrés :
[PR #485](https://github.com/flotellop-art/Arty/pull/485), fusion normale à
00:10:19 UTC, main `cadf1abc738b949b26ce0cb04a209b00dff8d734`. Les trois commits
0dd036b/ebe94b9/284bb4b ont été squashés sans changement de leur arbre vérifié.
Deux GO readonly indépendants bornés avant fusion. [CI PR](https://github.com/flotellop-art/Arty/actions/runs/34068623055)
et [CI main](https://github.com/flotellop-art/Arty/actions/runs/34068949051)
réussies : 337 suites / **4 458 PASS + 1 ignoré préexistant**, types,
couverture, no-CASA, build, vrai worker Office, Android et Worker de croissance.

Pages preview `36ac4704-754f-46ee-99e8-70eec2088c8c`, puis production
`2bf7374d-0a14-40f5-b73e-de4c4d174a46` réussies. À 00:12:08 UTC, tryarty.com et
[le déploiement immuable](https://2bf7374d.appfacade.pages.dev) servent les mêmes
octets des chunks déclarés contrôlés. Entrée `index-D_D2RtDz.js`, SHA-256
`0ac50ae4482de3fe4cf8752069388710e63384e3293cd0ff5752747f5d01d63d`.
Chrome public réel : FR/EN, 390 et 1280 px ; routes upgrade/prepare conformes,
aucun débordement ni erreur de page, aucune DB créée par leur simple visite.
Les polices et le beacon Cloudflare sont tentés puis bloqués et recensés dans
la recette ; aucun appel API autorisé. Ce test DOM n'est pas une revue visuelle
générale ni une session utilisateur authentifiée.

Observation achevée de **00:12:09 à 00:27:09 UTC** : 16 points sur 15 minutes,
HTTP 200 et entrée JS identique entre domaine canonique et déploiement immuable
à chaque point ; exit 0 (`workspace-sync-production-observe.log`). Les sept
chunks contrôlés restent identiques au contrôle final de 00:27:06 UTC
(`workspace-sync-production-final-static.log`). Ce sondage anonyme ciblé ne
mesure pas le taux global d'erreur des utilisateurs ni les parcours connectés.

Rejeux locaux dans Chrome avec vrais services et comptes synthétiques : cinq
scénarios upgrade natifs à 00:03:29 UTC ; vraie UI de restauration à 00:07:05,
téléchargement exact PDF/TXT, projets, deux propriétaires relus/écrits après
reload et repli compatible du START de restauration. Aucune donnée personnelle
de production utilisée. Logs ignorés `workspace-sync-release-upgrade-browser`,
`workspace-sync-release-restore-ui`, `workspace-sync-preview-ui`,
`workspace-sync-production-static` et `workspace-sync-production-ui` (`.log`).

[Firebase](https://github.com/flotellop-art/Arty/actions/runs/34068949155)
réussi à 00:19:55 UTC, y compris vérification du candidat exact, distribution
et nettoyage des secrets. Reçu `arty-apk-identity-<main>-1` : `com.arty.app`,
1.0.99 / code 100, 4 411 137 octets, signature vérifiée, SHA-256
`69358159d5a0c457a2f740b6db975105b158d418cb9aad9c1081d005a4aa81fe`.
Le JSON est une preuve d'identité d'artefact ; c'est le job Firebase réussi
qui atteste la distribution. ADB ne voyait aucun appareil connecté lors du
contrôle : **aucune installation ni recette sur téléphone physique annoncée**.
À 00:24:15 UTC, le `/.well-known/assetlinks.json` réellement servi sur
tryarty.com correspond octet pour octet au reçu du checkout, avec le package
et le fingerprint du signataire vérifié (`workspace-sync-production-assetlinks.log`).
Cela ne constitue pas la vérification de liens par Android sur un appareil.

Seul `WORKSPACE_UPGRADE_START_ENABLED` reste false ;
`ISOLATED_WORKSPACE_ENABLED` et `WORKSPACE_RESTORE_START_ENABLED` restent true.
Pas d'activation de capture/outbox par l'UI, d'endpoint sync, de bucket ni de
migration distante. Le lot touche réellement admission, inventaires et reprise
locale : il n'est pas « inerte » dans son ensemble. Repli vers #484 seulement
si aucun layout physique 2/journal v9 n'a été adopté ; sinon conserver les
readers projectsVersion 2 et la reprise v9 avec un correctif en avant. Aucun
downgrade IndexedDB ni suppression du journal/ticket pour forcer un repli.
W06 distant reste ouvert.

### B3 — contrat de raccord transport/ACK avant code (7 septembre)

**Statut initial de cette section : conception proposée, non implémentée ni activée.**
Le checkpoint serveur local décrit plus bas implémente depuis une partie de ce
contrat ; il ne constitue pas la verticale B3 ni une activation. Deux challenges
readonly indépendants (continuité/produit et sécurité/publication) ont relevé
les raccords suivants. Ils ne remettent pas en cause la livraison locale B2b,
mais interdisent de la présenter comme une synchronisation distante.

1. **Identité et révocation communes.** Partir de
   `verifyGoogleIdentityStrictDetailed`, puis exiger explicitement un `sub`
   string non vide ; son résultat `ok` actuel ne suffit pas. Ni identité proxy,
   whitelist, email fourni par le client, ni repli email pour ce coffre Google.
   L'enrôlement coffre/incarnation doit être attesté par le serveur avant les
   opérations : `unlock(initialScope)` n'atteste aujourd'hui qu'un état local.
   Les deux routes `account/delete.ts` et `account/erasure-v1.ts` doivent porter
   ce sujet vérifié jusqu'à la révocation du coffre, tout en conservant leurs
   effacements email existants. Aucun nouveau writer distant avant ce raccord.
2. **Trois checkpoints distincts.** La base B1 privée, le head de transport
   opaque acquitté et l'état réellement matérialisé dans les stores ne sont pas
   interchangeables. Le serveur ne reçoit pas le hash de base plaintext B1.
   Un reçu lie incarnation, opération, hash/longueur du ciphertext, prédécesseur
   et nouveau head opaques ; le client vérifie aussi son manifeste A exact.
   Aucun avancement de base d'application sur simple téléchargement de R.
3. **ACK A atomique.** L'état privé actuel ne contient que `base` et `bindings`
   (`privateState.ts`) ; le CAS actuel ajoute une opération et écrit l'état,
   mais n'en supprime aucune (`localOutbox.ts`). La future transition adopte
   ensemble l'état chiffré avec base A/checkpoint et la suppression de la seule
   row A. Sceller avant la transaction ; propriétaire/fence/génération/pending
   exacts dans celle-ci ; publier la RAM après commit. Quota/coupure conserve
   soit l'ancienne paire complète, soit le nouvel état complet reconnaissable.
   Seul un doublon du reçu exact d'un A déjà acquitté est un no-op pendant un
   nouveau paquet B pending ; l'operationId seul n'atteste pas ce doublon.
   Le premier ACK A avance bien la base vers A même si B a entre-temps été
   sauvegardé dans les stores. Jamais de clear global. Après ACK A,
   rescanner les vrais stores pour B, sans remplacer B par le snapshot A.
   La nouvelle forme privée exige un format/version et une compatibilité de
   reprise explicites ; pas de champs glissés dans la grammaire v1 fermée.
4. **Issue inconnue versus conflit définitif.** Réponse perdue : rejouer les
   octets A ou consulter son reçu durable. Un 404, timeout ou échec d'auth n'est
   pas un refus définitif. Si le serveur atteste que R a gagné le CAS et que A
   ne pourra plus être publié, conserver A jusqu'à adoption atomique d'une
   supersession fusionnant la base commune exacte, A figé et R vérifié via B1.
   Les modifications B non capturées restent dans les stores pour le rescan
   suivant. Préserver les révisions de A et ses
   payloads ; ni faux ACK, ni nouvelle opération sur base vide. Le retry exact
   seul ne peut résoudre ce conflit : l'outbox actuelle bloque à juste titre
   une nouvelle préparation pendant A.
5. **Un second appareil a besoin de la chaîne.** B2a n'embarque que les nouveaux
   payloads contre une base exacte. Choix initial proposé : chaîne publiée
   conservée par incarnation, pagination ancrée sur un head précis et limites
   cumulées d'objets/octets incluant réservations et orphelins. Ne pas collecter
   les anciens paquets à leur ACK : un fichier inchangé peut n'exister que dans
   le premier. Une base absente/inaccessible bloque la réception. Alternative
   reportée : checkpoints autonomes et collecte attestée, plus complexes mais
   nécessaires si la rétention bornée limite trop les usages ; jamais une
   troncature silencieuse ni un quota calculé seulement sur le dernier paquet.
6. **Application fidèle et recapture inchangée.** Le futur journal `sync-apply`
   coordonne stores, mapping et checkpoint matérialisé dans la génération
   active ; il ne détourne pas la restauration additive. `captureMapping.ts`
   tire actuellement les alias galerie des IDs physiques. Un autre appareil
   peut allouer d'autres IDs sans changer le texte historique : conserver une
   provenance d'alias durable réutilisable à la recapture, indépendante des
   adresses physiques. Aucun lookup d'URI ni réécriture du texte brut. Éprouver
   aussi présentations/tailles, comparaison, restrictions et marqueurs inertes.

Réservation D1 atomique avant les octets R2 : sujet, coffre/incarnation,
operationId, head attendu et hash/longueur du ciphertext figés, budgets octets
**et nombre d'opérations**. Même opération identique = même réservation ;
toute variation est un conflit. Corps binaire borné via `limitReadableStream`,
taille réellement consommée et checksum SHA-256 R2 vérifiés ; clé calculée
serveur, sans chemin fourni par le client. `put=null` impose de relire et
attester l'objet existant ; des métadonnées déclaratives seules ne suffisent
pas. Publication head/reçu/compteurs sous le même ticket et gate SQL dans le
batch D1 ; zéro ligne modifiée n'est pas une erreur SQL. Les compteurs IA
fail-open et la limite IP en RAM ne constituent pas ce budget de stockage.

Pour l'effacement R2, la révocation D1 suivie d'un DELETE et d'un délai ne prouve
pas qu'un PUT déjà admis ne recréera pas l'objet. La documentation indique que
le dernier PUT/DELETE terminé gagne ([cohérence R2](https://developers.cloudflare.com/r2/reference/consistency/)).
Piste à éprouver, **non adoptée comme garantie** : clés create-only par opération
avec `If-None-Match: *`, neutralisées par une tombstone sans contenu conservée
sur la même clé. R2 documente le refus de stockage si la condition échoue
([API conditionnelle](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations)),
mais un test local ne certifie pas à lui seul l'atomicité d'un PUT déjà en vol
contre cette neutralisation en production. Tant que les écritures admises ne
sont pas neutralisées avec une preuve suffisante, garder le nettoyage durable
incomplet ; aucun reçu « effacé » ni expiration qui supprime cette obligation.
Le GET de reçu `erasure-v1.ts` reste SELECT-only : prévoir un exécuteur durable
de nettoyage distinct et réellement appelable après crash ; ne pas faire du
GET actuel ou de `waitUntil` un faux mécanisme de reprise.

Spike local, rejeu final à **00:22:50 UTC**, Miniflare 4.20260730.0, compatibilité Workerd
2026-08-06, bucket synthétique éphémère : le vrai `FixedLengthStream(2)` est
suspendu après résolution de l'écriture du premier octet, puis repris après
neutralisation. Le PUT n'est pas résolu et le dernier octet n'a pas encore été
fourni ; le test ne voit pas le moment où R2 évalue sa condition côté stockage.
Contrôle négatif DELETE : les deux octets réapparaissent. Tombstone vide sur
la même clé : PUT conditionnel retourne null et la tombstone reste intacte.
La tombstone préexistante refuse aussi le PUT. Trois scénarios passent ; aucun
stockage distant ou handler Arty, ni preuve de transaction D1 ou d'atomicité
en production. Script/log ignorés `workspace-sync-r2-race-probe.mjs`/`.log`.

**Recette de passage obligatoire** : deux profils indépendants, vrais stores
et API locale D1/R2. A contient comparaison, galerie, pièce jointe et projet ;
B est sauvegardé localement pendant A. Publication A réussie/réponse perdue,
reload, reçu exact, ACK A, rescan/publication B. L'autre profil rejoint depuis
zéro, retrouve aussi les anciens payloads, applique/recharge puis recapture
inchangée (aucune nouvelle révision). Réponse dans l'autre sens sans doublon ;
variante modifications concurrentes avec toutes les versions et conflit
visible. Coupures à chaque frontière, second compte intact, corruption/quota,
révocation/recréation et PUT suspendu avant sa vraie consommation finale.
Un stub retardant seulement la réponse d'un PUT terminé n'éprouve pas ce cas.
Les états « local », « publication inconnue », « publication confirmée »,
« reçu non appliqué » et « conflit » restent distincts ; aucun ne signifie à
lui seul « tous les appareils à jour ».

### B3a — checkpoint serveur local, désactivé (7 septembre)

**Code présent, non poussé/non déployé ; W06 reste partiel.** Le contrat local
`scripts/workspace-sync-contract/wrangler.jsonc` sert à générer les types avec
Wrangler 4.129.0. Il ne contient ni point d'entrée déployable ni identifiant de
ressource réelle. Les bindings générés sont optionnels dans `functions/env.d.ts`.
`0009_workspace_sync.sql` n'a été appliquée que dans les D1 éphémères du test ;
0008 reste réservée au chantier crédit séparé. Aucun bucket ou flag distant
n'a été créé/modifié. Le START doit être exactement `true`, avec DB et bucket,
avant challenge/enrôlement/réservation ; tout défaut refuse avant auth/body/SQL.
Les opérations déjà admises et l'effacement restent indépendants de START.

Implémenté dans `functions/api/_lib/workspaceSync` et les handlers :

- Sujet Google strict vérifié, `sub` string borné, digest distinct du namespace
  des reçus d'effacement. Aucun email, token, secret de chiffrement ou hash de
  plaintext stocké dans les tables sync.
- Challenge durable idempotent, génération serveur rotative à l'effacement,
  confirmation explicite. Un ancien challenge rejoué ne crée pas une nouvelle
  génération. Le plafond de 512 challenges historiques ne doit pas être
  contourné en supprimant leur preuve anti-rejeu.
- Réservation exacte et budgets cumulés par sujet : 128 MiB et 512 opérations,
  incluant réservations/coffres non purgés. Batch D1 avec ticket commun pour
  insertion et compteur ; doublons différents refusés.
- PUT ciphertext create-only, flux de longueur exacte borné et checksum R2
  SHA-256 ; objet existant relu/attesté. Chaque appel PUT est inventorié avant
  départ. Seule sa résolution positive permet de retirer cette tentative.
  Un rejet/timeout ambigu reste durablement non résolu, sans expiration.
- CAS publication/reçu/head dans le même batch ; un perdant devient `conflict`,
  un `reserved` ou `uploaded` n'est jamais une publication. Pagination 32
  entrées ancrée, continuité des séquences/prédécesseurs contrôlée. Les anciens
  paquets publiés restent récupérables ; pas de collecte à l'ACK.
- Effacement compte : mêmes tickets SQL pour données historiques, capture de
  **tous** les coffres non purgés (même déjà révoqués), révocation et rotation de
  génération. Le legacy `/account/delete` refuse avant toute suppression dès
  qu'un coffre existe pour ce sujet. Un schéma sync partiel échoue fermé.
- `POST /api/account/erasure-cleanup-v1` reprend uniquement les cibles figées
  d'un reçu existant, authentifié par sa capacité, sans OAuth ni nouvelle cible.
  Lots de 8 coffres / 32 opérations, sans PUT de tombstone. Tant qu'un writer
  admis reste inconnu, pas de DELETE de son objet ni de reçu `confirmed`.
  Tous les writers positivement terminés permettent DELETE puis purge attestée.
  Rejouer un ancien reçu confirmé n'efface pas une incarnation recréée.

Les requêtes D1 n'emploient pas une session « first-primary » qui ne rendrait
pas les lectures suivantes nécessairement fraîches : sans Sessions API, D1
dirige chaque requête vers le primaire, selon la
[documentation de réplication D1](https://developers.cloudflare.com/d1/best-practices/read-replication/)
revérifiée. Le test R2 local n'est toujours pas une garantie d'atomicité distante.

**Preuves locales :** typechecks frontend/functions réussis ; campagne de
régression **79 suites / 922 tests PASS**, dont les 15 nouveaux tests transport
et les 7 reçus D1 existants. Compilation locale complète des Pages Functions
réussie avec Wrangler 4.129.0 ; aucune publication. Les handlers, middleware et vérificateur Google
réels sont compilés dans workerd/Miniflare 4.20260730.0 (compatibilité test
2026-08-06). Seule la réponse HTTP `tokeninfo` est simulée ; paquets synthétiques
de 200 octets, donc aucune preuve de crypto ou d'application multi-appareils.

Les tests couvrent compte étranger, doublons/variations, concurrence CAS/budget,
pagination 34 opérations puis publication 35 sans glissement d'ancre, trous,
OFF/retrait du bucket, schéma partiel, ancien reçu/recréation, et rollback
transactionnel par vrai trigger D1. Une requête HTTP dont le corps est tenu
incomplet est réellement admise, révoquée puis libérée : réponse 410, nettoyage
pending avant sa résolution et confirmé après. Ce test n'observe pas l'instant
d'évaluation de la condition R2. Un autre canari injecte un writer inconnu puis
sa résolution **synthétique SQL** ; cela ne prouve aucune récupération automatique
d'un appel R2 définitivement inconnu. Deux contre-revues indépendantes ont
corrigé la capture des anciens coffres, le schéma partiel et le tombstone non
inventorié. GO borné au checkpoint local, pas à une activation.

**À terminer avant raccord/activation (état historique B3a ; points 1–2
implémentés localement en B3b ci-dessous) :**

1. Reprise utilisateur du nettoyage dans les parcours chaud **et** froid. Le
   GET de reçu reste actuellement SELECT-only et ne renvoie pas encore
   `cleanup-pending` ; l'ancien client ne peut pas appeler le nouveau POST.
   Un appareil legacy peut effacer un compte dont le coffre vient d'ailleurs :
   ne pas présumer que son journal l'amènera à l'écran froid. Prévoir une commande
   explicitement confirmée, pas une migration, un POST ou un reload implicites.
2. Contrat froid accepté avant code : autorité privée liée à root/reçu complet/
   paire de fences, acquise après un GET pending strict puis réattestation.
   Consommer avant POST ; relecture readonly puis garde/LS synchrones juste
   avant fetch. Pending typé seulement après contrôle d'annulation/autorité.
   Refuser cleanup pour header déjà adopté, not-sent, local-only, confirmé ou
   action inconnue. Réponse perdue : conserver le reçu et revenir à GET.
   Garde de montage avant import/départ ; pending distinct de `done` dans l'UI.
3. Découverte/jointure d'un coffre existant depuis un second profil, avec
   confirmation explicite. Le challenge actuel crée une nouvelle proposition
   et l'enrôlement refuse un autre coffre actif ; transmettre directement un
   scope de test ne résoudrait pas ce manque.
4. Transport client lié au vrai GoogleGrant capturé avant await, privateState
   versionné, ACK exact A puis rescan B, supersession sur conflit, réception/
   apply et recette deux profils décrits plus haut : toujours absents.
5. Issue opérationnelle sûre des PUT définitivement inconnus, borner et expliquer
   la saturation des huit tentatives non résolues et des historiques. Pas de
   timeout/TTL/settlement administratif inventé comme preuve. Politique de
   rétention/consentement, juridiction et capacité à valider avant provisioning.

Après le premier état sync serveur réel, y compris un challenge avant tout
coffre, un rollback serveur ignorant ces tables (dont #485) serait incompatible
avec l'effacement : garder ces lecteurs/gates et préférer un correctif en avant.
Sinon une suppression legacy pourrait omettre la rotation de génération et
laisser un ancien challenge réutilisable après roll-forward. Désactiver START
n'autorise pas de retirer ces protections.

### B3b — reprise explicite du nettoyage distant, candidat local (7 septembre)

Ce lot raccorde l'effacement existant, pas le démarrage de synchronisation.
Les flags/bindings/ressources distants restent inchangés. Aucun POST n'est
déclenché en ouvrant les réglages ou par la simple consultation d'un reçu.

- Le premier POST d'effacement renvoie désormais `202 cleanup-pending` quand
  ses cibles distantes restent à purger. Le GET demeure SELECT-only et renvoie
  le même statut fermé, lié à l'opération/capacité/sujet exacts. Seul `confirmed`
  autorise le passage au nettoyage local ; un 202 ne publie pas cette autorité.
- Parcours chaud, y compris stockage legacy : une action séparée et confirmée
  appelle `continueAccountErasureCleanup`. Chaque invocation fait GET, atteste
  le reçu complet/root/paire de fences/document/session, puis peut POSTer le
  cleanup existant. Aucun OAuth, nouveau nonce ou recours à la confirmation
  historique permissive. Le helper dédié fait un CAS intégral de confirmation.
- Parcours froid : le GET pending validé et réattesté crée une autorité privée
  dans l'acteur. Le bouton distinct la consomme avant le POST ; une erreur ou
  réponse perdue impose de consulter à nouveau. Le passage du reçu à confirmé
  compare aussi les fences dans sa transaction RW. Le protocole local v6/v7
  reprend ensuite sans importer l'App privée ni lancer de KDF.
- Annulation, changement de session, document perdu ou changement du reçu
  refusent la suite. Pending n'est jamais `done`. L'UI protège les doubles clics,
  les suites d'import après démontage et les anciens callbacks A face à B.
  Une confirmation durable avec nettoyage local interrompu conserve sa voie
  locale, sans deuxième requête distante. Le handoff isolé exige un reload.
- Les textes FR/EN distinguent distant/local, consultation/reprise et résultat
  inconnu. Ils ne prétendent pas qu'une requête déjà envoyée a été annulée.
  Le focus revient au résultat après l'action ; le titre froid ne présume plus
  que le travail restant est exclusivement local.

Preuves ajoutées : `accountErasureSyncCleanupRoundTrip.test.ts` passe **4 cas**
avec vrais services locaux, handlers/middleware dans workerd, D1 et R2 locaux :
legacy après reload, isolé chaud, isolé froid, et POST cleanup réellement
committé dont la réponse est perdue, suivi d'un GET confirmé sans second POST.
Côté backend, seule l'API tokeninfo externe est simulée. Le banc client emploie
fake-indexeddb, des Web Locks simulés, un getter OAuth contrôlé et un shim
Capacitor web ; les services/runtime/KDF sont réels. Les paquets sont
opaques/synthétiques, donc ce test ne valide pas le codec. Le client ne redemande aucun token après
le premier effacement. Dans chaque cas, B conserve son objet R2, sa ligne D1,
son projet chiffré et peut lire/créer/relire après un nouveau document.

Tests unitaires/de composants : pending répété, reçu invalide, A→B→A, quota du
CAS, panne locale après confirmation, double clic et démontage. Les injections
de nonce/fence à l'intérieur des vraies transactions IndexedDB de confirmation
refusent sans confirmation/purge. IndexedDB est simulé dans ces suites.

Recette Chrome réelle du 7 septembre à 01:43:56 UTC : **5 scénarios PASS**,
FR/390 et EN/1280 chaud/froid, plus perte réelle de l'admission pendant le GET
avec panneau encore monté. UI/services/IndexedDB/chiffrement locaux réels,
statuts HTTP et reçu initial synthétiques, réseau extérieur bloqué. Pending
répété puis confirmation, B relu/réécrit après reload, focus vérifié, aucun
débordement horizontal ou pageerror ; aucun POST après perte du document.
La voie froide utilise le vrai point d'entrée `main`, sans App/crypto importés
pendant sa reprise et sans toucher l'URL callback. Les preuves serveur et UI
sont complémentaires, pas un E2E Google/Cloudflare de production.

Les contre-revues ont fait corriger : fences absentes du CAS froid, getters
privés susceptibles de lever après perte du document, succès tardif A pouvant
recharger B, et texte d'erreur trop affirmatif. La validation reste locale.
Les scripts/captures et logs synthétiques sont dans `.playwright-mcp`, hors Git.

Toujours requis pour W06 : découverte/jointure d'un coffre au second profil,
transport client avec véritable grant, ACK/persistance exacte et rescan,
réception/apply/conflits, consentement/rétention et recette deux profils puis
appareil. Le cas PUT définitivement inconnu reste bloquant pour son coffre ;
aucun TTL ni settlement inventé ne le clôt. B3b ne valide pas ces exigences et
ne justifie aucune activation/provisioning de synchronisation.
