/** Построение «ленты» сообщений: группировка по дням + клиентский фильтр. */

import type { Message } from '@/types'
import { dayLabel, parseServerTime, toDate } from '@/utils/format'

export type MessageRow = { kind: 'day'; label: string } | { kind: 'message'; message: Message }

/** Проходит ли сообщение клиентский фильтр (текст/имя вложения). */
export const messageTextMatch = (message: Message, query: string): boolean => {
  if (!query) return true
  const haystack = `${message.text} ${message.file?.name ?? ''}`.toLowerCase()
  return haystack.includes(query)
}

/**
 * Пора ли снять отметки непрочитанного: человек дочитал ленту до конца.
 *
 * `distance` — сколько пикселей осталось до низа ленты. Без этого разделитель
 * «Непрочитанные сообщения» и отметки оставались до перезагрузки страницы, хотя
 * человек всё уже прочитал.
 */
export const unreadSeenAtBottom = (distance: number, unreadCount: number): boolean =>
  unreadCount > 0 && distance < 60

/** Строит список строк ленты: разделители дней + сами сообщения (по возрастанию id). */
export const buildMessageRows = (messages: Message[], filterText = ''): MessageRow[] => {
  const query = filterText.trim().toLowerCase()
  const rows: MessageRow[] = []
  let lastDay = ''
  for (const message of messages) {
    if (!messageTextMatch(message, query)) continue
    const date = toDate(message.timestamp)
    const key = date.toDateString()
    if (key !== lastDay) {
      rows.push({ kind: 'day', label: dayLabel(date) })
      lastDay = key
    }
    rows.push({ kind: 'message', message })
  }
  return rows
}

/** Пауза, после которой сообщение начинает новую «серию» (как в Telegram). */
export const SERIES_BURST_MS = 5 * 60 * 1000

/**
 * Место сообщения в «серии» — подряд идущих сообщениях одного автора.
 *
 * По серии рисуется и имя автора в группах, и скругления пузырей (срезанный
 * угол остаётся только у первого пузыря серии), и прижатые отступы. Раньше эта
 * логика жила в `MessageThread.vue` и касалась только имени автора.
 */
export type SeriesKind = 'single' | 'first' | 'middle' | 'last'

/** Сообщение строки ленты или null (разделитель дня). */
const messageAt = (rows: MessageRow[], index: number): Message | null => {
  const row = rows[index]
  return row && row.kind === 'message' ? row.message : null
}

/** Один ли это блок: тот же автор и пауза меньше порога. */
const sameSeries = (earlier: Message | null, later: Message | null): boolean => {
  if (!earlier || !later || earlier.user_id !== later.user_id) return false
  const gap =
    parseServerTime(later.timestamp).getTime() - parseServerTime(earlier.timestamp).getTime()
  return !Number.isNaN(gap) && gap < SERIES_BURST_MS
}

/** Как рисовать сообщение в ряду: одиночное, начало серии, середина или конец. */
export const seriesKindFor = (rows: MessageRow[], index: number): SeriesKind => {
  const current = messageAt(rows, index)
  if (!current) return 'single'
  // Сосед по строке ленты может быть разделителем дня — тогда серия начинается заново.
  const startsHere = !sameSeries(messageAt(rows, index - 1), current)
  const endsHere = !sameSeries(current, messageAt(rows, index + 1))
  if (startsHere && endsHere) return 'single'
  if (startsHere) return 'first'
  return endsHere ? 'last' : 'middle'
}
