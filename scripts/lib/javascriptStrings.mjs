import ts from 'typescript'

/** Parse executable bundles: regexes, escaped quotes and templates cannot
 * hide following strings. Syntax errors fail the scope audit closed. */
export function javascriptStrings(source) {
  const file = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (file.parseDiagnostics.length) throw new Error('Invalid JavaScript bundle; scope audit cannot continue')
  const values = []
  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) values.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return values
}
