# Restauration publiée — verticale W06 en recette

6 septembre 2026, après #477. **Candidat Web activé localement ;
non livré.** Ce lot doit livrer une
capacité utilisable, pas un nouveau bouton définitivement OFF.

## Résultat à livrer

Archive + code de récupération → vérification et aperçu lié au compte cible
actuel → confirmation → adoption durable → publication froide → nettoyage →
nouveau document → conversation, pièces jointes et projet utilisables, avec
l'existant conservé. La synchronisation serveur est un lot suivant distinct.

Pour les utilisateurs legacy, une entrée explicite de préparation du stockage
réutilise le migrateur, la reprise et l'abandon avant barrière #477.
Après cette préparation : rechargement/connexion et nouvelle
sélection de l'archive/code ; ne pas promettre la conservation du fichier ou
du secret à travers les documents. Ne pas écrire ceux-ci dans les réglages.

L'entrée est maintenant implémentée dans cette branche : Réglages → Restaurer
une archive → `/workspace/prepare`, consentement explicite avant tout travail,
puis retour par navigation complète `/?start=1`. La livraison en production
reste à vérifier séparément.

## Réutilisable et manquant

`workspaceBackup/restorePlan.ts` authentifie v1/v2/v3, remappe les identités,
fige les messages historiques et expose objets/diagnostics/ressources. Sa
projection reste `not-authorized` : aucune autorité sur le compte cible.
`captureLocalReadScope` et les snapshots stricts fournissent les gardes à
réutiliser. Les lecteurs isolés et les nouveaux départs Web sont activés dans
ce candidat. La branche ajoute le journal v8,
le publisher chaud/froid et l'interface ; aucune disponibilité en production
n'est encore revendiquée.

Les writers usuels ne conviennent pas à la publication : `putFile` peut
écraser un ID du même propriétaire ; `createProject` recrée identité/dates ;
`saveConversation` écrit d'abord un filet plaintext puis chiffre plus tard.
Les writers de restauration doivent être exacts, internes et additifs.

## Direction retenue après deux challenges indépendants

### 1. Même génération, pas de recopie des autres comptes

Cible initiale : `isolated-v1 ready`, header v2 ou v7 strictement capturé.
Ajouter de nouveaux IDs, sans remapper l'existant ni recopier B. Le retour
ready conserve tous les champs de base, notamment `resets` et
`requiredOwners` ; seule la révision avance.

### 2. Tout préparer et chiffrer sous la garde chaude

Propriétaire/epoch/crypto/fence/génération liés avant toute attente. Vérifier
archive, baseline durable/cache, collisions et capacité cumulative, puis
encoder/chiffrer tous les payloads cibles en RAM. Pas de clé ou compte choisi
par l'archive ; EU monotone, messages inertes, révisions/dates, originaux,
texte extrait et tailles archivées conservés exactement.

Le code archive ne permet pas de rechiffrer sous la clé locale au froid.
`claimMaintenance()` refuse ready, et `retire()` révoque aussi le verrou froid
du document : ne pas compter écrire un journal après retraite dans ce même
document, ni réinitialiser crypto en maintenance.

### 3. Adoption atomique dans la DB de contrôle

Journal distinct **logiquement**, sous clé(s) de job exactes de `control.meta`,
dans la même DB que `workspace`. Une seule transaction adopte tous les
ciphertexts déjà figés et remplace le header de base exact par l'état restore.
Cela élimine le journal partiellement reçu/orphelin et le besoin d'un nouveau
bail après retraite. Après tentative d'adoption, retirer le document et
demander reload ; une incertitude ne vaut pas un succès inventé.

L'admission devra accepter strictement root + records exacts du job en état
restore ; ready demeure root seul. Ne pas lire/charger le gros payload avant
identification du protocole. Taille totale/clone IPC et transaction à borner
et mesurer, pas déduire naïvement des seuls 60 Mio de l'archive. Un refus de
quota avant commit ne doit modifier ni root ni sources, ni laisser un payload.

**Limites de la première admission Web :** archive 16 Mio, journal chiffré
32 Mio incluant l'historique existant. Refus de l'entrée trop grande avant
lecture/KDF ; budget cumulatif vérifié avant chaque chiffrement avec réserve
métadonnées de 256 Kio ; taille JSON UTF-8 finale contrôlée. Le protocole froid
reste compatible avec les journaux déjà adoptés jusqu'à son plafond de
128 Mio. Ne pas confondre ce plafond de compatibilité avec une capacité promise
sur téléphone. Les archives du format jusqu'à 60 Mio de contenus restent
vérifiables mais ne sont pas toutes restaurables par cette première admission.

## Recettes locales du 6 septembre 2026

- 50 tests de publication réels avec fake-indexeddb/WebCrypto : v1/v2/v3,
  arrêt à chaque frontière, adoption incertaine, quota permanent, abandon
  durable, compte A/B, révisions/reset B conservés, retrait des fichiers,
  collision tardive, payload malformé même rehashé, effacement/fence/reçu,
  refus natif, ouverture partielle et limites précoces.
