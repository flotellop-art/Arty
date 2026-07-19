// PR-0 (issue de la revue du CDC vision, §0/A3) : la réservation wallet
// comptait le base64 des pièces jointes comme du TEXTE (1 octet = 1 token) —
// une image de 8 Mo réservait ~10,7 M « tokens » (dizaines de dollars avec
// markup) pour ~1 600 tokens réellement facturés par Anthropic. Bug DÉJÀ LIVE
// sur le chemin Claude (proxy.ts → beginWalletBilling pour free-avec-crédits).
// Contrat corrigé : une image encodée est REMPLACÉE par une borne plate et
// explicite. Les PDF/audio restent sur le comptage historique du base64 : le
// chantier vision ne doit pas modifier leur réservation sans compteur dédié.
import { describe, expect, it } from 'vitest'
import { estimateInputTokens } from '../../../functions/api/_lib/walletBilling'
import { estimateReserveMicro } from '../../../functions/api/_lib/creditPricing'

const MB = 1024 * 1024
// base64 d'un binaire de n octets ≈ n × 4/3 caractères ASCII.
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3))

describe('estimateInputTokens — payloads média bornés (PR-0)', () => {
  it("une image Anthropic de 8 Mo n'est plus comptée au poids : bornée < 50 k tokens", () => {
    const est = estimateInputTokens('anthropic', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Que vois-tu sur cette photo ?' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: b64(8 * MB) },
            },
          ],
        },
      ],
    })
    // Avant le fix : ~10,7 M. Après : une borne image unique de 16 384,
    // indépendante de la shape Anthropic du body.
    expect(est).toBeLessThan(30_000)
    expect(est).toBeGreaterThanOrEqual(16_384) // couvre Terra 4K (~12 288)
  })

  it('un PDF Anthropic conserve le comptage historique de son base64', () => {
    const pdfDoc = (bytes: number) => ({
      messages: [
        {
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: b64(bytes) },
            },
          ],
        },
      ],
    })
    // La réserve PDF n'est pas optimisée dans le chantier image : elle reste
    // volontairement au moins aussi grande que le payload encodé.
    const smallDense = estimateInputTokens('anthropic', pdfDoc(300 * 1024))
    expect(smallDense).toBeGreaterThanOrEqual(b64(300 * 1024).length)

    // Aucun plafond artificiel : un document dix fois plus lourd continue à
    // réserver nettement davantage au lieu de créer une fuite économique.
    const oneMb = estimateInputTokens('anthropic', pdfDoc(1 * MB))
    const tenMb = estimateInputTokens('anthropic', pdfDoc(10 * MB))
    expect(oneMb).toBeGreaterThanOrEqual(b64(1 * MB).length)
    expect(tenMb).toBeGreaterThan(oneMb * 8)
  })

  it('une data URL image (Mistral/OpenAI) prend la borne image, pas le poids', () => {
    const est = estimateInputTokens('mistral', {
      messages: [
        {
          content: [
            { type: 'text', text: 'analyse' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64(5 * MB)}` } },
          ],
        },
      ],
    })
    expect(est).toBeLessThan(50_000)
  })

  it('une petite image base64 reste une image, pas un média distant à 128 k', () => {
    const est = estimateInputTokens('anthropic', {
      messages: [{
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
        }],
      }],
    })
    expect(est).toBeGreaterThanOrEqual(16_384)
    expect(est).toBeLessThan(30_000)
  })

  it('quatre images OpenAI couvrent quatre images Terra 4K sans dépendre du poids', () => {
    const imageBlock = (bytes: number) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64(bytes)}` },
    })
    const one = estimateInputTokens('openai', {
      messages: [{ content: [imageBlock(1 * MB)] }],
    })
    const four = estimateInputTokens('openai', {
      messages: [{ content: Array.from({ length: 4 }, () => imageBlock(8 * MB)) }],
    })
    expect(one).toBeGreaterThanOrEqual(16_384)
    expect(four).toBeGreaterThanOrEqual(4 * 16_384)
    expect(four).toBeLessThan(100_000)
  })

  it('Gemini : inline_data image/* raffine le kind hérité vers la borne image', () => {
    const image = estimateInputTokens('gemini', {
      contents: [
        { parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64(6 * MB) } }] },
      ],
    })
    expect(image).toBeLessThan(50_000)

    const pdf = estimateInputTokens('gemini', {
      contents: [
        { parts: [{ inline_data: { mime_type: 'application/pdf', data: b64(1 * MB) } }] },
      ],
    })
    // PDF → comportement historique, PAS la borne image plate.
    expect(pdf).toBeGreaterThanOrEqual(b64(1 * MB).length)
  })

  it('le texte pur reste compté à la borne octet (non-régression F-A)', () => {
    const body = { messages: [{ role: 'user', content: 'x'.repeat(40_000) }] }
    const est = estimateInputTokens('anthropic', body)
    expect(est).toBeGreaterThanOrEqual(40_000) // le gros prompt reste couvert
    expect(est).toBeLessThan(41_000)
  })

  it("jamais négatif ni NaN, même sur des shapes média dégénérées", () => {
    const est = estimateInputTokens('anthropic', {
      messages: [{ content: [{ type: 'image', source: { data: '' } }] }],
    })
    expect(Number.isFinite(est)).toBe(true)
    expect(est).toBeGreaterThanOrEqual(0)
  })

  it('bout en bout : la réserve pour « 1 image + question » redevient de l’ordre du dollar, pas 30+ $', () => {
    const est = estimateInputTokens('anthropic', {
      messages: [
        {
          content: [
            { type: 'text', text: 'Décris cette façade.' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: b64(8 * MB) },
            },
          ],
        },
      ],
    })
    const reserveMicro = estimateReserveMicro('claude-sonnet-5', 8_192, est)
    // Avant le fix : ~10,7 M tokens × $3/M × markup ≈ 48 000 000 µ$ (48 $).
    // Après : (≈21 k input × $3/M + 8 192 output × $15/M) × 1,5 ≈ 280 k µ$.
    expect(reserveMicro).toBeLessThan(2_000_000) // < 2 $
    expect(reserveMicro).toBeGreaterThan(100_000) // toujours une vraie réserve
  })
})
