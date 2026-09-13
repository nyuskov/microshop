import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONTACTS_SEARCH_DEBOUNCE_MS, useContactSearch } from '@/composables/useContactSearch'
import type { ChatUser } from '@/types'

/**
 * Поиск в разделе «Контакты»: задержка, минимум длины запроса, отсев уже
 * добавленных и себя, фильтр моей записной книжки. Логика вынесена из
 * `ChatSidebar` — проверяем без DOM.
 */

vi.mock('@/services/chatService', () => ({
  searchUsers: vi.fn()
}))

vi.mock('@/services/errors', () => ({
  // Возвращаем запасной текст: тест фиксирует, что он виден человеку.
  getErrorMessage: (_error: unknown, fallback: string) => fallback
}))

import { searchUsers } from '@/services/chatService'

const usersMock = vi.mocked(searchUsers)

const user = (id: number, patch: Partial<ChatUser> = {}): ChatUser =>
  ({
    id,
    username: `u${id}`,
    first_name: 'Имя',
    last_name: 'Фамилия',
    phone_number: `+7900111000${id}`,
    ...patch
  }) as unknown as ChatUser

const found = (id: number) => ({
  id,
  username: `u${id}`,
  first_name: '',
  last_name: '',
  phone_number: null,
  avatar_url: null,
  avatar_thumb_url: null
})

let scope: EffectScope
const contacts = ref<ChatUser[]>([])
let search: ReturnType<typeof useContactSearch>

beforeEach(() => {
  vi.useFakeTimers()
  usersMock.mockReset()
  contacts.value = []
  scope = effectScope()
  scope.run(() => {
    search = useContactSearch({
      contacts: () => contacts.value,
      currentUserId: () => 1
    })
  })
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

/** Ввести запрос и «промотать» задержку. */
const type = async (text: string) => {
  search.query.value = text
  await nextTick()
  await vi.advanceTimersByTimeAsync(CONTACTS_SEARCH_DEBOUNCE_MS)
}

describe('useContactSearch', () => {
  it('один символ запроса — на сервер не ходим', async () => {
    await type('п')

    expect(usersMock).not.toHaveBeenCalled()
    expect(search.busy.value).toBe(false)
    expect(search.found.value).toEqual([])
  })

  it('запрос уходит только после задержки', async () => {
    usersMock.mockResolvedValue([found(7)])

    search.query.value = 'пе'
    await nextTick()
    expect(usersMock).not.toHaveBeenCalled()
    expect(search.busy.value).toBe(true)

    await vi.advanceTimersByTimeAsync(CONTACTS_SEARCH_DEBOUNCE_MS)
    expect(usersMock).toHaveBeenCalledWith('пе')
    expect(search.found.value.map((item) => item.id)).toEqual([7])
    expect(search.busy.value).toBe(false)
  })

  it('пока человек печатает, лишних запросов нет', async () => {
    usersMock.mockResolvedValue([])

    search.query.value = 'пе'
    await nextTick()
    await vi.advanceTimersByTimeAsync(CONTACTS_SEARCH_DEBOUNCE_MS / 2)
    search.query.value = 'пет'
    await nextTick()
    await vi.advanceTimersByTimeAsync(CONTACTS_SEARCH_DEBOUNCE_MS)

    expect(usersMock).toHaveBeenCalledTimes(1)
    expect(usersMock).toHaveBeenCalledWith('пет')
  })

  it('себя и уже добавленных в найденных не предлагаем', async () => {
    contacts.value = [user(5)]
    usersMock.mockResolvedValue([found(1), found(5), found(9)])

    await type('пе')

    expect(search.found.value.map((item) => item.id)).toEqual([9])
  })

  it('человек, добавленный после поиска, исчезает из «найденных» сразу', async () => {
    usersMock.mockResolvedValue([found(5)])
    await type('пе')
    expect(search.found.value).toHaveLength(1)

    // Добавили контакт — список результатов не перезапрашиваем, а фильтруем.
    contacts.value = [user(5)]
    await nextTick()

    expect(search.found.value).toHaveLength(0)
    expect(usersMock).toHaveBeenCalledTimes(1)
  })

  it('ошибка поиска показывается человеку', async () => {
    usersMock.mockRejectedValue(new Error('сеть'))

    await type('пе')

    expect(search.error.value).toBe('Не удалось выполнить поиск')
    expect(search.busy.value).toBe(false)
  })

  it('пустой запрос сбрасывает найденных и ошибку', async () => {
    usersMock.mockResolvedValue([found(3)])
    await type('пе')
    expect(search.found.value).toHaveLength(1)

    await type('')

    expect(search.found.value).toEqual([])
    expect(search.error.value).toBe('')
  })

  it('моя записная книжка фильтруется по логину, имени и телефону', async () => {
    contacts.value = [
      user(2, { username: 'petya', first_name: 'Пётр', last_name: 'Сидоров' }),
      user(3, { username: 'anna', first_name: 'Анна', last_name: 'Иванова' })
    ]

    expect(search.filtered.value).toHaveLength(2)

    search.query.value = 'pet'
    await nextTick()
    expect(search.filtered.value.map((item) => item.id)).toEqual([2])

    search.query.value = 'анна'
    await nextTick()
    expect(search.filtered.value.map((item) => item.id)).toEqual([3])

    search.query.value = '+79001110003'
    await nextTick()
    expect(search.filtered.value.map((item) => item.id)).toEqual([3])
  })
})
