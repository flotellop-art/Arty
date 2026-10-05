import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from './manifest.json';
import { JSDOM } from 'jsdom';
import { extractRedditPost } from './extract.mjs';
import { ARTY_PROMPT, captureActivePost, makeTextExport } from './reader.mjs';
import { buildContentBlocks, buildMistralBlocks } from '../src/hooks/useFileAttachments';
import { requestedWebUrls } from '../src/services/anthropicUrlRecovery';

const url = 'https://www.reddit.com/r/ChatGPT/comments/1vqo6kl/example/';
function fixture(pageUrl = url) {
  const dom = new JSDOM('<html lang="fr"><body><aside>PRIVATE SIDEBAR</aside><div id="t3_1vqo6kl"><h1 id="post-title-t3_1vqo6kl">Publication</h1><div id="t3_1vqo6kl-post-rtjson-content">Témoignage français : déjà payé 182,60 €. 🦊</div></div><div id="t1_comment">COMMENT TO EXCLUDE</div></body></html>', { url: pageUrl });
  const doc = dom.window.document;
  // jsdom has no rendering engine; this fixture supplies layout/innerText only.
  Object.defineProperty(doc, 'readyState', { configurable: true, value: 'complete' });
  for (const el of doc.querySelectorAll('*')) {
    el.getClientRects = () => [{ width: 100, height: 20 }];
    Object.defineProperty(el, 'innerText', { configurable: true, get: () => el.textContent });
  }
  return { dom, doc };
}
let doc, dom;
beforeEach(() => { ({ doc, dom } = fixture()); });

describe('local Reddit extraction boundaries', () => {
  it('reads only the exact post, strips URL parameters and declares omissions', () => {
    ({ doc, dom } = fixture(`${url}?token=not-to-export&tl=fr#comment`));
    const result = extractRedditPost(`${url}?tl=fr`, doc);
    expect(result).toMatchObject({ status: 'read', postId: '1vqo6kl', url, displayedLanguage: 'fr', commentsIncluded: false, imagesIncluded: false, translation: 'not_verified' });
    expect(result.body).toContain('182,60 €');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE SIDEBAR|COMMENT TO EXCLUDE|not-to-export/);
  });
  it('survives Chrome function serialization without imports or closures', () => {
    const serialized = new Function(`return (${extractRedditPost.toString()})`)();
    expect(serialized(url, doc).status).toBe('read');
  });
  it.each([
    'https://www.reddit.com/r/ChatGPT/comments/another/',
    'https://www.reddit.com.evil.example/r/ChatGPT/comments/1vqo6kl/',
    'https://old.reddit.com/r/ChatGPT/comments/1vqo6kl/',
    'https://user:secret@www.reddit.com/r/ChatGPT/comments/1vqo6kl/',
    'http://www.reddit.com/r/ChatGPT/comments/1vqo6kl/',
    'https://www.reddit.com:8443/r/ChatGPT/comments/1vqo6kl/',
    'https://www.reddit.com/login/',
  ])('rejects wrong post/origin/transport: %s', (value) => {
    expect(extractRedditPost(value, doc)).toEqual({ status: 'unreadable', reason: 'wrong_page' });
  });
  it('rejects a redirected page even if the old post remains in the DOM', () => {
    dom.reconfigure({ url: 'https://www.reddit.com/r/ChatGPT/comments/other/' });
    expect(extractRedditPost(url, doc).reason).toBe('wrong_page');
  });
  it.each(['display:none', 'visibility:hidden', 'opacity:0', 'filter:blur(5px)'])('rejects a hidden ancestor: %s', (style) => {
    doc.getElementById('t3_1vqo6kl').setAttribute('style', style);
    expect(extractRedditPost(url, doc).reason).toBe('missing_post');
  });
  it('rejects a body with no layout and an aria-hidden post', () => {
    doc.getElementById('t3_1vqo6kl-post-rtjson-content').getClientRects = () => [];
    expect(extractRedditPost(url, doc).reason).toBe('missing_post');
    ({ doc, dom } = fixture());
    doc.getElementById('t3_1vqo6kl').setAttribute('aria-hidden', 'true');
    expect(extractRedditPost(url, doc).reason).toBe('missing_post');
  });
  it.each(['[removed]', '[deleted]', '[supprimé]', ''])('rejects removed/empty body: %s', (body) => {
    doc.getElementById('t3_1vqo6kl-post-rtjson-content').textContent = body;
    expect(extractRedditPost(url, doc).reason).toBe('missing_post');
  });
  it('does not substitute page chrome for an image-only post or a security page', () => {
    doc.getElementById('t3_1vqo6kl-post-rtjson-content').remove();
    expect(extractRedditPost(url, doc).reason).toBe('missing_post');
    doc.body.innerHTML = '<h1>Blocked by network security</h1><p>Try logging in</p>';
    expect(extractRedditPost(url, doc).reason).toBe('missing_post');
  });
  it('refuses loading and too-large documents rather than truncating', () => {
    Object.defineProperty(doc, 'readyState', { value: 'loading' });
    expect(extractRedditPost(url, doc).reason).toBe('loading');
    ({ doc, dom } = fixture());
    doc.getElementById('t3_1vqo6kl-post-rtjson-content').textContent = 'x'.repeat(100001);
    expect(extractRedditPost(url, doc).reason).toBe('too_large');
  });
});

