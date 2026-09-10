export interface ChatUser {
  id: number
  username: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  avatar_url: string | null
  status?: string | null
  last_seen?: string | null
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

/** Данные плашки «Переслано от …» (снимок на момент пересылки). */
export interface ForwardedFrom {
  id: number
  sender_id: number | null
  sender_name: string
  /** Аватар автора оригинала (снимок на момент пересылки). */
  sender_avatar_url?: string | null
  chat_id: number | null
}

export interface Chat {
  id: number
  name: string
  users: ChatUser[]
  last_message: Message | null
  unread_count: number
  /** Замьючен ли чат для текущего пользователя (хранится на сервере). */
  muted?: boolean
  /** Тип чата: true — «зашифрованный» (E2EE), false/нет — «обычный». */
  e2ee_enabled?: boolean
  /** «Сохранённые сообщения» (личный чат с собой; удалить нельзя). */
  is_self?: boolean
  /** Групповой чат (общий для многих участников). */
  is_group?: boolean
  /** Аватар группы (путь /media/...). */
  avatar_url?: string | null
  /** Описание группы. */
  description?: string | null
  /** Количество участников группы. */
  member_count?: number
  /** Роль текущего пользователя: creator / admin / member. */
  my_role?: 'creator' | 'admin' | 'member' | string
  /** Создатель группы. */
  creator_id?: number | null
}

/** Участник чата с ролью (для карточки группы). */
export interface ChatMember extends ChatUser {
  role: 'creator' | 'admin' | 'member' | string
}

/** Карточка чата вместе с участниками и их ролями (GET /chats/{id}/). */
export interface ChatDetail extends Chat {
  members: ChatMember[]
}

export interface CreateGroupRequest {
  name: string
  user_ids: number[]
  description?: string | null
}

export interface GroupInfoUpdate {
  name?: string
  description?: string | null
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
  encrypted?: boolean
  /** kind: 'text' — обычное; 'call' — системная отметка о звонке. */
  kind?: 'text' | 'call'
  call_kind?: 'audio' | 'video'
  call_state?: 'completed' | 'missed' | 'declined'
  call_duration?: number
  call_caller_id?: number
  edited_at: string | null
  file: MessageFile | null
  reactions: ReactionSummary[]
  forwarded_from: ForwardedFrom | null
  /**
   * Скрыто модерацией до разбора (авто после 3 жалоб или решением модератора).
   * Такое сообщение видит только автор — с пометкой «скрыто до проверки»;
   * остальным оно не приходит вовсе (см. api_v1/moderation/service.py).
   */
  hidden?: boolean
  hidden_reason?: string | null
}

export interface CreateMessageRequest {
  text: string
  chat_id: number
  reply_to_id?: number | null
  encrypted?: boolean
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
  avatar_url?: string | null
  status?: string | null
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
