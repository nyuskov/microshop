import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '@/types'
import { setLocalSearchEnabled } from '@/utils/localSearchIndex'
import {
  clearThreadCache,
  forgetThread,
  readThreadPage,
  saveThreadPage,
  setThreadCacheStoreForTests,
  threadCacheMessages,
  THREAD_CACHE_CHATS,
  THREAD_CACHE_PAGE,
  type ThreadCacheRecord,
  type ThreadCacheStore
} from '@/utils/threadCache'

/**
 * Кэш переписки для чтения без сети.
 *
 * Смысл фичи: без связи лента показывала пустоту, хотя последнюю страницу чата
 * устройство уже видело. Проверяем главное, что легко сломать молча: размер
 * страницы, вытеснение старых чатов, забывание удалённого чата и то, что
 * выключенный поиск по зашифрованным чатам НЕ кэширует их текст.
 */

/** Хранилище в памяти: интерфейс тот же, что у IndexedDB-версии. */
const createFakeStore = (): ThreadCacheStore => {
  const rows = new Map<number, ThreadCacheRecord>()
  return {
    async put(record) {
      rows.set(record.chat_id, record)
    },
    async get(chatId) {
      return rows.get(chatId) ?? null
    },
    async count() {
      return rows.size
    },
    async messageCount() {
      return [...rows.values()].reduce((sum, row) => sum + row.messages.length, 0)
    },
    async clear() {
      rows.clear()
    },
    async forgetChat(chatId) {
      rows.delete(chatId)
    },
    async oldest() {
      return [...rows.values()].sort((a, b) => a.saved_at - b.saved_at).map((r) => r.chat_id)
    }
  }
}

let store: ThreadCacheStore

const message = (over: Partial<Message> = {}): Message => ({
  id: 1,
  chat_id: 5,
  user_id: 1,
  text: 'привет',
  timestamp: '2026-09-20T10:00:00+00:00',
  reply_to_id: null,
  is_read: true,
  is_pinned: false,
  edited_at: null,
  file: null,
  reactions: [],
  forwarded_from: null,
  ...over
})

beforeEach(() => {
  store = createFakeStore()
  setThreadCacheStoreForTests(store)
  localStorage.clear()
  setLocalSearchEnabled(true)
})

describe('сохранение и чтение страницы', () => {
  it('страница чата читается обратно', async () => {
    await saveThreadPage(5, [message({ id: 1 }), message({ id: 2 })])

    const page = await readThreadPage(5)
    expect(page.map((m) => m.id)).toEqual([1, 2])
    expect(await threadCacheMessages()).toBe(2)
  })

  it('храним только последние сообщения страницы', async () => {
    const many = Array.from({ length: THREAD_CACHE_PAGE + 20 }, (_, index) =>
      message({ id: index + 1 })
    )
    await saveThreadPage(5, many)

    const page = await readThreadPage(5)
    expect(page).toHaveLength(THREAD_CACHE_PAGE)
    // Именно СВЕЖИЕ: первый (id 1) в кэш не попал, последний — попал.
    expect(page[0].id).toBe(21)
    expect(page[page.length - 1].id).toBe(THREAD_CACHE_PAGE + 20)
  })

  it('пустая страница тоже сохраняется: очищенная история не всплывёт из кэша', async () => {
    await saveThreadPage(5, [message({ id: 1 })])
    await saveThreadPage(5, [])

    expect(await readThreadPage(5)).toEqual([])
  })

  it('повторное сохранение заменяет запись, а не копит чаты', async () => {
    await saveThreadPage(5, [message({ id: 1 })])
    await saveThreadPage(5, [message({ id: 2 })])

    expect((await readThreadPage(5)).map((m) => m.id)).toEqual([2])
    expect(await store.count()).toBe(1)
  })

  it('чата в кэше нет — пусто, а не ошибка', async () => {
    expect(await readThreadPage(999)).toEqual([])
  })
})

describe('чистка', () => {
  it('удалённый чат забывается', async () => {
    await saveThreadPage(5, [message({ id: 1 })])
    await saveThreadPage(6, [message({ id: 2, chat_id: 6 })])

    await forgetThread(5)

    expect(await readThreadPage(5)).toEqual([])
    expect((await readThreadPage(6)).map((m) => m.id)).toEqual([2])
  })

  it('полная очистка убирает всё', async () => {
    await saveThreadPage(5, [message({ id: 1 })])
    await clearThreadCache()

    expect(await threadCacheMessages()).toBe(0)
  })

  it('лишние чаты вытесняются по давности', async () => {
    // Время контролируем сами: `Date.now()` внутри цикла даёт одинаковые метки,
    // и порядок вытеснения был бы случайным.
    vi.useFakeTimers()
    const base = Date.UTC(2026, 8, 29)
    try {
      for (let chatId = 1; chatId <= THREAD_CACHE_CHATS + 3; chatId += 1) {
        vi.setSystemTime(base + chatId * 1000)
        await saveThreadPage(chatId, [message({ id: chatId, chat_id: chatId })])
      }
    } finally {
      vi.useRealTimers()
    }

    // В кэше остаются только свежие чаты, давние — вытеснены.
    expect(await store.count()).toBe(THREAD_CACHE_CHATS)
    expect(await store.get(1)).toBeNull()
    expect(await store.get(THREAD_CACHE_CHATS + 3)).not.toBeNull()
  })
})

describe('приватность', () => {
  it('выключенный поиск по зашифрованным чатам запрещает кэшировать их текст', async () => {
    setLocalSearchEnabled(false)
    await saveThreadPage(5, [message({ id: 1, encrypted: true })])

    expect(await readThreadPage(5)).toEqual([])
  })

  it('выключенный поиск не мешает обычным чатам', async () => {
    setLocalSearchEnabled(false)
    await saveThreadPage(5, [message({ id: 1 })])

    expect((await readThreadPage(5)).map((m) => m.id)).toEqual([1])
  })
})

describe('проводка в коде', () => {
  it('пагинация сохраняет и читает страницу, мессенджер забывает удалённые чаты', () => {
    const pagination = readFileSync('src/composables/useThreadPagination.ts', 'utf8')
    const messenger = readFileSync('src/views/Messenger.vue', 'utf8')

    expect(pagination).toContain('saveThreadPage')
    expect(pagination).toContain('readThreadPage')
    expect(messenger).toContain('void forgetThread(chat.id)')
  })
})
