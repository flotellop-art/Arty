# ADR — sauvegarde restaurable et coffre optionnel (W06)

Date : 5 septembre 2026. Décision locale acceptée après deux challenges
indépendants. **W06 non livré** : A1 fournit le format ; A2 ajoute maintenant
capture/vérification d'une conversation (preuves de livraison dans le CDC).
La restauration et la synchronisation restent à implémenter.

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
valide ni restauration ni W06. Le lot ci-dessous branche la capture/vérification.

### Contrat du lot capture/vérification après #450 (implémenté)

Les deux contre-revues indépendantes du 5 septembre et la lecture des stores
définissent ce lot. Il ne livre pas la restauration ni la synchronisation :

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

#### Décisions d'implémentation A2

- **Manifeste v2 explicite**, paire version/minReader 2/2 ; le lecteur accepte
  toujours 1/1. L'enveloppe ARTYBKP1, le HKDF /v1 et les codes ARTY1 ne changent
  pas. Le lecteur v1 refuse v2 : pas de downgrade silencieux.
- Chaque référence v2 possède une `presentation` qui conserve les métadonnées
  historiques du message, y compris nom/MIME vide et taille zéro. Le fichier
  possède une taille binaire réelle et `recordedSize`, la taille du store (qui
  peut historiquement compter les caractères base64). Les trois restent
  distinctes ; seules les tailles binaires déterminent les quotas/objets.
  Aucune recompression, réparation ou interprétation de la présentation.
- Projection allowlistée synchrone, sans getters ; générations et identité
  contrôlées pendant les awaits. Projection comparée de nouveau en fin/remise
  pour détecter aussi une mutation RAM directe sans save. L'invalidation par
  génération est volontairement globale : « espace modifié », pas seulement
  « conversation modifiée ». Les slots illisibles en quarantaine ne sont pas
  une source de cette capture de la conversation actuellement accessible.
- Préparation de message, fact-check (y compris attente de récupération des
  liens avant le badge pending) et association projet sont comptés par
  conversation/compte/époque. Pas de bouton bloqué depuis un getter non réactif :
  le getter du hook est relu à la demande et pendant la capture.
- Lecture brute de tous les fichiers dans une seule transaction readonly,
  puis déchiffrement séquentiel. Projet figé avant cette lecture, révision
  revérifiée après les documents. Textes source/extraits exacts : un surrogate
  isolé est refusé, le BOM UTF-8 valide est conservé.
- La lecture d'une base absente annule l'upgrade initial, sans migration.
  Erreurs de transaction consommées ; ouverture bloquée rejetée ; succès tardif
  fermé ; token de lecture fermé incapable de retomber sur un getter créateur.
  Fence et marqueur d'effacement stricts, sans assimiler null/false/0 à l'absence.
- La remise reste liée à la fraîcheur source. La vérification d'un fichier
  déjà enregistré compare ID et fingerprint complets sous gardes session,
  crypto et effacement, mais n'exige plus que l'historique source soit inchangé.
  Aucun lookup des IDs de l'archive dans les stores locaux du vérificateur.
- Révocation terminale des deux vues sur bus local/perte du document, même
  sans démontage : codes, fichiers, rapports effacés de l'état et du DOM,
  opérations annulées. Pas de promesse d'effacement physique de la mémoire JS.
- Paramètres : vue interne de vérification, pas de second dialogue. Focus
  transféré explicitement lors des transitions ; aucun changement du piège
  global qui pourrait intercepter les sous-dialogues existants.
- Plafonds : manifeste 4 Mio, objet 10 Mio, contenu déchiffré 60 Mio,
  archive 64 Mio, fichiers 128 ; pas de succès partiel. Ces plafonds ne sont
  **pas** une mesure du pic RAM natif : Blob, base64 et chiffrement se cumulent.

Le code de récupération n'est pas transmis au helper de téléchargement/partage.
Après remise, le client annonce seulement « demandé » ; la re-sélection reste
nécessaire pour confirmer le fichier. La recette du sélecteur/partage sur un
APK installé n'est pas attestée par les tests navigateur ou CI Android.

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

### Préparation A3 après #451 — objections et découpage retenu

Deux contre-revues indépendantes en lecture seule, 5 septembre. **Proposition,
pas une restauration livrée.** La capture n'ajoute aucune autorité de publication.

Premier lot A3a : plan de restauration sans écriture ni migration. Lecture
authentifiée complète de l'archive, projection inverse immuable, nouveaux UUID
par domaine et mapping figé. Les messages sont identifiés par le couple
conversation/message ; les documents par projet/document : leur ID source
seul n'est pas globalement unique (`schema.ts`). Remapper aussi les références
historiques absentes et les crops, sans accès aux stores cible par ID source.
Un deuxième import volontaire reçoit un nouveau mapping ; une reprise exige
le même mapping lié à l'archive et son fingerprint, jamais une régénération.

Préserver les trois tailles v2 (présentation du message, taille enregistrée,
octets), la normalisation historique, les révisions, tags/falsy, sources et
textes exacts. En v1, la présentation absente provient du fichier global :
ne pas prétendre retrouver des métadonnées qui n'ont pas été archivées.
L'horodatage technique `StoredFile.createdAt` n'est pas dans l'archive.
Galerie : assistant, quatre références au plus, MIME/signature admis et IDs
remappés ; aucune autorité ajoutée à une URI Markdown.

Inertie à définir avant branchement UI : le contenu exact reste une donnée,
mais les actions HTML connues sont actuellement dispatchées au clic dans
`AssistantBubble`. Une marque persistante de message restauré devra couper
ce dispatch et présenter un fact-check `pending` comme historique non repris,
y compris après recharge/branche. Ce plan seul n'autorise aucun rendu actif.

A3b : admission et reprise avant tout import privé. Option privilégiée à
challenger : document froid dédié, sous le verrou existant, sans Chat monté,
afin d'éviter de traiter un simple compteur busy par conversation comme une
maintenance globale. Le journal/gate doit aussi précéder les bootstraps de
connexion et de changement de compte. Aucun epoch RAM comme preuve durable.

La bascule paresseuse du compte courant ne doit pas uniquement renommer une
clé sous `arty-{owner}-` : `clearAllForActiveUser` legacy efface ce préfixe,
y compris le sel/check/version crypto. Isoler et inventorier l'autorité crypto
locale pertinente, l'historique ET les assets. Une barrière IDB de version
doit attendre réellement la fermeture des connexions v1 ; une ouverture
bloquée n'est pas une autorisation de passer. Un simple revert vers un ancien
bundle ne sera plus un rollback compatible après cette bascule : conserver
les nouveaux readers. Ne pas activer la restauration sans ce contrat testé.

A3c : writers exacts réservés au job (pas `putFile`/`createProject` ordinaires),
staging masqué, publication du graphe complet et relecture avant levée du gate.
Préflight cumulatif existant + copies + staging/journal + base64/ciphertext ;
`navigator.storage.estimate` n'est ni une réservation ni une preuve de place.
Collision refusée, annulation limitée aux ressources du job, journal et toutes
générations inclus dans la purge avant `finishProjectErasure`, même sans clé.
Acquérir la maintenance avant révocation serveur, pas après.

