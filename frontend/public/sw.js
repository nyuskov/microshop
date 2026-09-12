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
const CACHE_VERSION = 25
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

/**
 * Убирает с экрана уведомление о звонке, который уже не звонит.
 *
 * Уведомление входящего вызова показывается с `requireInteraction` — само оно не
 * исчезает. Если звонок приняли на другом устройстве, отклонили или зовущий его
 * отменил, приложение ставит тихий push `call-cancelled` (см.
 * `tasks/notifications.send_call_cancelled_push`), и уведомление нужно закрыть.
 * Нового уведомления при этом не показываем: сообщать нечего.
 */
/**
 * Тихо говорит открытым окнам, что звонок завершился (без вывода уведомления).
 *
 * Их сигнальный канал мог отвалиться, и тогда звонок «идёт» вечно: экран
 * звонит, хотя ответить уже некому. Гасить ли звонок, решает само приложение —
 * если оно в разговоре, вызов не его (см. `store.call.finishIfRinging`).
 */
function notifyCallFinished(data) {
  void self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('postMessage' in client) {
        client.postMessage({
          type: 'call-cancelled',
          call_id: data.call_id || null,
          reason: data.reason || null
        })
      }
    }
  })
}

async function closeCallNotifications(callId) {
  const notifications = await self.registration.getNotifications()
  for (const notification of notifications) {
    const tag = notification.tag || ''
    if (!tag.startsWith('call-')) continue
    // call_id известен — снимаем только его; иначе снимаем все «звонки».
    if (callId && tag !== 'call-' + callId) continue
    notification.close()
  }
}

/**
 * Закрывает уведомления о ДРУГИХ звонках, оставляя текущий.
 *
 * Каждый звонок показывает своё уведомление (`tag` = `call-<id>`), а уведомление
 * входящего вызова само с экрана не уходит (`requireInteraction`). За несколько
 * звонков на экране копилась стопка: кнопки в старых уведомлениях относились к
 * уже завершённым вызовам — «нажимаю, а ничего не работает». Новый звонок делает
 * прошлые бессмысленными, поэтому закрываем их.
 */
async function closeOtherCallNotifications(keepTag) {
  const notifications = await self.registration.getNotifications()
  for (const notification of notifications) {
    const tag = notification.tag || ''
    if (!tag.startsWith('call-')) continue
    if (keepTag && tag === keepTag) continue
    notification.close()
  }
}

/** Абсолютный адрес картинки уведомления (аватар приходит путём `/media/...`). */
function absoluteUrl(path) {
  try {
    return new URL(path, self.location.origin).href
  } catch {
    return path
  }
}

//: Сколько ждём перед отказом по смахиванию уведомления.
//: Тап/кнопка «Ответить» тоже закрывают уведомление, и за это время приложение
//: успевает принять звонок — тогда отказ не уйдёт.
const CALL_DISMISS_GRACE_MS = 3000
//: Пауза перед отказом по кнопке «Отклонить».
//: На части устройств (Android) система отдаёт нажатие кнопки как СОСЕДНЕЕ
//: действие, поэтому «Отклонить» может прийти от человека, который жал
//: «Ответить». За паузу он успевает ответить на открывшемся экране звонка.
const CALL_DECLINE_CONFIRM_MS = 6000

