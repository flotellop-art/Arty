// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Small fixture parser for the deployed file's exact paths and trailing splats.
// This checks scope, not Cloudflare's runtime; HTTP/browser recipes attest that.
const rules = []
for (const line of readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.startsWith('#')) continue
  if (line.startsWith('/')) rules.push({ path: line, headers: {} })
  else {
    const match = line.match(/^\s+([\w-]+): (.+)$/)
    if (!match || !rules.length) throw new Error('Unexpected _headers syntax')
    rules.at(-1).headers[match[1].toLowerCase()] = match[2]
  }
}
const matching = (url) => {
  const pathname = new URL(url, 'https://tryarty.com').pathname
  return rules.filter(({ path }) => path.endsWith('*') ? pathname.startsWith(path.slice(0, -1)) : pathname === path)
}
const strictPolicy = "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

describe('installation guide edge policy', () => {
  it('adds only two precise namespaces without replacing the global policy', () => {
    expect(rules.map(rule => rule.path)).toEqual(['/*', '/install', '/install/*'])
    expect(rules[0].headers['content-security-policy']).toContain("script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com;")
    expect(rules[0].headers['content-security-policy']).not.toContain("script-src 'none'")
    expect(rules[0].headers['cache-control']).toBeUndefined()
    expect(rules[0].headers['permissions-policy']).toBe('camera=(self), microphone=(self), geolocation=(self)')
    for (const rule of rules.slice(1)) {
      expect(rule.headers).toEqual({ 'cache-control': 'public, no-cache, no-transform', 'content-security-policy': strictPolicy })
    }
  })

  it.each(['/install', '/install/', '/install/en', '/install/en/', '/install/?source=test', '/install/en/?source=test', '/install/install.css'])('cumulatively restricts guide path %s', (path) => {
    const matches = matching(path)
    expect(matches).toHaveLength(2)
    expect(matches[1].headers['content-security-policy']).toBe(strictPolicy)
    expect(matches[1].headers['cache-control']).toBe('public, no-cache, no-transform')
  })

  it.each(['/', '/login', '/api', '/api/subscription/status', '/installer', '/installation', '/assets/app.js', '/sw.js'])('leaves existing policy unchanged for %s', (path) => {
    expect(matching(path)).toEqual([rules[0]])
  })

  it('keeps the guide behind existing Pages middleware, not an excluded route', () => {
    const routes = JSON.parse(readFileSync(new URL('../../public/_routes.json', import.meta.url), 'utf8'))
    expect(routes.include).toEqual(['/*'])
    expect(routes.exclude.some(path => path.includes('install'))).toBe(false)
  })
})
