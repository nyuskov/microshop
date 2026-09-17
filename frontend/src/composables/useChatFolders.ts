/**
 * Папки чатов на устройстве: чтение, запись и правки состава.
 *
 * Состояние держит один этот composable, а интерфейс (список чатов, диалоги)
 * только читает `folders` и зовёт методы: иначе localStorage пришлось бы
 * синхронизировать в трёх местах, а правки — повторять.
 *
 * Хранение — как у архива и пинов: `pismo_chat_folders` с разбивкой по id
 * пользователя. Сервер о папках не знает: это настройка вида на устройстве.
 */

import { ref, watch, type Ref } from 'vue'

import {
  CHAT_FOLDERS_KEY,
  createFolder,
  moveFolderChat,
  parseChatFolders,
  pruneFolderChats,
  removeFolder,
  renameFolder,
  serializeChatFolders,
  setFolderChats,
  toggleFolderChat,
  type ChatFolder
} from '@/utils/chatFolders'

export interface ChatFoldersApi {
  /** Папки текущего пользователя (порядок = порядок чипов). */
  folders: Ref<ChatFolder[]>
  /** Создаёт папку; `chatId` сразу кладёт в неё чат (первое добавление). */
  create: (name: string, chatId?: number) => string | null
  /** Переименовывает папку. */
  rename: (id: string, name: string) => void
  /** Удаляет папку. */
  remove: (id: string) => void
  /** Добавляет/убирает чат (повторный вызов — убирает). */
  toggleChat: (id: string, chatId: number) => void
  /** Добавляет или убирает сразу несколько чатов (режим выделения). */
  setChats: (id: string, chatIds: number[], inside: boolean) => void
  /** Сдвигает чат в папке вверх/вниз — ручной порядок. */
  moveChat: (id: string, chatId: number, delta: -1 | 1) => void
  /** Убирает из папок чаты, которых больше нет. */
  prune: (existingChatIds: number[]) => void
}

export function useChatFolders(currentUserId: Ref<number | null>): ChatFoldersApi {
  const folders = ref<ChatFolder[]>([])

  const read = (): string | null => {
    try {
      return window.localStorage.getItem(CHAT_FOLDERS_KEY)
    } catch {
      // localStorage недоступен (приватный режим) — папки просто не сохранятся.
      return null
    }
  }

  const persist = () => {
    try {
      window.localStorage.setItem(
        CHAT_FOLDERS_KEY,
        serializeChatFolders(folders.value, read(), currentUserId.value)
      )
    } catch {
      // Сохранить не удалось — в памяти состав остаётся верным.
    }
  }

  watch(
    currentUserId,
    (uid) => {
      folders.value = parseChatFolders(read(), uid)
    },
    { immediate: true }
  )

  const create = (name: string, chatId?: number): string | null => {
    const before = folders.value
    const next = createFolder(before, name, chatId)
    if (next.length === before.length) return null
    folders.value = next
    persist()
    return next[next.length - 1]?.id ?? null
  }

  const rename = (id: string, name: string) => {
    folders.value = renameFolder(folders.value, id, name)
    persist()
  }

  const remove = (id: string) => {
    folders.value = removeFolder(folders.value, id)
    persist()
  }

  const toggleChat = (id: string, chatId: number) => {
    folders.value = toggleFolderChat(folders.value, id, chatId)
    persist()
  }

  const setChats = (id: string, chatIds: number[], inside: boolean) => {
    folders.value = setFolderChats(folders.value, id, chatIds, inside)
    persist()
  }

  const moveChat = (id: string, chatId: number, delta: -1 | 1) => {
    folders.value = moveFolderChat(folders.value, id, chatId, delta)
    persist()
  }

  const prune = (existingChatIds: number[]) => {
    const next = pruneFolderChats(folders.value, existingChatIds)
    const changed = next.some((folder, index) => folder.chatIds !== folders.value[index]?.chatIds)
    if (!changed) return
    folders.value = next
    persist()
  }

  return { folders, create, rename, remove, toggleChat, setChats, moveChat, prune }
}
