import type { useBrowser } from '../../hooks/useBrowser'
import type { ToolHandler } from './types'
import { openReport } from '../reportGenerator'
import { updateMemory } from '../memoryService'
import { safeJson } from '../../utils/safeJson'
import { apiUrl } from '../apiBase'

export const utilityToolDefinitions = [
  {
    name: 'generate_report',
    description: "Génère un rapport HTML professionnel ouvert dans le navigateur. UTILISE CET OUTIL quand l'utilisateur demande un rapport, un devis, une analyse, un document structuré.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Titre du rapport' },
        content: { type: 'string' as const, description: 'Contenu HTML (utilise: card, card-accent, card-dark, chapter, big-number, subtitle, badge-*, grid-2, grid-3, table, alert-*, divider-accent, progress-bar, stat, etc.)' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'calculate_quote',
    description: 'Calcule un chiffrage/devis. Surface × tarif + TVA.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: { type: 'string' as const, description: 'Liste des postes au format JSON: [{"label":"Prestation","surface":120,"price_per_m2":45},...]' },
        tva_rate: { type: 'number' as const, description: 'Taux TVA en % (10 ou 20)' },
        client_name: { type: 'string' as const, description: 'Nom du client' },
      },
      required: ['items', 'tva_rate'],
    },
  },
  {
    name: 'calculate_surface',
    description: 'Calcule une surface (largeur × hauteur - ouvertures).',
    input_schema: {
      type: 'object' as const,
      properties: {
        walls: { type: 'string' as const, description: 'Murs JSON: [{"width":10,"height":3},...]' },
        openings: { type: 'string' as const, description: 'Ouvertures JSON: [{"width":1.2,"height":1.5,"count":3},...]' },
      },
      required: ['walls'],
    },
  },
  {
    name: 'calculate_distance',
    description: 'Calcule la distance et le temps de trajet depuis Valence vers une adresse de chantier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string' as const, description: 'Adresse de destination' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'get_weather',
    description: 'Obtenir la météo actuelle et prévisions 5 jours.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string' as const, description: 'Ville (défaut: Valence)' },
      },
    },
  },
  {
    name: 'ask_user',
    description: "Pose des questions à l'utilisateur via un formulaire interactif (modal étape par étape). Utilise-le quand tu as besoin de 2+ infos pour avancer. Chaque question apparaît une par une avec des options cliquables.",
    input_schema: {
      type: 'object' as const,
      properties: {
        questions: {
          type: 'array' as const,
          description: 'Liste des questions à poser',
          items: {
            type: 'object' as const,
            properties: {
              question: { type: 'string' as const, description: 'La question à poser' },
              options: { type: 'array' as const, items: { type: 'string' as const }, description: 'Options de réponse cliquables (optionnel)' },
              allow_free_text: { type: 'boolean' as const, description: 'Autoriser la saisie libre en plus des options (défaut: true)' },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'update_memory',
    description: "Met à jour la mémoire persistante. Catégories : profil (préférences utilisateur), clients (fiches clients), chantiers (historique chantiers), notes (infos diverses). Envoie le JSON COMPLET de la catégorie (pas un diff).",
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, enum: ['profil', 'clients', 'chantiers', 'notes'], description: 'Catégorie à mettre à jour' },
        data: { description: 'Données complètes (JSON). Pour clients/chantiers: tableau. Pour profil: objet. Pour notes: tableau de strings.' },
      },
      required: ['category', 'data'],
    },
  },
  {
    name: 'search_price',
    description: 'Recherche prix chez fournisseurs BTP (Point P, Gedimat).',
    input_schema: {
      type: 'object' as const,
      properties: {
        product: { type: 'string' as const, description: 'Produit à chercher' },
      },
      required: ['product'],
    },
  },
]

export function createUtilityHandlers(browserActions: ReturnType<typeof useBrowser>): Record<string, ToolHandler> {
  return {
    generate_report: async (input) => {
      const title = input.title as string
      const content = input.content as string
      const reportId = openReport(title, content)
      return { result: `Rapport "${title}" prêt. Lien : [📄 Ouvrir le rapport](${window.location.origin}/report/${reportId})` }
    },

    calculate_surface: async (input) => {
      try {
        const walls = JSON.parse(input.walls as string) as Array<{ width: number; height: number }>
        const openings = input.openings ? JSON.parse(input.openings as string) as Array<{ width: number; height: number; count: number }> : []

        let totalWall = 0
        walls.forEach(w => { totalWall += w.width * w.height })

        let totalOpenings = 0
        openings.forEach(o => { totalOpenings += o.width * o.height * (o.count || 1) })

        const net = totalWall - totalOpenings
        return { result: `Surface brute : ${totalWall.toFixed(2)} m²\nOuvertures : ${totalOpenings.toFixed(2)} m²\nSurface nette : ${net.toFixed(2)} m²` }
      } catch { return { result: 'Erreur: format JSON invalide.' } }
    },

    calculate_distance: async (input) => {
      const dest = input.destination as string
      try {
        const res = await fetch(apiUrl('/api/browser/search'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `distance Valence 26000 vers ${dest}` }),
        })
        const data = await safeJson(res)
        if (data.results && data.results.length > 0) {
          return { result: `Recherche distance Valence → ${dest}:\n${data.results.slice(0, 3).map((r: { title: string; snippet: string }) => `${r.title}: ${r.snippet}`).join('\n')}` }
        }
        return { result: `Impossible de calculer la distance vers ${dest}.` }
      } catch { return { result: 'Erreur calcul distance.' } }
    },

    get_weather: async (input) => {
      const city = (input.city as string) || 'Valence'
      try {
        const res = await fetch(apiUrl('/api/browser/weather'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city }),
        })
        const data = await safeJson(res)
        if (data.current) {
          let result = `Météo ${data.city} : ${data.current.condition}, ${data.current.temperature}°C, vent ${data.current.wind} km/h\n\nPrévisions :\n`
          result += data.forecast.map((d: { date: string; min: number; max: number; rain_chance: number; condition: string }) =>
            `${d.date} : ${d.condition} ${d.min}°/${d.max}° — pluie ${d.rain_chance}%`
          ).join('\n')
          return { result }
        }
        return { result: `Erreur: ${data.error || 'météo indisponible'}` }
      } catch { return { result: 'Erreur météo.' } }
    },

    calculate_quote: async (input) => {
      try {
        const items = JSON.parse(input.items as string) as Array<{ label: string; surface: number; price_per_m2: number }>
        const tvaRate = (input.tva_rate as number) || 10
        const clientName = (input.client_name as string) || ''

        let totalHT = 0
        const lines = items.map(item => {
          const lineTotal = item.surface * item.price_per_m2
          totalHT += lineTotal
          return `${item.label} : ${item.surface} m² × ${item.price_per_m2}€ = ${lineTotal.toFixed(2)}€ HT`
        })

        const tva = totalHT * tvaRate / 100
        const ttc = totalHT + tva

        let result = `DEVIS${clientName ? ` — ${clientName}` : ''}\n${'='.repeat(40)}\n`
        result += lines.join('\n')
        result += `\n${'—'.repeat(40)}`
        result += `\nTotal HT : ${totalHT.toFixed(2)}€`
        result += `\nTVA ${tvaRate}% : ${tva.toFixed(2)}€`
        result += `\nTotal TTC : ${ttc.toFixed(2)}€`

        return { result }
      } catch { return { result: 'Erreur: format items invalide.' } }
    },

    update_memory: async (input) => {
      const category = input.category as 'profil' | 'clients' | 'chantiers' | 'notes'
      const data = input.data
      if (!category || !data) return { result: 'Erreur: catégorie ou données manquantes.' }
      const res = await updateMemory(category, data)
      return { result: res.message }
    },

    search_price: async (input) => {
      const product = input.product as string
      const res = await browserActions.searchPrices(product)
      if (res) {
        const table = res.results.map(r =>
          `${r.source}: ${r.product} — ${r.price}`
        ).join('\n')
        return { result: `Prix pour "${product}":\n${table}` }
      }
      return { result: 'Erreur: recherche prix échouée.' }
    },
  }
}
