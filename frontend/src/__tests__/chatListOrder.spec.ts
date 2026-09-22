import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Chat } from '@/types'
import { chatRecency, orderChats } from '@/utils/chatOrder'

/**
 * Порядок списка чатов.
 *
 * Правило: «Сохранённые сообщения», потом закреплённые, потом все остальные — по
 * свежести последнего сообщения; чаты без сообщений в конце. Так чат с новым
 * сообщением всплывает наверх (жалоба владельца: «чаты с новыми стоят на месте»).
 */

const at = (stamp: string): Chat['last_message'] => ({ timestamp: stamp }) as Chat['last_message']

const chat = (id: number, extra: Partial<Chat> = {}): Chat =>
  ({
    id,
    name: `chat-${id}`,
    users: [],
    unread_count: 0,
    is_self: false,
    is_group: false,
    is_channel: false,
    last_message: null,
    ...extra
  }) as Chat

/** Чаты в списке «Все»: свои первыми, дальше по свежести. */
const ids = (list: Chat[]): number[] => list.map((item) => item.id)

describe('свежесть чата', () => {
  it('берётся из серверного времени последнего сообщения', () => {
    const fresh = chat(1, { last_message: at('2026-09-22T12:00:00Z') })
    const old = chat(2, { last_message: at('2026-09-22T10:00:00Z') })

    expect(chatRecency(fresh)).toBeGreaterThan(chatRecency(old))
  })

  it('у чата без сообщений — ноль', () => {
    expect(chatRecency(chat(1))).toBe(0)
    expect(chatRecency(chat(2, { last_message: at('мусор') }))).toBe(0)
  })
})

describe('порядок списка чатов', () => {
  it('свежее сообщение поднимает чат наверх', () => {
    const list = [
      chat(1, { last_message: at('2026-09-22T10:00:00Z') }),
      chat(2, { last_message: at('2026-09-22T12:00:00Z') }),
      chat(3, { last_message: at('2026-09-22T11:00:00Z') })
    ]

    expect(ids(orderChats(list))).toEqual([2, 3, 1])
  })

  it('чаты без сообщений — в конце, даже если они «старше» по id', () => {
    const list = [chat(1), chat(2, { last_message: at('2026-09-22T09:00:00Z') }), chat(3)]

    expect(ids(orderChats(list))).toEqual([2, 1, 3])
  })

  it('«Сохранённые сообщения» всегда сверху, и порядок пинов сохраняется', () => {
    const list = [
      chat(1, { last_message: at('2026-09-22T12:00:00Z') }),
      chat(2, { last_message: at('2026-09-22T09:00:00Z') }),
      chat(3, { last_message: at('2026-09-22T10:00:00Z') }),
      chat(4, { is_self: true, last_message: at('2026-09-22T08:00:00Z') })
    ]

    // Пины идут сразу после своих, и внутри них — тоже по свежести.
    expect(ids(orderChats(list, [2, 3]))).toEqual([4, 3, 2, 1])
  })

  it('ничьи не переставляются: порядок сервера сохраняется', () => {
    const list = [
      chat(5, { last_message: at('2026-09-22T12:00:00Z') }),
      chat(6, { last_message: at('2026-09-22T12:00:00Z') })
    ]

    expect(ids(orderChats(list))).toEqual([5, 6])
  })
})

describe('связка со списком чатов', () => {
  const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8').replace(
    /\s+/g,
    ' '
  )

  it('список берёт порядок из общего правила, а не из ответа сервера', () => {
    expect(sidebar).toContain("import { orderChats } from '@/utils/chatOrder'")
    expect(sidebar).toContain('return orderChats(filteredChats.value, props.pinnedChatIds ?? [])')
  })

  it('в папке остаётся ручной порядок — его правило не трогает', () => {
    expect(sidebar).toContain('return folderChats(folder, filteredChats.value)')
  })
})
