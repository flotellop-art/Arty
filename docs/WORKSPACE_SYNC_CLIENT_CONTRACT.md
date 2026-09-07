# W06-B3c — contrôleur client local, verticale encore incomplète

7 septembre 2026. Ce document complète l'ADR, ne réduit pas le périmètre W06 et
n'autorise aucun provisioning ni activation. B3a/B3b est livré OFF par #486.
La découverte/jointure et le contrôleur ci-dessous sont **locaux uniquement**.

## Premier morceau écrit et vérifié

`GET /api/workspace-sync/v1?action=discover` est authentifié par le vrai
vérificateur Google/sujet `sub` strict et ne crée rien. Schéma absent ou partiel,
requête SQL indisponible, coffre orphelin/incohérent ou plusieurs coffres actifs
refusent, sans transformer l'incertitude en `none`. Le DTO fermé ne transporte
ni email, ni sujet, ni code. `none` signifie **aucun coffre actif**, pas aucune
donnée locale ; `active/head=null/sequence=0` signifie préparation inachevée.

`POST ...?action=join`, `consent:true`, compare la génération et l'incarnation
exactes découvertes à une observation SQL unique sujet → registre → enrôlement
→ coffre actif. Cette confirmation ne crée ni coffre ni journal d'adhésion.
Un effacement/recréation invalide l'ancien tuple ; une publication ordinaire
dans le même coffre ne l'invalide pas et retourne le head courant. START ferme
chaque nouvelle jointure avant auth/corps/SQL ; les lectures restent distinctes.

Deux contre-revues indépendantes ont validé ce morceau, sous réserve des tests
ensuite terminés : **45 tests ciblés PASS** (26 découverte/grammaire, 15 transport,
4 cleanup roundtrip), puis `npm run verify` **341 suites / 4557 PASS + 1 skip
existant**, types frontend/functions, build, inventaire OAuth et véritable
worker Office. Compilation complète des Pages Functions à la date réelle
`2026-04-10` réussie. Tests D1/R2/workerd locaux, Google HTTP simulé uniquement
côté serveur ; fixtures ciphertext opaques, pas de preuve de clé ni de client.

Les deux canaris ajoutés après challenge passent : publication réelle entre
découverte et confirmation → nouveau head/séquence exacts, sans mutation de
jointure ; panne réelle du SELECT → 503, jamais `none`. Même email/autre `sub`,
effacement/recréation, chaque table manquante et unicité perdue sont couverts.
Sources : `discovery.ts`, `transportFormat.ts`, `workspaceSyncDiscovery.test.ts`.

## Contrôleur client écrit, non activé

`clientTransport.ts` capture le vrai grant Google avant toute attente et limite
chaque requête à 45 secondes, sans annuler le refresh partagé. Chemin et scope
sont reconstruits, cookies et redirections refusés. Le JSON de requête reste
borné à 8 192 octets ; une page réelle de 32 publications utilise une borne de
réponse distincte de 32 768 octets. Le buffer borne aussi la surcharge des
micro-fragments ; le nettoyage annule la requête même si les en-têtes sont
refusés avant acquisition du lecteur de corps.

`localOutbox.connect()` expose des choix/code, pas de reçu, manifest, URL,
grant ou guard injectables. Discovery privée puis création : challenge réel,
genesis chiffrée persistée avec son intention exacte, **ensuite** enroll et
status/reserve/upload/commit. Une opération locale en attente n'est pas une
réservation distante ; seul `operation_unknown` permet une nouvelle réserve.
Les reprises déjà admises restent distinctes de START, et un HTTP 409 générique
n'est jamais assimilé à un conflit définitif ou à un acquittement.

