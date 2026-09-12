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
 *  - /media/* для картинок (аватары, превью): отдельный кэш с обновлением в
 *    фоне — без него каждый вход в чат заново тянет те же картинки;
 *  - /api, /ws и кросс-доменные запросы — не перехватываем.
 *
 * Обновление: при новом деплое страница находит нового worker'а, показывает
 * баннер «Обновить» и отправляет SKIP_WAITING → новая версия активируется,
 * controllerchange перезагружает страницу.
 */

const CACHE_PREFIX = 'pismo-v'
const CACHE_VERSION = 16
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION
// Кэш медиа живёт отдельно: обновление версии приложения не сбрасывает картинки.
const MEDIA_CACHE_PREFIX = 'pismo-media-v'
const MEDIA_CACHE_NAME = MEDIA_CACHE_PREFIX + 1
/** Сколько картинок держим: старое вытесняем по порядку вставки. */
const MEDIA_CACHE_LIMIT = 150
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
                (key.startsWith(MEDIA_CACHE_PREFIX) && key !== MEDIA_CACHE_NAME) ||
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

async function staleWhileRevalidate(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName)
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

/**
 * Медиа: отдаём из кэша сразу и обновляем в фоне.
 *
 * В кэш кладём только картинки из собственного `/media/` (то, что рисует
 * `<img>`): видео и аудио не кэшируем (тяжёлые, часто с Range-запросами), а
 * зашифрованные вложения грузятся через fetch — они сюда не попадают и
 * расшифровываются на клиенте.
 */
async function mediaCacheFirst(request) {
  const cache = await caches.open(MEDIA_CACHE_NAME)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok && response.type === 'basic') {
        await cache.put(request, response.clone())
        await trimMediaCache(cache)
      }
      return response
    })
    .catch(() => cached)
  return cached || network
}

/** Cache API хранит записи в порядке вставки — вытесняем самые старые. */
async function trimMediaCache(cache) {
  const keys = await cache.keys()
  if (keys.length <= MEDIA_CACHE_LIMIT) return
  const extra = keys.slice(0, keys.length - MEDIA_CACHE_LIMIT)
  await Promise.all(extra.map((key) => cache.delete(key)))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Картинки из /media/ кэшируем: без этого аватары и превью грузятся заново
  // при каждом открытии чата. Только GET и только то, что рисует <img>.
  if (url.pathname.startsWith('/media/') && request.destination === 'image') {
    event.respondWith(mediaCacheFirst(request))
    return
  }
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

/** Есть ли окно приложения, которое видно пользователю прямо сейчас. */
async function hasVisibleClient() {
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  })
  return windows.some((client) => client.visibilityState === 'visible')
}

/** Тихо сообщает открытым окнам о push — интерфейс сам разберётся со звонком. */
function notifyVisibleClients(data) {
  void self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('postMessage' in client) {
        client.postMessage({
          type: 'call-push',
          call_id: data.call_id || null,
          peer_id: data.peer_id || null
        })
      }
    }
  })
}

/** Абсолютный адрес картинки уведомления (аватар приходит путём `/media/...`). */
function absoluteUrl(path) {
  try {
    return new URL(path, self.location.origin).href
  } catch {
    return path
  }
}

