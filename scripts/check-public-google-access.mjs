/**
 * Scanner sémantique du profil OAuth public (PR-0 — CDC Phase 1 D18/D21/D29).
 *
 * Trois contrôles, tous par comparaison EXACTE de littéraux (token-level,
 * jamais de sous-chaînes — un `includes('/auth/drive')` rejetterait
 * `drive.file`, le défaut précis que D18 interdit) :
 *
 *  1. PUBLIC_GOOGLE_SCOPES (src/services/googleAuth.ts) == allowlist exacte.
 *  2. Le client Android ne demande QUE l'allowlist Android.
 *  3. Aucun scope RESTREINT canonique n'apparaît dans le client public.
 *  4. Aucun endpoint, URL ou nom d'outil Gmail ne subsiste dans le client,
 *     y compris dans le bundle déjà synchronisé pour l'APK.
 *
 * Évolution volontaire : quand PR-B1 ajoutera `drive.file` (non-sensible),
 * c'est ICI que l'allowlist sera mise à jour, en conscience — le scanner
 * ne le bloquera pas par accident puisque la comparaison est exacte.
 *
 * Usage : node scripts/check-public-google-access.mjs   (npm run no-casa:check)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ── Allowlists exactes du profil public ─────────────────────────────────
const PUBLIC_WEB_SCOPES = new Set([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
])

const PUBLIC_ANDROID_SCOPES = new Set([
  'https://www.googleapis.com/auth/calendar',
])

// Scopes RESTREINTS Google (classification officielle, chaînes canoniques
// complètes — vérifiées CDC §2.1/§3.1). Utilisés par les contrôles 1 et 2
// (déclarations de scopes, égalité exacte).
//
const RESTRICTED_SCOPES = new Set([
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
])

const FROZEN_FILE_SCOPES = {
  'src/services/googleAuth.ts': new Set([
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar',
  ]),
  'android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java': new Set([
    'https://www.googleapis.com/auth/calendar',
  ]),
}

function looksLikeScope(lit) {
  return (
    lit === 'openid' ||
    lit === 'https://mail.google.com/' ||
    lit.startsWith('https://www.googleapis.com/auth/')
  )
}

// ── Petit runner ────────────────────────────────────────────────────────
let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

// Extraction token-level : littéraux entre quotes simples ou doubles.
function quotedStrings(source) {
  const out = []
  const re = /'([^'\n]*)'|"([^"\n]*)"/g
  let m
  while ((m = re.exec(source)) !== null) out.push(m[1] ?? m[2])
  return out
}

function setEquals(a, b) {
  return a.size === b.size && [...a].every((v) => b.has(v))
}

// ── 1. Allowlist web (PUBLIC_GOOGLE_SCOPES) ─────────────────────────────
check('PUBLIC_GOOGLE_SCOPES (web) == allowlist exacte du profil public', () => {
  const src = readFileSync(join(ROOT, 'src/services/googleAuth.ts'), 'utf8')
  const marker = 'export const PUBLIC_GOOGLE_SCOPES'
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('PUBLIC_GOOGLE_SCOPES introuvable dans googleAuth.ts')
  const block = src.slice(start, src.indexOf(']', start))
  const found = new Set(quotedStrings(block))
  if (!setEquals(found, PUBLIC_WEB_SCOPES)) {
    throw new Error(
      `écart — trouvé: [${[...found].join(', ')}] attendu: [${[...PUBLIC_WEB_SCOPES].join(', ')}]`,
    )
  }
})

// ── 2. Profil Android permanent ─────────────────────────────────────────
check('GoogleSignInPlugin.java == allowlist Android permanente', () => {
  const src = readFileSync(
    join(ROOT, 'android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java'),
    'utf8',
  )
  const scopes = new Set(quotedStrings(src).filter((s) => s.startsWith('https://www.googleapis.com/auth/') || s === 'openid'))
  if (!setEquals(scopes, PUBLIC_ANDROID_SCOPES)) {
    throw new Error(
      `écart — trouvé: [${[...scopes].join(', ')}] attendu: [${[...PUBLIC_ANDROID_SCOPES].join(', ')}]`,
    )
  }
})

// ── 3. Aucun scope restreint hors des emplacements legacy ───────────────
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'build' || entry === '.git') continue
      yield* walk(full)
    } else if (/\.(ts|tsx|js|mjs|java|json)$/.test(entry) && !entry.endsWith('.d.ts')) {
      yield full
    }
  }
}

check('aucun scope restreint en littéral dans le client public', () => {
  const offenders = []
  for (const root of ['src', 'functions', 'android/app/src/main/java']) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      const literals = quotedStrings(readFileSync(file, 'utf8'))
      for (const lit of literals) {
        if (RESTRICTED_SCOPES.has(lit)) offenders.push(`${rel} → ${lit}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(`scopes restreints trouvés :\n    ${offenders.join('\n    ')}`)
  }
})

// ── 4. Inventaire gelé des fichiers OAuth clients ───────────────────────
check('fichiers OAuth clients : aucun scope hors inventaire gelé', () => {
  const offenders = []
  for (const [rel, frozen] of Object.entries(FROZEN_FILE_SCOPES)) {
    const literals = quotedStrings(readFileSync(join(ROOT, rel), 'utf8'))
    for (const lit of literals) {
      if (looksLikeScope(lit) && !frozen.has(lit)) offenders.push(`${rel} → ${lit}`)
    }
  }
  if (offenders.length > 0) {
    throw new Error(`scopes hors inventaire gelé :\n    ${offenders.join('\n    ')}`)
  }
})

const FORBIDDEN_GMAIL_CLIENT_MARKERS = [
  '/api/gmail/action',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.',
  'read_emails',
  'read_email',
  'read_email_attachment',
  'search_emails',
  'send_email',
  'reply_email',
  'archive_email',
  'delete_email',
  'star_email',
  'create_draft',
  'label_email',
]

check('clients web, Android et bundle APK synchronisé : aucune capacité Gmail résiduelle', () => {
  const offenders = []
  const androidAssetsRoot = 'android/app/src/main/assets/public'
  const requireAndroidAssets = process.argv.includes('--require-android-assets')
  if (requireAndroidAssets && !existsSync(join(ROOT, androidAssetsRoot))) {
    throw new Error('bundle Android absent : exécuter npm run build puis npx cap sync android')
  }
  for (const root of [
    'src',
    'android/app/src/main/java',
    androidAssetsRoot,
  ]) {
    if (!existsSync(join(ROOT, root))) continue
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      const source = readFileSync(file, 'utf8')
      for (const marker of FORBIDDEN_GMAIL_CLIENT_MARKERS) {
        if (source.includes(marker)) offenders.push(`${rel} → ${marker}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(`marqueurs Gmail trouvés dans le client :\n    ${offenders.join('\n    ')}`)
  }
})

console.log(failures === 0 ? 'no-casa:check — OK' : `no-casa:check — ${failures} échec(s)`)
if (failures > 0) process.exitCode = 1
