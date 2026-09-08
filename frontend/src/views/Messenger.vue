<template>
  <q-layout class="messenger-shell" view="hhh lpr fff">
    <!-- ======= QDrawer: Чаты / Контакты (десктоп — постоянная панель,
         мобильный — выдвижной drawer поверх чата) ======= -->
    <q-drawer
      v-model="drawerOpen"
      side="left"
      :width="drawerWidth"
      :breakpoint="1023"
      :show-if-above="true"
      :overlay="!isDesktop"
      :no-swipe-open="!isDesktop && selectedChatId !== null"
      bordered
      class="ms-drawer"
    >
      <ChatSidebar
        :view="view"
        :current-user-id="currentUserId"
        :chats="chats"
        :contacts="contacts"
        :selected-chat-id="selectedChatId"
        :loading-chats="loadingChats"
        :contacts-loading="contactsLoading"
        :online-user-ids="onlineUserIds"
        :typing-chat-ids="typingChatIds"
        :pinned-chat-ids="pinnedChatIds"
        :muted-chat-ids="mutedChatIds"
        :drafts="draftsByChatId"
        @open-message="openGlobalMessage"
        @toggle-pin="toggleChatPinned"
        @toggle-mute="toggleChatMuted"
        @delete-chat="openDeleteChatModal"
        @to-contacts="view = 'contacts'"
        @to-chats="view = 'chats'"
        @open-profile="goToProfile"
        @open-appearance="openAppearance"
        @select-chat="selectChat"
        @chat-opened="onChatOpened"
      />
    </q-drawer>

    <!-- ======= Правая область чата ======= -->
    <q-page-container class="messenger-page">
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
            :show-back="!isDesktop"
            :peer-online="selectedChatPeerOnline"
            :pinned="selectedChatPinned"
            @back="goBackToList"
            @toggle-search="toggleInlineSearch"
            @open-profile="goToProfile"
            @open-info="openChatInfo"
            @start-call="startCall"
            @toggle-pin="toggleCurrentChatPin"
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
          <MessageThread
            ref="threadRef"
            :rows="messageRows"
            :loading="messagesLoading"
            :current-user-id="currentUserId"
            :highlighted-message-id="highlightedMessageId"
            :emoji-picker-for="emojiPickerFor"
            :quote-of="quoteFor"
            @background-click="closePopups"
            @reach-top="loadOlderMessages"
            @quote-click="quoteClick"
            @toggle-emoji-picker="onToggleEmojiPicker"
            @set-reply="setReply"
            @toggle-reaction="toggleReaction"
            @toggle-pin="togglePinMessage"
            @copy="copyMessage"
            @edit="startEditMessage"
            @forward="openForward"
            @delete="deleteMessageOf"
            @open-image="openImageFromMessage"
          />

          <!-- Панель ввода (композер) -->
          <MessageComposer
            :chat-id="selectedChat.id"
            v-model:new-message="newMessage"
            :sending="sending"
            :send-error="sendError"
            :reply-target="replyTarget"
            :reply-bar-name="replyBarName"
            :editing-message="editingMessage"
            :emoji-menu-open="emojiMenuOpen"
            :gif-panel-open="gifPanelOpen"
            :voice-rec-open="voiceRecOpen"
            :record-mode="recordMode"
            :mic-holding="micHolding"
            :record-mode-hint="recordModeHint"
            @send-text="sendText"
            @file-selected="onFileSelected"
            @cancel-edit="cancelEditing"
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
    </q-page-container>
  </q-layout>

  <!-- Пересылка сообщения (список чатов) -->
  <ForwardDialog
    v-if="forwardSource"
    :source="forwardSource"
    :chats="chats"
    :current-user-id="currentUserId"
    :current-chat-id="selectedChatId"
    :sending="forwardBusy"
    @close="cancelForward"
    @forward="sendForward"
  />

  <!-- Profile Modal (Quasar) -->
  <q-dialog v-model="showProfileModal" @hide="showProfileModal = false">
    <q-card class="ms-modal ms-modal-profile">
      <q-card-section class="row no-wrap items-center ms-modal-head">
        <div class="text-subtitle1 text-weight-medium ellipsis">Настройки профиля</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="ms-modal-body">
        <Suspense>
          <template #default>
            <UserProfile @close-modal="showProfileModal = false" />
          </template>
          <template #fallback>
            <div class="q-pa-md">Загрузка профиля...</div>
          </template>
        </Suspense>
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- Appearance Modal (Quasar) -->
  <q-dialog v-model="showAppearanceModal" @hide="showAppearanceModal = false">
    <q-card class="ms-modal ms-modal-appearance">
      <q-card-section class="row no-wrap items-center ms-modal-head">
        <div class="text-subtitle1 text-weight-medium ellipsis">Оформление</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="ms-modal-body">
        <AppearanceSettings />
      </q-card-section>
    </q-card>
  </q-dialog>

  <!-- Информация о чате -->
  <q-dialog v-model="showChatInfoModal">
    <template v-if="selectedChat">
      <ChatInfo
        :chat="selectedChat"
        :current-user-id="currentUserId"
        :subtitle="chatSubtitle(selectedChat)"
        :messages="messages"
        @close="showChatInfoModal = false"
        @open-image="openChatInfoImage"
      />
    </template>
  </q-dialog>

  <!-- Удаление чата (для себя / для всех) -->
  <q-dialog v-model="showDeleteChatModal">
    <q-card class="delchat-card">
      <q-card-section class="row no-wrap items-center delchat-head">
        <div class="text-subtitle1 text-weight-medium ellipsis">Удалить чат</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="delchat-body">
        <p class="delchat-text">
          Удалить чат с <b>{{ deleteChatTitle }}</b
          >?
        </p>
        <q-radio v-model="deleteChatScope" val="me" label="Только у меня" />
        <div class="delchat-hint">Чат исчезнет из вашего списка; у собеседника останется.</div>
        <q-radio v-model="deleteChatScope" val="all" label="Для всех" />
        <div class="delchat-hint">Чат и переписка будут удалены у всех участников.</div>
      </q-card-section>
      <q-separator />
      <q-card-actions align="right" class="delchat-actions">
        <q-btn flat label="Отмена" v-close-popup />
        <q-btn flat color="negative" label="Удалить" @click="confirmDeleteChat" />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- Login Modal -->
  <LoginModal :visible="showLoginModal" @close-modal="onLoginModalClose" />

  <!-- Звонки -->
  <CallOverlay />

  <!-- Запись видеосообщения -->
  <VideoRecorderModal v-if="videoRecOpen" @close="onVideoCancel" @send="onVideoSend" />

  <!-- Просмотр изображений (lightbox) -->
  <ImageLightbox
    v-if="lightboxImages.length > 0 && lightboxIndex !== null"
    :images="lightboxImages"
    :index="lightboxIndex"
    @close="closeLightbox"
    @prev="lightboxStep(-1)"
    @next="lightboxStep(1)"
  />
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
  computed,
  defineAsyncComponent
} from 'vue'
import { Notify, useQuasar } from 'quasar'
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
  deleteChat,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import { avatarUrlOf, displayName } from '@/utils/user'
