// Tests de non-régression P0.1/P0.2/P0.3 (plan d'action concurrentiel) :
// coloration syntaxique active, sanitisation TOUJOURS active après highlight
// (BUG 20), blocs sans langage rendus en bloc (pas inline), header de langage.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownRenderer } from '../../components/shared/MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('colore la syntaxe des blocs de code avec langage (classes hljs)', () => {
    const { container } = render(
      <MarkdownRenderer content={'```python\ndef hello():\n    return "world"\n```'} />
    )
    const code = container.querySelector('pre code')
    expect(code).toBeTruthy()
    expect(code!.className).toContain('language-python')
    // rehype-highlight a généré des tokens
    expect(container.querySelector('[class*="hljs-"]')).toBeTruthy()
    // header de langage présent
    expect(screen.getByText('python')).toBeTruthy()
  })

  it('rend un bloc sans langage comme bloc (pas inline)', () => {
    const { container } = render(
      <MarkdownRenderer content={'```\nligne 1\nligne 2\n```'} />
    )
    expect(container.querySelector('pre code')).toBeTruthy()
  })

  it('garde le code inline en inline', () => {
    const { container } = render(<MarkdownRenderer content={'Voici `du code` inline.'} />)
    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('code')).toBeTruthy()
  })

  it('sanitise toujours le HTML dangereux APRÈS le highlight (BUG 20)', () => {
    const { container } = render(
      <MarkdownRenderer content={'<img src="x" onerror="alert(1)" />\n\n```js\nconst a = 1\n```'} />
    )
    const img = container.querySelector('img')
    // l'attribut handler doit être strippé par rehype-sanitize
    expect(img?.getAttribute('onerror')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('conserve les data-* des boutons d\'action connus (allowlist, pas wildcard)', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'<button data-action="send_email" data-to="a@b.com" data-evil="x">Envoyer</button>'}
      />
    )
    const btn = container.querySelector('button[data-action]')
    expect(btn).toBeTruthy()
    expect(btn!.getAttribute('data-action')).toBe('send_email')
    expect(btn!.getAttribute('data-to')).toBe('a@b.com')
    // Un data-* hors allowlist est strippé par la sanitisation
    expect(btn!.getAttribute('data-evil')).toBeNull()
  })

  it('strippe les data: URI dans src (XSS SVG sur WebView)', () => {
    const { container } = render(
      <MarkdownRenderer content={'<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="x" />'} />
    )
    const img = container.querySelector('img')
    // src data: retiré par la sanitisation (protocols.src sans 'data')
    expect(img?.getAttribute('src') ?? '').not.toContain('data:')
  })

  it('numérote les listes ordonnées via les marqueurs CSS (structure md-list)', () => {
    const { container } = render(<MarkdownRenderer content={'1. premier\n2. second'} />)
    const ol = container.querySelector('ol.md-list')
    expect(ol).toBeTruthy()
    expect(ol!.querySelectorAll('.md-marker').length).toBe(2)
  })
})
