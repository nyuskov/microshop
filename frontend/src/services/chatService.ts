export { mediaUrl } from '@/config'

import { api } from './api'
import { localUtcOffsetMinutes } from '@/utils/quietHours'
import { uploadPercent } from '@/utils/upload'
import type {
  Chat,
  ChatBanEntry,
  ChatDetail,
  ChatMediaItem,
  ChatMediaKind,
  CreateScheduledMessageRequest,
  GroupInvite,
  GroupInvitePreview,
  GroupJoinResult,
  Message,
  CreateMessageRequest,
  CreateGroupRequest,
  MessageReminder,
  OpenPrivateChatRequest,
  ScheduledMessage
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

export interface ChatStatsDay {
  /** Локальная дата дня (`2026-09-17`) — уже со сдвигом пояса устройства. */
  date: string
  count: number
}

export interface ChatStatsSender {
  user_id: number
  /** Пустая строка — аккаунт удалён. */
  name: string
  count: number
}

export interface ChatStatsMedia {
  image: number
  video: number
  audio: number
  file: number
}

export interface ChatStats {
  messages_total: number
  first_at: string | null
  last_at: string | null
  days: ChatStatsDay[]
  media: ChatStatsMedia
  top_senders: ChatStatsSender[]
}

/**
 * Статистика чата.
 *
 * Сдвиг пояса считает клиент (сервер живёт в UTC): без него «сообщений по дням»
 * показывало бы вечерние сообщения как ночные.
 */
export const fetchChatStats = async (chatId: number): Promise<ChatStats> => {
  const response = await api.get<ChatStats>(`/chats/${chatId}/stats/`, {
    params: { offset_minutes: localUtcOffsetMinutes() }
  })
  return response.data
}

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

/**
 * Мут участника: minutes — на сколько минут (null — снять).
 *
 * Возвращает карточку группы: список участников на экране обновляется без
 * второго запроса.
 */
export const muteGroupMember = async (
  chatId: number,
  userId: number,
  minutes: number | null
): Promise<ChatDetail> => {
  const response = await api.post<ChatDetail>(`/chats/${chatId}/members/${userId}/mute/`, {
    minutes
  })
  return response.data
}

/** Бан участника: исключает и закрывает вход обратно (даже по ссылке). */
export const banGroupMember = async (
  chatId: number,
  userId: number,
  reason?: string
): Promise<ChatDetail> => {
  const response = await api.post<ChatDetail>(`/chats/${chatId}/members/${userId}/ban/`, {
    reason: reason ?? null
  })
  return response.data
}

/** Снимает бан: человек сможет вернуться, но участником не становится. */
export const unbanGroupMember = async (chatId: number, userId: number): Promise<void> => {
  await api.delete(`/chats/${chatId}/bans/${userId}/`)
}

/** Бан-лист группы (видят создатель и админы). */
export const fetchGroupBans = async (chatId: number): Promise<ChatBanEntry[]> => {
  const response = await api.get<ChatBanEntry[]>(`/chats/${chatId}/bans/`)
  return response.data
}

/** Медленный режим группы: пауза между сообщениями участника (0 — выключен). */
export const setGroupSlowMode = async (chatId: number, seconds: number): Promise<Chat> => {
  const response = await api.patch<Chat>(`/chats/${chatId}/slow-mode/`, { seconds })
  return response.data
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
  encrypted = false,
  replyToStoryId?: number | null
): Promise<Message> => {
  const payload: CreateMessageRequest = {
    chat_id: chatId,
    text,
    reply_to_id: replyToId ?? null,
    reply_to_story_id: replyToStoryId ?? null,
    encrypted
  }
  const response = await api.post<Message>('/messages/', payload)
  return response.data
}

/** Отправляет файл/изображение как сообщение.
 *
 * `sticker=true` помечает сообщение стикером (``kind='sticker'``): лента рисует
 * его без пузыря, крупно. Сервер принимает так только картинки.
 *
 * `viewOnce=true` — «посмотреть один раз»: сервер отдаст файл ровно один раз,
 * дальше в ленте останется плашка «Просмотрено».
 */
export const sendAttachmentMessage = async (
  chatId: number,
  file: File,
  caption = '',
  replyToId?: number | null,
  onProgress?: (percent: number) => void,
  encrypted = false,
  sticker = false,
  viewOnce = false
): Promise<Message> => {
  const params: Record<string, string | number> = {
    chat_id: chatId,
    filename: file.name,
    caption,
    mime: file.type
  }
  if (sticker) {
    params.sticker = 'true'
  }
  if (viewOnce) {
    params.view_once = 'true'
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

/**
 * Убирает сообщение: `forAll=false` — скрыть только у себя, `true` — у всех.
 *
 * «Для всех» возможно только для своего сообщения (сервер ответит 403), «у меня» —
 * для любого: чужое сообщение тоже можно убрать из своего интерфейса.
 */
export const deleteMessage = async (messageId: number, forAll = false): Promise<void> => {
  await api.delete(`/messages/${messageId}/`, { params: { for_all: String(forAll) } })
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

/** Ставит сообщение в очередь «отправить позже» (уйдёт и с закрытым приложением). */
export const createScheduledMessage = async (
  payload: CreateScheduledMessageRequest
): Promise<ScheduledMessage> => {
  const response = await api.post<ScheduledMessage>('/messages/scheduled/', payload)
  return response.data
}

/** Свои отложенные сообщения: все или только по одному чату. */
export const fetchScheduledMessages = async (chatId?: number): Promise<ScheduledMessage[]> => {
  const response = await api.get<ScheduledMessage[]>('/messages/scheduled/', {
    params: chatId === undefined ? {} : { chat_id: chatId }
  })
  return response.data
}

/** Отменяет свою отложенную отправку. */
export const cancelScheduledMessage = async (scheduledId: number): Promise<void> => {
  await api.delete(`/messages/scheduled/${scheduledId}/`)
}

/**
 * Ставит напоминание о сообщении (повторный вызов переносит срок).
 *
 * Чат сервер берёт из самого сообщения: напомнить о строке из чужого чата
 * нельзя. Доставка — push, поэтому напоминание сработает и с закрытым
 * приложением.
 */
export const createMessageReminder = async (
  messageId: number,
  remindAt: string
): Promise<MessageReminder> => {
  const response = await api.post<MessageReminder>(`/messages/${messageId}/reminder/`, {
    remind_at: remindAt
  })
  return response.data
}

/** Свои напоминания: все или только по одному чату. */
export const fetchMessageReminders = async (chatId?: number): Promise<MessageReminder[]> => {
  const response = await api.get<MessageReminder[]>('/messages/reminders/', {
    params: chatId === undefined ? {} : { chat_id: chatId }
  })
  return response.data
}

/** Снимает своё напоминание. */
export const cancelMessageReminder = async (reminderId: number): Promise<void> => {
  await api.delete(`/messages/reminders/${reminderId}/`)
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

// ---------- Ссылки-приглашения в группы ----------

export interface CreateGroupInviteParams {
  /** Срок годности в часах (нет — ссылка без срока). */
  expiresInHours?: number | null
  /** Сколько раз по ссылке можно войти (нет — без ограничения). */
  maxUses?: number | null
}

/** Создаёт ссылку-приглашение в группу (создатель или админ). */
export const createGroupInvite = async (
  chatId: number,
  params: CreateGroupInviteParams = {}
): Promise<GroupInvite> => {
  const response = await api.post<GroupInvite>(`/chats/${chatId}/invites/`, {
    expires_in_hours: params.expiresInHours ?? null,
    max_uses: params.maxUses ?? null
  })
  return response.data
}

/** Ссылки группы: сначала действующие, потом отозванные и истёкшие. */
export const fetchGroupInvites = async (chatId: number): Promise<GroupInvite[]> => {
  const response = await api.get<GroupInvite[]>(`/chats/${chatId}/invites/`)
  return response.data
}

/** Отзывает ссылку — она сразу перестаёт работать. */
export const revokeGroupInvite = async (chatId: number, inviteId: number): Promise<void> => {
  await api.delete(`/chats/${chatId}/invites/${inviteId}/`)
}

/** Карточка группы по ссылке (до вступления). */
export const fetchGroupInvitePreview = async (token: string): Promise<GroupInvitePreview> => {
  const response = await api.get<GroupInvitePreview>(`/chats/invites/${token}/`)
  return response.data
}

/** Вступает в группу по ссылке. */
export const joinGroupByInvite = async (token: string): Promise<GroupJoinResult> => {
  const response = await api.post<GroupJoinResult>(`/chats/invites/${token}/join/`)
  return response.data
}
