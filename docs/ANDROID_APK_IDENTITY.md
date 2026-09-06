# W09 — identité du candidat APK Firebase

6 septembre 2026. Implémentation et validation locales réussies, publication à confirmer.
Base main `70872fa9acc4960b9f50964d9513587be8d40f83` (#471), branche
`codex/android-artifact-identity`. Aucun changement d'appId, clé de signature,
assetlinks, OAuth, Firebase, permission ou données utilisateur.

## Ce que prouve le reçu

`identity-receipt.json`, schéma `arty-apk-identity-v1`, état **artifact-verified** :

- octets, SHA-256, package compilé, versionCode et versionName du candidat ;
- vérification par les vrais outils Android, signataire unique, empreinte SHA-256
  du **certificat** (ni clé publique ni SourceStamp) ;
- package/version conformes aux déclarations littérales Gradle/Capacitor ;
- certificat conforme à la cible Android et à la relation handle_all_urls du
  fichier assetlinks **du checkout**, avec son chemin et son hash ;
- commit complet, run et tentative déclarés par le workflow de compilation.

Le commit ne découle pas des versions affichées : c'est la provenance du
checkout CI, pas une preuve indépendante de compilation reproductible. Des APK
distincts peuvent conserver versionCode 100/versionName 1.0.99. Le SHA du fichier
et le run/tentative les distinguent ; ils ne mesurent pas une installation.

Pas de preuve du fichier assetlinks effectivement servi, d'association Android
des liens, de consentement OAuth, de droit VIP, de propriété d'une fiche Play ou
d'installation physique. La signature d'un APK Firebase ne prouve pas celle
d'un APK livré par Play App Signing, dont la clé peut différer de la clé d'envoi.
Voir [Android : signature d'application](https://developer.android.com/studio/publish/app-signing).

## Chaîne de livraison et refus

Après `assembleRelease`, `scripts/verify-release-apk.mjs` :

1. Exige le contexte CI main attendu, lit les déclarations sans exécuter le
   TypeScript et refuse les chemins hors workspace/liens symboliques.
2. Crée un **nouveau** dossier `android/app/build/outputs/verified-release`.
   Un dossier/candidat/reçu déjà présent bloque le run, sans l'écraser ni le
   réutiliser. Copie l'APK release dans ce candidat fixe.
3. Hashe le candidat, exécute `apksigner verify --verbose --print-certs` via
   le JAR du SDK et Java configuré, puis `aapt2 dump badging`, sans shell.
   Les outils du SDK stable installé le plus élevé sont résolus par chemins
   absolus ; sa version est conservée. Outil absent, timeout/non-zéro/sortie
   tronquée/inexploitable, signature ambiguë, APK debuggable ou divergence : refus.
4. Vérifie les mêmes octets après les outils et les parents du candidat avant
   l'écriture exclusive du JSON. Les subprocess sont bornés à 30 s / 1 Mio de
   sortie, l'APK à 256 Mio ; aucune sortie brute ou DN du certificat dans les logs.
5. Firebase consomme **ce même candidat**, sans build/sync/signature intermédiaire.
   Seulement après succès de cette étape, l'action upload-artifact déjà épinglée
   publie **le JSON exact**, jamais l'APK, un keystore, un certificat complet,
   google-services.json, la sortie d'un outil ou un dossier avec wildcard.

Ces contrôles ne protègent pas contre un runner ou une action de distribution
compromis ; ils détectent une divergence accidentelle de binaire dans la chaîne
CI existante. Aucun faux reçu positif produit après un gate échoué. Un ancien
dossier bloquant reste sur disque pour diagnostic, mais la chaîne ne le publie pas.

**Validation et distribution sont distinctes.** Le JSON est créé avant Firebase.
Une distribution peut réussir puis le job être annulé/échouer avant publication
du JSON : workflow rouge ou reçu absent ne signifie pas « aucun APK envoyé ».
Vérifier le résultat de l'étape Firebase ; aucune relance compensatoire automatique.
Un reçu GitHub conservé 30 jours n'est pas une archive permanente des releases.

Sources primaires consultées le 6 septembre 2026 :
[apksigner](https://developer.android.com/tools/apksigner),
[AAPT2 dump](https://developer.android.com/tools/aapt2#dump).
Le guide testeur dans `FIREBASE-BETA.md` est corrigé d'après
[Firebase Android](https://firebase.google.com/docs/app-distribution/get-set-up-as-a-tester?platform=android)
: App Tester facultatif via le portail officiel, téléchargement/installation
explicites, pas de promesse Play ni mise à jour automatiquement installée.

## Recette et contre-revues

Deux challenges pré-code readonly (produit/distribution et sécurité/CI) intégrés :
candidat fixe, distinction du reçu et de la distribution, provenance limitée,
source d'assetlinks explicite, refus des signataires ambigus, capture des sorties
sensibles et conservation du succès Firebase même si une étape ultérieure échoue.

51 tests ciblés initiaux : sources et sorties compilées ambiguës/divergentes,
formats SDK 35/37, certificat étranger, multi-signataires, clé publique/SourceStamp,
statut de processus non-zéro avec digest présent, sortie bornée, absence de fuite
des subprocess, candidat altéré, vieux reçu, symlink, même version/hashes distincts,
contexte CI obligatoire et ordre/chemin/default-success du workflow.
Les tests de cycle de vie utilisent des octets/outils **synthétiques**, pas des
APK déclarés signés grâce à un mock.

Recette complémentaire readonly **10:18:02.685 UTC** avec les vrais Java Studio,
apksigner/AAPT2 SDK **37.0.0**, ancien APK local daté du **12 août 2026** : signature
valide, `com.arty.app`, 100 / 1.0.99, 4 042 018 octets, SHA-256
`9c0292ce3a704e1ba5333e9652bbdeb354e9142211712760b32a0f64193e1b44`, certificat
`2656e001a8bcbb6504bbbb7a2b6416e6371d21d0b86713d045f5bca22527a2e0`
conforme au fichier assetlinks. Aucun commit de compilation actuel n'a été
attribué à cet ancien APK, aucun reçu CI émis, aucune installation/signature
nouvelle. Java absent du PATH a été remplacé pour cette inspection par le chemin
explicite du Java déjà installé avec Android Studio, sans installation système.

Logs locaux ignorés : `apk-identity-targeted.log`, `apk-identity-real-tools.log`,
`apk-identity-verify.log`. Revue finale, verify complet et vrai candidat de la
prochaine CI release à consigner après résultats. W06 restore/sync reste OFF ;
guide PWA et validations appareil/Store restent distincts et inachevés.

### Validation finale locale

P2 de la contre-revue produit intégré : assetlinks lu en **Buffer brut**, décodage
UTF-8 fatal avant outils, hash des octets sans réencodage. Cas UTF-8 invalide dans
une valeur JSON inutilisée refusé ; cas valide BOM/CRLF vérifie que l'empreinte
diffère bien de celle du texte décodé. P3 sécurité intégré : garde textuelle de
workflow exigeant les quatre étapes présentes et les lignes file/path exactes.
Cette garde n'est pas un test d'exécution du service GitHub/Firebase.

Deux GO finaux readonly code/tests/docs, sans objection bloquante. Après ces
corrections, **53 tests dédiés**, `npm run verify` complet **exit 0** :
**305 suites, 3 769 réussis + 1 sauté**, couverture 71,60 / 66,44 / 77,27 / 73,44 %.
Typechecks front/back, no-CASA/scopes, build et worker Office réel isolé réussis.
App 930,31 Ko (gzip 286,07), avertissement historique >500 Ko inchangé. Premier
verify avant les deux tests d'octets : 3 767 + 1 ; pas confondu avec le final.
Log ignoré `apk-identity-final-verify.log`.

Inspection readonly du même ancien APK avec le code corrigé, à
**10:22:26.608 UTC**, exit 0, mêmes hash/signataire/version ; log ignoré
`apk-identity-real-tools-final.log`. Le prochain run CI doit encore fournir le
reçu de son propre candidat avant de conclure à la livraison de ce lot.
