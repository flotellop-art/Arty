# Firebase App Distribution — guide bêta test Arty

Distribuer l'APK à tes testeurs bêta sans passer par le Play Store.

---

## 1. Setup initial (une seule fois)

### 1.1 Créer le projet Firebase

1. Va sur https://console.firebase.google.com/
2. **Ajouter un projet** → nom : `arty` (ou celui de ton choix)
3. Désactive Google Analytics (pas nécessaire pour App Distribution)
4. Une fois créé : **Ajouter une appli** → icône Android
5. Remplis :
   - **Nom du package** : `com.arty.app` (doit correspondre exactement à `applicationId` dans `android/app/build.gradle`)
   - **Empreinte SHA-1** : lance la commande ci-dessous pour l'obtenir
     ```bash
     keytool -list -v -keystore /chemin/vers/arty-release.keystore -alias arty
     ```
     Copie la ligne `SHA1: XX:XX:...`
6. Clique **Enregistrer l'appli**
7. **Télécharge `google-services.json`** → place-le dans `android/app/google-services.json`
8. Ignore les étapes "Ajouter le SDK Firebase" (pas besoin pour App Distribution)

### 1.2 Activer App Distribution

1. Dans la console Firebase → menu gauche → **Release et surveillance → App Distribution**
2. Clique **Commencer**
3. Accepte les conditions

### 1.3 Créer un groupe de testeurs (optionnel mais recommandé)

1. Onglet **Testeurs et groupes** → **Ajouter un groupe**
2. Nom : `beta-testers`
3. Ajoute les emails des testeurs
4. Tu peux maintenant passer `FIREBASE_GROUPS=beta-testers` au script de déploiement

### 1.4 Installer firebase-tools

```bash
npm install -g firebase-tools
firebase login
```

---

## 2. Configuration locale (sur ton PC de dev)

### 2.1 Variables d'environnement pour le signing

Ajoute à ton `~/.bashrc`, `~/.zshrc` ou (Windows) variables système :

```bash
export ARTY_KEYSTORE_PATH="/chemin/vers/arty-release.keystore"
export ARTY_KEYSTORE_PASSWORD="mot_de_passe_du_store"
export ARTY_KEY_ALIAS="arty"
export ARTY_KEY_PASSWORD="mot_de_passe_de_la_cle"
```

Sur Windows (PowerShell) :
```powershell
[Environment]::SetEnvironmentVariable("ARTY_KEYSTORE_PATH", "C:\Users\Tellop\arty-release.keystore", "User")
[Environment]::SetEnvironmentVariable("ARTY_KEYSTORE_PASSWORD", "xxx", "User")
[Environment]::SetEnvironmentVariable("ARTY_KEY_ALIAS", "arty", "User")
[Environment]::SetEnvironmentVariable("ARTY_KEY_PASSWORD", "xxx", "User")
```

### 2.2 Lister les testeurs

Édite `android/app/firebase-testers.txt` (un email par ligne) OU utilise un groupe Firebase.

### 2.3 Notes de version

Édite `android/app/release-notes.txt` pour chaque release.

---

## 3. Déployer une bêta

### Commande principale

```bash
./deploy-beta.sh
```

Le script enchaîne :
1. `npm run build` (Vite + tsc --noEmit)
2. `npx cap sync android`
3. `./gradlew assembleRelease` → APK signé
4. Vérification de la signature APK
5. `firebase appdistribution:distribute` → upload + mail aux testeurs

### Variantes

```bash
# Notes custom pour cette release
./deploy-beta.sh --notes "Fix bug Google login + nouveau mode EU"

# APK déjà compilé, upload uniquement
./deploy-beta.sh --skip-build

# Override testeurs via env
FIREBASE_TESTERS="meg.usseglio@gmail.com,test2@exemple.com" ./deploy-beta.sh

# Utiliser un groupe Firebase
FIREBASE_GROUPS="beta-testers" ./deploy-beta.sh
```

---

## 4. Que reçoivent les testeurs ?

1. Email de Firebase avec un lien d'installation
2. Ils doivent installer l'app **App Tester** (Firebase) depuis le Play Store
3. L'APK apparaît dans App Tester → clic → install
4. Les mises à jour arrivent automatiquement à chaque nouvel upload

---

## 5. Alternatives (si besoin)

### Gradle direct (sans script bash)

```bash
cd android
./gradlew assembleRelease appDistributionUploadRelease
```

Le plugin Gradle lit `firebaseAppDistribution { ... }` dans `app/build.gradle`. Il
utilise `firebase login` ou, en CI, `serviceCredentialsFile` (var env
`FIREBASE_SERVICE_ACCOUNT`).

### CI (GitHub Actions, etc.)

Utilise un **compte de service Firebase** au lieu de `firebase login` :
1. Firebase Console → Paramètres projet → Comptes de service → Générer une clé
2. Stocke le JSON en secret GitHub `FIREBASE_SERVICE_ACCOUNT_JSON`
3. Dans le workflow, écris le JSON sur disque et exporte :
   `export FIREBASE_SERVICE_ACCOUNT=./firebase-sa.json`

---

## 6. Troubleshooting

| Problème | Cause | Solution |
|---|---|---|
| `google-services.json introuvable` | Fichier non téléchargé | Étape 1.1 |
| `firebase: command not found` | firebase-tools manquant | `npm install -g firebase-tools` |
| `Not authenticated` | Pas logué | `firebase login` |
| `App not found: com.arty.app` | Mauvais applicationId ou projet Firebase | Vérifie `android/app/build.gradle` et le bon projet Firebase |
| `APK not signed` | Env vars manquantes | Étape 2.1 |
| `SHA1 mismatch` | Keystore ≠ celui enregistré dans Firebase | Ré-enregistre la SHA1 dans les paramètres du projet Firebase |

---

## 7. Fichiers liés

- `android/build.gradle` — classpath du plugin Gradle App Distribution
- `android/app/build.gradle` — bloc `firebaseAppDistribution`, signing
- `android/app/google-services.json` — **à télécharger manuellement** (gitignoré recommandé)
- `android/app/firebase-testers.txt` — emails testeurs
- `android/app/release-notes.txt` — notes de version
- `deploy-beta.sh` — script principal
