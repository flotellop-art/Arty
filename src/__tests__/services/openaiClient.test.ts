// C3 (CDC veille 2026-07) : PREMIER test du client OpenAI — la cartographie
// avait relevé que la logique de fallback (startChatRequest) n'avait aucune
// couverture. Pattern « garde par source » (les constantes ne sont pas
// exportées) + tests runtime des labels Sol/Terra/Luna.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatModelName } from '../../services/modelLabels'
import { hasOpenAIVisionBlocks } from '../../services/openaiClient'

const client = readFileSync(resolve(process.cwd(), 'src/services/openaiClient.ts'), 'utf8')

describe('openaiClient — modèles (C3)', () => {
  it('le défaut est gpt-5.6-terra (décision D-A : −50 % vs gpt-5.5, vérif D1 faite)', () => {
    expect(client).toMatch(/const DEFAULT_MODEL = 'gpt-5\.6-terra'/)
  })

  it('le fallback éligibilité reste gpt-5 (connu bon sur tous les comptes)', () => {
    expect(client).toMatch(/const FALLBACK_MODEL = 'gpt-5'/)
  })

  it('le retry 400/404 « model does not exist » est toujours câblé (pattern startChatRequest)', () => {
    expect(client).toMatch(/payload\.model !== DEFAULT_MODEL/)
    expect(client).toMatch(/FALLBACK_MODEL \}/)
  })

  it('interdit explicitement le fallback dès que le payload contient une image', () => {
    expect(client).toMatch(/if \(hasOpenAIVisionBlocks\(payload\)\) return response/)
    expect(hasOpenAIVisionBlocks({
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } }],
      }],
    })).toBe(true)
    expect(hasOpenAIVisionBlocks({ messages: [{ role: 'user', content: 'texte' }] })).toBe(false)
    expect(client).toContain("headers['x-arty-vision'] = '1'")
  })
})

describe('labels GPT-5.6 — Sol/Terra/Luna distincts (anti-drift PR #323)', () => {
  it.each([
    ['gpt-5.6-terra', 'GPT-5.6 Terra'],
    ['gpt-5.6-sol', 'GPT-5.6 Sol'],
    ['gpt-5.6-luna', 'GPT-5.6 Luna'],
  ])('%s → « %s » (trois modèles différents, jamais fondus en « GPT-5.6 »)', (id, label) => {
    expect(formatModelName(id)).toBe(label)
  })

  it.each([
    ['gpt-5.5', 'GPT-5.5'],
    ['gpt-5-mini', 'GPT-5 Mini'],
    ['gpt-4o-mini', 'GPT-4o Mini'],
  ])('%s → « %s » (labels existants inchangés)', (id, label) => {
    expect(formatModelName(id)).toBe(label)
  })
})