Tests attendus : stores/réseau interdits dans A3a ; collisions inter-domaines,
références absentes, v1/v2, fidélité et EU monotone ; puis ancien client,
quota/crash à chaque phase, A→B→A, effacement, archive différente à la reprise,
inertie après recharge/branche et absence de snapshot global de rollback.

### A3a — préparation implémentée, publication toujours interdite

Décision acceptée pour le service pur `workspaceBackup/restorePlan.ts` et le
rendu historique. Aucun bouton de restauration, writer cible, migration,
journal ni upload n'est ajouté. La projection enveloppée porte explicitement
`publication: not-authorized` : elle ne doit pas être montée dans le chat,
dont les composants de fichiers lisent les stores privés au rendu.

- A1/v2 complet, y compris plusieurs conversations/projets et objets autonomes.
  Lecture authentifiée avant projection ; admission de galerie plus stricte
  que le graphe d'archive (assistant, quatre images, signature/MIME bornés).
  Ce contrôle n'est pas un décodage d'image complet.
- Mapping par domaine/parent dans un arbre profondément figé, sources absentes
  comprises. IDs source, objets et archive réservés ; aucun fallback vers eux.
  Replay lié à archive ID + fingerprint complet, couverture exacte et unicité.
  Une entrée de reprise falsy/corrompue est refusée, pas convertie en nouvel
  import : P2 relevé et corrigé par la contre-revue sécurité.
- Données originales conservées, dont trois tailles v2, dates, révisions,
  variantes de présentation, CRLF, tags et valeurs false/0/absentes. Le texte
  Markdown n'est pas réécrit pour remplacer ses anciennes URI.
- Tous les messages projetés portent `restoredArchive: true`. Rendu historique
  sans attributs d'action ni style ni ancre active (également report/trail,
  mailto/tel et liens externes). Les images Markdown n'ajoutent aucun accès.
  Le handler parent refuse aussi les attributs réinjectés. Le filtre de style
  ordinaire limitait déjà les propriétés à width% : aucune fuite CSS préexistante
  n'a été attestée par ce lot.
- Pending historique conservé mais explicitement non relancé, même horodaté
  dans le futur. Garde du vrai vérificateur avant préparation/récupération de
  liens/écriture ; branche et bootstrap chiffré conservent marqueur et preuve.
  Une nouvelle réponse générée dans le fil reste non marquée et vérifiable.
  Copier, exporter, signaler, épingler, créer une branche ou régénérer restent
  des actions explicites de l'application, distinctes des anciens boutons HTML.
- Ressources calculées : octets d'objets, base64 et JSON destination UTF-8/code
  units après expansion UUID/marqueur. Ce n'est ni une réservation de place,
  ni une admission cumulative du compte, ni une mesure du pic RAM. Une archive
  A1 valide peut dépasser le budget de projection et être refusée intégralement.
- La garde est revérifiée pendant et après préparation. `dispose` invalide
  les prochains accès par le handle et libère ses références ; il ne peut pas
  révoquer une référence plan/Blob déjà remise ni effacer physiquement la RAM.

Alternative rejetée : brancher directement cette projection sur les anciens
`saveConversation`/`putFile`. Cela ne fournit ni attribution cible, ni collision
avec l'existant, ni effacement cohérent, ni reprise crash. A3b/A3c restent des
préconditions de la restauration effective ; le replay A3a n'est pas un journal.

Recette locale : tests du vrai sealer/reader, stockage et réseau interdits pour
le planner ; tests DOM du rendu et contrôles explicites ; vrai chiffrement puis
bootstrap de stockage ; vrai hook de branche/génération et vrai vérificateur
avec fournisseurs simulés. Aucun compte réel, aucun appel IA payant ni import
de données personnelles n'est nécessaire à ces tests.

### A3b — contre-revues avant admission/migration (préparation, pas activation)

Deux revues indépendantes en lecture seule après #452. GO pour un découpage,
pas pour une bascule branchée directement sur les bootstraps actuels.

1. Admission froide bas niveau après le verrou document, **avant** import de
   previewDemo ou App. Le contrôle durable ne doit importer ni userSession,
   ni crypto, ni les stores. Absence réelle d'un contrôle encore jamais créé
   et contrôle existant incomplet/corrompu ne sont pas le même état. Version
   inconnue, journal incertain et maintenance doivent refuser l'import privé.
2. Résolveur d'emplacements et lecteurs compatibles avant toute activation.
   La décision de génération est immuable dans le document. Boot, login
   provisoire, switch et reprise après BYOK (`ApiKeysModal`/`resumeLocalStorage`)
   ne peuvent contourner l'admission au niveau crypto/stores ni convertir son
   refus en succès partiel via `Promise.allSettled`. Le login provisoire n'est
   pas encore un compte connu : le helper de capture d'archive ne l'admet pas.
3. Migration physique distincte de l'import A3a : garder les IDs existants,
   les quatre slots d'historique brut (plain, encrypted, deux quarantaines),
   fichiers orphelins/illisibles, tombstones, compteurs et reçus d'effacement.
   Ne pas appliquer au compte entier les allowlists/plafonds d'archive. Copier
   et relire l'état raw sans déchiffrer/réécrire arbitrairement ni changer le sel.
4. Le descripteur couvre historique, assets et autorité crypto. Les builders
   directs de storage/crypto et le fallback global doivent être traités, pas
   seulement scopedStorage. En génération déclarée, aucun fallback legacy ni
   création silencieuse d'un nouveau sel. Ne pas multiplier les copies de
   credentials hors des mécanismes existants de logout/effacement.
5. Gate durable avant le premier upgrade IDB, deux bases ne constituant pas
   une transaction. Lecteurs compatibles avec l'état partiel déjà livrés,
   y compris les readers readonly d'archives aujourd'hui fixés sur v1.
   Un upgrade de projects existant ne doit pas recréer ses object stores.
   Une requête bloquée subsiste après annulation UI : ticket vérifié dans
   l'upgrade tardif, transaction avortée et résultat tardif fermé.
6. Journal de migration distinct d'un futur journal d'import, avec owner,
   génération source/cible, job et protocole/phase. Copies vérifiées avant
   sélection atomique du descripteur ; sources conservées. Les écritures LS
   legacy ne sont pas bloquées par IDB : elles restent une divergence détectée,
   jamais fusionnée automatiquement dans la génération active.
7. Effacement engagé ou requête serveur incertaine prime sur migration.
   Reprise sans clé ni nouveau POST après reçu serveur confirmé ; purge de
   toutes générations, copies, métadonnées et journaux avant clôture du reçu.

Limite distante confirmée : l'ordre marqueur IDB avant POST n'existe que
depuis #443 (`d48398ad`). Les vieux clients authentifiés peuvent toujours
appeler `/api/account/delete` sans admission locale ; la route n'exige aucun
protocole de maintenance. A3b local ne revendiquera pas l'exclusion de ces
révocations distantes. Toute restriction de compatibilité serveur sera une
décision distincte ; un simple header de version n'est pas une preuve de verrou.
L'export `deleteServerAccount` actuel contourne aussi l'admission locale mais
aucun caller produit n'a été trouvé. Pas de redirection globale des API POST.