import { lastSeenLabel } from '@/utils/format'
import { buildMessageRows, type MessageRow as ThreadRow } from '@/utils/thread'
import { isImageFile, messageSnippet } from '@/utils/media'
import { mediaUrl } from '@/config'
import { usePeerActivity } from '@/composables/usePeerActivity'
import { useRealtimeSync } from '@/composables/useRealtimeSync'
import { useRecordButton } from '@/composables/useRecordButton'
import ChatSidebar from '@/components/messenger/ChatSidebar.vue'
import ChatHeader from '@/components/messenger/ChatHeader.vue'
import ChatPlaceholder from '@/components/messenger/ChatPlaceholder.vue'
import InlineSearchBar from '@/components/messenger/InlineSearchBar.vue'
import PinnedBar from '@/components/messenger/PinnedBar.vue'
import MessageThread from '@/components/messenger/MessageThread.vue'
import MessageComposer from '@/components/messenger/MessageComposer.vue'

// Тяжёлые модалки/оверлеи подгружаем асинхронно — они нужны только после
// действия пользователя (профиль/оформление/инфо о чате, звонок, лайтбокс,
// видеозапись), это уменьшает стартовый чанк приложения.
const UserProfile = defineAsyncComponent(() => import('./UserProfile.vue'))
const AppearanceSettings = defineAsyncComponent(() => import('./AppearanceSettings.vue'))
const CallOverlay = defineAsyncComponent(() => import('@/components/calls/CallOverlay.vue'))
const ForwardDialog = defineAsyncComponent(() => import('@/components/messenger/ForwardDialog.vue'))
const ChatInfo = defineAsyncComponent(() => import('@/components/messenger/ChatInfo.vue'))
const VideoRecorderModal = defineAsyncComponent(
  () => import('@/components/media/VideoRecorderModal.vue')
)
const ImageLightbox = defineAsyncComponent(() => import('@/components/media/ImageLightbox.vue'))
import { useCallStore } from '@/stores/call'
import { useRealtimeStore } from '@/stores/realtime'
import { mediaFileName, type RecordedMedia } from '@/services/recorder'
import { enablePushNotifications } from '@/services/pwa'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const callStore = useCallStore()
const realtimeStore = useRealtimeStore()

