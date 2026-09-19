import type { Chat, ChatUser, Message } from '@/types'
import { isEncryptedPayload } from '@/services/e2ee'
import type { PeerActivityKind } from '@/utils/peerActivity'
import {
  callMessageIcon,
  callMessageText,
  isLockedFile,
  lockedFileLabel,
  mediaTypeLabel
} from '@/utils/media'
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

/**
 * Канал: посты — содержимое канала, а не личные сообщения. Влияет на строку
 * списка: у канала нет ни галочек прочтения, ни префикса «Вы: ».
 */
const isChannel = (chat: Chat): boolean => Boolean(chat.is_channel)

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

/**
 * Чем занят собеседник в этом чате прямо сейчас (`null` — ничем).
 *
 * В списке диалогов показываем только личные чаты: в группе подпись без имени
 * бесполезна, а место в строке одно. Там же, где имя есть (шапка чата), подпись
 * собирается отдельно — см. `peerActivityLabel`.
 */
export const chatActivityKind = (
  chat: Chat,
  activities?: Record<number, PeerActivityKind>
): PeerActivityKind | null => (chat.users.length === 2 ? (activities?.[chat.id] ?? null) : null)

/** Печатает ли сейчас собеседник в этом чате. */
export const isChatTyping = (chat: Chat, typingChatIds?: number[]): boolean =>
  chat.users.length === 2 && (typingChatIds?.includes(chat.id) ?? false)

/**
 * Последнее сообщение чата отправлено мной.
 *
 * В КАНАЛЕ всегда false: посты — содержимое канала, а не моя личная переписка.
 * Галочки прочтения в строке канала были бы враньём (пост читают много людей), и
 * строка получала бы вид «моё сообщение» — как в ленте (см. MessageRow).
 */
export const lastMessageIsOut = (chat: Chat, currentUserId: number | null): boolean => {
  if (isChannel(chat)) return false
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
 * Отметка о звонке для строки списка: иконка и «тревожный» тон.
 *
 * В строке превью иконка вместо эмодзи (как у галочек и колокольчика «без
 * звука»): `call_missed`/`call_end` рисуются красным, потому что пропущенный
 * звонок — то, на что человеку надо отреагировать.
 * Возвращает null, если последнее сообщение — не звонок.
 */
export interface PreviewCall {
  /** Логическое имя иконки (см. utils/icons.ts). */
  icon: string
  /** Пропущенный/отклонённый — рисуем акцентом «обрати внимание». */
  missed: boolean
}

export const previewCallOf = (message: Message | null | undefined): PreviewCall | null => {
  if (!message || message.kind !== 'call') return null
  return {
    icon: callMessageIcon(message),
    missed: message.call_state === 'missed' || message.call_state === 'declined'
  }
}

/**
 * Текст превью последнего сообщения: «Вы: », имя автора в группе, пометка
 * пересылки, тип вложения или запись о звонке вместо текста.
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
  // В канале «Вы: » не пишем: пост в канале — не личное сообщение от меня.
  let prefix = mine && !isChannel(chat) ? 'Вы: ' : ''
  if (!mine && isGroupChat(chat)) {
    const author = lastMessageAuthor(chat, last)
    if (author) prefix = `${displayName(author)}: `
  }
  const body = lastBody(last)
  if (last.forwarded_from) return `${prefix}↪ Переслано: ${body}`
  return `${prefix}${body}`
}

/**
 * Содержимое превью без префикса: запись о звонке, вложение или текст.
 *
 * ГРАБЛЯ (поймано пользователем 15.09.2026): у сообщения-звонка `text` пустой
 * (сервер пишет `text=""`, см. `api_v1/calls/views.py::_persist_call_record`),
 * и в списке чатов превью было ПУСТЫМ — по строке нельзя было понять, что был
 * звонок, какой (аудио/видео) и чем закончился. Здесь звонок разбирается так же,
 * как в цитатах и закреплённых (`utils/media.ts::messageSnippet`).
 */
const lastBody = (message: Message): string => {
  if (message.kind === 'call') return callMessageText(message) ?? 'Звонок'
  return message.file ? mediaTypeLabel(message.file) : plainMessageText(message.text)
}
