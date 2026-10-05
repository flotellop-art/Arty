import { describe, it, expect, vi } from 'vitest'
import { extractRenderedPage } from '../../../services/url-reader/src/extract'
import { profilesFromConfig, profileFor, permitsRequest } from '../../../services/url-reader/src/policy'
const url = 'https://www.reddit.com/r/ChatGPT/comments/1vqo6kl/'
function fixture(html: string, final = url) {
  document.body.innerHTML = html
  Object.defineProperty(document, 'URL', { value: final, configurable: true })
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true })
  // jsdom has no renderer. Only offline fixture stand-ins, never a live proof.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute('hidden') ? [] : [{}]) as unknown as DOMRectList
  })
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true,
    get() { return this.textContent } })
}
const post = '<div id="t3_1vqo6kl"><h1 id="post-title-t3_1vqo6kl">Exact post title</h1><div id="t3_1vqo6kl-post-rtjson-content">Actual body of the exact requested post.</div></div>'
describe('rendered extraction', () => {
  it('isolates exact Reddit post and carries omissions', () => {
    fixture(post + '<aside>PRIVATE ACCOUNT</aside><div>UNRELATED COMMENTS</div>')
    const r = extractRenderedPage(url)
    expect(r.status).toBe('read')
    expect(r.markdown).toContain('Actual body')
    expect(r.markdown).not.toMatch(/PRIVATE|COMMENTS/)
    expect(r.receipt).toMatchObject({ access: 'anonymous', imagesIncluded: false, commentsIncluded: false })
  })
  it.each([post.replace('Actual body of the exact requested post.', ''), post.replace('Actual body of the exact requested post.', '[removed]'), post.replace('1vqo6kl-post-rtjson-content', 'different-body')])('rejects absent/removed/wrong body', html => {
    fixture(html); expect(extractRenderedPage(url).status).toBe('unreadable')
  })
  it('rejects another final post', () => {
    fixture(post, 'https://www.reddit.com/r/x/comments/abcd/'); expect(extractRenderedPage(url).reason).toBe('wrong_page')
  })
  it('rejects HTTP200 interstitial', () => {
    fixture("<p>You've been blocked by network security</p>"); expect(extractRenderedPage(url).reason).toBe('site_security')
  })
  it('waits for a loading document and does not diagnose a quoted security phrase', () => {
    fixture(post.replace('Actual body of the exact requested post.', 'I saw the message blocked by network security yesterday.'))
    expect(extractRenderedPage(url).status).toBe('read')
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
    expect(extractRenderedPage(url).reason).toBe('document_loading')
  })
  it('does not read a hidden post body', () => {
    fixture(post.replace('<div id="t3_1vqo6kl-post', '<div hidden id="t3_1vqo6kl-post'))
    expect(extractRenderedPage(url).status).toBe('unreadable')
  })
  it('generic extraction requires body and excludes navigation', () => {
    fixture('<main><h1>Article</h1><nav>SECRET</nav><p>' + 'Rendered paragraph. '.repeat(12) + '</p></main>', 'https://example.com/')
    const r = extractRenderedPage('https://example.com/')
    expect(r.status).toBe('read'); expect(r.markdown).not.toContain('SECRET'); expect(r.receipt.commentsIncluded).toBeNull()
  })
  it('title alone is not a read', () => {
    fixture('<main><h1>Title</h1></main>', 'https://example.com/')
    expect(extractRenderedPage('https://example.com/').status).toBe('unreadable')
  })
  it('rejects another generic article on the same host', () => {
    fixture('<main><h1>Different article</h1><p>' + 'Wrong content. '.repeat(20) + '</p></main>', 'https://en.wikipedia.org/wiki/B')
    expect(extractRenderedPage('https://en.wikipedia.org/wiki/A').reason).toBe('wrong_page')
  })
  it('login text is not the requested article even at HTTP200/same URL', () => {
    fixture('<h1>Sign in to continue</h1><p>' + 'Please authenticate with your account. '.repeat(10) + '</p>', 'https://example.com/')
    expect(extractRenderedPage('https://example.com/').reason).toBe('login_required')
  })
  it('extracts rendered JavaScript text in spans rather than assuming paragraphs', () => {
    fixture('<div class="quotes"><span>' + 'Dynamically rendered quote. '.repeat(8) + '</span></div>', 'https://quotes.toscrape.com/js/')
    document.title = 'Quotes to Scrape'
    expect(extractRenderedPage('https://quotes.toscrape.com/js/').markdown).toContain('Dynamically rendered quote.')
  })
})
describe('fixed server profiles', () => {
  const profile = { hosts: ['example.com'], resources: ['example.com', 'cdn.example.com'] }
  it('permits exact HTTPS hosts, not arbitrary domains/ports/methods or subframes outside profile', () => {
    expect(permitsRequest(profile, 'https://cdn.example.com/x.js', 'GET', 'script', false)).toBe(true)
    for (const u of ['https://evil.example.com/', 'https://127.0.0.1/', 'https://example.com:444/', 'https://example.com./', 'http://example.com/']) {
      expect(permitsRequest(profile, u, 'GET', 'document', true)).toBe(false)
    }
    expect(permitsRequest(profile, 'https://example.com/', 'POST', 'fetch', false)).toBe(false)
    expect(permitsRequest(profile, 'https://example.com/', 'GET', 'image', false)).toBe(false)
    expect(profileFor(new URL('https://attacker.test/'), [profile])).toBeUndefined()
  })
  it('rejects wildcard and private configured hosts', () => {
    for (const host of ['*.example.com', '127.0.0.1', 'foo.local']) {
      expect(() => profilesFromConfig(JSON.stringify([{ hosts: [host], resources: [] }]))).toThrow()
    }
  })
})
