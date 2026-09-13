import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useForward } from '@/composables/useForward'
import type { Message } from '@/types'

/**
 * Пересылка сообщений: в какие чаты уходит, что обновляется в ленте и списке,
 * как сбрасывается состояние. Логика вынесена из `Messenger.vue`.
 */

vi.mock('@/services/chatService', () => ({
  forwardMessage: vi.fn()
}))

vi.mock('@/services/errors', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback
}))

import { forwardMessage } from '@/services/chatService'

const forwardMock = vi.mocked(forwardMessage)

// У каждого теста — свой набор вызовов: иначе счётчики копятся между проверками.
beforeEach(() => {
  vi.clearAllMocks()
})

const message = (id: number): Message =>
  ({ id, chat_id: 7, user_id: 1, text: `msg${id}` }) as unknown as Message

const setup = (selectedChatId: number | null = null) => {
  const appended: Message[] = []
  const pinned: number[] = []
  const typingStops: number[] = []
  let chatsRefreshed = 0
  let prepared = 0

  const forward = useForward({
    selectedChatId: () => selectedChatId,
    appendToThread: (item) => appended.push(item),
    loadPinned: async (chatId) => {
      pinned.push(chatId)
    },
    refreshChats: async () => {
      chatsRefreshed += 1
    },
    stopTyping: (chatId) => typingStops.push(chatId),
    prepare: () => {
      prepared += 1
    }
  })

  return {
    forward,
    appended,
    pinned,
    typingStops,
    chatsRefreshed: () => chatsRefreshed,
    prepared: () => prepared
  }
}

describe('useForward', () => {
  it('открытие диалога сначала закрывает поповеры и правку', () => {
    const ctx = setup()
    ctx.forward.open(message(1))

    expect(ctx.prepared()).toBe(1)
    expect(ctx.forward.source.value).toMatchObject({ id: 1 })
  })

  it('пересылает в каждый выбранный чат и обновляет список чатов', async () => {
    forwardMock.mockImplementation(async (id, chatId) => message(id + chatId))
    const ctx = setup()
    ctx.forward.open(message(10))

    await ctx.forward.send([1, 2])

    expect(forwardMock.mock.calls).toEqual([
      [10, 1],
      [10, 2]
    ])
    expect(ctx.typingStops).toEqual([1, 2])
    expect(ctx.chatsRefreshed()).toBe(1)
    // Диалог закрылся после отправки.
    expect(ctx.forward.source.value).toBeNull()
    expect(ctx.forward.busy.value).toBe(false)
  })

  it('в открытую ленту добавляет сообщение только для выбранного чата', async () => {
    forwardMock.mockImplementation(async (id, chatId) => message(id + chatId))
    const ctx = setup(2)
    ctx.forward.open(message(10))

    await ctx.forward.send([1, 2])

    expect(ctx.appended.map((item) => item.id)).toEqual([12])
    expect(ctx.pinned).toEqual([2])
  })

  it('из режима выделения пересылает все сообщения в каждый чат', async () => {
    forwardMock.mockImplementation(async (id, chatId) => message(id + chatId))
    const ctx = setup()
    ctx.forward.open([message(10), message(20)])

    await ctx.forward.send([5])

    expect(forwardMock.mock.calls).toEqual([
      [10, 5],
      [20, 5]
    ])
    expect(ctx.forward.source.value).toBeNull()
  })

  it('без выбранных чатов ничего не отправляем', async () => {
    const ctx = setup()
    ctx.forward.open(message(10))

    await ctx.forward.send([])

    expect(forwardMock).not.toHaveBeenCalled()
    expect(ctx.forward.source.value).toMatchObject({ id: 10 })
  })

  it('ошибка отправки закрывает диалог и не оставляет «занято»', async () => {
    forwardMock.mockRejectedValue(new Error('сеть'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = setup()
    ctx.forward.open(message(10))

    await ctx.forward.send([1])

    expect(ctx.forward.source.value).toBeNull()
    expect(ctx.forward.busy.value).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('отмена сбрасывает состояние диалога', () => {
    const ctx = setup()
    ctx.forward.open(message(10))

    ctx.forward.cancel()

    expect(ctx.forward.source.value).toBeNull()
    expect(ctx.forward.busy.value).toBe(false)
  })
})
