/** Построение «ленты» сообщений: группировка по дням + клиентский фильтр. */

import type { Message } from '@/types'
import { dayLabel, toDate } from '@/utils/format'

export type MessageRow = { kind: 'day'; label: string } | { kind: 'message'; message: Message }

/** Проходит ли сообщение клиентский фильтр (текст/имя вложения). */
export const messageTextMatch = (message: Message, query: string): boolean => {
  if (!query) return true
  const haystack = `${message.text} ${message.file?.name ?? ''}`.toLowerCase()
  return haystack.includes(query)
}

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