// ---------- Модальные окна ----------
const showProfileModal = ref(false)
const showAppearanceModal = ref(false)
const showChatInfoModal = ref(false)
const showLoginModal = ref(true)
const voiceRecOpen = ref(false)
const videoRecOpen = ref(false)

// ---------- Quasar: адаптивный layout (drawer на мобильном) ----------
const $q = useQuasar()
/** «Десктоп» = ширина окна ≥ 1024px (md и выше). Ниже — мобильный режим. */
const isDesktop = computed(() => $q.screen.gt.sm)
/** Открыт ли drawer со списком чатов (значим в мобильном режиме). */
const drawerOpen = ref(true)
/** Ширина панели чатов: фикс. 380px на десктопе, почти во весь экран на мобильном. */
const drawerWidth = computed(() => (isDesktop.value ? 380 : Math.min($q.screen.width, 460)))

/** На мобильном: «назад» из открытого чата — снова показать список (drawer). */
const goBackToList = () => {
  if (!isDesktop.value) {
    drawerOpen.value = true
  } else {
    view.value = 'contacts'
  }
}

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

/** Ссылка на ленту сообщений (MessageThread) для управления прокруткой. */
const threadRef = ref<InstanceType<typeof MessageThread> | null>(null)

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

// ---------- Закреплённые чаты (пин вверху списка диалогов) ----------
const PINNED_CHATS_KEY = 'microshop_pinned_chats'

