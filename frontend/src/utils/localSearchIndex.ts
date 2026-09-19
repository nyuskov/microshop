/**
 * Локальный поиск по зашифрованной переписке.
 *
 * Зачем: в E2EE-чате сервер видит только шифротекст, поэтому серверный поиск
 * (`GET /messages/search/`) там не находит НИЧЕГО — и это единственное
 * ограничение сквозного шифрования, о котором спрашивают («почему в
 * зашифрованном чате не ищется?»). Расшифровать текст может только устройство,
 * значит индекс тоже строится на устройстве.
 *
 * Где храним: IndexedDB (не localStorage). В индексе лежат только текст и
 * служебные поля сообщения — без вложений и без ключей; по объёму это доли
 * мегабайта на тысячи сообщений, а лимит localStorage (5 МБ) закончился бы
 * быстро. Ключи шифрования здесь НЕ хранятся: утечка индекса даёт текст, но не
 * доступ к переписке.
 *
 * Что попадает в индекс: только сообщения ЗАШИФРОВАННЫХ чатов (в обычных ищет
 * сервер) и только те, что удалось расшифровать на этом устройстве — то, что
 * человек уже видел. Шифротекст, заглушка «🔒 Сообщение», системные отметки о
 * звонках и пустой текст не индексируются.
 *
 * Выключается тумблером в профиле («Хранилище» → поиск по зашифрованным чатам) и
 * полностью чистится кнопкой рядом.
 */

import type { Message } from '@/types'
import { ENCRYPTED_FALLBACK } from '@/services/e2ee'

/** Сколько совпадений отдаём: больше в списке результатов всё равно не читают. */
export const LOCAL_SEARCH_LIMIT = 30

/** Ключ настройки устройства («искать ли по зашифрованным чатам»). */
export const LOCAL_SEARCH_ENABLED_KEY = 'pismo_local_search'

/** Сколько знаков текста храним от одного сообщения (остальное — мусор в индексе). */
export const LOCAL_SEARCH_TEXT_LIMIT = 2000

/** Запись индекса: ровно то, что нужно, чтобы показать результат поиска. */
export interface LocalSearchRecord {
  /** id сообщения (ключ хранилища: повторная запись обновляет, а не дублирует). */
  id: number
  chat_id: number
  user_id: number
  /** Время сообщения (ISO) — по нему сортируем результаты. */
  timestamp: string
  /** Расшифрованный текст. */
  text: string
}

/** Хранилище индекса: интерфейс отделён от IndexedDB, чтобы его можно было подменить в тесте. */
export interface LocalSearchStore {
  put(records: LocalSearchRecord[]): Promise<void>
  all(): Promise<LocalSearchRecord[]>
  /** Сколько записей в индексе (для карточки «Хранилище»). */
  count(): Promise<number>
  clear(): Promise<void>
  /** Забыть переписку конкретного чата (чат удалили). */
  forgetChat(chatId: number): Promise<void>
}

const DB_NAME = 'pismo-search'
const DB_VERSION = 1
const STORE = 'messages'

/**
 * Хранилище на IndexedDB.
 *
 * Схема минимальна: один стор с ключом по id сообщения и индексом по chat_id
 * (нужен, чтобы удалять переписку удалённого чата, не вычитывая весь индекс).
 */
const createIndexedDbStore = (): LocalSearchStore => ({
  async put(records) {
    const db = await openDb()
    if (!db) return
    await runTransaction(db, 'readwrite', (store) => {
      for (const record of records) store.put(record)
    })
  },
  async all() {
    const db = await openDb()
    if (!db) return []
    return await new Promise<LocalSearchRecord[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).getAll()
      request.onsuccess = () => resolve((request.result ?? []) as LocalSearchRecord[])
      request.onerror = () => resolve([])
    })
  },
  async count() {
    const db = await openDb()
    if (!db) return 0
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).count()
      request.onsuccess = () => resolve(Number(request.result ?? 0))
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
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const index = tx.objectStore(STORE).index('chat_id')
      const request = index.openCursor(IDBKeyRange.only(chatId))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        cursor.delete()
        cursor.continue()
      }
      request.onerror = () => resolve()
    })
  }
})

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
        : db.createObjectStore(STORE, { keyPath: 'id' })
      store?.createIndex('chat_id', 'chat_id', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
  return cachedDb
}

/** Выполняет одну транзакцию записи (ошибки глотаем: поиск не важнее переписки). */
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

/** Текущее хранилище: по умолчанию IndexedDB, в тестах подменяется. */
let store: LocalSearchStore | null = null

