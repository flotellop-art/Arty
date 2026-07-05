// C13 — timeout par défaut sur les fetch serveur→Google.
// Sans timeout, une API Google lente/pendante laisse la requête serveur
// suspendue jusqu'au cap Cloudflare (pattern BUG 47 : borner toute dépendance
// réseau). `AbortSignal.timeout` est éprouvé dans ce runtime (cf. computer/relay.ts).
// Respecte un `signal` déjà fourni par l'appelant (ne l'écrase jamais).
const GOOGLE_FETCH_TIMEOUT_MS = 20_000

export function googleFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS) })
}
