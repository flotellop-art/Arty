// ⚠️ Bumper à CHAQUE déploiement qui touche un fichier statique non hashé
// servi en cache-first (lp.js, manifest.json, favicon.svg) — sinon les
// visiteurs qui l'ont en cache ne verront jamais la nouvelle version.
const CACHE_NAME = 'arty-cache-v54'

// Only real public guide documents may be returned for an offline guide URL.
// An unknown /install/* URL may previously have cached the server's SPA shell.
const INSTALL_GUIDE_PATHS = new Set(['/install', '/install/', '/install/en', '/install/en/'])

async function offlineNavigation(request, url) {
  const isGuide = url.pathname === '/install' || url.pathname.startsWith('/install/')
  try {
    if (!isGuide || INSTALL_GUIDE_PATHS.has(url.pathname)) {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(isGuide ? request : '/')
      if (cached) return cached
    }
  } catch {
    // Storage can be unavailable; always return a real public response.
  }
  return new Response('Hors ligne / Offline. Reconnectez-vous au réseau puis rechargez cette page. Reconnect to the internet and reload this page.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function rememberResponse(event, request, response) {
  if (!response.ok) return
  const clone = response.clone()
  // A cache write failure must not replace a successful network response.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {}))
}

// ─── Push Notifications (Web Push API) ───
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Arty', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Arty'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: data.tag || 'arty-notif',
    data: data.data || {},
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})

// Listen for scheduled notifications from the app (via postMessage)
self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || msg.type !== 'schedule-notification') return
  const { title, body, delayMs, tag } = msg
  setTimeout(() => {
    self.registration.showNotification(title || 'Arty', {
      body: body || '',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      tag: tag || 'arty-scheduled',
    })
  }, Math.max(0, Number(delayMs) || 0))
})

// Install: cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/manifest.json',
        '/favicon.svg',
      ])
    })
  )
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('arty-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    })
  )
  self.clients.claim()
})

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return

  // Never cache API calls
  if (url.hostname === 'api.anthropic.com' || url.hostname === 'gateway.ai.cloudflare.com') {
    return
  }

  // BUG 45 partiel (audit étape 13) — never cache Cloudflare Pages Functions.
  // Sans ça, le SW peut servir une réponse mise en cache (souvent une erreur
  // CORS ou un 5xx) sur /api/ai/proxy, /api/auth/token, etc.
  // → l'app croit que le proxy est cassé alors qu'il marche.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return
  }

  // Laisse le navigateur gérer NATIVEMENT toutes les requêtes cross-origin
  // (Google Fonts, avatars, n'importe quel CDN). Un fetch() lancé par le SW
  // s'exécute sous le connect-src de la page, qui est volontairement strict :
  // intercepter une requête cross-origin la re-fetch sous connect-src et la
  // fait bloquer par la CSP. C'est ce qui cassait fonts.gstatic.com (woff2)
  // une fois le SW réellement enregistré sur le web. Le chargement natif passe
  // par font-src / img-src (qui, eux, autorisent ces origines).
  if (url.origin !== self.location.origin) {
    return
  }

  // Navigation: network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Ne jamais mettre en cache une erreur (404 typo d'URL de pub,
          // 5xx transitoire) — même garde que la branche assets ci-dessous.
          rememberResponse(event, request, response)
          return response
        })
        .catch(() => offlineNavigation(request, url))
    )
    return
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        rememberResponse(event, request, response)
        return response
      })
    })
  )
})
