// Validation d'URL anti-SSRF + détection des liens de partage — extrait de
// functions/api/fetch/url.ts pour être testable en isolation (aucune
// dépendance Cloudflare). Durci le 11 juin 2026 suite à un audit SSRF
// (4 agents) : trailing dot, IPv4 embarquée (nip.io), suffixes internes.

export function isSafePublicUrl(u: URL): boolean {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  if (u.port && u.port !== '80' && u.port !== '443') return false
  // Trailing dot (FQDN absolu) : "169.254.169.254." résout vers la même IP
  // mais échappait à la regex IPv4 ci-dessous. Normaliser avant tout test.
  let h = u.hostname.toLowerCase()
  if (h.endsWith('.')) h = h.slice(0, -1)
  // Refuse les IP littérales (v4/v6) — un contenu public est servi par un nom
  // de domaine, jamais une IP brute. Couvre loopback/privé/link-local/metadata.
  // (Les formes décimal/octal/hex sont normalisées en dotted-quad par le
  // parseur WHATWG de `new URL`, donc rattrapées ici.)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false
  if (h.includes(':')) return false
  // Anti wildcard-DNS (nip.io, sslip.io… : un host public dont une étiquette
  // EST une IPv4 littérale, qui résout vers cette IP — vecteur metadata).
  if (/(^|\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\.|$)/.test(h)) return false
  // Refuse les hostnames internes / sans TLD.
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    h.endsWith('.goog')
  ) {
    return false
  }
  if (!h.includes('.')) return false
  return true
}

// Liens de partage qui pointent vers un interstitiel/redirection JS (et non
// un simple 3xx) : Linkup ne les suit pas sans rendre le JavaScript. On active
// renderJs UNIQUEMENT pour ces hôtes (plus lent/coûteux → pas par défaut).
// share.google = format de partage Android/Google 2024+ (cas live 11 juin).
const SHORT_LINK_HOSTS = new Set([
  'share.google',
  'g.co',
  'goo.gl',
  'maps.app.goo.gl',
  'app.goo.gl',
])

export function isShortLinkHost(hostname: string): boolean {
  return SHORT_LINK_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''))
}