/** Подменяет хранилище (только для тестов): `null` — вернуть IndexedDB. */
export const setLocalSearchStoreForTests = (fake: LocalSearchStore | null): void => {
  store = fake
}

const storeOf = (): LocalSearchStore | null => store ?? createIndexedDbStore()

/** Искать ли по зашифрованным чатам (настройка устройства). */
export const isLocalSearchEnabled = (): boolean => {
  try {
    return localStorage.getItem(LOCAL_SEARCH_ENABLED_KEY) !== 'off'
  } catch {
    // Приватный режим — считаем, что включено: индекс всё равно только в памяти вкладки.
    return true
  }
}

/** Включает/выключает локальный поиск. */
export const setLocalSearchEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(LOCAL_SEARCH_ENABLED_KEY, enabled ? 'on' : 'off')
  } catch {
    /* приватный режим — настройку не помним */
  }
}

/**
 * Стоит ли индексировать это сообщение.
 *
 * Отсеиваем всё, что не является читаемым текстом: шифротекст (не расшифровали),
 * заглушку «🔒 Сообщение», системные отметки о звонках и пустые сообщения
 * (одно вложение без подписи искать не по чему).
 */
const indexableTextOf = (message: Message): string | null => {
  if (message.kind === 'call') return null
  if (message.encrypted) return null
  const text = (message.text ?? '').trim()
  if (!text || text === ENCRYPTED_FALLBACK) return null
  return text.slice(0, LOCAL_SEARCH_TEXT_LIMIT)
}

/**
 * Кладёт в индекс расшифрованные сообщения (обычно — пачка загруженной истории).
 * Возвращает, сколько записей записали: по этому числу тесты видят, что фильтр
 * работает, а не что «где-то что-то сохранилось».
 */
export const indexLocalMessages = async (messages: Message[]): Promise<number> => {
  if (!isLocalSearchEnabled()) return 0
  const records: LocalSearchRecord[] = []
  for (const message of messages) {
    const text = indexableTextOf(message)
    if (text === null) continue
    records.push({
      id: message.id,
      chat_id: message.chat_id,
      user_id: message.user_id,
      timestamp: message.timestamp,
      text
    })
  }
  if (records.length === 0) return 0
  try {
    await storeOf()?.put(records)
  } catch {
    // Индекс — удобство, а не часть переписки: сбой хранилища не должен ломать показ.
    return 0
  }
  return records.length
}

/** Читает весь индекс; сбой хранилища — пустой список, а не падение поиска. */
const readAll = async (): Promise<LocalSearchRecord[]> => {
  try {
    return (await storeOf()?.all()) ?? []
  } catch {
    return []
  }
}

/** Ищет по индексу: подстрока без учёта регистра, свежие — выше. */
export const searchLocalMessages = async (
  query: string,
  limit = LOCAL_SEARCH_LIMIT
): Promise<LocalSearchRecord[]> => {
  const needle = query.trim().toLowerCase()
  if (!needle || !isLocalSearchEnabled()) return []
  const records = await readAll()
  return records
    .filter((record) => record.text.toLowerCase().includes(needle))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
}

/** Сколько сообщений в индексе (карточка «Хранилище»). */
export const localSearchCount = async (): Promise<number> => {
  try {
    return (await storeOf()?.count()) ?? 0
  } catch {
    return 0
  }
}

/** Полностью очищает индекс (кнопка в профиле). */
export const clearLocalSearch = async (): Promise<void> => {
  try {
    await storeOf()?.clear()
  } catch {
    /* чистить нечего */
  }
}

/** Забывает переписку удалённого чата. */
export const forgetLocalChat = async (chatId: number): Promise<void> => {
  try {
    await storeOf()?.forgetChat(chatId)
  } catch {
    /* индекс не критичен */
  }
}

/**
 * Превращает запись индекса в сообщение для списка результатов.
 *
 * Список результатов (`SearchResults.vue`) рисует `Message`, а из индекса
 * известны только текст, автор, чат и время — остальное заполняем пустыми
 * значениями, чтобы разметка не знала разницы.
 */
export const toSearchMessage = (record: LocalSearchRecord): Message => ({
  id: record.id,
  chat_id: record.chat_id,
  user_id: record.user_id,
  text: record.text,
  timestamp: record.timestamp,
  reply_to_id: null,
  is_read: true,
  is_pinned: false,
  edited_at: null,
  file: null,
  reactions: [],
  forwarded_from: null
})
