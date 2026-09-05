import { parseOfficeExport } from '../services/officeExport/parse'
import { packOfficeExport } from '../services/officeExport/pack'
import type { ExportSnapshot, ExportDocument, ExportChoices } from '../services/officeExport/types'

// External same-origin Vite worker: compatible with the existing CSP, no blob worker.
let document: ExportDocument | null = null
let busy = false
self.onmessage = async (event: MessageEvent<{ id: string; kind: 'parse'; snapshot: ExportSnapshot } | { id: string; kind: 'pack'; choices: ExportChoices }>) => {
  if (busy) return
  busy = true
  try {
    const request = event.data
    if (request.kind === 'parse') { document = parseOfficeExport(request.snapshot); self.postMessage({ id: request.id, document }) }
    else {
      if (!document) throw new Error('Aperçu requis avant export.')
      const buffer = await packOfficeExport(document, request.choices)
      self.postMessage({ id: request.id, buffer }, { transfer: [buffer] })
    }
  } catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'Export impossible.' }) }
  finally { busy = false }
}
