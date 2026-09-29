/**
 * Кэш последней страницы переписки: чат можно прочитать без сети.
 *
 * Зачем: без связи лента показывала пустоту, и это выглядело как «пропали все
 * сообщения» — первое, о чём спрашивают. Сообщений с сервера нет, но последнюю
 * страницу каждого чата устройство уже показывало, и её можно отдать из кэша.
 *
 * Где храним: IndexedDB (не localStorage — у него лимит 5 МБ, а здесь страницы
 * десятков чатов), как индекс локального поиска
 * (`utils/localSearchIndex.ts`). Ключей шифрования здесь НЕТ: в зашифрованном
 * чате в кэше лежит текст, который устройство и так показывало. Если человек
 * выключил поиск по зашифрованным чатам, страницы таких чатов НЕ кэшируются —
 * переключатель приватности один на всё (иначе настройка обещала бы не то, что
 * делает).
 *
 * Что храним: последние `THREAD_CACHE_PAGE` сообщений чата, чатов не больше
 * `THREAD_CACHE_CHATS` (самые давние вытесняются). Обычные чаты тоже: без сети
 * недоступны и они — серверный поиск по ним есть, а истории нет.
 *
 * Кэш — удобство, а не часть переписки: сбой хранилища ничего не ломает (читаем
 * пусто, пишем молча), а размер и очистка — в профиле («Хранилище»).
 */

import type { Message } from '@/types'
import { isLocalSearchEnabled } from '@/utils/localSearchIndex'

/** Сколько сообщений чата храним (последние). */
export const THREAD_CACHE_PAGE = 60

/** Сколько чатов держим: дальше вытесняем самые давние по времени записи. */
export const THREAD_CACHE_CHATS = 30

/** Запись кэша: страница сообщений одного чата. */
export interface ThreadCacheRecord {
  /** Ключ хранилища (один чат — одна запись: повторное сохранение заменяет). */
  chat_id: number
  /** Когда записали — по этому времени вытесняем давние чаты. */
  saved_at: number
  /** Сообщения страницы (как их показывала лента). */
  messages: Message[]
}

/** Хранилище кэша: интерфейс отделён от IndexedDB, чтобы подменять его в тестах. */
export interface ThreadCacheStore {
  put(record: ThreadCacheRecord): Promise<void>
  get(chatId: number): Promise<ThreadCacheRecord | null>
  /** Сколько чатов в кэше (карточка «Хранилище»). */
  count(): Promise<number>
  /** Сколько всего сообщений в кэше (карточка «Хранилище»). */
  messageCount(): Promise<number>
  clear(): Promise<void>
  forgetChat(chatId: number): Promise<void>
  /** Чаты от самых давних к свежим — по этому списку вытесняем лишние. */
  oldest(): Promise<number[]>
}

const DB_NAME = 'pismo-thread-cache'
const DB_VERSION = 1
const STORE = 'threads'

let cachedDb: Promise<IDBDatabase | null> | null = null

/** Открывает базу один раз на вкладку; без IndexedDB (jsdom, приватный режим) — null. */
const openDb = (): Promise<IDBDatabase | null> => {
  if (cachedDb) return cachedDb
  cachedDb = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction?.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'chat_id' })
      store?.createIndex('saved_at', 'saved_at', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
  return cachedDb
}

/** Выполняет одну транзакцию (ошибки глотаем: кэш не важнее переписки). */
const runTransaction = async (
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void
): Promise<void> => {
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, mode)
    work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

