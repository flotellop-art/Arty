import { describe, it, expect } from 'vitest'
import { truncateWithNotice } from '../../../functions/api/_lib/truncate'

describe('truncateWithNotice', () => {
  it('leaves content shorter than the limit untouched', () => {
    const r = truncateWithNotice('hello', 100)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe('hello')
    expect(r.originalLength).toBe(5)
  })

  it('does NOT flag content of exactly the limit length (C1 — no false positive)', () => {
    const content = 'a'.repeat(50)
    const r = truncateWithNotice(content, 50)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe(content)
    expect(r.originalLength).toBe(50)
    expect(r.text).not.toContain('tronqué')
  })

  it('truncates content longer than the limit and flags it', () => {
    const content = 'b'.repeat(120)
    const r = truncateWithNotice(content, 50)
    expect(r.truncated).toBe(true)
    expect(r.originalLength).toBe(120)
    expect(r.text).toContain('contenu tronqué à 50 caractères sur 120')
  })

  it('keeps the first `limit` chars intact and appends the note AFTER the slice (C2)', () => {
    const content = 'x'.repeat(50) + 'y'.repeat(50)
    const r = truncateWithNotice(content, 50)
    // The first 50 chars must be the real content, not eaten by the note.
    expect(r.text.slice(0, 50)).toBe('x'.repeat(50))
    // The note must come strictly AFTER the sliced content (with a separator).
    const noteIndex = r.text.indexOf('[Note')
    expect(noteIndex).toBeGreaterThanOrEqual(50)
  })

  it('handles empty content', () => {
    const r = truncateWithNotice('', 100)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe('')
    expect(r.originalLength).toBe(0)
  })
})
