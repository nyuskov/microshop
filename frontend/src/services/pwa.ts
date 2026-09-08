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
  // Service worker — только в production-сборке (в dev мешает HMR).
  if (!import.meta.env.PROD) return
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
  // Service worker и Push API — только в production-сборке (и на HTTPS).
  if (!import.meta.env.PROD) return 'unsupported'
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
  if (!import.meta.env.PROD) return
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
