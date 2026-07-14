// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('privacy and Play submission claims', () => {
  const privacyCopies = [
    'PRIVACY.md',
    'PRIVACY-EN.md',
    'public/privacy/index.html',
    'public/privacy/en/index.html',
  ].map(read)

  it('ne promet jamais une clé secrète propre à l’appareil', () => {
    for (const policy of privacyCopies) {
      expect(policy).not.toMatch(/ne quitte jamais votre appareil|never leaves your device/i)
      expect(policy).not.toMatch(/clés API personnelles \(BYOK\) sont chiffrées|personal API keys \(BYOK\) are encrypted/i)
    }
  })

  it('documente la limite de la clé non-BYOK dans chaque copie publique', () => {
    expect(privacyCopies[0]).toContain("la clé n'est ni secrète ni liée au matériel")
    expect(privacyCopies[1]).toContain('the key is neither secret nor hardware-bound')
    expect(privacyCopies[2]).toContain("la clé n'est ni secrète ni liée au matériel")
    expect(privacyCopies[3]).toContain('the key is neither secret nor hardware-bound')
  })

  it("ne fabrique pas de champ 'chiffrement au repos' dans la matrice Data Safety", () => {
    const submission = `${read('BEFORE-PUBLISHING.md')}\n${read('PLAY-STORE-SUBMISSION.md')}`
    expect(submission).not.toMatch(/Chiffrement au repos\s*:\s*OUI/i)
    expect(submission).toContain("ne demande pas de déclaration « chiffrement au repos »")
  })
})
