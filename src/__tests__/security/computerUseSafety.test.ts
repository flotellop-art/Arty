import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const safety = require('../../../local/computer-use-safety.js') as {
  requireStrongTunnelSecret(raw: unknown): string
  safeCompareSecret(received: unknown, expected: unknown): boolean
  parseCoordinate(value: unknown, name: string): number
  parseScrollAmount(value: unknown): number
  parseScrollDirection(value: unknown): string
  validateText(value: unknown): string
  normalizeKey(value: unknown): string
  escapeSendKeysText(text: string): string
  psSingleQuote(value: string): string
}

describe('local computer-use PowerShell chokepoint hardening', () => {
  it('rejects the historical default tunnel secret', () => {
    expect(() => safety.requireStrongTunnelSecret('dev-secret-change-me')).toThrow(/TUNNEL_SECRET/)
    expect(() => safety.requireStrongTunnelSecret('short')).toThrow(/TUNNEL_SECRET/)
    expect(safety.requireStrongTunnelSecret('a'.repeat(32))).toBe('a'.repeat(32))
  })

  it('rejects click coordinate injection payloads before PowerShell interpolation', () => {
    expect(safety.parseCoordinate(42, 'x')).toBe(42)
    expect(safety.parseCoordinate('42', 'y')).toBe(42)
    expect(() => safety.parseCoordinate('0); Start-Process calc;#', 'x')).toThrow(/Invalid x/)
    expect(() => safety.parseCoordinate('-1', 'x')).toThrow(/Invalid x/)
  })

  it('rejects arbitrary key fallback injection and only allows mapped keys', () => {
    expect(safety.normalizeKey('enter')).toBe('{ENTER}')
    expect(safety.normalizeKey('CTRL+S')).toBe('^s')
    expect(() => safety.normalizeKey("'); Start-Process calc;#")).toThrow(/Invalid key/)
    expect(() => safety.normalizeKey('a')).toThrow(/Invalid key/)
  })

  it('keeps normal typing usable while escaping SendKeys metacharacters and quotes', () => {
    expect(safety.escapeSendKeysText('hello+world')).toBe('hello{+}world')
    expect(safety.psSingleQuote("l'été")).toBe("l''été")
    expect(() => safety.validateText('')).toThrow(/Invalid text/)
  })

  it('validates scroll direction and amount', () => {
    expect(safety.parseScrollDirection('up')).toBe('up')
    expect(safety.parseScrollAmount('3')).toBe(3)
    expect(() => safety.parseScrollDirection('sideways')).toThrow(/Invalid direction/)
    expect(() => safety.parseScrollAmount('3); Start-Process calc;#')).toThrow(/Invalid amount/)
  })
})
