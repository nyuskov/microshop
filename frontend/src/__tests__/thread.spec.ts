import { describe, expect, it } from 'vitest'

import type { Message } from '@/types'
import { buildMessageRows, messageTextMatch } from '@/utils/thread'

const makeMessage = (overrides: Partial<Message>): Message => ({
  id: 1,
  chat_id: 10,
  user_id: 1,
  text: 'Привет',
  timestamp: '2026-09-07T10:00:00Z',
  reply_to_id: null,
  is_read: true,
  is_pinned: false,
  edited_at: null,
  file: null,
  reactions: [],
  ...overrides
})

describe('buildMessageRows', () => {
  it('вставляет разделитель дня перед сообщениями нового дня', () => {
    const rows = buildMessageRows([
      makeMessage({ id: 1, timestamp: '2026-09-07T09:00:00Z', text: 'Утро' }),
      makeMessage({ id: 2, timestamp: '2026-09-08T09:00:00Z', text: 'Новый день' })
    ])
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ kind: 'day' })
    expect(rows[1]).toMatchObject({ kind: 'message', message: { id: 1 } })
    expect(rows[2]).toMatchObject({ kind: 'day' })
    expect(rows[3]).toMatchObject({ kind: 'message', message: { id: 2 } })
  })

  it('не дублирует разделитель для сообщений одного дня', () => {
    const rows = buildMessageRows([
      makeMessage({ id: 1, timestamp: '2026-09-07T09:00:00Z' }),
      makeMessage({ id: 2, timestamp: '2026-09-07T11:00:00Z' })
    ])
    expect(rows.filter((row) => row.kind === 'day')).toHaveLength(1)
    expect(rows).toHaveLength(3)
  })

  it('фильтрует по тексту и имени вложения без учёта регистра', () => {
    const rows = buildMessageRows(
      [
        makeMessage({ id: 1, text: 'Встречаемся в 18:00' }),
        makeMessage({ id: 2, text: 'Пока' }),
        makeMessage({
          id: 3,
          text: '',
          file: { name: 'Отчёт.pdf', url: '/media/x', mime: 'application/pdf', size: 10 }
        })
      ],
      'отчёт'
    )
    const ids = rows
      .filter((row): row is { kind: 'message'; message: Message } => row.kind === 'message')
      .map((row) => row.message.id)
    expect(ids).toEqual([3])
  })
})

describe('messageTextMatch', () => {
  it('пустой запрос подходит всем сообщениям', () => {
    expect(messageTextMatch(makeMessage({}), '')).toBe(true)
  })

  it('находит по фрагменту текста без учёта регистра', () => {
    expect(messageTextMatch(makeMessage({ text: 'Привет мир' }), 'прив')).toBe(true)
    expect(messageTextMatch(makeMessage({ text: 'Привет мир' }), 'нет')).toBe(false)
  })
})