Prochain incrément : registre/admission **sans** migration automatique ni
publisher activable ; ensuite compatibilité lecteurs et copie physique,
puis reprise/effacement avant bascule. Tests prévus : import espionné, vrais
onglets legacy, annulation/upgrade tardif, crash entre chaque DB/clé/checkpoint,
quota, archive dépassée par la taille du compte, A→B→A, callbacks conservés,
clé erronée/quarantaines, effacement sans crypto, version de contrôle inconnue.
La recette d'un vrai APK mis à jour avec données existantes reste distincte.

### A3b.1 — admission froide et résolveur legacy (5 septembre 2026)

**Décision acceptée, implémentée et livrée sur le web par #453.**
Deux contre-revues indépendantes en lecture seule, sécurité/intégrité et
produit/mobile, ont donné GO après corrections. Ce lot n'est ni un writer de
registre, ni une migration, ni une restauration.

- Le verrou document précède un contrôle readonly borné à 8 secondes, avant
  tout import App/preview, session, sel crypto ou bootstrap privé. Il examine
  `arty-workspace-control` v1 puis versions et schémas exacts de `arty-files`
  et `arty-projects` v1. Il ne lit aucun record de compte dans ces assets.
- L'absence est attestée par une création IDB initiale avortée, sans base
  résiduelle. Base vide, malformée, maintenance, version/protocole/layout
  inconnus ou IDB inaccessible refusent l'ouverture. Aucun raccourci fondé
  sur un localStorage vide ; aucune réparation ni upgrade silencieux.
- Un contrôle présent ne peut autoriser que le descripteur explicite
  `legacy-v1`, validé strictement. Le résolveur est utilisé par les clés
  scoped/historique/crypto et les ouvertures normales/readonly des assets.
  La décision reste immuable pour le document ; perte du verrou terminale.
- Deadline et annulation couvrent aussi une ouverture en file derrière un
  upgrade et une transaction readonly derrière un writer. Transactions
  annulées drainées, connexions tardives fermées, jamais d'admission tardive.
- Getters et caches privés refusent avant leurs `try/catch`, même si un caller
  contourne le composant React. `getFile(id, ownerExplicite)` vérifie aussi à
  l'entrée : un refus ne doit pas devenir un faux fichier absent. Les helpers
  purs et opérations de révocation mémoire restent indépendants.

**Alternatives et compromis.** Une simple garde de mutation laisserait les
lectures/cache hydrater un mauvais format ; un contrôle `ready` générique
autoriserait un fallback ambigu. Ces options ont été écartées. Une coquille
de login indépendante d'IDB demanderait une séparation supplémentaire : ce
lot ferme donc aussi la connexion privée si le contrôle initial ne peut pas
aboutir, y compris chez un visiteur neuf. Les bootstraps optionnels après
admission restent optionnels ; leur `allSettled` n'autorise pas l'admission.

**UX.** État de vérification puis refus distincts FR/EN, recharge froide seule
après décision (pas de réarmement à chaud). URL query/hash et state/verifier
OAuth conservés, sans redirection login ni effacement. Pages publiques et
confidentialité accessibles. Le texte Android distingue installation d'une
version compatible et simple reload, qui ne met pas l'APK à jour.

**Preuves locales.** 255 fichiers, 2 806 tests réussis + 1 ignoré via `npm run
verify` ; typecheck front/back, no-CASA, couverture, build et worker Office
réussis. La fixture de capture A2 utilisant le vrai runtime a été adaptée pour
effectuer la vraie admission, sans nouveau mock. Tests : absence, contrôle
vide/falsy/futur, vrais opens/transactions bloqués puis résultat tardif,
StrictMode/remount, getters sans lecture avant admission ou après perte,
schémas créés par les vrais stores, vrai login provisoire, switch A→B→A,
reprise BYOK/KDF et effacement. Log :
`../arty-workspace-admission-verify-final-20260905.log`.

Recette navigateur IAB sur origines locales isolées : refus maintenance,
bouton Recharger exécuté, URL exacte et sentinelles OAuth inchangées, compteur
d'import privé toujours nul ; refus incompatible avec texte Android ; lien
Découvrir utilisable ; autre origine vierge ouvre la vraie connexion. Données
synthétiques uniquement, aucun appel IA payant, aucun compte utilisateur
modifié. Ce n'est pas un échange OAuth réel ni une recette APK/WebView.

**Repli et limites.** Revert de la PR via CI/Pages si une installation v1 saine
est refusée ou si la connexion ne démarre plus ; pas de données à dé-migrer.
Ce repli reste sûr seulement tant qu'aucun futur writer de contrôle/génération
n'est activé. Avant activation : lecteurs isolés, témoins monotones dans tous
les assets, journal/copie physique/reprise/effacement cohérent restent exigés.
L'absence du contrôle n'exclut pas des bases futures aux noms encore inconnus.
Aucun verrou universel des anciennes versions ni révocations serveur promis.

Reçu web #453 : head `39405506857888966c659f806835e55ee3087bf0`, squash main
`ffd9bf69ee5a0d09ceed219c84e03fab5fa2efdc`, fusion 2026-09-05 18:07:07 UTC.
CI PR `33982796853` et CI main `33983051454` réussies (web, Android,
orchestrateur). Pages preview `49d1726c-ef33-465e-a216-d3a905963890` et
production `1e1b6381-9e51-4c20-864f-e8964f0aac17` réussis, attestés par les
check-runs Cloudflare sur les SHA respectifs. L'API Wrangler directe n'est pas
authentifiée dans ce contexte : aucun credential récupéré ou déplacé.

Sonde publique 18:10:26 UTC : tryarty.com et 1e1b6381.appfacade.pages.dev
retournent HTTP 200 et le même `/assets/index-_bsPvJWd.js`, 254 221 octets,
SHA-256 `4c1ee5b4c3a30bb185d0a04989ce45352436aba0dce37bba40b52b507ae9cd2d`,
avec le contrôle froid dans l'entrée. Le build principal ouvre la vraie
connexion sur origine vierge ; pas de seed démo. La preview affiche
v1.0.99 / build 2026-09-05 18:02 et conserve ses exemples après recharge.
Ses projets sont volontairement indisponibles sans clé, conformément à
`previewDemo` : ne pas comptabiliser cette visite comme recette authentifiée.
Aucun taux d'erreur, latence de production ou test APK installé revendiqué.
CI Android de distribution `33983051469` réussie : compilation APK signé et
étape Firebase App Distribution confirmées. Sonde publique répétée à 18:16 UTC,
mêmes HTTP 200, nom d'asset et empreinte ; ce sont deux observations de
disponibilité, pas une mesure continue du taux d'erreur ou de latence.

### A3b.2 — lecteurs/writers isolés candidats après #453 (activation OFF)

Deux contre-revues indépendantes readonly ont comparé une génération globale
par document et une table propriétaire→génération. Choix de préparation :
**génération globale immuable, ownership inchangé, résolveurs par famille**.
La table par compte réduirait la première copie mais imposerait des caches DB
par emplacement et une résolution sûre pendant login provisoire, switch et
effacement ; la barrière sur les anciennes DB resterait globale. Le choix
global conserve les singletons actuels et exige en contrepartie un inventaire
raw de tous les propriétaires, y compris absents des sessions connues. Aucun
nettoyage global ni copie de credentials n'est autorisé par cette décision.

