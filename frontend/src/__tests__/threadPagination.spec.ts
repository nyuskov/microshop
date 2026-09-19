import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * Страницы истории сообщений.
 *
 * Раньше это жило внутри `Messenger.vue` и проверялось только руками. Теперь логика
 * в composable — и её можно прогнать на поддельных страницах: важно, что догрузка
 * вверх НЕ роняет уже загруженное, что позиция прокрутки возвращается на место
 * (иначе лента «прыгает»), и что конец истории распознаётся один раз, а не запросом
 * на каждый скролл.
 */

const mocks = vi.hoisted(() => ({ fetchMessages: vi.fn() }))

vi.mock('@/services/chatService', () => ({ fetchMessages: mocks.fetchMessages }))

const { useThreadPagination, MESSAGES_PAGE_SIZE } =
  await import('@/composables/useThreadPagination')
const { getErrorMessage } =
  await vi.importActual<typeof import('@/services/errors')>('@/services/errors')

interface Row {
  id: number
  text: string
}

/** Строка истории: для этих тестов важны только id и порядок. */
const row = (id: number): Row => ({ id, text: `msg-${id}` }) as unknown as Row

/** Лента-заглушка: запоминает, что у неё просили, и возвращает заданные позиции. */
const makeThread = (
  position: { top: number; height: number } | null = { top: 100, height: 2000 }
) => ({
  captured: 0,
  restored: [] as { top: number; height: number }[],
  scrolled: 0,
  capture() {
    this.captured += 1
    return position
  },
  restoreScroll(top: number, height: number) {
    this.restored.push({ top, height })
  },
  isNearBottom: () => true,
  scrollToBottom() {
    this.scrolled += 1
  }
})

const setup = (initial: Row[] = [], thread = makeThread()) => {
  const messages = ref<Row[]>(initial)
  const api = useThreadPagination({
    messages: messages as never,
    selectedChatId: () => 5,
    thread: () => thread as never,
    // Расшифровка в тестах не нужна: страница приходит как есть.
    decryptPage: async (_chatId, list) => list as never
  })
  return { messages, thread, api }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('свежая страница', () => {
  it('открыли чат — в ленте ровно одна страница, флаги сброшены', async () => {
    mocks.fetchMessages.mockResolvedValue([row(1), row(2)])
    const { messages, api } = setup()

    await api.loadThreadLatest(5)

    expect(mocks.fetchMessages).toHaveBeenCalledWith(5, { limit: MESSAGES_PAGE_SIZE })
    expect(messages.value.map((m) => m.id)).toEqual([1, 2])
    expect(api.messagesLoading.value).toBe(false)
    expect(api.noMoreOlder.value).toBe(false)
  })

  it('ошибка загрузки не роняет приложение и гасит индикатор', async () => {
    mocks.fetchMessages.mockRejectedValue(new Error('сеть'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { api } = setup()

    await expect(api.loadThreadLatest(5)).resolves.toBeUndefined()

    expect(api.messagesLoading.value).toBe(false)
    expect(spy).toHaveBeenCalledWith(
      'Не удалось загрузить сообщения:',
      getErrorMessage(new Error('сеть'))
    )
    spy.mockRestore()
  })
})

describe('догрузка вверх', () => {
  it('старые страницы добавляются ВЫШЕ загруженных, прокрутка возвращается', async () => {
    const { messages, thread, api } = setup([row(100), row(101)])
    mocks.fetchMessages.mockResolvedValue([row(90), row(91)])

    await api.loadOlderMessages()

    // Запрашиваем именно «до самого старого» из загруженных.
    expect(mocks.fetchMessages).toHaveBeenCalledWith(5, {
      limit: MESSAGES_PAGE_SIZE,
      beforeId: 100
    })
    expect(messages.value.map((m) => m.id)).toEqual([90, 91, 100, 101])
    // Без возврата позиции лента «прыгнула» бы в начало.
    expect(thread.captured).toBe(1)
    expect(thread.restored).toEqual([{ top: 100, height: 2000 }])
  })

  it('пустая страница = конец истории, дальше не запрашиваем', async () => {
    const { api } = setup([row(1)])
    mocks.fetchMessages.mockResolvedValue([])

    await api.loadOlderMessages()
    expect(api.noMoreOlder.value).toBe(true)

    mocks.fetchMessages.mockClear()
    await api.loadOlderMessages()
    expect(mocks.fetchMessages).not.toHaveBeenCalled()
  })

  it('повтор страницы не дублирует сообщения (их уже подтянул WS)', async () => {
    const { messages, api } = setup([row(10), row(11)])
    mocks.fetchMessages.mockResolvedValue([row(10), row(11)])

    await api.loadOlderMessages()

    expect(api.noMoreOlder.value).toBe(true)
    expect(messages.value.map((m) => m.id)).toEqual([10, 11])
  })

  it('в пустом чате вверх не ходим', async () => {
    const { api } = setup([])

    await api.loadOlderMessages()

    expect(mocks.fetchMessages).not.toHaveBeenCalled()
  })
})

describe('склейка со свежей страницей', () => {
  it('загруженная история выше остаётся на месте', async () => {
    const { messages, api } = setup([row(1), row(2), row(3)])
    mocks.fetchMessages.mockResolvedValue([row(3), row(4)])

    const hasNew = await api.mergeThreadLatest(5)

    expect(messages.value.map((m) => m.id)).toEqual([1, 2, 3, 4])
    expect(hasNew).toBe(true)
  })

  it('без новых сообщений вниз не прокручиваем', async () => {
    const { thread, api } = setup([row(1), row(2)])
    mocks.fetchMessages.mockResolvedValue([row(1), row(2)])

    const hasNew = await api.mergeThreadLatest(5)

    expect(hasNew).toBe(false)
    expect(thread.scrolled).toBe(0)
  })
})
