<template>
  <div class="messenger-shell">
    <div class="messenger-body">
      <!-- ======= Левая панель (Чаты / Контакты / поиск людей) ======= -->
      <ChatSidebar
        :view="view"
        :current-user-id="currentUserId"
        :chats="chats"
        :contacts="contacts"
        :selected-chat-id="selectedChatId"
        :loading-chats="loadingChats"
        :contacts-loading="contactsLoading"
        @to-contacts="view = 'contacts'"
        @to-chats="view = 'chats'"
        @open-profile="goToProfile"
        @open-appearance="openAppearance"
        @select-chat="selectChat"
        @chat-opened="onChatOpened"
      />

      <!-- ======= Правая область чата ======= -->
      <main class="chat-panel" :style="chatBgStyle">
        <template v-if="!selectedChat">
          <ChatPlaceholder @open-contacts="view = 'contacts'" />
        </template>

        <template v-else>
          <!-- Шапка чата -->
          <ChatHeader
            :chat="selectedChat"
            :current-user-id="currentUserId"
            :subtitle="chatSubtitle(selectedChat)"
            :status-pill="peerStatus(selectedChat)"
            :show-call-button="isPrivateChat(selectedChat)"
            :self-name="selfName"
            :self-avatar-url="selfAvatarUrl"
            @open-contacts="view = 'contacts'"
            @toggle-search="toggleInlineSearch"
            @open-profile="goToProfile"
            @start-call="startCall"
          />

          <!-- Поиск по сообщениям -->
          <InlineSearchBar
            v-if="inlineSearchOpen"
            v-model:query="inlineQuery"
            :count="serverMatchCount"
            @close="toggleInlineSearch"
          />

          <!-- Закреплённые сообщения -->
          <PinnedBar
            v-if="pinnedRows.length"
            v-model:open="pinnedOpen"
            :rows="pinnedRows"
            @scroll-to="scrollToPinnedMessage"
            @close-popups="closePopups"
          />

          <!-- Сообщения -->
          <div
            ref="messagesContainerRef"
            class="messages-scroll"
            @click="closePopups"
            @scroll.passive="onMessagesScroll"
          >
            <div v-if="messagesLoading" class="chat-status">Загрузка сообщений…</div>
            <template v-else>
              <template
                v-for="(row, index) in messageRows"
                :key="row.kind === 'day' ? 'd' + index : row.message.id"
              >
                <div v-if="row.kind === 'day'" class="day-divider">
                  <span>{{ row.label }}</span>
                </div>
                <MessageRow
                  v-else
                  :message="row.message"
                  :is-own="isOwnMessage(row.message)"
                  :highlighted="highlightedMessageId === row.message.id"
                  :emoji-picker-open="emojiPickerFor === row.message.id"
                  :quote="quoteFor(row.message)"
                  @quote-click="quoteClick"
                  @toggle-emoji-picker="toggleEmojiPicker(row.message.id)"
                  @set-reply="setReply(row.message)"
                  @toggle-reaction="toggleReaction(row.message, $event)"
                  @toggle-pin="togglePinMessage(row.message)"
                  @copy="copyMessage(row.message)"
                  @edit="startEditMessage(row.message)"
                  @forward="openForward(row.message)"
                  @delete="deleteMessageOf(row.message)"
                />
              </template>
              <div v-if="!messageRows.length" class="chat-status">
                Сообщений пока нет. Напишите первым!
              </div>
            </template>
          </div>

          <!-- Панель ввода (композер) -->
          <MessageComposer
            :chat-id="selectedChat.id"
            :chats="chats"
            :current-user-id="currentUserId"
            v-model:new-message="newMessage"
            v-model:forward-chat-id="forwardChatId"
            :sending="sending"
            :send-error="sendError"
            :reply-target="replyTarget"
            :reply-bar-name="replyBarName"
            :editing-message="editingMessage"
            :forward-source="forwardSource"
            :emoji-menu-open="emojiMenuOpen"
            :gif-panel-open="gifPanelOpen"
            :voice-rec-open="voiceRecOpen"
            :record-mode="recordMode"
            :mic-holding="micHolding"
            :record-mode-hint="recordModeHint"
            @send-text="sendText"
            @file-selected="onFileSelected"
            @cancel-edit="cancelEditing"
            @send-forward="sendForward"
            @cancel-forward="cancelForward"
            @clear-reply="clearReply"
            @voice-cancel="onVoiceCancel"
            @voice-send="onVoiceSend"
            @mic-down="onMicDown"
            @mic-up="onMicUp"
            @mic-cancel="onMicCancel"
            @mic-click="onMicClick"
            @toggle-emoji-menu="toggleEmojiMenu"
            @toggle-gif="toggleGifPanel"
            @gif-sent="onGifSent"
            @append-emoji="appendEmoji"
          />
        </template>
      </main>
    </div>
  </div>

  <!-- Profile Modal -->
  <Dialog
    v-model:visible="showProfileModal"
    header="Настройки профиля"
    :modal="true"
    :closable="true"
    :style="{ width: '680px' }"
    @hide="showProfileModal = false"
  >
    <Suspense>
      <template #default>
        <UserProfile @close-modal="showProfileModal = false" />
      </template>
      <template #fallback>
        <div>Загрузка профиля...</div>
      </template>
    </Suspense>
  </Dialog>

  <!-- Appearance Modal -->
  <Dialog
    v-model:visible="showAppearanceModal"
    header="Оформление"
    :modal="true"
    :closable="true"
    :style="{ width: '430px' }"
    @hide="showAppearanceModal = false"
  >
    <AppearanceSettings />
  </Dialog>

  <!-- Login Modal -->
  <LoginModal :visible="showLoginModal" @close-modal="onLoginModalClose" />

  <!-- Звонки -->
  <CallOverlay />

  <!-- Запись видеосообщения -->
  <VideoRecorderModal v-if="videoRecOpen" @close="onVideoCancel" @send="onVideoSend" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import Dialog from 'primevue/dialog'
