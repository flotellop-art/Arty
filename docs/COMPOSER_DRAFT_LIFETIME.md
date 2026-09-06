# Brouillons : durée de vie et acquittement

6 septembre 2026 — correctif du composeur existant, pas une activation W06.

## Diagnostic et contrat

L'ancien InputBar protégeait la fin d'un chiffrement par un compteur local,
sans annulation au démontage ni validation d'effacement/fence après attente.
Une restauration pouvait également republier un texte devenu obsolète après
une saisie ou un vidage. Le chiffrement global protège déjà owner/epoch/clé ;
il n'est pas modifié pour lui donner les responsabilités du consommateur.

Un défaut distinct d'ordre des effets associait l'ancien texte à la nouvelle
clé lorsque la **même instance** d'InputBar était réutilisée. Les clés React
actuelles d'App remontent normalement l'interface par propriétaire et fil :
ce cas est un contrat du composant reproduit, pas une fuite App attestée.

`useComposerDraft` lie texte, révision et incarnation à leur clé/owner/epoch.
Chiffrement et déchiffrement capturent le scope avant attente, valident le
fence IDB en lecture seule après crypto, puis revérifient immédiatement avant
publication. Les opérations ordinaires sont annulées au démontage. Un clear
explicite est différent d'un champ froid vide : le premier retire la copie,
le second ne supprime jamais un ciphertext non encore lu.

La suppression avant disponibilité de clé réutilise les mêmes validations
owner/session connue/document/génération d'effacement/fence LS et IDB. Sa
capacité étroite `captureLocalRemovalScope` expose seulement `assertCurrent`
et `validateReadOnly` ; elle ne vaut pas un `LocalReadScope` de lecture des
projets. La génération crypto est contrôlée même sans clé prête. Un événement
storage-ready peut reprendre l'intention actuelle annulée par l'initialisation,
jamais réautoriser une ancienne identité ou opération d'effacement.

L'acquittement d'envoi dispose d'un ticket distinct : il peut nettoyer Home
après une navigation saine, mais seulement sa révision RAM exacte et le
ciphertext capturé, ou celui publié par sa propre révision. Un nouvel éditeur,
une vraie modification, une préparation de pièce jointe, une action rapide,
un changement de session ou un effacement le révoquent. Un retry I/O ne crée
pas une nouvelle révision RAM. Le nettoyage UI est synchrone avec sa dernière
validation, sans booléen d'autorisation consommé après une autre attente.
Le verrou d'envoi couvre aussi un parent synchrone suivi d'un nettoyage async.

## Vérification et contre-revues

Deux revues indépendantes en lecture seule, angles produit/React et sécurité,
avant implémentation puis à chaque correction. Objections intégrées :
acquittement après navigation, pièce jointe encore en préparation, suppression
avant clé, génération crypto, capacité removal trop large, retry I/O confondu
avec édition, consommation UI après microtask, double-clic pendant nettoyage.

Tests avec vrai InputBar, sessions, Web Crypto, contrôleur de document et IDB
isolé : layouts legacy et candidat isolé (flag activé **dans ce test seulement**).
CAS/fence IDB seul, effacement puis release, logout, A–B–A, retraite/démontage,
restauration puis saisie/vidage, ciphertext remplacé, fil B préexistant, refus
d'envoi, nouveau brouillon/remount, acquittement après navigation, FileReader
suspendu, StrictMode/préfill, génération KDF échouée, reprise après readiness,
microtask de saisie après retrait durable et double-clic sur probe IDB bloqué.
Les voisins `a:b` et `a-b` conservent leurs octets et leur RAM.

Premiers échecs de harnais conservés dans les logs : export i18n absent du
mock, FileList sans `.item`, fixture isolée présentant un ancien ciphertext
sans avoir provisionné sa clé. Ils ont été corrigés sans retirer de garde.
GO finaux readonly produit et sécurité reçus après correction de toutes leurs
objections bloquantes. `npm run verify` final exit 0 : **313 suites / 3952 tests
réussis + 1 sauté**, dont **62 tests** du nouveau fichier de durée de vie.
Typechecks front/back, no-CASA, couverture, build et vrai worker Office isolé
réussis. Couverture 71,74 / 66,65 / 77,39 / 73,59 %. Logs ignorés
`composer-draft-verify-final.log` et `composer-draft-sixth.log` (60 tests avant
les deux dernières recettes de double-clic).

Publication par [PR #476](https://github.com/flotellop-art/Arty/pull/476),
head `086a7f1e20e8165a45258cdb0e7371a888f88b14`, squash main
`1e3aed83acabbc10c9d063474739d5c992b838d8` à 12:37:16 UTC.
CI PR `34033402682` réussie (web 3 min 52 s, Android 3 min 49 s).
Pages main `ddfbc368-9347-4818-9df9-94b0cc24ec9d` réussi à 12:38:25 UTC.
GET anonymes canonical/version immuable à 12:39:20–22 UTC : marqueurs du
correctif, six assets et guide FR/EN/CSS/SW identiques. App servi :
`App-BCuqcO6p.js`, 936254 octets, SHA-256
`1db4bbb0db68c0675049d9818c244559ac222994b55eaec95fe76e3b30218edf`.
Sept sondes GET/OPTIONS du transport API historique également réussies.
CI main `34033648916` réussie (dernière étape web à 12:41:35 UTC).
Android/Firebase `34033648917` réussi à 12:46:36 UTC : identité du candidat
vérifiée à 12:46:23, distribution Firebase à 12:46:30, reçu JSON téléversé à
12:46:31 UTC. Aucun APK ni reçu téléchargé pour ce lot ; preuve de pipeline,
pas d'installation physique ou de recette sur téléphone.

Recette Chrome isolée le 6 septembre à 12:31:20 UTC, 390/1280 px : vrai
InputBar/crypto/runtime, brouillon chiffré relu après reload, A–B–A, acquittement
après démontage et effacement pendant chiffrement. Zéro requête fournisseur,
zéro erreur JS/débordement. Capture mobile inspectée. Fixture locale de composant,
pas le parcours App complet, OAuth ni un APK physique.

## Limites et repli

Aucun format de ciphertext ou clé persistée changé, aucune migration ni
suppression collective. RAM temporaire conservée avant clé ; pas de fallback
en clair. Une panne de stockage peut empêcher la persistance : aucun succès
durable n'est promis sur un simple affichage du texte. Pas de garantie contre
un ancien client natif ne respectant pas le verrou coopératif.

`ISOLATED_WORKSPACE_ENABLED=false` inchangé. Quota durable de préparation,
publication/restauration transactionnelle et synchronisation restent des gates
W06 distincts. Pas de nouvelle capacité OAuth, tarification ou métrique réelle.
Repli par revert Git ciblé puis chaîne habituelle ; aucune remise à zéro des
données. Aucun bump SW requis pour ce changement de modules JS hashés.
