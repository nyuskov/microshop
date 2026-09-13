import { describe, expect, it } from 'vitest'

import {
  applyServerChatUnreadPolicy,
  clearUnreadInChatList,
  totalUnreadCount,
  unreadCountOfChat
} from '@/utils/chatUnread'
import type { Chat } from '@/types'

const chat = (id: number, unread_count: number): Chat =>
  ({
    id,
    unread_count,
    name: `Chat ${id}`,
    users: [],
    last_message: null
  }) as Chat

describe('chatUnread', () => {
  it('запоминает число непрочитанных у конкретного чата', () => {
    expect(unreadCountOfChat([chat(1, 3), chat(2, 7)], 2)).toBe(7)
    expect(unreadCountOfChat([chat(1, 3)], 99)).toBe(0)
  })

  it('гасит непрочитанное только у нужного чата', () => {
    const list = [chat(1, 3), chat(2, 7)]
    expect(clearUnreadInChatList(list, 2)).toEqual([chat(1, 3), chat(2, 0)])
  })

  it('не воскрешает непрочитанное у открытого чата, пока его читают', () => {
    const list = [chat(1, 5), chat(2, 1)]
    expect(applyServerChatUnreadPolicy(list, { openChatId: 1, reading: true })).toEqual([
      chat(1, 0),
      chat(2, 1)
    ])
  })

  it('в фоне применяет серверные числа как есть', () => {
    const list = [chat(1, 5), chat(2, 1)]
    expect(applyServerChatUnreadPolicy(list, { openChatId: 1, reading: false })).toEqual(list)
  })

  it('считает общий бейдж непрочитанных', () => {
    expect(totalUnreadCount([chat(1, 3), chat(2, 7), chat(3, 0)])).toBe(10)
  })
})
