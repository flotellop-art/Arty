import type { ToolHandler } from './types'
import { createSheet, appendRow } from '../sheetsClient'
import { readMemory } from '../memoryService'

export const sheetsToolDefinitions = [
  {
    name: 'export_clients_to_sheets',
    description: "Exporter tous les clients connus vers un nouveau Google Sheet. Crée une feuille avec des colonnes : nom, téléphone, email, adresse, résumé.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Titre du document Google Sheets (défaut: "Clients Arty").' },
      },
    },
  },
  {
    name: 'export_projets_to_sheets',
    description: 'Exporter tous les projets vers un nouveau Google Sheet. Colonnes : nom, statut, date, résumé.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Titre du document (défaut: "Projets Arty").' },
      },
    },
  },
]

function escape(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

export function createSheetsHandlers(): Record<string, ToolHandler> {
  return {
    export_clients_to_sheets: async (input) => {
      const title = (input.title as string) || 'Clients Arty'
      const clients = await readMemory('clients') as Array<Record<string, unknown>>
      if (!Array.isArray(clients) || clients.length === 0) {
        return { result: 'Aucun client à exporter.' }
      }
      const headers = ['Nom', 'Téléphone', 'Email', 'Adresse', 'Résumé']
      try {
        const { spreadsheetId, url } = await createSheet(title, headers)
        const rows = clients.map((c) => [
          escape(c.nom),
          escape(c.telephone || c.tel),
          escape(c.email),
          escape(c.adresse),
          escape(c.resume),
        ])
        await appendRow(spreadsheetId, 'Feuille 1', rows as unknown as string[])
        return { result: `✅ ${clients.length} client(s) exportés vers Google Sheets.\nLien : ${url}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'export échoué'}` }
      }
    },

    export_projets_to_sheets: async (input) => {
      const title = (input.title as string) || 'Projets Arty'
      const projets = await readMemory('projets') as Array<Record<string, unknown>>
      if (!Array.isArray(projets) || projets.length === 0) {
        return { result: 'Aucun projet à exporter.' }
      }
      const headers = ['Nom', 'Statut', 'Date', 'Résumé']
      try {
        const { spreadsheetId, url } = await createSheet(title, headers)
        const rows = projets.map((p) => [
          escape(p.nom || p.titre || p.adresse),
          escape(p.statut || p.status),
          escape(p.date),
          escape(p.resume),
        ])
        await appendRow(spreadsheetId, 'Feuille 1', rows as unknown as string[])
        return { result: `✅ ${projets.length} projet(s) exportés vers Google Sheets.\nLien : ${url}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'export échoué'}` }
      }
    },
  }
}
