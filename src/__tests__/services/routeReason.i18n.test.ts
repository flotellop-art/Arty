// Refonte routage (étape 4) — parité i18n des raisons de routage.
// Chaque ReasonCode émis par resolveRoute DOIT avoir sa traduction fr ET en
// (`chat.routeReason.<code>`), sinon le footer/la sheet afficheraient une clé
// brute. Même pattern que le test de parité des ids de modelLabels.test.ts :
// ajouter un code sans ses 2 clés = CI rouge.
import { describe, expect, it } from 'vitest'
import { ALL_REASON_CODES } from '../../services/router/types'
import fr from '../../i18n/locales/fr.json'
import en from '../../i18n/locales/en.json'

type LocaleShape = { chat: { routeReason: Record<string, string>; override: Record<string, string> } }
const frChat = (fr as unknown as LocaleShape).chat
const enChat = (en as unknown as LocaleShape).chat

describe('parité i18n chat.routeReason.*', () => {
  it.each([...ALL_REASON_CODES])('« %s » a une clé fr ET en non vide', (code) => {
    expect(frChat.routeReason[code], `fr manquant: chat.routeReason.${code}`).toBeTruthy()
    expect(enChat.routeReason[code], `en manquant: chat.routeReason.${code}`).toBeTruthy()
  })

  it('aucune clé routeReason orpheline (i18n sans code correspondant)', () => {
    const codes = new Set<string>(ALL_REASON_CODES)
    for (const locale of [frChat, enChat]) {
      for (const key of Object.keys(locale.routeReason)) {
        expect(codes.has(key), `clé i18n sans ReasonCode: ${key}`).toBe(true)
      }
    }
  })
})

describe('parité i18n chat.override.*', () => {
  // Les seuls codes qu'un RouteOverride peut porter (cf. resolveRoute) :
  // mode Europe → Mistral, fichiers → Claude, données privées → Claude.
  const OVERRIDE_CODES = ['eu_only', 'files_to_claude', 'private_data', 'fallback_no_provider']

  it.each(OVERRIDE_CODES)('« %s » a une clé fr ET en non vide', (code) => {
    expect(frChat.override[code], `fr manquant: chat.override.${code}`).toBeTruthy()
    expect(enChat.override[code], `en manquant: chat.override.${code}`).toBeTruthy()
  })

  it('les clés fr/en override sont identiques (pas de dérive de structure)', () => {
    expect(Object.keys(frChat.override).sort()).toEqual(Object.keys(enChat.override).sort())
  })
})