import LoginModal from '@/components/LoginModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { getErrorMessage } from '@/services/errors'
import {
  fetchContacts,
  fetchMessages,
  fetchMyChats,
  fetchPinnedMessages,
  searchMessages,
  editMessage,
  forwardMessage,
  sendAttachmentMessage,
  sendNewMessage,
  setMessagePinned,
  setMessageReaction,
  removeMessageReaction,
  deleteMessage,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import { avatarUrlOf, displayName } from '@/utils/user'
import { lastSeenLabel } from '@/utils/format'
import { buildMessageRows, type MessageRow as ThreadRow } from '@/utils/thread'
import { messageSnippet } from '@/utils/media'
import { usePeerActivity } from '@/composables/usePeerActivity'
import { useRealtimeSync } from '@/composables/useRealtimeSync'
import { useRecordButton } from '@/composables/useRecordButton'
import UserProfile from './UserProfile.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import CallOverlay from '@/components/calls/CallOverlay.vue'
import ChatSidebar from '@/components/messenger/ChatSidebar.vue'
import ChatHeader from '@/components/messenger/ChatHeader.vue'
import ChatPlaceholder from '@/components/messenger/ChatPlaceholder.vue'
import InlineSearchBar from '@/components/messenger/InlineSearchBar.vue'
import PinnedBar from '@/components/messenger/PinnedBar.vue'
import MessageRow from '@/components/messenger/MessageRow.vue'
import MessageComposer from '@/components/messenger/MessageComposer.vue'
import VideoRecorderModal from '@/components/media/VideoRecorderModal.vue'
import { useCallStore } from '@/stores/call'
import { useRealtimeStore } from '@/stores/realtime'
import { mediaFileName, type RecordedMedia } from '@/services/recorder'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const callStore = useCallStore()
const realtimeStore = useRealtimeStore()

// ---------- Модальные окна ----------
const showProfileModal = ref(false)
const showAppearanceModal = ref(false)
const showLoginModal = ref(true)
const voiceRecOpen = ref(false)
const videoRecOpen = ref(false)

// ---------- Данные ----------
const view = ref<'chats' | 'contacts'>('chats')
const chats = ref<Chat[]>([])
const messages = ref<Message[]>([])
const pinnedMessages = ref<Message[]>([])
const contacts = ref<SearchUserResult[]>([])
const loadingChats = ref(false)
const messagesLoading = ref(false)
const contactsLoading = ref(false)
const selectedChatId = ref<number | null>(null)

const newMessage = ref('')
const sending = ref(false)
const sendingFile = ref(false)
const sendError = ref('')

const replyTarget = ref<Message | null>(null)
const inlineSearchOpen = ref(false)
const inlineQuery = ref('')
const emojiPickerFor = ref<number | null>(null)
const emojiMenuOpen = ref(false)
const gifPanelOpen = ref(false)
const pinnedOpen = ref(true)
const highlightedMessageId = ref<number | null>(null)
let highlightTimer: number | undefined

const messagesContainerRef = ref<HTMLElement | null>(null)

// ---------- Фон окна сообщений (обои берутся из store оформления) ----------
const chatBgStyle = computed(() => ({ background: themeStore.wallpaperCss }))

// ---------- Вычисляемые значения ----------
const currentUserId = computed<number | null>(() => authStore.current_user?.id ?? null)
const selfName = computed<string>(() =>
  authStore.current_user ? displayName(authStore.current_user) : ''
)
const selfAvatarUrl = computed<string | undefined>(() => avatarUrlOf(authStore.current_user))

const selectedChat = computed<Chat | null>(() => {
  if (selectedChatId.value === null) return null
  return chats.value.find((chat) => chat.id === selectedChatId.value) ?? null
})

const messageRows = computed<ThreadRow[]>(() => buildMessageRows(messages.value, inlineQuery.value))

/** Строки закреплённых сообщений для PinnedBar (имя + сниппет уже посчитаны). */
const pinnedRows = computed(() =>
  pinnedMessages.value.map((message) => ({
    id: message.id,
    sender: senderNameOfMessage(message),
    snippet: pinnedSnippet(message)
  }))
)

// ---------- Вспомогательные функции ----------
const otherUserOfChat = (chat: Chat): ChatUser | undefined => {
  if (currentUserId.value !== null) {
    const found = chat.users.find((user) => user.id !== currentUserId.value)
    if (found) return found
  }
  return chat.users[0]
}

/** Находит пользователя по id среди участников чатов или списка контактов. */
const findPeerUser = (
  id: number
):
  | {
      username: string
      first_name?: string | null
      last_name?: string | null
      avatar_url?: string | null
    }
  | undefined => {
  for (const chat of chats.value) {
    const other = otherUserOfChat(chat)
    if (other && other.id === id) return other
  }
  return contacts.value.find((contact) => contact.id === id)
}

const isPrivateChat = (chat: Chat | null): boolean => !!chat && chat.users.length === 2

const isOwnMessage = (message: Message): boolean =>
  currentUserId.value !== null && message.user_id === currentUserId.value

const startVoiceCall = () => {
  const chat = selectedChat.value
  if (!isPrivateChat(chat)) return
  const peer = otherUserOfChat(chat as Chat)
  if (!peer) return
  void callStore.startCall(
    { id: peer.id, name: displayName(peer), avatarUrl: peer.avatar_url ?? null },
    'audio'
  )
}

const startVideoCall = () => {
  const chat = selectedChat.value
  if (!isPrivateChat(chat)) return
  const peer = otherUserOfChat(chat as Chat)
  if (!peer) return
  void callStore.startCall(
    { id: peer.id, name: displayName(peer), avatarUrl: peer.avatar_url ?? null },
    'video'
  )
}

/** Кнопка звонка в шапке чата: клик (без удержания) = звонок выбранного типа. */
const startCall = (kind: 'audio' | 'video') => {
  if (kind === 'video') startVideoCall()
  else startVoiceCall()
}

/** Задаваемый собеседником текст-статус (для шапки личного чата). */
const peerStatus = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  if (!other || !isPrivateChat(chat)) return ''
  return (other.status ?? '').trim()
}

