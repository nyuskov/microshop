import { describe, expect, it } from 'vitest'

import {
  chatInFolder,
  CHAT_FOLDERS_KEY,
  createFolder,
  folderById,
  folderChats,
  folderFilter,
  folderIdFromFilter,
  folderUnreadCount,
  foldersWithChat,
  MAX_CHAT_FOLDERS,
  moveFolderChat,
  normalizeFolderName,
  parseChatFolders,
  pruneFolderChats,
  removeFolder,
  renameFolder,
  serializeChatFolders,
  setFolderChats,
  toggleFolderChat,
  type ChatFolder
} from '@/utils/chatFolders'
import { chatMatchesFilter } from '@/utils/chatFilters'
import type { Chat } from '@/types'

/**
 * Папки чатов: свои списки с ручным порядком.
 *
 * Главное, что здесь проверяется: состав и порядок не теряются, мусор в
 * localStorage не ломает список чатов, а папка не показывает «призраков»
 * удалённых чатов.
 */

const chat = (id: number, extra: Partial<Chat> = {}): Chat =>
  ({ id, unread_count: 0, is_self: false, ...extra }) as Chat

const folders = (list: ChatFolder[]) => list

describe('идентификаторы и фильтры', () => {
  it('фильтр папки кодируется префиксом и разбирается обратно', () => {
    expect(folderFilter('f3')).toBe('folder:f3')
    expect(folderIdFromFilter('folder:f3')).toBe('f3')
    expect(folderIdFromFilter('all')).toBeNull()
  })

  it('имя папки подрезается и очищается от лишних пробелов', () => {
    expect(normalizeFolderName('  Работа   и  учёба ')).toBe('Работа и учёба')
    expect(normalizeFolderName('x'.repeat(40))).toHaveLength(24)
  })

  it('фильтр папки отбирает только её чаты', () => {
    const list = folders([{ id: 'f1', name: 'Работа', chatIds: [2, 3] }])
    expect(chatMatchesFilter(chat(2), 'folder:f1', [], list)).toBe(true)
    expect(chatMatchesFilter(chat(9), 'folder:f1', [], list)).toBe(false)
    // Папка, которой больше нет, не показывает ничего (а не «все чаты»).
    expect(chatMatchesFilter(chat(2), 'folder:nope', [], list)).toBe(false)
  })

  it('архив сильнее папки: убранный чат не виден и в папке', () => {
    const list = folders([{ id: 'f1', name: 'Работа', chatIds: [2] }])
    expect(chatMatchesFilter(chat(2), 'folder:f1', [2], list)).toBe(false)
    expect(chatMatchesFilter(chat(2), 'archived', [2], list)).toBe(true)
  })
})

describe('хранение', () => {
  it('читает папки только своего пользователя', () => {
    const raw = JSON.stringify({
      '23': [{ id: 'f1', name: 'Работа', chatIds: [1] }],
      '24': [{ id: 'f2', name: 'Личное', chatIds: [2] }]
    })
    expect(parseChatFolders(raw, 23)).toEqual([{ id: 'f1', name: 'Работа', chatIds: [1] }])
    expect(parseChatFolders(raw, 99)).toEqual([])
    expect(parseChatFolders(null, 23)).toEqual([])
  })

  it('битые записи пропускает, дубликаты схлопывает', () => {
    const raw = JSON.stringify({
      '23': [
        { id: 'f1', name: 'Работа', chatIds: [1, 1, 2] },
        { id: 'f1', name: 'Дубль', chatIds: [3] },
        { id: '', name: 'Без id', chatIds: [] },
        { id: 'f2', name: '   ', chatIds: [] },
        'мусор'
      ]
    })
    expect(parseChatFolders(raw, 23)).toEqual([{ id: 'f1', name: 'Работа', chatIds: [1, 2] }])
  })

  it('сломанный JSON не ломает список чатов', () => {
    expect(parseChatFolders('{oops', 23)).toEqual([])
  })

  it('запись сохраняет папки других аккаунтов устройства', () => {
    const raw = JSON.stringify({ '24': [{ id: 'f9', name: 'Чужая', chatIds: [] }] })
    const saved = serializeChatFolders([{ id: 'f1', name: 'Работа', chatIds: [5] }], raw, 23)
    const all = JSON.parse(saved) as Record<string, unknown>
    expect(all['24']).toEqual([{ id: 'f9', name: 'Чужая', chatIds: [] }])
    expect(all['23']).toEqual([{ id: 'f1', name: 'Работа', chatIds: [5] }])
    expect(CHAT_FOLDERS_KEY).toBe('pismo_chat_folders')
  })

  it('без пользователя ничего не портит', () => {
    expect(serializeChatFolders([], '{"23":[]}', null)).toBe('{"23":[]}')
  })
})

