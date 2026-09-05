import { api } from './api'
import type { Chat, Message, CreateMessageRequest, OpenPrivateChatRequest } from '@/types'

export interface SearchUserResult {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  avatar_url?: string | null
}

/** Превращает относительный путь /media/... в абсолютный адрес бэкенда. */
export const mediaUrl = (path: string): string =>
  `${window.location.protocol}//${window.location.hostname}:8000${path}`

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

/** Возвращает сообщения указанного чата. */
export const fetchMessages = async (chatId: number): Promise<Message[]> => {
  const response = await api.get<Message[]>(`/messages/${chatId}/`)
  return response.data
}

/** Возвращает закреплённые сообщения чата. */
export const fetchPinnedMessages = async (chatId: number): Promise<Message[]> => {
  const response = await api.get<Message[]>(`/messages/${chatId}/pinned/`)
  return response.data
}

/** Отправляет текстовое сообщение от имени текущего пользователя. */
export const sendNewMessage = async (
  chatId: number,
  text: string,
  replyToId?: number | null
): Promise<Message> => {
  const payload: CreateMessageRequest = {
    chat_id: chatId,
    text,
    reply_to_id: replyToId ?? null
  }
  const response = await api.post<Message>('/messages/', payload)
  return response.data
}

/** Отправляет файл/изображение как сообщение. */
export const sendAttachmentMessage = async (
  chatId: number,
  file: File,
  caption = '',
  replyToId?: number | null
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
  const response = await api.post<Message>('/messages/attachment/', file, {
    params,
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })
  return response.data
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

/** Ищет пользователей по логину или номеру телефона. */
export const searchUsers = async (query: string): Promise<SearchUserResult[]> => {
  const response = await api.get<SearchUserResult[]>('/users/search/', {
    params: { q: query }
  })
  return response.data
}

/** Возвращает всех пользователей, кроме текущего (вкладка «Контакты»). */
export const fetchContacts = async (): Promise<SearchUserResult[]> => {
  const response = await api.get<SearchUserResult[]>('/users/contacts/')
  return response.data
}
