// Tests du mode démo preview (revue design sans login). Vérifie le verrou de
// sécurité (allowlist d'hôtes) ET la mécanique session+seed.
import { describe, it, expect, beforeEach } from 'vitest'
import { isPreviewHost, seedDemoData } from '../../services/previewDemo'
import { getActiveSession, clearActiveSession } from '../../services/userSession'
import { getConversations, resetConversationMemCache } from '../../services/storage'

describe('isPreviewHost — verrou de sécurité', () => {
  it('REFUSE tous les hôtes de production', () => {
    for (const h of ['tryarty.com', 'www.tryarty.com', 'app.arty.fr', 'localhost']) {
      expect(isPreviewHost(h)).toBe(false)
    }
  })

  it('REFUSE les domaines .pages.dev NUS de prod (piège audit)', () => {
    expect(isPreviewHost('appfacade.pages.dev')).toBe(false)
    expect(isPreviewHost('arty.pages.dev')).toBe(false)
  })

  it('ACCEPTE uniquement les sous-domaines de preview Cloudflare', () => {
    expect(isPreviewHost('claude-design-g-home.appfacade.pages.dev')).toBe(true)
    expect(isPreviewHost('f27160cf.appfacade.pages.dev')).toBe(true)
    expect(isPreviewHost('CLAUDE-X.APPFACADE.PAGES.DEV')).toBe(true) // insensible casse
  })
})

describe('seedDemoData — session + conversations d\'exemple', () => {
  beforeEach(() => {
    try { localStorage.clear() } catch { /* jsdom */ }
    resetConversationMemCache()
    clearActiveSession()
  })

  it('pose une session démo (authMethod=demo) sans clé API', () => {
    seedDemoData()
    const s = getActiveSession()
    expect(s?.authMethod).toBe('demo')
    expect(s?.displayName).toBe('Aperçu')
    // Aucune clé API stockée → pas de crypto (sécurité audit).
    expect(localStorage.getItem('arty-demo-preview-api-keys')).toBeNull()
  })

  it('seed des conversations d\'exemple visibles', () => {
    seedDemoData()
    const convs = getConversations()
    expect(convs.length).toBeGreaterThanOrEqual(3)
    expect(convs.some((c) => c.euOnly)).toBe(true) // au moins une conv EU pour la démo
  })

  it('ne pollue pas le switcher multi-comptes', () => {
    seedDemoData()
    expect(localStorage.getItem('arty-known-sessions')).toBeNull()
  })

  it('idempotent : re-seed ne double pas les conversations', () => {
    seedDemoData()
    const n1 = getConversations().length
    seedDemoData()
    expect(getConversations().length).toBe(n1)
  })

  it('n\'écrase PAS une vraie session existante', () => {
    // Simule un vrai user connecté.
    localStorage.setItem('arty-active-session', JSON.stringify({
      userId: 'google-abc', authMethod: 'google', displayName: 'Vrai', createdAt: Date.now(),
    }))
    resetConversationMemCache()
    seedDemoData()
    // La session reste celle du vrai user.
    expect(getActiveSession()?.authMethod).toBe('google')
  })
})