// ---------- Присутствие + индикатор «печатает…» (состояние в composable) ----------
const {
  peerPresence,
  isWithinOnlineWindow,
  applyPresence,
  isPeerTyping,
  markPeerTyping,
  clearPeerTyping,
  clearAll
} = usePeerActivity({
  isMe: (userId) => userId === currentUserId.value
})

/** Подмешивает присутствие из свежего ответа /chats (не перетирая WS-статус). */
const syncPresenceFromChats = (list: Chat[]) => {
  for (const chat of list) {
    const other = otherUserOfChat(chat)
    if (!other) continue
    const known = peerPresence[other.id]
    if (known?.online) continue
    peerPresence[other.id] = {
      online: isWithinOnlineWindow(other.last_seen),
      last_seen: other.last_seen ?? null
    }
  }
}

/** Подпись шапки личного чата: присутствие собеседника. */
const presenceText = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  if (!other) return chat.name
  if (!isPrivateChat(chat)) {
    const parts: string[] = [`@${other.username}`]
    if (other.phone_number) parts.push(other.phone_number)
    return parts.join(' · ')
  }
  const known = peerPresence[other.id]
  if (known?.online) return 'в сети'
  if (known) return known.last_seen ? lastSeenLabel(known.last_seen, false) : 'был(а) давно'
  return lastSeenLabel(other.last_seen) || 'был(а) давно'
}

const chatSubtitle = (chat: Chat): string => {
  if (isPeerTyping(chat.id)) return 'печатает…'
  return presenceText(chat)
}

// ---------- Цитаты (ответы) ----------
const replyMessage = (message: Message): Message | undefined =>
  message.reply_to_id != null
    ? messages.value.find((item) => item.id === message.reply_to_id)
    : undefined

