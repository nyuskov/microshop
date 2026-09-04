import axios from 'axios'
import type { Chat, Message, CreateChatRequest, CreateMessageRequest } from '@/types'

const API_BASE_URL = 'https://localhost:8000/api/v1' // Обновленный URL

export const fetchChats = async (): Promise<Chat[]> => {
  const response = await axios.get(`${API_BASE_URL}/chats/`)
  return response.data
}

export const createChat = async (chatData: CreateChatRequest): Promise<Chat> => {
  const response = await axios.post(`${API_BASE_URL}/chats/`, chatData)
  return response.data
}

export const fetchMessages = async (chatId: number): Promise<Message[]> => {
  const response = await axios.get(`${API_BASE_URL}/messages/${chatId}`)
  return response.data
}

export const sendNewMessage = async (messageData: CreateMessageRequest): Promise<Message> => {
  const response = await axios.post(`${API_BASE_URL}/messages/`, messageData)
  return response.data
}
