/* Service Worker Pismo.
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

const CACHE_PREFIX = 'pismo-v'
const CACHE_VERSION = 10
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION
// Кэши прежнего названия приложения (microshop → Pismo): чистим один раз при активации.
const LEGACY_CACHE_PREFIXES = ['microshop-v', 'microshop-auth']

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
            .filter(
              (key) =>
                (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) ||
                LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
            )
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

// ---------- Web Push (уведомления о сообщениях и входящих звонках) ----------

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const data = payload.data || {}
  const chatId = data.chat_id
  const callId = data.type === 'call' ? data.call_id : null
  const title = payload.title || 'Pismo'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-96.png',
    data,
    tag: callId ? 'call-' + callId : chatId ? 'chat-' + chatId : undefined
  }
  // Входящий звонок (приложение закрыто/в фоне): держим уведомление на экране,
  // со звуком и вибрацией (как входящий вызов), добавляем кнопки.
  if (data.type === 'call') {
    options.requireInteraction = true
    options.renotify = true
    options.silent = false
    options.vibrate = [250, 120, 250, 120, 250, 120, 250]
    options.actions = [
      { action: 'answer', title: 'Ответить' },
      { action: 'decline', title: 'Отклонить' }
    ]
  } else if (data.type === 'message' && chatId) {
    // Уведомление о сообщении: нейтральная кнопка «Пометить как прочитанное»
    // (тап по телу уведомления открывает чат).
    options.actions = [{ action: 'mark-read', title: 'Пометить как прочитанное' }]
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// ---------- Доступ к API из service worker (кнопки уведомлений) ----------

/** Читает access-токен из кэша, куда его дублирует страница (см. swToken.ts). */
async function swReadToken() {
  try {
    const cache = await caches.open('pismo-auth')
    const res = await cache.match('/__auth_token')
    return res ? await res.text() : null
  } catch {
    return null
  }
}

/** POST с Bearer-токеном: возвращает true при 2xx. */
async function swApiPost(path, body) {
  const token = await swReadToken()
  if (!token) return false
  try {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    })
    return resp.ok
  } catch {
    return false
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const action = event.action || 'focus'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      // Входящий звонок: «Ответить»/тап открывают приложение к экрану звонка.
      if (data.type === 'call') {
        // «Отклонить» — сначала на сервер (без фокуса/открытия приложения).
        if (action === 'decline') {
          const ok = await swApiPost('/api/v1/calls/decline/', {
            call_id: data.call_id || '',
            to_user_id: data.peer_id || null
          })
          // Живой странице тихо сообщаем (гасит рингтон/уведомления) — НЕ фокусируем.
          for (const client of windows) {
            if ('focus' in client) {
              client.postMessage({
                type: 'call-notification',
                action: 'decline',
                call_id: data.call_id || null,
                peer_id: data.peer_id || null
              })
            }
          }
          if (!ok && windows.length === 0) {
            // Нет токена/сети и нет окна — откроем и отклоним в приложении.
            await self.clients.openWindow(
              '/?call=' +
                encodeURIComponent(data.call_id || '') +
                '&peer=' +
                encodeURIComponent(data.peer_id || '') +
                '&action=decline'
            )
          }
          return
        }
        // «Ответить»/тап: окно есть — отдаём действие странице (с фокусом).
        for (const client of windows) {
          if ('focus' in client) {
            client.focus()
            client.postMessage({
              type: 'call-notification',
              action,
              call_id: data.call_id || null,
              peer_id: data.peer_id || null
            })
            return
          }
        }
        // Приложение закрыто — открываем к экрану звонка.
        const callUrl =
          '/?call=' +
          encodeURIComponent(data.call_id || '') +
          '&peer=' +
          encodeURIComponent(data.peer_id || '') +
          '&action=' +
          encodeURIComponent(action)
        await self.clients.openWindow(callUrl)
        return
      }

      // Уведомление о сообщении: «Пометить как прочитанное» либо открыть чат.
      const markRead = action === 'mark-read'
      if (markRead && data.type === 'message' && data.chat_id) {
        // «Пометить как прочитанное» — сначала на сервер (без открытия).
        const ok = await swApiPost('/api/v1/messages/read/', { chat_id: data.chat_id })
        // Живой странице тихо обновляем счётчик — НЕ фокусируем окно.
        for (const client of windows) {
          if ('focus' in client) {
            client.postMessage({ type: 'mark-chat-read', chat_id: data.chat_id })
          }
        }
        if (!ok && windows.length === 0) {
          await self.clients.openWindow(
            '/?chat=' + encodeURIComponent(data.chat_id) + '&markread=1'
          )
        }
        return
      }
      // Тап по телу уведомления — открываем/фокусируем чат.
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
      // Приложение закрыто — открываем чат.
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
