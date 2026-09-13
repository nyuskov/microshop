import type { Chat, ChatUser, Message } from '@/types'
import { isEncryptedPayload } from '@/services/e2ee'
import { isLockedFile, lockedFileLabel, mediaTypeLabel } from '@/utils/media'
import { plainMessageText } from '@/utils/mentions'
import {
  avatarUrlOf,
  chatPeer,
  chatTitle,
  displayName,
  groupAvatarUrl,
  isGroupChat
} from '@/utils/user'

/**
 * Подписи строки чата в списке: название, аватар, строка превью и служебные
 * признаки (печатает, черновик, прочитано).
 *
 * Вынесено из `ChatSidebar.vue`, чтобы список чатов можно было держать отдельным
 * компонентом, а правила превью — проверять тестами без DOM. Логика зависит
 * только от данных чата, поэтому чистая.
 */

/** Собеседник личного чата (для аватара и «в сети»). */
export const chatPeerOf = (chat: Chat, currentUserId: number | null): ChatUser | undefined =>
  chatPeer(chat, currentUserId)

/** Название чата в списке (для группы — имя группы, для личного — собеседник). */
export const chatTitleOf = (chat: Chat, currentUserId: number | null): string =>
  chatTitle(chat, currentUserId)

/** Аватар чата: у группы — своё фото, у личного — аватар собеседника. */
export const chatAvatarOf = (chat: Chat, currentUserId: number | null): string | undefined =>
  isGroupChat(chat) ? groupAvatarUrl(chat) : avatarUrlOf(chatPeerOf(chat, currentUserId))

/**
 * «В сети»: только явное присутствие из WS-канала.
 *
 * Раньше был ещё фоллбэк по `last_seen` (±30 секунд), и при свёрнутом
 * приложении зелёная точка загоралась после каждого heartbeat — собеседник видел
 * «онлайн» у того, кто давно ушёл. Источник правды один — `presence`.
 *
 * Индикатор показываем только у личных (1-1) чатов.
 */
export const chatPeerOnline = (
  chat: Chat,
  currentUserId: number | null,
  onlineUserIds?: number[]
): boolean => {
  if (chat.users.length !== 2) return false
  const peer = chatPeer(chat, currentUserId)
  return !!peer && (onlineUserIds?.includes(peer.id) ?? false)
}

/** Печатает ли сейчас собеседник в этом чате. */
export const isChatTyping = (chat: Chat, typingChatIds?: number[]): boolean =>
  chat.users.length === 2 && (typingChatIds?.includes(chat.id) ?? false)

/** Последнее сообщение чата отправлено мной. */
export const lastMessageIsOut = (chat: Chat, currentUserId: number | null): boolean => {
  const last = chat.last_message
  return !!last && currentUserId !== null && last.user_id === currentUserId
}

/** Черновик чата (null — черновика нет). */
export const draftOf = (chat: Chat, drafts?: Record<number, string>): string | null => {
  const text = drafts?.[chat.id]
  return text && text.trim() ? text : null
}

/** Автор последнего сообщения в группе (для префикса превью). */
const lastMessageAuthor = (chat: Chat, message: Message): ChatUser | undefined =>
  chat.users.find((user) => user.id === message.user_id)

/**
 * Текст превью последнего сообщения: «Вы: », имя автора в группе, пометка
 * пересылки, тип вложения вместо текста.
 */
export const previewText = (chat: Chat, currentUserId: number | null): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  // Скрытое модерацией: сервер не отдаёт ни текст, ни файл — показываем пометку,
  // а не пустую строку (иначе выглядит как сбой).
  if (last.hidden) return 'Скрыто до проверки модератором'
  // Зашифрованное вложение: содержимое и имя файла серверу неизвестны.
  if (isLockedFile(last)) return lockedFileLabel(last)
  if (last.encrypted && isEncryptedPayload(last.text)) return '🔒 Сообщение'
  const mine = currentUserId !== null && last.user_id === currentUserId
  let prefix = mine ? 'Вы: ' : ''
  if (!mine && isGroupChat(chat)) {
    const author = lastMessageAuthor(chat, last)
    if (author) prefix = `${displayName(author)}: `
  }
  const body = last.file ? mediaTypeLabel(last.file) : plainMessageText(last.text)
  if (last.forwarded_from) return `${prefix}↪ Переслано: ${body}`
  return `${prefix}${body}`
}