const readPinnedChats = (): number[] => {
  const uid = currentUserId.value
  if (uid === null) return []
  try {
    const raw = window.localStorage.getItem(PINNED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    const list = all[String(uid)]
    return Array.isArray(list) ? list.filter((id) => typeof id === 'number') : []
  } catch {
    return []
  }
}

const writePinnedChats = () => {
  const uid = currentUserId.value
  if (uid === null) return
  try {
    const raw = window.localStorage.getItem(PINNED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    all[String(uid)] = pinnedChatIds.value
    window.localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify(all))
  } catch {
    // localStorage недоступен — пин просто не сохранится.
  }
}

const pinnedChatIds = ref<number[]>([])

watch(
  currentUserId,
  () => {
    pinnedChatIds.value = readPinnedChats()
  },
  { immediate: true }
)

const isChatPinned = (chatId: number): boolean => pinnedChatIds.value.includes(chatId)

const toggleChatPinned = (chatId: number) => {
  const next = new Set(pinnedChatIds.value)
  if (next.has(chatId)) {
    next.delete(chatId)
  } else {
    next.add(chatId)
  }
  pinnedChatIds.value = Array.from(next)
  writePinnedChats()
}

/** Закреплён ли открытый чат (состояние кнопки в шапке). */
const selectedChatPinned = computed<boolean>(
  () => selectedChat.value !== null && isChatPinned(selectedChat.value.id)
)

/** Закрепить/открепить открытый чат. */
const toggleCurrentChatPin = () => {
  const chat = selectedChat.value
  if (chat !== null) toggleChatPinned(chat.id)
}

// ---------- Замьюченные чаты (без всплывающих уведомлений) ----------
const MUTED_CHATS_KEY = 'microshop_muted_chats'

const readMutedChats = (): number[] => {
  const uid = currentUserId.value
  if (uid === null) return []
  try {
    const raw = window.localStorage.getItem(MUTED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    const list = all[String(uid)]
    return Array.isArray(list) ? list.filter((id) => typeof id === 'number') : []
  } catch {
    return []
  }
}

const writeMutedChats = () => {
  const uid = currentUserId.value
  if (uid === null) return
  try {
    const raw = window.localStorage.getItem(MUTED_CHATS_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, number[]>) : {}
    all[String(uid)] = mutedChatIds.value
    window.localStorage.setItem(MUTED_CHATS_KEY, JSON.stringify(all))
  } catch {
    // localStorage недоступен — настройка просто не сохранится.
  }
}

const mutedChatIds = ref<number[]>([])

watch(
  currentUserId,
  () => {
    mutedChatIds.value = readMutedChats()
  },
  { immediate: true }
)

const isChatMuted = (chatId: number): boolean => mutedChatIds.value.includes(chatId)

const toggleChatMuted = (chatId: number) => {
  const next = new Set(mutedChatIds.value)
  if (next.has(chatId)) {
    next.delete(chatId)
  } else {
    next.add(chatId)
  }
  mutedChatIds.value = Array.from(next)
  writeMutedChats()
}

// ---------- Просмотр изображений (lightbox) ----------
const lightboxImages = computed(() =>
  messages.value
    .filter((m) => m.file !== null && isImageFile(m.file))
    .map((m) => ({
      id: m.id,
      url: mediaUrl(m.file!.url),
      name: m.file!.name || 'Изображение'
    }))
)
const lightboxIndex = ref<number | null>(null)

const openImageFromMessage = (message: Message) => {
  if (lightboxImages.value.length === 0) return
  const idx = lightboxImages.value.findIndex((item) => item.id === message.id)
  lightboxIndex.value = idx >= 0 ? idx : 0
}

const closeLightbox = () => {
  lightboxIndex.value = null
}

const lightboxStep = (delta: number) => {
  if (lightboxIndex.value === null || lightboxImages.value.length === 0) return
  const length = lightboxImages.value.length
  lightboxIndex.value = (lightboxIndex.value + delta + length) % length
}

// ---------- Информация о чате ----------
const openChatInfo = () => {
  showChatInfoModal.value = true
}

/** Открыть изображение из «Информации о чате» в лайтбоксе. */
const openChatInfoImage = (messageId: number) => {
  const message = messages.value.find((m) => m.id === messageId)
  if (message) openImageFromMessage(message)
}

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
  peerTypingUntil,
  isWithinOnlineWindow,
  applyPresence,
  isPeerTyping,
  markPeerTyping,
  clearPeerTyping,
  clearAll
} = usePeerActivity({
  isMe: (userId) => userId === currentUserId.value
})

/** id пользователей, которые сейчас «в сети» (для индикатора на аватарах). */
const onlineUserIds = computed<number[]>(() =>
  Object.entries(peerPresence)
    .filter(([, state]) => state.online)
    .map(([userId]) => Number(userId))
)

/** id чатов, где собеседник сейчас «печатает…» (для списка диалогов). */
const typingChatIds = computed<number[]>(() =>
  Object.keys(peerTypingUntil)
    .filter((chatId) => isPeerTyping(Number(chatId)))
    .map((chatId) => Number(chatId))
)

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

/** «В сети» ли собеседник открытого личного чата (точка на аватаре в шапке). */
const selectedChatPeerOnline = computed<boolean>(() => {
  const chat = selectedChat.value
  if (!chat || chat.users.length !== 2) return false
  const peer = otherUserOfChat(chat)
  return peer !== undefined && onlineUserIds.value.includes(peer.id)
})

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

/** Клик по цитате-ответу: закрыть меню и перейти к исходному сообщению. */
const quoteClick = (message: Message) => {
  emojiPickerFor.value = null
  const targetId = message.reply_to_id
  if (targetId == null) return
  // Исходное сообщение может быть не загружено — тогда ничего не делаем.
  if (!messages.value.some((item) => item.id === targetId)) return
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer)
    highlightTimer = undefined
  }
  highlightedMessageId.value = targetId
  void nextTick(() => {
    threadRef.value?.reveal(targetId)
    highlightTimer = window.setTimeout(() => {
      highlightedMessageId.value = null
    }, 2400)
  })
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

/** Обработчик «выбор реакций» от строки ленты (лента отдаёт сообщение). */
const onToggleEmojiPicker = (message: Message) => {
  toggleEmojiPicker(message.id)
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
  if (hasNew && (!threadRef.value || threadRef.value.isNearBottom())) {
    await nextTick()
    scrollToBottom()
  }
  return hasNew
}

