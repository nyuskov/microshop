/**
 * Присутствие собеседников (WS поверх last_seen) и индикатор «печатает…».
 *
 * Состояние живёт в composable; таймеры «печатает…» гасятся при
 * размонтировании компонента (onScopeDispose).
 */
import { onScopeDispose, reactive } from 'vue'

export interface PeerPresenceState {
  online: boolean
  last_seen: string | null
}

export interface PeerActivityOptions {
  /** Проверяет, является ли пользователь текущим (свои события пропускаем). */
  isMe: (userId: number) => boolean
}

const TYPING_DISPLAY_MS = 4000

export function usePeerActivity(options: PeerActivityOptions) {
  // ---- Присутствие ----
  const peerPresence = reactive<Record<number, PeerPresenceState>>({})

  const applyPresence = (userId: number, online: boolean, lastSeen: string | null) => {
    peerPresence[userId] = { online, last_seen: lastSeen }
  }

  /**
   * Применяет снимок присутствия с сервера (приходит сразу после подключения WS).
   * Полностью заменяет локальное состояние: сервер — единственный источник правды,
   * поэтому устаревший `last_seen` больше не превращается в «в сети».
   */
  const applyPresenceSnapshot = (
    list: { user_id: number; online: boolean; last_seen: string | null }[]
  ) => {
    clearPresence()
    for (const item of list) {
      if (options.isMe(item.user_id)) continue
      peerPresence[item.user_id] = { online: item.online, last_seen: item.last_seen }
    }
  }

  /**
   * «Затравка» присутствия из ответа /chats: используется только время последней
   * активности и НИКОГДА не выводится «в сети» — иначе появляется ложный онлайн.
   */
  const seedPresence = (userId: number, lastSeen: string | null) => {
    if (options.isMe(userId)) return
    if (peerPresence[userId]) return
    peerPresence[userId] = { online: false, last_seen: lastSeen }
  }

  const clearPresence = () => {
    for (const key of Object.keys(peerPresence)) {
      delete peerPresence[Number(key)]
    }
  }

  // ---- Индикатор «печатает…» ----
  const peerTypingUntil = reactive<Record<number, number>>({})
  const typingClearTimers: Record<number, number> = {}

  const isPeerTyping = (chatId: number | null): boolean =>
    chatId !== null && (peerTypingUntil[chatId] ?? 0) > Date.now()

  const markPeerTyping = (chatId: number, userId: number) => {
    if (options.isMe(userId)) return
    if (typingClearTimers[chatId]) {
      window.clearTimeout(typingClearTimers[chatId])
    }
    peerTypingUntil[chatId] = Date.now() + TYPING_DISPLAY_MS
    typingClearTimers[chatId] = window.setTimeout(() => {
      delete peerTypingUntil[chatId]
      delete typingClearTimers[chatId]
    }, TYPING_DISPLAY_MS + 300)
  }

  const clearPeerTyping = (chatId: number) => {
    if (typingClearTimers[chatId]) {
      window.clearTimeout(typingClearTimers[chatId])
      delete typingClearTimers[chatId]
    }
    delete peerTypingUntil[chatId]
  }

  const clearTyping = () => {
    for (const key of Object.keys(peerTypingUntil)) {
      clearPeerTyping(Number(key))
    }
  }

  /** Сбрасывает и присутствие, и индикатор «печатает…» (например, при выходе). */
  const clearAll = () => {
    clearPresence()
    clearTyping()
  }

  onScopeDispose(clearTyping)

  return {
    peerPresence,
    peerTypingUntil,
    applyPresence,
    applyPresenceSnapshot,
    seedPresence,
    clearPresence,
    isPeerTyping,
    markPeerTyping,
    clearPeerTyping,
    clearTyping,
    clearAll
  }
}