/** Имя в шапке цитаты при ответе в композере (семантика исходного Messenger). */
const quoteName = (message: Message): string => {
  const target = replyMessage(message)
  if (!target) return 'Сообщение'
  return isOwnMessage(target) ? 'Вы' : 'Собеседник'
}

const replyBarName = computed<string>(() => (replyTarget.value ? quoteName(replyTarget.value) : ''))

/** Данные ответа-цитаты для строки сообщения (null — цитата не загружена). */
const quoteFor = (message: Message): { name: string; mine: boolean; text: string } | null => {
  if (message.reply_to_id == null) return null
  const target = replyMessage(message)
  if (!target) return null
  return {
    name: isOwnMessage(target) ? 'Вы' : 'Собеседник',
    mine: isOwnMessage(target),
    text: messageSnippet(target)
  }
}

const quoteClick = () => {
  // Просто закрываем всплывающие меню (без реальной прокрутки здесь).
  emojiPickerFor.value = null
}

const senderNameOfMessage = (message: Message): string => {
  const chat = chats.value.find((item) => item.id === message.chat_id)
  if (!chat) return 'Собеседник'
  const other = otherUserOfChat(chat)
  return other ? displayName(other) : 'Собеседник'
}

const pinnedSnippet = (message: Message): string =>
  `${message.user_id === currentUserId.value ? 'Вы: ' : senderNameOfMessage(message) + ': '}${messageSnippet(message)}`

// ---------- Реакции ----------
const hasMyReaction = (message: Message, emoji: string): boolean =>
  message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)

const toggleEmojiPicker = (messageId: number) => {
  emojiPickerFor.value = emojiPickerFor.value === messageId ? null : messageId
}

const closePopups = () => {
  emojiPickerFor.value = null
  emojiMenuOpen.value = false
  gifPanelOpen.value = false
}

const toggleReaction = async (message: Message, emoji: string) => {
  const mine = hasMyReaction(message, emoji)
  try {
    const updated = mine
      ? await removeMessageReaction(message.id)
      : await setMessageReaction(message.id, emoji)
    emojiPickerFor.value = null
    replaceMessageInThread(updated)
  } catch (error) {
    console.error('Не удалось изменить реакцию:', getErrorMessage(error))
  }
}

// ---------- Загрузка данных ----------
const loadChats = async () => {
  loadingChats.value = true
  try {
    const fresh = await fetchMyChats()
    chats.value = fresh
    syncPresenceFromChats(fresh)
  } catch (error) {
    console.error('Не удалось загрузить чаты:', getErrorMessage(error))
  } finally {
    loadingChats.value = false
  }
}

// ---------- Пагинация истории ----------
const MESSAGES_PAGE_SIZE = 80
const noMoreOlder = ref(false)
const loadingOlder = ref(false)

const isNearBottom = (container: HTMLElement): boolean =>
  container.scrollHeight - container.scrollTop - container.clientHeight < 120

const replaceMessageInThread = (updated: Message) => {
  messages.value = messages.value.map((m) => (m.id === updated.id ? updated : m))
}

const removeMessageFromThread = (messageId: number) => {
  messages.value = messages.value.filter((m) => m.id !== messageId)
}

/** Загружает самую свежую страницу (при открытии чата). */
const loadThreadLatest = async (chatId: number) => {
  messagesLoading.value = true
  noMoreOlder.value = false
  loadingOlder.value = false
  try {
    messages.value = await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
  } catch (error) {
    console.error('Не удалось загрузить сообщения:', getErrorMessage(error))
  } finally {
    messagesLoading.value = false
  }
}

/**
 * Объединяет свежую «последнюю страницу» с уже загруженными старыми
 * сообщениями (не роняет загруженную выше историю) и при новых сообщениях
 * прокручивает вниз, только если пользователь и так внизу.
 */
const mergeThreadLatest = async (chatId: number): Promise<boolean> => {
  const previousIds = new Set(messages.value.map((m) => m.id))
  const fresh = await fetchMessages(chatId, { limit: MESSAGES_PAGE_SIZE })
  const freshIds = new Set(fresh.map((m) => m.id))
  const keptOlder = messages.value.filter((m) => !freshIds.has(m.id))
  messages.value = [...keptOlder, ...fresh].sort((a, b) => a.id - b.id)
  const hasNew = fresh.some((m) => !previousIds.has(m.id))
  const container = messagesContainerRef.value
  if (hasNew && (!container || isNearBottom(container))) {
    await nextTick()
    scrollToBottom()
  }
  return hasNew
}

