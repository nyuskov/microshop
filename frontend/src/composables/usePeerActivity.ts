/**
 * Присутствие собеседников (WS поверх last_seen) и их активность:
 * «печатает…», «записывает голосовое…», «отправляет файл…».
 *
 * Состояние живёт в composable; таймеры активности гасятся при
 * размонтировании компонента (onScopeDispose).
 */
import { onScopeDispose, reactive } from 'vue'

import {
  PEER_ACTIVITY_DEFAULT,
  PEER_ACTIVITY_TTL_MS,
  isPeerActivityKind,
  type PeerActivityKind
} from '@/utils/peerActivity'

export interface PeerPresenceState {
  online: boolean
  last_seen: string | null
}

/** Кто и чем занят в чате прямо сейчас. */
export interface PeerActivityState {
  userId: number
  kind: PeerActivityKind
}

export interface PeerActivityOptions {
  /** Проверяет, является ли пользователь текущим (свои события пропускаем). */
  isMe: (userId: number) => boolean
}

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

  // ---- Активность собеседника ----
  // Одно состояние на чат: в группе сразу несколько «печатает…» — это шум, а
  // гасить подписи по отдельности всё равно пришлось бы по чату.
  const peerActivity = reactive<Record<number, PeerActivityState>>({})
  const activityClearTimers: Record<number, number> = {}

  /** Чем занят собеседник в чате (`null` — ничем). */
  const peerActivityOf = (chatId: number | null): PeerActivityState | null =>
    chatId === null ? null : (peerActivity[chatId] ?? null)

  /** Печатает ли собеседник прямо сейчас (для мест, которым нужен только текст). */
  const isPeerTyping = (chatId: number | null): boolean => peerActivityOf(chatId)?.kind === 'text'

  const markPeerActivity = (chatId: number, userId: number, kind?: string) => {
    if (options.isMe(userId)) return
    if (activityClearTimers[chatId]) {
      window.clearTimeout(activityClearTimers[chatId])
    }
    // Вид пришёл из сети: незнакомый считаем набором текста, иначе подпись
    // получилась бы пустой.
    const safeKind = isPeerActivityKind(kind) ? kind : PEER_ACTIVITY_DEFAULT
    peerActivity[chatId] = { userId, kind: safeKind }
    activityClearTimers[chatId] = window.setTimeout(() => {
      delete peerActivity[chatId]
      delete activityClearTimers[chatId]
    }, PEER_ACTIVITY_TTL_MS[safeKind] + 300)
  }

  /** Совместимое имя: набор текста — частный случай активности. */
  const markPeerTyping = (chatId: number, userId: number) =>
    markPeerActivity(chatId, userId, PEER_ACTIVITY_DEFAULT)

  const clearPeerActivity = (chatId: number) => {
    if (activityClearTimers[chatId]) {
      window.clearTimeout(activityClearTimers[chatId])
      delete activityClearTimers[chatId]
    }
    delete peerActivity[chatId]
  }

  const clearTyping = () => {
    for (const key of Object.keys(peerActivity)) {
      clearPeerActivity(Number(key))
    }
  }

  /** Сбрасывает и присутствие, и активность (например, при выходе). */
  const clearAll = () => {
    clearPresence()
    clearTyping()
  }

  onScopeDispose(clearTyping)

  return {
    peerPresence,
    peerActivity,
    applyPresence,
    applyPresenceSnapshot,
    seedPresence,
    clearPresence,
    peerActivityOf,
    isPeerTyping,
    markPeerActivity,
    markPeerTyping,
    clearPeerActivity,
    // Прежнее имя: подпись гасится тем же вызовом, что и запись голосового.
    clearPeerTyping: clearPeerActivity,
    clearTyping,
    clearAll
  }
}
