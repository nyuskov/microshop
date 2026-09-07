/** Утилиты отображения имени пользователя и аватара (градиент). */

import { mediaUrl } from '@/config'
import type { Chat, ChatUser } from '@/types'

export const fullName = (
  first: string | null | undefined,
  last: string | null | undefined,
  username: string
): string => {
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  return username
}

export const displayName = (user: {
  first_name?: string | null
  last_name?: string | null
  username: string
}): string => fullName(user.first_name, user.last_name, user.username)

export const initials = (value: string): string => {
  const clean = value.trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#5b9bd5,#2e75b6)',
  'linear-gradient(135deg,#69b578,#2f8f5b)',
  'linear-gradient(135deg,#e58e7a,#c25e4a)',
  'linear-gradient(135deg,#b28ce0,#7c53b8)',
  'linear-gradient(135deg,#f0a35e,#d97b2b)',
  'linear-gradient(135deg,#6fc3c9,#2f9aa3)'
]

export const avatarStyle = (name: string): Record<string, string> => {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }
}

/** Абсолютный URL аватара пользователя (если он задан). */
export const avatarUrlOf = (
  user: { avatar_url?: string | null } | null | undefined
): string | undefined => (user?.avatar_url ? mediaUrl(user.avatar_url) : undefined)

/** Второй участник личного чата (не текущий пользователь). */
export const chatPeer = (chat: Chat, currentUserId: number | null): ChatUser | undefined => {
  if (currentUserId !== null) {
    const found = chat.users.find((user) => user.id !== currentUserId)
    if (found) return found
  }
  return chat.users[0]
}

/** Отображаемое название чата (для личных чатов — имя собеседника). */
export const chatPeerTitle = (chat: Chat, currentUserId: number | null): string => {
  const peer = chatPeer(chat, currentUserId)
  return peer ? displayName(peer) : chat.name
}

/** Личный чат ровно с двумя участниками. */
export const isPrivateChat = (chat: Chat): boolean => chat.users.length === 2
