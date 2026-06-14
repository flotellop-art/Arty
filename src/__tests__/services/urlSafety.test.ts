// Tests anti-SSRF de isSafePublicUrl (durcissement du 11 juin 2026, audit
// 4 agents). Le module est sous functions/ mais pur (aucune dépendance
// Cloudflare) → importable et testable directement.
import { describe, it, expect } from 'vitest'
import { isSafePublicUrl, isShortLinkHost } from '../../../functions/api/_lib/urlSafety'

const safe = (s: string) => isSafePublicUrl(new URL(s))

describe('isSafePublicUrl — hosts publics légitimes', () => {
  it('accepte les vrais domaines', () => {
    expect(safe('https://www.franceinfo.fr/article')).toBe(true)
    expect(safe('https://share.google/abc')).toBe(true)
    expect(safe('http://example.org/x')).toBe(true)
    expect(safe('https://host.fr:443/x')).toBe(true) // port par défaut élidé
  })
})

describe('isSafePublicUrl — SSRF bloqués', () => {
  it('IP littérales v4 + formes normalisées WHATWG', () => {
    expect(safe('http://169.254.169.254/')).toBe(false) // metadata cloud
    expect(safe('http://127.0.0.1/')).toBe(false)
    expect(safe('http://2130706433/')).toBe(false) // décimal → 127.0.0.1
    expect(safe('http://0x7f000001/')).toBe(false) // hex → 127.0.0.1
    expect(safe('http://127.1/')).toBe(false) // forme courte → 127.0.0.1
  })

  it('trailing dot (FQDN absolu) — bypass corrigé le 11 juin', () => {
    expect(safe('http://169.254.169.254./')).toBe(false)
    expect(safe('http://127.0.0.1./')).toBe(false)
  })

  it('wildcard-DNS (nip.io & co — IPv4 embarquée)', () => {
    expect(safe('http://169.254.169.254.nip.io/')).toBe(false)
    expect(safe('http://10.0.0.1.sslip.io/')).toBe(false)
  })

  it('IPv6 littéral', () => {
    expect(safe('http://[::1]/')).toBe(false)
    expect(safe('http://[fd00::1]/')).toBe(false)
  })

  it('hosts internes / sans TLD', () => {
    expect(safe('http://localhost/')).toBe(false)
    expect(safe('http://svc.internal/')).toBe(false)
    expect(safe('http://metadata.google.internal/')).toBe(false)
    expect(safe('http://x.goog/')).toBe(false)
    expect(safe('http://intranet/')).toBe(false) // pas de point
  })

  it('protocole, credentials, port non standard', () => {
    expect(safe('ftp://example.com/')).toBe(false)
    expect(safe('https://user:pass@example.com/')).toBe(false)
    expect(safe('http://example.com:22/')).toBe(false)
  })
})

describe('isShortLinkHost', () => {
  it('reconnaît les raccourcisseurs Google (insensible casse + trailing dot)', () => {
    expect(isShortLinkHost('share.google')).toBe(true)
    expect(isShortLinkHost('SHARE.GOOGLE')).toBe(true)
    expect(isShortLinkHost('maps.app.goo.gl')).toBe(true)
    expect(isShortLinkHost('goo.gl.')).toBe(true)
  })
  it('refuse les autres hosts (pas de renderJs gaspillé)', () => {
    expect(isShortLinkHost('www.franceinfo.fr')).toBe(false)
    expect(isShortLinkHost('bit.ly')).toBe(false)
  })
})
