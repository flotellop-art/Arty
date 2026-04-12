#!/usr/bin/env bash
# deploy-beta.sh — Build + signe + upload APK vers Firebase App Distribution
#
# Prérequis (une seule fois) :
#   1. google-services.json placé dans android/app/
#   2. Keystore release existant (ex: ~/arty-release.keystore)
#   3. firebase-tools installé globalement :  npm install -g firebase-tools
#   4. firebase login   (auth Google du compte propriétaire Firebase)
#
# Variables d'environnement requises :
#   ARTY_KEYSTORE_PATH       chemin absolu vers le .keystore
#   ARTY_KEYSTORE_PASSWORD   mot de passe du store
#   ARTY_KEY_ALIAS           alias (défaut: "arty")
#   ARTY_KEY_PASSWORD        mot de passe de la clé (défaut: = keystore password)
#
# Variables optionnelles :
#   FIREBASE_APP_ID          si non défini, lu depuis google-services.json
#   FIREBASE_TESTERS         liste emails séparés par virgule (override testersFile)
#   FIREBASE_GROUPS          groupes Firebase (ex: "beta-testers")
#   RELEASE_NOTES            notes (sinon utilise android/app/release-notes.txt)
#
# Usage :
#   ./deploy-beta.sh                     # build + upload
#   ./deploy-beta.sh --skip-build        # upload uniquement (APK déjà compilé)
#   ./deploy-beta.sh --notes "Fix bug X" # override release notes

set -euo pipefail

# --- Couleurs pour lisibilité ---
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GRN}[info]${NC} $*"; }
warn()  { echo -e "${YEL}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; }

# --- Parse arguments ---
SKIP_BUILD=0
NOTES_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --notes)      NOTES_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,25p' "$0"; exit 0 ;;
    *) error "Argument inconnu: $1"; exit 1 ;;
  esac
done

# --- Se placer à la racine du projet ---
cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"
APK_PATH="$PROJECT_ROOT/android/app/build/outputs/apk/release/app-release.apk"

# --- 1. Pré-checks ---
info "Pré-checks..."

if [[ ! -f "$PROJECT_ROOT/android/app/google-services.json" ]]; then
  error "android/app/google-services.json introuvable."
  error "→ Télécharge-le depuis la console Firebase et place-le dans android/app/"
  exit 1
fi

if ! command -v firebase &> /dev/null; then
  error "firebase-tools n'est pas installé."
  error "→ npm install -g firebase-tools && firebase login"
  exit 1
fi

if [[ $SKIP_BUILD -eq 0 ]]; then
  : "${ARTY_KEYSTORE_PATH:?ARTY_KEYSTORE_PATH non défini (chemin du .keystore)}"
  : "${ARTY_KEYSTORE_PASSWORD:?ARTY_KEYSTORE_PASSWORD non défini}"
  if [[ ! -f "$ARTY_KEYSTORE_PATH" ]]; then
    error "Keystore introuvable: $ARTY_KEYSTORE_PATH"
    exit 1
  fi
fi

# --- 2. Build Vite + sync Capacitor ---
if [[ $SKIP_BUILD -eq 0 ]]; then
  info "Build Vite (tsc --noEmit + vite build)..."
  npm run build

  info "Sync Capacitor Android..."
  npx cap sync android

  # --- 3. Build APK release signé ---
  info "Build APK release signé (./gradlew assembleRelease)..."
  pushd android > /dev/null
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    ./gradlew.bat assembleRelease
  else
    ./gradlew assembleRelease
  fi
  popd > /dev/null

  # --- 4. Vérification APK ---
  if [[ ! -f "$APK_PATH" ]]; then
    error "APK introuvable après build: $APK_PATH"
    exit 1
  fi

  # Vérifier la signature (apksigner si disponible dans le PATH via ANDROID_HOME)
  if [[ -n "${ANDROID_HOME:-}" && -x "$ANDROID_HOME/build-tools/$(ls -1 "$ANDROID_HOME/build-tools" | sort -Vr | head -1)/apksigner" ]]; then
    APKSIGNER="$ANDROID_HOME/build-tools/$(ls -1 "$ANDROID_HOME/build-tools" | sort -Vr | head -1)/apksigner"
    info "Vérification de la signature APK..."
    "$APKSIGNER" verify --verbose "$APK_PATH" | head -5 || {
      error "La signature APK est invalide — abandon."
      exit 1
    }
  else
    warn "apksigner non trouvé (\$ANDROID_HOME non défini) — signature non vérifiée."
  fi

  info "APK prêt : $APK_PATH"
  du -h "$APK_PATH" | awk '{print "      taille: "$1}'
fi

# --- 5. Upload Firebase App Distribution ---
info "Upload vers Firebase App Distribution..."

# Construire la commande firebase
FIREBASE_CMD=(firebase appdistribution:distribute "$APK_PATH")

if [[ -n "${FIREBASE_APP_ID:-}" ]]; then
  FIREBASE_CMD+=(--app "$FIREBASE_APP_ID")
fi

# Release notes : priorité argument > env > fichier
if [[ -n "$NOTES_OVERRIDE" ]]; then
  FIREBASE_CMD+=(--release-notes "$NOTES_OVERRIDE")
elif [[ -n "${RELEASE_NOTES:-}" ]]; then
  FIREBASE_CMD+=(--release-notes "$RELEASE_NOTES")
elif [[ -f "android/app/release-notes.txt" ]]; then
  FIREBASE_CMD+=(--release-notes-file "android/app/release-notes.txt")
fi

# Testeurs
if [[ -n "${FIREBASE_TESTERS:-}" ]]; then
  FIREBASE_CMD+=(--testers "$FIREBASE_TESTERS")
elif [[ -f "android/app/firebase-testers.txt" ]]; then
  FIREBASE_CMD+=(--testers-file "android/app/firebase-testers.txt")
fi

# Groupes
if [[ -n "${FIREBASE_GROUPS:-}" ]]; then
  FIREBASE_CMD+=(--groups "$FIREBASE_GROUPS")
fi

echo "  → ${FIREBASE_CMD[*]}"
"${FIREBASE_CMD[@]}"

info "✅ Distribution terminée — les testeurs vont recevoir un mail."
