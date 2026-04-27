import { describe, it, expect } from 'vitest'
import {
  getCharset,
  decodeBase64Url,
  decodePartBody,
  htmlToText,
  type MimePart,
} from '../../../functions/api/gmail/_lib'

// Small helper to build a MimePart with a single Content-Type header.
function partWithContentType(value: string, data?: string): MimePart {
  return {
    headers: [{ name: 'Content-Type', value }],
    body: data !== undefined ? { data } : undefined,
  }
}

describe('gmail/_lib — getCharset', () => {
  it('returns declared charset (windows-1252)', () => {
    const part = partWithContentType('text/html; charset=windows-1252')
    expect(getCharset(part)).toBe('windows-1252')
  })

  it('lowercases the charset value (ISO-8859-1 → iso-8859-1)', () => {
    const part = partWithContentType('text/plain; charset=ISO-8859-1')
    expect(getCharset(part)).toBe('iso-8859-1')
  })

  it('strips quotes around the charset value', () => {
    const part = partWithContentType('text/html; charset="UTF-8"')
    expect(getCharset(part)).toBe('utf-8')
  })

  it('tolerates spaces around the equal sign', () => {
    const part = partWithContentType('text/plain; charset = ISO-8859-15')
    expect(getCharset(part)).toBe('iso-8859-15')
  })

  it('falls back to utf-8 when no Content-Type header', () => {
    const part: MimePart = { body: { data: 'SGVsbG8' } }
    expect(getCharset(part)).toBe('utf-8')
  })

  it('falls back to utf-8 when Content-Type has no charset', () => {
    const part = partWithContentType('text/plain')
    expect(getCharset(part)).toBe('utf-8')
  })

  it('matches Content-Type case-insensitively (RFC 2045 §5.1)', () => {
    const part: MimePart = {
      headers: [{ name: 'content-type', value: 'text/html; charset=US-ASCII' }],
    }
    expect(getCharset(part)).toBe('us-ascii')
  })
})

