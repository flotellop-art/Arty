import { describe, it, expect } from 'vitest'
import { verifySignature as verifyCreem } from '../../../functions/api/webhook/creem'
import { verifySignature as verifyLS } from '../../../functions/api/webhook/lemonsqueezy'

// Audit F-5 (3 juil. 2026) — les webhooks Creem/Lemon Squeezy créditent des
// wallets et activent des abonnements : une vérification de signature cassée
// = argent gratuit. Ces tests verrouillent le contrat : HMAC-SHA256 hex sur
// les octets BRUTS du body, rejet de tout payload modifié ou secret absent.

const SECRET = 'test-webhook-secret-0123456789abcdef'

async function hmacHex(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function raw(body: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(body)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

for (const [name, verify] of [['creem', verifyCreem], ['lemonsqueezy', verifyLS]] as const) {
  describe(`verifySignature — webhook ${name}`, () => {
    const body = '{"event":"order_created","amount":500}'

    it('accepte une signature HMAC valide', async () => {
      const sig = await hmacHex(body, SECRET)
      expect(await verify(raw(body), sig, SECRET)).toBe(true)
    })

    it('rejette une signature invalide', async () => {
      expect(await verify(raw(body), 'deadbeef'.repeat(8), SECRET)).toBe(false)
    })

    it('rejette un payload modifié après signature (montant gonflé)', async () => {
      const sig = await hmacHex(body, SECRET)
      const tampered = body.replace('"amount":500', '"amount":999999')
      expect(await verify(raw(tampered), sig, SECRET)).toBe(false)
    })

    it('rejette si le secret ne correspond pas', async () => {
      const sig = await hmacHex(body, 'autre-secret')
      expect(await verify(raw(body), sig, SECRET)).toBe(false)
    })

    it('rejette (fail-closed) signature ou secret absents', async () => {
      const sig = await hmacHex(body, SECRET)
      expect(await verify(raw(body), '', SECRET)).toBe(false)
      expect(await verify(raw(body), sig, '')).toBe(false)
    })

    it('rejette une signature de longueur différente (pas de crash)', async () => {
      expect(await verify(raw(body), 'abc', SECRET)).toBe(false)
    })
  })
}
