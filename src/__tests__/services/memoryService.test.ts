import { describe, it, expect, vi } from 'vitest'

// memoryService importe des deps réseau au top-level (jamais appelées par la
// fonction pure testée). On les neutralise pour un import propre.
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => 'u' }))

import { formatMemoryForPrompt, type MemoryData } from '../../services/memoryService'

function mem(over: Partial<MemoryData> = {}): MemoryData {
  return { profil: {}, clients: [], projets: [], notes: [], ...over }
}

// Génère N clients génériques + injecte des entrées nommées spécifiques.
function clients(n: number, extra: Record<string, unknown>[] = []): Record<string, unknown>[] {
  const base = Array.from({ length: n }, (_, i) => ({
    nom: `Generic${i}`,
    resume: `client générique numéro ${i}`,
  }))
  return [...base, ...extra]
}

describe('formatMemoryForPrompt — sélection par pertinence (P2)', () => {
  it('legacy (sans userMessage) : injecte tous les clients (cap 20)', () => {
    const out = formatMemoryForPrompt(mem({ clients: clients(12) }))
    expect(out).toContain('CLIENTS CONNUS (12)')
    expect(out).toContain('Generic0')
    expect(out).toContain('Generic11')
  })

  it('petite liste (≤ 8) + trigger : passthrough, tout injecté', () => {
    const out = formatMemoryForPrompt(
      mem({ clients: clients(5, [{ nom: 'Dupont', resume: 'plombier' }]) }),
      "rappelle-moi l'adresse de Dupont",
    )
    // 6 clients ≤ 8 → tous présents, pas de sélection.
    expect(out).toContain('CLIENTS CONNUS (6)')
    expect(out).toContain('Dupont')
    expect(out).toContain('Generic0')
  })

  it('grande liste + requête ciblée : ne garde que la fiche pertinente', () => {
    const list = clients(11, [{ nom: 'Dupont', resume: 'plombier à Lyon' }])
    // 'Zorglub' est un client générique qu'on ne doit PAS voir injecté.
    list[0] = { nom: 'Zorglub', resume: 'client générique zéro' }
    const out = formatMemoryForPrompt(mem({ clients: list }), "rappelle-moi l'adresse de Dupont")
    expect(out).toContain('Dupont')
    expect(out).not.toContain('Zorglub')
    expect(out).toContain('sélection pertinente')
  })

  it('grande liste + requête générique (0 token utile) : fallback cap, rien perdu', () => {
    // "mes clients" → tokens 'mes'/'clients' sont des stopwords → 0 token.
    const out = formatMemoryForPrompt(mem({ clients: clients(12) }), 'parle-moi de mes clients')
    expect(out).toContain('Generic0')
    expect(out).toContain('Generic11')
    expect(out).toContain('CLIENTS CONNUS (12)')
  })

  it('garde anti-régression : requête agrégative (bcp de matches) → liste entière', () => {
    // 12 clients dont 8 à Paris ; "Paris" matche 8/12 → > 50% → cap complet.
    const list = clients(4).concat(
      Array.from({ length: 8 }, (_, i) => ({ nom: `Pari${i}`, resume: 'basé à Paris' })),
    )
    const out = formatMemoryForPrompt(mem({ clients: list }), 'mes clients à Paris')
    // Tous présents (y compris les 4 hors Paris) — pas de troncature.
    expect(out).toContain('Generic0')
    expect(out).toContain('Pari7')
    expect(out).toContain('CLIENTS CONNUS (12)')
  })

  it('normalise les accents des deux côtés (heloise ~ Héloïse)', () => {
    const list = clients(11, [{ nom: 'Héloïse Décourty', resume: 'designer' }])
    const out = formatMemoryForPrompt(mem({ clients: list }), 'mon contact heloise')
    expect(out).toContain('Héloïse')
    expect(out).not.toContain('Generic5')
  })

  it('score sur tous les champs string (pas seulement nom/resume)', () => {
    const list = clients(11, [{ nom: 'AcmeCorp', metier: 'maçonnerie', ville: 'Grenoble' }])
    const out = formatMemoryForPrompt(mem({ clients: list }), 'mon client en maçonnerie')
    expect(out).toContain('AcmeCorp')
    expect(out).not.toContain('Generic3')
  })

  it('projets : sélection sur le champ titre quand nom absent', () => {
    const projets = Array.from({ length: 11 }, (_, i) => ({ titre: `Projet${i}`, resume: 'r' }))
    projets.push({ titre: 'Refonte site Lambda', resume: 'site vitrine' })
    const out = formatMemoryForPrompt(mem({ projets }), 'où en est le projet Lambda')
    expect(out).toContain('Lambda')
    expect(out).not.toContain('Projet0')
  })

  it('chemin brief (userMessage = " ") : Tier 1 NON injecté', () => {
    const out = formatMemoryForPrompt(
      mem({ profil: { prenom: 'Flo' }, clients: clients(12) }),
      ' ',
    )
    expect(out).toContain('Flo') // profil minimal Tier 0
    expect(out).not.toContain('Generic0') // pas de clients
  })
})
