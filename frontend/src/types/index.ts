export interface Chat {
  id: number
  name: string
}

export interface Message {
  id: number
  text: string
  user_id: number // или объект пользователя
  chat_id: number
}

export interface CreateChatRequest {
  name: string
}

export interface CreateMessageRequest {
  text: string
  user_id: number
  chat_id: number
}
