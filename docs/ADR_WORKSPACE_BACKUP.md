# ADR — sauvegarde restaurable et coffre optionnel (W06)

Date : 5 septembre 2026. Décision locale acceptée après deux challenges
indépendants. **W06 non livré** : A1 est le format, pas une interface de
sauvegarde, une restauration ni une synchronisation utilisable.

## Contexte

L'historique est dans localStorage, les pièces jointes dans `arty-files`, les
projets dans `arty-projects`. Ces stockages n'ont pas de transaction commune.
Les getters UI peuvent masquer un ciphertext verrouillé en retournant vide.
L'export JSON de conversation ne réhydrate pas les originaux et ne conserve pas
le graphe de projet à l'import : il ne constitue pas une sauvegarde du workspace.
La clé locale actuelle n'est pas une clé E2EE, notamment avec le marqueur public
`server-provided`. Les identités locales ne sont pas des identités serveur.

## Décision et périmètre

1. **A1 : format et validation sans effet**. Nouvelle archive versionnée,
   indépendante des exports de conversation. Aucun appel réseau ni écriture
   applicative. Tests cryptographiques et de graphe avant intégration.
2. **A2 : capture + restauration + UI**. Sélection explicite des conversations
   et projets ; lectures strictes, photographie revérifiée après les opérations
   asynchrones. Ressources manquantes/verrouillées visibles, jamais filtrées.
   Restauration en copies avec IDs remappés, staging masqué et journal durable
   récupérable ; publication uniquement lorsque le graphe est complet. Une
   annulation ou un quota ne doit pas écraser le workspace existant.
3. **B : coffre distant optionnel**. Réutilise les objets, mais exige sa propre
   identité vérifiée, CAS/génération serveur, outbox, conflits conservés,
   suppression/ACK/checkpoint et resynchronisation des appareils expirés.
   Une archive manuelle, même déposée dans le cloud, ne valide pas B.

Périmètre A : texte des échanges, métadonnées de classement/attribution et
restrictions privées, projets/consignes de projet, originaux **et textes extraits
exacts/version**, pièces jointes et images générées. Les secrets, droits de
facturation, mémoire serveur, mémoire locale/consignes globales, autres réglages,
brouillons, rapports, traces et tâches/rappels sont exclus de cette première
version. Ce périmètre sera nommé dans l'UI, sans promesse « toutes vos données ».
Pas de recompression ni de réextraction à la restauration.
L'intention historique `quickAction` (ID/locale allowlistés) et la preuve
`factCheck` (texte original/corrections/verdicts) sont conservées comme données,
sans relancer une vérification en attente. Les recadrages sont des rectangles
normalisés dans [0,1], pas des coordonnées en pixels.

« Secrets exclus » désigne les magasins de credentials/configuration : une clé
volontairement collée dans le texte d'un échange reste du texte sauvegardé, sans
redaction silencieuse. Les fixtures binaires A1 sont des octets artificiels,
pas des images/DOCX utilisables ; elles prouvent la fidélité, pas la reprise Office.

Chaque message déclare `embeddedFiles` (obligatoire, IDs uniques/bornés) pour
ses images réellement rendues. A1 valide **le graphe déclaré**, pas la complétude
sémantique du futur capteur A2 : une URI citée en prose/code n'est pas une image.
Le capteur doit produire cette table depuis les dépendances réelles du rendu.
La restauration doit figer/remapper cette allowlist ; une URI non déclarée
reste indisponible, y compris `src` HTML/entités. Aucun fallback vers
`getFile(rawId)` du compte cible, même si cet ID y existe. Les diagnostics de
locateurs utilisent les lignes du texte exact déchiffré ; un crop historique
sans source à normalisation courante reste signalé comme non relocalisable.

Les dépendances directes et les documents vivants du manifeste doivent toutes
être présents. Les références historiques de `projectTurn` peuvent viser une
source non incluse ou désormais indisponible : conserver sa preuve, ne pas
prétendre qu'elle est supprimée ni la rattacher au document actuel. Même
distinction pour un projet associé non inclus et l'origine indisponible d'un
recadrage ; rapport explicite des capacités non restaurables. Les IDs de ces
références seront remappés aussi, afin de ne jamais résoudre accidentellement
une ressource préexistante du compte cible. Conserver EU par OU du fil, de ses
tours et du projet associé ; ne jamais perdre les marqueurs Google/document.

