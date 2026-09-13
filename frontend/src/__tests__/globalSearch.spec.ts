import { effectScope, nextTick, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_DEBOUNCE_MS, useGlobalSearch } from '@/composables/useGlobalSearch'

/**
 * Состояние глобального поиска: задержка, переключение «люди/сообщения»,
 * очистка результатов и ошибки. Проверяем без DOM — это и была цель выноса
 * логики из `ChatSidebar`.
 */

vi.mock('@/services/chatService', () => ({
  searchUsers: vi.fn(),
  searchMessages: vi.fn()
}))

vi.mock('@/services/errors', () => ({
  // Возвращаем запасной текст: так тест фиксирует, что он показывается человеку.
  getErrorMessage: (_error: unknown, fallback: string) => fallback
}))

import { searchMessages, searchUsers } from '@/services/chatService'
import type { Message } from '@/types'

const usersMock = vi.mocked(searchUsers)
const messagesMock = vi.mocked(searchMessages)

const foundUser = (id: number) => ({
  id,
  username: `u${id}`,
  first_name: '',
  last_name: '',
  phone_number: null,
  avatar_url: null,
  avatar_thumb_url: null
})

const foundMessage = (id: number): Message =>
  ({
    id,
    chat_id: id,
    user_id: 1,
    text: 'привет',
    timestamp: '2026-09-13T10:00:00Z',
    created_at: '2026-09-13T10:00:00Z'
  }) as Message

let scope: EffectScope
let search: ReturnType<typeof useGlobalSearch>

beforeEach(() => {
  vi.useFakeTimers()
  usersMock.mockReset()
  messagesMock.mockReset()
  scope = effectScope()
  scope.run(() => {
    search = useGlobalSearch()
  })
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

/** Дать наблюдателю сработать и «промотать» задержку запроса. */
const type = async (text: string) => {
  search.query.value = text
  await nextTick()
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
}

describe('useGlobalSearch', () => {
  it('на пустой запрос никуда не ходит', async () => {
    await type('   ')

    expect(usersMock).not.toHaveBeenCalled()
    expect(messagesMock).not.toHaveBeenCalled()
    expect(search.loading.value).toBe(false)
    expect(search.hasQuery.value).toBe(false)
  })

  it('запрос уходит только после задержки', async () => {
    usersMock.mockResolvedValue([foundUser(1)])

    search.query.value = 'ан'
    await nextTick()
    expect(usersMock).not.toHaveBeenCalled()
    expect(search.loading.value).toBe(true)

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    expect(usersMock).toHaveBeenCalledWith('ан')
    expect(search.users.value).toHaveLength(1)
    expect(search.loading.value).toBe(false)
  })

  it('пока человек печатает, лишних запросов нет', async () => {
    usersMock.mockResolvedValue([foundUser(1)])

    search.query.value = 'а'
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS / 2)
    search.query.value = 'ан'
    await nextTick()
    search.query.value = 'анн'
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)

    expect(usersMock).toHaveBeenCalledTimes(1)
    expect(usersMock).toHaveBeenCalledWith('анн')
  })

  it('режимы не смешиваются: результаты другого режима очищаются', async () => {
    usersMock.mockResolvedValue([foundUser(1)])
    messagesMock.mockResolvedValue([foundMessage(7)])

    await type('ан')
    expect(search.users.value).toHaveLength(1)

    search.setMode('messages')
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    expect(messagesMock).toHaveBeenCalledWith('ан')
    expect(search.messages.value).toHaveLength(1)
    expect(search.users.value).toHaveLength(0)
  })

  it('ошибку запроса показываем человеку', async () => {
    usersMock.mockRejectedValue(new Error('сеть'))

    await type('ан')

    expect(search.error.value).toBe('Не удалось выполнить поиск')
    expect(search.loading.value).toBe(false)
  })

  it('reset закрывает поиск: запрос, результаты, ожидание и ошибка очищены', async () => {
    usersMock.mockResolvedValue([foundUser(1)])
    await type('ан')
    search.setError('что-то пошло не так')

    search.reset()

    expect(search.query.value).toBe('')
    expect(search.users.value).toHaveLength(0)
    expect(search.messages.value).toHaveLength(0)
    expect(search.loading.value).toBe(false)
    expect(search.error.value).toBe('')
    expect(search.hasQuery.value).toBe(false)
  })

  it('после reset отложенный запрос не выстреливает', async () => {
    usersMock.mockResolvedValue([foundUser(1)])
    search.query.value = 'ан'
    await nextTick()

    search.reset()
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2)

    expect(usersMock).not.toHaveBeenCalled()
  })
})