/** Подгружает более старые сообщения при прокрутке вверх (вызывается лентой). */
const loadOlderMessages = async () => {
  const chatId = selectedChatId.value
  if (chatId === null || loadingOlder.value || noMoreOlder.value || messages.value.length === 0) {
    return
  }
  const saved = threadRef.value?.capture()
  const prevScrollHeight = saved?.height ?? 0
  const prevScrollTop = saved?.top ?? 0
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
    threadRef.value?.restoreScroll(prevScrollTop, prevScrollHeight)
  } catch (error) {
    console.error('Не удалось загрузить более старые сообщения:', getErrorMessage(error))
  } finally {
    loadingOlder.value = false
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
  threadRef.value?.scrollToBottom()
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
  closeLightbox()
  showChatInfoModal.value = false
  await Promise.all([loadThreadLatest(chatId), loadPinned(chatId)])
  // Ждём отрисовки сообщений, иначе scrollTop посчитается по пустой ленте
  // и чат откроется не внизу (поле ввода и свежие сообщения окажутся ниже).
  await nextTick()
  scrollToBottom()
  // Мобильный режим: выбор чата закрывает drawer — нить на весь экран.
  if (!isDesktop.value) drawerOpen.value = false
}

const selectChat = async (chatId: number) => {
  if (selectedChatId.value === chatId) {
    // Мобильный: повторный выбор активного чата из списка снова открывает нить.
    if (!isDesktop.value) drawerOpen.value = false
    return
  }
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
      clearDraftFor(chatId)
      editingMessage.value = null
      replaceMessageInThread(updated)
      sendTypingStop(chatId)
      await loadPinned(chatId)
      scrollToBottom()
      return
    }

    const message = await sendNewMessage(chatId, text, replyTarget.value?.id)
    newMessage.value = ''
    clearDraftFor(chatId)
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
    clearDraftFor(chatId)
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
/** Пересылаемое сообщение; пока не null — открыт диалог выбора чатов. */
const forwardSource = ref<Message | null>(null)
/** Идёт ли отправка пересылок (блокирует кнопки диалога). */
const forwardBusy = ref(false)

// ---------- Черновики сообщений (автосохранение текста при смене чата) ----------
// Ключ `userId:chatId` — черновики не «перетекают» между аккаунтами устройства.
const DRAFTS_KEY = 'microshop_drafts'
/** Момент последней программной установки текста поля (гасит «печатает…»). */
let lastComposerProgrammaticEdit = 0

const readDrafts = (): Record<string, string> => {
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const writeDrafts = (drafts: Record<string, string>) => {
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // Приватный режим/переполнение — черновик просто не сохранится.
  }
}

/** Черновики текущего пользователя по id чата (для превью в списке диалогов). */
const draftsByChatId = reactive<Record<number, string>>({})

/** Загружает черновики пользователя из localStorage в реактивную карту. */
const syncDraftsFromStorage = (uid: number | null) => {
  for (const key of Object.keys(draftsByChatId)) {
    delete draftsByChatId[Number(key)]
  }
  if (uid === null) return
  const all = readDrafts()
  const prefix = `${uid}:`
  for (const [key, text] of Object.entries(all)) {
    if (key.startsWith(prefix) && text.trim()) {
      const chatId = Number(key.slice(prefix.length))
      if (Number.isFinite(chatId)) draftsByChatId[chatId] = text
    }
  }
}

watch(currentUserId, () => syncDraftsFromStorage(currentUserId.value), {
  immediate: true
})

const draftStorageKey = (chatId: number | null): string | null => {
  const uid = currentUserId.value
  if (uid === null || chatId === null) return null
  return `${uid}:${chatId}`
}

/** Сохраняет набранный текст в черновик чата (в режиме правки не трогаем). */
const saveDraftFor = (chatId: number | null) => {
  const key = draftStorageKey(chatId)
  if (key === null || editingMessage.value !== null) return
  const text = newMessage.value
  const drafts = readDrafts()
  if (text.trim()) {
    drafts[key] = text
    if (chatId !== null) draftsByChatId[chatId] = text
  } else {
    delete drafts[key]
    if (chatId !== null) delete draftsByChatId[chatId]
  }
  writeDrafts(drafts)
}

/** Черновик чата (пустая строка, если его нет). */
const loadDraftFor = (chatId: number | null): string => {
  const key = draftStorageKey(chatId)
  if (key === null) return ''
  return readDrafts()[key] ?? ''
}

