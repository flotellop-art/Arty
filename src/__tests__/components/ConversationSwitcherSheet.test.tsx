// Tests du switcher de conversations (PR D) — rendu statique, composant
// présentationnel (même approche que InputContextSlot.test.tsx).
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationSwitcherSheet } from '../../components/chat/ConversationSwitcherSheet'
import type { Conversation } from '../../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }),
}))

function conv(id: string, title: string, updatedAt: number, euOnly = false): Conversation {
  return { id, title, messages: [], createdAt: updatedAt, updatedAt, euOnly } as Conversation
}

const conversations = [
  conv('a', 'Vieille conversation', Date.now() - 86_400_000),
  conv('b', 'Conversation active', Date.now() - 60_000, true),
  conv('c', 'La plus récente', Date.now() - 10_000),
]

describe('ConversationSwitcherSheet', () => {
  it('liste les conversations triées de la plus récente à la plus ancienne', () => {
    const html = renderToStaticMarkup(
      <ConversationSwitcherSheet
        open={true}
        onClose={() => {}}
        conversations={conversations}
        activeId="b"
        onSelect={() => {}}
      />
    )
    const posRecent = html.indexOf('La plus récente')
    const posActive = html.indexOf('Conversation active')
    const posOld = html.indexOf('Vieille conversation')
    expect(posRecent).toBeGreaterThan(-1)
    expect(posRecent).toBeLessThan(posActive)
    expect(posActive).toBeLessThan(posOld)
  })

  it('marque la conversation active (✓ + aria-current) et le badge EU', () => {
    const html = renderToStaticMarkup(
      <ConversationSwitcherSheet
        open={true}
        onClose={() => {}}
        conversations={conversations}
        activeId="b"
        onSelect={() => {}}
      />
    )
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('✓')
    expect(html).toContain('🇪🇺')
  })

  it('fermé → rien dans le DOM', () => {
    const html = renderToStaticMarkup(
      <ConversationSwitcherSheet
        open={false}
        onClose={() => {}}
        conversations={conversations}
        onSelect={() => {}}
      />
    )
    expect(html).toBe('')
  })
})
