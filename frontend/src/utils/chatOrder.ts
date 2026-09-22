/**
 * Порядок списка чатов.
 *
 * Отдельным модулем, потому что правило нужно и списку (`ChatSidebar`), и тестам,
 * а «свежесть» сообщения считается по серверному времени (`parseServerTime`), а
 * не локальным `new Date`: иначе в поясе со сдвигом порядок уезжал бы.
 */
import type { Chat } from '@/types'
import { parseServerTime } from '@/utils/format'

/** Время последнего сообщения чата в миллисекундах (0 — сообщений не было). */
export const chatRecency = (chat: Chat): number => {
  const stamp = chat.last_message?.timestamp
  if (!stamp) return 0
  const at = parseServerTime(stamp)
  return Number.isNaN(at.getTime()) ? 0 : at.getTime()
}

/**
 * Чаты в порядке показа: «Сохранённые сообщения», затем закреплённые, затем все
 * остальные — по свежести последнего сообщения (самое новое сверху); чаты без
 * сообщений в конце.
 *
 * Свежесть = время последнего сообщения (а не «когда прочитал»): чат с новым
 * сообщением ведёт себя как любой чат с последним сообщением — всплывает наверх.
 * Владелец: «чаты с новыми должны вылезать на верх списка как последнее
 * сообщение, а то сейчас на месте стоят». Раньше порядок брали такой, какой
 * пришёл с сервера, поэтому между опросами список не переставлялся.
 *
 * Сортировка `Array.sort` устойчива, поэтому чаты с одинаковым временем
 * (ничьи) сохраняют порядок сервера.
 */
export function orderChats(chats: Chat[], pinnedIds: readonly number[] = []): Chat[] {
  const pinned = new Set(pinnedIds)
  const self = chats.filter((chat) => chat.is_self)
  const others = [...chats.filter((chat) => !chat.is_self)].sort(
    (a, b) => chatRecency(b) - chatRecency(a)
  )
  if (pinned.size === 0) return [...self, ...others]
  return [
    ...self,
    ...others.filter((chat) => pinned.has(chat.id)),
    ...others.filter((chat) => !pinned.has(chat.id))
  ]
}
