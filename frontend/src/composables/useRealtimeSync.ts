/**
 * Оркестрация realtime-событий (WS-канал) вместо поллинга.
 *
 * Сервер пушит события, по которым делаем выборочный refetch; редкий
 * «страховочный» опрос остаётся на случай пропущенных событий/реконнекта.
 * Внутри — дебаунс-планировщики и fallback-интервал; наружу — start/stop.
 */
import { useRealtimeStore, type RealtimeEvent } from '@/stores/realtime'

const REALTIME_FALLBACK_MS = 20000
const SYNC_DEBOUNCE_MS = 120

export interface RealtimeSyncOptions {
  isAuthenticated: () => boolean
  /** Является ли пользователь текущим (свои события пропускаем). */
  isMe: (userId: number) => boolean
  getSelectedChatId: () => number | null
  onPresence: (userId: number, online: boolean, lastSeen: string | null) => void
  /** Полный снимок статусов собеседников (приходит сразу после подключения). */
  onPresenceSnapshot?: (
    users: { user_id: number; online: boolean; last_seen: string | null }[]
  ) => void
  onTyping: (chatId: number, userId: number) => void
  onTypingStop: (chatId: number) => void
  /** Мягкий refetch списка чатов (после дебаунса). */
  onChatsSync: () => Promise<void> | void
  /** Мягкий refetch открытого треда (после дебаунса). */
  onThreadSync: () => Promise<void> | void
  /** Пришло новое сообщение от собеседника (для уведомлений). */
  onMessageNew?: (chatId: number) => void
  /** Меня удалили/я вышел из чата (убрать его из локального списка). */
  onChatRemoved?: (chatId: number) => void
  /** Я сам прочитал этот чат на другом устройстве — погасить значок. */
  onChatReadElsewhere?: (chatId: number) => void
}

export function useRealtimeSync(options: RealtimeSyncOptions) {
  const realtimeStore = useRealtimeStore()

  let fallbackTimer: number | null = null
  let chatSyncTimer: number | null = null
  let threadSyncTimer: number | null = null

  const scheduleChatsSync = () => {
    if (chatSyncTimer !== null) window.clearTimeout(chatSyncTimer)
    chatSyncTimer = window.setTimeout(() => {
      chatSyncTimer = null
      void options.onChatsSync()
    }, SYNC_DEBOUNCE_MS)
  }

  const scheduleThreadSync = () => {
    if (threadSyncTimer !== null) window.clearTimeout(threadSyncTimer)
    threadSyncTimer = window.setTimeout(() => {
      threadSyncTimer = null
      void options.onThreadSync()
    }, SYNC_DEBOUNCE_MS)
  }

  const handleRealtimeEvent = (event: RealtimeEvent) => {
    switch (event.type) {
      case 'presence':
        options.onPresence(event.user_id, event.online, event.last_seen)
        return
      case 'presence.snapshot':
        // Сервер — источник правды: снимок заменяет локальные догадки целиком.
        options.onPresenceSnapshot?.(event.users)
        return
      case 'typing':
        options.onTyping(event.chat_id, event.user_id)
        return
      case 'typing-stop':
        options.onTypingStop(event.chat_id)
        return
      case 'chat.new':
        scheduleChatsSync()
        return
      case 'chat.updated':
        // Состав/название/аватар группы изменились — обновляем список (и,
        // если чат открыт, его карточку в ленте).
        scheduleChatsSync()
        if (event.chat_id === options.getSelectedChatId()) scheduleThreadSync()
        return
      case 'chat.removed':
        // Сервер шлёт это событие только исключённому/покинувшему участнику —
        // убираем чат из локального списка и закрываем, если он был открыт.
        options.onChatRemoved?.(event.chat_id)
        scheduleChatsSync()
        return
      case 'message.new':
        // Свои сообщения сервер не пушит — они добавляются сразу при отправке.
        if (options.isMe(event.sender_id)) return
        options.onTypingStop(event.chat_id)
        options.onMessageNew?.(event.chat_id)
        scheduleChatsSync()
        if (event.chat_id === options.getSelectedChatId()) scheduleThreadSync()
        return
      case 'message.changed':
        scheduleChatsSync()
        if (event.chat_id === options.getSelectedChatId()) scheduleThreadSync()
        return
      case 'chat.read':
        // Собеседник прочитал — обновляем галочки ✓✓ в открытом чате.
        if (options.isMe(event.reader_id)) return
        if (event.chat_id === options.getSelectedChatId()) {
          void options.onThreadSync()
        }
        return
      case 'chat.read-self':
        // Я прочитал этот чат на другом устройстве — убираем непрочитанное здесь.
        options.onChatReadElsewhere?.(event.chat_id)
        return
    }
  }

  const stop = () => {
    if (fallbackTimer !== null) {
      window.clearInterval(fallbackTimer)
      fallbackTimer = null
    }
    if (chatSyncTimer !== null) {
      window.clearTimeout(chatSyncTimer)
      chatSyncTimer = null
    }
    if (threadSyncTimer !== null) {
      window.clearTimeout(threadSyncTimer)
      threadSyncTimer = null
    }
    realtimeStore.disconnect()
  }

  const start = () => {
    realtimeStore.setHandler(handleRealtimeEvent)
    stop()
    // Синхронизируемся сразу после подключения (навёрстываем пропущенное).
    void realtimeStore.connect().then((connected) => {
      if (connected) {
        void options.onChatsSync()
        void options.onThreadSync()
      }
    })
    fallbackTimer = window.setInterval(() => {
      if (!options.isAuthenticated()) return
      void options.onChatsSync()
      void options.onThreadSync()
    }, REALTIME_FALLBACK_MS)
  }

  return { start, stop }
}
