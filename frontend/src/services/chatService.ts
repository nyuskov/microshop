export { mediaUrl } from '@/config'

import { api } from './api'
import { uploadPercent } from '@/utils/upload'
import type {
  Chat,
  ChatDetail,
  ChatMediaItem,
  ChatMediaKind,
  Message,
  CreateMessageRequest,
  CreateGroupRequest,
  OpenPrivateChatRequest
} from '@/types'

export interface SearchUserResult {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  avatar_url?: string | null
}

/** Публичные данные пользователя по ссылке-профилю (без номера телефона). */
export interface UserLinkPreview {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  avatar_url?: string | null
  status?: string | null
}

/** Сколько ждём загрузку вложения (обычные запросы живут 15 с). */
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 120_000

/** Возвращает чаты текущего пользователя с последними сообщениями. */
export const fetchMyChats = async (): Promise<Chat[]> => {
  const response = await api.get<Chat[]>('/chats/')
  return response.data
}

/** Находит или создаёт личный чат с указанным пользователем. */
export const openPrivateChat = async (userId: number): Promise<Chat> => {
  const payload: OpenPrivateChatRequest = { user_id: userId }
  const response = await api.post<Chat>('/chats/private/', payload)
  return response.data
}

/** Создаёт групповой чат. */
export const createGroupChat = async (
  name: string,
  userIds: number[],
  description?: string | null
): Promise<Chat> => {
  const payload: CreateGroupRequest = {
    name,
    user_ids: userIds,
    ...(description != null ? { description } : {})
  }
  const response = await api.post<Chat>('/chats/groups/', payload)
  return response.data
}

/** Возвращает карточку чата с участниками и их ролями. */
export const fetchChatDetail = async (chatId: number): Promise<ChatDetail> => {
  const response = await api.get<ChatDetail>(`/chats/${chatId}/`)
  return response.data
}

/** Меняет название/описание группы. */
export const updateGroupInfo = async (
  chatId: number,
  data: { name?: string; description?: string | null }
): Promise<Chat> => {
  const response = await api.patch<Chat>(`/chats/${chatId}/`, data)
  return response.data
}

/** Добавляет участников в группу. */
export const addGroupMembers = async (chatId: number, userIds: number[]): Promise<Chat> => {
  const response = await api.post<Chat>(`/chats/${chatId}/members/`, {
    user_ids: userIds
  })
  return response.data
}

/** Исключает участника из группы. */
export const removeGroupMember = async (chatId: number, userId: number): Promise<void> => {
  await api.delete(`/chats/${chatId}/members/${userId}/`)
}

/** Назначает/снимает админа группы (role: 'admin' | 'member'). */
export const setGroupMemberRole = async (
  chatId: number,
  userId: number,
  role: 'admin' | 'member'
): Promise<void> => {
  await api.patch(`/chats/${chatId}/members/${userId}/role/`, { role })
}

/** Загружает аватар группы (raw-байты, ext — расширение файла). */
export const uploadGroupAvatar = async (chatId: number, file: File): Promise<Chat> => {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const response = await api.post<Chat>(`/chats/${chatId}/avatar/`, file, {
    params: { ext },
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })
  return response.data
}

/** Удаляет аватар группы. */
export const removeGroupAvatar = async (chatId: number): Promise<Chat> => {
  const response = await api.delete<Chat>(`/chats/${chatId}/avatar/`)
  return response.data
}

export interface FetchMessagesParams {
  /** Сколько последних сообщений вернуть (без beforeId — самые свежие). */
  limit?: number
  /** Вернуть сообщения, более старые, чем это id (для подгрузки истории). */
  beforeId?: number
}

/** Возвращает сообщения указанного чата. */
export const fetchMessages = async (
  chatId: number,
  params: FetchMessagesParams = {}
): Promise<Message[]> => {
  const response = await api.get<Message[]>(`/messages/${chatId}/`, {
    params: {
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      ...(params.beforeId !== undefined ? { before_id: params.beforeId } : {})
    }
  })
  return response.data
}

