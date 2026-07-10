import type { Env } from '../../env'

/**
 * Catalogue financier Creem partagé par le checkout et le webhook.
 *
 * Les identifiants produit diffèrent entre les environnements test et live :
 * ils doivent donc venir de Cloudflare, jamais du dépôt. Le montant de crédits
 * reste une constante revue dans le code. Une configuration absente ou
 * malformée échoue fermée des deux côtés du flux de paiement.
 */
const CREDIT_PACKS = {
  credits_10: {
    productEnv: 'CREEM_CREDITS_10_PRODUCT_ID',
    amountMicro: 10_000_000,
  },
} as const

export type CreemCreditPack = keyof typeof CREDIT_PACKS

const PRODUCT_ID_PATTERN = /^prod_[A-Za-z0-9]+$/

export function isCreemCreditPack(pack: unknown): pack is CreemCreditPack {
  return typeof pack === 'string' && Object.prototype.hasOwnProperty.call(CREDIT_PACKS, pack)
}

function configuredProductId(env: Env, pack: CreemCreditPack): string | null {
  const envKey = CREDIT_PACKS[pack].productEnv
  const raw = env[envKey]?.trim()
  return raw && PRODUCT_ID_PATTERN.test(raw) ? raw : null
}

export function resolveCreemCheckoutProduct(env: Env, pack: string): string | null {
  if (!isCreemCreditPack(pack)) return null
  return configuredProductId(env, pack)
}

export function resolveCreemCreditAmount(env: Env, productId: string): number | null {
  for (const [pack, config] of Object.entries(CREDIT_PACKS) as Array<
    [CreemCreditPack, (typeof CREDIT_PACKS)[CreemCreditPack]]
  >) {
    if (configuredProductId(env, pack) === productId) return config.amountMicro
  }
  return null
}
