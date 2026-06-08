const CACHE_NAME = 'arty-cache-v52'

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

  // Never cache API calls
  if (url.hostname === 'api.anthropic.com' || url.hostname === 'gateway.ai.cloudflare.com') {
    return
  }

  // BUG 45 partiel (audit étape 13) — never cache Cloudflare Pages Functions.
  // Sans ça, le SW peut servir une réponse mise en cache (souvent une erreur
  // CORS ou un 5xx) sur /api/ai/proxy, /api/gmail/action, /api/auth/token, etc.
  // → l'app croit que le proxy est cassé alors qu'il marche.
  if (url.pathname.startsWith('/api/')) {
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
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match('/') || new Response('Offline', { status: 503 }))
    )
    return
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
    })
  )
})
