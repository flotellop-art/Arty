# Lecture locale des SMS Android

Mission du 13 septembre 2026 : consultation et recherche des SMS dans Arty,
avec accord à l’ouverture, sans transférer leur contenu hors du téléphone.
Branche `codex/sms-consent-20260913`, base `8ec45b72` (main 1.0.104).
Le checkout initial TikTok et ses fichiers non validés ont été préservés.

## Comportement

- Après connexion et fermeture du profil initial, une divulgation native propose
  « Autoriser pour cette session » ou « Continuer sans SMS ». Le bouton positif
  précède la demande système Android. Aucune lecture lors de cette demande.
- Accord uniquement en mémoire du processus, lié à un ticket neuf par compte
  et époque de session. Redemandé après arrêt complet/changement de session ;
  pas à chaque retour d’une autre application. Refus sans boucle de relance.
- Connexions → SMS : consulter, autoriser à nouveau ou retirer l’accord.
- L’écran natif affiche les SMS reçus des sept derniers jours, avec recherche
  textuelle/numéro, 50 résultats et 4 000 caractères par message au maximum.
  RCS, MMS, envoi, suppression et modification du statut lu sont hors périmètre.
- Le retrait stoppe l’accès dans Arty. Il ne prétend pas retirer la permission
  système Android, gérable séparément dans les paramètres de l’application.

## Frontière locale

`LocalSmsPlugin` ne propose **aucune méthode retournant un message**. Seuls
statut de permission/accord et ticket opaque traversent Capacitor. `LocalSmsActivity`
interroge le fournisseur SMS Android hors du thread UI, avec sélection paramétrée,
annulation et délai de cinq secondes. Les résultats restent dans les vues natives.
Pas de WebView, outil LLM, brouillon, réseau, journal de contenu, stockage web,
préférences, copie durable, export ou synchronisation dans ce lecteur.

Les messages sont du texte brut non cliquable. Les captures système sont bloquées
par `FLAG_SECURE`. Sauvegarde de la hiérarchie des vues et autofill désactivés ;
pas de restauration des messages/recherche. Passage au fond : annulation et retrait
des vues. Changement de compte/retrait : fermeture du lecteur. Un retour tardif
du dialogue Android ne peut pas autoriser une autre session.

Le consentement n’étant jamais persisté, aucune ancienne autorisation Arty ne peut
réapparaître après effacement ou nouvelle installation. La permission OS peut
rester accordée, mais ne suffit jamais sans nouvel accord de session.

## Compilation et distribution

La compilation **par défaut / Play** conserve l’absence de permission SMS, de
déclaration d’activité SMS et d’enregistrement du plugin. Le profil direct est
activé explicitement par `-PartyLocalSms=true` : overlay `src/localSms/AndroidManifest.xml`
avec **READ_SMS seul**. Le workflow Firebase utilise ce profil ; rien n’a été
envoyé à Firebase par cette mission.

```powershell
# Depuis android, avec JAVA_HOME (Java 21) et ANDROID_HOME configurés.
.\gradlew.bat :app:lintDebug :app:testDebugUnitTest :app:assembleDebug -PartyLocalSms=true --no-daemon
```

Le garde de manifeste normal interdit toujours les SMS. Le mode `--local-sms`
exige READ_SMS et continue de rejeter SEND_SMS/RECEIVE_SMS et tout ajout imprévu.
CI contrôle successivement les deux APK. Le workflow Play garde le contrôle normal.

READ_SMS est une permission Android fortement restreinte : l’installateur doit
également l’autoriser. Une compilation, un accord ou un APK Firebase ne prouvent
pas le fonctionnement sur tous les téléphones. La recette sur le canal réel reste
nécessaire avant diffusion. Aucun nouveau scope OAuth Google n’est introduit.

## Recette Android isolée

Utiliser uniquement un AVD dédié avec des SMS fictifs. Les tests instrumentés
refusent de lire un téléphone physique et exigent `smsSyntheticFixture=true`.

1. Installer APK et APK de tests sur cet AVD ; injecter avec `adb emu sms send`
   `SMS-LOCAL-FIXTURE-ALPHA` depuis `15550000001` et
   `SMS-LOCAL-FIXTURE-BETA` depuis `15550000002`.
2. Couper Wi-Fi et données mobiles de l’AVD ; lancer
   `LocalSmsActivityInstrumentedTest` et
   `LocalSmsConsentInstrumentedTest#decliningNativeDisclosureLeavesArtyUsableWithoutSms`.
3. Révoquer READ_SMS sur cet AVD, puis exécuter séparément
   `LocalSmsConsentInstrumentedTest#acceptsAndroidPermissionAfterDisclosure`.
   Ce test clique le vrai dialogue système après la divulgation Arty.
4. Vérifier les codes de résultat individuels : `0` = passé, `-4` = ignoré.
   La ligne globale « OK » Android ne suffit pas à prouver l’exécution.

Les tests JS couvrent disponibilité, refus, dialogue unique, callback tardif,
reconnexion au même compte, effacement, carte Connexions et absence d’appel réseau
dans le service de contrôle. Les tests Java couvrent la session et les bornes.
Ces contrôles ne constituent pas une capture réseau complète de l’application.

## État de livraison

Validations acquises sur le candidat 1.0.105 / 106 :

- campagne générale : **5 939 tests réussis, un ignoré, 404 fichiers**, avec deux
  workers et délai de test de 15 secondes ; durée 1 018 secondes sur ce poste.
  Aucune seconde campagne générale lancée ;
- typechecks frontend et Functions, build Vite et synchronisation Capacitor ;
- garde OAuth sans CASA et templates add-on ; worker Office réel en VM isolée ;
- 26 tests ciblés SMS/Connexions ; 53 tests de la chaîne d’identité APK ;
- 20 tests Java, dont 7 nouveaux pour SMS ; lint Android debug et release ;
- compilation APK standard sans READ_SMS puis variante locale avec READ_SMS seul ;
- quatre tests instrumentés réellement exécutés (aucun ignoré dans les recettes
  retenues), AVD Android 15 dédié avec deux SMS fictifs : consultation/recherche,
  retrait, changement de session, refus et acceptation via le vrai dialogue Android.
  Recette finale en mode avion avec Wi-Fi coupé ;
- APK release minifié signé, version/package contrôlés, certificat correspondant
  au fichier assetlinks du checkout. Cela ne vérifie pas la configuration publique
  actuellement servie par le site.

APK local : `android/app/build/outputs/local-sms/Arty-1.0.105-local-sms.apk`.
SHA-256 : `640b43ec3d1553563504e8a7144e1542bfb7254a8b0d561a12818360fe8271af`.
Journaux locaux : `android/app/build/sms-evidence/` (non versionnés).

Les deux contre-revues ont conduit à protéger les API Android 26 sur le minimum
24, fermer le lecteur lors d’une révocation concurrente et rétablir le statut de
la carte après invalidation. Le contrôle de permissions reste dans l’étape build
Firebase pour préserver l’enchaînement vérification d’identité → distribution.

Implémentation et validations locales ; aucune installation sur le téléphone
utilisateur, aucun envoi aux testeurs, aucun déploiement public. Le candidat est
numéroté 1.0.105 / code 106 pour permettre une mise à jour, sans le déclarer diffusé.
Les preuves finales sont résumées dans le compte rendu de cette mission.
