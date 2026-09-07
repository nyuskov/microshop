/**
 * Присутствие собеседников (WS поверх last_seen) и индикатор «печатает…».
 *
 * Состояние живёт в composable; таймеры «печатает…» гасятся при
 * размонтировании компонента (onScopeDispose).
 */
import { onScopeDispose, reactive } from 'vue'

import { ONLINE_WINDOW_SECONDS } from '@/utils/format'

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

  const isWithinOnlineWindow = (value?: string | null): boolean => {
    if (!value) return false
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return false
    return Date.now() - date.getTime() <= ONLINE_WINDOW_SECONDS * 1000
  }

  const applyPresence = (userId: number, online: boolean, lastSeen: string | null) => {
    peerPresence[userId] = { online, last_seen: lastSeen }
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
    isWithinOnlineWindow,
    applyPresence,
    clearPresence,
    isPeerTyping,
    markPeerTyping,
    clearPeerTyping,
    clearTyping,
    clearAll
  }
}
