/**
 * Фильтры списка чатов: «Все», «Непрочитанные», «Личные», «Группы», «Каналы», «Архив»
 * и папки пользователя (`folder:<id>`).
 *
 * Вынесено из `ChatSidebar.vue`, чтобы правила проверялись тестами: здесь живёт
 * главное про архив — архивированные чаты прячутся из остальных фильтров,
 * иначе смысл архива теряется. То же правило действует и для папок: «в архиве»
 * сильнее «я добавил чат в папку», иначе архив перестаёт быть местом, куда
 * убирают шум.
 */

import type { Chat } from '@/types'
import { folderById, folderIdFromFilter, type ChatFolder } from '@/utils/chatFolders'
import { isGroupChat } from '@/utils/user'

export type ChatFilterKey = 'all' | 'unread' | 'private' | 'groups' | 'channels' | 'archived'

/** Что может стоять в фильтре: базовый ключ или папка пользователя. */
export type ChatFilterValue = ChatFilterKey | `folder:${string}`

export const CHAT_FILTERS: { key: ChatFilterKey; title: string }[] = [
  { key: 'all', title: 'Все' },
  { key: 'unread', title: 'Непрочитанные' },
  { key: 'private', title: 'Личные' },
  { key: 'groups', title: 'Группы' },
  { key: 'channels', title: 'Каналы' },
  { key: 'archived', title: 'Архив' }
]

/**
 * В архиве ли чат.
 *
 * Архив, как пины, живёт в localStorage (`pismo_archived_chats`), а не на сервере:
 * он влияет только на список чатов на этом устройстве. Архивирование — всегда
 * явное действие пользователя (меню чата или панель выделения), автоматически
 * ничего не уезжает: иначе чат «теряется» без спроса.
 */
export const isChatArchived = (chatId: number, archivedIds?: number[]): boolean =>
  archivedIds?.includes(chatId) ?? false

/** Подходит ли чат выбранному фильтру. */
export const chatMatchesFilter = (
  chat: Chat,
  filter: ChatFilterValue,
  archivedIds?: number[],
  folders?: ChatFolder[]
): boolean => {
  const archived = isChatArchived(chat.id, archivedIds)
  // Архив — отдельное измерение, а не «ещё один тип чата».
  if (filter === 'archived') return archived
  if (archived) return false
  const folderId = folderIdFromFilter(filter)
  if (folderId !== null) {
    const folder = folderById(folders ?? [], folderId)
    return folder !== null && folder.chatIds.includes(chat.id)
  }
  if (filter === 'unread') return (chat.unread_count ?? 0) > 0
  // Канал — тоже групповой чат, поэтому в «Группах» его не показываем.
  if (filter === 'groups') return isGroupChat(chat) && !chat.is_channel
  if (filter === 'channels') return !!chat.is_channel
  if (filter === 'private') return !isGroupChat(chat)
  return true
}