describe('user-triggered main frame capture', () => {
  function api() {
    const result = extractRedditPost(url, doc);
    return {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 42, url }]), get: vi.fn().mockResolvedValue({ id: 42, url }) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ frameId: 0, result }]) },
    };
  }
  it('selects only the active tab and injects a self-contained read in isolated main frame', async () => {
    const chrome = api();
    await expect(captureActivePost(chrome)).resolves.toMatchObject({ postId: '1vqo6kl' });
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 42, frameIds: [0] }, world: 'ISOLATED', func: extractRedditPost, args: [url] });
  });
  it('rejects a navigation while the injection result is returning', async () => {
    const chrome = api();
    chrome.tabs.get.mockResolvedValue({ url: 'https://www.reddit.com/r/ChatGPT/comments/other/' });
    await expect(captureActivePost(chrome)).rejects.toThrow('wrong_page');
  });
  it('rejects a child frame result, missing tab and missing post', async () => {
    const chrome = api();
    chrome.scripting.executeScript.mockResolvedValue([{ frameId: 1, result: extractRedditPost(url, doc) }]);
    await expect(captureActivePost(chrome)).rejects.toThrow('unavailable');
    chrome.tabs.query.mockResolvedValue([]);
    await expect(captureActivePost(chrome)).rejects.toThrow('no_tab');
    chrome.tabs.query.mockResolvedValue([{ id: 42, url }]);
    chrome.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { status: 'unreadable', reason: 'missing_post' } }]);
    await expect(captureActivePost(chrome)).rejects.toThrow('missing_post');
  });
});

describe('local export consumed by existing Arty attachment builders', () => {
  it('preserves UTF-8 and source in the file, while the human prompt requests no new URL fetch', async () => {
    const snapshot = extractRedditPost(url, doc);
    const file = makeTextExport(snapshot);
    const bytes = new TextEncoder().encode(file.text);
    const attachment = { id: 'local', name: file.filename, type: 'text/plain', data: Buffer.from(bytes).toString('base64') };
    const blocks = await buildContentBlocks(ARTY_PROMPT, [attachment]);
    const mistral = buildMistralBlocks(ARTY_PROMPT, [attachment]);
    expect(file.filename).toBe('reddit-1vqo6kl.txt');
    expect(JSON.stringify(blocks)).toContain(snapshot.body);
    expect(JSON.stringify(mistral)).toContain(snapshot.body);
    expect(JSON.stringify(blocks)).toContain('UNTRUSTED THIRD-PARTY DATA');
    expect(JSON.stringify(blocks)).toContain(url);
    expect(requestedWebUrls(ARTY_PROMPT)).toEqual([]);
    expect(file.text).not.toMatch(/PRIVATE SIDEBAR|COMMENT TO EXCLUDE/);
  });
  it('keeps activeTab permissions narrow and disables network from extension pages', () => {
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.background).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
  });
});
