/**
 * Регистрация service worker, механика «новая версия доступна» и Web Push.
 *
 * Web Push: после входа запрашиваем разрешение, создаём подписку браузера
 * (с VAPID-ключом сервера) и сохраняем её на бэкенде — дальше при новых
 * сообщениях сервер шлёт push, который service worker показывает как
 * системное уведомление (даже когда приложение закрыто).
 */

import { api } from './api'
import { t } from '@/i18n'

let registration: ServiceWorkerRegistration | null = null
let periodicUpdateTimer: number | null = null

/** Просит браузер проверить обновление SW (молча — ошибки сети не важны). */
function requestUpdateCheck(): void {
  if (document.visibilityState !== 'visible') return
  void registration?.update().catch(() => undefined)
}

/**
 * Свои проверки обновления.
 *
 * Браузер сам проверяет sw.js нечасто (для УСТАНОВЛЕННОЙ PWA — примерно раз в
 * сутки), поэтому пользователь мог бы неделями работать на старой версии.
 * Проверяем при возврате к приложению и раз в час, пока оно открыто: если
 * на сервере другая версия, она встанет сама (skipWaiting + клик по баннеру
 * или автоматическая перезагрузка) — переустанавливать ничего не нужно.
 */
function scheduleUpdateChecks(): void {
  if (periodicUpdateTimer !== null) return
  document.addEventListener('visibilitychange', requestUpdateCheck)
  periodicUpdateTimer = window.setInterval(requestUpdateCheck, 60 * 60 * 1000)
}

/** Регистрирует SW и вызывает onUpdate, когда доступна новая версия. */
export function registerServiceWorker(onUpdate: () => void): void {
  // SW нужен и в dev-сборке — иначе нельзя локально проверить Web Push.
  // Он работает только в secure-контексте (localhost/HTTPS): на других http-
  // origin ('serviceWorker' in navigator === false) молча пропускаем. В dev
  // после первой регистрации возможен один авто-reload (взятие контроля).
  if (!('serviceWorker' in navigator)) return

  scheduleUpdateChecks()

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        registration = reg
        // Уже есть ожидающая новая версия (например, апдейт пришёл, пока страница была открыта).
        if (reg.waiting && navigator.serviceWorker.controller) {
          onUpdate()
          return
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            // installed + есть активный контроллер = новая версия готова к активации.
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdate()
            }
          })
        })
      })
      .catch(() => {
        /* SW недоступен (например, http в проде) — молча пропускаем. */
      })
  })
}

/** Активирует новую версию (перезагрузку выполняет controllerchange-слушатель). */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!registration) return
  let worker: ServiceWorker | null = registration.waiting
  if (!worker) {
    // На всякий случай проверяем обновление — могло прийти, пока ждали.
    await registration.update()
    worker = registration.waiting
  }
  if (worker) {
    worker.postMessage({ type: 'SKIP_WAITING' })
  }
}

/**
 * Проверяет обновление приложения и сразу его применяет (страница перезагрузится).
 * Возвращает `false`, если обновлений нет — тогда показывать нечего.
 */
export async function checkForAppUpdate(): Promise<boolean> {
  if (!registration) return false
  await registration.update()
  const worker = registration.waiting
  if (!worker) return false
  worker.postMessage({ type: 'SKIP_WAITING' })
  return true
}

// ---------- Web Push (уведомления в PWA) ----------

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i)
  return output
}

/** Обратное преобразование: ArrayBuffer ключа подписки → base64url без паддинга. */
function uint8ArrayToUrlBase64(bytes: ArrayBuffer | null): string {
  if (!bytes || bytes.byteLength === 0) return ''
  let binary = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i])
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** VAPID-ключ, под который оформлена подписка браузера ('' — неизвестен). */
function subscriptionKey(subscription: PushSubscription): string {
  return uint8ArrayToUrlBase64(subscription.options?.applicationServerKey ?? null)
}

/** Публичный VAPID-ключ сервера (пусто — push на сервере выключен). */
async function fetchVapidPublicKey(): Promise<string> {
  try {
    const response = await api.get<{ public_key?: string }>('/push/public-key/')
    return String(response.data?.public_key || '')
  } catch {
    return ''
  }
}

/**
 * Запрашивает разрешение на уведомления и подписывает браузер на Web Push.
 * Безопасно вызывать повторно: уже выданное разрешение/подписка не дублируются.
 */
export async function enablePushNotifications(): Promise<
  'granted' | 'denied' | 'unsupported' | 'disabled'
