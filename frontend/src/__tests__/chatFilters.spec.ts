import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAT_FILTERS, chatMatchesFilter, isChatArchived } from '@/utils/chatFilters'
import type { Chat } from '@/types'

/**
 * Фильтры списка чатов и архив.
 *
 * Правила фильтрации вынесены из `ChatSidebar.vue` именно ради этих проверок:
 * главное правило архива — архивный чат не показывается ни в одном другом
 * фильтре, иначе он «висит» в «Все» и смысл архива теряется.
 */
const chat = (id: number, extra: Partial<Chat> = {}): Chat =>
  ({
    id,
    name: `Чат ${id}`,
    unread_count: 0,
    is_channel: false,
    users: [],
    last_message: null,
    ...extra
  }) as Chat

/** Групповой чат: два собеседника и признак группы. */
const group = (id: number, extra: Partial<Chat> = {}): Chat =>
  chat(id, { is_group: true, users: [{ id: 1 }, { id: 2 }] as Chat['users'], ...extra })

const privateChat = (id: number): Chat => chat(id, { users: [{ id: 7 }] as Chat['users'] })

describe('chatMatchesFilter', () => {
  it('«Все» показывает всё, кроме архивных', () => {
    const chats = [privateChat(1), group(2), group(3, { is_channel: true })]
    expect(chats.filter((item) => chatMatchesFilter(item, 'all')).map((item) => item.id)).toEqual([
      1, 2, 3
    ])
    expect(chatMatchesFilter(privateChat(1), 'all', [1])).toBe(false)
  })

  it('«Непрочитанные» — только чаты с непрочитанными', () => {
    expect(chatMatchesFilter(privateChat(1), 'unread')).toBe(false)
    expect(chatMatchesFilter(chat(2, { unread_count: 3 }), 'unread')).toBe(true)
  })

  it('«Личные» — чаты один на один', () => {
    expect(chatMatchesFilter(privateChat(1), 'private')).toBe(true)
    expect(chatMatchesFilter(group(2), 'private')).toBe(false)
  })

  it('«Группы» не показывают каналы: канал — тоже групповой чат', () => {
    expect(chatMatchesFilter(group(2), 'groups')).toBe(true)
    expect(chatMatchesFilter(group(3, { is_channel: true }), 'groups')).toBe(false)
    expect(chatMatchesFilter(group(3, { is_channel: true }), 'channels')).toBe(true)
  })

  it('архивный чат уходит из всех фильтров, кроме «Архива»', () => {
    const archived = [5]
    const target = chat(5, { unread_count: 1, users: [{ id: 7 }] as Chat['users'] })
    const keys = CHAT_FILTERS.map((filter) => filter.key).filter((key) => key !== 'archived')
    for (const key of keys) {
      expect(chatMatchesFilter(target, key, archived), `фильтр ${key}`).toBe(false)
    }
    expect(chatMatchesFilter(target, 'archived', archived)).toBe(true)
    expect(chatMatchesFilter(target, 'archived')).toBe(false)
  })

  it('без списка архива ничего не архивировано', () => {
    expect(chatMatchesFilter(privateChat(1), 'all')).toBe(true)
    expect(chatMatchesFilter(privateChat(1), 'archived')).toBe(false)
  })
})

describe('isChatArchived', () => {
  it('сверяется со списком id и не падает без списка', () => {
    expect(isChatArchived(3, [1, 3])).toBe(true)
    expect(isChatArchived(2, [1, 3])).toBe(false)
    expect(isChatArchived(2)).toBe(false)
    expect(isChatArchived(2, [])).toBe(false)
  })
})

describe('чипы фильтров', () => {
  it('«Архив» стоит последним — справа от основных фильтров', () => {
    expect(CHAT_FILTERS[CHAT_FILTERS.length - 1].key).toBe('archived')
    expect(CHAT_FILTERS.map((filter) => filter.key)).toEqual([
      'all',
      'unread',
      'private',
      'groups',
      'channels',
      'archived'
    ])
    expect(CHAT_FILTERS.every((filter) => filter.title.length > 0)).toBe(true)
  })
})