Le texte archivé n'est **pas** une autorisation : la restauration devra rendre
inertes les anciennes actions HTML et les liens internes vers rapports/traces
exclus, sans relancer de stream, outil, notification, AI ou requête réseau.
Le sous-lot A1 ne rend pas ce texte dans l'application.

## Format binaire A1

Pas de ZIP, compression ni paramètres KDF fournis par le fichier. Code de
récupération `ARTY1-` + 32 octets aléatoires en hexadécimal groupé, créé côté
client. Ce n'est pas un mot de passe libre. Ne pas le persister sous la clé
locale actuelle ; ne pas l'envoyer au serveur. Sans code ou appareil encore
déverrouillé, pas de récupération promise par une simple reconnexion Google.
Les chaînes JS ne permettent pas de promettre un effacement mémoire absolu.

- Header de 64 octets : magic/version ASCII `ARTYBKP1` (8), UUID aléatoire
  d'archive (16), salt aléatoire (32), nombre total de frames u32 BE (4),
  longueur UTF-8 du manifeste u32 BE (4). Aucun nom, email ou secret en clair.
- UUID et salt sont générés **dans l'encodeur**, jamais passés par le caller.
  HKDF-SHA256, info fixe `arty-workspace-backup/v1`, dérive AES-256-GCM avec clé
  non exportable. Tag 128 bits ; nonce 96 bits = 8 octets zéro + index u32 BE
  de frame. Index unique dans une archive, clé différente par salt aléatoire.
- Préfixe de frame de 9 octets : type (1 manifeste, 2 bloc), index u32 BE,
  longueur plaintext u32 BE. AAD = header exact + préfixe exact. Frame 0 =
  manifeste chiffré ; les suivantes = objets dans l'ordre du manifeste, blocs
  de 256 Kio, dernier bloc exactement à la taille restante.
- Manifeste UTF-8 strict et JSON allowlisté : version/minReader/features
  obligatoires ; toutes les propriétés imbriquées, enums, IDs, références,
  nombres et tailles sont validés. Types/features inconnus refusés.
  Empreinte SHA-256 des octets de chaque objet, vérifiée avant tout résultat.
- Limites indépendantes : manifeste 4 Mio, 256 objets, 512 frames (manifeste
  compris), objet 10 Mio, total plaintext **60 Mio manifeste compris**, archive
  64 Mio. Objets vides refusés. Entiers/sommes vérifiés avant allocation.
  Ni frame manquante/surnuméraire, ni padding, ni octets après EOF.
- Traitement séquentiel, pas de `Promise.all` des blocs ni lecture de toute
  l'archive avec `arrayBuffer()`. SHA-256 WebCrypto lit un objet entier, borné à
  10 Mio ; le résultat conserve jusqu'à 60 Mio de Blobs. Ce n'est pas une
  garantie d'un pic RAM de 60 Mio : le navigateur peut faire des copies.
- Callback d'annulation/AbortSignal aux frontières asynchrones ; aucun graphe
  partiellement validé, contenu privé ou secret dans les erreurs/journaux.

