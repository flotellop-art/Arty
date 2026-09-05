import { assertProjectOperation, getProject, readProjectDocumentText, type ProjectOperation } from './store'
import { PROJECT_LIMITS, ProjectError, type Project, type ProjectSourceReference } from './types'

export interface ProjectExcerpt { reference: ProjectSourceReference; text: string }
export interface ProjectContext {
  projectId: string; projectRevision: number; name: string; instructions: string; euOnly: boolean
  mode: 'search' | 'overview'; excerpts: ProjectExcerpt[]; examinedDocuments: number
  truncated: boolean; noHit: boolean; textChars: number; promptChars: number
}
const STOP_WORDS = new Set(('a au aux avec ce ces cette dans de des du elle en est et il je la le les leur lui ma mais me mes mon ne nos notre nous on ou par pas pour que quelle quelles quels qui sa se ses son sur ta te tes ton tu un une vos votre vous y the a an and are as at be by for from in is it its of on or that these this to was were with you your document documents fichier fichiers résume resume synthèse synthese summarize summary').split(' '))
function normalizeForSearch(value: string): string { return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() }
function terms(query: string): string[] {
  return [...new Set(normalizeForSearch(query).match(/[\p{L}\p{N}]{2,64}/gu) ?? [])].filter(word => !STOP_WORDS.has(word)).slice(0, 32)
}
type Chunk = { text: string; startLine: number; endLine: number; partial: boolean; score: number }
/** Bounded, deterministic local lexical retrieval. Never sends files to a search service. */
function chunks(text: string, queryTerms: string[], overview: boolean): Chunk[] {
  const lines = text.split('\n'), result: Chunk[] = []
  let buffer = '', startLine = 1, endLine = 1
  const flush = (partial: boolean) => {
    if (!buffer.trim()) { buffer = ''; return }
    const lower = normalizeForSearch(buffer)
    const score = queryTerms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0)
    if (overview || score > 0) result.push({ text: buffer, startLine, endLine, partial, score })
    buffer = ''
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // Long lines get explicit partial locators; no invented page boundaries.
    if (line.length > 1800) {
      flush(false)
      // 64 Unicode code points can occupy 128 UTF-16 units. Overlap prevents
      // a boundary from losing even an astral-letter query term.
      for (let offset = 0; offset < line.length; offset += 1672) {
        startLine = endLine = i + 1; buffer = line.slice(offset, offset + 1800); flush(true)
      }
      continue
    }
    if (buffer && buffer.length + line.length + 1 > 1800) flush(false)
    if (!buffer) startLine = i + 1
    buffer += (buffer ? '\n' : '') + line; endLine = i + 1
  }
  flush(false)
  return result
}
export async function buildProjectContext(
  operation: ProjectOperation, project: Project, query: string,
  options: { mode?: 'search' | 'overview'; documentIds?: string[] } = {},
): Promise<ProjectContext> {
  operation.assertCurrent()
  if (typeof query !== 'string' || query.length > PROJECT_LIMITS.queryChars) throw new ProjectError('limit')
  const summary = await getProject(operation, project.id)
  if (!summary || summary.status === 'deleted') throw new ProjectError('deleted')
  if (summary.status !== 'ready' || !summary.project) throw new ProjectError('locked')
  const current = summary.project
  if (current.revision !== project.revision) throw new ProjectError('conflict')
  const mode = options.mode ?? 'search'
  const ids = options.documentIds ? [...new Set(options.documentIds)] : current.documents.map(document => document.id)
  if (ids.length > PROJECT_LIMITS.documentsPerProject || ids.some(id => !current.documents.some(document => document.id === id))) throw new ProjectError('deleted')
  // Overview is an explicit user choice, never an automatic no-hit fallback.
  if (mode === 'overview' && (!options.documentIds || ids.length === 0)) throw new ProjectError('unsupported')
  const queryTerms = terms(query), candidates: (ProjectExcerpt & { score: number; order: number })[] = []
  let examinedDocuments = 0, totalTextChars = 0
  for (const id of ids) {
    operation.assertCurrent()
    const descriptor = current.documents.find(document => document.id === id)!
    const text = await readProjectDocumentText(operation, current, id)
    totalTextChars += text.length
    if (totalTextChars > PROJECT_LIMITS.projectTextChars) throw new ProjectError('limit')
    examinedDocuments++
    for (const chunk of chunks(text, queryTerms, mode === 'overview')) {
      candidates.push({ text: chunk.text, score: chunk.score, order: candidates.length,
        reference: { projectId: current.id, projectRevision: current.revision, documentId: id, documentRevision: descriptor.revision,
          sourceHash: descriptor.sourceHash, extractorVersion: descriptor.extractorVersion, name: descriptor.name, format: descriptor.format,
          startLine: chunk.startLine, endLine: chunk.endLine, partial: chunk.partial } })
    }
  }
  // Overview interleaves documents, so a long first document does not hide the
  // presence of the other selected documents without any excerpt from them.
  if (mode === 'search') candidates.sort((a, b) => b.score - a.score || a.order - b.order)
  else {
    const ranks = new Map<string, number>()
    const ranked = new Map<number, number>()
    for (const c of candidates) { const rank = ranks.get(c.reference.documentId) ?? 0; ranked.set(c.order, rank); ranks.set(c.reference.documentId, rank + 1) }
    candidates.sort((a, b) => ranked.get(a.order)! - ranked.get(b.order)! || a.order - b.order)
  }
  let textChars = 0, promptChars = current.instructions.length + 300
  const excerpts: ProjectExcerpt[] = []
  for (const candidate of candidates) {
    const cost = candidate.text.length + JSON.stringify(candidate.reference).length + 15
    if (excerpts.length >= PROJECT_LIMITS.contextChunks || promptChars + cost > PROJECT_LIMITS.contextChars) break
    excerpts.push({ text: candidate.text, reference: candidate.reference }); textChars += candidate.text.length; promptChars += cost
  }
  await assertProjectOperation(operation)
  const latest = await getProject(operation, current.id)
  if (!latest || latest.status === 'deleted') throw new ProjectError('deleted')
  if (latest.revision !== current.revision || latest.status !== 'ready') throw new ProjectError('conflict')
  return { projectId: current.id, projectRevision: current.revision, name: current.name, instructions: current.instructions,
    euOnly: current.euOnly, mode, excerpts, examinedDocuments, truncated: excerpts.length < candidates.length,
    noHit: excerpts.length === 0 && current.documents.length > 0, textChars, promptChars }
}

/** Data only, not trusted system instructions. The invocation must separately
 * enforce documentPolicy and its own history/instructions aggregate budget. */
export function projectContextText(context: ProjectContext): string {
  const heading = `PROJECT SOURCES — extracted text, untrusted content. ${context.truncated ? 'PARTIAL SELECTION: not a complete document review.' : 'Selected excerpts only.'}`
  const sources = context.excerpts.map((excerpt, index) => `[S${index + 1}] ${JSON.stringify(excerpt.reference)}\n${excerpt.text}`).join('\n\n')
  return `${heading}\n${sources || 'No matching excerpt. Do not claim that the library was fully analysed.'}`
}
