import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Message } from '@/types'
import { ENCRYPTED_FALLBACK } from '@/services/e2ee'
import {
  clearLocalSearch,
  forgetLocalChat,
  indexLocalMessages,
  isLocalSearchEnabled,
  LOCAL_SEARCH_LIMIT,
  localSearchCount,
  searchLocalMessages,
  setLocalSearchEnabled,
  setLocalSearchStoreForTests,
  toSearchMessage,
  type LocalSearchRecord,
  type LocalSearchStore
} from '@/utils/localSearchIndex'

/**
 * Локальный поиск по зашифрованной переписке.
 *
 * Смысл фичи: в E2EE-чате сервер видит только шифротекст, поэтому серверный
 * поиск там не находит ничего — искать может лишь само устройство. Проверяем
 * главное, что легко сломать молча: ЧТО попадает в индекс (никакого шифротекста
 * и заглушек), как ищется и что настройка/очистка действительно работают.
 */

/** Хранилище в памяти: интерфейс тот же, что у IndexedDB-версии. */
const createFakeStore = (): LocalSearchStore & { size: () => number } => {
  const rows = new Map<number, LocalSearchRecord>()
  return {
    async put(records) {
      for (const record of records) rows.set(record.id, record)
    },
    async all() {
      return [...rows.values()]
    },
    async count() {
      return rows.size
    },
    async clear() {
      rows.clear()
    },
    async forgetChat(chatId) {
      for (const [id, record] of rows) {
        if (record.chat_id === chatId) rows.delete(id)
      }
    },
    size: () => rows.size
  }
}

let store: ReturnType<typeof createFakeStore>

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
  setLocalSearchStoreForTests(store)
  localStorage.clear()
  setLocalSearchEnabled(true)
})

describe('что попадает в индекс', () => {
  it('расшифрованный текст индексируется', async () => {
    const count = await indexLocalMessages([
      message({ id: 1, text: 'секретный план' }),
      message({ id: 2, text: 'второе сообщение' })
    ])

    expect(count).toBe(2)
    expect(await localSearchCount()).toBe(2)
  })

  it('шифротекст, заглушка и системные строки не индексируются', async () => {
    // Иначе поиск нашёл бы «e2ee1:abc:def» — то есть шум вместо текста.
    const count = await indexLocalMessages([
      message({ id: 1, text: 'e2ee1:AAA:BBB', encrypted: true }),
      message({ id: 2, text: ENCRYPTED_FALLBACK }),
      message({
        id: 3,
        text: '',
        file: { name: 'x.png', url: '/media/x.png', mime: 'image/png', size: 1 } as Message['file']
      }),
      message({ id: 4, kind: 'call', text: 'Звонок' }),
      message({ id: 5, text: '   ' })
    ])

    expect(count).toBe(0)
    expect(await localSearchCount()).toBe(0)
  })

  it('длинный текст обрезается — индекс не раздувается', async () => {
    await indexLocalMessages([message({ id: 1, text: 'я'.repeat(5000) })])
    const [record] = await searchLocalMessages('яяя')
    expect(record.text.length).toBe(2000)
  })

  it('повторная запись того же сообщения не дублирует его', async () => {
    await indexLocalMessages([message({ id: 7, text: 'один раз' })])
    await indexLocalMessages([message({ id: 7, text: 'один раз' })])

    expect(await localSearchCount()).toBe(1)
  })

  it('при выключенном поиске ничего не запоминается', async () => {
    setLocalSearchEnabled(false)
    expect(await indexLocalMessages([message({ id: 1 })])).toBe(0)
    expect(await localSearchCount()).toBe(0)
    expect(isLocalSearchEnabled()).toBe(false)
  })
})