export interface FetchChatMediaParams {
  /** Тип вложения: image / video / audio / file (без параметра — все). */
  kind?: ChatMediaKind
  limit?: number
  /** Вернуть вложения, более старые, чем сообщение с этим id. */
  beforeId?: number
}

/**
 * Вложения чата для галереи «Медиа/Файлы».
 *
 * Лента отдаёт историю страницами, поэтому галерея из загруженных сообщений
 * показывала бы только последние ~100 сообщений. Сервер выбирает вложения сам
 * и умеет листать в старые (before_id). В зашифрованном чате возвращает пустой
 * список — там галерея строится из расшифрованной истории.
 */
export const fetchChatMedia = async (
  chatId: number,
  params: FetchChatMediaParams = {}
): Promise<ChatMediaItem[]> => {
  const response = await api.get<ChatMediaItem[]>(`/messages/${chatId}/media/`, {
    params: {
      ...(params.kind !== undefined ? { kind: params.kind } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      ...(params.beforeId !== undefined ? { before_id: params.beforeId } : {})
    }
  })
  return response.data
}

/** Серверный поиск по сообщениям (в чате или по всем чатам). */
export const searchMessages = async (query: string, chatId?: number): Promise<Message[]> => {
  const response = await api.get<Message[]>('/messages/search/', {
    params: {
      q: query,
      ...(chatId !== undefined ? { chat_id: chatId } : {})
    }
  })
  return response.data
}

/** Возвращает закреплённые сообщения чата. */
export const fetchPinnedMessages = async (chatId: number): Promise<Message[]> => {
  const response = await api.get<Message[]>(`/messages/${chatId}/pinned/`)
  return response.data
}

/** Удаляет чат: `forAll=false` — только у себя, `forAll=true` — для всех участников. */
export const deleteChat = async (chatId: number, forAll = false): Promise<void> => {
  await api.delete(`/chats/${chatId}/`, {
    params: forAll ? { for_all: 'true' } : {}
  })
}

/** Заглушает (`muted=true`) или включает (`muted=false`) уведомления чата. */
export const setChatMuted = async (chatId: number, muted: boolean): Promise<boolean> => {
  const response = muted
    ? await api.put<{ muted: boolean }>(`/chats/${chatId}/mute/`)
    : await api.delete<{ muted: boolean }>(`/chats/${chatId}/mute/`)
  return response.data?.muted ?? muted
}

/** Включает/выключает сквозное шифрование (тип чата: обычный/зашифрованный). */
export const setChatE2ee = async (chatId: number, enabled: boolean): Promise<boolean> => {
  const response = await api.put<{ e2ee_enabled: boolean }>(`/chats/${chatId}/e2ee/`, {
    enabled
  })
  return response.data?.e2ee_enabled ?? enabled
}

/** Отправляет текстовое сообщение от имени текущего пользователя. */
export const sendNewMessage = async (
  chatId: number,
  text: string,
  replyToId?: number | null,
  encrypted = false
): Promise<Message> => {
  const payload: CreateMessageRequest = {
    chat_id: chatId,
    text,
    reply_to_id: replyToId ?? null,
    encrypted
  }
  const response = await api.post<Message>('/messages/', payload)
  return response.data
}

/** Отправляет файл/изображение как сообщение. */
export const sendAttachmentMessage = async (
  chatId: number,
  file: File,
  caption = '',
  replyToId?: number | null,
  onProgress?: (percent: number) => void,
  encrypted = false
): Promise<Message> => {
  const params: Record<string, string | number> = {
    chat_id: chatId,
    filename: file.name,
    caption,
    mime: file.type
  }
  if (replyToId) {
    params.reply_to_id = replyToId
  }
  // Зашифрованное вложение (E2EE): тело запроса — шифротекст, поэтому сервер не
  // проверяет сигнатуры изображений и не пытается угадать тип. Имя файла тоже
  // нейтральное (`enc_*.bin`) — настоящее лежит в зашифрованном конверте.
  if (encrypted) {
    params.encrypted = 'true'
  }
  const response = await api.post<Message>('/messages/attachment/', file, {
    params,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    // Общий таймаут клиента (15 с) рассчитан на обычные запросы; вложение
    // столько не грузится, поэтому даём свой запас. Пользователь видит прогресс,
    // так что долгое ожидание не выглядит зависанием.
    timeout: ATTACHMENT_UPLOAD_TIMEOUT_MS,
    onUploadProgress: onProgress
      ? (event) => {
          const percent = uploadPercent(event.loaded, event.total ?? 0)
          if (percent !== null) onProgress(percent)
        }
      : undefined
  })
  return response.data
}

/**
 * Ставит в очередь скачивание GIF и создание сообщения (фоново, Celery).
 *
 * Бэкенд отвечает 202 Accepted, не дожидаясь загрузки: сообщение создаст
 * фоновый воркер, после чего web пришлёт событие ``message.new`` (realtime
 * или фолбэк-опрос) — и сообщение появится в ленте само. Здесь ничего не
 * возвращаем — сообщение приходит по событию.
 */
export const sendGifMessage = async (
  chatId: number,
  url: string,
  replyToId?: number | null
): Promise<void> => {
  await api.post('/messages/gif/', {
    chat_id: chatId,
    url,
    reply_to_id: replyToId ?? null
  })
}

/** Закрепляет или открепляет сообщение. */
export const setMessagePinned = async (messageId: number, isPinned: boolean): Promise<Message> => {
  const response = await api.patch<Message>(`/messages/${messageId}/pin/`, {
    is_pinned: isPinned
  })
  return response.data
}

/** Устанавливает реакцию текущего пользователя. */
export const setMessageReaction = async (messageId: number, emoji: string): Promise<Message> => {
  const response = await api.put<Message>(`/messages/${messageId}/reaction/`, {
    emoji
  })
  return response.data
}

/** Снимает реакцию текущего пользователя. */
export const removeMessageReaction = async (messageId: number): Promise<Message> => {
  const response = await api.delete<Message>(`/messages/${messageId}/reaction/`)
  return response.data
}

/** Удаляет сообщение (только своё). */
export const deleteMessage = async (messageId: number): Promise<void> => {
  await api.delete(`/messages/${messageId}/`)
}

/** Редактирует текст своего сообщения. */
export const editMessage = async (messageId: number, text: string): Promise<Message> => {
  const response = await api.patch<Message>(`/messages/${messageId}/`, { text })
  return response.data
}

/** Пересылает сообщение в указанный чат. */
export const forwardMessage = async (
  messageId: number,
  chatId: number,
  replyToId?: number | null
): Promise<Message> => {
  const response = await api.post<Message>('/messages/forward/', {
    message_id: messageId,
    chat_id: chatId,
    reply_to_id: replyToId ?? null
  })
  return response.data
}

/** Ищет пользователей по логину или номеру телефона. */
export const searchUsers = async (query: string): Promise<SearchUserResult[]> => {
  const response = await api.get<SearchUserResult[]>('/users/search/', {
    params: { q: query }
  })
  return response.data
}

/** Ищет пользователей мессенджера по номерам из телефонной книги. */
export const matchUsersByPhone = async (phones: string[]): Promise<SearchUserResult[]> => {
  const response = await api.post<SearchUserResult[]>('/users/match-by-phone/', { phones })
  return response.data
}

/**
 * Пользователь по ссылке-профилю (`https://pismo.space/u/<логин>`).
 *
 * В ответе нет номера телефона: ссылку можно переслать кому угодно, и она не
 * должна раскрывать персональные данные (см. UserLinkPreviewSchema на бэкенде).
 */
export const fetchUserByUsername = async (username: string): Promise<UserLinkPreview> => {
  const response = await api.get<UserLinkPreview>(
    `/users/by-username/${encodeURIComponent(username)}`
  )
  return response.data
}

/** Возвращает всех пользователей, кроме текущего (вкладка «Контакты»). */
export const fetchContacts = async (): Promise<SearchUserResult[]> => {
  const response = await api.get<SearchUserResult[]>('/users/contacts/')
  return response.data
}