/** Подгружает более старые сообщения при прокрутке вверх. */
const loadOlderMessages = async () => {
  const chatId = selectedChatId.value
  const container = messagesContainerRef.value
  if (chatId === null || loadingOlder.value || noMoreOlder.value || messages.value.length === 0) {
    return
  }
  const prevScrollHeight = container?.scrollHeight ?? 0
  const prevScrollTop = container?.scrollTop ?? 0
  const oldestId = messages.value.reduce<number | null>(
    (min, m) => (min === null || m.id < min ? m.id : min),
    null
  )
  loadingOlder.value = true
  try {
    const older = await fetchMessages(chatId, {
      limit: MESSAGES_PAGE_SIZE,
      beforeId: oldestId ?? undefined
    })
    const existingIds = new Set(messages.value.map((m) => m.id))
    const toAdd = older.filter((m) => !existingIds.has(m.id))
    if (older.length === 0 || toAdd.length === 0) {
      noMoreOlder.value = true
      return
    }
    messages.value = [...toAdd, ...messages.value].sort((a, b) => a.id - b.id)
    await nextTick()
    if (container) {
      container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight)
    }
  } catch (error) {
    console.error('Не удалось загрузить более старые сообщения:', getErrorMessage(error))
  } finally {
    loadingOlder.value = false
  }
}

const onMessagesScroll = () => {
  const container = messagesContainerRef.value
  if (container && container.scrollTop < 80) {
    void loadOlderMessages()
  }
}

const loadPinned = async (chatId: number) => {
  try {
    pinnedMessages.value = await fetchPinnedMessages(chatId)
  } catch (error) {
    console.error('Не удалось загрузить закреплённые сообщения:', getErrorMessage(error))
  }
}

const loadContacts = async () => {
  contactsLoading.value = true
  try {
    contacts.value = await fetchContacts()
  } catch (error) {
    console.error('Не удалось загрузить контакты:', getErrorMessage(error))
  } finally {
    contactsLoading.value = false
  }
}

const refreshThread = async () => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  await Promise.all([mergeThreadLatest(chatId), loadPinned(chatId), loadChats()])
}

const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
  }
}

// ---------- Выбор / открытие чата ----------
/** Открывает чат: сбрасывает состояние и грузит свежую порцию сообщений. */
const openChatThread = async (chatId: number) => {
  selectedChatId.value = chatId
  sendError.value = ''
  messages.value = []
  pinnedMessages.value = []
  inlineQuery.value = ''
  inlineSearchOpen.value = false
  clearReply()
  await Promise.all([loadThreadLatest(chatId), loadPinned(chatId)])
  scrollToBottom()
}

const selectChat = async (chatId: number) => {
  if (selectedChatId.value === chatId) return
  await openChatThread(chatId)
}

/** Чат открыт из левой панели (find-or-create) — показываем его нить. */
const onChatOpened = async (chat: Chat) => {
  upsertChat(chat)
  view.value = 'chats'
  await openChatThread(chat.id)
}

const upsertChat = (chat: Chat) => {
  const index = chats.value.findIndex((item) => item.id === chat.id)
  if (index === -1) {
    chats.value.unshift(chat)
  } else {
    chats.value[index] = chat
  }
}

// ---------- Отправка ----------
const sendText = async () => {
  const chatId = selectedChatId.value
  const text = newMessage.value.trim()
  if (chatId === null || !text || sending.value) return

  sending.value = true
  sendError.value = ''
  try {
    const editing = editingMessage.value
    if (editing) {
      const updated = await editMessage(editing.id, text)
      newMessage.value = ''
      editingMessage.value = null
      replaceMessageInThread(updated)
      sendTypingStop(chatId)
      await loadPinned(chatId)
      scrollToBottom()
      return
    }

    const message = await sendNewMessage(chatId, text, replyTarget.value?.id)
    newMessage.value = ''
    sendTypingStop(chatId)
    clearReply()
    await refreshThread()
    messages.value = appendMessage(messages.value, message)
    await loadPinned(chatId)
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить сообщение')
  } finally {
    sending.value = false
  }
}

const appendMessage = (list: Message[], message: Message): Message[] => {
  if (list.some((item) => item.id === message.id)) return list
  return [...list, message]
}

const onFileSelected = async (file: File) => {
  const chatId = selectedChatId.value
  if (chatId === null) return

  sendingFile.value = true
  sendError.value = ''
  try {
    const message = await sendAttachmentMessage(
      chatId,
      file,
      newMessage.value.trim(),
      replyTarget.value?.id
    )
    newMessage.value = ''
    clearReply()
    sendTypingStop(chatId)
    messages.value = appendMessage(messages.value, message)
    await loadPinned(chatId)
    await loadChats()
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить файл')
  } finally {
    sendingFile.value = false
  }
}

