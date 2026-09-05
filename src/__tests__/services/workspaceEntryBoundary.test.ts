import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** The UI suite injects a synthetic Content. This separate contract walks REAL
 * static application imports to catch a public page accidentally hydrating
 * private caches before the gate. Dynamic imports remain explicit boundaries;
 * this test is not a browser module-execution or OAuth integration proof. */
function staticGraph(entry: string): Set<string> {
  const visited = new Set<string>()
  function visit(file: string) {
    file = resolve(file)
    if (visited.has(file)) return
    visited.add(file)
    if (!['.ts', '.tsx', '.js'].includes(extname(file))) return
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const node of source.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) continue
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) continue
      if (ts.isExportDeclaration(node) && node.isTypeOnly) continue
      const spec = node.moduleSpecifier
      if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith('.')) continue
      const base = resolve(dirname(file), spec.text)
      const target = ['', '.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx'].map(suffix => `${base}${suffix}`).find(candidate => existsSync(candidate) && extname(candidate))
      if (!target) throw new Error(`Unresolved public dependency: ${spec.text}`)
      visit(target)
    }
  }
  visit(entry)
  return visited
}

describe('workspace entry static dependency boundary', () => {
  it.each(['src/main.tsx', 'src/screens/landing.tsx', 'src/components/share/SharedConversationView.tsx', 'src/services/workspaceWriter/control.ts'])('%s does not statically import private identity/crypto/stores', entry => {
    const graph = staticGraph(entry)
    for (const forbidden of ['src/App.tsx', 'src/hooks/useAuth.ts', 'src/services/userSession.ts', 'src/services/crypto.ts', 'src/services/storage.ts', 'src/services/secureFileStorage.ts', 'src/services/projects/store.ts', 'src/services/previewDemo.ts']) {
      expect(graph.has(resolve(forbidden)), forbidden).toBe(false)
    }
  })
  it('preview is still build-gated inside the private lazy loader, and main does not seed', () => {
    const main = readFileSync('src/main.tsx', 'utf8'), gate = readFileSync('src/components/workspace/DocumentWorkspaceGate.tsx', 'utf8')
    expect(main).not.toContain('setupPreviewDemo()')
    expect(gate.indexOf('if (__DEMO_ALLOWED__)')).toBeLessThan(gate.indexOf("import('../../services/previewDemo')"))
    const loader = gate.slice(gate.indexOf('const PrivateApp'), gate.indexOf('type Controller'))
    expect(loader.indexOf('assertDocumentWorkspace()')).toBeLessThan(loader.indexOf("import('../../services/previewDemo')"))
    expect(loader).not.toContain('documentWorkspace.assertHeld()')
    expect(gate).toContain("import('../../App')")
  })
})
