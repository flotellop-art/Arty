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

A1 peut être testé et livré sans migration ni UI. A2 doit ajouter inventaire
exhaustif, contrôle de stabilité, journal de restauration, reprise et intégration
de l'effacement. Aucun simple try/finally entre trois stockages ne vaut atomicité.
B ne peut réutiliser la GC locale des 100 tombstones sans protocole ACK/checkpoint.
Un CAS SQL à zéro ligne n'est pas une erreur de transaction : toutes les écritures
dépendantes doivent rester conditionnées à la même réservation/génération.

Recette : tags/digests, code erroné, frames substituées/dupliquées/tronquées,
bornes ±1, UTF-8 invalide, JSON profond, références absentes/historiques/crop,
mutation du caller et annulation. Puis stockage vierge/nouvelle clé locale,
quota/crash à chaque phase, double import, A→B→A/effacement et deux appareils
isolés/offline/divergence/suppression. Aucun test simulé ne vaut une recette
visuelle Office, Android ou multi-appareil réelle.
