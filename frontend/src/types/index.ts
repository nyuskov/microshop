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

export interface Profile {
  bio: string | null
  birth_date: string | null
  language: string | null
  country: string | null
  notifications_enabled: boolean
  privacy_mode: boolean
}

export interface User {
  id: number
  username: string
  phone_number?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  is_superuser?: boolean
  profile?: Profile | null
  chats?: Chat[]
  posts?: unknown[]
}

export interface Group {
  id: number
  name: string
  description?: string
  users?: User[]
}