Contrat retenu et implémenté dans le lot candidat ci-dessous :

1. Résolveurs distincts historique (quatre slots exacts), autorité crypto
   (sel/check/version), assets, et auth/réglages restant à leur emplacement
   actuel. Ne pas changer universellement `documentStorageKey`, utilisé aussi
   pour api-keys/tokens/consentements. Aligner aussi les lectures d'historique
   via `scoped` et les writes via `physicalKey`, pas uniquement les writers.
2. Descripteur strict, génération opaque bornée ; noms physiques calculés par
   le code, pas chemins reçus du registre. Deux nouveaux noms de DB avec lignes
   inchangées ; témoins monotones v2 aux anciens noms avant toute activation.
   L'effacement de tous les témoins par le navigateur reste hors garantie.
3. Génération déclarée absente/corrompue = refus, pas création d'une base vide.
   Pas de lecture isolée couplée à des écritures legacy : initCrypto,
   bootstraps/quarantaines et CRUD doivent tous respecter les emplacements.
   Ne pas déclarer l'App utilisable à partir de lecteurs seuls.
4. Conserver sel/KDF/enveloppes exacts ; même keyring possible pour les tokens
   restés en place, pas de rechiffrement global requis. Inventorier explicitement
   les autorités issues du fallback global et les absences historiques.
   Quarantaines seules, assets seuls ou check absent ne prouvent jamais un
   compte neuf. Provisioning neuf distinct et attesté ; aucun sel inventé pour
   des données existantes. Pas de fallback vers une adresse legacy en isolé.
5. Maintenir login provisoire sans appartenance préalable aux comptes connus,
   commit BYOK et reprise ; ne pas réaffecter implicitement l'historique anonyme
   via `migrateExistingData` en mode isolé. Les credentials ne sont pas dupliqués.

Avant tout writer activable, la reprise devra distinguer **ready(layout)**,
**recoverable(job connu)** et **blocked(reason)**. Recoverable monte un module
froid distinct, sans App/useAuth, avec capacité bornée job/générations/owner/
fence/révision, et primitives raw sans crypto/session globale. Ne pas donner
une admission normale temporaire pour réutiliser `accountService`, qui exige
déjà une session admise. Pas de boucle maintenance→recharge automatique ; après
transition durable terminée seulement, recharge explicite de l'URL exacte.
Effacement engagé/incertain prime ; reçu confirmé repris sans clé ni nouveau
POST. Purger toutes les copies/générations/journaux avant clôture du reçu.

Tests attendus : fixture isolée réelle→runtime/KDF→lecture, écriture, fichiers,
projets et capture, zéro write aux anciens slots workspace ; A→B→A, login
provisoire, logout/relogin, BYOK erronée/correcte/quota ; données legacy pièges,
global fallback historique, quarantaines/assets seuls, propriétaires orphelins,
anonymes ; base déclarée absente, contrôle perdu avec témoin v2, upgrade tardif,
copie partielle ; reprise/purge sans crypto et URL OAuth conservée. La copie
physique journalisée, son préflight cumulatif et les writers d'import exacts
suivront ce contrat testé ; aucun état isolé n'est émis par #453.

#### Implémentation candidate du 5 septembre

`activation.ts` conserve une constante de release **false**, sans override URL,
localStorage ou serveur. Le parser comprend le descripteur version 2
`isolated-v1` (UUID canonique, inventaire dense strict, révision positive), mais
la politique réelle le refuse avant de rendre l'App admissible. Aucun writer de
registre, migrateur ou upgrade des anciennes DB n'est ajouté. Les noms sont
calculés ; les deux témoins legacy version 2 et les deux DB isolées version 1
doivent exister et avoir les schémas exacts dans la recette candidate.

Historique/quarantaines et sel/check/version utilisent des résolveurs dédiés.
Tokens, clés API, réglages et consentements restent aux anciennes adresses.
Les CRUD, bootstrap, lectures de sauvegarde et suppressions ciblent les mêmes
familles. Une DB isolée déclarée disparue n'est jamais recréée, même après
fermeture de sa connexion en cache par versionchange. L'ouverture est bornée,
et toute connexion obtenue puis refusée est fermée.

Provisioning neuf strict, interne à une tentative crypto : propriétaire actif
non anonyme et absent de l'inventaire ; zéro clé scoped legacy (même vide ou
sans suffixe `-enc`), zéro slot isolé restant, zéro asset/usage/reçu d'effacement
de ce propriétaire dans les DB legacy **et** isolées. Les erreurs et deadlines
IDB ne valent pas absence. Le writer vérifie lui-même admission, identité du
layout, propriétaire, époque, fence et génération RAM d'effacement ; le caller
ajoute son numéro de tentative. La preuve readonly est consommée immédiatement
par l'unique écriture du sel après une dernière vérification synchrone.
Un effacement commencé après la dernière transaction, même déjà libéré,
invalide la preuve. Une interruption après l'écriture conserve le sel pour le
retry ; elle n'invente pas un check historique absent.

Un sel isolé existant est validé strictement puis réutilisé, sans fallback
global de sel/check/version. Un check historiquement absent reste non vérifié :
pas de faux self-test positif autorisant le nettoyage d'un token illisible.
Le compteur d'essai provisoire n'est adopté qu'après crypto. Un refus avant
bootstrap ne déclenche plus Google logout ; le boot isolé ne nettoie pas les
rapports globaux et ne réaffecte pas les données anonymes via la migration
legacy. La politique de rollback des finaliseurs après bootstrap reste celle
de l'auth existante ; ce lot ne crée pas une transaction multi-stockages OAuth.

Tests : 51 scénarios du runtime candidat, vraie admission/parser/contrôleur de
verrou/KDF/useAuth/CRUD/capture, avec seulement la politique finale activée en
test (API Web Locks simulée, IndexedDB fake). Les documents de test sont arrêtés
avant resetModules/teardown. Recettes positives Google/email/BYOK, compteur
provisoire, A→B→A, logout/relogin, reload, quarantaine avec clé erronée puis
correcte, fichier/projet/document et archive relue ; recettes négatives
pré-admission/layout étranger/owner étranger, assets orphelins, marqueurs
partiels, refus/quota, ouverture manquante, transaction readonly réellement
mise en file, changement de session/fence, perte du document, deadline et
effacement. Le test de politique réelle refuse la même fixture valide ; les
tests de frontière existants vérifient le non-chargement privé.

Deux contre-revues indépendantes readonly ont levé leurs objections : coercition
UUID, fuite de connexion, anciennes clés Google et rapports, garde RAM
d'effacement, assertion intrinsèque du writer et fiabilité du teardown de
test. GO limité à la verticale inactive. Ce ne sont ni une recette navigateur
isolée ni une validation APK installé.

