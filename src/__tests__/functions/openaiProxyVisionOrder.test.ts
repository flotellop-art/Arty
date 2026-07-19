// Garde structurelle : la validation doit rester avant les opérations qui
// consomment trial, wallet, quota ou cap dans le proxy OpenAI.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'functions/api/ai/openai-proxy.ts'), 'utf8')
const unchangedPdfProxies = ['proxy.ts', 'gemini-proxy.ts', 'mistral-proxy.ts'].map((name) =>
  readFileSync(resolve(process.cwd(), 'functions/api/ai', name), 'utf8'),
)
const walletSource = readFileSync(resolve(process.cwd(), 'functions/api/_lib/walletBilling.ts'), 'utf8')

describe('openai-proxy — ordre fail-closed vision', () => {
  it('borne et valide avant tout débit', () => {
    const read = source.indexOf('readRequestTextWithLimit(request')
    const validate = source.indexOf('validateOpenAIVisionPayload(parsedPayload)')
    const streamValidate = source.indexOf('validateOpenAIVisionStream(validationBody')
    const trial = source.indexOf('await consumeEmailTrialMessage')
    const allowed = source.indexOf('await checkAllowedUser(request, env)')
    const wallet = source.indexOf('await beginWalletBilling')
    const quota = source.indexOf('await consumeDailyQuota')
    const cap = source.indexOf('await checkPremiumCap')
    expect(read).toBeGreaterThan(0)
    expect(validate).toBeGreaterThan(read)
    expect(streamValidate).toBeGreaterThan(0)
    for (const sideEffect of [trial, allowed, wallet, quota, cap]) {
      expect(sideEffect).toBeGreaterThan(validate)
      expect(sideEffect).toBeGreaterThan(streamValidate)
    }
  })

  it('garde le killswitch avant tout débit et masque le body des logs', () => {
    expect(source.indexOf("env.OPENAI_VISION_ENABLED !== 'true'")).toBeGreaterThan(0)
    expect(source).not.toMatch(/console\.error\([^\n]*errorText/)
  })

  it('ne pose pas la borne OpenAI sur les proxys pouvant porter les PDF historiques', () => {
    for (const proxy of unchangedPdfProxies) {
      expect(proxy).not.toContain('boundedRequestBody')
      expect(proxy).not.toContain('OPENAI_CHAT_BODY_MAX_BYTES')
    }
  })

  it("n'alloue pas une copie UTF-8 du JSON complet pour estimer le wallet", () => {
    expect(walletSource).not.toMatch(/TextEncoder[\s\S]{0,80}JSON\.stringify\(body\)/)
    expect(walletSource).not.toContain("JSON.stringify(body)")
  })

  it('réserve 40 Mio au transport vision streaming et borne le DOM texte à 10 Mio', () => {
    expect(source).toContain("request.headers.get('x-arty-vision') === '1'")
    expect(source).toContain('validateOpenAIVisionStream(validationBody, OPENAI_CHAT_BODY_MAX_BYTES)')
    expect(source).toContain('readRequestTextWithLimit(request, OPENAI_TEXT_BODY_MAX_BYTES)')
  })
})
