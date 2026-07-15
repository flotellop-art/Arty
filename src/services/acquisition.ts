/**
 * Attribution first-party des campagnes payantes (pubs Meta).
 * Décision Florent (15 juillet 2026) : PAS de Meta Pixel — zéro tracker
 * tiers, pas de bannière cookies. L'attribution se fait de notre côté.
 *
 * Chaîne complète :
 *   1. Les LPs statiques `public/lp/<angle>/` (hors SPA, ultra-légères)
 *      écrivent un first-touch JSON sous la clé RAW `arty-acquisition` via
 *      `public/lp/lp.js` — MÊME littéral que ACQUISITION_KEY ci-dessous,
 *      parité verrouillée par un test (lpPages.test.ts).
 *   2. La SPA capture aussi les utm_* au boot (`captureAcquisition` dans
 *      main.tsx) pour les pubs qui pointeraient directement sur `/`.
 *   3. `initTrial` (trialClient.ts) attache le JSON au POST /api/trial/init
 *      (table D1 `acquisition`, first-touch côté serveur) puis consomme la
 *      clé locale — la boucle de mesure coût-par-inscription est fermée.
 *
 * Règles :
 *   - First-touch : on n'écrase JAMAIS une attribution existante non expirée.
 *   - TTL 30 jours : au-delà, ignorée ET purgée (appareil partagé — ne pas
 *     attribuer l'inscription de B au clic pub de A des semaines avant).
 *   - Clé RAW volontairement non scopée (pré-login par nature). Vérifié :
 *     ni logout() (useAuth.ts) ni clearAllForActiveUser() (scopedStorage.ts)
 *     ni migrateExistingData (userSession.ts) ne la touchent.
 */

export const ACQUISITION_KEY = 'arty-acquisition'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Champs acceptés — allowlist stricte, tout le reste est ignoré. */
export const ACQUISITION_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'lp',
] as const
export type AcquisitionField = (typeof ACQUISITION_FIELDS)[number]
export type Acquisition = Partial<Record<AcquisitionField, string>> & { ts: number }

const MAX_FIELD_LEN = 120

function sanitize(value: string): string {
  // Caractères usuels d'identifiants de campagne uniquement — pas de HTML,
  // pas de guillemets. La valeur repart telle quelle vers D1 côté serveur
  // (qui re-valide de son côté, défense en profondeur).
  return value.slice(0, MAX_FIELD_LEN).replace(/[^\w.\-~:/%+ ]/g, '')
}

/** Lit les paramètres d'acquisition d'une query string. null si aucun. */
export function readAcquisitionFromSearch(search: string): Acquisition | null {
  try {
    const params = new URLSearchParams(search)
    const out: Acquisition = { ts: Date.now() }
    let found = false
    for (const field of ACQUISITION_FIELDS) {
      const value = params.get(field)
      if (value) {
        const clean = sanitize(value)
        if (clean) {
          out[field] = clean
          found = true
        }
      }
    }
    return found ? out : null
  } catch {
    return null
  }
}

/**
 * Capture first-touch au boot de la SPA (appelé dans main.tsx, avant tout
 * login). Sans effet si l'URL ne porte aucun paramètre d'acquisition, ou si
 * une attribution valide existe déjà (posée par une LP ou une visite passée).
 */
export function captureAcquisition(): void {
  try {
    const fromUrl = readAcquisitionFromSearch(window.location.search)
    if (!fromUrl) return
    if (getAcquisition()) return
    localStorage.setItem(ACQUISITION_KEY, JSON.stringify(fromUrl))
  } catch {
    /* localStorage indisponible (mode privé WebView) — best-effort */
  }
}

/**
 * Attribution courante, ou null si absente/expirée/illisible (purge au
 * passage). Ne renvoie QUE les champs allowlistés re-sanitisés : le blob
 * peut avoir été écrit par lp.js (JS statique hors typecheck).
 */
export function getAcquisition(): Acquisition | null {
  try {
    const raw = localStorage.getItem(ACQUISITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Acquisition>
    if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(ACQUISITION_KEY)
      return null
    }
    const out: Acquisition = { ts: parsed.ts }
    let found = false
    for (const field of ACQUISITION_FIELDS) {
      const value = parsed[field]
      if (typeof value === 'string' && value) {
        const clean = sanitize(value)
        if (clean) {
          out[field] = clean
          found = true
        }
      }
    }
    return found ? out : null
  } catch {
    return null
  }
}

/** À appeler UNIQUEMENT après persistance serveur réussie (initTrial). */
export function consumeAcquisition(): void {
  try {
    localStorage.removeItem(ACQUISITION_KEY)
  } catch {
    /* best-effort */
  }
}

/**
 * `?start=1` : entrée directe dans l'onboarding depuis une LP pub — la SPA
 * saute la landing marketing générique pour tenir le message match de la pub
 * (voir LoggedOutHome dans App.tsx).
 */
export function hasStartParam(search: string): boolean {
  try {
    return new URLSearchParams(search).has('start')
  } catch {
    return false
  }
}
