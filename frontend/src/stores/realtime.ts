/**
 * Событийный WebSocket-канал мессенджера (push вместо поллинга).
 *
 * Сервер пушит события: новые сообщения, изменения сообщений, новые чаты,
 * прочтение и присутствие. Компонент регистрирует обработчик через
 * ``setHandler`` и по событию делает выборочный refetch.
 *
 * Менеджер ресурсов живёт в module-scope (как в stores/call.ts): WebSocket не
 * держим в реактивном состоянии. Жизненный цикл управляется из Messenger.vue.
 */

import { defineStore } from 'pinia'

import { WS_ORIGIN } from '@/config'
import { useAuthStore } from './auth'

const WS_PATH = '/api/v1/ws/events'

export type RealtimeEvent =
  | { type: 'message.new'; chat_id: number; message_id: number; sender_id: number }
  | {
      type: 'message.changed'
      chat_id: number
      message_id: number
      kind: string
    }
  | { type: 'chat.new'; chat_id: number; user_id: number }
  | { type: 'chat.removed'; chat_id: number; user_id: number }
  | {
      type: 'chat.updated'
      chat_id: number
      user_id?: number
      action?: string
      role?: string
    }
  | { type: 'chat.read'; chat_id: number; reader_id: number }
  | { type: 'presence'; user_id: number; online: boolean; last_seen: string | null }
  | {
      type: 'presence.snapshot'
      users: { user_id: number; online: boolean; last_seen: string | null }[]
    }
  | { type: 'typing'; chat_id: number; user_id: number }
  | { type: 'typing-stop'; chat_id: number; user_id: number }

let socket: WebSocket | null = null
let eventHandler: ((event: RealtimeEvent) => void) | null = null
let reconnectTimer: number | null = null
let heartbeatTimer: number | null = null
let awayTimer: number | null = null
let manualClose = false

/**
 * Как часто напоминаем серверу, что мы живы.
 *
 * Без этого «вышел, а он ещё в сети»: если приложение убили или телефон уснул,
 * сокет не закрывается чисто, и сервер считает человека онлайн до таймаута прокси
 * (минуты). Сервер закрывает молчащий канал сам (см. `WS_IDLE_TIMEOUT_SECONDS`).
 */
const HEARTBEAT_MS = 25_000

/**
 * Через сколько после ухода в фон говорим «не в сети».
 *
 * Свёрнутое приложение — это «человек ушёл» (иначе собеседник видит «в сети» у
 * того, кто вообще закрыл мессенджер и ушёл в другие приложения), но небольшой
 * запас нужен, чтобы статус не мигал при каждом переключении окна.
 */
const AWAY_GRACE_MS = 20_000

function socketUrl(token: string): string {
  return `${WS_ORIGIN}${WS_PATH}?token=${encodeURIComponent(token)}`
}

export const useRealtimeStore = defineStore('realtime', {
  state: () => ({
    connected: false
  }),

  actions: {
    /** Регистрирует обработчик событий (один на приложение — Messenger). */
    setHandler(handler: ((event: RealtimeEvent) => void) | null) {
      eventHandler = handler
    },

    async connect(): Promise<boolean> {
      const authStore = useAuthStore()
      const token = authStore.accessToken
      if (!token) return false
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) {
        return this.connected
      }

      manualClose = false
      socket = new WebSocket(socketUrl(token))
      socket.onopen = () => {
        this.connected = true
        this.startHeartbeat()
        // Сразу говорим, у экрана человек или приложение свёрнуто: по одному
        // факту подключения «в сети» определять нельзя — приложение могло
        // переподключиться в фоне.
        this.reportPresence()
      }
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as RealtimeEvent
          if (data && typeof data.type === 'string' && eventHandler) {
            eventHandler(data)
          }
        } catch {
          // Некорректное сообщение игнорируем.
        }
      }
      // onclose не перезаписываем, пока ждём открытия (иначе теряется реконнект).
      socket.onclose = () => {
        this.connected = false
        socket = null
        this.stopHeartbeat()
        if (!manualClose) this.scheduleReconnect()
      }
      return this.waitForOpen()
    },

    /** Пока канал открыт — шлём `ping`, чтобы сервер видел нас живыми. */
    startHeartbeat() {
      this.stopHeartbeat()
      heartbeatTimer = window.setInterval(() => {
        this.send({ type: 'ping' })
      }, HEARTBEAT_MS)
    },

    stopHeartbeat() {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    },

    /** Сейчас же сообщаем, у экрана человек или нет (подключение/возврат). */
    reportPresence() {
      if (awayTimer !== null) {
        window.clearTimeout(awayTimer)
        awayTimer = null
      }
      this.send({ type: 'activity', active: !document.hidden })
    },

    /**
     * Приложение свернули.
     *
     * Сообщаем «не в сети» с небольшой задержкой: так собеседник не видит
     * «в сети» у того, кто ушёл в другое приложение, но и быстрые переключения
     * окна статус не мигают.
     */
    scheduleAway() {
      if (awayTimer !== null) return
      awayTimer = window.setTimeout(() => {
        awayTimer = null
        if (!document.hidden) return
        this.send({ type: 'activity', active: false })
      }, AWAY_GRACE_MS)
    },

    /**
     * Прощается с сервером перед уходом со страницы.
     *
     * Закрытие вкладки и так даёт разрыв сокета, но при сворачивании/убийстве
     * приложения браузер об этом не сообщает: собеседник видел бы «в сети»,
     * пока не сработает heartbeat-таймаут.
     */
    sayGoodbye() {
      this.send({ type: 'bye' })
    },

    disconnect() {
      manualClose = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (awayTimer !== null) {
        window.clearTimeout(awayTimer)
        awayTimer = null
      }
      this.stopHeartbeat()
      if (socket) {
        socket.onclose = null
        socket.close()
        socket = null
      }
      this.connected = false
    },

    waitForOpen(): Promise<boolean> {
      return new Promise((resolve) => {
        const started = Date.now()
        const tick = () => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            resolve(true)
            return
          }
          if (!socket || socket.readyState === WebSocket.CLOSED) {
            resolve(false)
            return
          }
          if (Date.now() - started > 9000) {
            // Не даём рукопожатию висеть вечно (VPN/фаервол может «глушить» без
            // ответа): закрываем — onclose запустит переподключение по расписанию.
            if (socket && socket.readyState === WebSocket.CONNECTING) {
              try {
                socket.close()
              } catch {
                /* ignore */
              }
            }
            resolve(this.connected)
            return
          }
          window.setTimeout(tick, 120)
        }
        tick()
      })
    },

    /** Отправляет клиентское событие на сервер (если канал открыт). */
    send(payload: Record<string, unknown>): boolean {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(payload))
      return true
    },

    scheduleReconnect() {
      if (reconnectTimer !== null) return
      const authStore = useAuthStore()
      if (!authStore.isAuthenticated) return
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void this.connect()
      }, 2500)
    }
  }
})
