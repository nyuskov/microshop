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
const CACHE_VERSION = 3
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

// ---------- Web Push (уведомления о новых сообщениях) ----------

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const chatId = payload.data && payload.data.chat_id
  const title = payload.title || 'Microshop'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    data: payload.data || {},
    tag: chatId ? 'chat-' + chatId : undefined
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  event.waitUntil(
    (async () => {
      // Если окно приложения открыто — фокусируем и просим открыть нужный чат.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          client.focus()
          if (data.type === 'message' && data.chat_id) {
            client.postMessage({
              type: 'open-chat',
              chat_id: data.chat_id,
              message_id: data.message_id || null
            })
          }
          return
        }
      }
      // Приложение закрыто — открываем и передаём id чата в URL (?chat=).
      const url =
        data.type === 'message' && data.chat_id ? '/?chat=' + encodeURIComponent(data.chat_id) : '/'
      const win = await self.clients.openWindow(url)
      if (win && data.type === 'message' && data.chat_id) {
        win.postMessage({
          type: 'open-chat',
          chat_id: data.chat_id,
          message_id: data.message_id || null
        })
      }
    })()
  )
})