Primitives standard : [HKDF, RFC 5869](https://www.rfc-editor.org/rfc/rfc5869),
[Web Cryptography API](https://www.w3.org/TR/webcrypto/). Le format applicatif
n'est pas présenté comme ayant reçu un audit cryptographique externe.

## Options de stockage distant et décision différée

- R2 pour les blobs + D1 pour le manifeste/CAS est le découplage préféré,
  **non configuré/non autorisé implicitement** : aucun binding R2 attesté.
- D1 en morceaux est possible pour un pilote très borné avec réservations
  transactionnelles, limite par compte et plafond global. La base actuelle
  porte aussi auth/facturation : aucune promesse de coût nul ou de capacité.
- KV n'est pas l'autorité de verrou/CAS/révocation (cohérence éventuelle).
  Durable Objects n'est pas nécessaire à cette première version.

Les docs Cloudflare actuelles donnent 2 MB par ligne/BLOB D1 et 500 MB par base
Free. Certaines références locales du skill sont anciennes : ne pas reprendre
leurs chiffres/API. [Limites](https://developers.cloudflare.com/d1/platform/limits/),
[tarifs D1](https://developers.cloudflare.com/d1/platform/pricing/),
[tarifs R2](https://developers.cloudflare.com/r2/pricing/).
Un location hint ne prouve pas la résidence européenne ; EU des modèles n'est
pas une promesse de juridiction du coffre.

Vérification locale du 5 septembre : Wrangler 4.129.0 exécuté via npx, commande
`whoami --json`, authentification expirée/non renouvelable. Aucun login,
contournement, nouveau bucket, upload ni activation payante. Configuration et
capacité déployées restent non vérifiées ; le choix B attend cet accès.

## Conséquences et prochaines preuves

A2 a deux prérequis supplémentaires établis en contre-revue :

- L'exécution image est livrée dans #447. La galerie livrée dans #448
  utilise `Message.generatedImages`, références privées issues du reçu
  d'outil local, jamais du texte du modèle. Le rendu Markdown/public ne résout
  aucun ID de fichier ; les anciennes URI `arty-img` restent indisponibles.
  **Décision du 5 septembre : pas de table d'alias URI.** A2 peut mapper ces
  références vers `embeddedFiles` d'A1, puis vers de nouveaux IDs locaux à chaque
  restauration. Cela ne nécessite pas de changement de version A1. A1 vérifie
  le graphe déclaré, pas le rôle du message ni le contenu image : A2 devra
  restreindre ces références aux messages assistant et vérifier MIME/signature
  des blobs. Les exports JSON locaux omettent ces références avec avertissement,
  ils ne constituent pas une sauvegarde des images.
- Un journal seul ne protège pas localStorage contre une fenêtre au cache
  ancien qui réécrit toute la liste. A2 devra isoler une nouvelle génération
  de clés des clients legacy et coordonner tous ses writers (ou migrer vers une
  autorité transactionnelle), pas seulement verrouiller le bouton Restaurer.
  Une comparaison suivie d'un setItem n'est pas un CAS. Aucun verrou ni
  migration d'historique n'est implémenté par A1 ou le lot d'exécution image.

A1 peut être testé et livré sans migration ni UI. A2 doit ajouter inventaire
exhaustif, contrôle de stabilité, journal de restauration, reprise et intégration
de l'effacement. Aucun simple try/finally entre trois stockages ne vaut atomicité.
B ne peut réutiliser la GC locale des 100 tombstones sans protocole ACK/checkpoint.
Un CAS SQL à zéro ligne n'est pas une erreur de transaction : toutes les écritures
dépendantes doivent rester conditionnées à la même réservation/génération.

Le reçu image est copié synchroniquement dans le filet de sécurité de l'historique
avant reprise du modèle, y compris sans texte. Un quota localStorage plein refuse
l'adoption sans inventer de reçu en RAM ; une image précédente reste conservée.
Il ne s'agit ni d'une transaction physique entre IndexedDB et localStorage, ni
d'une garantie de flush disque après coupure électrique. Les retries créent une
branche lorsque la portion remplacée contient une image ; l'original conserve
ses références. La suppression est limitée aux références structurées sans
autre détenteur ; le texte legacy peut retenir un fichier, jamais autoriser sa
suppression. Pas de GC globale, ni de collecte des blobs orphelins de générations
annulées. Les vues invalident leurs URLs sur changement de compte/clé/fence ;
un placeholder interrompu ne réacquiert pas automatiquement une vue privée.

Recette : tags/digests, code erroné, frames substituées/dupliquées/tronquées,
bornes ±1, UTF-8 invalide, JSON profond, références absentes/historiques/crop,
mutation du caller et annulation. Puis stockage vierge/nouvelle clé locale,
quota/crash à chaque phase, double import, A→B→A/effacement et deux appareils
isolés/offline/divergence/suppression. Aucun test simulé ne vaut une recette
visuelle Office, Android ou multi-appareil réelle.

## Préparation A2 après la livraison #448

### Révision du 5 septembre : réservation par document, lot coopératif

La proposition de bail transférable par compte ci-dessous est **remplacée pour
le premier sous-lot** par un verrou Web Locks unique par origine/profil, acquis
avant tout import de l'application privée, connexion et preview comprises.
Une fenêtre/PWA détient ce verrou pendant toute la vie de son document. Les
autres affichent Occupé et un Retry explicite ; pas de vol, attente automatique,
expiration arbitraire ni faux mutex localStorage. Sans API disponible, l'espace
privé est indisponible avec explication FR/EN ; les pages publiques restent lues.

Pourquoi : le bail par compte obligeait à transférer l'autorité au changement
de clé, au login provisoire et à l'effacement, et à propager un nonce dans des
dizaines de callbacks qui peuvent déjà muter la RAM avant save. Le verrou
document ne se libère ni sur logout/switch/crypto, ni sur hidden/pagehide ou
démontage React. Il ne remplace pas les guards de compte/époque/crypto existants.
Le coût assumé est une seule fenêtre privée par profil/origine, tous comptes
confondus, connexion comprise. Les onglets publics ne réservent rien ; leurs CTA
font une navigation complète pour relire la session après acquisition.

`/auth/callback` n'est PAS public : la gate précède consommation du nonce,
verifier et code. `App`, `useAuth` et le seed preview sont importés après grant.
Le module d'entrée ne remplit donc aucun ancien cache pendant l'attente.
L'attribution de campagne et la langue, non privées, restent hors workspace.
Le callback du verrou reste pendant même si le chargement React échoue ; la
récupération est un rechargement froid, pas un reset du même lazy rejeté.
Un retour BFCache privé demande aussi une recharge froide sans release volontaire.

Un token document perdu est terminal et n'est jamais réarmé dans ce document.
Les frontières conversations/crypto/scoped/session et transactions fichiers/
projets le contrôlent ; les transactions IDB actives sont avortées sur perte.
Un commit déjà terminé ne peut pas être annulé. Ce durcissement ne prouve PAS
l'arrêt de tous les callbacks annexes (notamment trails/cache wallet) en cas de
vol exceptionnel par un autre script. En fonctionnement conforme, le verrou
document les sérialise aussi. Ce n'est ni une autorisation ni une barrière XSS.

Deux contre-revues indépendantes favorables. Recette locale Chrome, même profil
et origine, données synthétiques : B occupé, Retry refusé tant qu'A vit ; après
fermeture réelle d'A, B relit exactement le titre et le fichier chiffré écrits
par A. Fermeture réelle pendant transaction IDB maintenue : rollback observé,
reader suivant non bloqué, historique/fichier précédents préservés. Recharge,
navigation externe et retour callback synthétique, Back/Forward vérifiés ; vrai
`main.tsx` pour discover/share/login/callback, UI privée réelle après rejet du
state synthétique. Ce n'est PAS un échange Google réel ni une validation Android.
Écran occupé vérifié à 390×844 ; boutons 44 px minimum et contraste ink/bg.
Le harness temporaire est retiré avant publication. Aucun compte réel utilisé.

Tests : 43 nouveaux tests de noyau, StrictMode/UI, vrai Web Crypto + transactions
IDB simulées, effacement et graphe statique des imports publics. Les anciens
tests unitaires utilisent une fixture explicite de document déjà admis ; la
suite de persistance désactive cette fixture pour tester les vrais refus.

Limites inchangées : clients legacy non coopératifs, restauration dans le même
document (quiescence encore nécessaire), snapshot strict, générations vNext,
journal et sync restent à faire. Pas de migration de clés/schéma ni de purge
de données dans ce sous-lot. Avant d'activer restauration, la barrière legacy et
la maintenance des writers du document courant restent indispensables. Les
paragraphes de proposition ci-dessous décrivent ces travaux, pas du code livré.

Repli : revert du lot par Git/CI/Pages, sans rollback de données. Déclencheurs :
blocage d'un document unique sur navigateur compatible, callback incapable de
reprendre après navigation externe, ou chargement privé hors grant. Les APK
déjà installés gardent leur bundle ; CI Android n'est pas une recette WebView.

Contre-revues préparatoires du 5 septembre : capture/restauration A2 non codées.
Le tableau décrit le protocole à établir et tester, pas des garanties présentes ;
la coordination initialement par compte est remplacée par la décision ci-dessus.

| Frontière | Risque vérifié dans le code | Prérequis proposé |
|---|---|---|
| `storage.ts`, `userSession.ts` | CRUD synchrone sur cache entier ; bootstrap, chiffrement différé, quarantaine et migration peuvent écrire | Writer unique par compte pendant toute la session d'édition ; bail capturé avant les attentes ; lecture fraîche avant activation d'un nouveau bail ; clés vNext isolées du CRUD legacy |
| `secureFileStorage.ts` | Ancien client peut écrire/supprimer les fichiers ; ouverture v1 sans `blocking` | Neutralisation des connexions legacy avant publication, par barrière de version IDB ou isolation complète des assets ; fermeture explicite d'un ancien onglet si upgrade bloqué, aucun contournement ; restauration exacte distincte de `putFile` |
| `projects/store.ts` | Mutations transactionnelles locales mais pas de transaction avec l'historique ; readers peuvent exposer des copies partielles | Même coordination des writers ; journal/staging masqués ; gate durable lu avant bootstrap/publication et reprise idempotente |
| `accountService.ts` | Purges actuelles ne connaissent pas de futur journal/staging | Stores de restauration indexés par propriétaire, inclus dans la purge avant `finishProjectErasure` ; marker conservé si échec ; aucune reprise après changement de fence |

Un mutex seulement pendant la restauration ne suffit pas : une fenêtre ayant
gardé un ancien cache peut ensuite réécrire la liste et enlever les copies.
Un writer de session permet de garder les APIs synchrones actuelles, avec le
coût UX d'une seule fenêtre éditrice par compte. Les autres fenêtres devront
être explicitement non éditrices ; pas de prise de contrôle automatique avec
`steal`. L'autre option est une refonte des mutations vers transaction/CAS
asynchrones, plus large. L'absence de Web Locks ne doit pas être remplacée par
un faux verrou localStorage pour autoriser une restauration.

La coordination de session est par compte, mais une montée de version IDB
concerne la base entière : prévoir aussi une maintenance/bascule à l'échelle
de l'origine. Les générations legacy restent conservées ; leurs écritures
tardives sont des divergences récupérables à signaler, jamais fusionnées
automatiquement après activation de la nouvelle génération.

Le Web Lock est coopératif : sa durée dépend de la promesse du callback ; un
signal d'annulation de demande ne remplace pas la fin d'un callback déjà actif.
La barrière de version IDB doit attendre la fermeture des anciennes connexions,
pas les supposer neutralisées dès l'appel `open`. Références primaires relues :
[Web Locks](https://www.w3.org/TR/web-locks/),
[IndexedDB](https://w3c.github.io/IndexedDB/). Aucun de ces mécanismes n'est une
autorisation d'accès, un remplacement du chiffrement ou une protection contre
un script malveillant déjà exécuté dans la même origine.

Inventaire/capture et admission de restauration :

- Lectures strictes distinguant absent, verrouillé, corrompu, occupé et prêt,
  notamment les slots d'historique en quarantaine ; aucun filtre de fichiers
  absents transformant un export incomplet en succès.
- Construction allowlistée de chaque sous-arbre : omettre les champs absents,
  ne pas injecter `undefined` ni partager des objets `factCheck` entre messages
  d'un snapshot. Ne pas normaliser silencieusement le texte ou les tags.
- `embeddedFiles` A1 admet plus que la galerie : admission A2 des seuls messages
  assistant, au plus quatre références uniques, MIME/signature et bornes image.
  Les IDs source admis par A1 deviennent de nouveaux UUID locaux ; les références
  historiques indisponibles sont aussi remappées sans résolution côté cible.
- `BackupFileReference` ne porte que ID/crop ; les noms/MIME/tailles du message
  peuvent différer des octets après compression historique. Refuser ou signaler
  ces divergences avant export, sans choisir arbitrairement la métadonnée.
  Si la fidélité requiert plusieurs variantes, il faut décider explicitement
  d'une évolution du format ou d'objets distincts comptés dans les bornes : A1
  interdit plusieurs `BackupFile` partageant un seul `objectId`.
- Écrivains exacts pour fichiers et projets : aucune recompression/réextraction,
  conservation des métadonnées de normalisation historique v1/v2 et des textes
  extraits exacts. Les APIs ordinaires d'import ne remplissent pas ce contrat.
- Les tags sont autonomes : IDs prédéfinis intégrés au code ou libellés perso,
  pas de catalogue utilisateur externe oublié. Conserver chaînes et ordre,
  dont `work` et `Client Émile` dans un round-trip FR→EN.
- Préflight capacité cible : existant + copies additives + staging/journal +
  expansion base64/chiffrement. La limite de l'archive seule ne valide pas un
  pic mémoire natif ; le helper de partage natif convertit le Blob en base64.

Premier parcours complet proposé : une conversation entière et toutes ses
dépendances directes, projet courant entier en option explicite, code séparé,
export chiffré puis réouverture/vérification, restauration d'une copie. Les
preuves historiques manquantes restent des diagnostics, jamais des suppressions
inventées. Pas de sélection de sous-plage, fusion ni reprise automatique
d'actions HTML, rapports/traces exclus, fact-check, outil ou notification.
Une livraison intermédiaire capture/vérification doit porter ce nom et ne
valide ni restauration ni W06. Aucun de ces parcours n'est encore branché.

### Préparation du lot capture/vérification après #450 (non implémenté)

Les deux contre-revues indépendantes du 5 septembre et la lecture des stores
précisent le prochain lot. Il ne livre pas la restauration ni la synchronisation :

- Entrée distincte « Archive chiffrée de cette conversation » dans les deux
  menus de conversation (ChatTopBar et ChatOptionsSheet). Fermer le menu avant
  la modale. Les paramètres offrent seulement la vérification d'une archive,
  pas un export implicite de toutes les données. Projet courant entier sur
  choix explicite ; aucune sélection partielle de messages.
- Capture stricte de la conversation clonée avant le premier await, cache déjà
  chargé et génération monotone vérifiée, jamais `updatedAt` seul. La copie
  logique fraîche reste utilisable pendant son chiffrement différé. En revanche,
  chargement, traitement actif sur cette conversation ou dépendance non persistée
  empêchent un succès. L'état de traitement doit venir du hook propriétaire,
  pas seulement de la présence d'un message nommé `streaming`.
- Tous les enregistrements fichiers requis sont figés dans une seule transaction
  readonly avant déchiffrement, pour éviter un mélange de versions du même ID.
  Lectures dédiées sans bootstrap, réparation, création ni migration de base.
  Fichier direct absent/inaccessible ou galerie présente mais malformée : erreur
  bloquante, jamais filtrage silencieux via `getFiles`/`generatedImageIds`.
  Un échec AES-GCM reste « illisible : clé incompatible ou données altérées ».
- Le graphe provient exclusivement des références structurées. Le Markdown
  n'autorise aucune lecture. Propriétés optionnelles réellement omises,
  sous-arbres frais et allowlistés. Les écarts entre métadonnées du message et
  version réellement persistée sont diagnostiqués avant export ; pas de promesse
  de retrouver un original antérieur à la compression. Les sources historiques
  indisponibles sont des diagnostics, pas des fichiers déclarés supprimés.
- Si le projet est inclus : tous les originaux persistés et textes extraits
  exacts, vérification des descripteurs/hashes et de la révision après lecture.
  Aucun réimport, aucune réextraction.
- Pour toute capture, avec ou sans projet : gardes document, owner, epoch,
  crypto et effacement capturées avant le premier await et revérifiées jusqu'à
  la remise ; le verrou seul ne prouve ni la
  quiescence interne ni la sûreté face aux anciens clients.
- Sceller puis rouvrir le Blob via A1 et vérifier le graphe avant de proposer
  la remise. Code de récupération séparé ; nom de fichier date/ID opaque, sans
  titre de conversation en clair. Le téléchargement/partage lancé ne prouve pas
  la sauvegarde effective : une vérification réelle demande de re-sélectionner
  le fichier enregistré et de saisir son code. Après une capture, comparer aussi
  l'identité et l'inventaire attendus pour qu'une autre archive valide ne valide
  pas cette sauvegarde. Le vérificateur autonome annonce seulement le contenu
  de l'archive effectivement sélectionnée. Limites A1 appliquées tôt, sans
  promettre un pic RAM égal à la taille d'archive, notamment sur Android/base64.

Recette à fournir : fichier absent, galerie malformée, aucun accès via Markdown,
clé/compte A→B→A, effacement pendant capture/scellement, remplacement du même ID,
mutation avec même timestamp, projet modifié entre documents, limites de taille,
réouverture avec mauvais code et assertion d'absence de toute écriture source.
Les seuls tests du conteneur A1 ou de la gate document ne valident pas ce parcours.

### Restauration ultérieure — protocole proposé

Journal proposé sous bail et maintenance : préparé → staging → vérifié →
publication → terminé. Mapping créé une seule fois, données exactes chiffrées
et indexées par owner/job ; gate durable avant publication, vérification du
graphe publié et levée du gate en dernier. Reprise avec les mêmes IDs après
crash, demande de re-sélection d'archive si le staging est incomplet, annulation
limitée aux ressources du job. Ne jamais réécrire un ancien snapshot global
pour faire un rollback. Acquérir l'autorité de maintenance avant une suppression
de compte côté serveur, pas après sa révocation distante. Aucun reçu d'effacement
clos avant purge de tous les stores/générations du compte.
