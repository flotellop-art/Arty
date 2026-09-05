import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent } from 'mdast'
import { EXPORT_LIMITS as L, preflightMarkdown, assertExportText, exportError, type ExportSnapshot, type ExportDocument, type ExportBlock, type ExportRun } from './types'

export function parseOfficeExport(snapshot: ExportSnapshot): ExportDocument {
  if (!snapshot.messages.length || snapshot.messages.length > L.messages) exportError('Choisissez entre 1 et 50 messages conservés.')
  const chars = snapshot.messages.reduce((sum, m) => sum + m.content.length + m.sources.join('').length, snapshot.title.length)
  if (chars > L.chars) exportError('Export limité à 200 000 caractères, sources comprises.')
  assertExportText(snapshot.title)
  const omissions = { images: 0, html: 0, unsupported: 0, attachments: 0 }
  let nodes = 0, tables = 0, cells = 0, lists = 0, expandedChars = 0, runCount = 0
  const messages = snapshot.messages.map((message, messageIndex) => {
    preflightMarkdown(message.content)
    message.sources.forEach(assertExportText)
    const tree = unified().use(remarkParse).use(remarkGfm).parse(message.content) as Root
    // Bound ALL nodes before any recursive transformation.
    const definitions = new Map<string, string>()
    const pending: { node: { children?: unknown[] }; depth: number }[] = [{ node: tree, depth: 0 }]
    while (pending.length) {
      const item = pending.pop()!
      if (++nodes > L.nodes || item.depth > L.depth) exportError('Document trop complexe pour cet export.')
      const node = item.node as RootContent
      if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url)
      const children = item.node.children ?? []
      for (let i = children.length - 1; i >= 0; i--) pending.push({ node: children[i] as { children?: unknown[] }, depth: item.depth + 1 })
    }
    function run(text: string, style: Omit<ExportRun, 'text'>): ExportRun {
      expandedChars += text.length
      if (++runCount > L.nodes || expandedChars > L.chars * 2) exportError('Le texte développé (liens compris) est trop volumineux.')
      assertExportText(text)
      return { text, ...style }
    }
    function inline(children: PhrasingContent[], style: Omit<ExportRun, 'text'> = {}): ExportRun[] {
      return children.flatMap((node): ExportRun[] => {
        switch (node.type) {
          case 'text': return [run(node.value, style)]
          case 'inlineCode': return [run(node.value, { ...style, code: true })]
          case 'break': return [run('\n', style)]
          case 'strong': return inline(node.children, { ...style, bold: true })
          case 'emphasis': return inline(node.children, { ...style, italic: true })
          case 'delete': return inline(node.children, { ...style, strike: true })
          case 'link': {
            const label = inline(node.children, style)
            return label.map(r => r.text).join('') === node.url ? label : [...label, run(` (${node.url})`, style)]
          }
          case 'linkReference': return [...inline(node.children, style), run(` (${definitions.get(node.identifier) ?? node.identifier})`, style)]
          case 'image': case 'imageReference': omissions.images++; return [run('[Image omise]', style)]
          case 'html': omissions.html++; return [run('[HTML omis]', style)]
          case 'footnoteReference': omissions.unsupported++; return [run(`[Note ${node.identifier} non exportée]`, style)]
          default: omissions.unsupported++; return [run('[Élément non pris en charge]', style)]
        }
      })
    }
    type Para = Extract<ExportBlock, { kind: 'paragraph' }>
    function blocks(children: RootContent[], depth = 0, quote = 0, list?: Para['list']): ExportBlock[] {
      const result: ExportBlock[] = []
      for (const node of children) {
        switch (node.type) {
          case 'paragraph': case 'heading': result.push({ kind: 'paragraph', runs: inline(node.children), quote, indent: depth * 480,
            heading: node.type === 'heading' ? node.depth : undefined, list }); break
          case 'code':
            for (const line of node.value.split('\n')) result.push({ kind: 'paragraph', runs: [run(line, { code: true })], code: true, quote, indent: depth * 480 })
            break
          case 'blockquote': result.push(...blocks(node.children, depth, quote + 1)); break
          case 'list': {
            if (depth >= 6) exportError('Les listes imbriquées sont limitées à 6 niveaux.')
            const id = `list-${++lists}`
            node.children.forEach(item => {
              const items = blocks(item.children, depth + 1, quote)
              if (!items.length || items[0]?.kind !== 'paragraph' || items[0].list) items.unshift({ kind: 'paragraph', runs: [{ text: '' }] })
              const first = items[0]
              if (first?.kind === 'paragraph') {
                first.list = { id, depth, ordered: !!node.ordered, start: node.start ?? 1 }
                if (item.checked !== null && item.checked !== undefined) first.runs.unshift({ text: item.checked ? '[x] ' : '[ ] ' })
              }
              result.push(...items)
            })
            break
          }
          case 'table': {
            const columns = node.children[0]?.children.length ?? 0
            if (++tables > L.tables || columns < 1 || columns > L.columns || node.children.length > L.rows) exportError('Tableau trop grand : 16 colonnes et 1 000 lignes au maximum.')
            if (node.children.some(row => row.children.length > columns)) exportError('Un tableau contient des cellules au-delà de ses en-têtes.')
            const rows = node.children.map(row => Array.from({ length: columns }, (_, i) => {
              if (++cells > L.cells) exportError('Export limité à 10 000 cellules.')
              const text = inline(row.children[i]?.children ?? []).map(r => r.text).join('')
              if (text.length > L.cellChars) exportError('Une cellule dépasse 8 192 caractères.')
              assertExportText(text)
              return text
            }))
            result.push({ kind: 'table', rows, id: `table-${tables}`, message: messageIndex + 1 }); break
          }
          case 'thematicBreak': result.push({ kind: 'paragraph', runs: [{ text: '—' }] }); break
          case 'definition': break
          case 'html': omissions.html++; result.push({ kind: 'paragraph', runs: [{ text: '[Bloc HTML omis]' }] }); break
          default: omissions.unsupported++; result.push({ kind: 'paragraph', runs: [{ text: '[Bloc non pris en charge]' }] })
        }
      }
      return result
    }
    omissions.attachments += message.attachments
    return { id: message.id, role: message.role, model: message.model, interrupted: message.interrupted, sources: message.sources, blocks: blocks(tree.children) }
  })
  return { title: snapshot.title, messages, omissions, chars }
}