- 18 tests de protocole fermé/inventaire, 20 tests UI et un test de politique
  de livraison sans mock attestent les deux constantes activées.
  Les six tests mémoire automatique comprennent token/réponse/corps/fence et
  réentrance d'un listener qui change A→B entre deux faits. La contre-revue a
  conduit à conserver la garde avant/après chaque mutation notifiant.
- Chrome véritable `main.tsx`, profils localhost fictifs, FR/EN, 390/1280 px :
  legacy A/B chiffré → consentement stockage → retour/back/forward → aperçu
  lié au compte → adoption → reload froid → reprise → nouveau document.
  Un second onglet est bloqué. Aucun module App/crypto dans les documents
  froids ; ni appel IA ni données réelles. PDF/TXT de la conversation reçue
  téléchargés et comparés à l'octet près ; A/B relus/réécrits après reload.
  Recette finale avec les constantes réellement activées :
  `.playwright-mcp/restore-publisher-browser-final.log`, sortie 0. Les deux
  parcours grand écran adoptent sous START=true puis chargent un nouveau
  bundle simulé START=false : reprise, lecture, téléchargement et écriture
  restent possibles ; les nouvelles restaurations sont refusées.
- Diagnostic avant réduction : archive 62 910 594 octets, journal 111 830 564,
  préparation 4,56 s, adoption 0,31 s, froid 5,19 s. Pic JS échantillonné
  660 185 916 octets, producteur synthétique inclus : pas une preuve mobile.
  Ce résultat a motivé le plafond d'admission plus bas.
- Recette aux nouvelles limites : archive 16 775 714 octets, historique cible
  existant de 700 000 caractères, journal 30 754 957. Producteur dans un
  document séparé, GC avant chaque phase pour évacuer les anciens documents,
  aucun GC imposé pendant l'opération : préparation 1,60 s / pic JS 122 673 948,
  reprise 2,09 s / 235 460 844. Sur un second profil avec coupure au checkpoint :
  abandon 0,58 s / 172 061 792. Retour ready et A/B conservés dans les deux cas.
  Preuves : `restore-publisher-admission-capacity-gc.log` et version sans GC
  préphase `restore-publisher-admission-capacity.log`, dans `.playwright-mcp`.
  Ce sont des pics JS échantillonnés, pas des plafonds RAM/RSS. Aucun appareil
  n'était connecté dans `adb devices` ; recette physique téléphone non attestée.

Les sondes du navigateur sont des scripts locaux ignorés, pas des routes ni
des comptes de production. Services réseau bloqués/stubés dans ces profils.
`npm run verify` final réussi : 318 suites, 4 087 tests réussis et un sauté,
typechecks front/functions, no-CASA, build et worker Office réel isolé.
La première passe a révélé une assertion historique de politique OFF ; elle
vérifie désormais le refus de provisioning avant admission puis l'admission
ready sous les constantes réelles. Aucun assouplissement du garde de production.
Les reçus CI et livraison restent nécessaires avant d'appeler la verticale livrée.

### 4. Publication froide autonome

Réattester propriétaire/fence/crypto/source de base et absence de reçu
d'effacement avant toute copie. Journal adopté complet : reprise sans code,
login ni clé. Fichiers : `add` avec absence initiale attestée, puis seulement
absent/exact-job au retry. Projets/documents/usage dans une transaction ; usage
absolu base + apport, jamais `+=` réexécuté. Collision et tombstone refusés.

Historique en dernier. Capturer les quatre slots et refuser les quarantaines
non résolues/divergences cache-durable. Reconnaître les raws ancien/candidat,
pas seulement une phase : le bootstrap préfère le plaintext. La fusion doit
rester visible après suppression conditionnelle de l'ancien plaintext.
Un acquittement perdu après écriture d'histoire impose la reprise, jamais un
second import ou un rollback de snapshot global.

Le journal conserve seulement présence, longueur et empreinte des anciens
slots, jamais une copie de leur plaintext. Les valeurs sont relues en RAM et
comparées synchroniquement juste avant mutation, après leur preuve asynchrone.

Une archive valide peut contenir projets/fichiers sans conversation. Dans ce
cas l'histoire ancienne et candidate peuvent être identiques : leur égalité
n'autorise pas à déduire une absence de publication. Le checkpoint de début
de publication doit être explicite, et les copies autonomes/usage doivent être
vérifiés aussi. Ce checkpoint de travail ne remplace pas la transaction finale
atomique supprimant le job et rendant ready.

### 5. Sortie et effacement

Après relecture des copies/histoire/usage exacts : transaction UNIQUE du
contrôle supprimant tout payload du job et publiant la base ready révision
avancée. Aucun checkpoint expurgé entre deux DB n'est nécessaire avec ce
choix ; avant commit le job complet existe, après commit root seul existe.
Ne jamais rendre ready avec une copie privée que l'effacement ignore.