// ---------- Запись аудио/видеосообщений ----------
const openVoiceRec = () => {
  closePopups()
  voiceRecOpen.value = true
}

const onVoiceCancel = () => {
  voiceRecOpen.value = false
}

const onVoiceSend = async (payload: RecordedMedia) => {
  voiceRecOpen.value = false
  await uploadRecordedMedia(payload, 'voice')
}

const openVideoRec = () => {
  closePopups()
  videoRecOpen.value = true
}

const onVideoCancel = () => {
  videoRecOpen.value = false
  resetRecordMode()
}

const onVideoSend = async (payload: RecordedMedia) => {
  videoRecOpen.value = false
  resetRecordMode()
  await uploadRecordedMedia(payload, 'video')
}

const uploadRecordedMedia = async (payload: RecordedMedia, kind: 'voice' | 'video') => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  sendingFile.value = true
  sendError.value = ''
  try {
    const file = new File([payload.blob], mediaFileName(kind, payload.mime), {
      type: payload.mime
    })
    const message = await sendAttachmentMessage(chatId, file, '', replyTarget.value?.id)
    clearReply()
    sendTypingStop(chatId)
    messages.value = appendMessage(messages.value, message)
    await Promise.all([loadPinned(chatId), loadChats()])
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить медиасообщение')
  } finally {
    sendingFile.value = false
  }
}

// ---------- Одна кнопка аудио/видео (состояние в composable) ----------
const {
  recordMode,
  micHolding,
  recordModeHint,
  onMicDown,
  onMicUp,
  onMicCancel,
  onMicClick,
  resetRecordMode
} = useRecordButton({
  isRecording: () => voiceRecOpen.value || videoRecOpen.value,
  onRecord: (mode) => {
    if (mode === 'video') openVideoRec()
    else openVoiceRec()
  }
})

// ---------- Ответ (reply) ----------
const setReply = (message: Message) => {
  replyTarget.value = message
  emojiPickerFor.value = null
}

const clearReply = () => {
  replyTarget.value = null
}

// ---------- Действия над сообщением ----------
const togglePinMessage = async (message: Message) => {
  try {
    const updated = await setMessagePinned(message.id, !message.is_pinned)
    replaceMessageInThread(updated)
    const chatId = selectedChatId.value
    if (chatId !== null) {
      await loadPinned(chatId)
    }
  } catch (error) {
    console.error('Не удалось изменить закрепление:', getErrorMessage(error))
  }
}

const copyMessage = async (message: Message) => {
  try {
    await navigator.clipboard.writeText(message.text || '')
  } catch (error) {
    console.error('Не удалось скопировать:', getErrorMessage(error))
  }
}

// ---------- Редактирование / пересылка ----------
const editingMessage = ref<Message | null>(null)
const forwardSource = ref<Message | null>(null)
const forwardChatId = ref<number | null>(null)

const startEditMessage = (message: Message) => {
  if (!isOwnMessage(message)) return
  clearReply()
  forwardSource.value = null
  forwardChatId.value = null
  editingMessage.value = message
  newMessage.value = message.text || ''
}

const cancelEditing = () => {
  editingMessage.value = null
  newMessage.value = ''
}

const openForward = (message: Message) => {
  cancelEditing()
  forwardSource.value = message
  forwardChatId.value =
    chats.value.find((chat) => chat.id !== selectedChatId.value)?.id ?? chats.value[0]?.id ?? null
}

const cancelForward = () => {
  forwardSource.value = null
  forwardChatId.value = null
}

const sendForward = async () => {
  const source = forwardSource.value
  const targetChatId = forwardChatId.value
  if (!source || targetChatId === null) return
  try {
    const sent = await forwardMessage(source.id, targetChatId)
    cancelForward()
    sendTypingStop(targetChatId)
    if (selectedChatId.value === targetChatId) {
      messages.value = appendMessage(messages.value, sent)
      await loadPinned(targetChatId)
    } else {
      await loadChats()
    }
  } catch (error) {
    console.error('Не удалось переслать сообщение:', getErrorMessage(error))
  }
}

const deleteMessageOf = async (message: Message) => {
  if (!window.confirm('Удалить это сообщение?')) return
  try {
    await deleteMessage(message.id)
    removeMessageFromThread(message.id)
    const chatId = selectedChatId.value
    if (chatId !== null) {
      await Promise.all([loadPinned(chatId), loadChats()])
    }
  } catch (error) {
    console.error('Не удалось удалить сообщение:', getErrorMessage(error))
  }
}