/** Удаляет черновик чата (после фактической отправки). */
const clearDraftFor = (chatId: number | null) => {
  const key = draftStorageKey(chatId)
  if (key === null) return
  const drafts = readDrafts()
  if (key in drafts) {
    delete drafts[key]
    writeDrafts(drafts)
  }
  if (chatId !== null) delete draftsByChatId[chatId]
}

/** Программно ставит текст поля — не считается «набором текста» для собеседника. */
const setComposerText = (text: string) => {
  lastComposerProgrammaticEdit = Date.now()
  newMessage.value = text
}

/** Сохраняет черновик текущего чата (вызывается при перезагрузке/закрытии). */
const handleBeforeUnload = () => {
  saveDraftFor(selectedChatId.value)
}

/** Название чата для модалки удаления. */
const chatDeleteLabel = (chat: Chat): string => {
  const peer = otherUserOfChat(chat)
  return chat.users.length === 2 && peer ? displayName(peer) : chat.name
}

// ---------- Модалка «Удалить чат» (для себя / для всех) ----------
const showDeleteChatModal = ref(false)
const deleteChatTarget = ref<Chat | null>(null)
const deleteChatScope = ref<'me' | 'all'>('me')

const deleteChatTitle = computed<string>(() =>
  deleteChatTarget.value ? chatDeleteLabel(deleteChatTarget.value) : ''
)

/** Открывает модалку удаления (вместо window.confirm). */
const openDeleteChatModal = (chat: Chat) => {
  deleteChatTarget.value = chat
  deleteChatScope.value = 'me'
  showDeleteChatModal.value = true
}

/** Подтверждение из модалки: удалить «только у меня» или «для всех». */
const confirmDeleteChat = async () => {
  const chat = deleteChatTarget.value
  if (!chat) return
  showDeleteChatModal.value = false
  deleteChatTarget.value = null
  try {
    await deleteChat(chat.id, deleteChatScope.value === 'all')
    chats.value = chats.value.filter((item) => item.id !== chat.id)
    clearDraftFor(chat.id)
    if (pinnedChatIds.value.includes(chat.id)) toggleChatPinned(chat.id)
    if (isChatMuted(chat.id)) toggleChatMuted(chat.id)
    if (selectedChatId.value === chat.id) {
      selectedChatId.value = null
      messages.value = []
      pinnedMessages.value = []
      highlightedMessageId.value = null
      closeLightbox()
      showChatInfoModal.value = false
    }
  } catch (error) {
    console.error('Не удалось удалить чат:', getErrorMessage(error))
  }
}

const startEditMessage = (message: Message) => {
  if (!isOwnMessage(message)) return
  clearReply()
  cancelForward()
  // Набранный текст не теряем: перед входом в режим правки убираем его в черновик.
  if (selectedChatId.value !== null && newMessage.value.trim()) {
    saveDraftFor(selectedChatId.value)
  }
  editingMessage.value = message
  setComposerText(message.text || '')
}

const cancelEditing = () => {
  editingMessage.value = null
  newMessage.value = ''
}

/** Открывает диалог «Переслать»: пользователь сам выбирает чаты списком. */
const openForward = (message: Message) => {
  cancelEditing()
  closePopups()
  forwardSource.value = message
}

const cancelForward = () => {
  forwardSource.value = null
  forwardBusy.value = false
}

/** Пересылает сообщение в выбранные чаты (по одному запросу на чат). */
const sendForward = async (chatIds: number[]) => {
  const source = forwardSource.value
  if (!source || chatIds.length === 0) return
  forwardBusy.value = true
  try {
    for (const targetChatId of chatIds) {
      const sent = await forwardMessage(source.id, targetChatId)
      sendTypingStop(targetChatId)
      if (selectedChatId.value === targetChatId) {
        messages.value = appendMessage(messages.value, sent)
        await loadPinned(targetChatId)
      }
    }
    // Обновляем список: пересланные чаты поднимутся наверх с новым превью.
    await loadChats()
    cancelForward()
  } catch (error) {
    console.error('Не удалось переслать сообщение:', getErrorMessage(error))
    cancelForward()
  } finally {
    forwardBusy.value = false
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
  threadRef.value?.reveal(messageId)
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
  threadRef.value?.reveal(messageId)
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = null
  }, 2400)
}