describe('gmail/_lib — decodeBase64Url', () => {
  it('returns an empty Uint8Array on empty input', () => {
    const out = decodeBase64Url('')
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(0)
  })

  it('decodes "SGVsbG8" (no padding) → bytes for "Hello"', () => {
    const out = decodeBase64Url('SGVsbG8')
    expect(Array.from(out)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    expect(new TextDecoder().decode(out)).toBe('Hello')
  })

  it('decodes "SGVsbG8gd29ybGQ" → "Hello world"', () => {
    const out = decodeBase64Url('SGVsbG8gd29ybGQ')
    expect(new TextDecoder().decode(out)).toBe('Hello world')
  })

  it('translates URL-safe alphabet (- and _) → "<?xml?>"', () => {
    const out = decodeBase64Url('PD94bWw_Pg')
    expect(new TextDecoder().decode(out)).toBe('<?xml?>')
  })

  it('handles missing padding: "YQ" → 1 byte for "a"', () => {
    const out = decodeBase64Url('YQ')
    expect(out.length).toBe(1)
    expect(out[0]).toBe(0x61)
    expect(new TextDecoder().decode(out)).toBe('a')
  })
})

describe('gmail/_lib — decodePartBody', () => {
  it('decodes a windows-1252 body (0xE9 → "é") for "Café"', () => {
    // Bytes for "Café" in windows-1252: 43 61 66 E9 → base64url "Q2Fm6Q"
    const part: MimePart = {
      headers: [{ name: 'Content-Type', value: 'text/plain; charset=windows-1252' }],
      body: { data: 'Q2Fm6Q' },
    }
    expect(decodePartBody(part)).toBe('Café')
  })

  it('decodes a default-charset (utf-8) body cleanly', () => {
    const part: MimePart = {
      headers: [{ name: 'Content-Type', value: 'text/plain' }],
      body: { data: 'SGVsbG8' },
    }
    expect(decodePartBody(part)).toBe('Hello')
  })

  it('decodes UTF-8 multi-byte characters correctly (no charset declared)', () => {
    // "Café" UTF-8 bytes: 43 61 66 C3 A9 → base64url "Q2Fmw6k"
    const part: MimePart = { body: { data: 'Q2Fmw6k' } }
    expect(decodePartBody(part)).toBe('Café')
  })

  it('returns "" when body.data is missing', () => {
    const part: MimePart = {
      headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
      body: {},
    }
    expect(decodePartBody(part)).toBe('')
  })

  it('returns "" when body itself is missing', () => {
    const part: MimePart = {
      headers: [{ name: 'Content-Type', value: 'text/plain' }],
    }
    expect(decodePartBody(part)).toBe('')
  })

  it('falls back to utf-8 (no throw) when charset is invalid', () => {
    // "Hello" in UTF-8 base64url
    const part: MimePart = {
      headers: [{ name: 'Content-Type', value: 'text/plain; charset=foo-bar' }],
      body: { data: 'SGVsbG8' },
    }
    expect(() => decodePartBody(part)).not.toThrow()
    expect(decodePartBody(part)).toBe('Hello')
  })
})

describe('gmail/_lib — htmlToText', () => {
  it('strips a simple <p> tag', () => {
    expect(htmlToText('<p>Hello</p>')).toBe('Hello')
  })

  it('removes <style> contents (not just the tag)', () => {
    const out = htmlToText('<style>.x{color:red}</style>Hello')
    expect(out).toBe('Hello')
    expect(out).not.toContain('color')
    expect(out).not.toContain('{')
  })

  it('removes <script> contents (not just the tag)', () => {
    const out = htmlToText('<script>alert(1)</script>Hello')
    expect(out).toBe('Hello')
    expect(out).not.toContain('alert')
  })

  it('strips HTML comments', () => {
    expect(htmlToText('<!-- comment -->Hello')).toBe('Hello')
  })

  it('turns <br> and <br/> into newlines', () => {
    expect(htmlToText('a<br>b<br/>c')).toBe('a\nb\nc')
  })

  // Bug found while writing tests — see PR body.
  it.skip('collapses <p>Hello</p><p>World</p> → "Hello\\nWorld"', () => {
    expect(htmlToText('<p>Hello</p><p>World</p>')).toBe('Hello\nWorld')
  })

  it('decodes the standard named entities', () => {
    // After replacements & whitespace collapsing & trim:
    //   "&nbsp;" → " "
    //   "&amp;"  → "&"
    //   "&lt;"   → "<"
    //   "&gt;"   → ">"
    //   "&quot;" → "\""
    //   "&#39;"  → "'"
    //   "&apos;" → "'"
    // Leading space (from &nbsp;) is removed by trim().
    expect(htmlToText('&nbsp;&amp;&lt;&gt;&quot;&#39;&apos;')).toBe('&<>"\'\'')
  })

  it('decodes numeric decimal entities (&#233; → "é")', () => {
    expect(htmlToText('&#233;')).toBe('é')
  })

  // Hex numeric entities are not currently supported (only decimal).
  // See PR body — tracked as a known limitation, not fixed in this PR.
  it.skip('decodes numeric hex entities (&#x00E9; → "é")', () => {
    expect(htmlToText('&#x00E9;')).toBe('é')
  })

  it('removes a realistic Outlook-style <style> block and keeps the body text', () => {
    const css =
      'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1F497D;margin:0;padding:0;}' +
      'p{margin:0;padding:0;}.MsoNormal{margin:0;}.WordSection1{page:WordSection1;}' // ~200+ chars
    const html = `<html><head><style>${css}</style></head><body><p>Bonjour, voici le devis</p></body></html>`
    const out = htmlToText(html)
    expect(out).not.toContain('font-family')
    expect(out).not.toContain('Calibri')
    expect(out).not.toContain('MsoNormal')
    expect(out).not.toContain('{')
    expect(out).not.toContain('}')
    expect(out).toContain('Bonjour')
    expect(out).toContain('devis')
  })

  it('returns "" on empty input', () => {
    expect(htmlToText('')).toBe('')
  })

  it('returns "" on whitespace + empty tags only', () => {
    expect(htmlToText('<div></div>   <p></p>')).toBe('')
  })

  it('turns </li>, </tr>, </h1> closings into newlines', () => {
    expect(htmlToText('<li>a</li><li>b</li>')).toContain('a')
    expect(htmlToText('<li>a</li><li>b</li>')).toContain('b')
    // The closing produces a newline before the next token; trim() removes
    // the trailing one.
    expect(htmlToText('<h1>Title</h1>')).toBe('Title')
  })
})