/**
 * Проверки по исходникам: архив — не только правила фильтра, но и точки входа
 * в интерфейсе. vue-tsc/eslint не заметят пропавшую кнопку, а вот пользователь
 * заметит: меню чата без пункта «В архив» архивировать будет нечем.
 */
const SRC = path.resolve(import.meta.dirname, '..')
const source = (relative: string): string => readFileSync(path.join(SRC, relative), 'utf8')

describe('точки входа архива', () => {
  it('в меню чата есть пункт архива и подпись меняется на «Из архива»', () => {
    const header = source('components/messenger/ChatHeader.vue')
    expect(header).toContain("runChatAction('archive')")
    expect(header).toContain("archived ? t('Из архива') : t('В архив')")
    expect(header).toContain("(e: 'toggle-archive'): void")
  })

  it('в панели выделения есть кнопка архива', () => {
    const header = source('components/messenger/SidebarHeader.vue')
    expect(header).toContain('@click="emit(\'bulk-archive\')"')
    expect(header).toContain("icon('archive')")
    expect(header).toContain('selectionAllArchived')
  })

  it('сайдбар отдаёт верхнему уровню событие bulk-archive и id архива', () => {
    const sidebar = source('components/messenger/ChatSidebar.vue')
    expect(sidebar).toContain("(e: 'bulk-archive', chatIds: number[], archived: boolean): void")
    expect(sidebar).toContain('archivedChatIds')
    expect(sidebar).toContain(
      "onBulkArchive: (ids, archived) => emit('bulk-archive', ids, archived)"
    )
  })

  it('архив хранится локально по пользователю и чистится вместе с чатом', () => {
    const view = source('views/Messenger.vue')
    expect(view).toContain("const ARCHIVED_CHATS_KEY = 'pismo_archived_chats'")
    expect(view).toContain('const archivedChatIds = ref<number[]>([])')
    // Удалённый чат не должен оставаться мусорным id в localStorage.
    expect(view).toContain(
      'if (archivedChatIds.value.includes(chat.id)) toggleChatArchived(chat.id)'
    )
  })

  it('чип «Архив» появляется только когда в архиве есть чаты', () => {
    const sidebar = source('components/messenger/ChatSidebar.vue')
    expect(sidebar).toContain("CHAT_FILTERS.filter((filter) => filter.key !== 'archived'")
    // Последний архивный чат вынули — фильтр возвращается к «Все».
    expect(sidebar).toContain(
      "if (count === 0 && chatFilter.value === 'archived') chatFilter.value = 'all'"
    )
  })

  it('ряд фильтров листается мышью, а затухания — только по факту переполнения', () => {
    // Жалоба 15.09.2026: «в веб-версии не крутится» — шесть чипов шире панели,
    // палец ряд листал, а обычное колесо мыши прокручивало список чатов, и до
    // «Архива» было не добраться. Плюс статичная маска прятала текст чипа в
    // конце прокрутки. Прокрутка общая для всех лент — useHScroll.
    const list = source('components/messenger/ChatList.vue')
    expect(list).toContain('useHScroll(() => props.filters.length)')
    expect(list).toContain('@wheel.passive="onFiltersWheel"')
    expect(list).toContain('@scroll.passive="refreshFilterEdges"')
    expect(list).toContain("'fade-start': filterEdges.start")
    expect(list).toContain('overscroll-behavior-x: contain')
    // Сама математика прокрутки — в utils/hScroll.ts (там же порог и границы).
    const utils = source('utils/hScroll.ts')
    expect(utils).toContain('wheelScrollLeft')
    expect(utils).toContain('dragScrollLeft')
    // Маска больше не висит на ряду постоянно: она включается классами.
    expect(list).not.toMatch(/\.chat-filters\s*\{[^}]*mask-image/)
  })
})
