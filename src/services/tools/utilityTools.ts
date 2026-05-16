import type { useBrowser } from '../../hooks/useBrowser'
import type { ToolHandler } from './types'
import { openReport } from '../reportGenerator'
import { updateMemory } from '../memoryService'
import { safeJson } from '../../utils/safeJson'
import { apiUrl } from '../apiBase'
import { getUserLocation, isLocationConsentEnabled } from '../native/location'

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
    name: 'calculate_distance',
    description: "Calcule la distance et le temps de trajet entre un point d'origine et une destination. Si origin est omis ET que la géolocalisation utilisateur est active, utilise sa position GPS ; sinon demande l'origine à l'utilisateur.",
    input_schema: {
      type: 'object' as const,
      properties: {
        origin: { type: 'string' as const, description: "Point de départ (ville ou adresse). Omis = utilise la position GPS de l'utilisateur si disponible." },
        destination: { type: 'string' as const, description: 'Adresse de destination' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'get_weather',
    description: "Obtenir la météo actuelle et prévisions 5 jours pour une ville. Si city est omis ET que la géolocalisation utilisateur est active, utilise sa position GPS ; sinon demande la ville à l'utilisateur.",
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string' as const, description: "Ville. Omis = utilise la position GPS de l'utilisateur si disponible." },
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
    description: "Met à jour la mémoire persistante. Catégories : profil (préférences utilisateur), clients (fiches contacts), projets (projets et dossiers suivis), notes (infos diverses). Envoie le JSON COMPLET de la catégorie (pas un diff).",
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, enum: ['profil', 'clients', 'projets', 'notes'], description: 'Catégorie à mettre à jour' },
        data: { description: 'Données complètes (JSON). Pour clients/projets: tableau. Pour profil: objet. Pour notes: tableau de strings.' },
      },
      required: ['category', 'data'],
    },
  },
  {
    name: 'search_price',
    description: "Recherche le prix d'un produit chez des marchands en ligne.",
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

    calculate_distance: async (input) => {
      const dest = input.destination as string
      let origin = (input.origin as string | undefined)?.trim() || ''

      if (!origin && isLocationConsentEnabled()) {
        const pos = await getUserLocation()
        if (pos) origin = `latitude ${pos.latitude.toFixed(5)}, longitude ${pos.longitude.toFixed(5)}`
      }
      if (!origin) {
        return { result: "Précise un point de départ (ville ou adresse). La géolocalisation n'est pas activée." }
      }

      try {
        const res = await fetch(apiUrl('/api/browser/search'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `distance ${origin} vers ${dest}` }),
        })
        const data = await safeJson(res)
        if (data.results && data.results.length > 0) {
          return { result: `Distance ${origin} → ${dest} :\n${data.results.slice(0, 3).map((r: { title: string; snippet: string }) => `${r.title}: ${r.snippet}`).join('\n')}` }
        }
        return { result: `Impossible de calculer la distance de ${origin} vers ${dest}.` }
      } catch { return { result: 'Erreur calcul distance.' } }
    },

    get_weather: async (input) => {
      let city = (input.city as string | undefined)?.trim() || ''

      if (!city && isLocationConsentEnabled()) {
        const pos = await getUserLocation()
        if (pos) city = `${pos.latitude.toFixed(5)},${pos.longitude.toFixed(5)}`
      }
      if (!city) {
        return { result: "Précise une ville. La géolocalisation n'est pas activée." }
      }

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

    update_memory: async (input) => {
      const category = input.category as 'profil' | 'clients' | 'projets' | 'notes'
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
