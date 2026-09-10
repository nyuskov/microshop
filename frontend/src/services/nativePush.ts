/**
 * Push-уведомления в нативном Android-приложении (RuStore).
 *
 * Приложение Android (`android/`) — это WebView с тем же самым веб-клиентом.
 * Web Push в WebView не работает, поэтому там используется RuStore Push SDK:
 * нативный слой получает токен и отдаёт его странице, а страница регистрирует
 * токен на сервере.
 *
 * Общение идёт через DOM-события `pismo:*` и объект `window.PismoNative` —
 * в браузере (PWA) этот модуль не делает ничего, поэтому веб-версия работает
 * как раньше, через обычный Web Push.
 */

import { api } from './api'

const UA_MARKER = 'PismoAndroid'

interface NativeBridge {
  getPushToken?: () => string
  requestPushToken?: () => void
  requestNotificationsPermission?: () => void
  isNotificationPermissionGranted?: () => boolean
  getAppVersion?: () => string
  openExternal?: (url: string) => void
}

declare global {
  interface Window {
    PismoNative?: NativeBridge
  }
}

/** Событие «пришёл push-токен RuStore». */
interface RustoreTokenDetail {
  token?: string
}

/** Событие статуса push из нативного слоя. */
interface NativePushStatusDetail {
  status?: string
  reason?: string
}

/** Данные push-сообщения (тип, чат, звонок). */
export type NativePushData = Record<string, string>

/** Открыт ли клиент внутри Android-приложения (а не в браузере). */
export function isNativeApp(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes(UA_MARKER)
}

/** Мост в нативный слой (есть только внутри Android-приложения). */
function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null
  return window.PismoNative ?? null
}

/** Регистрирует push-токен RuStore на сервере (идемпотентно). */
async function sendTokenToServer(token: string): Promise<void> {
  if (!token) return
  try {
    await api.post('/push/rustore/subscribe/', { token })
  } catch {
    // Сеть/401 — токен уже сохранён в нативном слое, повторим при следующем старте.
  }
}

/** Снимает push-токен с сервера (уведомления выключены в профиле). */
export async function unregisterNativePush(): Promise<void> {
  const token = nativeBridge()?.getPushToken?.() ?? ''
  if (!token) return
  try {
    await api.post('/push/rustore/unsubscribe/', { token })
  } catch {
    /* не критично: сервер просто продолжит слать push до выключения в настройках */
  }
}

/** Включает уведомления в нативном приложении (запрос разрешения + токен). */
export function enableNativePush(): void {
  const bridge = nativeBridge()
  if (!bridge) return
  bridge.requestNotificationsPermission?.()
  bridge.requestPushToken?.()
  const token = bridge.getPushToken?.() ?? ''
  if (token) void sendTokenToServer(token)
}

/** Выключает уведомления в нативном приложении. */
export async function disableNativePush(): Promise<void> {
  await unregisterNativePush()
}

function onNativeEvent<T>(name: string, handler: (detail: T) => void): () => void {
  const listener = (event: Event): void => handler((event as CustomEvent<T>).detail)
  window.addEventListener(`pismo:${name}`, listener)
  return () => window.removeEventListener(`pismo:${name}`, listener)
}

export interface NativePushHandlers {
  /** Клик по уведомлению: нужно открыть чат/звонок. */
  onOpenTarget?: (data: NativePushData) => void
  /** Пришло push-сообщение при открытом приложении — можно обновить данные. */
  onPushData?: (data: NativePushData) => void
  /** Статус push: granted / denied / unavailable / disabled / error. */
  onStatus?: (status: string, reason?: string) => void
}

/**
 * Подписывается на события нативной оболочки и запрашивает push-токен.
 * Возвращает функцию отписки. В браузере — no-op.
 */
export function initNativePush(handlers: NativePushHandlers = {}): () => void {
  if (!isNativeApp() || typeof window === 'undefined') return () => {}

  const disposers: Array<() => void> = [
    onNativeEvent<RustoreTokenDetail>('rustore-token', (detail) => {
      void sendTokenToServer(detail?.token ?? '')
    }),
    onNativeEvent<NativePushData>('push', (detail) => handlers.onPushData?.(detail ?? {})),
    onNativeEvent<NativePushData>('open', (detail) => handlers.onOpenTarget?.(detail ?? {})),
    onNativeEvent<NativePushStatusDetail>('push-status', (detail) =>
      handlers.onStatus?.(detail?.status ?? '', detail?.reason)
    )
  ]

  const bridge = nativeBridge()
  // Токен мог быть получен, пока страница ещё грузилась.
  const existing = bridge?.getPushToken?.() ?? ''
  if (existing) void sendTokenToServer(existing)
  // Просим нативный слой получить/обновить токен (и разрешение на уведомления).
  bridge?.requestPushToken?.()

  return () => {
    disposers.forEach((dispose) => dispose())
  }
}
