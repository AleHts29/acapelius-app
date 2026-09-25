// Service worker de Acapelius: cachea la shell del SPA para que el modo
// puerta abra aunque no haya red (spec §8). Estrategias:
//  - /app/assets/* : cache-first  (archivos con hash en el nombre, inmutables)
//  - navegacion    : network-first con fallback al ultimo index.html cacheado
//  - /api/*        : nunca se cachea; la capa offline de la app es IndexedDB
//
// Vive en /app/sw.js con alcance /app/ (C17 §B.1): la landing y las paginas
// de acceso no pasan por aca.
const CACHE = 'acapelius-shell-v3'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpia caches de versiones anteriores.
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE)
    cache.put(request, response.clone())
  }
  return response
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE)
      // Toda navegacion sirve el mismo index.html del SPA.
      cache.put('/app/index.html', response.clone())
    }
    return response
  } catch {
    const cached = await caches.match('/app/index.html')
    if (cached) return cached
    return new Response('Sin conexion y sin copia local todavia.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // la API no se cachea nunca

  if (url.pathname.startsWith('/app/assets/') || url.pathname.startsWith('/app/fonts/')) {
    event.respondWith(cacheFirst(request))
  } else if (request.mode === 'navigate' && url.pathname.startsWith('/app')) {
    event.respondWith(networkFirstNavigation(request))
  }
})