/** Глобальный поиск: открыть чат и перейти (с подсветкой) к найденному сообщению. */
const openGlobalMessage = async (chatId: number, messageId: number) => {
  await openChatThread(chatId)
  // Если сообщения нет в загруженной порции — догружаем более старые.
  if (!messages.value.some((m) => m.id === messageId)) {
    for (let i = 0; i < 40 && !noMoreOlder.value; i += 1) {
      await loadOlderMessages()
      if (messages.value.some((m) => m.id === messageId)) break
    }
  }
  await revealMessageInThread(messageId)
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

// GIF создаётся фоновым воркером (бэкенд отвечает 202), а свои message.new
// сервер не пушит — поэтому отправитель коротко опрашивает тред, пока GIF не
// появится (потом вступает обычный fallback-опрос 20 с).
const GIF_POLL_INTERVAL_MS = 1000
const GIF_POLL_MAX_ATTEMPTS = 15

const onGifSent = () => {
  // Задача поставлена в очередь (202): сообщение пока не создано — не добавляем
  // в ленту «пустышку». Воркер скачает GIF и создаст сообщение; здесь лишь
  // закрываем панель, сбрасываем ответ/печать и коротко ждём появления GIF.
  gifPanelOpen.value = false
  clearReply()
  const chatId = selectedChatId.value
  if (chatId === null) return
  sendTypingStop(chatId)

  const beforeMaxId = messages.value.reduce((max, m) => Math.max(max, m.id), 0)
  let attempts = 0
  const pollForGif = async () => {
    if (chatId !== selectedChatId.value) return
    attempts += 1
    try {
      await mergeThreadLatest(chatId)
    } catch {
      // одиночный сбой опроса не критичен — попробуем ещё раз
    }
    const currentMaxId = messages.value.reduce((max, m) => Math.max(max, m.id), 0)
    if (currentMaxId <= beforeMaxId && attempts < GIF_POLL_MAX_ATTEMPTS) {
      window.setTimeout(() => void pollForGif(), GIF_POLL_INTERVAL_MS)
    }
  }
  window.setTimeout(() => void pollForGif(), GIF_POLL_INTERVAL_MS)
  void loadPinned(chatId)
  void loadChats()
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
// ---------- Уведомления о новых сообщениях + счётчик в заголовке вкладки ----------
const BASE_DOC_TITLE = 'Microshop — мессенджер'

const totalUnread = computed(() =>
  chats.value.reduce((sum, chat) => sum + (chat.unread_count || 0), 0)
)

watch(
  totalUnread,
  (count) => {
    document.title = count > 0 ? `(${count}) ${BASE_DOC_TITLE}` : BASE_DOC_TITLE
  },
  { immediate: true }
)

// Дедупликация уведомлений по чату.
const lastNotifyAt: Record<number, number> = {}
const NOTIFY_DEDUPE_MS = 3500

const notifyNewMessage = (chatId: number) => {
  // Замьюченные чаты не показывают всплывающие уведомления (бейдж остаётся).
  if (isChatMuted(chatId)) return
  const now = Date.now()
  if (now - (lastNotifyAt[chatId] ?? 0) < NOTIFY_DEDUPE_MS) return
  // Показываем, только если чат не открыт или вкладка свёрнута.
  if (!document.hidden && selectedChatId.value === chatId) return
  lastNotifyAt[chatId] = now
  // Ждём обновления списка чатов — появится last_message с текстом.
  window.setTimeout(() => {
    const chat = chats.value.find((item) => item.id === chatId)
    if (!chat) return
    const sender = otherUserOfChat(chat)
    const title = sender ? displayName(sender) : chat.name
    const text = chat.last_message ? messageSnippet(chat.last_message) : 'Новое сообщение'
    Notify.create({
      type: 'info',
      caption: title,
      message: text,
      position: 'top-right',
      timeout: 4000,
      actions: [
        {
          label: 'Открыть',
          color: 'white',
          handler: () => {
            void openChatThread(chatId)
          }
        },
        { icon: 'close', color: 'white', round: true, dense: true }
      ]
    })
  }, 350)
}

const { start: startRealtime, stop: stopRealtime } = useRealtimeSync({
  isAuthenticated: () => authStore.isAuthenticated,
  isMe: (userId) => userId === currentUserId.value,
  getSelectedChatId: () => selectedChatId.value,
  onPresence: applyPresence,
  onTyping: markPeerTyping,
  onTypingStop: clearPeerTyping,
  onChatsSync: refreshChatsQuiet,
  onThreadSync: refreshOpenThreadQuiet,
  onMessageNew: notifyNewMessage
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
  // Программная установка (восстановление черновика/правка) не шлёт «печатает…».
  if (Date.now() - lastComposerProgrammaticEdit < 500) return
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
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('message', handleWindowMessage)
  scrollToBottom()

  // Web Push (PWA): после входа один раз запрашиваем разрешение/подписку.
  if (authStore.isAuthenticated) {
    void enablePushNotifications()
  }

  // Холодный старт по уведомлению: открыли через /?chat=<id>.
  const chatParam = new URLSearchParams(window.location.search).get('chat')
  if (chatParam && /^\d+$/.test(chatParam)) {
    void openChatFromPush(Number(chatParam))
  }
})

/** Открывает чат по push-уведомлению (данные приходят из service worker). */
const openChatFromPush = async (chatId: number) => {
  if (!authStore.isAuthenticated) return
  if (!chats.value.some((c) => c.id === chatId)) {
    try {
      chats.value = await fetchMyChats()
    } catch {
      return
    }
  }
  await openChatThread(chatId)
  if (!isDesktop.value) drawerOpen.value = false
}

/** Слушаем сообщения от service worker (клик по уведомлению). */
const handleWindowMessage = (event: MessageEvent) => {
  const data = event.data as { type?: string; chat_id?: number } | null
  if (!data || data.type !== 'open-chat' || typeof data.chat_id !== 'number') return
  void openChatFromPush(data.chat_id)
}

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('message', handleWindowMessage)
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
    if (oldId != null && oldId !== newId) {
      sendTypingStop(oldId)
      saveDraftFor(oldId)
    }
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
    // Восстанавливаем черновик открытого чата (после сброса состояния выше).
    if (newId !== null) setComposerText(loadDraftFor(newId))
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- Каркас (Quasar QLayout) ---------- */
.messenger-shell {
  height: 100vh;
  height: 100dvh; /* на мобильных браузерах с динамической адресной строкой */
  overflow: hidden;
  background: #6d7c8c;
  font-family: var(--ms-font);
}

/* QPageContainer: в нём только чат, растягиваем на всю высоту. */
.messenger-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
}

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden; /* не даём контенту распирать панель и создавать скролл страницы */
  background-image: radial-gradient(
    circle at 1px 1px,
    rgba(120, 144, 156, 0.12) 1px,
    transparent 0
  );
  background-size: 22px 22px;
  background-color: #eef1f4;
}

