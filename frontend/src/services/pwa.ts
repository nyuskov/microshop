/**
 * Регистрация service worker, механика «новая версия доступна» и Web Push.
 *
 * Web Push: после входа запрашиваем разрешение, создаём подписку браузера
 * (с VAPID-ключом сервера) и сохраняем её на бэкенде — дальше при новых
 * сообщениях сервер шлёт push, который service worker показывает как
 * системное уведомление (даже когда приложение закрыто).
 */

import { api } from './api'

let registration: ServiceWorkerRegistration | null = null

/** Регистрирует SW и вызывает onUpdate, когда доступна новая версия. */
export function registerServiceWorker(onUpdate: () => void): void {
  // SW нужен и в dev-сборке — иначе нельзя локально проверить Web Push.
  // Он работает только в secure-контексте (localhost/HTTPS): на других http-
  // origin ('serviceWorker' in navigator === false) молча пропускаем. В dev
  // после первой регистрации возможен один авто-reload (взятие контроля).
  if (!('serviceWorker' in navigator)) return

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

// ---------- Web Push (уведомления в PWA) ----------

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i)
  return output
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
    let subscription = await reg.pushManager.getSubscription()
    if (!subscription) {
      const publicKey = await fetchVapidPublicKey()
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
 * Показывает системное уведомление о входящем звонке (когда приложение
 * свёрнуто/в фоне): тап открывает приложение к экрану звонка, кнопки
 * «Ответить»/«Отклонить» управляют звонком через service worker.
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
      badge: '/icons/icon-192.png',
      tag: 'call-' + opts.callId,
      requireInteraction: true,
      // actions/renotify нет в старых типах NotificationOptions — приводим.
      actions: [
        { action: 'answer', title: 'Ответить' },
        { action: 'decline', title: 'Отклонить' }
      ],
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
