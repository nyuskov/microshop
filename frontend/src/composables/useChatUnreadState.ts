import { computed, ref, watch, type Ref } from 'vue'

import type { Chat } from '@/types'
import { setAppBadge } from '@/utils/appBadge'
import {
  applyServerChatUnreadPolicy,
  clearUnreadInChatList,
  totalUnreadCount,
  unreadCountOfChat
} from '@/utils/chatUnread'

const BASE_DOC_TITLE = 'Pismo — мессенджер'

export interface ChatUnreadStateOptions {
  chats: Ref<Chat[]>
  selectedChatId: Ref<number | null>
  isAuthenticated: () => boolean
  fetchMessages: (chatId: number) => Promise<unknown>
  refreshOpenThreadQuiet: () => Promise<void> | void
  syncPresenceFromChats?: (list: Chat[]) => void
  isDocumentHidden?: () => boolean
}

export function useChatUnreadState(options: ChatUnreadStateOptions) {
  const isDocumentHidden = options.isDocumentHidden ?? (() => document.hidden)

  const unreadAtOpen = ref(0)

  const applyChatsFromServer = (list: Chat[]) => {
    const openId = options.selectedChatId.value
    const reading = openId !== null && !isDocumentHidden()
    options.chats.value = applyServerChatUnreadPolicy(list, { openChatId: openId, reading })
    options.syncPresenceFromChats?.(options.chats.value)
  }

  const rememberUnreadAtOpen = (chatId: number) => {
    unreadAtOpen.value = unreadCountOfChat(options.chats.value, chatId)
  }

  const clearUnreadDivider = () => {
    unreadAtOpen.value = 0
  }

  const clearUnreadOfOpenChat = () => {
    const openId = options.selectedChatId.value
    if (openId === null) return
    options.chats.value = clearUnreadInChatList(options.chats.value, openId)
  }

  const clearUnreadForChat = (chatId: number) => {
    options.chats.value = clearUnreadInChatList(options.chats.value, chatId)
  }

  const onChatReadElsewhere = (chatId: number) => {
    clearUnreadForChat(chatId)
  }

  const markChatReadQuietly = async (chatId: number) => {
    if (!options.isAuthenticated()) return
    try {
      // GET истории сам помечает входящие чата прочитанными на сервере.
      await options.fetchMessages(chatId)
    } catch {
      return
    }
    clearUnreadForChat(chatId)
  }

  const handleVisibilityForUnread = () => {
    if (isDocumentHidden()) return
    if (options.selectedChatId.value === null) return
    clearUnreadOfOpenChat()
    void options.refreshOpenThreadQuiet()
  }

  const totalUnread = computed(() => totalUnreadCount(options.chats.value))

  watch(
    totalUnread,
    (count) => {
      document.title = count > 0 ? `(${count}) ${BASE_DOC_TITLE}` : BASE_DOC_TITLE
      void setAppBadge(count)
    },
    { immediate: true }
  )

  return {
    unreadAtOpen,
    totalUnread,
    applyChatsFromServer,
    rememberUnreadAtOpen,
    clearUnreadDivider,
    clearUnreadOfOpenChat,
    onChatReadElsewhere,
    markChatReadQuietly,
    handleVisibilityForUnread
  }
}
