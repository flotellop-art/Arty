/** Chrome serializes this function: keep every dependency inside it. Read only. */
export function extractRedditPost(requestedUrl, doc = document) {
  const identify = (value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !/^(?:www\.)?reddit\.com$/.test(url.hostname)) return null;
      const id = url.pathname.match(/^(?:\/r\/[^/]+)?\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1]?.toLowerCase();
      return id ? { id, url: `${url.origin}${url.pathname}` } : null;
    } catch { return null; }
  };
  const requested = identify(requestedUrl), current = identify(doc.URL);
  if (!requested || !current || requested.id !== current.id) {
    return { status: 'unreadable', reason: 'wrong_page' };
  }
  if (doc.readyState === 'loading') return { status: 'unreadable', reason: 'loading' };
  const visibleText = (element) => {
    const view = doc.defaultView;
    if (!view || !(element instanceof view.HTMLElement) || !element.getClientRects().length) return '';
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true'
        || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || style.opacity === '0' || /blur\(/i.test(style.filter)) return '';
    }
    return element.innerText?.trim() ?? '';
  };
  const post = doc.getElementById(`t3_${current.id}`);
  const title = visibleText(post?.querySelector(`#post-title-t3_${current.id}`));
  const body = visibleText(post?.querySelector(`#t3_${current.id}-post-rtjson-content`));
  if (!title || !body || /^\[(?:removed|deleted|supprimé|supprimée)\]$/i.test(body)) {
    return { status: 'unreadable', reason: 'missing_post' };
  }
  // Fail explicitly rather than silently present a shortened post as complete.
  if (title.length > 1000 || body.length > 100000) {
    return { status: 'unreadable', reason: 'too_large' };
  }
  if (identify(doc.URL)?.id !== current.id) return { status: 'unreadable', reason: 'wrong_page' };
  return {
    status: 'read',
    postId: current.id,
    url: current.url,
    title,
    body,
    capturedAt: new Date().toISOString(),
    displayedLanguage: (doc.documentElement.lang || '').slice(0, 40),
    provenance: 'user_browser_visible_dom',
    translation: 'not_verified',
    commentsIncluded: false,
    imagesIncluded: false,
  };
}
