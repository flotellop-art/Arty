import { getActiveUserId } from './userSession'

const MEMORY_CATEGORIES = ['profil', 'clients', 'chantiers', 'notes'] as const
type MemoryCategory = typeof MEMORY_CATEGORIES[number]

export interface MemoryData {
  profil: Record<string, unknown>
  clients: Record<string, unknown>[]
  chantiers: Record<string, unknown>[]
  notes: string[]
}

function getDefaultData(category: MemoryCategory): unknown {
  switch (category) {
    case 'profil':
      return {
        preferences: {},
        habitudes: {},
        fournisseurs: {},
        derniereMAJ: new Date().toISOString(),
      }
    case 'clients':
      return []
    case 'chantiers':
      return []
    case 'notes':
      return []
  }
}

// ─── D1 memory storage ───

async function readMemoryD1(category: MemoryCategory): Promise<unknown> {
  const userId = getActiveUserId()
  if (!userId) return getDefaultData(category)

  try {
    const res = await fetch('/api/memory/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'read', userId, category }),
    })
    const result = await res.json() as { data: unknown }
    return result.data ?? getDefaultData(category)
  } catch {
    return getDefaultData(category)
  }
}

async function updateMemoryD1(category: MemoryCategory, data: unknown): Promise<{ success: boolean; message: string }> {
  const userId = getActiveUserId()
  if (!userId) return { success: false, message: 'Non connecté' }

  try {
    const res = await fetch('/api/memory/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'write', userId, category, data }),
    })
    if (!res.ok) return { success: false, message: 'Erreur D1' }
    return { success: true, message: `Mémoire "${category}" mise à jour.` }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Erreur' }
  }
}

// ─── Public API (auto-selects Drive or D1) ───

export async function readMemory(category: MemoryCategory): Promise<unknown> {
  // Always use D1 for all users
  return readMemoryD1(category)
}

export async function readAllMemory(): Promise<MemoryData> {
  const [profil, clients, chantiers, notes] = await Promise.all([
    readMemory('profil'),
    readMemory('clients'),
    readMemory('chantiers'),
    readMemory('notes'),
  ])

  return {
    profil: profil as Record<string, unknown>,
    clients: clients as Record<string, unknown>[],
    chantiers: chantiers as Record<string, unknown>[],
    notes: notes as string[],
  }
}

export async function updateMemory(
  category: MemoryCategory,
  data: unknown
): Promise<{ success: boolean; message: string }> {
  return updateMemoryD1(category, data)
}

export function formatMemoryForPrompt(memory: MemoryData): string {
  const parts: string[] = []

  // Profil
  if (memory.profil && Object.keys(memory.profil).length > 0) {
    parts.push(`PROFIL UTILISATEUR :\n${JSON.stringify(memory.profil, null, 2)}`)
  }

  // Clients
  if (memory.clients && memory.clients.length > 0) {
    const clientSummary = memory.clients
      .slice(0, 20)
      .map((c) => `- ${c.nom || 'Inconnu'}: ${c.resume || JSON.stringify(c)}`)
      .join('\n')
    parts.push(`CLIENTS CONNUS (${memory.clients.length}) :\n${clientSummary}`)
  }

  // Chantiers
  if (memory.chantiers && memory.chantiers.length > 0) {
    const chantierSummary = memory.chantiers
      .slice(0, 20)
      .map((ch) => `- ${ch.adresse || ch.nom || 'Inconnu'}: ${ch.resume || JSON.stringify(ch)}`)
      .join('\n')
    parts.push(`CHANTIERS (${memory.chantiers.length}) :\n${chantierSummary}`)
  }

  // Notes
  if (memory.notes && memory.notes.length > 0) {
    parts.push(`NOTES :\n${memory.notes.slice(-10).map((n) => `- ${n}`).join('\n')}`)
  }

  if (parts.length === 0) return ''
  return `\n\nMÉMOIRE PERSISTANTE (stockée sur Drive, mise à jour auto) :\n${parts.join('\n\n')}`
}

/** Reset (call on logout) */
export function resetMemoryCache(): void {
  // No local cache to clear — D1 handles everything server-side
}
