import { describe, it, expect, vi } from 'vitest'
import { cn } from '../../utils/cn'
import { generateId } from '../../utils/generateId'
import { safeJson } from '../../utils/safeJson'

// ──────────────────────────────────────────────
// cn — Tailwind class merger
// ──────────────────────────────────────────────
describe('cn', () => {
  it('merges two class strings', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center')
  })

  it('resolves Tailwind conflicts (last wins)', () => {
    // tailwind-merge ensures p-4 overrides p-2
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('handles conditional classes', () => {
    const active = true
    expect(cn('btn', active && 'btn-active')).toBe('btn btn-active')
    expect(cn('btn', false && 'btn-active')).toBe('btn')
  })

  it('handles undefined / null gracefully', () => {
    expect(cn('base', undefined, null as unknown as string)).toBe('base')
  })

  it('merges object syntax', () => {
    expect(cn({ flex: true, hidden: false })).toBe('flex')
  })

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('')
  })
})

// ──────────────────────────────────────────────
// generateId — UUID generator
// ──────────────────────────────────────────────
describe('generateId', () => {
  it('returns a valid UUID v4 string', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('returns unique values each call', () => {
    const ids = Array.from({ length: 20 }, generateId)
    const unique = new Set(ids)
    expect(unique.size).toBe(20)
  })
})

// ──────────────────────────────────────────────
// safeJson — safe fetch response parser
// ──────────────────────────────────────────────
describe('safeJson', () => {
  function makeResponse(body: string, status = 200, ok = true): Response {
    return {
      ok,
      status,
      text: () => Promise.resolve(body),
    } as unknown as Response
  }

  it('parses valid JSON from a 200 response', async () => {
    const res = makeResponse('{"foo":"bar"}')
    const data = await safeJson(res)
    expect(data).toEqual({ foo: 'bar' })
  })

  it('parses valid JSON array', async () => {
    const res = makeResponse('[1,2,3]')
    expect(await safeJson(res)).toEqual([1, 2, 3])
  })

  it('throws user-friendly error when body is not JSON and response is ok', async () => {
    const res = makeResponse('A server error occurred', 200, true)
    await expect(safeJson(res)).rejects.toThrow('Réponse invalide du serveur')
  })

  it('throws server error message when body is not JSON and response is not ok', async () => {
    const res = makeResponse('Internal Server Error', 500, false)
    await expect(safeJson(res)).rejects.toThrow('Erreur serveur (500)')
  })

  it('throws with correct status code in error message', async () => {
    const res = makeResponse('Bad Gateway', 502, false)
    await expect(safeJson(res)).rejects.toThrow('502')
  })
})
