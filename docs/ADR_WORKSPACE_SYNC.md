# W06-B — synchronisation chiffrée optionnelle

Date : 6 septembre 2026. **Décision de conception / implémentation partielle**.
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
build et worker Office isolé verts. CI exacte à vérifier avant fusion.

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
