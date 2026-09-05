export interface ChatUser {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  avatar_url: string | null
}

export interface MessageFile {
  name: string
  url: string
  mime: string | null
  size: number | null
}

export interface ReactionSummary {
  emoji: string
  count: number
  reacted_by_me: boolean
}

export interface Chat {
  id: number
  name: string
  users: ChatUser[]
  last_message: Message | null
  unread_count: number
}

export interface Message {
  id: number
  chat_id: number
  user_id: number
  text: string
  timestamp: string
  reply_to_id: number | null
  is_read: boolean
  is_pinned: boolean
  file: MessageFile | null
  reactions: ReactionSummary[]
}

export interface CreateMessageRequest {
  text: string
  chat_id: number
  reply_to_id?: number | null
}

export interface OpenPrivateChatRequest {
  user_id: number
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
