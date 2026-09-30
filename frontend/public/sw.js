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
const CACHE_VERSION = 32
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION
/**
 * Ритм вибрации уведомления о звонке (~1,9 с: три толчка с короткими паузами).
 *
 * Держим в паре с `CALL_RING_VIBRATION` в `src/services/pwa.ts`: раскладка
 * уведомления о звонке обязана совпадать в обоих местах (расхождение уже
 * ломало ответ на звонок), страж — `src/__tests__/callOffline.spec.ts`.
 */
const CALL_RING_VIBRATION = [400, 300, 400, 300, 400]
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
    // Крупная иконка — аватар отправителя (приходит путём), иначе «плитка» с
    // логотипом Pismo: он крупнее иконки приложения — в уведомлении виден.
    icon: absoluteUrl(payload.icon || '/icons/push-logo-256.png'),
    // Мелкий значок (строка состояния и шапка уведомления): мотив в файле
    // крупный, иначе значок выглядит мельче, чем в других мессенджерах.
    badge: absoluteUrl(payload.badge || '/icons/badge-128.png'),
    data,
    // `payload.tag` приходит от сервера для уведомлений об истории (у них нет
    // ни чата, ни звонка): одна история — один тег, уведомления не копятся.
    // Напоминание сервер тоже тегирует по своему id (два напоминания об одном
    // чате не должны затирать друг друга); запасной вариант — на случай push
    // без tag: собираем тег из id напоминания здесь.
    tag:
      payload.tag ||
      (callId
        ? 'call-' + callId
        : data.type === 'reminder' && data.reminder_id
          ? 'reminder-' + data.reminder_id
          : chatId
            ? 'chat-' + chatId
            : undefined)
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
    // Вибрация — ритм «звонит», а не один толчок: три импульса с короткими
    // паузами, столько же живёт и звук системного уведомления. Частый «дребезг»
    // (7 импульсов подряд) бил по нервам, а два толчка с паузой 0,7 с в кармане
    // проглатывались. Ритм ОДИН на оба места (см. CALL_RING_VIBRATION выше).
    options.vibrate = CALL_RING_VIBRATION
    // Кнопка только одна — «Открыть»: она открывает приложение к экрану звонка.
    //
    // Двух кнопок («Ответить»/«Отклонить») здесь быть не должно: на Android
    // нажатие на кнопку приходит в service worker как действие СОСЕДНЕЙ кнопки
    // (по логам прод: человек жал «Ответить», а уходил `POST /calls/decline/` —
    // звонок обрывался у обоих). С одной кнопкой путать нечего. Отказать можно
    // смахиванием уведомления (см. `notificationclose`) или кнопкой в приложении,
    // а ответить — на экране звонка.
    options.actions = serverActions(data) || [{ action: 'open', title: 'Открыть' }]
    // Прошлые звонки уже не звонят: их уведомления с экрана убираем, иначе они
    // копятся, а кнопки в них ничего не делают.
    await closeOtherCallNotifications(options.tag)
  } else if (data.type === 'message' && chatId) {
    // Кнопка «Ответить» открывает чат и ставит курсор в поле ввода: в вебе
    // набрать текст прямо в уведомлении нельзя (такого API нет), поэтому
    // «ответ» — это чат, готовый к вводу, без лишних тапов.
    options.actions = serverActions(data) || [
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
      options.actions = serverActions(data) || [{ action: 'panic', title: 'Это не я' }]
    }
  }
  await self.registration.showNotification(title, options)
}

/**
 * Подписи кнопок уведомления, присланные сервером.
 *
 * Язык уведомления знает только сервер (он берёт его из профиля получателя), а
 * service worker работает вне приложения и профиля не видит — поэтому текст
 * кнопок приходит в `data.actions`. Если поля нет (старый сервер, кэш), ниже
 * остаётся русская подпись: уведомление всё равно будет работать.
 */
