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
import { quotedStrings } from './lib/quotedStrings.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// ── Allowlists exactes du profil public ─────────────────────────────────
const PUBLIC_WEB_SCOPES = new Set([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events.owned',
])

const PUBLIC_ANDROID_SCOPES = new Set([
  'https://www.googleapis.com/auth/calendar.events.owned',
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
    'https://www.googleapis.com/auth/calendar.events.owned',
  ]),
  'android/app/src/main/java/com/arty/app/GoogleSignInPlugin.java': new Set([
    'https://www.googleapis.com/auth/calendar.events.owned',
  ]),
  'functions/api/_lib/publicGoogleScopes.ts': new Set([
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar.events.owned',
    // Transition serveur bornée pour les clients 1.0.97. Ce scope sensible
    // (non restreint) n'est jamais redemandé par le nouveau client public.
    'https://www.googleapis.com/auth/calendar.events',
    // Temporary exact legacy profile for APK 1.0.80; server-gated by cutoff.
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
// Extrait dans `scripts/lib/quotedStrings.mjs` pour être couvert par des
// tests unitaires : c'est ce seul régex qui a rendu le scanner aveugle au
// scope Calendar du bundle Android le 9 août 2026.

// Familles de scopes RESTREINTS, par préfixe. Énumérer chaque chaîne exacte
// est un pari perdu d'avance : Google ajoute des scopes aux familles
// existantes sans prévenir, et une chaîne oubliée passe en silence. Le
// préfixe attrape aussi les variantes futures.
//
// Familles retenues d'après la liste fermée publiée par Google (Gmail, Drive,
// Fit, Chat, Data Portability, Photos, Health) — analyse CASA du 9 août 2026.
const RESTRICTED_SCOPE_PREFIXES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/fitness.',
  'https://www.googleapis.com/auth/chat.',
  'https://www.googleapis.com/auth/dataportability.',
]

// Exceptions explicites, chacune justifiée. Tout ce qui n'est PAS listé ici
// et qui correspond à un préfixe fait échouer la CI : c'est volontaire. La
// stratégie « sans CASA » ne tient qu'à un fil (ne jamais demander de scope
// restreint) et n'a aucun filet de second niveau — mieux vaut une CI rouge à
// tort qu'un scope restreint qui passe.
const RESTRICTED_PREFIX_EXCEPTIONS = new Set([
  // Non sensible : n'ouvre que les fichiers explicitement choisis par
  // l'utilisateur dans le sélecteur Google. C'est le SEUL scope Drive
  // utilisable sans basculer dans CASA (cf. chantier de réouverture Drive).
  'https://www.googleapis.com/auth/drive.file',
  // Scopes d'add-on Google Workspace : ils n'existent que dans le projet
  // Cloud ISOLÉ de l'add-on, jamais dans le client public, et relèvent du
  // régime sensible et non restreint.
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
])

function isRestrictedScope(value) {
  if (RESTRICTED_SCOPES.has(value)) return true
  if (RESTRICTED_PREFIX_EXCEPTIONS.has(value)) return false
  return RESTRICTED_SCOPE_PREFIXES.some((prefix) => value.startsWith(prefix))
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

// Périmètre d'inspection. `services/` en est volontairement EXCLU :
// growth-orchestrator est un service interne rattaché à un projet Cloud
// distinct du client public, et il porte légitimement des scopes Gmail. Cette
// exclusion est un choix, pas un oubli — si ce service devait un jour partager
// le projet OAuth du client public, il faudrait l'ajouter ici ET refaire
// l'analyse CASA, puisque c'est le projet qui porte l'obligation.
const SCANNED_ROOTS = ['src', 'functions', 'android/app/src/main/java']

check('aucun scope restreint en littéral dans le client public', () => {
  const offenders = []
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      const literals = quotedStrings(readFileSync(file, 'utf8'))
      for (const lit of literals) {
        if (isRestrictedScope(lit)) offenders.push(`${rel} → ${lit}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(`scopes restreints trouvés :\n    ${offenders.join('\n    ')}`)
  }
})

// Un scope peut être écrit sans jamais former un littéral complet :
// concaténation (`BASE + 'gmail.readonly'`), interpolation (`${BASE}/drive`),
// chaîne coupée sur deux lignes. Le contrôle ci-dessus ne voit rien de tout
// cela. On cherche donc les familles restreintes dans le TEXTE BRUT, quel que
// soit le découpage — quitte à être plus bruyant.
check('aucune famille de scope restreint dans le texte brut du client public', () => {
  const offenders = []
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      let text = readFileSync(file, 'utf8')
      // Neutraliser les exceptions justifiées avant de chercher les familles.
      for (const allowed of RESTRICTED_PREFIX_EXCEPTIONS) {
        text = text.split(allowed).join('')
      }
      for (const prefix of RESTRICTED_SCOPE_PREFIXES) {
        // On cherche la partie discriminante, pour rester robuste si l'hôte
        // est stocké dans une constante séparée du chemin du scope.
        const needle = prefix.replace('https://www.googleapis.com', '')
        if (text.includes(needle)) offenders.push(`${rel} → ${needle}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `familles de scopes restreints trouvées (même hors littéral) :\n    ${offenders.join('\n    ')}`
    )
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

check('bundle APK synchronisé : scope Calendar exact et à jour', () => {
  const androidAssetsRoot = join(ROOT, 'android/app/src/main/assets/public')
  const requireAndroidAssets = process.argv.includes('--require-android-assets')
  if (!existsSync(androidAssetsRoot)) {
    if (requireAndroidAssets) throw new Error('bundle Android absent')
    return
  }

  let currentScopeFound = false
  const offenders = []
  for (const file of walk(androidAssetsRoot)) {
    const rel = relative(ROOT, file).replaceAll('\\', '/')
    for (const literal of quotedStrings(readFileSync(file, 'utf8'))) {
      if (literal === 'https://www.googleapis.com/auth/calendar.events.owned') currentScopeFound = true
      if (literal === 'https://www.googleapis.com/auth/calendar') offenders.push(rel)
    }
  }
  if (offenders.length > 0) {
    throw new Error(`ancien scope Calendar dans le bundle :\n    ${offenders.join('\n    ')}`)
  }
  if (requireAndroidAssets && !currentScopeFound) {
    throw new Error('scope calendar.events.owned absent du bundle Android synchronisé')
  }
})

console.log(failures === 0 ? 'no-casa:check — OK' : `no-casa:check — ${failures} échec(s)`)
if (failures > 0) process.exitCode = 1
