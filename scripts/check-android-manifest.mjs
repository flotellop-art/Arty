/**
 * Inspection sémantique des permissions Android (PR-0 — CDC Phase 1 D21/D29).
 *
 * Consomme au choix (détection automatique) :
 *  - un AndroidManifest.xml MERGÉ (intermediates de assembleDebug) ;
 *  - la sortie `aapt dump permissions app.apk` ;
 *  - la sortie `bundletool dump manifest --bundle app.aab` (workflow release).
 *
 * Trois contrôles, par ÉGALITÉ EXACTE de noms de permissions (jamais de
 * sous-chaînes — D18) :
 *  1. DENYLIST : aucune permission interdite (stockage/médias, contacts,
 *     SMS/téléphonie, comptes, localisation arrière-plan) — la classe de
 *     dérive que l'audit C7/F-28 a déjà purgée ne doit pas revenir via une
 *     dépendance.
 *  2. PARITÉ SOURCE : chaque permission déclarée dans le manifest source
 *     doit être présente (une disparition silencieuse = merge cassé,
 *     leçon BUG 44 : permission manquante = feature morte sans prompt).
 *  3. RAPPORT : la liste complète des permissions mergées est imprimée
 *     dans les logs CI. Durcissement prévu (même PR, après la première CI
 *     verte) : gel de cette liste en ALLOWLIST stricte.
 *
 * Usage : node scripts/check-android-manifest.mjs <fichier>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/check-android-manifest.mjs <manifest.xml | aapt-dump.txt>')
  process.exit(2)
}

const DENYLIST = new Set([
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.GET_ACCOUNTS',
  'android.permission.READ_SMS',
  'android.permission.SEND_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
  'android.permission.CALL_PHONE',
  'android.permission.READ_PHONE_STATE',
  'android.permission.READ_PHONE_NUMBERS',
  'android.permission.PROCESS_OUTGOING_CALLS',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.BODY_SENSORS',
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
])

function extractPermissions(text) {
  const found = new Set()
  // Manifest XML (mergé ou bundletool) : <uses-permission android:name="..."/>
  for (const m of text.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)) found.add(m[1])
  // Sortie aapt : uses-permission: name='...'
  for (const m of text.matchAll(/uses-permission: name='([^']+)'/g)) found.add(m[1])
  return found
}

const merged = extractPermissions(readFileSync(input, 'utf8'))
const source = extractPermissions(
  readFileSync(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8'),
)

if (merged.size === 0) {
  console.error(`✗ aucune permission trouvée dans ${input} — mauvais fichier ou format inattendu`)
  process.exit(1)
}

let failures = 0

const denied = [...merged].filter((p) => DENYLIST.has(p))
if (denied.length > 0) {
  failures += 1
  console.error(`  ✗ permissions INTERDITES présentes : ${denied.join(', ')}`)
} else {
  console.log('  ✓ aucune permission de la denylist')
}

const missing = [...source].filter((p) => !merged.has(p))
if (missing.length > 0) {
  failures += 1
  console.error(`  ✗ permissions du manifest source ABSENTES du mergé : ${missing.join(', ')}`)
} else {
  console.log('  ✓ parité avec le manifest source')
}

console.log(`  ℹ permissions mergées (${merged.size}) : ${[...merged].sort().join(', ')}`)

if (failures > 0) {
  console.error('check-android-manifest — ÉCHEC')
  process.exit(1)
}
console.log('check-android-manifest — OK')
