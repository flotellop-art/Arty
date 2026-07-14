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
    // L'image relative est bloquée et aucun handler ne survit au sanitize.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('conserve les data-* des boutons d\'action connus (allowlist, pas wildcard)', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'<button data-action="create_event" data-title="Rendez-vous" data-evil="x">Créer</button>'}
      />
    )
    const btn = container.querySelector('button[data-action]')
    expect(btn).toBeTruthy()
    expect(btn!.getAttribute('data-action')).toBe('create_event')
    expect(btn!.getAttribute('data-title')).toBe('Rendez-vous')
    // Un data-* hors allowlist est strippé par la sanitisation
    expect(btn!.getAttribute('data-evil')).toBeNull()
  })

  it('neutralise un ancien bouton d’envoi de mail sans faux succès', () => {
    const { container } = render(
      <MarkdownRenderer content={'<button data-action="send_email" data-to="client@example.com">Envoyer</button>'} />
    )

    expect(container.querySelector('button[data-action="send_email"]')).toBeNull()
    expect(screen.getByText('Envoyer').tagName).toBe('SPAN')
  })

  it('neutralise aussi un ancien bouton Drive devenu indisponible', () => {
    const { container } = render(
      <MarkdownRenderer content={'<button data-action="save_drive" data-name="Rapport">Sauvegarder</button>'} />
    )

    expect(container.querySelector('button[data-action="save_drive"]')).toBeNull()
    expect(screen.getByText('Sauvegarder').tagName).toBe('SPAN')
  })

  it('strippe les data: URI dans src (XSS SVG sur WebView)', () => {
    const { container } = render(
      <MarkdownRenderer content={'<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="x" />'} />
    )
    const img = container.querySelector('img')
    // src data: retiré par la sanitisation (protocols.src sans 'data')
    expect(img?.getAttribute('src') ?? '').not.toContain('data:')
  })

  it('ne charge jamais automatiquement une image Markdown HTTP(S)', () => {
    const { container } = render(
      <MarkdownRenderer content={'![pixel de suivi](https://tracker.example/pixel.png?user=42)'} />
    )
    expect(container.querySelector('img')).toBeNull()
    const note = screen.getByRole('note')
    expect(note.textContent).toMatch(/remoteImageBlocked|image externe bloquée/i)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://tracker.example/pixel.png?user=42')
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('supprime aussi les URL distantes cachées dans du CSS Markdown', () => {
    const { container } = render(
      <MarkdownRenderer content={'<div style="background-image:url(https://tracker.example/pixel.png);width:75%">rapport</div>'} />
    )
    const div = container.querySelector('.report-content > div')
    expect(div?.getAttribute('style') ?? '').not.toContain('url(')
    // Le seul style riche autorisé reste la largeur des barres de progression.
    expect(div?.getAttribute('style')).toContain('width: 75%')
  })

  it('numérote les listes ordonnées via les marqueurs CSS (structure md-list)', () => {
    const { container } = render(<MarkdownRenderer content={'1. premier\n2. second'} />)
    const ol = container.querySelector('ol.md-list')
    expect(ol).toBeTruthy()
    expect(ol!.querySelectorAll('.md-marker').length).toBe(2)
  })
})