> {
  // Push API доступен только в secure-контексте (localhost/HTTPS).
  // В dev-сборке тоже включаем — чтобы проверять пуши локально.
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (!('Notification' in window)) return 'unsupported'

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') {
    return permission === 'denied' ? 'denied' : 'disabled'
  }

  try {
    const reg = await navigator.serviceWorker.ready
    const publicKey = await fetchVapidPublicKey()
    let subscription = await reg.pushManager.getSubscription()
    // Подписка могла остаться под СТАРЫЙ VAPID-ключ (ключи на сервере меняли,
    // подписку переносили между окружениями). Тогда push-сервис отвечает
    // ошибкой на наши запросы, а сервер считает, что канал есть: уведомления
    // молча не приходят — в том числе о звонке при закрытом приложении.
    if (
      subscription &&
      publicKey &&
      subscriptionKey(subscription) &&
      subscriptionKey(subscription) !== publicKey.replace(/=+$/, '')
    ) {
      await subscription.unsubscribe().catch(() => undefined)
      subscription = null
    }
    if (!subscription) {
      if (!publicKey) return 'disabled'
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
    }
    const json = subscription.toJSON() as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    if (json.endpoint && json.keys?.p256dh && json.keys.auth) {
      // Повторная отправка безопасна (upsert): строка подписки живёт в БД,
      // пока человек не выключил уведомления сам.
      await api.post('/push/subscribe/', {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth
      })
    }
    return 'granted'
  } catch (error) {
    console.error('Не удалось включить push-уведомления:', error)
    return 'disabled'
  }
}

/** Отписывается от Web Push (удаляет подписку на сервере и в браузере). */
export async function disablePushNotifications(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.getSubscription()
      if (!subscription) return
      const json = subscription.toJSON() as { endpoint?: string }
      if (json.endpoint) {
        try {
          await api.post('/push/unsubscribe/', { endpoint: json.endpoint })
        } catch {
          /* сервер недоступен — игнорируем */
        }
      }
      await subscription.unsubscribe()
    }
  } catch {
    /* ignore */
  }
}

// ---------- Состояние push (для UI-подсказки «Разрешить уведомления») ----------

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported'

/** Текущее разрешение на уведомления (или 'unsupported', если Push недоступен). */
export function getPushPermission(): PushPermission {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission as PushPermission
}

/** Есть ли уже активная Web Push-подписка в этом браузере. */
export async function isPushSubscribed(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.getSubscription()
    return subscription !== null
  } catch {
    return false
  }
}

// ---------- Входящие звонки: системное «будильник»-уведомление ----------

/**
 * Ритм вибрации уведомления о звонке (~1,9 с: три толчка с короткими паузами).
 *
 * Ровно тот же ритм стоит в `public/sw.js` (`CALL_RING_VIBRATION`): service
 * worker не модуль и импортировать отсюда не может. Раскладка уведомления о
 * звонке уже один раз разъезжалась между этими двумя местами — и «Ответить»
 * превращалось в отказ, поэтому расхождение проверяет страж
 * `__tests__/callOffline.spec.ts`.
 */
export const CALL_RING_VIBRATION = [400, 300, 400, 300, 400]

/**
 * Показывает системное уведомление о входящем звонке (когда приложение
 * свёрнуто/в фоне): тап или кнопка «Открыть» открывают приложение к экрану
 * звонка, где есть «Ответить» и «Отклонить».
 *
 * Кнопка ТОЛЬКО ОДНА, и она ничего не решает за человека. Двух кнопок
 * («Ответить»/«Отклонить») здесь быть не должно: на Android нажатие на кнопку
 * приходит в service worker как действие СОСЕДНЕЙ кнопки, и «Ответить»
 * превращалось в отказ — звонок обрывался у обоих. Отказать можно смахиванием
 * уведомления.
 */
export async function showIncomingCallRing(opts: {
  title: string
  body: string
  callId: string
  peerId: number
}): Promise<void> {
  try {
    if (getPushPermission() !== 'granted') return
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    const options = {
      body: opts.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: 'call-' + opts.callId,
      requireInteraction: true,
      renotify: true,
      silent: false,
      vibrate: CALL_RING_VIBRATION,
      // actions/renotify/vibrate нет в старых типах NotificationOptions — приводим.
      actions: [{ action: 'open', title: t('Открыть') }],
      data: { type: 'call', call_id: opts.callId, peer_id: opts.peerId }
    }
    await reg.showNotification(opts.title, options as unknown as NotificationOptions)
  } catch {
    /* уведомление не показалось — внутри приложения всё равно есть оверлей */
  }
}

/** Закрывает системные уведомления о звонках (звонок принят/завершён). */
export async function closeCallRings(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    const list = await reg.getNotifications()
    list.filter((n) => (n.tag || '').startsWith('call-')).forEach((n) => n.close())
  } catch {
    /* ignore */
  }
}