// ---------- Переход к закреплённому сообщению ----------
const scrollToPinnedMessage = async (messageId: number) => {
  // Если активен поиск по сообщениям — снимаем фильтр, иначе сообщения может не быть в ленте.
  if (inlineSearchOpen.value) {
    inlineSearchOpen.value = false
    inlineQuery.value = ''
  }
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  highlightedMessageId.value = messageId
  await nextTick()
  const container = messagesContainerRef.value
  if (container) {
    const el = container.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
    if (el) {
      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      container.scrollTop +=
        elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2
    }
  }
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = null
  }, 2400)
}

// ---------- Поиск по сообщениям ----------
const toggleInlineSearch = () => {
  inlineSearchOpen.value = !inlineSearchOpen.value
  if (!inlineSearchOpen.value) inlineQuery.value = ''
}

// ---------- Поиск по сообщениям (серверный) ----------
let inlineSearchTimer: number | null = null
const serverMatchCount = ref(0)

const revealMessageInThread = async (messageId: number) => {
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  highlightedMessageId.value = messageId
  await nextTick()
  const container = messagesContainerRef.value
  const el = container
    ? (container.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null)
    : null
  if (container && el) {
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    container.scrollTop +=
      elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2
  }
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = null
  }, 2400)
}

/** Серверный поиск по всей истории + догрузка старых до найденного. */
const runInlineServerSearch = async () => {
  const chatId = selectedChatId.value
  const query = inlineQuery.value.trim()
  if (!query || chatId === null) {
    serverMatchCount.value = 0
    return
  }
  const results = await searchMessages(query, chatId)
  serverMatchCount.value = results.length
  if (results.length === 0) return

  // Результаты приходят по возрастанию: первый — самый старый.
  const oldestNeeded = results[0].id
  const minLoaded = messages.value.length ? Math.min(...messages.value.map((m) => m.id)) : null
  if (minLoaded !== null && minLoaded <= oldestNeeded) {
    await revealMessageInThread(results[results.length - 1].id)
    return
  }
  // Догружаем более старые, пока не накроем самый старый результат.
  for (let i = 0; i < 20 && !noMoreOlder.value; i += 1) {
    await loadOlderMessages()
    const nextMin = messages.value.length ? Math.min(...messages.value.map((m) => m.id)) : null
    if (nextMin !== null && nextMin <= oldestNeeded) break
  }
  const newest = results[results.length - 1]
  if (messages.value.some((m) => m.id === newest.id)) {
    await revealMessageInThread(newest.id)
  }
}

watch(inlineQuery, (value) => {
  if (inlineSearchTimer !== null) {
    window.clearTimeout(inlineSearchTimer)
    inlineSearchTimer = null
  }
  if (!value.trim() || selectedChatId.value === null) {
    serverMatchCount.value = 0
    return
  }
  inlineSearchTimer = window.setTimeout(() => {
    inlineSearchTimer = null
    void runInlineServerSearch().catch((error) => {
      console.error('Не удалось выполнить поиск по сообщениям:', getErrorMessage(error))
    })
  }, 350)
})

// ---------- Эмодзи / GIF в поле ввода ----------
const appendEmoji = (emoji: string) => {
  newMessage.value = `${newMessage.value}${emoji}`
  emojiMenuOpen.value = false
}

const toggleEmojiMenu = () => {
  emojiMenuOpen.value = !emojiMenuOpen.value
  gifPanelOpen.value = false
}

const toggleGifPanel = () => {
  gifPanelOpen.value = !gifPanelOpen.value
  emojiMenuOpen.value = false
}

const onGifSent = async (message: Message) => {
  gifPanelOpen.value = false
  clearReply()
  messages.value = appendMessage(messages.value, message)
  const chatId = selectedChatId.value
  if (chatId !== null) {
    sendTypingStop(chatId)
    await Promise.all([loadPinned(chatId), loadChats()])
    scrollToBottom()
  }
}

// ---------- События реального времени (WS-канал) вместо поллинга ----------
// Сервер пушит события, по которым делаем выборочный refetch. Редкий
// «страховочный» опрос остаётся на случай пропущенных событий/реконнекта.
const refreshChatsQuiet = async () => {
  if (!authStore.isAuthenticated) return
  try {
    const fresh = await fetchMyChats()
    chats.value = fresh
    syncPresenceFromChats(fresh)
  } catch (error) {
    console.error('Не удалось обновить чаты:', getErrorMessage(error))
  }
}