describe('поиск по индексу', () => {
  beforeEach(async () => {
    await indexLocalMessages([
      message({
        id: 1,
        text: 'Пароль от Wi-Fi лежит в ящике',
        timestamp: '2026-09-18T10:00:00+00:00'
      }),
      message({ id: 2, text: 'напомни пароль позже', timestamp: '2026-09-19T10:00:00+00:00' }),
      message({ id: 3, text: 'совсем другое', timestamp: '2026-09-20T10:00:00+00:00' })
    ])
  })

  it('ищет подстроку без учёта регистра и свежие показывает первыми', async () => {
    const found = await searchLocalMessages('ПАРОЛЬ')
    expect(found.map((r) => r.id)).toEqual([2, 1])
  })

  it('пустой запрос ничего не находит', async () => {
    expect(await searchLocalMessages('   ')).toEqual([])
  })

  it('совпадений больше предела не отдаём', async () => {
    const many = Array.from({ length: LOCAL_SEARCH_LIMIT + 5 }, (_, i) =>
      message({ id: 100 + i, text: 'одно и то же' })
    )
    await indexLocalMessages(many)

    expect((await searchLocalMessages('одно')).length).toBe(LOCAL_SEARCH_LIMIT)
  })

  it('при выключенном поиске ищем «вслепую» — без индекса', async () => {
    setLocalSearchEnabled(false)
    expect(await searchLocalMessages('пароль')).toEqual([])
  })
})

describe('очистка и удаление чата', () => {
  it('очистка убирает весь индекс', async () => {
    await indexLocalMessages([message({ id: 1 }), message({ id: 2 })])
    await clearLocalSearch()
    expect(await localSearchCount()).toBe(0)
  })

  it('удалённый чат исчезает из индекса, остальные остаются', async () => {
    await indexLocalMessages([message({ id: 1, chat_id: 5 }), message({ id: 2, chat_id: 6 })])
    await forgetLocalChat(5)

    expect(await localSearchCount()).toBe(1)
    expect((await searchLocalMessages('привет')).map((r) => r.chat_id)).toEqual([6])
  })
})

describe('запись индекса превращается в сообщение для списка результатов', () => {
  it('заполняет обязательные поля, а несуществующие оставляет пустыми', () => {
    const converted = toSearchMessage({
      id: 42,
      chat_id: 5,
      user_id: 1,
      timestamp: '2026-09-20T10:00:00+00:00',
      text: 'нашлось'
    })

    expect(converted.id).toBe(42)
    expect(converted.text).toBe('нашлось')
    expect(converted.chat_id).toBe(5)
    // Разметка результатов ждёт `Message`, поэтому поля должны быть на месте.
    expect(converted.file).toBeNull()
    expect(converted.reactions).toEqual([])
    expect(converted.forwarded_from).toBeNull()
  })
})

describe('локальный поиск: как он встроен', () => {
  const read = (path: string): string => readFileSync(path, 'utf8')

  it('индексируется только зашифрованный чат, и только расшифрованное', () => {
    const messenger = read('src/views/Messenger.vue')
    expect(messenger).toContain(
      'const chat = chats.value.find((c) => c.id === chatId) ?? selectedChat.value'
    )
    expect(messenger).toContain('if (!chat?.e2ee_enabled) return')
    expect(messenger).toContain('indexForLocalSearch(chat, decoded.out)')
    // Своё отправленное сообщение: текст известен устройству, сервер его не видит.
    expect(messenger).toContain('void indexLocalMessages([message])')
    // Чат удалили — его текст не должен находиться поиском.
    expect(messenger).toContain('void forgetLocalChat(chat.id)')
  })

  it('результаты из индекса показываются отдельным блоком с замком', () => {
    const search = read('src/composables/useGlobalSearch.ts')
    const results = read('src/components/messenger/SearchResults.vue')
    const sidebar = read('src/components/messenger/ChatSidebar.vue')
    expect(search).toContain('localMessages')
    // Совпадение, найденное и сервером, не показываем дважды.
    expect(search).toContain('.filter((record) => !seen.has(record.id))')
    // Блок «в зашифрованных чатах» живёт в результатах, а связка — в сайдбаре.
    expect(results).toContain(
      'const localList = computed<Message[]>(() => props.localMessages ?? [])'
    )
    expect(results).toContain('В зашифрованных чатах — на этом устройстве')
    expect(sidebar).toContain(':local-messages="localMessages"')
  })

  it('в профиле есть тумблер, размер и очистка индекса', () => {
    const profile = read('src/views/UserProfile.vue')
    expect(profile).toContain('isLocalSearchEnabled()')
    expect(profile).toContain('@update:model-value="onToggleLocalSearch"')
    expect(profile).toContain('Очистить индекс')
    // Выключили — индекс не держим на устройстве.
    expect(profile).toContain('if (!value) await onClearLocalSearch()')
  })
})