function serverActions(data) {
  const actions = data && data.actions
  if (!Array.isArray(actions) || !actions.length) return null
  const valid = actions.filter(
    (item) => item && typeof item.action === 'string' && typeof item.title === 'string'
  )
  return valid.length ? valid : null
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

/**
 * Что сервер знает про вызов: звонит ли он ещё и удалось ли спросить.
 *
 * Спрашиваем `GET /calls/pending/`: `ringing` — offer ушёл, ответа не было.
 * Одной `pending` (парковки) мало: она есть только у ЗАКРЫТОГО приложения, а
 * если оно просто свёрнуто, offer доставлен и парковки нет — из-за этого отказ
 * из уведомления не срабатывал (звонок звонил, а мы считали, что «уже не ждёт»).
 */
async function swCallState(callId) {
  if (!callId) return { ringing: false, asked: false }
  const data = await swApiGet('/api/v1/calls/pending/?call_id=' + encodeURIComponent(callId))
  if (!data) return { ringing: false, asked: false }
  return { ringing: Boolean(data.ringing || data.pending), asked: true }
}

/**
 * Id звонков, уведомления о которых человек ОТКРЫЛ (тап или кнопка).
 *
 * Их закрытие — не «отклонить»: нажатие само убирает уведомление с экрана.
 * Набор живёт в памяти воркера.
 */
const openedCallIds = new Set()

/**
 * Смахнули уведомление о звонке — значит отказались от вызова.
 *
 * Это единственный способ отказать, не открывая приложение. Работает и когда
 * приложение закрыто, и когда оно свёрнуто (в обоих случаях вызов звонит, а
 * уведомление смахивают именно чтобы отказать).
 */
async function declineCallAfterDismiss(callId, peerId) {
  if (openedCallIds.has(callId)) {
    openedCallIds.delete(callId)
    return
  }
  // Если сервер сказал явно, что вызов уже не звонит (приняли/отменили/кончился),
  // ничего не отправляем. Не смогли спросить — пробуем отказ: лишний отказ по
  // закончившемуся вызову безвреден, пропущенный — нет.
  const state = await swCallState(callId)
  if (state.asked && !state.ringing) return
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

self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {}
  if (data.type !== 'call') return
  const callId = String(data.call_id || '')
  if (!callId) return
  event.waitUntil(declineCallAfterDismiss(callId, data.peer_id || null))
})

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

      // Входящий звонок: кнопка «Открыть» и тап по уведомлению.
      if (data.type === 'call') {
        const peerId = data.peer_id === undefined ? null : data.peer_id
        // Нажатие НИКОГДА не отклоняет и почти всегда просто открывает звонок:
        // `answer` уважаем только если такое действие реально пришло (старые
        // уведомления с кнопкой «Ответить»), всё остальное — это «открыть».
        const wanted = action === 'answer' ? 'answer' : 'focus'
        // Приложение открыто (пусть и свёрнуто) — будим его сообщением. Открывать
        // адрес нельзя: `openWindow` перезагружает страницу, а вызов уже пришёл
        // именно в это окно — после перезагрузки звонок терялся, и человек видел
        // только список чатов.
        const live = windows.find((client) => 'focus' in client)
        if (live) {
          live.focus()
          live.postMessage({
            type: 'call-notification',
            action: wanted,
            call_id: callId || null,
            peer_id: peerId
          })
          return
        }
        // Приложение закрыто: открываем его к экрану звонка. Вызов ждёт в
        // парковке и дойдёт сам.
        await self.clients.openWindow(
          '/?call=' +
            encodeURIComponent(callId) +
            '&peer=' +
            encodeURIComponent(peerId === null ? '' : peerId) +
            '&action=' +
            wanted
        )
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
                icon: absoluteUrl('/icons/push-logo-256.png'),
                badge: absoluteUrl('/icons/badge-128.png'),
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

      // Реакция на мою историю: открываем приложение на этой истории — там
      // автор сразу видит счётчики и панель «кто смотрел».
      if (data.type === 'story_reaction') {
        const storyId = Number(data.story_id || 0) || null
        for (const client of windows) {
          if ('focus' in client) {
            client.focus()
            client.postMessage({ type: 'open-story', story_id: storyId })
            return
          }
        }
        await self.clients.openWindow(storyId ? '/?story=' + encodeURIComponent(storyId) : '/')
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
      // Напоминание ведёт в тот же чат и к тому же сообщению, что и push о
      // сообщении, но без кнопок: «Ответить» тут нечего, «прочитано» — тем более
      // (новых сообщений напоминание не приносит).
      const opensChat =
        (data.type === 'message' || data.type === 'reminder') && Boolean(data.chat_id)
      for (const client of windows) {
        if ('focus' in client) {
          client.focus()
          if (opensChat) {
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
      const url = opensChat
        ? '/?chat=' + encodeURIComponent(data.chat_id) + (wantReply ? '&reply=1' : '')
        : '/'
      const win = await self.clients.openWindow(url)
      if (win && opensChat) {
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