async function handlePush(event) {
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
    // Крупная иконка — аватар отправителя (приходит путём), иначе иконка Pismo.
    icon: absoluteUrl(payload.icon || '/icons/icon-192.png'),
    badge: absoluteUrl(payload.badge || '/icons/badge-96.png'),
    data,
    tag: callId ? 'call-' + callId : chatId ? 'chat-' + chatId : undefined
  }
  // Входящий звонок (приложение закрыто/в фоне): держим уведомление на экране,
  // со звуком и вибрацией (как входящий вызов), добавляем кнопки.
  if (data.type === 'call') {
    // Push мог прийти поздно (Doze, очередь, холодный старт): если срок
    // годности звонка прошёл, уведомление не показываем — человек о звонке
    // и так знает (он уже отменён/принят/завершён). Небольшой запас — на
    // расхождение часов устройства.
    const expiresAt = Number(data.expires_at || 0)
    if (expiresAt && Date.now() > expiresAt + 3000) return
    // Приложение уже открыто на экране: вызов показывает сам интерфейс, а
    // повторный push (или push поверх идущего разговора) только «звонил» бы
    // второй раз и оставлял висеть уведомление. Молча будим окно.
    if (await hasVisibleClient()) {
      notifyVisibleClients(data)
      return
    }
    options.requireInteraction = true
    options.renotify = true
    options.silent = false
    // Вибрация — два спокойных толчка с длинной паузой. Частый «дребезг»
    // (7 коротких импульсов подряд) сильно бил по нервам при каждом звонке.
    options.vibrate = [220, 700, 220]
    options.actions = [
      { action: 'answer', title: 'Ответить' },
      { action: 'decline', title: 'Отклонить' }
    ]
  } else if (data.type === 'message' && chatId) {
    // Уведомление о сообщении: нейтральная кнопка «Пометить как прочитанное»
    // (тап по телу уведомления открывает чат).
    options.actions = [{ action: 'mark-read', title: 'Пометить как прочитанное' }]
    // И «точка» на иконке приложения: непрочитанное напоминает о себе даже
    // после того, как уведомление убрали. Открытое приложение ставит бейдж
    // само и точным числом — ему «точку» не навязываем.
    if (!(await hasVisibleClient())) await markAppBadge()
  } else if (data.type === 'security') {
    // Событие безопасности (новый вход в аккаунт, заморозка). Держим уведомление
    // на экране и даём кнопку «Это не я»: она завершает все сессии одним
    // запросом даже с закрытым приложением (см. api_v1/auth/panic.py).
    options.tag = 'pismo-security'
    options.requireInteraction = true
    options.renotify = true
    options.vibrate = [200, 100, 200]
    if (data.panic_token) {
      options.actions = [{ action: 'panic', title: 'Это не я' }]
    }
  }
  await self.registration.showNotification(title, options)
}

/**
 * Бейдж на иконке приложения (Badging API).
 *
 * Точное число непрочитанных знает только открытое приложение (оно ставит его
 * само — см. `src/utils/appBadge.ts`). Здесь, когда приложение закрыто, ставим
 * «точку»: посчитать непрочитанные в service worker нечем, а без бейджа о новом
 * сообщении напоминает только само уведомление.
 */
async function markAppBadge() {
  try {
    if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
      await self.navigator.setAppBadge()
    }
  } catch {
    /* нет API или нет разрешения — просто без бейджа */
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event))
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

/**
 * Тревога «это не я»: у эндпоинта своя авторизация — подписанный panic-токен
 * из уведомления, поэтому access-токен (его может не быть или он уже отозван)
 * не нужен. Возвращает ответ сервера или null, если запрос не дошёл.
 */
async function swPanic(panicToken) {
  try {
    const resp = await fetch('/api/v1/auth/security/panic/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: panicToken })
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
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

      // Уведомление о безопасности: кнопка «Это не я» завершает все сессии.
      if (data.type === 'security') {
        if (action === 'panic' && data.panic_token) {
          const result = await swPanic(data.panic_token)
          if (result) {
            await self.registration.showNotification(
              result.frozen ? 'Аккаунт заморожен' : 'Сессии завершены',
              {
                body: result.frozen
                  ? 'Все устройства вышли, вход закрыт. Разморозить можно кодом из письма.'
                  : 'Все устройства вышли из аккаунта.',
                icon: absoluteUrl('/icons/icon-192.png'),
                badge: absoluteUrl('/icons/badge-96.png'),
                tag: 'pismo-security'
              }
            )
            return
          }
        }
        // Тап по телу (или тревога не дошла) — открываем приложение с диалогом
        // «новый вход», чтобы человек разобрался в интерфейсе.
        for (const client of windows) {
          if ('focus' in client) {
            client.focus()
            client.postMessage({ type: 'security-alert' })
            return
          }
        }
        await self.clients.openWindow('/?security=1')
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
