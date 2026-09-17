/**
 * Папки чатов: свои списки с ручным порядком (как в Telegram).
 *
 * Зачем: список чатов растёт, и «Все/Непрочитанные/Личные/Группы/Каналы» уже не
 * отвечают на вопрос «где мои рабочие чаты». Папка — это набор конкретных чатов,
 * порядок в котором человек задал сам (а не «свежие сверху»).
 *
 * Где хранится: в localStorage (`pismo_chat_folders`), как архив и пины — сервер
 * о папках не знает, потому что это настройка вида на конкретном устройстве, а
 * не свойство чата. Формат: `{ "<userId>": ChatFolder[] }` — у разных аккаунтов
 * на одном устройстве свои папки.
 *
 * Почему порядок задаёт массив `chatIds`, а не время: в папке важен ручной
 * порядок. Остальные списки по-прежнему сортируются по последнему сообщению —
 * папка единственное место, где человек расставляет чаты как хочет.
 */

import type { Chat } from '@/types'

/** Папка чатов: имя и состав (он же — ручной порядок). */
export interface ChatFolder {
  id: string
  name: string
  chatIds: number[]
}

/** Ключ в localStorage. */
export const CHAT_FOLDERS_KEY = 'pismo_chat_folders'
/** Больше десятка папок в строке чипов всё равно не поместится. */
export const MAX_CHAT_FOLDERS = 10
/** Длина имени папки: длинное не влезет в чип. */
export const FOLDER_NAME_MAX = 24
/** Префикс значения фильтра: `folder:<id>`. */
export const FOLDER_FILTER_PREFIX = 'folder:'

/** Значение фильтра для папки (`folder:<id>`). */
export type ChatFolderFilter = `folder:${string}`

/** Фильтр-значение папки. */
export const folderFilter = (id: string): ChatFolderFilter => `${FOLDER_FILTER_PREFIX}${id}`
// Функция намеренно стрелочная: она нужна в шаблонах и computed без this.

/** id папки из значения фильтра (`null` — это не папка). */
export const folderIdFromFilter = (filter: string): string | null =>
  filter.startsWith(FOLDER_FILTER_PREFIX) ? filter.slice(FOLDER_FILTER_PREFIX.length) : null

/** Обрезает имя папки до разумной длины (и убирает лишние пробелы). */
export const normalizeFolderName = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX)

/** Есть ли чат в папке. */
export const chatInFolder = (folder: ChatFolder, chatId: number): boolean =>
  folder.chatIds.includes(chatId)

/** Папки, в которые входит чат (для галочек в списке выбора). */
export const foldersWithChat = (folders: ChatFolder[], chatId: number): string[] =>
  folders.filter((folder) => chatInFolder(folder, chatId)).map((folder) => folder.id)

/** Папка по id. */
export const folderById = (folders: ChatFolder[], id: string): ChatFolder | null =>
  folders.find((folder) => folder.id === id) ?? null

const isFolder = (value: unknown): value is ChatFolder => {
  if (!value || typeof value !== 'object') return false
  const folder = value as Partial<ChatFolder>
  return (
    typeof folder.id === 'string' &&
    folder.id.length > 0 &&
    typeof folder.name === 'string' &&
    Array.isArray(folder.chatIds) &&
    folder.chatIds.every((id) => typeof id === 'number')
  )
}

/**
 * Читает папки пользователя из сырого значения localStorage.
 *
 * Мусор в хранилище не должен ломать список чатов: битые записи пропускаем,
 * дубликаты чатов внутри папки схлопываем, пустые имена отбрасываем.
 */
export function parseChatFolders(raw: string | null, userId: number | null): ChatFolder[] {
  if (userId === null || !raw) return []
  try {
    const all = JSON.parse(raw) as Record<string, unknown>
    const list = all?.[String(userId)]
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    const folders: ChatFolder[] = []
    for (const item of list) {
      if (!isFolder(item) || seen.has(item.id)) continue
      const name = normalizeFolderName(item.name)
      if (!name) continue
      seen.add(item.id)
      folders.push({
        id: item.id,
        name,
        // Дубликат в составе — это ошибка записи, а не две позиции.
        chatIds: Array.from(new Set(item.chatIds))
      })
      if (folders.length >= MAX_CHAT_FOLDERS) break
    }
    return folders
  } catch {
    return []
  }
}