const createIndexedDbStore = (): ThreadCacheStore => ({
  async put(record) {
    const db = await openDb()
    if (!db) return
    await runTransaction(db, 'readwrite', (store) => store.put(record))
  },
  async get(chatId) {
    const db = await openDb()
    if (!db) return null
    return await new Promise<ThreadCacheRecord | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(chatId)
      request.onsuccess = () => resolve((request.result as ThreadCacheRecord) ?? null)
      request.onerror = () => resolve(null)
    })
  },
  async count() {
    const db = await openDb()
    if (!db) return 0
    return await new Promise<number>((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).count()
      request.onsuccess = () => resolve(Number(request.result ?? 0))
      request.onerror = () => resolve(0)
    })
  },
  async messageCount() {
    const db = await openDb()
    if (!db) return 0
    return await new Promise<number>((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => {
        const rows = (request.result ?? []) as ThreadCacheRecord[]
        resolve(rows.reduce((sum, row) => sum + (row.messages?.length ?? 0), 0))
      }
      request.onerror = () => resolve(0)
    })
  },
  async clear() {
    const db = await openDb()
    if (!db) return
    await runTransaction(db, 'readwrite', (store) => store.clear())
  },
  async forgetChat(chatId) {
    const db = await openDb()
    if (!db) return
    await runTransaction(db, 'readwrite', (store) => store.delete(chatId))
  },
  async oldest() {
    const db = await openDb()
    if (!db) return []
    return await new Promise<number[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const index = tx.objectStore(STORE).index('saved_at')
      const request = index.openCursor()
      const ids: number[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(ids)
          return
        }
        const row = cursor.value as ThreadCacheRecord
        ids.push(row.chat_id)
        cursor.continue()
      }
      request.onerror = () => resolve(ids)
    })
  }
})

/** Текущее хранилище: по умолчанию IndexedDB, в тестах подменяется. */
let store: ThreadCacheStore | null = null

/** Подменяет хранилище (только для тестов): `null` — вернуть IndexedDB. */
export const setThreadCacheStoreForTests = (fake: ThreadCacheStore | null): void => {
  store = fake
}

const storeOf = (): ThreadCacheStore => store ?? createIndexedDbStore()

/**
 * Кэшируем ли этот чат.
 *
 * Зашифрованный чат кэшируется только при включённом локальном поиске: там уже
 * лежит расшифрованный текст на устройстве, и один переключатель приватности
 * честнее двух (см. шапку файла).
 */
const cacheable = (messages: Message[]): boolean =>
  isLocalSearchEnabled() || !messages.some((message) => message.encrypted)

/** Вытесняет самые давние чаты, чтобы кэш не рос бесконечно. */
const evictOldChats = async (): Promise<void> => {
  try {
    const ids = await storeOf().oldest()
    for (const chatId of ids.slice(0, Math.max(0, ids.length - THREAD_CACHE_CHATS))) {
      await storeOf().forgetChat(chatId)
    }
  } catch {
    /* вытеснение — уборка, а не часть работы чата */
  }
}

/**
 * Сохраняет страницу чата (последние `THREAD_CACHE_PAGE` сообщений).
 *
 * Сохраняем и ПУСТУЮ страницу: историю могли очистить, и старое содержимое кэша
 * иначе всплыло бы при чтении без сети.
 */
export const saveThreadPage = async (chatId: number, messages: Message[]): Promise<void> => {
  if (!cacheable(messages)) return
  const page = messages.slice(-THREAD_CACHE_PAGE)
  try {
    await storeOf().put({ chat_id: chatId, saved_at: Date.now(), messages: page })
    await evictOldChats()
  } catch {
    /* кэш — удобство: сбой хранилища не должен ломать показ переписки */
  }
}

/** Читает сохранённую страницу чата (пусто — если её нет или хранилище недоступно). */
export const readThreadPage = async (chatId: number): Promise<Message[]> => {
  try {
    const record = await storeOf().get(chatId)
    return record?.messages ?? []
  } catch {
    return []
  }
}

/** Забывает переписку чата (чат удалили или историю очистили). */
export const forgetThread = async (chatId: number): Promise<void> => {
  try {
    await storeOf().forgetChat(chatId)
  } catch {
    /* забывать нечего */
  }
}

/** Полностью очищает кэш (кнопка «Очистить кэш» в профиле). */
export const clearThreadCache = async (): Promise<void> => {
  try {
    await storeOf().clear()
  } catch {
    /* чистить нечего */
  }
}

/** Сколько сообщений лежит в кэше (карточка «Хранилище»). */
export const threadCacheMessages = async (): Promise<number> => {
  try {
    return await storeOf().messageCount()
  } catch {
    return 0
  }
}
