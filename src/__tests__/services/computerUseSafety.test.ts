import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Le pont computer-use est un module Node CommonJS (local/), hors du build Vite.
// On charge ses validateurs PURS via createRequire pour les tester sans démarrer
// Express (un import direct du serveur échoue : `require('child_process')` etc.).
const require = createRequire(import.meta.url)
const { parseCoordinate, parseScrollAmount, normalizeKey } = require(
  '../../../local/computer-use-safety.js'
) as {
  parseCoordinate: (v: unknown, n: 'x' | 'y') => number
  parseScrollAmount: (v: unknown) => number
  normalizeKey: (k: unknown) => string
}

describe('computer-use — validateurs anti-injection PowerShell', () => {
  it('parseCoordinate accepte des entiers, rejette les payloads d’injection', () => {
    expect(parseCoordinate(42, 'x')).toBe(42)
    expect(parseCoordinate('17', 'y')).toBe(17)
    expect(parseCoordinate(-5, 'x')).toBe(-5)
    // Le payload classique d’injection PowerShell doit être rejeté.
    expect(() => parseCoordinate('0); Start-Process calc; #', 'x')).toThrow()
    expect(() => parseCoordinate('1.5', 'y')).toThrow()
    expect(() => parseCoordinate(1e9, 'x')).toThrow()
    expect(() => parseCoordinate(null, 'x')).toThrow()
    expect(() => parseCoordinate({}, 'x')).toThrow()
  })

  it('normalizeKey ne mappe que la liste blanche (plus de fallback || key)', () => {
    expect(normalizeKey('Enter')).toBe('{ENTER}')
    expect(normalizeKey(' ctrl+s ')).toBe('^s')
    expect(() => normalizeKey('a')).toThrow()
    expect(() => normalizeKey('{F4}')).toThrow()
    expect(() => normalizeKey("'); Invoke-Expression $x; #")).toThrow()
    expect(() => normalizeKey(42)).toThrow()
  })

  it('parseScrollAmount : défaut 3, borné, rejette le non-entier', () => {
    expect(parseScrollAmount(undefined)).toBe(3)
    expect(parseScrollAmount(5)).toBe(5)
    expect(() => parseScrollAmount('x); calc')).toThrow()
    expect(() => parseScrollAmount(99999)).toThrow()
    expect(() => parseScrollAmount(0)).toThrow()
  })

  it('le serveur bind en loopback, sans fallback || key, comparaison timing-safe', () => {
    const src = readFileSync(resolve(process.cwd(), 'local/computer-use-server.js'), 'utf8')
    expect(src).toMatch(/app\.listen\(PORT,\s*['"]127\.0\.0\.1['"]/)
    expect(src).not.toMatch(/\|\|\s*key\b/)
    expect(src).toMatch(/timingSafeEqual/)
    // Refus de démarrer avec le secret par défaut.
    expect(src).toMatch(/dev-secret-change-me/)
    expect(src).toMatch(/process\.exit\(1\)/)
  })
})