describe('правки папок', () => {
  it('папка создаётся с первым чатом, пустое имя игнорируется', () => {
    const created = createFolder([], 'Работа', 7, 'f1')
    expect(created).toEqual([{ id: 'f1', name: 'Работа', chatIds: [7] }])
    expect(createFolder([], '   ')).toEqual([])
  })

  it('больше лимита папок не создаётся', () => {
    const many = Array.from({ length: MAX_CHAT_FOLDERS }, (_, i) => ({
      id: `f${i}`,
      name: `P${i}`,
      chatIds: []
    }))
    expect(createFolder(many, 'Ещё')).toHaveLength(MAX_CHAT_FOLDERS)
  })

  it('id новой папки не повторяется', () => {
    const created = createFolder([{ id: 'f1', name: 'A', chatIds: [] }], 'B')
    expect(created[1].id).toBe('f2')
  })

  it('переименование и удаление', () => {
    const list = folders([
      { id: 'f1', name: 'Работа', chatIds: [1] },
      { id: 'f2', name: 'Личное', chatIds: [2] }
    ])
    expect(renameFolder(list, 'f1', 'Работа и учёба')[0].name).toBe('Работа и учёба')
    expect(renameFolder(list, 'f1', '  ')[0].name).toBe('Работа')
    expect(removeFolder(list, 'f1')).toEqual([{ id: 'f2', name: 'Личное', chatIds: [2] }])
  })

  it('чат добавляется и убирается повторным вызовом', () => {
    const list = folders([{ id: 'f1', name: 'Работа', chatIds: [1] }])
    const added = toggleFolderChat(list, 'f1', 2)
    expect(added[0].chatIds).toEqual([1, 2])
    expect(toggleFolderChat(added, 'f1', 1)[0].chatIds).toEqual([2])
  })

  it('несколько чатов добавляются пачкой (режим выделения)', () => {
    const list = folders([{ id: 'f1', name: 'Работа', chatIds: [1] }])
    const added = setFolderChats(list, 'f1', [3, 4, 4], true)
    expect(added[0].chatIds).toEqual([1, 3, 4])
    expect(setFolderChats(added, 'f1', [1, 3], false)[0].chatIds).toEqual([4])
  })

  it('ручной порядок: чат двигается вверх и вниз, дальше края — нет', () => {
    const list = folders([{ id: 'f1', name: 'Работа', chatIds: [1, 2, 3] }])
    expect(moveFolderChat(list, 'f1', 3, -1)[0].chatIds).toEqual([1, 3, 2])
    expect(moveFolderChat(list, 'f1', 1, 1)[0].chatIds).toEqual([2, 1, 3])
    expect(moveFolderChat(list, 'f1', 1, -1)[0].chatIds).toEqual([1, 2, 3])
    expect(moveFolderChat(list, 'f1', 3, 1)[0].chatIds).toEqual([1, 2, 3])
  })

  it('удалённые чаты убираются из папок («призраков» не остаётся)', () => {
    const list = folders([
      { id: 'f1', name: 'Работа', chatIds: [1, 2, 3] },
      { id: 'f2', name: 'Личное', chatIds: [9] }
    ])
    const pruned = pruneFolderChats(list, [1, 3])
    expect(pruned[0].chatIds).toEqual([1, 3])
    expect(pruned[1].chatIds).toEqual([])
    // Состав не изменился — объект остаётся тем же (без лишних перерисовок).
    expect(pruneFolderChats(list, [1, 2, 3, 9])[0]).toBe(list[0])
  })
})

describe('выборка чатов папки', () => {
  it('чаты идут в ручном порядке папки, а не в порядке списка', () => {
    const folder: ChatFolder = { id: 'f1', name: 'Работа', chatIds: [3, 1] }
    expect(folderChats(folder, [chat(1), chat(2), chat(3)]).map((c) => c.id)).toEqual([3, 1])
  })

  it('несуществующие чаты просто пропускаются', () => {
    const folder: ChatFolder = { id: 'f1', name: 'Работа', chatIds: [1, 42] }
    expect(folderChats(folder, [chat(1)]).map((c) => c.id)).toEqual([1])
  })

  it('непрочитанные считаются по чатам папки', () => {
    const folder: ChatFolder = { id: 'f1', name: 'Работа', chatIds: [1, 2] }
    const chats = [chat(1, { unread_count: 3 }), chat(2), chat(3, { unread_count: 1 })]
    expect(folderUnreadCount(folder, chats)).toBe(1)
  })

  it('в каких папках состоит чат — для галочек в выборе', () => {
    const list = folders([
      { id: 'f1', name: 'A', chatIds: [1, 2] },
      { id: 'f2', name: 'B', chatIds: [2] }
    ])
    expect(chatInFolder(list[0], 2)).toBe(true)
    expect(foldersWithChat(list, 2)).toEqual(['f1', 'f2'])
    expect(foldersWithChat(list, 5)).toEqual([])
    expect(folderById(list, 'f2')?.name).toBe('B')
    expect(folderById(list, 'нет')).toBeNull()
  })
})
