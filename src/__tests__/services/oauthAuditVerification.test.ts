/**
 * OAuth audit — vérification EMPIRIQUE des findings contestés (15 juin 2026).
 *
 * Objectif : trancher le vrai/faux des findings que les passes d'audit
 * statiques laissaient "à confirmer" ou en désaccord de sévérité, en
 * EXÉCUTANT le code réel (crypto, gate serveur) et le SQL réel (schémas D1
 * via node:sqlite). Chaque test cite le finding qu'il prouve/infirme.
 *
 * NB : ce fichier ne couvre PAS ce qui exige la prod (schéma D1 live, APK,
 * round-trip OAuth réel) — ces points restent marqués comme tels dans le
 * rapport.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/userSession', async (importOriginal) => {
  // On garde le VRAI migrateExistingData (c'est le sujet du test M-7), mais on
  // contrôle l'utilisateur actif pour scopedStorage.
  const actual = await importOriginal<typeof import('../../services/userSession')>()
  return { ...actual }
})

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.resetModules()
})

// ───────────────────────────────────────────────────────────────────────────
// M-7 — Collision migrateExistingData ↔ sel crypto GLOBAL (multi-compte)
// Claim : ajouter un 2e compte déplace `arty-crypto-salt` sous un préfixe user
// et SUPPRIME le global → les blobs chiffrés du 1er compte deviennent illisibles.
// crypto.ts lit le sel en GLOBAL (crypto.ts:14,81) ; userSession.LEGACY_KEYS
// inclut 'crypto-salt'/'crypto-check' (userSession.ts:104-105).
// ───────────────────────────────────────────────────────────────────────────
describe('M-7 — crypto salt destroyed by multi-account migration', () => {
  it('migrateExistingData(secondUser) removes the GLOBAL crypto salt', async () => {
    const crypto = await import('../../services/crypto')
    const { migrateExistingData } = await import('../../services/userSession')

    // Compte A établi : crypto initialisé → sel + check écrits en GLOBAL.
    await crypto.initCrypto('server-provided')
    expect(localStorage.getItem('arty-crypto-salt')).toBeTruthy()
    expect(localStorage.getItem('arty-crypto-check')).toBeTruthy()

    // Ajout d'un 2e compte B : sa migration s'exécute (flag pas encore posé).
    migrateExistingData('google-bbbb')

    // Le sel global a été DÉPLACÉ sous le préfixe de B et supprimé du global.
    expect(localStorage.getItem('arty-crypto-salt')).toBeNull()
    expect(localStorage.getItem('arty-google-bbbb-crypto-salt')).toBeTruthy()
    expect(localStorage.getItem('arty-crypto-check')).toBeNull()
  })

  it("first account's encrypted data becomes UNDECRYPTABLE after a 2nd account is added", async () => {
    const crypto = await import('../../services/crypto')
    const { migrateExistingData } = await import('../../services/userSession')

    // Compte A : chiffre un secret avec la clé dérivée du sel global S_A.
    await crypto.initCrypto('server-provided')
    const blobA = await crypto.encrypt('A-refresh-token-secret')
    expect(await crypto.decrypt(blobA)).toBe('A-refresh-token-secret') // lisible

    // Ajout du compte B → migration B détruit le sel global.
    migrateExistingData('google-bbbb')

    // Reboot de l'app (nouvel isolat de module → cachedKey reset).
    vi.resetModules()
    const cryptoFresh = await import('../../services/crypto')

    // A se reconnecte / l'app reboot : initCrypto re-dérive. Sel global absent
    // → un NOUVEAU sel aléatoire est généré → clé différente.
    await cryptoFresh.initCrypto('server-provided')

    // Le blob de A, chiffré avec S_A, ne peut plus être déchiffré (AES-GCM
    // auth-tag mismatch) → PERTE de session/données pour A.
    await expect(cryptoFresh.decrypt(blobA)).rejects.toThrow()
  })

  it('single-account use is NOT affected (migration runs before salt exists, then flag prevents re-run)', async () => {
    const crypto = await import('../../services/crypto')
    const { migrateExistingData } = await import('../../services/userSession')

    // 1er login de A : migration AVANT initCrypto → aucun sel global à déplacer.
    migrateExistingData('google-aaaa')
    await crypto.initCrypto('server-provided')
    const blobA = await crypto.encrypt('A-secret')

    // Reboot : migration A skippée (flag posé), sel global intact.
    vi.resetModules()
    const cryptoFresh = await import('../../services/crypto')
    migrateExistingData('google-aaaa') // no-op (flag déjà posé)
    await cryptoFresh.initCrypto('server-provided')

    expect(await cryptoFresh.decrypt(blobA)).toBe('A-secret') // toujours lisible ✅
  })
})

// ───────────────────────────────────────────────────────────────────────────
// N-1 / M-3 — Validation d'audience du gate serveur
// ───────────────────────────────────────────────────────────────────────────
describe('N-1 / M-3 — Google token audience validation', () => {
  function mockJson(body: unknown, ok = true) {
    global.fetch = vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
    }) as unknown as typeof fetch
    return global.fetch as unknown as ReturnType<typeof vi.fn>
  }

  it('N-1: verifyGoogleUser accepts ANY valid Google token via userinfo (no aud check)', async () => {
    const { verifyGoogleUser } = await import('../../../functions/api/_lib/checkAllowedUser')
    const fetchMock = mockJson({ email: 'Foreign@App.com' })

    const req = new Request('https://arty/api/ai/proxy', {
      method: 'POST',
      headers: { 'x-google-token': 'access-token-issued-for-a-DIFFERENT-app' },
    })
    const email = await verifyGoogleUser(req)

    // Un token émis pour une AUTRE app passe le gate (email retourné, minuscule).
    expect(email).toBe('foreign@app.com')
    // Preuve qu'aucune audience n'est validée : appel à userinfo, jamais tokeninfo.
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain('oauth2/v2/userinfo')
    expect(url).not.toContain('tokeninfo')
  })

  it('M-3: verifyTokenViaTokeninfo BYPASSES audience when the aud field is absent', async () => {
    const { verifyTokenViaTokeninfo } = await import('../../../functions/api/_lib/checkAllowedUser')
    // tokeninfo renvoie un email vérifié SANS champ aud → la garde se court-circuite.
    mockJson({ email: 'x@y.z', email_verified: 'true' })
    const email = await verifyTokenViaTokeninfo('tok', 'MY_CLIENT_ID')
    expect(email).toBe('x@y.z') // BUG confirmé : devrait être null
  })

  it('M-3: verifyTokenViaTokeninfo correctly REJECTS a present-but-wrong aud', async () => {
    const { verifyTokenViaTokeninfo } = await import('../../../functions/api/_lib/checkAllowedUser')
    mockJson({ email: 'x@y.z', email_verified: 'true', aud: 'OTHER_APP', azp: 'OTHER_APP' })
    const email = await verifyTokenViaTokeninfo('tok', 'MY_CLIENT_ID')
    expect(email).toBeNull() // le chemin nominal fonctionne
  })
})

// NB : les tests SQL des schémas D1 (trial/init created_at, upsert
// license/activate, cap free_daily_quota) tournent dans un script node autonome
// (scripts/oauth-audit-sql-checks.mjs) car node:sqlite ne se bundle pas dans
// l'environnement jsdom de Vite.

// ───────────────────────────────────────────────────────────────────────────
// freeQuota — verrou des modèles non-Haiku pour le tier free (pure function)
// ───────────────────────────────────────────────────────────────────────────
describe('freeQuota — non-Haiku models are locked for free tier', () => {
  it('modelFamilyFor returns null for every non-Haiku model (→ 403 freeModelLocked)', async () => {
    const { modelFamilyFor } = await import('../../../functions/api/_lib/freeQuota')
    expect(modelFamilyFor('claude-haiku-4-5-20251001')).toBe('claude-haiku')
    expect(modelFamilyFor('claude-opus-4-8')).toBeNull()
    expect(modelFamilyFor('claude-sonnet-4-6')).toBeNull()
    expect(modelFamilyFor('gemini-2.5-pro')).toBeNull()
    expect(modelFamilyFor('mistral-medium')).toBeNull()
    expect(modelFamilyFor('gpt-4o')).toBeNull()
  })
})