La purge de la **génération active** couvre désormais aussi ses slots histoire
et crypto ; A/B et recréation d'un owner jamais inventorié sont testés. Cela ne
valide pas l'effacement de toutes les copies. Un owner inventorié puis supprimé
reste interdit de reprovisioning sans attestation durable de purge complète.
Cette attestation, l'inventaire de toutes les générations retenues, la reprise
froide sans crypto/session, le migrateur journalisé et l'import exact restent
obligatoires avant activation. W06 n'est pas terminé.

Repli : revert du lot par PR/CI/Pages si le login legacy ou le stockage existant
régresse. Aucune migration n'ayant été émise, aucun rollback de données n'est
nécessaire. Ne jamais activer isolated pour contourner une erreur. La CI Android
et une réponse HTTP ne prouvent ni mise à jour installée ni taux d'erreur terrain.

#### Livraison A3b.2

PR #454 fusionnée à 18:58:51 UTC : head
`6413e307f8d4240f1cd613da549744ceacf62d61`, main
`9981e5fe290711eb1f9b114cca8ef50afac17240`. CI PR `33985479466` et main
`33985705847` réussies. Pages production
`9dd0152d-b0ad-42d7-88e6-4bb3a2fea755` et tryarty.com servent à 19:01:34 UTC
le même `index-pT3N8hdK.js`, SHA-256
`cb9afe4cf5ed91acaf84f5fe7e03cded2de29c42bdc33f287b7e52f0dffcd71b`.
Connexion de production ouverte en navigateur sur origine vierge après
admission froide ; aucun compte réel utilisé. L'activation isolée reste OFF.
`npm run verify` final : 257 fichiers / 2 866 tests verts + 1 ignoré, tous
contrôles réussis. Preuves et limites de recette détaillées dans le CDC.
Distribution Android `33985705852` réussie (signature et Firebase confirmés),
sans recette sur APK installé. Seconde sonde publique à 19:04:51 UTC : même
asset/empreinte et HTTP 200 ; pas de mesure continue de performances.

### A3b.3 — décision : migrateur raw à reprise froide (candidat OFF)

Contexte : les lecteurs isolés #454 savent ouvrir un descripteur v2, mais un
changement d'adresse ne suffit pas à conserver les autorités crypto, ni à
exclure un ancien APK. Les deux contre-revues pré-code ont imposé une exclusion
positive de l'admission privée, des références durables aux copies et une
revalidation après les barrières irréversibles.

