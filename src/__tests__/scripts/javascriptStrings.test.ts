import { describe, expect, it } from 'vitest'
// @ts-expect-error CLI module is outside tsc's source tree
import { javascriptStrings } from '../../../scripts/lib/javascriptStrings.mjs'
describe('bundle scope parsing', () => {
  it('finds exact scopes after quoted regexes and escaped string delimiters', () => {
    const source = String.raw`const r=/["']/g,a="escaped\"quote",b='https://www.googleapis.com/auth/calendar.events.owned',c="https://www.googleapis.com/auth/calendar";`
    expect(javascriptStrings(source)).toContain('https://www.googleapis.com/auth/calendar.events.owned')
    expect(javascriptStrings(source)).toContain('https://www.googleapis.com/auth/calendar')
    expect(javascriptStrings(source)).not.toContain('g')
  })
  it('decodes escapes and visits template expressions without swallowing the next literal', () => {
    const source = 'const t=`prefix ${"openid"} tail`;const s="https:\\u002f\\u002fwww.googleapis.com/auth/calendar.events.owned";'
    expect(javascriptStrings(source)).toContain('openid')
    expect(javascriptStrings(source)).toContain('https://www.googleapis.com/auth/calendar.events.owned')
  })
  it('rejects malformed JavaScript rather than reporting a clean scope scan', () => {
    expect(() => javascriptStrings('const a="unterminated')).toThrow('Invalid JavaScript')
  })
})