/** Пишет папки пользователя, сохраняя записи других аккаунтов устройства. */
export function serializeChatFolders(
  folders: ChatFolder[],
  raw: string | null,
  userId: number | null
): string {
  if (userId === null) return raw ?? '{}'
  const parse = (): Record<string, unknown> => {
    try {
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return JSON.stringify({ ...parse(), [String(userId)]: folders.slice(0, MAX_CHAT_FOLDERS) })
}

/** Новый id папки (детерминированный, если передан явно — так удобнее в тестах). */
const newFolderId = (folders: ChatFolder[], seed?: string): string => {
  if (seed) return seed
  let index = folders.length + 1
  while (folders.some((folder) => folder.id === `f${index}`)) index += 1
  return `f${index}`
}

/** Создаёт папку с одним чатом (таким приходит первое добавление). */
export function createFolder(
  folders: ChatFolder[],
  name: string,
  chatId?: number,
  seed?: string
): ChatFolder[] {
  const title = normalizeFolderName(name)
  if (!title || folders.length >= MAX_CHAT_FOLDERS) return folders
  const folder: ChatFolder = {
    id: newFolderId(folders, seed),
    name: title,
    chatIds: chatId === undefined ? [] : [chatId]
  }
  return [...folders, folder]
}

/** Переименовывает папку (пустое имя игнорируем — «безымянной» папки быть не должно). */
export function renameFolder(folders: ChatFolder[], id: string, name: string): ChatFolder[] {
  const title = normalizeFolderName(name)
  if (!title) return folders
  return folders.map((folder) => (folder.id === id ? { ...folder, name: title } : folder))
}

/** Удаляет папку. */
export function removeFolder(folders: ChatFolder[], id: string): ChatFolder[] {
  return folders.filter((folder) => folder.id !== id)
}

/** Добавляет чат в папку или убирает его оттуда (повторный вызов — убирает). */
export function toggleFolderChat(folders: ChatFolder[], id: string, chatId: number): ChatFolder[] {
  return folders.map((folder) => {
    if (folder.id !== id) return folder
    const chatIds = folder.chatIds.includes(chatId)
      ? folder.chatIds.filter((value) => value !== chatId)
      : [...folder.chatIds, chatId]
    return { ...folder, chatIds }
  })
}

/** Меняет чат(ы) папки: добавить или убрать сразу несколько (режим выделения). */
export function setFolderChats(
  folders: ChatFolder[],
  id: string,
  chatIds: number[],
  inside: boolean
): ChatFolder[] {
  return folders.map((folder) => {
    if (folder.id !== id) return folder
    if (inside) {
      const merged = [...folder.chatIds]
      chatIds.forEach((chatId) => {
        if (!merged.includes(chatId)) merged.push(chatId)
      })
      return { ...folder, chatIds: merged }
    }
    return { ...folder, chatIds: folder.chatIds.filter((chatId) => !chatIds.includes(chatId)) }
  })
}

/** Сдвигает чат в папке вверх (`-1`) или вниз (`+1`) — ручной порядок. */
export function moveFolderChat(
  folders: ChatFolder[],
  id: string,
  chatId: number,
  delta: -1 | 1
): ChatFolder[] {
  return folders.map((folder) => {
    if (folder.id !== id) return folder
    const index = folder.chatIds.indexOf(chatId)
    const next = index + delta
    if (index === -1 || next < 0 || next >= folder.chatIds.length) return folder
    const chatIds = [...folder.chatIds]
    chatIds[index] = chatIds[next]
    chatIds[next] = chatId
    return { ...folder, chatIds }
  })
}

/**
 * Убирает из папок чаты, которых больше нет (удалённые, покинутые).
 *
 * Иначе папка навсегда сохраняла бы «призрака»: счётчик показывал бы чат, а в
 * списке его нет.
 */
export function pruneFolderChats(folders: ChatFolder[], existingIds: number[]): ChatFolder[] {
  const alive = new Set(existingIds)
  return folders.map((folder) => {
    const chatIds = folder.chatIds.filter((id) => alive.has(id))
    return chatIds.length === folder.chatIds.length ? folder : { ...folder, chatIds }
  })
}

/**
 * Чаты папки в ручном порядке.
 *
 * `chats` — все загруженные чаты (порядок в них не важен): берём только те, что
 * входят в папку, и расставляем по её порядку.
 */
export function folderChats(folder: ChatFolder, chats: Chat[]): Chat[] {
  const byId = new Map(chats.map((chat) => [chat.id, chat]))
  return folder.chatIds.map((id) => byId.get(id)).filter((chat): chat is Chat => chat !== undefined)
}

/** Сколько чатов папки непрочитано (для цифры на чипе). */
export function folderUnreadCount(folder: ChatFolder, chats: Chat[]): number {
  return folderChats(folder, chats).filter((chat) => (chat.unread_count ?? 0) > 0).length
}