const refreshOpenThreadQuiet = async () => {
  const chatId = selectedChatId.value
  if (chatId === null) return
  try {
    await mergeThreadLatest(chatId)
    const pinned = await fetchPinnedMessages(chatId)
    const pinnedChanged =
      pinned.map((item) => item.id).join(',') !==
      pinnedMessages.value.map((item) => item.id).join(',')
    if (pinnedChanged) pinnedMessages.value = pinned
  } catch (error) {
    console.error('Не удалось обновить сообщения:', getErrorMessage(error))
  }
}

// Оркестрация (таймеры/события) вынесена в composable.
const { start: startRealtime, stop: stopRealtime } = useRealtimeSync({
  isAuthenticated: () => authStore.isAuthenticated,
  isMe: (userId) => userId === currentUserId.value,
  getSelectedChatId: () => selectedChatId.value,
  onPresence: applyPresence,
  onTyping: markPeerTyping,
  onTypingStop: clearPeerTyping,
  onChatsSync: refreshChatsQuiet,
  onThreadSync: refreshOpenThreadQuiet
})

// ---------- Отправка индикатора «печатает…» ----------
const TYPING_SEND_INTERVAL_MS = 3000
let lastTypingSentAt = 0

const sendTypingStop = (chatId: number) => {
  realtimeStore.send({ type: 'typing-stop', chat_id: chatId })
}

// Пока пользователь набирает текст — с троттлингом сообщаем собеседнику.
watch(newMessage, (value) => {
  const chatId = selectedChatId.value
  if (!value.trim() || chatId === null) return
  const now = Date.now()
  if (now - lastTypingSentAt >= TYPING_SEND_INTERVAL_MS) {
    lastTypingSentAt = now
    realtimeStore.send({ type: 'typing', chat_id: chatId })
  }
})

// ---------- Навигация ----------
const goToProfile = () => {
  showProfileModal.value = true
}

const openAppearance = () => {
  showAppearanceModal.value = true
}

const onLoginModalClose = () => {
  console.log('Login modal close event received. Closing modal.')
  showLoginModal.value = false
}

// ---------- Жизненный цикл ----------
const ready = computed(() => authStore.isAuthenticated && currentUserId.value !== null)

watch(
  ready,
  async (isReady) => {
    if (isReady) {
      await Promise.all([loadChats(), loadContacts()])
      startRealtime()
      void callStore.connect()
    } else {
      stopRealtime()
      callStore.disconnect()
      chats.value = []
      messages.value = []
      pinnedMessages.value = []
      contacts.value = []
      selectedChatId.value = null
      clearAll()
    }
  },
  { immediate: true }
)

onMounted(async () => {
  await authStore.initializeApp()
  scrollToBottom()
})

onBeforeUnmount(() => {
  stopRealtime()
  realtimeStore.setHandler(null)
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  if (inlineSearchTimer !== null) {
    window.clearTimeout(inlineSearchTimer)
    inlineSearchTimer = null
  }
})

watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    showLoginModal.value = !isAuthenticated
  },
  { immediate: true }
)

// Обогащаем карточку собеседника (имя/аватар) при звонке из списка чатов/контактов.
watch(
  [() => callStore.status, () => callStore.peerId],
  ([status, peerId]) => {
    if (status === 'idle' || peerId === null) return
    const peer = findPeerUser(peerId)
    if (peer) {
      callStore.setPeerInfo({
        name: displayName(peer),
        avatarUrl: peer.avatar_url ?? null
      })
    }
  },
  { immediate: true }
)

watch(
  selectedChatId,
  (newId, oldId) => {
    if (oldId != null && oldId !== newId) sendTypingStop(oldId)
    closePopups()
    clearReply()
    if (editingMessage.value) cancelEditing()
    if (forwardSource.value) cancelForward()
    voiceRecOpen.value = false
    videoRecOpen.value = false
    resetRecordMode()
    highlightedMessageId.value = null
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer)
      highlightTimer = undefined
    }
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- Каркас ---------- */
.messenger-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #6d7c8c;
  /* Всё «лишнее» (подсказки/кольца анимации) не должно давать полосу прокрутки
     страницы — прокручивается только список сообщений внутри. */
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.messenger-body {
  flex: 1;
  display: flex;
  min-height: 0;
  background: #e7ebf0;
}

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background-image: radial-gradient(
    circle at 1px 1px,
    rgba(120, 144, 156, 0.12) 1px,
    transparent 0
  );
  background-size: 22px 22px;
  background-color: #eef1f4;
}

/* ---------- Сообщения ---------- */
.messages-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
}

.day-divider {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}

.day-divider span {
  background: #ffffff;
  color: #60707c;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.chat-status {
  padding: 12px;
  text-align: center;
  color: #8a98a3;
  font-size: 13.5px;
}
</style>
