import type { Chat, Message } from '@/types'
import { isEncryptedPayload } from '@/services/e2ee'
import { isLockedFile, lockedFileLabel, mediaTypeLabel } from '@/utils/media'
import { plainMessageText } from '@/utils/mentions'
import { avatarUrlOf, chatPeer, chatTitle, groupAvatarUrl, isGroupChat } from '@/utils/user'
import { t } from '@/i18n'

/**
 * Подписи для результатов поиска по сообщениям.
 *
 * Результат показывает не само сообщение, а «где и что»: название чата, его
 * аватар, тему сообщения (или тип вложения) и оговорку для своих сообщений.
 * Логика вынесена из разметки сайдбара: она не зависит от вида списка, поэтому
 * её можно переиспользовать в панели поиска и проверить тестами.
 */

/** Чат, в котором лежит сообщение (его может не быть в загруженном списке). */
export function chatOfMessage(chats: Chat[], message: Message): Chat | undefined {
  return chats.find((chat) => chat.id === message.chat_id)
}

/** Название чата для результата поиска (`#id`, если чата нет в списке). */
export function messageChatTitle(
  chats: Chat[],
  message: Message,
  currentUserId: number | null
): string {
  const chat = chatOfMessage(chats, message)
  return chat ? chatTitle(chat, currentUserId) : `#${message.chat_id}`
}

/** Аватар чата (собеседника) для результата поиска. */
export function messageChatAvatar(
  chats: Chat[],
  message: Message,
  currentUserId: number | null
): string | undefined {
  const chat = chatOfMessage(chats, message)
  if (!chat) return undefined
  // У группы — своё фото, у личного чата — аватар собеседника.
  return isGroupChat(chat) ? groupAvatarUrl(chat) : avatarUrlOf(chatPeer(chat, currentUserId))
}

/** Префикс «Вы: » для своих сообщений в результате поиска. */
export function messageSenderPrefix(message: Message, currentUserId: number | null): string {
  return currentUserId !== null && message.user_id === currentUserId ? t('Вы: ') : ''
}

/** Текст сниппета сообщения (текст или тип вложения). */
export function messageSnippetText(message: Message): string {
  if (message.hidden) return t('Скрыто до проверки модератором')
  if (isLockedFile(message)) return lockedFileLabel(message)
  if (message.encrypted && isEncryptedPayload(message.text)) return t('🔒 Сообщение')
  if (message.text) return plainMessageText(message.text)
  return message.file ? mediaTypeLabel(message.file) : ''
}