Avant toute publication d'histoire : enregistrer durablement `aborting`
AVANT la première suppression, puis abandon des seules ressources exactes
attribuables au job. Après histoire candidate présente : reprise uniquement.
Exception de quota avant le tout premier ciphertext : depuis `publishing`,
l'abandon reste possible seulement si le candidat non-null est distinct de
l'ancien enc, les QUATRE slots sont strictement anciens, les preuves source et
fence sont intactes, puis un CAS `aborting` compare aussi les raws LS en RAM.
Le cas candidat null conserve le checkpoint explicite et reprend sans écriture
LS. Ce témoin suppose l'exclusion des writers compatibles, pas une preuve contre
réécriture hostile/ABA du stockage. Si un fence/reçu d'effacement
nouveau est constaté, refuser la publication ; permettre le nettoyage étroit
du job sans remettre anciens fence/session/clé/usage du compte effacé. Le
document suivant retrouve le reçu existant. Le cas usage déjà appliqué puis
révocation doit être fermé concrètement avant GO, sans résurrection d'une
ligne source supprimée. Aucun POST d'effacement pendant restauration.

L'abandon ne remet jamais `baseUsage` : il recalcule les compteurs des lignes
restantes dans la transaction de suppression. Un usage absent après vidage
reste absent ; une incohérence sans reçu d'effacement bloque le retour ready.

Les fichiers autonomes doivent avoir un accès durable explicitement annoncé
dans l'aperçu, avec téléchargement owner-scoped des octets après reload. La
préparation legacy utilise une route froide exacte avant l'admission privée,
puis une navigation de document vers `/?start=1`, jamais un montage à chaud.

Le nettoyeur actuel connaît legacy/actif/journal de migration. Le nettoyage
atomique du journal d'import avant ready évite d'étendre ce périmètre à une
quatrième copie persistante. La révocation distante legacy reste non observable
sans réseau et n'est pas une nouvelle garantie de ce publisher local.

## Recettes bloquantes et activation

- Coupure/quota à adoption, chaque copie, histoire multi-slot et finalisation ;
  journal absent ou complet, aucune copie orpheline admise.
- Histoire candidate écrite avec phase ancienne et plaintext encore présent ;
  reprise idempotente sans nouvel ID ni double usage.
- A→B→A, clé/fence changés, collision/tombstone, v7 avec droits reset de B.
- Abandon pré-histoire, nettoyage interrompu et effacement concomitant ; aucune
  remise d'ancien snapshot global ni recréation de source effacée.
- Vraie archive → UI → publication → reload : lecture historique, fichiers et
  documents exacts, rendu/exports inertes et modification explicite possible.
- Archive sans conversation : projets/fichiers autonomes visibles, usage exact,
  checkpoint explicite malgré histoire ancienne/candidate identique.
- Chemin legacy initial raccordé et quota avant/après barrière traité sans
  purge ; recette navigateur puis distribution native clairement bornée.

Deux contre-revues après code, verify complète et recette réelle du parcours
avant activation Web. Une validation physique APK absente peut borner la
plateforme attestée ; elle ne doit pas justifier un faux achèvement avec
Restaurer toujours inaccessible aux utilisateurs Web. Aucun GO d'activation
n'est donné par les seuls diagnostics pré-code. Les deux contre-revues finales
produit et sécurité donnent un GO borné au candidat Web, sous réserve de la
vérification complète et des reçus de livraison. Les recettes navigateur
finales, y compris le changement de bundle START=false, sont réussies.

## Repli compatible obligatoire

`ISOLATED_WORKSPACE_ENABLED=true` est désormais un engagement de lecture et
de récupération. Ne pas le remettre à false et ne pas revenir au build #477
ou antérieur après qu'un utilisateur a adopté le stockage isolé ou un job v8.
Conserver les lecteurs et acteurs de récupération des protocoles v2 à v8.

En cas de régression reproductible d'admission/restauration, collision ou
rupture d'isolation entre propriétaires : livrer un correctif compatible avec
`WORKSPACE_RESTORE_START_ENABLED=false`. Ce drapeau refuse seulement les
nouvelles préparations/restaurations et le commit d'un aperçu créé dans ce
même nouveau document ; il ne désactive ni lecture, ni reprise, ni abandon.
Tests v2/v7 → v8 dans les trois phases, et reprise v3, exécutés avec ce repli.

Il s'agit d'un nouveau déploiement, pas d'un interrupteur distant : un ancien
onglet utilisant encore le bundle START=true n'est pas révoqué instantanément.
Ne pas purger les données ou journaux, rétrograder les bases, remettre un
snapshot global, ni demander de supprimer une archive pour rétablir l'UI.
Les captures restent vérifiables indépendamment du démarrage d'un import.

La première admission est Web uniquement. Le protocole compatible reste
lisible sur le runtime natif, mais aucun démarrage natif n'est autorisé ;
aucune recette physique APK ou capacité mémoire téléphone n'est revendiquée.
La synchronisation serveur et ses garanties multi-appareil ne font pas partie
de ce lot. Les sondes publiques de livraison ne mesurent pas un taux global
d'erreurs ou une latence réelle d'utilisateurs.
