# W06 — réception authentifiée et application froide

Statut : **premier import journalisé et reprise d’envoi concurrent implémentés localement, démarrage OFF ; application des mises à jour, résolution et recette multi-appareils encore requises**,
7 septembre 2026. Deux contre-revues indépendantes en lecture seule.
Complète [l'ADR sync](ADR_WORKSPACE_SYNC.md), sans réduire le CDC ni autoriser
un provisioning, une activation, un envoi juridique ou une collecte distante.

## Contexte et résultat attendu

Le contrôleur local sait publier et acquitter sa propre opération. Un second
appareil doit maintenant recevoir conversations/comparaisons, galerie et
projets documentaires fidèles, puis les appliquer sans détruire ses données.
Les enveloppes sont incrémentales : disposer du dernier manifeste ne fournit
pas les corps des fichiers inchangés. Les identités distantes ne sont jamais
des adresses locales autorisées, et une réception n'est ni un ACK ni un import.

## Décision proposée

### Réception privée, sans écriture

Le contrôleur possède le grant Google, la clé et la paire locale exacte avant
l'attente réseau. `receive()` ne reçoit ni scope, ni DTO, ni transport injecté.
Il lit une ancre head/séquence, puis la chaîne **depuis la genesis**, y compris
sur un appareil déjà acquitté. Chaque page doit continuer exactement la
précédente ; séquences, scopes, références complètes et identités d'opération
uniques sont vérifiés avant les téléchargements. La borne de chaque enveloppe
et les limites cumulées de 512 opérations/128 Mio de ciphertext ne sont jamais
remplacées par la seule taille du dernier objet.

Déchiffrement séquentiel contre la base causale exacte. À la position du
checkpoint local, la référence de publication complète et le manifeste doivent
égaler le checkpoint/base privés conservés. Une branche alternative, un trou,
un checkpoint manquant ou une base tronquée refuse sans écriture. Les payloads
historiques restent disponibles sous leurs engagements immuables ; aucune GC
des dernières versions. Seuls le manifeste courant et les corps nécessaires
sont retenus, pas toutes les closures des anciens manifestes. La quantité de
payloads retenus est bornée explicitement ; ce n'est pas une attestation du
pic mémoire d'un téléphone.

La réception est une capacité privée en RAM, annulée par perte de clé, grant,
document, owner/epoch/fence ou changement de paire. Le rapport public expose
« reçu, non appliqué », ancre, volumes et présence de conflits, pas un objet
que l'appelant pourrait réinjecter comme autorisation d'écrire. Une nouvelle
publication distante peut rendre l'ancre historique sans falsifier ce reçu ;
la préparation d'application devra réattester ce qu'elle applique.

Une opération A locale pending n'est ni supprimée, ni publiée, ni acquittée
par `receive()`. Des modifications B dans les vrais stores n'invalident pas
la lecture historique distante ; elles doivent être capturées et préservées
pendant la préparation d'application.

### Envoi concurrent : conservation, pas résolution

`pendingStatus()` relit la paire durable avant de retourner un état, y compris
« aucun envoi ». Il effectue uniquement GET status ; appeler `resume()` pour
inspecter était écarté, car cette méthode peut réserver, envoyer et publier.

`reconcilePending()` exige l'état privé v3, la paire A exacte et déverrouillée,
une `pendingBase` avec checkpoint non nul et le reçu R privé de `receive()`
encore lié à cette même paire. Aucun DTO appelant n'autorise le remplacement.
Seul un statut HTTP **conflict** terminal, portant la référence complète et
le prédécesseur exact d'A, permet de continuer. Inconnu/404, 409 générique,
timeout, réservé, uploadé et publié ne sont pas une permission de remplacer.
Cette terminalité repose sur les transitions SQL du serveur de confiance ;
le JSON de statut n'est pas une seconde signature cryptographique.

Le paquet A durable est ouvert contre son origine figée. L'union causale
`reconcile(origin, A, R)` conserve toutes les révisions, parents et variantes,
y compris celles de contenu égal et les conflits édition/suppression. Aucune
nouvelle révision de contenu, aucun gagnant et aucun reparentage implicite.
La nouvelle enveloppe est scellée contre R avec exactement les payloads de
l'union absents de toute l'ascendance de R : ils proviennent des corps
authentifiés d'A, jamais d'une nouvelle lecture des données physiques B.
Les bornes ordinaires du codec s'appliquent ; aucun compactage pour les éviter.

La transaction atomique remplace uniquement la paire de métadonnées sync :
base/checkpoint et pendingBase deviennent R, nouvel opId, revision locale +1.
M, bindings et sélection restent identiques. Histoire, fichiers, projets et
documents physiques ne sont ni lus pour une capture ni modifiés. Un nouveau
GET conflict et la réattestation du reçu précèdent le CAS. Le RW s'abonne
aussi aux signaux clé/reçu/grant, jusqu'au dernier succès de requête encore
annulable. Le rapport détaché est préparé avant de révoquer l'ancienne paire.

Avant commit, quota/annulation conserve A entière. Si le commit réussit mais
son acquittement local se perd, c'est le **successeur exact** qui est durable :
le rechargement/déverrouillage le retrouve, sans recréer un paquet ni restaurer
A par supposition. Le handle est verrouillé après un CAS d'issue incertaine.
Un reçu R resté au prédécesseur d'A est refusé. Si R avance à nouveau, un
envoi explicite du successeur peut de nouveau entrer en conflit : nouvelle
réception et nouvelle préparation explicites, sans boucle ni choix automatique.

L'UI OFF distingue consultation, confirmation de préparation, puis bouton
« Envoyer le paquet préparé ». Elle ne décrit jamais les variantes comme
résolues ni R comme appliqué. Les modifications B plus récentes ne sont pas
envoyées par ces actions ; une capture ultérieure les prolonge depuis M en
conservant les variantes distantes. START serveur OFF peut refuser la nouvelle
réservation : un paquet préparé localement n'est pas déjà admis à distance.

Ce raccord a été choisi avant le writer d'update car A terminalement perdante
bloquait la reprise du transport. Il **ne remplace pas** le reste du contrat :
vérification physique complète contre M (un `capture.changed=false` sur une
sélection ne suffit pas), EU et restrictions de sortie non rétrogradables,
fichiers partagés nécessitant un rebind privé/COW explicite, source/texte de
document atomiques, suppressions et choix de versions. Ces obligations restent
dans W06 et ne sont pas retirées du cahier des charges.

Validation exécutée : deux vrais profils de stores préparés par migration/upgrade,
premier import froid réel puis captures/publications HTTP workerd D1/R2,
edit/edit et contenu égal, édition/suppression via l'adaptateur causal bas
niveau (la capture des suppressions n'est pas encore implémentée), B intacte
et B modifiée pendant la préparation, changement de grant, révocation au
dernier succès IDB, quota et commit réellement réussi sans acquittement,
publication explicite des mêmes octets après reload, nouveau conflit et OFF.
Le harness JSDOM/fake-IDB n'est pas une recette Chrome ou téléphone physique.

Résultat final local : `npm run verify` **exit 0**, 349 suites / **4 804 PASS +
1 skip préexistant**, types, inventaire OAuth, build et worker Office verts.
31 canaris supplémentaires par rapport au premier import ; deux contre-revues
du raccord puis deux relectures globales autorisent une PR/preview OFF sous
gates. Le cas R contenant déjà A utilise le codec et le vrai transport HTTP
du harness, pas une M multi-tête artificielle. Log ignoré :
`.playwright-mcp/workspace-sync-supersession-final-verify.log`.

### Contenu et identités avant publication locale

Le codec prouve seulement des engagements de bytes. Un décodeur de contenu
doit aussi vérifier la frame `ARTYSOBJ1`, JSON canonique fermé, type/id du
record, dimensions, descripteurs documentaires et graphe des références.
Jamais d'ouverture d'URI ou de lookup d'un ancien ID local depuis le contenu.
L'applicateur réserve les identités manquantes et réutilise les associations
logique/physique attestées ; une référence non sélectionnée reste non résolue.

La provenance galerie doit être durable et indépendante des IDs physiques :
les alias dans le texte brut ne sont ni réécrits ni interprétés comme droits.
La recapture doit retrouver les mêmes identités logiques et octets sémantiques,
malgré un changement d'adresses physiques, de compteur CAS local ou l'ajout
d'un marqueur historique inerte. Comparaison, métriques nulles, restrictions,
provenance documentaire, originaux et texte extrait exact ne sont pas perdus.

Décisions précisées après contre-revue : conserver par couple message logique /
fichier logique le `textId` et l'ordre des alias, y compris après pin/unpin ou
édition du texte ; ajout/retrait d'image change seulement les couples concernés.
Une branche ou duplication doit transférer explicitement cette provenance.
L'inertie doit rester utilisable coffre sync fermé : soit sidecar avec la crypto
du compte, soit bit physique `restoredArchive=true` et provenance du seul bit
wire original, neutralisée à la recapture. **Ne pas rejouer un ancien DTO** qui
masquerait les vraies modifications de pinned/interrupted/comparison.

La réception prouve tous les engagements, pas la compatibilité métier. Avant
application : valider toutes les têtes maximales live et la fermeture de leurs
dépendances matérialisées. Une ancienne variante dominée peut rester opaque,
mais aucune présentation/restauration/résolution ne l'utilise sans validation
stricte à ce moment. Un ancien fichier encore référencé est donc validé
immédiatement, même si son enveloppe d'introduction est ancienne.

### Application sous journal dédié, pas restauration additive

Le protocole v8 de restauration garde son invariant « IDs tous nouveaux ».
Un nouveau journal `sync-apply` est nécessaire dans la génération active.
Il contiendra des valeurs locales déjà chiffrées, preuves avant/après ciblées,
mapping/provenance et état sync final ; jamais une clé de coffre/Google.
Le petit marqueur de contrôle doit être reconnu avant d'ouvrir le journal,
et l'inventaire reste fermé. Aucun fallback vers App sur état inconnu.

Deux garde-fous issus de la revue sécurité conditionnent le writer :

- `captureLocalSyncSnapshot.validate()` vérifie scope/fence, **pas** la fraîcheur
  des données jusqu'au commit ; la capture peut aussi normaliser les identités.
  Faire ce préflight explicitement, puis conserver des témoins raw exacts des
  cibles et de l'histoire, un garde de l'histoire RAM et la paire sync exacte.
  Les réattester pendant préparation/chiffrement puis avant toute mutation.
- L'état privé v2 ne distingue pas base de transport et état matérialisé.
  Introduire une forme fermée versionnée séparant base transport/checkpoint,
  état matérialisé/provenance et intention pending. Ne pas ajouter des bindings
  reçus en changeant implicitement la base de déchiffrement d'une A en attente.

| Phase | Autorité et effet |
|---|---|
| Préparation chaude | Lire les vrais stores, geler B, fusionner les DAG sans vainqueur implicite, préparer les valeurs chiffrées et cibles exactes. |
| Adoption | CAS du contrôle et du journal exact ; retirer irréversiblement le document courant. |
| Reprise froide | Garder l'exclusion Web Lock ; vérifier génération/owner/fences et appliquer chaque cible seulement si elle vaut exactement avant ou après. |
| Vérification | Relire toutes les cibles, index/usage, historique, mapping et paire sync ; ne pas déduire un succès d'un marqueur de phase. |
| Publication ready | Seulement après attestation complète ; supprimer le journal et imposer un nouveau document avant App. |

Les données des autres comptes ne sont pas recopiées ou restaurées depuis un
snapshot. Toute cible tierce/conflictuelle refuse. Une annulation avant effet
peut conserver le journal pour reprise ; après effet, pas de rollback général
qui écraserait une écriture inconnue. Des pièces copiées mais non publiées
restent associées au journal jusqu'à nettoyage prouvé.

### Conflits et intentions locales

La base reçue R, la base ACK et les intentions locales A/B sont distinctes.
Une supersession de A exige un statut distant définitif de conflit et une
adoption atomique de son successeur conservant ses révisions/payloads. Un
timeout/404/PUT définitivement inconnu ne donne pas cette autorisation.
Une fusion garde toutes les variantes, y compris edit/delete et contenu égal.
Une résolution doit citer toutes les têtes effectivement présentées ; aucun
LWW, rebase automatique ou tombstone déduit d'un fichier absent.

## Options et conséquences

- Relecture depuis genesis retenue initialement : preuve simple des anciens
  corps et du checkpoint exact, coût réseau cumulé plus élevé et borné. Un
  cache/checkpoint autonome ultérieur exigera sa propre rétention attestée.
- Application chaude reportée : les writers LS/chiffrement différé ne sont
  pas actuellement couverts par une barrière suffisante. Le premier parcours
  accepte explicitement maintenance/rechargement par lot.
- Réutiliser la restauration additive est écarté : elle réalloue tous les IDs
  et ne prouve ni update ciblé, ni conflits, ni continuité de recapture.

## Recettes requises avant clôture

1. Vrais services/grant/codec/D1/R2 : chaîne multi-pages, ancien fichier gardé
   depuis une enveloppe antérieure, ancre avancée, corruption/troncature,
   référence valide d'une autre branche, comparaison checkpoint/base locale exacte.
2. Aucun write/ACK en réception ; A pending et B modifié conservés ; perte de
   clé/grant/paire/fence après chaque attente ; absence de résultat partiel.
3. Préparation/apply sur vrais stores : comparaison + galerie + DOCX/TXT,
   alias historiques, source/texte exacts, refus dépendance ambiguë et quotas.
4. Coupure avant/après chaque CAS/LS/write de fichier, reprise byte-identique,
   conflits et suppressions explicites ; compte B entièrement préservé.
5. Deux vrais profils navigateur depuis préparation de stockage réelle,
   application/reload/recapture inchangée, puis modifications dans les deux
   sens, concurrence, pertes réseau et résolution. Ensuite preuve déployée
   et APK exact sur appareil physique. Les tests synthétiques ne les remplacent pas.

## Implémentation et preuve à ce checkpoint

`reception.ts` et `localOutbox.receive()/reception()` réalisent la réception
privée décrite ci-dessus. La fermeture vide blobs, manifeste et holders du
rapport, sans promesse d'effacement physique de copies déjà exposées. Le
rapport est détaché ; aucun DTO public ne permet d'appliquer ou d'acquitter.

Deux contre-revues ont validé ce raccord à lecture, sous tests ensuite verts :
30 tests client/services Google réels/workerd D1/R2 et 11 tests codec/réception
avec transport de fixture. Pagination réelle 33 publications, ancien corps
absent, ancien payload conservé, corruption AEAD en seconde page, substitution
interpage, checkpoint exact, head recul/avance, budget de page, annulation et
A pending/B local sont couverts. Le premier harnais utilise JSDOM/fake-IDB et
bufferise HTTP ; le second isole le vrai codec sans attester le serveur.

`npm run verify` terminé exit 0 : **344 suites / 4 601 PASS + 1 skip existant**,
types frontend/functions, build, inventaire OAuth et vrai worker Office verts.
Source du reçu : `.playwright-mcp/workspace-sync-reception-verify.log` (ignoré).
Code local, aucune activation/ressource/migration/déploiement distant.

Le journal et les étapes d'application, résolution des conflits et recette
deux vrais navigateurs restent requis. Le document ne les prouve pas.

## Validation métier ajoutée après la réception

`content.ts` décode la frame fermée `ARTYSOBJ1` depuis un vrai Blob : header
avant allocation du JSON, longueur exacte, UTF-8 strict et comparaison à la
représentation canonique. Le type et l'identité proviennent indépendamment
du manifeste. Les seuls suffixes binaires autorisés sont fichier/source.
Le hash du conteneur ne remplace pas le SHA-256 des bytes originaux du document.
Texte vide, BOM/CRLF/surrogate, comparaison historique, métriques nulles et
trois tailles distinctes (bytes/row/présentation) sont conservés.

`receivedContent.ts` parcourt toutes les maximales live, mémorise chaque
payload décodé et vérifie le domaine/parent des identités UUID logiques,
y compris les IDs imbriqués. Les alias de galerie correspondent exactement
aux couples message/fichier dans leur ordre ; leur `textId` historique n'est
jamais utilisé pour lire un fichier local ou analyser le Markdown.
Le couple logique source/texte d'un même document est stable dans les
catalogues et payloads texte examinés : une identité texte réutilisée pour
une autre source (ou inversement) est refusée même si la cible est absente
ou ambiguë. Deux textes concurrents gardant ce couple restent un conflit.

Les dépendances fortes sont pièce/galerie → fichier et catalogue projet →
source/texte. Une cible absente, supprimée ou multi-têtes donne une issue
distincte. Deux fichiers de mêmes bytes restent ambigus. Les références
historiques (citation documentaire, origine de crop, source/peer de comparaison)
peuvent rester non résolues sans lecture implicite. Une comparaison `done`
sans réponse présente n'est pas réécrite. Les sources/textes orphelins après
retrait du catalogue restent retenus et inertes, sans rattachement automatique.
Pas de produit cartésien des variantes ni de choix par date/nom/hash.

Bornes de revue distinctes : 128 Mio de payloads maximaux cumulés, 10 000
identités logiques et 100 000 occurrences de références, plus les bornes de
chaque frame/manifeste. Dépassement = refus entier, jamais troncature. Ce
n'est ni une estimation de pic RAM mobile ni une admission de quota d'import.

Objection sécurité intégrée : un fichier portant `normalizationVersion` doit
respecter le contrat canonique v2 du writer (dimensions 1..4096, PNG/JPEG,
1..4 Mio) et ses dimensions doivent égaler son en-tête binaire lu avec une
borne, sans DOM/Canvas. Ne pas imposer ce contrat aux vieux fichiers non
marqués. Pour une galerie non marquée, seule la politique de signature MIME
existante est attestée : pas de preuve de décodage intégral/anti-bombe.

`actor.prepareReceived()` ne prend aucun DTO/scope/garde injecté. Il possède
la réception exacte et une préparation privée révocable, puis rend seulement
un rapport détaché `content-reviewed-not-applied`, les volumes et issues.
Le rapport n'est pas une autorité d'application. Nouvelle réception, perte de
clé/grant/document ou changement de paire invalident la préparation ; une
simple erreur métier ne détruit pas la chaîne authentifiée. A pending et B
dans les vrais stores restent inchangés. Aucun ACK, write, import ou appel IA.

Options écartées : rejouer un DTO comme preuve d'adoption ; déclarer tout le
coffre importable après AEAD seule ; résoudre une arête ambiguë par présentation ;
réinsérer tous les orphelins. Le coût assumé est une revue préalable complète
et bornée, avant de calculer la capacité réelle d'application et les conflits.

Recettes : nouveau corpus `workspaceSyncContent.test.ts` avec vrai codec et
transport de fixture ; corpus des vrais stores `workspaceSyncCapture.test.ts`
désormais relu par le décodeur ; raccord client/workerd sur deux profils
JSDOM/fake-IDB préparés par migration/upgrade réels, avec projet TXT, galerie,
pièce et comparaison, conservation A/B et révocation pendant hash source.
Ce dernier harnais n'est toujours ni deux vrais navigateurs ni un import.

Deux contre-revues indépendantes en lecture seule donnent un GO borné à ce
raccord, après intégration des contrôles image canonique et couple source/texte.
Les canaris de fidélité historique et d'ambiguïté sont conservés, pas corrigés
en réécrivant silencieusement les contenus reçus.

`npm run verify` terminé **exit 0 : 345 suites / 4 665 PASS + 1 skip existant**,
types frontend/functions, inventaire OAuth, build et vrai worker Office verts.
Le delta comprend 59 nouveaux tests de contenu et 5 nouveaux tests client ;
le corpus client compte 35 tests, celui de capture existant 31 et celui de
réception/codec 11, tous inclus dans la campagne complète. Log ignoré :
`.playwright-mcp/workspace-sync-content-verify.log`. Les premiers échecs de
fixtures (concurrence construite comme édition linéaire, absence de conversation
attendue undefined au lieu de null) ont été corrigés sans affaiblir le protocole.

Code local non poussé. Aucun déploiement, activation, provisioning ou migration
distante ajouté. Le raccord v3 ci-dessous ne remplace pas la provenance,
la fraîcheur réelle des cibles, le journal froid, l'applicateur, la résolution
ou la recapture fidèle après import, qui restent requis.

## État privé v3 — transport, branche représentée et envoi figé

Décision du 7 septembre : séparer trois rôles dans l'état chiffré fermé.
`base/checkpoint` est T, la dernière base de transport attestée ; `materialized`
est M, la branche précédemment capturée ou matériellement représentée, avec
au plus une tête par record ; `pendingBase` conserve exactement la base et
le checkpoint utilisés lors du scellement de l'opération A encore durable.
M n'est **pas** une preuve de fraîcheur des stores : l'utilisateur peut déjà
y avoir sauvegardé B. La préparation froide devra encore l'attester.

Les bindings `record` couvrent exactement M, pas tous les records de T.
Sans opération, M doit être un sous-graphe exact de T. Avec A, la présence
de `pendingBase` doit correspondre à celle de la paire durable, et M doit
être retenu par l'union de T et du vrai paquet A ouvert contre son origine.
Comparer toutes les révisions/parents/engagements, pas seulement les têtes.
L'origine est elle-même retenue par T ; checkpoint monotone, même séquence
impliquant publication complète et manifeste identiques. Le total privé
reste borné à 8 Mio avant scellement : aucun ancêtre supprimé pour tenir.

La capture compare les vrais contenus à M, puis chiffre
`reconcileSyncManifests(M, T, capturedM)` contre T. Les payloads sont uniquement
les nouveaux engagements. Une édition C de M reste enfant de M même si T
connaît déjà un descendant R : R/C survivent comme conflit, y compris face à
une suppression distante. Les objets distants non matérialisés n'acquièrent
pas artificiellement un mapping local et ne sont pas renvoyés.

Reprise d'A : mêmes octets, même origine de déchiffrement, même parent HTTP
et séquence attendue. ACK : CAS exact supprimant seulement A et `pendingBase`,
sans remplacer M/bindings par le DAG transport. Si T atteste déjà A ou un
descendant, il reste intact après preuve de rétention complète d'A ; même
séquence exige aussi le manifeste exact. Ce chemin suppose que le futur
journal a reçu T par la capacité privée vérifiée, jamais par un DTO public.
Le résultat ACK cite la publication A, pas nécessairement le head courant T.
Deux anciens acteurs concurrents peuvent encore produire un refus sûr `base`
si T est plus récent : le second ne répare rien ; une reprise fraîche est idle.

Création/jointure neuves écrivent v3. V1/V2 se relisent et se reprennent dans
leur format historique, sans conversion implicite. Le remplacement d'une
genesis perdante conserve les preuves des deux clés et refuse tout M non vide.

Alternative écartée : élargir le mapping v2 en conservant sa base ambiguë.
Cela changerait l'origine d'A ou provoquerait un renvoi des anciens payloads.
Le coût de v3 est une duplication bornée de manifestes ; sa conséquence est
une limite atteinte plus tôt, traitée comme un refus et non comme une GC.

Recettes ajoutées : grammaire/retention/budget privé ; vrais services/crypto/
workerd pour capture, HTTP, ACK, reboot et formats historiques. Les cas T≠M
commencent par une **fixture privée chiffrée**, T/checkpoint issus de vraies
publications ; ils ne constituent pas un import physique. Vérifier titre seul,
pièce distante non renvoyée, edit/delete concurrent, ancien A devant T avancé,
état AEAD valide mais impossible et préservation de l'histoire B.

La provenance galerie/inertie, le journal et l'application doivent être livrés
avec ce raccord dans une verticale cohérente avant activation et recette réelle.

Preuve finale : deux contre-revues indépendantes GO bornés au code local ;
`npm run verify` terminé **exit 0, 346 suites / 4 687 PASS + 1 skip existant**,
types frontend/functions, inventaire OAuth, build et vrai worker Office isolé
réussis. Log ignoré `.playwright-mcp/workspace-sync-v3-verify.log`. Les 22 nouveaux
tests comprennent 9 tests de forme/rétention et 13 roundtrips (48 au total).
Les premiers échecs ont révélé des fixtures incomplètes : bootstrap historique
au reload, scope de clé trop large, lecture d'une réponse HTTP déjà consommée
et attente erronée d'un parent dans l'URL status. Oracles corrigés, sans retrait
de cas ni affaiblissement du code ; la campagne complète couvre le résultat final.

Checkpoint du 7 septembre : code enregistré localement, sans push, activation,
ressource ou déploiement. Ce checkpoint ne clôt ni le CDC ni la synchronisation.

## Reprise — projection inverse et fidélité locale

Étape suivante du 7 septembre ; ni l'objectif complet ni la synchronisation
ne sont clos.

Décision : `receiveMapping.ts` inverse les associations typées de capture,
réutilise celles déjà connues et réserve des adresses physiques nouvelles pour
les identités absentes. Aucune adresse n'est déduite du nom, du hash ou du texte.
Source et texte d'un document ont deux IDs logiques mais un même ID physique,
sous le même projet ; les paires sont réservées avant les autres références.
Les références faibles restent sans ligne. L'allocateur devra encore prouver
l'absence de collision dans **tous les vrais stores** lors de la préparation.

`reviewReceivedSyncContent().projectLocal()` reste un seam **interne**, non
exposé par l'acteur à l'UI et non habilité à écrire. Il lie le head local au
vault/epoch du reçu, refuse conflits, suppressions et dépendances fortes
incomplètes avant allocation. Les documents orphelins sont explicitement
retenus dans le transport sans rattachement local. Le résultat détaché n'est
ni une preuve de fraîcheur, ni une décision d'écraser, ni un ACK.

La petite `Message.localSyncProvenance` vit dans l'histoire du compte, avec
sa crypto ordinaire : bit `historicalInjected` et alias physiques/historiques
de galerie. Aucune ancienne copie de texte, de fact-check ou de conversation.
Les messages reçus restent `restoredArchive=true`, même coffre sync fermé ;
la recapture retire seulement le bit ajouté localement, jamais un bit déjà
présent sur le wire. Elle conserve exactement les textes et leurs anciennes
URI, sans les interpréter. Un pin/une édition reste une vraie modification.

Branches simples et comparateur copient explicitement la petite provenance.
Exports JSON/public/Office/archive ne l'exposent pas ; l'import JSON ordinaire
la retire même si elle est forgée. Le parseur réseau reste fermé et la refuse.
Les aliases ne donnent aucun droit de lecture/chargement d'image.

Objections de contre-revue intégrées : scope différent avant toute
allocation ; supplément de taille dû à la provenance ; IDs physiques anciens
de 256 caractères plus longs que les UUID wire. La forme locale et le témoin
source ont un budget distinct **200 000 nœuds / 16 Mio de caractères**. Après
remapping/retrait de provenance, le projecteur wire retrouve **100 000 nœuds**
et le frame reste limité à **10 Mio d'octets**, sans augmentation des bornes
réseau. Le témoin complet détecte une mutation en place de la provenance.

Dernier préflight physique : une ancienne référence peut être légale sans
être une adresse de ligne valide. La conversation finale repasse par le
projecteur local (galerie UUID, pas de message `streaming`), les projets et
documents par les validateurs des vrais lecteurs, les fichiers matérialisés
par leur grammaire d'adresse (128 caractères, alphabet fermé). Une ancienne
référence faible `old/path` reste conservée tant qu'elle n'est pas matérialisée ;
la convertir en fichier refuse au lieu de réattribuer son adresse. `legacy-image`
reste une pièce jointe ordinaire valide, mais pas un ID de galerie. Aucun owner
ou compteur de validation fictif n'est retourné comme autorité de publication.

Alternatives écartées : réécrire le texte, garder seulement une provenance
sous clé sync, rejouer un ancien DTO, appeler `putFile`/l'importeur ordinaire
qui changent les métadonnées, ou relever silencieusement les bornes réseau.
Le coût est un petit supplément local borné et un préflight supplémentaire.

Recettes ajoutées : vrai décodeur et capture inverse aux limites (5 000
messages, 10 Mio, bindings historiques longs), rejet scope/révocation,
source/texte à ID commun, aliases et données falsy, export/import forgé,
vraies branches/comparateur, pin et rechargement chiffré. Deux canaris publient
des **fixtures de lignes physiques** avec vraie crypto/IDB/lecteurs du produit,
rechargent, lisent source/texte/galerie puis recapturent sans nouveau payload,
UUID ou chiffrement ; titre/pin modifiés produisent seulement une conversation.
La révision CAS locale différente ne change pas le contenu documentaire.
Les lignes originales restent identiques. Ces canaris ne constituent **pas**
une preuve de journal, d'adoption atomique, de deux appareils ou d'apply public.

Avant activation : writer v10 et son inventaire fermé, préflight des vrais
stores/histoire RAM/paire A/B, sortie d'effacement, refus d'écrasement de B,
reprise à chaque coupure, traitement visible des conflits et recette deux
profils réels puis APK exact restent requis. La compatibilité des anciens
bundles après retour ready doit être prouvée ou barrée durablement ; la seule
version du journal pendant maintenance ne suffit pas.

Preuve finale de ce lot : deux contre-revues indépendantes GO bornés à la
projection locale, puis `npm run verify` terminé **exit 0, 347 suites /
4 722 PASS + 1 skip existant** ; types frontend/functions, inventaire OAuth,
build et vrai worker Office isolé verts. Les 35 tests ajoutés comprennent
28 tests de projection, trois de capture sur vrais stores, un de capacité
révoquée et trois de branches/exports. Les trois suites projection/capture/
contenu totalisent 122 PASS. Log final ignoré :
`.playwright-mcp/workspace-sync-projection-physical-verify.log`.

Traçabilité des essais : la première campagne complète a échoué sur le délai
D1 de `d1.walletMeasurement.test.ts` (250 ms), déjà signalé auparavant ; ce
test a passé isolément sans changement du code métier. La campagne suivante
est passée (4 716 tests) avant le dernier préflight physique ; la campagne
finale ci-dessus couvre les six canaris supplémentaires. Un canari de borne
a d'abord construit trop peu de messages pour dépasser l'ancien budget local ;
la fixture a été corrigée, pas la borne ni l'assertion. Aucun test supprimé.

Code enregistré localement uniquement : pas de push, déploiement, activation
sync, modification de données utilisateurs ni ressource distante.

## Premier import journalisé — 7 septembre, candidat local OFF

Le journal proposé ci-dessus possède désormais son premier raccord réel :
acteur propriétaire du reçu → préparation chiffrée → adoption du contrôle v10
et du job → nouveau document froid → vrais stores → nouveau document normal.
La fixture de publication physique du lot précédent n'est plus utilisée pour
prouver ce parcours. Elle demeure une recette indépendante du projecteur.

### Frontière explicite, pas une réduction de W06

Le premier import exige une inscription jointe avec état privé v3, M vide,
bindings vides et aucune opération A pending. L'appareil peut déjà contenir
des conversations/projets B et d'autres comptes : ils sont préservés.
Le reçu fournit T, les têtes live validées et leurs dépendances fortes.
Un conflit, une suppression ou une dépendance ambiguë refuse ; fichiers
orphelins, liens textuels faibles et documents retirés restent dans T sans
ligne locale ni réattachement inventé. La sélection d'envoi reste inchangée.
Cette restriction initiale ne supprime aucune exigence de mise à jour,
concurrence, suppression ou résolution du cahier des charges.

### Décision et ordre récupérable

`applyPublication.ts` dérive l'owner, le layout, la paire, les cibles nouvelles
et les quatre slots d'historique ; le DTO de prévisualisation n'est pas une
autorité. Les identités sont comparées à l'histoire complète et aux clés/IDs
des vrais stores, tous comptes compris. L'historique durable doit égaler la
RAM intégralement : une ancienne normalisation seulement en mémoire refuse
avec une instruction de sauvegarde ordinaire, sans réécrire B implicitement.
Le lifetime rassemble clé, grant/reçu et document ; il annule aussi une vraie
transaction encore annulable et libère le paquet préparé.

Le contrôle v10 est fermé et contient seulement un petit header, hash/borne
128 Mio et la ready base exacte. L'admission contrôle les deux clés sans
cloner le gros job. Le job contient uniquement des valeurs locales chiffrées,
preuves des autres données, cibles additives, usage absolu avant/après et
paire sync avant/après. Aucun secret de coffre, token ou historique en clair.

Ordre effectif :

1. Adoption atomique root10 + job et retrait irréversible du document chaud.
2. Premier préflight froid complet avant toute copie ; checkpoint `copies`.
3. Fichiers exacts, puis une transaction projets/documents/usage/état sync.
4. Checkpoint `publishing`, nouveau ciphertext d'histoire, retrait du plain.
5. Relecture complète, suppression du job + ready atomiques, nouveau document.

Ce n'est pas une transaction ACID entre localStorage et les deux bases. Les
preuves before/after, les CAS et le verrou documentaire coopératif assurent
le protocole ; un writer non coopératif fait refuser les attestations.
Une écriture B tardive avant toute copie permet encore l'abandon du job intact
sans restauration de B. Après copies, l'abandon exige les quatre slots anciens
exacts : seuls les nouveaux fichiers/projets/documents identiques sont retirés,
l'usage est redérivé et la paire ancienne exacte est rétablie. Pas d'écriture
d'un ancien historique, même lorsque les quotas restent refusés. Après histoire
candidate publiée : reprise ou effacement local explicite, pas de rollback
général. Le cas projets seuls suit la même publication sans toucher l'histoire.

L'ordre projets/état avant histoire est volontaire : il permet l'abandon sûr
face à un quota permanent localStorage. L'ordre inverse a été écarté après
contre-revue. Les fichiers sans rattachement ne reçoivent pas une conversation
fictive pour contourner cette exigence.

### Compatibilité et effacement

La ligne publique `sync-state.version=2`, adoptée avec les lignes physiques,
sert de barrière durable aux anciens lecteurs fermés v1, avant App. Les writes
ordinaires conservent v2, y compris sélection, capture et ACK ; le CAS refuse
la rétrogradation avant son fast-path d'acquittement incertain. La grammaire
des opérations reste v1. Logout/fermeture ne retirent pas la barrière. La purge
isolée des seuls projets la refuse avant sa première mutation de fence.
Seul l'abandon froid avant exposition de l'histoire peut retourner l'exact v1
précédent ; l'effacement complet du compte peut retirer son état v2.

`syncApplyErasure.ts` dérive l'admission réelle, exige maintenance/document
détenu, et remplace atomiquement root10+job par le protocole d'effacement v6.
Les preuves B et fences sont celles du moment, pas celles du vieux job.
Une intention distante incertaine préexistante n'est pas déguisée en effacement
local. Le reçu est explicitement localOnly, sans confirmation serveur inventée.
Juste après entrée dans le RW de contrôle, le reçu et la fence actifs sont
relus avec présence + valeur exactes. Les lectures de maintien en vie de cette
transaction ne renouvellent pas le timeout ; une preuve bloquée laisse le job
intact. Après réservation, un nouveau document utilise le vrai nettoyeur v6.

### UI et preuves

`WORKSPACE_SYNC_APPLY_START_ENABLED=false` : aucune nouvelle lecture ou jointure
automatique, pas de début natif. L'écran Web compilé inspecte explicitement,
demande le code, prépare et exige confirmation de l'import. Double clic,
réponse tardive, invalidation et démontage sont neutralisés. L'écran froid
existe indépendamment de ce flag et reste devant App ; abandon et effacement
local ont chacun une confirmation distincte. Un résultat incertain invite à
vérifier après rechargement, sans prétendre que le job existe toujours.

Recettes ajoutées :

- Vrais services Google/crypto/migration/upgrade/HTTP workerd D1/R2 : import
  comparaisons, galerie, TXT original/texte, lecture métier et recapture sans
  changement ; vraie modification puis ACK conservant la barrière v2.
- Six coupures après frontières réellement commises : copies, fichier,
  enregistrement atomique, publishing, histoire et ready. Reprise sans doublon.
- Quotas IDB/LS maintenus pendant l'abandon ; projets seuls ; B tardif conservé.
  Le projet préexistant est relu, modifié puis relu après nouveau document.
- Verrouillage de clé/retrait de grant à la réussite de la dernière requête
  root avant commit : vraie transaction annulée, aucune adoption silencieuse.
- Effacement local A après état v2, avec autre compte B réel de fixture :
  histoire/fichier déchiffrables, paire pending byte-identique et projet éditable.
- Mutations fence/reçu, null présent et undefined présent à l'entrée RW : refus
  sans suppression de job ; lecture active bloquée : expiration effective.
- Inventaire fermé sans lecture du job ; corruption de payload malgré hash
  recalculé ; historique streaming ancien → refus intact → save → préparation.
- Tests React : OFF, consentement, double action, démontage, invalidation,
  résultat terminal et confirmations froides ; Gate avant import privé App.

Deux contre-revues indépendantes à lecture ont validé ces correctifs sous
réserve des tests, ensuite confirmés verts. Campagne complète `npm run verify`
terminée **exit 0 : 349 suites / 4 773 PASS + 1 skip existant**, soit 51 tests
supplémentaires et un roundtrip existant étendu au vrai writer. Types frontend/
functions, inventaire OAuth, build et worker Office isolé verts. Log ignoré :
`.playwright-mcp/workspace-sync-first-apply-verify.log` (session 69964 consommée).
Le premier essai UI isolé a révélé un export absent dans la fixture runtime ;
la fixture de session a été corrigée, pas le comportement produit ni les assertions.
Les profils sont JSDOM/fake-IDB, HTTP bufferisé : **pas deux vrais navigateurs,
pas un téléphone physique, pas une preuve de disponibilité en production**.
W06, W01–W10 et la chaîne opérationnelle abonnements/crédits restent ouverts.
