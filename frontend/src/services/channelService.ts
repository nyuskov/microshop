/**
 * Каналы: подписка, посты, комментарии, просмотры, предложенные посты.
 *
 * Канал — это чат (`is_channel`): лента постов живёт в обычных сообщениях
 * (`/messages/`), а здесь — только то, чего у чата нет: карточка канала,
 * подписка, счётчики постов, комментарии под постом и «предложить пост».
 */
import { api } from '@/services/api'
import type { ChannelCard, ChannelComment, ChannelPostMeta, ChannelSuggestion } from '@/types'

/** Создаёт канал (до 10 на аккаунт). */
export const createChannel = async (payload: {
  title: string
  description?: string | null
  is_public: boolean
  username?: string | null
}): Promise<ChannelCard> => {
  const { data } = await api.post<ChannelCard>('/channels/', payload)
  return data
}

/** Мои каналы (владелец/админ) — для управления. */
export const fetchMyChannels = async (): Promise<ChannelCard[]> => {
  const { data } = await api.get<ChannelCard[]>('/channels/mine/')
  return data
}

/** Поиск публичных каналов по адресу (@username) и названию. */
export const searchChannels = async (query: string): Promise<ChannelCard[]> => {
  const { data } = await api.get<ChannelCard[]>('/channels/search/', {
    params: { q: query }
  })
  return data
}

/** Публичный канал по ссылке `/c/<username>` (экран подписки). */
export const fetchChannelByUsername = async (username: string): Promise<ChannelCard> => {
  const { data } = await api.get<ChannelCard>(
    `/channels/by-username/${encodeURIComponent(username)}/`
  )
  return data
}

/** Карточка канала (шапка, настройки). */
export const fetchChannel = async (chatId: number): Promise<ChannelCard> => {
  const { data } = await api.get<ChannelCard>(`/channels/${chatId}/`)
  return data
}

/** Правка канала: название, описание, публичность и адрес. */
export const updateChannel = async (
  chatId: number,
  payload: {
    title?: string
    description?: string | null
    is_public?: boolean
    username?: string | null
  }
): Promise<ChannelCard> => {
  const { data } = await api.patch<ChannelCard>(`/channels/${chatId}/`, payload)
  return data
}

/** Подписка на публичный канал. */
export const joinChannel = async (chatId: number): Promise<ChannelCard> => {
  const { data } = await api.post<ChannelCard>(`/channels/${chatId}/join/`)
  return data
}

/** Отписка (владелец отписаться не может). */
export const leaveChannel = async (chatId: number): Promise<void> => {
  await api.post(`/channels/${chatId}/leave/`)
}

/** Подписчики канала (владелец/админ). */
export const fetchChannelSubscribers = async (
  chatId: number
): Promise<{ id: number; username: string; name: string; role: string }[]> => {
  const { data } = await api.get(`/channels/${chatId}/subscribers/`)
  return data
}

/** Назначить/снять админа канала (только владелец). */
export const setChannelAdmin = async (
  chatId: number,
  userId: number,
  admin: boolean
): Promise<void> => {
  await api.post(`/channels/${chatId}/admins/`, { user_id: userId, admin })
}

/** Счётчики постов (просмотры/комментарии) — одним запросом на список id. */
export const fetchPostsMeta = async (
  chatId: number,
  messageIds: number[]
): Promise<ChannelPostMeta[]> => {
  if (messageIds.length === 0) return []
  const { data } = await api.get<ChannelPostMeta[]>(`/channels/${chatId}/posts/meta/`, {
    params: { ids: messageIds.join(',') }
  })
  return data
}

/** Отметить пост просмотренным (счётчик у поста). */
export const markPostViewed = async (chatId: number, messageId: number): Promise<void> => {
  await api.post(`/channels/${chatId}/posts/${messageId}/view/`)
}

/** Комментарии под постом. */
export const fetchComments = async (
  chatId: number,
  messageId: number
): Promise<ChannelComment[]> => {
  const { data } = await api.get<ChannelComment[]>(
    `/channels/${chatId}/posts/${messageId}/comments/`
  )
  return data
}

/** Оставить комментарий под постом. */
export const addComment = async (
  chatId: number,
  messageId: number,
  text: string
): Promise<ChannelComment> => {
  const { data } = await api.post<ChannelComment>(
    `/channels/${chatId}/posts/${messageId}/comments/`,
    { text }
  )
  return data
}

/** Удалить комментарий (свой или, если админ, любой). */
export const deleteComment = async (chatId: number, commentId: number): Promise<void> => {
  await api.delete(`/channels/${chatId}/comments/${commentId}/`)
}

/** Предложить пост (подписчик) — публикует владелец/админ после одобрения. */
export const suggestPost = async (chatId: number, text: string): Promise<ChannelSuggestion> => {
  const { data } = await api.post<ChannelSuggestion>(`/channels/${chatId}/suggestions/`, { text })
  return data
}

/** Предложенные посты: админам — все, автору — свои. */
export const fetchSuggestions = async (
  chatId: number,
  onlyPending = true
): Promise<ChannelSuggestion[]> => {
  const { data } = await api.get<ChannelSuggestion[]>(`/channels/${chatId}/suggestions/`, {
    params: { only_pending: onlyPending }
  })
  return data
}

/** Одобрить предложку: текст публикуется в канале от имени админа. */
export const approveSuggestion = async (
  chatId: number,
  suggestionId: number
): Promise<ChannelSuggestion> => {
  const { data } = await api.post<ChannelSuggestion>(
    `/channels/${chatId}/suggestions/${suggestionId}/approve/`
  )
  return data
}

/** Отклонить предложку (автору приходит событие с исходом). */
export const rejectSuggestion = async (
  chatId: number,
  suggestionId: number
): Promise<ChannelSuggestion> => {
  const { data } = await api.post<ChannelSuggestion>(
    `/channels/${chatId}/suggestions/${suggestionId}/reject/`
  )
  return data
}
