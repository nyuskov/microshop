import { api } from './api'
import type { Chat, Message, CreateMessageRequest, OpenPrivateChatRequest } from '@/types'

export interface SearchUserResult {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
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

/** Возвращает сообщения указанного чата. */
export const fetchMessages = async (chatId: number): Promise<Message[]> => {
  const response = await api.get<Message[]>(`/messages/${chatId}/`)
  return response.data
}

/** Отправляет сообщение в чат от имени текущего пользователя. */
export const sendNewMessage = async (chatId: number, text: string): Promise<Message> => {
  const payload: CreateMessageRequest = { chat_id: chatId, text }
  const response = await api.post<Message>('/messages/', payload)
  return response.data
}

/** Ищет пользователей по логину или номеру телефона. */
export const searchUsers = async (query: string): Promise<SearchUserResult[]> => {
  const response = await api.get<SearchUserResult[]>('/users/search/', {
    params: { q: query }
  })
  return response.data
}
