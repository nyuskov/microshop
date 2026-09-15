import { describe, expect, it } from 'vitest'

import type { Message } from '@/types'
import { buildMessageRows, messageTextMatch, seriesKindFor } from '@/utils/thread'

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
  forwarded_from: null,
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

describe('seriesKindFor: серии сообщений одного автора', () => {
  // Строки ленты считаем так же, как их строит компонент (с разделителями дней).
  const rowsOf = (messages: Message[]) => buildMessageRows(messages)
  /** Индексы строк-сообщений в общем списке (пропуская разделители дней). */
  const messageIndexes = (rows: ReturnType<typeof buildMessageRows>) =>
    rows.map((row, index) => (row.kind === 'message' ? index : -1)).filter((index) => index >= 0)

  it('одиночное сообщение — single, серия из трёх — first/middle/last', () => {
    const rows = rowsOf([
      makeMessage({ id: 1, timestamp: '2026-09-07T10:00:00Z' }),
      makeMessage({ id: 2, timestamp: '2026-09-07T10:01:00Z' }),
      makeMessage({ id: 3, timestamp: '2026-09-07T10:02:00Z' })
    ])
    const [a, b, c] = messageIndexes(rows)
    expect(seriesKindFor(rows, a)).toBe('first')
    expect(seriesKindFor(rows, b)).toBe('middle')
    expect(seriesKindFor(rows, c)).toBe('last')
  })

  it('одиночное сообщение — single', () => {
    const rows = rowsOf([makeMessage({ id: 1 })])
    const [only] = messageIndexes(rows)
    expect(seriesKindFor(rows, only)).toBe('single')
  })

  it('сообщение от другого автора начинает новую серию', () => {
    const rows = rowsOf([
      makeMessage({ id: 1, user_id: 1, timestamp: '2026-09-07T10:00:00Z' }),
      makeMessage({ id: 2, user_id: 2, timestamp: '2026-09-07T10:01:00Z' })
    ])
    const [a, b] = messageIndexes(rows)
    expect(seriesKindFor(rows, a)).toBe('single')
    expect(seriesKindFor(rows, b)).toBe('single')
  })

  it('пауза больше порога разрывает серию', () => {
    const rows = rowsOf([
      makeMessage({ id: 1, timestamp: '2026-09-07T10:00:00Z' }),
      makeMessage({ id: 2, timestamp: '2026-09-07T10:06:00Z' }) // ровно 6 минут
    ])
    const [a, b] = messageIndexes(rows)
    expect(seriesKindFor(rows, a)).toBe('single')
    expect(seriesKindFor(rows, b)).toBe('single')
  })

  it('разделитель дня разрывает серию', () => {
    // Время задаём в ЛОКАЛЬНОМ дне: разделители считаются по локальной дате, а
    // строки вида «23:59Z» в Москве попадают уже на следующий день.
    const rows = rowsOf([
      makeMessage({ id: 1, timestamp: new Date(2026, 8, 7, 23, 59).toISOString() }),
      makeMessage({ id: 2, timestamp: new Date(2026, 8, 8, 0, 1).toISOString() })
    ])
    const [a, b] = messageIndexes(rows)
    // В списке между ними стоит разделитель дня — серия начинается заново.
    expect(rows[a + 1]).toMatchObject({ kind: 'day' })
    expect(seriesKindFor(rows, a)).toBe('single')
    expect(seriesKindFor(rows, b)).toBe('single')
  })

  it('разделитель дня не ломает расчёт индексов соседей', () => {
    // Вечер → утро одного автора: до разделителя и после — разные серии.
    const rows = rowsOf([
      makeMessage({ id: 1, timestamp: new Date(2026, 8, 7, 20, 0).toISOString() }),
      makeMessage({ id: 2, timestamp: new Date(2026, 8, 8, 9, 0).toISOString() }),
      makeMessage({ id: 3, timestamp: new Date(2026, 8, 8, 9, 1).toISOString() })
    ])
    const [a, b, c] = messageIndexes(rows)
    expect(seriesKindFor(rows, a)).toBe('single')
    expect(seriesKindFor(rows, b)).toBe('first')
    expect(seriesKindFor(rows, c)).toBe('last')
  })

  it('на разделителе дня возвращает single (рисуется без пузыря)', () => {
    const rows = rowsOf([makeMessage({ id: 1 })])
    expect(seriesKindFor(rows, 0)).toBe('single')
  })
})
