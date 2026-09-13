import type { Chat } from '@/types'

export const unreadCountOfChat = (chats: Chat[], chatId: number): number =>
  chats.find((chat) => chat.id === chatId)?.unread_count ?? 0

export const clearUnreadInChatList = (chats: Chat[], chatId: number): Chat[] => {
  let changed = false
  const next = chats.map((chat) => {
    if (chat.id !== chatId || chat.unread_count === 0) return chat
    changed = true
    return { ...chat, unread_count: 0 }
  })
  return changed ? next : chats
}

export const applyServerChatUnreadPolicy = (
  chats: Chat[],
  options: { openChatId: number | null; reading: boolean }
): Chat[] => {
  const { openChatId, reading } = options
  if (!reading || openChatId === null) return chats
  return clearUnreadInChatList(chats, openChatId)
}

export const totalUnreadCount = (chats: Chat[]): number =>
  chats.reduce((sum, chat) => sum + (chat.unread_count || 0), 0)