Options écartées : migration dans useAuth (imports privés avant récupération),
réécriture JSON filtrant les lignes (pertes d'orphelins/champs/ciphertexts),
recopie sous nouveau sel (perte d'autorité), job UUID indépendant du descripteur
(copie introuvable à purger après commit), rollback vers DB v1 après v2
(impossible sans supprimer/recréer des données), exclusion générale du préfixe
workspace dans la signature LS (changements silencieux).

Décision implémentée :

1. `claimMaintenance` est irréversible pour le document et refusé en checking
   ou ready. Le migrateur capture le vrai singleton et la politique interne
   OFF ; aucune garde caller vide n'accorde une mutation. Une tentative est
   sérialisée, retirée après échec, et son délai de 120 s sans progrès est
   réarmé aux checkpoints. Les opens/transactions tardifs ferment ou avortent.
2. Le record contrôle unique v3 porte génération/phase/révision. Un header
   `reserved` est durable avant création/copie privée de la jobDB. Les créations
   contrôle/identité initiales sont atomiques dans leur upgrade respectif.
   Le nom `arty-workspace-${generation}-migration` reste calculable depuis v2.
3. Le plan contient owners, sept slots raw source, versions initiales,
   empreintes/counts et SHA-256 de toutes les paires LS initiales. Les valeurs
   auth/settings ne sont jamais journalisées. Les noms connus de ces familles
   et les sessions validées découvrent les owners sans les réattribuer.
   `a`, `a-b`, `anon`, `null`, Unicode et ponctuation restent opaques ; le
   propriétaire files `arty-anon` est ambigu et refusé. Key/owner incohérents,
   reçus d'effacement même falsy et fences incohérentes refusent.
4. Chaque store est scanné par curseur complet, pages de 32 lignes / seuil
   4 Mio de représentation, sans plafond global d'archive. Une ligne est
   bornée à 32 Mio de représentation et profondeur 64. Le dernier élément peut
   dépasser le seuil de page ; ce n'est pas une promesse de pic mémoire natif.
   Encodage tagué UTF-16/undefined/-0 déterministe, ordre de code units indépendant
   de locale, hash chaîne par ligne indépendant des pages. Date/Map/Set/valeurs
   typées/cycles/accessors sont refusés, jamais convertis silencieusement.
5. Pour chaque owner, le sel propre valide ou global effectif est repris
   textuellement. Vide/invalide/absent sans global valide refuse. Version suit
   le fallback nullish historique ; check reste strictement propre, absent
   reste non vérifié. Tous les slots d'origine restent intacts.
6. LS est réellement copié avant les barrières pour détecter son quota propre.
   Source attendue = signature initiale + paires cibles exactes de ce job,
   initialement absentes. Une cible altérée ou un credential/clé inconnue
   ajouté/supprimé interdit le commit. Un quota peut laisser une copie partielle
   et le header reserved : reprise explicite possible, pas de suppression.
7. Les sources legacy deviennent v2 sans modifier leur contenu. Puis copie
   raw dans le journal et dans les DB isolées v1, sans overwrite divergent.
   Phases reserved → inventoried → barrier → copied → verified. Reprise relit
   versions et octets réels, ne fait pas confiance aux seuls checkpoints.
   Job absent après inventaire attesté ou identité étrangère : refus.
8. Le remplacement final v3 → v2 lit/compare/put dans la même transaction du
   contrôle. Dernier contrôle synchrone LS au put. Aucun protocole IDB ne peut
   rendre ce put atomique avec LS écrit par un ancien client non coopérant ;
   la source reste conservée et l'activation exige les limites de coexistence.
   Si le commit a réussi avant observation d'un timeout, l'acteur reconnaît
   uniquement son UUID avec le vrai lecteur froid et l'identité journal ; il
   propose une recharge de fin, sans seconde copie. L'App ne s'ouvre que dans
   un nouveau document normalement admis.

Conséquences / actions restantes : la jobDB contient des copies privées raw
(dont histoire plaintext si déjà telle en legacy), elle doit faire partie de
la purge et des reçus d'effacement avant activation. Ni effacement multigénération,
ni IMAP Keystore, ni rollback prébarrière, ni résolution de source divergente
ne sont implémentés ici. Les vieux APK peuvent encore agir côté serveur ; pas
de POST ni révocation dans ce module froid. Recette mobile volumineuse/lente et
pics mémoire restent à mesurer ; un délai sans progrès n'est pas un SLA.

Repli du **candidat OFF** : revert Git via PR/CI/Pages en cas de régression du
login/admission legacy. Aucune migration réelle n'est lancée. Si un environnement
de test a déjà relevé une DB à v2, conserver données/journal et reprendre avec
une version compatible ; ne pas simuler un downgrade ni supprimer les copies.

#### Livraison A3b.3

PR #455 fusionnée, head `fe0245f80e53f59c4848a0f285ae2796e0b7fb6f`, main
`4ae048fbab81396ba1315a96eb3314396a1246b3`. CI PR/main vertes, Pages production
`a47c4c39-7a99-45c6-a683-6900453213b7` publiée. Empreinte/sondes et recette
navigateur dans le CDC. Aucun job réel lancé : politique OFF inchangée.

#### Pré-revues A3b.4 : effacement froid, aucune implémentation à ce stade

Deux relecteurs indépendants recommandent d'abord la verticale d'une génération
v2 déjà commise, avec reçu serveur confirmé durable ou intention locale explicite :
migration synthétique A/B → nouveau document froid → purge exacte A dans legacy,
génération, job (stores ET plan.localSource), auth/settings/drafts et natif →
relecture B intact. Aucun POST, token, crypto ou App dans le worker froid.

Objections retenues pour la suite :

- Prefixes legacy `a-` et drafts `a:` ne prouvent pas l'attribution (a-b/a:b).
  Parseurs purs communs, noms opaques exacts, ambiguïté refusée ; pas de purge
  générale de rapports anonymes lors de l'effacement d'un autre owner.
- Brouillons `arty-composer-draft:<owner>:home|conversation:<id>` à inclure
  dans l'effacement ET les indices crypto de migration. Draft-only + sel global
  sans session reste un cas à fermer avant activation du migrateur OFF #455.
- Ne pas interpréter réponse perdue/500/401 comme « non envoyé » ou effacement
  confirmé. États not-sent / uncertain / confirmed / local-only-explicit ; froid
  ne repost jamais. L'actuel releaseFailedProjectErasure peut perdre cette
  incertitude et demande un pont intention/serveur séparé.
- V3 interrompu doit être supersédé durablement AVANT purge : ne pas reprendre
  un ancien plan après suppression A. Plan expurgé/reprise B seulement si état
  source encore attestable ; sinon garder copies B et état bloqué, sans rebaseline.
- Purge IMAP owner-explicite avec vrai commit natif, pas preuve par liste vide,
  pas suppression de l'alias Keystore partagé. Échec/plugin absent conserve reçu.
- Purge complète ne vaut pas autorisation de nouveau sel. Garder A interdit de
  reprovisionnement tant que le reçu durable borné/consommable n'est pas livré ;
  ne pas retirer simplement A de requiredOwners pour contourner la protection.

Ces constats ne sont pas des modifications déjà livrées ni un GO d'activation.

#### Décision/livraison A3b.4 après ces pré-revues

Le candidat OFF est désormais livré par #456 ; détails de preuve et empreinte
production dans `arty-workspace-cdc.md`. Le terme historique serverConfirmed
est limité à une autorité de nettoyage local déjà engagé, pas une preuve HTTP
(BYOK/demo pouvaient le poser sans POST). Une génération v2 cohérente et un seul
reçu strict permettent la réservation v4, l'expurgation exacte A de legacy,
active et job (dont plan), puis v2 prêt dans un nouveau document. Les preuves B
restent distinctes par copie ; settings/auth/drafts sont attribués sans couper
un owner opaque au premier séparateur. Rapports non attribués préservés.

`requiredOwners ∪ {A}` reste conservé : nettoyage du contenu déclaré ne prouve
ni purge des métadonnées d'identité ni autorisation de créer un nouveau sel.
Le clear natif protocole1 laisse A bloqué dans le processus même après succès.
Les tests JVM/concurrence du kernel et de branchement source ne remplacent pas
une recette réelle multi-instance SharedPreferences/Keystore sur APK installé.

Contre-revues GO limité OFF après correction des collisions report-conversations,
draft a:conversation:home et d'un snapshot LS final pouvant adopter une écriture
tardive. Verify final 2 959 tests verts + 1 ignoré et tests JVM verts.

Prochain périmètre avant activation : réparer de façon durable et attestée le
fence LS/IDB désaccordé, actuellement refusé sans mutation ; superséder une
migration v3 avant toute purge ; conserver l'incertitude d'une requête serveur
perdue ; traiter métadonnées/recréation et la recette native intégrée. Ne pas
tolérer un fence incohérent à l'ouverture de B, rebaseliner un plan divergent,
reposter en froid ou retirer simplement A de requiredOwners.

#### A3b.5a — reçu serveur versionné avant réparation froide v5

Contexte : l'ancien client relâchait le dernier marker après erreur HTTP. D1
pouvait pourtant avoir supprimé les sessions email et perdu sa réponse. Garder
un booléen « incertain » sans preuve consultable n'aurait pas permis la reprise.

Décision : nouvelle route distincte, intention locale avant POST, état incertain
durable avant transport. Secret aléatoire 256 bits ; hash du sujet liant ce
secret au kind Google/email-trial et à l'email capturé. POST vérifie le sujet
authentifié avant mutation ; GET secret/opId sans auth fait seulement SELECT.
Le batch D1 réserve un ticket unique, conditionne chaque DELETE par ce ticket,
termine le reçu et lit son résultat atomiquement. Tombstone opaque permanent,
sans email ni secret brut : sa suppression permettrait un rejeu destructeur.

Alternatives rejetées : version dans le body de `/delete` (ignorée par ancien
serveur), INSERT OR IGNORE suivi de DELETE inconditionnels (rejeu), TTL sans
tombstone (rejeu après expiration), 401 assimilé à refus certain, GET missing
assimilé à never-sent, POST automatique au reload. La documentation actuelle
[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
atteste le rollback de la séquence ; le test workerd avec trigger l'exerce.
Types Workers 5.20260905.1 consultés sans modifier les dépendances du dépôt.

Conséquences : `unknown` reste inconnu ; il n'y a pas de retry serveur universel
dans ce lot. Reprise incertaine GET-only dans l'app courante ; succès validé
stocké atomiquement sous le format historique exact de nettoyage local. Aucune
canonicalisation de champs inconnus par le parser froid. BYOK/démo et effacement
appareil explicite restent locaux. Le dernier secret est conservé tant que le
nettoyage local explicite n'est pas terminé ou la preuve distante pas durable.
L'UI dit que terminer cet effacement appareil abandonne la consultation distante.

Contre-revues : deux GO limités après correction du double verrou BYOK/démo et
du texte assimilant l'ancien `true` à une preuve serveur. Preuves nouvelles :
rollback SQL réel, rejeu après recréation, vrai client/D1 avec réponse perdue et
token révoqué, reprises/switch concurrents et reçus invalides. Les recettes
fichiers/natif restent simulées ; aucun compte de production effacé pour tester.

Actions suivantes : intégrer GET-only dans l'admission froide isolée sans
import privé ; réparer fences via un format v5/proof-domain explicite sans
rebaseliner v4 ; puis poursuivre les autres gates A3b.4. Activation OFF inchangée.
Le repli doit conserver le journal et les tombstones et ne jamais réintroduire
un POST legacy implicite. Détails et reçus de livraison dans le CDC.

##### Préparation du lot froid suivant — décision de travail, non implémentée

Les contre-revues préparatoires ont retenu ces bornes pour éviter de réinventer
la preuve au prochain lot. Elles ne valent pas validation du futur code.

- Le crash réel à reproduire commence en v2 : `purgeProjectsForAccount` écrit
  le fence LS avant `tx.done`, puis l'IDB peut abort. L'ancien v4 exige leur
  égalité et son hash protège les deux emplacements : le relâcher rétroactivement
  casserait la preuve. Un v4 cohérent garde son algorithme ; un v4 divergent
  reste bloqué, jamais converti en v5 par une nouvelle baseline B.
- Un nouveau v5 doit réserver durablement owner/opId/nonce/génération, valeurs
  brutes initiales LS et meta active (absence distincte de "initial"), un UUID
  cible unique T et les preuves B avant toute réparation. Son domaine de preuve
  exclut seulement ces deux emplacements, attestés séparément. Les fences des
  copies legacy et journal demeurent intégralement protégés par leurs hashes.
- Ordre fixe IDB active puis LS : seules les paires `(L0,D0)`, `(L0,T)` et
  `(T,T)` sont des états de reprise. Pas de produit cartésien des valeurs, pas
  de nouvelle cible à chaque tentative. Checkpoint "fence réparé" durable avant
  toute purge A ; après ce checkpoint, seule la paire T/T reste admissible.
  Valeurs présentes null/false/0/chaîne vide invalides, non assimilées à absence.
- Le pont de reçu froid doit rester GET-only, sans App/OAuth/session/crypto
  privés, et prendre le même verrou document irréversible. Une seule intention
  strictement reconnue ; résultat lié à opId/capability/subject puis confirmation
  IDB durable de cette exacte opération. Missing/invalide/401/503 reste incertain.
  Réparer un fence ne confirme jamais le distant ni n'autorise un nouveau sel.
- Recette verticale requise : vraie migration A/B et vrai effacement projet
  interrompu après LS mais avant commit IDB (attester l'abort), nouveau document,
  reprise puis nouveau document B capable de déchiffrer historique/fichier/projet
  ET de créer/modifier un projet. Vérifier coupures après réservation, IDB, LS,
  checkpoint et commit final ; quota LS, perte de document, mutation B/legacy/job,
  multiple reçu et remplacement nonce. Aucun POST destructeur à froid.

Les autres gates restent indépendants : migration v3 supersédée avant purge,
métadonnées et recréation, effacement natif intégré, restauration/synchronisation.
Ne pas transformer cette préparation en un nouveau lot de parsers seuls présenté
comme une reprise utilisable ; livrer le chemin et sa recette ensemble.

#### A3b.5b — pont froid de reçu et réparation v5 (6 septembre 2026)

Statut : livré #458, activation isolée toujours OFF ; reçus dans le CDC.
Décideurs : agent principal et deux contre-revues indépendantes en lecture seule.

Contexte : l'abort réel de `purgeProjectsForAccount` après LS laisse un fence
divergent. Un reçu distant incertain ne doit pas ouvrir App/OAuth pour reprendre,
et un consentement local ne doit pas se transférer à une demande remplacée.

Décision : admission v2 reconnaissant la grammaire exacte du journal courant,
liée au snapshot génération/reçu. L'acteur reste froid, verrouillé et GET-only.
La réponse distante bornée doit être validée puis son record complet remplacé
par CAS avant le nettoyage. Aucun CAS cross-DB atomique n'est revendiqué :
contrôle document et comparaisons avant/après encadrent les transactions.

V5 est réservé depuis v2 uniquement pour un fence désaccordé ou une autorité
locale étendue. Il conserve L0/D0/T et la preuve B initiale. IDB commit avant
LS, trois couples admissibles puis checkpoint `fenced` avant purge. Domaines
v5 explicites uniquement pour LS et meta active ; legacy/journal restent protégés.
V4 cohérent conserve strictement son domaine, divergent reste refusé.

Choix locaux : intention jamais envoyée annulable par CAS sans purge, avec
fences vérifiés dans la même transaction meta et LS juste avant suppression.
Incertain = GET ou consentement local séparé ; ancien inconnu = support/local.
L'autorité locale complète, secret distant compris, demeure dans v5 jusqu'au
commit final : une panne native ne perd pas le dernier moyen de vérification.
L'UI annonce que terminer le local abandonne cette consultation, pas que le
serveur a confirmé. Le même acteur ne reconnaît que ses propres transitions
adjacentes, y compris les résultats perdus ; annulation ≠ nettoyage terminé.

Alternatives rejetées : ouvrir App à froid, renvoyer POST, convertir local-only
en `serverConfirmed:true`, relâcher les hashes v4, rebaseliner après divergence,
normaliser une nouvelle valeur de fence, appliquer un ancien consentement à B.

Conséquences et preuves : vraie transaction projet abortée après LS, nouveau
document froid, puis B déchiffre historique/fichier/projet et crée/modifie un
projet avec révision relue. Autre verticale : vrai client/IDB/D1 workerd, réponse
perdue après révocation réelle du token puis GET froid et B lit/écrit. Fixtures
v4 indépendantes, cinq coupures v5, quotas LS, remplacements de reçu/contrôle,
perte de document, altérations B/fences/nonce et confirmation UI couverts.
Ce sont des recettes automatisées (Web Locks, IDB et natif simulés), pas une
recette sur navigateur ou APK installé. Aucun compte de production effacé.

Actions restantes : supersession v3 avant purge, métadonnées/recréation sûre,
recette native intégrée, publication/restauration puis synchronisation. Aucun
de ces gates n'est levé par le seul succès de cette réparation.

##### Reprise préparée après #458 — pistes à contre-revoir avant code

Deux revues préparatoires indépendantes distinguent deux vrais parcours encore
absents. Aucun nouveau writer ni droit de recréation n'est implémenté ici.

1. Priorité au trajet nominal isolé : `accountService.performLocalErasure`
   utilise encore l'ancien nettoyeur actif, puis retire le reçu. Il faut relier
   l'autorité durable du vrai bouton au nouveau document froid et au nettoyeur
   multi-copies. Sans ce raccord, une suppression sans crash contournerait la
   future preuve. `clearAllForActiveUser` utilise encore un préfixe a-/a-b et
   ne couvre pas le namespace des brouillons. Ces limites ne doivent pas être
   transposées au contrôle de reprovisionnement.
2. Recréation = nouvel espace LOCAL, pas effacement confirmé des autres appareils.
   Garder requiredOwners ; droit versionné lié owner/génération/opération après
   purge complète, sans ancien secret remote. Allocation d'un seul sel puis
   finalisation check/accès durable, consommable seulement à la fin. Une coupure
   après le sel LS n'est pas traitée comme fresh dans `crypto.ts` aujourd'hui.
   Reprendre la même allocation, jamais emprunter le sel global ni permettre
   une seconde allocation après disparition du sel consommé. Scans d'absence
   exacts dans toutes les copies/plan/settings/drafts ; B reste lisible ET writable.
   Le natif terminal ne se rouvre pas au simple reload : protocole lié à un reçu,
   invalidation des anciens tickets, test APK intégré, aucun reset JS générique
   ni suppression de l'alias Keystore partagé.
3. V3 : aucun client à jour ne peut normalement ouvrir App et effacer pendant
   migration. Le cas réel est un ancien bundle avant barrières, une action
   distante sans témoin local, ou une nouvelle action locale sur l'écran froid.
   Le dernier cas doit livrer UI+autorité+supersession, pas seulement un parser.
   Une première recette bornée peut viser copied/verified avec journal complet
   et destination attestables ; CAS de supersession AVANT purge. Un journal
   partiel et une source divergente ne permettent pas de déduire B depuis les
   hashes globaux A+B : rester explicitement bloqué, sans rebaseline. Le plan
   redacted n'est pas une entrée du migrateur v3. Un choix après claimMaintenance
   exige un coordinateur froid unique ou un nouveau document, pas un second lock.

Correction de la vieille liste de risques : draft-only + sel global est déjà
traité par observeLocalOwnerHints/localTargets et le test opaque a:b sans session
dans workspaceMigration.test.ts. Ne pas le rouvrir comme défaut non résolu.
La prochaine implémentation doit avoir ses propres deux contre-revues et une
verticale depuis l'action utilisateur jusqu'aux nouvelles écritures relues,
y compris A migré, A post-cutover, voisins a-b/a:b et second cycle d'effacement.

#### A3b.6 — effacement nominal froid et droit de nouvel espace local (6 septembre 2026)

Statut : implémenté et validé localement, livraison à consigner dans le CDC.
Activation isolée OFF, aucune migration réelle ni suppression de production.
Deux contre-revues indépendantes avant code et sur le diff final : GO limité.

Contexte : le bouton isolé devait rejoindre le nettoyeur multi-copies même sans
crash. La purge seule ne permettait pas de recréer un espace ; le clear natif
restait terminal. Une reconnexion partiellement écrite ne doit ni réallouer un
sel ni rendre les anciens callbacks valides dans le nouvel espace.

Décision :

- Le vrai bouton conserve l'autorité durable puis retire définitivement le
  document privé (`lost` avant les observateurs/abort), sans libérer son Web
  Lock. L'UI demande un reload même si elle vient d'être démontée. Si le reload
  tarde, ni App, ni login, ni acteur froid ne peut se réactiver dans ce document.
- Tout nouvel effacement depuis ready v2/v7 réserve v6, avec cible de fence,
  preuves B, identité de reset et ancienne incarnation consommée éventuelle.
  Réparation et purge suivent le domaine v5. Les reprises historiques v4/v5
  gardent leur domaine et leur sortie v2, sans droit de nouveau sel ajouté.
- Le dernier CAS remplace l'autorité par un ready v7 unique portant le droit
  `available` de A et les droits B inchangés. `requiredOwners` conserve A. Aucun
  secret distant ne passe dans ce droit. Les UUID historiques d'opération
  restent opaques, contrairement aux nouveaux resetId stricts.
- Seul le login explicite peut passer available → provisioning → consumed.
  Une allocation durable de tout le bundle sel/check/version précède toute
  écriture des trois marqueurs LS. Chaque reprise réutilise ce bundle, vérifie
  la clé et les copies/plan/settings/drafts ; pas de nouveau sel si un marqueur
  consommé a disparu. Bootstrap/switch ne consomment jamais un droit en attente.
- Le CAS est étroit et capture intrinsèquement owner/epoch/layout/fence, même
  avec un appelant faible. Snapshots clonés, preuve LS juste avant put et après
  commit. Le contexte crypto puis le grant/session sont publiés après consumed.
  Un échec ultérieur du grant ne détruit pas le bundle matérialisé. Le hash
  email est différé jusqu'à cette transaction de login et restauré uniquement
  si l'écriture appartient encore à cette tentative.
- Android protocole2 : retrait du compte et reçu fermé liés au resetId dans
  le même SharedPreferences commit. La réouverture exige ce reçu et l'absence
  brute de la clé compte. Tout appel ordinaire porte l'incarnation attendue.
  Après réouverture, un ancien clear/reopen/ticket ne peut pas effacer ou écrire
  le nouvel A. L'alias Keystore partagé n'est jamais supprimé ; création de clé,
  chiffrement/écriture et fence partagent le moniteur. Cache JS lié à l'époque.

Alternatives rejetées : retirer A de requiredOwners, autoriser un reset via
booléen public d'initCrypto, écrire le sel avant son allocation durable, effacer
les marqueurs en rollback de login, ajouter un second record de contrôle,
réouvrir le natif au simple reload, traiter `loadAccounts()==[]` comme preuve,
réutiliser un ancien clear après une nouvelle écriture, rendre le lock à chaud.

Objections corrigées : preuves LS périmées à l'intérieur du CAS ; transition
trop générique ; ABA de session avec appelant faible ; collision a/a-b dans les
indices crypto ; getters de parseur ; budget de révision ; grammaire UUID
historique ; course de première création Keystore ; scope natif injecté par
spread ; fenêtre de reconnexion si reload retardé. Les droits B pending sont
comparés intacts lors de l'effacement, pas encore consommés par cette recette.

Preuves et limites : `npm run verify` vert (268 suites, 3 087 tests + 1 ignoré),
60 tests ciblés lock/Gate/cycle, build APK debug/test et tests JVM verts. Vrai
bouton, useAuth, KDF, lecture/écriture historique/fichier/projet, deux cycles A
migré ou post-cutover et B writable ; documents et IndexedDB simulés en Vitest,
navigation JSDOM non implémentée, natif simulé dans cette verticale web.

Recette native distincte réellement exécutée sur AVD API35 neuf
`ArtyResetRecipe_API35_20260906` : quatre méthodes d'instrumentation réussies,
après réinstallation des seuls APK synthétiques. La première phase affirme
que l'alias est absent avant huit chiffrements concurrents ; phases 2/3
affirment un PID différent. SharedPreferences et AndroidKeyStore réels,
deux cycles, B/a:b déchiffrables, late tickets/rejeux refusés, commit échoué
avant/après écriture et reçus malformés. Pas de parcours UI APK ni réseau IMAP.

Reproduction sur une installation de test vierge, jamais un téléphone client :
assembler `:app:assembleDebug :app:assembleDebugAndroidTest`, installer les
deux APK sur l'émulateur explicitement identifié, puis appeler
`am instrument -w -r -e class com.arty.app.MailScopeStorageInstrumentedTest#METHOD
com.arty.app.test/androidx.test.runner.AndroidJUnitRunner` avec METHOD =
phaseOne, phaseTwo, phaseThree, failedCommitsAndMalformedReceiptRemainClosed.
Forcer l'arrêt de com.arty.app entre phases ; les trois phases ordonnées sont
ignorées dans un batch non sélectionné, qui ne saurait prouver un redémarrage.

Actions avant activation : supersession v3 avant purge, restauration/sync,
recette UI Android et limites anciens clients. Préexistant signalé par la
contre-revue : logout purge encore les brouillons par préfixe `${owner}:` dans
composerDrafts.ts ; le voisin a:b demande correction/recette dédiée. Les switches
par service de cette verticale ne prouvent pas sa conservation au vrai logout.
Protection coopérative, pas atomicité inter-DB/LS ni défense contre un client
ancien/malveillant réécrivant arbitrairement le stockage. Repli du candidat OFF :
revert via PR/CI/Pages, conserver reçus/tombstones ; ne pas downgrader ou purger
un stockage v6/v7 pour revenir à une version ancienne.