/* Drawer со списком чатов: тень и высота на весь экран. */
.ms-drawer :deep(.q-drawer__content) {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ---------- Quasar-модалки (профиль / оформление): карточки с рамкой ---------- */
.ms-modal {
  width: min(720px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  border-radius: var(--ms-radius-lg, 18px);
  border: 1px solid var(--ms-border, #e2e6ea);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
}

.ms-modal-appearance {
  width: min(560px, calc(100vw - 32px));
}

/* Профиль — всегда «светлый лист» (как форма входа): внутри только светлые
   карточки/поля (UserProfile), поэтому и сама карточка принудительно светлая,
   чтобы в тёмной теме диалог был цельным, а в светлой — без изменений. */
.ms-modal-profile {
  background: #ffffff !important;
  color: #1c2733 !important;
  border-color: #e2e6ea !important;
}

.ms-modal-profile :deep(.q-separator) {
  background: #eef1f3;
}

.ms-modal-head {
  padding: 8px 8px 8px 20px;
  min-height: 52px;
}

/* Внутренние отступы контента от краёв карточки */
.ms-modal-body {
  padding: 8px 22px 24px;
  max-height: 82vh;
  overflow: auto;
}

/* ---------- Модалка удаления чата ---------- */
.delchat-card {
  width: min(400px, calc(100vw - 32px));
  border-radius: var(--ms-radius-lg, 18px);
}

.delchat-head {
  padding: 8px 8px 8px 20px;
}

.delchat-body {
  padding: 6px 20px 10px;
}

.delchat-text {
  margin: 8px 0 10px;
  font-size: 14.5px;
}

.delchat-hint {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  margin: -2px 0 8px 30px;
}

.delchat-actions {
  padding: 8px 12px;
}
</style>
