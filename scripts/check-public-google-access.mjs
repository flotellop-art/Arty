/**
 * Scanner sémantique du profil OAuth public (PR-0 — CDC Phase 1 D18/D21/D29).
 *
 * Trois contrôles, tous par comparaison EXACTE de littéraux (token-level,
 * jamais de sous-chaînes — un `includes('/auth/drive')` rejetterait
 * `drive.file`, le défaut précis que D18 interdit) :
 *
 *  1. PUBLIC_GOOGLE_SCOPES (src/services/googleAuth.ts) == allowlist exacte.
 *  2. Le bloc `if (BuildConfig.GMAIL_NO_CASA_PHASE0)` de
 *     GoogleSignInPlugin.java ne demande QUE l'allowlist Android — la
 *     branche `else` (profil legacy complet) est légitime et ignorée.
 *  3. Aucun scope RESTREINT canonique n'apparaît comme littéral dans le
 *     code client/serveur en dehors des deux emplacements legacy connus.
 *
 * Évolution volontaire : quand PR-B1 ajoutera `drive.file` (non-sensible),
 * c'est ICI que l'allowlist sera mise à jour, en conscience — le scanner
 * ne le bloquera pas par accident puisque la comparaison est exacte.
 *
 * Usage : node scripts/check-public-google-access.mjs   (npm run no-casa:check)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
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
// Cas double-usage : 'https://mail.google.com/' est à la fois le scope
// restreint « accès Gmail maximal » ET l'URL web légitime du hand-off de
// recherche (GMAIL_HOME_URL, CDC volet A). Le balayage de littéraux
// (contrôle 3) l'EXCLUT donc — c'était l'échec historique du scanner sur
// l'URL légitime (D26). Il reste interdit là où un scope s'introduit
// réellement : les déclarations vérifiées par égalité exacte (1 et 2).
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

// Emplacements encore autorisés à contenir des scopes restreints en littéral :
// le profil LEGACY (branche flag-OFF) vit dans ces deux fichiers tant que le
// flip prod n'a pas eu lieu. Le growth-orchestrator (services/) est un projet
// OAuth séparé (CDC D10/P0-b) hors du périmètre de ce scanner.
//
// L'inventaire COMPLET des scopes de chaque fichier legacy est GELÉ ci-dessous
// (contrôle 4) : même dans ces fichiers, un scope ne peut pas s'ajouter sans
// mise à jour consciente du scanner — y compris hors du bloc public Java.
const LEGACY_ALLOWED_FILES = new Set([
  'src/services/googleAuth.ts',
  'android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java',
])

const FROZEN_FILE_SCOPES = {
  'src/services/googleAuth.ts': new Set([
    // PUBLIC_GOOGLE_SCOPES
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar',
    // STANDARD_GOOGLE_SCOPES (profil legacy flag-OFF)
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/contacts',
  ]),
  'android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java': new Set([
    // bloc public (if GMAIL_NO_CASA_PHASE0)
    'https://www.googleapis.com/auth/calendar',
    // branche else (profil legacy flag-OFF)
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/contacts',
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

// ── 2. Bloc Android du profil public ────────────────────────────────────
check('GoogleSignInPlugin.java : le bloc GMAIL_NO_CASA_PHASE0 == allowlist Android', () => {
  const src = readFileSync(
    join(ROOT, 'android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java'),
    'utf8',
  )
  const ifMarker = 'if (BuildConfig.GMAIL_NO_CASA_PHASE0)'
  const start = src.indexOf(ifMarker)
  if (start === -1) throw new Error('bloc if (BuildConfig.GMAIL_NO_CASA_PHASE0) introuvable')
  const elseIdx = src.indexOf('} else {', start)
  if (elseIdx === -1) throw new Error('branche else du profil legacy introuvable après le bloc public')
  const block = src.slice(start, elseIdx)
  const scopes = new Set(quotedStrings(block).filter((s) => s.startsWith('https://') || s === 'openid'))
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

check('aucun scope restreint en littéral hors des fichiers legacy connus', () => {
  // Balayage token-level, MOINS la chaîne double-usage (URL Gmail légitime,
  // voir le commentaire de RESTRICTED_SCOPES).
  const SWEEP_SCOPES = new Set([...RESTRICTED_SCOPES].filter((s) => s !== 'https://mail.google.com/'))
  const offenders = []
  for (const root of ['src', 'functions', 'android/app/src/main/java']) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      if (LEGACY_ALLOWED_FILES.has(rel)) continue
      const literals = quotedStrings(readFileSync(file, 'utf8'))
      for (const lit of literals) {
        if (SWEEP_SCOPES.has(lit)) offenders.push(`${rel} → ${lit}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(`scopes restreints trouvés :\n    ${offenders.join('\n    ')}`)
  }
})

// ── 4. Inventaire gelé des fichiers legacy ──────────────────────────────
check('fichiers legacy : aucun scope hors inventaire gelé', () => {
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

console.log(failures === 0 ? 'no-casa:check — OK' : `no-casa:check — ${failures} échec(s)`)
if (failures > 0) process.exitCode = 1