async function handlePush(event) {
  // Значение по умолчанию: у push без данных ни заголовка, ни текста нет.
  let payload
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const data = payload.data || {}
  const chatId = data.chat_id
  const callId = data.type === 'call' ? data.call_id : null
  // «Звонок больше не звонит»: тихий push без заголовка и текста — закрываем
  // уведомление вызова и ничего не показываем. Открытым окнам сообщаем: их
  // канал мог отвалиться, и тогда звонок «идёт» вечно. Разговор это не сломает:
  // приложение гасит вызов только если он у него ещё входящий/исходящий.
  if (data.type === 'call-cancelled') {
    await closeCallNotifications(data.call_id || null)
    notifyCallFinished(data)
    return
  }
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
  // со звуком и вибрацией (как входящий вызов), с кнопкой «Ответить».
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
    // Кнопок две: «Ответить» и «Отклонить». Отказ выполняется осторожно (см.
    // `notificationclick`): на части устройств (Android) система отдаёт нажатие
    // кнопки как действие СОСЕДНЕЙ кнопки, поэтому человека сначала ведут на
    // экран звонка, и только если он не ответил — вызов отклоняется сам.
    // Отклонить можно ещё и смахиванием уведомления (см. `notificationclose`).
    options.actions = [
      { action: 'answer', title: 'Ответить' },
      { action: 'decline', title: 'Отклонить' }
    ]
    // Прошлые звонки уже не звонят: их уведомления с экрана убираем, иначе они
    // копятся, а кнопки в них ничего не делают.
    await closeOtherCallNotifications(options.tag)
  } else if (data.type === 'message' && chatId) {
    // Кнопка «Ответить» открывает чат и ставит курсор в поле ввода: в вебе
    // набрать текст прямо в уведомлении нельзя (такого API нет), поэтому
    // «ответ» — это чат, готовый к вводу, без лишних тапов.
    options.actions = [
      { action: 'reply', title: 'Ответить' },
      { action: 'mark-read', title: 'Пометить как прочитанное' }
    ]
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

/** GET с Bearer-токеном: возвращает JSON или null, если спросить не удалось. */
async function swApiGet(path) {
  const token = await swReadToken()
  if (!token) return null
  try {
    const resp = await fetch(path, { headers: { Authorization: 'Bearer ' + token } })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

/** Ждёт ли звонок ответа (`GET /calls/pending/`). */
async function swCallStillPending(callId) {
  if (!callId) return false
  const data = await swApiGet('/api/v1/calls/pending/?call_id=' + encodeURIComponent(callId))
  return Boolean(data && data.pending)
}

/**
 * Id звонков, уведомления о которых человек ОТКРЫЛ (тап или кнопка).
 *
 * Их закрытие — не «отклонить»: нажатие само убирает уведомление с экрана.
 * Набор живёт в памяти воркера; для страховки ниже есть ещё пауза и вопрос
 * серверу, ждёт ли вызов.
 */
const openedCallIds = new Set()

/**
 * Смахнули уведомление о звонке — значит отказались от вызова.
 *
 * Это единственный способ отказать, не открывая приложение. Отказ отправляем
 * только если вызов всё ещё ждёт: к этому моменту приложение по «Ответить» уже
 * могло принять звонок, а принятый/отменённый/просроченный вызов трогать нельзя.
 */
async function declineCallAfterDismiss(callId, peerId) {
  if (openedCallIds.has(callId)) {
    openedCallIds.delete(callId)
    return
  }
  if (!(await swCallStillPending(callId))) return
  await new Promise((resolve) => setTimeout(resolve, CALL_DISMISS_GRACE_MS))
  if (openedCallIds.has(callId)) {
    openedCallIds.delete(callId)
    return
  }
  if (!(await swCallStillPending(callId))) return
  await declineCallEverywhere(callId, peerId)
}

/**
 * Отказ на сервере + тихий сигнал открытым окнам (их канал мог отвалиться, а
 * рингтон должен замолчать — см. `store/call.finishIfRinging`).
 */
async function declineCallEverywhere(callId, peerId) {
  await swApiPost('/api/v1/calls/decline/', { call_id: callId, to_user_id: peerId })
  notifyCallFinished({ call_id: callId, reason: 'declined' })
}

/**
 * Кнопка «Отклонить»: показываем экран звонка и отклоняем вызов, если человек
 * так и не ответил.
 *
 * Почему не отказ сразу: на Android нажатие кнопки приходит в service worker как
 * СОСЕДНЕЕ действие, поэтому «Отклонить» может на самом деле быть нажатием на
 * «Ответить». Тогда человек видит экран звонка и успевает ответить, а через
 * `CALL_DECLINE_CONFIRM_MS` вызов уже принят и отказ не уходит. Если это был
 * настоящий отказ — вызов отклонится сам, звонить после этого уже некому.
 */
async function declineCallFromButton(callId, peerId, windows) {
  if (!(await swCallStillPending(callId))) return
  await showCallScreen(callId, peerId, 'focus', windows)
  await new Promise((resolve) => setTimeout(resolve, CALL_DECLINE_CONFIRM_MS))
  if (openedCallIds.has(callId)) {
    openedCallIds.delete(callId)
    return
  }
  if (!(await swCallStillPending(callId))) return
  await declineCallEverywhere(callId, peerId)
}

self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {}
  if (data.type !== 'call') return
  const callId = String(data.call_id || '')
  if (!callId) return
  event.waitUntil(declineCallAfterDismiss(callId, data.peer_id || null))
})

/**
 * Показывает человеку экран звонка (то же, что нажатие по уведомлению).
 *
 * Видимое окно будим сообщением (экран появится без перезагрузки), а закрытое или
 * свёрнутое открываем адресом: замороженной странице сообщение может не дойти.
 */
async function showCallScreen(callId, peerId, wanted, windows) {
  const visible = windows.find(
    (client) => 'focus' in client && client.visibilityState === 'visible'
  )
  if (visible) {
    visible.focus()
    visible.postMessage({
      type: 'call-notification',
      action: wanted,
      call_id: callId || null,
      peer_id: peerId
    })
    return
  }
  await self.clients.openWindow(
    '/?call=' +
      encodeURIComponent(callId) +
      '&peer=' +
      encodeURIComponent(peerId === null ? '' : peerId) +
      '&action=' +
      wanted
  )
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  const action = event.action || 'focus'
  // Запоминаем ДО закрытия: тап/кнопка по уведомлению о звонке — это «открыть
  // звонок», а не смахивание, и отказом закрытие быть не должно.
  const callId = String(data.call_id || '')
  if (data.type === 'call' && callId && action !== 'decline') openedCallIds.add(callId)
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      // Входящий звонок: кнопки и тап открывают приложение к экрану звонка.
      if (data.type === 'call') {
        const peerId = data.peer_id || null
        // «Отклонить» — не отказ сразу: см. `declineCallFromButton`.
        if (action === 'decline') {
          await declineCallFromButton(callId, peerId, windows)
          return
        }
        // «Ответить»/тап — показываем звонок (и принимаем, если просили ответ).
        await showCallScreen(callId, peerId, action === 'answer' ? 'answer' : 'focus', windows)
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
      // Тап по телу уведомления или «Ответить» — открываем/фокусируем чат.
      const wantReply = action === 'reply'
      for (const client of windows) {
        if ('focus' in client) {
          client.focus()
          if (data.type === 'message' && data.chat_id) {
            client.postMessage({
              type: 'open-chat',
              chat_id: data.chat_id,
              message_id: data.message_id || null,
              reply: wantReply
            })
          }
          return
        }
      }
      // Приложение закрыто — открываем чат (для «Ответить» — сразу к вводу).
      const url =
        data.type === 'message' && data.chat_id
          ? '/?chat=' + encodeURIComponent(data.chat_id) + (wantReply ? '&reply=1' : '')
          : '/'
      const win = await self.clients.openWindow(url)
      if (win && data.type === 'message' && data.chat_id) {
        win.postMessage({
          type: 'open-chat',
          chat_id: data.chat_id,
          message_id: data.message_id || null,
          reply: wantReply
        })
      }
    })()
  )
})
