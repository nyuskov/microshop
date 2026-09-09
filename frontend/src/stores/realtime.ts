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
  | { type: 'chat.read'; chat_id: number; reader_id: number }
  | { type: 'presence'; user_id: number; online: boolean; last_seen: string | null }
  | { type: 'typing'; chat_id: number; user_id: number }
  | { type: 'typing-stop'; chat_id: number; user_id: number }

let socket: WebSocket | null = null
let eventHandler: ((event: RealtimeEvent) => void) | null = null
let reconnectTimer: number | null = null
let manualClose = false

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
        if (!manualClose) this.scheduleReconnect()
      }
      return this.waitForOpen()
    },

    disconnect() {
      manualClose = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
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