L'état privé v2 conserve admission/checkpoint/sélection ; les nouvelles
créations/jointures utilisent désormais v3 (voir contrat d'application), qui
sépare transport, branche représentée et origine de l'envoi. V1/V2 demeurent
lisibles et reprenables sans conversion ; v1 sans promotion réseau implicite. Un ACK appartient
au contrôleur ayant reçu la réponse HTTP et au paquet durable A relu/validé.
Scellement de la base A, CAS de la paire complète et suppression de la seule
opération A sont atomiques ; RAM après commit. Un doublon tardif n'atteste que
la paire durable courante, jamais un ancien état rejoué. Changer la sélection
révise **les deux wrappers**, sans rechiffrer ou remplacer le paquet A.

La jointure ouvre la vraie genesis distante avant toute row. Si deux créations
ont couru sur la même génération, le perdant ne peut remplacer que son
initialisation vide **authentifiée sous son ancien secret**, sans bindings,
sélection ni checkpoint. Le nouveau code prouve ensuite le coffre gagnant dans
une session temporaire distincte ; CAS exact, suppression de cette seule
genesis locale et résultat `joined-locked`. Un nouvel `unlock` avec le code
gagnant est nécessaire. Après reload, l'ancien code est donc requis d'abord ;
sans lui ou avec des données/sélections, conservation et refus, pas de reset.

Les contre-revues ont fait corriger : rescan repris après lock/unlock, flux HTTP
laissé vivant après refus des en-têtes, faux ACK après rollback IDB, et absence
d'issue pour une création concurrente perdante. Elles accordent un GO borné
aux correctifs sous tests verts, **pas** à l'activation ou à la verticale.

Preuve locale : `workspaceSyncClientRoundTrip.test.ts` utilise les vrais
services Google/crypto/stores, la migration froide puis l'upgrade v2 réelle,
et les handlers/middleware D1/R2 sous workerd. Les profils sont JSDOM/fake-IDB,
pas deux Chrome ; le pont HTTP bufferise PUT et réponse. Il prouve les reçus
perdus après traitement serveur, les guards et l'abort du signal client, pas
l'arrêt physique d'un PUT tenu côté serveur. Le serveur simule seulement
l'HTTP externe Google ; tous les comptes et contenus sont synthétiques.

Vérification complète du delta client : `npm run verify` terminé **exit 0**,
**343 suites / 4 584 PASS + 1 skip existant**, types frontend/functions, build,
inventaire OAuth et vrai worker Office. Les 27 nouveaux canaris comprennent
24 roundtrips et 3 tests de grammaire : sélection changée pendant A en attente,
wrappers réouvrables et ciphertext inchangé, streaming B après ACK A différant
le seul rescan, page serveur réelle de 32 publications, quotas, réponses
perdues, OFF avant/après réservation, deux secrets et account A→B→A dans le CAS.
Log ignoré : `.playwright-mcp/workspace-sync-client-verify.log`. Ces résultats
sont distincts des 4 557 PASS antérieurs du checkpoint serveur.

## Réception privée ajoutée ensuite

`reception.ts`, raccordé à `localOutbox.receive()/reception()`, relit la chaîne
depuis genesis sous une ancre précise. Budget cumulé de page avant tout objet,
liaison interpage, référence complète et manifeste exact au checkpoint local,
conservation des anciens payloads et dernier head non régressif sont vérifiés.
Une avancée ordinaire donne `remoteAdvanced`, pas un reçu « à jour » inventé.
Le rapport distingue `received-not-applied`, `envelope-chain-verified` et
`content: not-validated` ; les conflits distants ne deviennent pas une preuve
de conflit de l'opération A locale en attente.

Ni ACK, ni capture, ni écriture pendant cette réception. Le contrôleur garde
les corps et le manifeste en privé ; le rapport public détaché n'est pas une
entrée réinjectable d'application. Toute nouvelle paire, clé, grant, owner,
fence ou retraite du document invalide la capacité. Sa fermeture vide les
holders internes ; aucune promesse d'effacement physique de copies JS déjà
remises, de rétention durable ou de pic RAM mobile acceptable.

Les deux contre-revues n'ont pas relevé de blocage de ce raccord. Campagne
ciblée : 30 tests client/workerd et 11 tests de réception/codec réussis.
Ces derniers utilisent le vrai codec avec transport de fixture, notamment
corruption AEAD en seconde page malgré référence ciphertext recalculée,
substitution interpage, mauvais checkpoint/manifeste, recul/avancée du head et
budget cumulé refusé avant download. Ils ne sont pas une preuve serveur/UI.
La campagne complète du delta réception est terminée : `npm run verify`
**exit 0, 344 suites / 4 601 PASS + 1 skip existant**, types frontend/functions,
inventaire OAuth, build et vrai worker Office réussis. Log ignoré :
`.playwright-mcp/workspace-sync-reception-verify.log`.

La validation métier des maximales et dépendances est désormais raccordée à
`prepareReceived()` : frame/identités/bytes stricts, alias typés, conflits
d'arêtes signalés sans gagnant, orphelins retenus sans réinsertion. Le rapport
« contenu revu, non appliqué » est détaché et n'autorise aucune mutation.
Voir le [contrat d'application](WORKSPACE_SYNC_APPLY_CONTRACT.md) pour la
preuve de ce delta, le raccord v3 transport/matérialisé/pending et les travaux
suivants encore explicites : provenance galerie
et inertie, preuves de fraîcheur des vraies cibles jusqu'au journal froid,
conflits conservés et recette deux vrais navigateurs. Rien de cela n'est
substitué par le seul rapport de réception ou de validation métier.

## Contrat client avant toute adoption

1. **Autorité capturée avant attente/consentement.** Utiliser le vrai
   `captureGoogleGrant()` (`googleAuth.ts`), avec owner/session/crypto/document/
   fence capturés localement. Le transport retourne des preuves privées liées
   à cette autorité ; un DTO valide fourni par un appelant n'en est pas une.
   Après token, JSON, téléchargement, déchiffrement et CAS : réattester.
   Annuler l'attente de ce consommateur, jamais le refresh Google partagé.
   Le modèle `calendarClient.ts` aide pour la durée de vie, mais son verrou
   « une tentative » ne doit pas remplacer les retries sync idempotents.
2. **Pas de nouvelle table d'adhésion pour une lecture.** La demande initiale
   de challenge durable séparé pour join a été écartée après les deux revues :
   SELECT-only n'a pas d'effet distant à compenser. Réponse join perdue avant
   adoption = nouvelle confirmation/lecture, et refus si START est désormais
   OFF. Un commit local réellement réussi mais acquittement perdu est un cas
   différent : reconnaître uniquement son état adopté exact.
3. **Preuve de clé par genesis ordinaire.** Premier profil : préparer une fois
   le paquet chiffré manifeste vide → manifeste vide, Map payload vide ; le
   codec existant chiffre quand même les métadonnées. `capture()` vide retourne
   unchanged : préparation initiale dédiée, persistée avant réseau. Réserver
   contre head null, publier séquence 1/prédécesseur null, conserver ce paquet
   dans la chaîne. Reprise = mêmes octets/opération, jamais re-sceller une autre
   genesis après réponse perdue. Aucun sentinel/nouveau format réseau requis.
4. **Le second profil ne passe pas par l'auto-adoption actuelle.**
   `localOutbox.unlock(code, initialScope)` crée aujourd'hui un état vide pour
   tout code syntaxiquement valide : ce n'est pas la voie join. Télécharger
   d'abord la vraie genesis attendue, valider sa référence indépendante puis
   l'AEAD/base canonique, séquence 1/prédécesseur null et manifeste vide. Code
   faux, paquet absent ou préparation initiale inachevée : aucune row nouvelle
   ni libellé « rejoint ». Le scope vient du transport, jamais du harnais/UI.
5. **ACK v2 réel avant d'occuper l'outbox avec genesis.** La grammaire privée v1
   est fermée et ne contient pas de checkpoint opaque ; introduire v2 avec
   reprise explicite, pas des champs ajoutés discrètement. Sceller base A et
   son checkpoint, puis CAS de la paire exacte et DELETE de la seule opération
   A dans la même transaction. RAM après commit seulement. Doublon exact de A
   pendant B pending = no-op, sans supprimer B. ACK perdu, quota, ABA et coupure
   ne peuvent laisser une demi-paire. Après ACK A, rescan des vrais stores B.
6. **Reçu n'est pas appliqué.** Le second profil peut adopter seulement base
   vide/bindings[]/checkpoint genesis après preuve. Un head distant plus avancé
   est une observation/ancre de réception, pas sa base matérialisée. Le mapping
   actuel exige de vraies identités physiques pour chaque record : ne pas
   inventer des bindings pour importer un manifeste. Publication depuis une
   base dépassée bloquée jusqu'à réception/application/réconciliation. Journal
   apply, provenance d'alias, révisions/conflits et recapture sans ping-pong
   restent requis, comme les suppressions explicites sélectionnées.

## Recette verticale obligatoire, pas encore exécutée

Deux profils de navigateur réellement séparés, vrais stores, crypto et API
locale D1/R2 ; seule l'auth Google externe simulée. Le second profil neuf doit
traverser la préparation réelle du stockage (`projects.version=2`), pas une
fixture déjà migrée présentée comme un parcours depuis zéro. Les gates de test
ne sont pas une activation production ; les START livrés restent OFF.

Premier profil : enrôlement réel → genesis durable → publication/réponse perdue
→ reload/reprise byte-identique → ACK → première capture contre le head genesis.
A publié avec réponse perdue pendant une vraie sauvegarde B : ACK A, doublon
de A pendant B pending, rescan/publication B sans perte. Second profil sans
scope injecté : découverte/confirmation → code → preuve AEAD → chaîne ancrée
bornée, y compris anciens fichiers/galerie → reçu non appliqué → application
explicite → reload/recapture inchangée. Mauvais code, corruption, trous, quota,
switch/relink A→B→A, document retiré et révocation/recréation à chaque frontière.

Ce document ne clôt ni le cas R2 PUT définitivement inconnu (aucun TTL/settlement
inventé), ni rétention/consentement/juridiction/capacité avant provisioning,
ni essais physiques Android ni validation commerciale abonnements/crédits.
