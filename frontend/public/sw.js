/* Service Worker Microshop.
 *
 * Зачем: у установленного PWA всегда должна появляться свежая версия после
 * деплоя. Здесь нет предкэша «намертво»: главная стратегия — network-first для
 * навигации, поэтому при онлайне всегда отдаётся новый index.html и новые
 * хешированные ассеты, а старые кэши при активации новой версии удаляются.
 *
 * Стратегии:
 *  - навигация (HTML/SPA): network-first, офлайн — из кэша;
 *  - /assets/* (хешированные js/css): stale-while-revalidate;
 *  - /api, /media, /ws и кросс-доменные запросы — не перехватываем.
 *
 * Обновление: при новом деплое страница находит нового worker'а, показывает
 * баннер «Обновить» и отправляет SKIP_WAITING → новая версия активируется,
 * controllerchange перезагружает страницу.
 */

const CACHE_PREFIX = 'microshop-v'
const CACHE_VERSION = 1
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(['/', '/index.html']))
      .catch(() => undefined)
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    const index = await cache.match('/index.html')
    if (index) return index
    return Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => cached)
  return cached || network
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/media/') ||
    url.pathname.startsWith('/ws')
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
