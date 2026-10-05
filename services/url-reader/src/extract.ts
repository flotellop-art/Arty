/** Serialized into the browser. All helpers stay INSIDE this function. */
export function extractRenderedPage(requestedUrl: string, doc: Document = document) {
  const requested = new URL(requestedUrl), final = new URL(doc.URL)
  const base = {
    provider: 'arty-browser', requestedUrl, finalUrl: `${final.origin}${final.pathname}`,
    retrievedAt: new Date().toISOString(), access: 'anonymous', translation: 'site_default',
    completeness: 'visible_text_only', imagesIncluded: false,
    commentsIncluded: null as boolean | null,
  }
  const visible = (el: Element | null) => {
    if (!(el instanceof (doc.defaultView?.HTMLElement ?? HTMLElement))) return ''
    // innerText on a display:none root can return textContent. Reject it first.
    if (!el.getClientRects().length) return ''
    return (el as HTMLElement).innerText?.trim() ?? ''
  }
  const blocked = (s: string) => /^(?:you['’]ve been blocked|access denied|just a moment|checking (?:your )?browser|verify (?:you are|you're) human|robot check|captcha)/i.test(s.trim())
  const bodyPrefix = visible(doc.body).slice(0, 500)
  if (doc.readyState === 'loading') return { status: 'unreadable', reason: 'document_loading', receipt: base }
  if (/^(?:you['’]ve been )?blocked by network security(?:[.!]|\s|$)/i.test(bodyPrefix)) return { status: 'unreadable', reason: 'site_security', receipt: base }
  if (/\b(?:sign in|log in|login|connexion)\s+(?:required|to (?:continue|view|read)|requise)\b/i.test(`${visible(doc.querySelector('h1'))}\n${bodyPrefix}`)
    || Array.from(doc.querySelectorAll('input[type="password"]')).some(el => visible(el) || el.getClientRects().length)) {
    return { status: 'unreadable', reason: 'login_required', receipt: base }
  }
  if (blocked(doc.title) || blocked(bodyPrefix) || doc.querySelector('#challenge-running, #challenge-form')) {
    return { status: 'unreadable', reason: 'blocked', receipt: base }
  }
  let title = '', body = ''
  const reddit = /^(?:www\.)?reddit\.com$/.test(requested.hostname)
  if (reddit) {
    const id = requested.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1]?.toLowerCase()
    const finalId = final.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1]?.toLowerCase()
    const receipt = { ...base, commentsIncluded: false }
    if (!id || !/^(?:www\.)?reddit\.com$/.test(final.hostname) || finalId !== id) {
      return { status: 'unreadable', reason: 'wrong_page', receipt }
    }
    const post = doc.getElementById(`t3_${id}`)
    title = visible(post?.querySelector(`#post-title-t3_${id}`) ?? null)
    body = visible(post?.querySelector(`#t3_${id}-post-rtjson-content`) ?? null)
    if (!title || !body || /^\[(?:removed|deleted|supprimé)\]$/i.test(body)) {
      return { status: 'unreadable', reason: 'missing_post_body', receipt }
    }
    base.commentsIncluded = false
  } else {
    // Same-host redirects can still substitute a different article or login page.
    if (requested.hostname !== final.hostname
      || requested.pathname.replace(/\/+$/, '') !== final.pathname.replace(/\/+$/, '')
      || requested.search !== final.search) {
      return { status: 'unreadable', reason: 'wrong_page', receipt: base }
    }
    const root = doc.querySelector('article') ?? doc.querySelector('main, [role="main"]') ?? doc.body
    title = visible(root?.querySelector('h1') ?? null) || doc.title.trim()
    // Exclude boilerplate without modifying the displayed page.
    const parts: string[] = []
    if (root) {
      const walk = (node: Element) => {
        if (node.matches('script, style, nav, header, footer, aside, form, button, a, h1, [hidden], [aria-hidden="true"]')) return
        if (node.matches('p, li, pre, blockquote, h2, h3, h4, td')) {
          const text = visible(node)
          if (text) parts.push(text)
          return
        }
        if (!node.children.length) {
          const text = visible(node)
          if (text) parts.push(text)
          return
        }
        for (const child of node.children) walk(child)
      }
      walk(root)
    }
    body = parts.join('\n\n')
    if (!title || body.length < 80 || body === title || blocked(body)) {
      return { status: 'unreadable', reason: 'missing_body', receipt: base }
    }
  }
  const raw = `${title}\n\n${body}`
  const truncated = raw.length > 12000
  return { status: 'read', markdown: raw.slice(0, 12000), receipt: {
    ...base, title, truncated, originalLength: raw.length,
  } }
}
