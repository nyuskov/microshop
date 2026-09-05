<template>
  <div class="messenger-shell">
    <div class="messenger-body">
      <!-- ======= Левая панель ======= -->
      <aside class="side-panel">
        <!-- Диалоги -->
        <template v-if="view === 'chats'">
          <div class="panel-header">
            <div class="panel-header-left">
              <button class="icon-btn" title="Контакты" @click="view = 'contacts'">
                <i class="pi pi-user-plus"></i>
              </button>
              <button class="icon-btn" title="Профиль" @click="goToProfile">
                <i class="pi pi-user"></i>
              </button>
            </div>
            <h2 class="panel-title">Чаты</h2>
            <div class="panel-header-right">
              <button class="icon-btn" title="Новое сообщение" @click="focusSearch">
                <i class="pi pi-pencil"></i>
              </button>
            </div>
          </div>

          <div class="panel-search">
            <i class="pi pi-search search-icon"></i>
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              class="panel-search-input"
              type="text"
              placeholder="Поиск"
            />
          </div>

          <div v-if="searchError" class="inline-error">{{ searchError }}</div>

          <!-- Результаты поиска людей -->
          <div v-if="searchQuery.trim()" class="people-results">
            <div v-if="searching" class="search-status">Поиск…</div>
            <template v-else-if="userResults.length">
              <div class="section-label">Найти людей</div>
              <button
                v-for="user in userResults"
                :key="user.id"
                class="row-item"
                @click="startChat(user)"
              >
                <span class="avatar" :style="avatarStyle(displayName(user))">
                  <img v-if="avatarSrc(user)" :src="avatarSrc(user)" class="avatar-img" alt="" />
                  <template v-else>{{ initials(displayName(user)) }}</template>
                </span>
                <span class="row-text">
                  <span class="row-title">{{ displayName(user) }}</span>
                  <span class="row-sub"
                    >@{{ user.username
                    }}<template v-if="user.phone_number"> · {{ user.phone_number }}</template></span
                  >
                </span>
                <i class="pi pi-comment row-arrow"></i>
              </button>
            </template>
            <div v-else class="search-status">Никого не найдено</div>
          </div>

          <div v-if="loadingChats" class="search-status">Загрузка…</div>

          <!-- Недавние диалоги -->
          <template v-else>
            <div class="section-label">Недавние</div>
            <div v-if="!filteredChats.length" class="empty-hint">
              Найдите пользователя по логину или телефону и начните переписку
            </div>
            <div class="chat-scroll">
              <button
                v-for="chat in filteredChats"
                :key="chat.id"
                class="row-item"
                :class="{ active: selectedChatId === chat.id }"
                @click="selectChat(chat.id)"
              >
                <span class="avatar" :style="avatarStyle(chatTitle(chat))">
                  <img
                    v-if="avatarSrc(otherUserOfChat(chat))"
                    :src="avatarSrc(otherUserOfChat(chat))"
                    class="avatar-img"
                    alt=""
                  />
                  <template v-else>{{ initials(chatTitle(chat)) }}</template>
                </span>
                <span class="row-text">
                  <span class="row-line">
                    <span class="row-title">{{ chatTitle(chat) }}</span>
                    <span class="row-time">
                      {{ chat.last_message ? formatChatTime(chat.last_message.timestamp) : '' }}
                    </span>
                  </span>
                  <span class="row-line">
                    <span class="row-sub preview">
                      <i v-if="lastMessageIsOut(chat)" class="pi pi-check tick"></i>
                      {{ previewText(chat) }}
                    </span>
                    <span v-if="chat.unread_count > 0" class="unread-badge">
                      {{ chat.unread_count }}
                    </span>
                  </span>
                </span>
              </button>
            </div>
          </template>
        </template>

        <!-- Контакты -->
        <template v-else>
          <div class="panel-header">
            <div class="panel-header-left">
              <button class="icon-btn" title="Назад к чатам" @click="view = 'chats'">
                <i class="pi pi-arrow-left"></i>
              </button>
            </div>
            <h2 class="panel-title">Контакты</h2>
            <div class="panel-header-right"></div>
          </div>

          <div class="panel-search">
            <i class="pi pi-search search-icon"></i>
            <input
              v-model="contactsQuery"
              class="panel-search-input"
              type="text"
              placeholder="Поиск по логину или телефону"
            />
          </div>

          <div v-if="contactsLoading" class="search-status">Загрузка…</div>
          <div v-else-if="!filteredContacts.length" class="empty-hint">Контакты не найдены</div>
          <div v-else class="chat-scroll">
            <button
              v-for="contact in filteredContacts"
              :key="contact.id"
              class="row-item"
              @click="openChatWithContact(contact)"
            >
              <span class="avatar" :style="avatarStyle(displayName(contact))">
                <img
                  v-if="avatarSrc(contact)"
                  :src="avatarSrc(contact)"
                  class="avatar-img"
                  alt=""
                />
                <template v-else>{{ initials(displayName(contact)) }}</template>
              </span>
              <span class="row-text">
                <span class="row-title">{{ displayName(contact) }}</span>
                <span class="row-sub"
                  >@{{ contact.username
                  }}<template v-if="contact.phone_number">
                    · {{ contact.phone_number }}</template
                  ></span
                >
              </span>
              <i class="pi pi-comment row-arrow"></i>
            </button>
          </div>
        </template>
      </aside>

      <!-- ======= Правая область чата ======= -->
      <main class="chat-panel">
        <template v-if="!selectedChat">
          <div class="chat-placeholder">
            <i class="pi pi-comments placeholder-icon"></i>
            <h3>Выберите, кому хотели бы написать</h3>
            <p>Начните переписку: найдите собеседника по логину или телефону.</p>
            <button class="ghost-btn" @click="view = 'contacts'">Открыть контакты</button>
          </div>
        </template>

        <template v-else>
          <!-- Шапка чата -->
          <div class="chat-header">
            <button class="icon-btn back-btn" title="Контакты" @click="view = 'contacts'">
              <i class="pi pi-arrow-left"></i>
            </button>
            <span class="avatar chat-avatar" :style="avatarStyle(chatTitle(selectedChat))">
              <img
                v-if="avatarSrc(otherUserOfChat(selectedChat))"
                :src="avatarSrc(otherUserOfChat(selectedChat))"
                class="avatar-img"
                alt=""
              />
              <template v-else>{{ initials(chatTitle(selectedChat)) }}</template>
            </span>
            <div class="chat-header-info">
              <div class="chat-title">{{ chatTitle(selectedChat) }}</div>
              <div class="chat-subtitle">{{ chatSubtitle(selectedChat) }}</div>
            </div>
            <div class="chat-header-actions">
              <button class="icon-btn" title="Поиск по сообщениям" @click="toggleInlineSearch">
                <i class="pi pi-search"></i>
              </button>
              <button class="icon-btn" title="Профиль" @click="goToProfile">
                <span class="avatar mini" :style="avatarStyle(selfName)">
                  <img
                    v-if="avatarSrc(authStore.current_user)"
                    :src="avatarSrc(authStore.current_user)"
                    class="avatar-img"
                    alt=""
                  />
                  <template v-else>{{ selfInitial }}</template>
                </span>
              </button>
            </div>
          </div>

          <!-- Поиск по сообщениям -->
          <div v-if="inlineSearchOpen" class="inline-search">
            <i class="pi pi-search search-icon"></i>
            <input
              v-model="inlineQuery"
              class="inline-search-input"
              type="text"
              placeholder="Поиск по сообщениям"
            />
            <button class="icon-btn" @click="toggleInlineSearch">
              <i class="pi pi-times"></i>
            </button>
          </div>

          <!-- Закреплённые сообщения -->
          <div v-if="pinnedMessages.length" class="pinned-bar" @click="closePopups">
            <i class="pi pi-bookmark pinned-icon"></i>
            <div class="pinned-content">
              <div class="pinned-head">
                <span>Закреплённые сообщения</span>
                <span class="pinned-count">{{ pinnedMessages.length }}</span>
              </div>
              <div v-if="pinnedOpen" class="pinned-list">
                <div v-for="message in pinnedMessages" :key="message.id" class="pinned-item">
                  <span class="pinned-sender">{{ senderName(message) }}</span>
                  {{ pinnedSnippet(message) }}
                </div>
              </div>
            </div>
            <button class="icon-btn" title="Развернуть" @click.stop="pinnedOpen = !pinnedOpen">
              <i class="pi pi-chevron-down" :class="{ rotated: pinnedOpen }"></i>
            </button>
          </div>

          <!-- Сообщения -->
          <div ref="messagesContainerRef" class="messages-scroll" @click="closePopups">
            <div v-if="messagesLoading" class="chat-status">Загрузка сообщений…</div>
            <template v-else>
              <template
                v-for="(row, index) in messageRows"
                :key="row.kind === 'day' ? 'd' + index : row.message.id"
              >
                <div v-if="row.kind === 'day'" class="day-divider">
                  <span>{{ row.label }}</span>
                </div>
                <div v-else class="msg" :class="isOwnMessage(row.message) ? 'out' : 'in'">
                  <div class="msg-bubble">
                    <!-- Ответ-цитата -->
                    <div
                      v-if="row.message.reply_to_id && replyMessage(row.message)"
                      class="reply-quote"
                      @click.stop="quoteClick(row.message.reply_to_id)"
                    >
                      <span class="quote-name" :class="quoteNameClass(row.message)">
                        {{ quoteName(row.message) }}
                      </span>
                      <span class="quote-text">{{ quoteText(row.message) }}</span>
                    </div>

                    <!-- Вложение -->
                    <a
                      v-if="row.message.file"
                      class="attachment"
                      :href="mediaAbsolute(row.message.file.url)"
                      :download="row.message.file.name"
                      target="_blank"
                      rel="noopener"
                    >
                      <img
                        v-if="isImageFile(row.message.file)"
                        :src="mediaAbsolute(row.message.file.url)"
                        :alt="row.message.file.name"
                        class="attachment-image"
                        loading="lazy"
                      />
                      <span v-else class="attachment-card">
                        <i :class="fileIcon(row.message.file)"></i>
                        <span class="attachment-info">
                          <span class="attachment-name">{{ row.message.file.name }}</span>
                          <span class="attachment-meta">{{
                            formatBytes(row.message.file.size)
                          }}</span>
                        </span>
                      </span>
                    </a>

                    <span v-if="row.message.text" class="msg-text">{{ row.message.text }}</span>

                    <span class="msg-meta">
                      <span class="msg-time">{{ formatMsgTime(row.message.timestamp) }}</span>
                      <span
                        v-if="isOwnMessage(row.message)"
                        class="msg-ticks"
                        :class="{ read: row.message.is_read }"
                        >✓✓</span
                      >
                    </span>
                  </div>

                  <!-- Реакции -->
                  <div v-if="row.message.reactions.length" class="reactions" @click.stop>
                    <button
                      v-for="reaction in row.message.reactions"
                      :key="reaction.emoji"
                      class="reaction-chip"
                      :class="{ mine: reaction.reacted_by_me }"
                      @click="toggleReaction(row.message, reaction.emoji)"
                    >
                      {{ reaction.emoji }}<span class="reaction-count">{{ reaction.count }}</span>
                    </button>
                  </div>

                  <!-- Действия при наведении -->
                  <div class="msg-actions" @click.stop>
                    <button class="round-btn" title="Ответить" @click="setReply(row.message)">
                      <i class="pi pi-reply"></i>
                    </button>
                    <button
                      class="round-btn"
                      title="Реакция"
                      @click="toggleEmojiPicker(row.message.id)"
                    >
                      <i class="pi pi-face-smile"></i>
                    </button>
                    <button
                      v-if="!row.message.is_pinned"
                      class="round-btn"
                      title="Закрепить"
                      @click="togglePinMessage(row.message)"
                    >
                      <i class="pi pi-bookmark"></i>
                    </button>
                    <button
                      v-else
                      class="round-btn"
                      title="Открепить"
                      @click="togglePinMessage(row.message)"
                    >
                      <i class="pi pi-bookmark-fill"></i>
                    </button>
                    <button class="round-btn" title="Копировать" @click="copyMessage(row.message)">
                      <i class="pi pi-copy"></i>
                    </button>
                    <button
                      v-if="isOwnMessage(row.message)"
                      class="round-btn danger"
                      title="Удалить"
                      @click="deleteMessageOf(row.message)"
                    >
                      <i class="pi pi-trash"></i>
                    </button>
                  </div>

                  <!-- Выбор эмодзи-реакции -->
                  <div v-if="emojiPickerFor === row.message.id" class="emoji-picker" @click.stop>
                    <button
                      v-for="emoji in REACTION_EMOJIS"
                      :key="emoji"
                      class="emoji-option"
                      :class="{ active: hasMyReaction(row.message, emoji) }"
                      @click="toggleReaction(row.message, emoji)"
                    >
                      {{ emoji }}
                    </button>
                  </div>
                </div>
              </template>
              <div v-if="!messageRows.length" class="chat-status">
                Сообщений пока нет. Напишите первым!
              </div>
            </template>
          </div>

          <!-- Панель ввода -->
          <div class="input-area">
            <div v-if="sendError" class="inline-error">{{ sendError }}</div>

            <!-- Цитата ответа -->
            <div v-if="replyTarget" class="reply-bar">
              <div class="reply-bar-info">
                <span class="reply-bar-name">{{ quoteName(replyTarget) }}</span>
                <span class="reply-bar-text">{{ replySnippetOf(replyTarget) }}</span>
              </div>
              <button class="icon-btn" title="Отменить ответ" @click="clearReply">
                <i class="pi pi-times"></i>
              </button>
            </div>

            <div class="input-row">
              <button class="round-btn" title="Прикрепить файл" @click="attachInput?.click()">
                <i class="pi pi-paperclip"></i>
              </button>
              <input ref="attachInput" class="hidden-file" type="file" @change="onFileSelected" />
              <input
                v-model="newMessage"
                class="text-input"
                type="text"
                placeholder="Сообщение"
                @keydown.enter.prevent="sendText"
              />
              <button
                v-if="newMessage.trim()"
                class="send-btn"
                title="Отправить"
                :disabled="sending"
                @click="sendText"
              >
                <i class="pi pi-send"></i>
              </button>
              <template v-else>
                <button class="round-btn" title="Эмодзи" @click="emojiMenuOpen = !emojiMenuOpen">
                  <i class="pi pi-face-smile"></i>
                </button>
                <button class="round-btn muted" title="Голосовое сообщение (скоро)">
                  <i class="pi pi-microphone"></i>
                </button>
              </template>

              <div v-if="emojiMenuOpen" class="emoji-picker bottom">
                <button
                  v-for="emoji in INPUT_EMOJIS"
                  :key="emoji"
                  class="emoji-option"
                  @click="appendEmoji(emoji)"
                >
                  {{ emoji }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- ======= Нижняя навигация ======= -->
    <nav class="bottom-nav">
      <button class="nav-btn" :class="{ active: view === 'contacts' }" @click="view = 'contacts'">
        <i class="pi pi-users"></i>
        <span>Контакты</span>
      </button>
      <button class="nav-btn" :class="{ active: view === 'chats' }" @click="view = 'chats'">
        <span class="nav-icon-wrap">
          <i class="pi pi-comments"></i>
          <span v-if="totalUnread > 0" class="nav-badge">{{ totalUnread }}</span>
        </span>
        <span>Чаты</span>
      </button>
      <button class="nav-btn" @click="goToProfile">
        <i class="pi pi-cog"></i>
        <span>Настройки</span>
      </button>
    </nav>
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

  <!-- Login Modal -->
  <LoginModal :visible="showLoginModal" @close-modal="onLoginModalClose" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import Dialog from 'primevue/dialog'
import LoginModal from '@/components/LoginModal.vue'
import { useAuthStore } from '@/stores/auth'
import { getErrorMessage } from '@/services/errors'
import {
  fetchContacts,
  fetchMessages,
  fetchMyChats,
  fetchPinnedMessages,
  mediaUrl,
  openPrivateChat,
  removeMessageReaction,
  searchUsers,
  sendAttachmentMessage,
  sendNewMessage,
  setMessagePinned,
  setMessageReaction,
  deleteMessage,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatUser, Message, MessageFile } from '@/types'
import UserProfile from './UserProfile.vue'

const authStore = useAuthStore()

// ---------- Модальные окна ----------
const showProfileModal = ref(false)
const showLoginModal = ref(true)

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

const searchQuery = ref('')
const searching = ref(false)
const userResults = ref<SearchUserResult[]>([])
const searchError = ref('')
const contactsQuery = ref('')

const replyTarget = ref<Message | null>(null)
const inlineSearchOpen = ref(false)
const inlineQuery = ref('')
const emojiPickerFor = ref<number | null>(null)
const emojiMenuOpen = ref(false)
const pinnedOpen = ref(true)

const messagesContainerRef = ref<HTMLElement | null>(null)
const attachInput = ref<HTMLInputElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '👏', '🎉']
const INPUT_EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '😎', '🤔', '👍', '👎', '❤️', '🔥']

// ---------- Вычисляемые значения ----------
const currentUserId = computed<number | null>(() => authStore.current_user?.id ?? null)
const selfName = computed<string>(() =>
  authStore.current_user ? displayName(authStore.current_user) : ''
)
const selfInitial = computed<string>(() =>
  authStore.current_user ? initials(displayName(authStore.current_user)) : 'U'
)

const avatarSrc = (user: { avatar_url?: string | null } | null | undefined): string | undefined =>
  user?.avatar_url ? mediaUrl(user.avatar_url) : undefined

const selectedChat = computed<Chat | null>(() => {
  if (selectedChatId.value === null) return null
  return chats.value.find((chat) => chat.id === selectedChatId.value) ?? null
})

const totalUnread = computed<number>(() =>
  chats.value.reduce((sum, chat) => sum + (chat.unread_count || 0), 0)
)

const filteredChats = computed<Chat[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return chats.value
  return chats.value.filter((chat) => {
    const other = otherUserOfChat(chat)
    const title = other ? displayName(other) : chat.name
    const phone = other?.phone_number ?? ''
    return (
      title.toLowerCase().includes(query) ||
      chat.name.toLowerCase().includes(query) ||
      phone.toLowerCase().includes(query)
    )
  })
})

const filteredContacts = computed<SearchUserResult[]>(() => {
  const query = contactsQuery.value.trim().toLowerCase()
  if (!query) return contacts.value
  return contacts.value.filter((contact) =>
    [contact.username, contact.first_name, contact.last_name, contact.phone_number]
      .filter(Boolean)
      .some((part) => (part as string).toLowerCase().includes(query))
  )
})

type MessageRow = { kind: 'day'; label: string } | { kind: 'message'; message: Message }

const messageRows = computed<MessageRow[]>(() => {
  let list = messages.value
  const query = inlineQuery.value.trim().toLowerCase()
  if (query) {
    list = list.filter((message) =>
      `${message.text} ${message.file?.name ?? ''}`.toLowerCase().includes(query)
    )
  }

  const rows: MessageRow[] = []
  let lastDay = ''
  for (const message of list) {
    const date = toDate(message.timestamp)
    const key = date.toDateString()
    if (key !== lastDay) {
      rows.push({ kind: 'day', label: dayLabel(date) })
      lastDay = key
    }
    rows.push({ kind: 'message', message })
  }
  return rows
})

// ---------- Вспомогательные функции ----------
const fullName = (
  first: string | null | undefined,
  last: string | null | undefined,
  username: string
): string => {
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  return username
}

const displayName = (user: {
  first_name?: string | null
  last_name?: string | null
  username: string
}): string => fullName(user.first_name, user.last_name, user.username)

const initials = (value: string): string => {
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

const avatarStyle = (name: string): Record<string, string> => {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return { background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }
}

const otherUserOfChat = (chat: Chat): ChatUser | undefined => {
  if (currentUserId.value !== null) {
    const found = chat.users.find((user) => user.id !== currentUserId.value)
    if (found) return found
  }
  return chat.users[0]
}

const chatTitle = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  return other ? displayName(other) : chat.name
}

const chatSubtitle = (chat: Chat): string => {
  const other = otherUserOfChat(chat)
  if (!other) return chat.name
  const parts: string[] = [`@${other.username}`]
  if (other.phone_number) parts.push(other.phone_number)
  return parts.join(' · ')
}

const isOwnMessage = (message: Message): boolean =>
  currentUserId.value !== null && message.user_id === currentUserId.value

const lastMessageIsOut = (chat: Chat): boolean => {
  const last = chat.last_message
  return !!last && currentUserId.value !== null && last.user_id === currentUserId.value
}

const previewText = (chat: Chat): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  const prefix = currentUserId.value !== null && last.user_id === currentUserId.value ? 'Вы: ' : ''
  if (last.file) {
    const label = isImageFile(last.file) ? 'Изображение' : `Файл: ${last.file.name}`
    return `${prefix}${label}`
  }
  return `${prefix}${last.text}`
}

const senderName = (message: Message): string => (isOwnMessage(message) ? 'Вы' : chatTitleSafe())

function chatTitleSafe(): string {
  return selectedChat.value ? chatTitle(selectedChat.value) : ''
}

const replyMessage = (message: Message): Message | undefined =>
  message.reply_to_id != null
    ? messages.value.find((item) => item.id === message.reply_to_id)
    : undefined

const quoteName = (message: Message): string => {
  const target = replyMessage(message)
  if (!target) return 'Сообщение'
  return isOwnMessage(target) ? 'Вы' : 'Собеседник'
}

const quoteNameClass = (message: Message): Record<string, boolean> => ({
  mine: (() => {
    const target = replyMessage(message)
    return !!target && isOwnMessage(target)
  })()
})

const quoteText = (message: Message): string => {
  const target = replyMessage(message)
  return target ? snippetOf(target) : ''
}

const snippetOf = (message: Message): string => {
  if (message.file) {
    return isImageFile(message.file) ? '📷 Изображение' : `📎 ${message.file.name}`
  }
  return message.text || ''
}

const replySnippetOf = (message: Message): string => snippetOf(message)

const quoteClick = (_messageId: number) => {
  emojiPickerFor.value = null
  // Просто закрываем всплывающие меню (без реальной прокрутки здесь)
}

const senderNameOfMessage = (message: Message): string => {
  const other = otherUserOfChatForMessage(message)
  return other ? displayName(other) : 'Собеседник'
}

const otherUserOfChatForMessage = (message: Message): ChatUser | undefined => {
  const chat = chats.value.find((item) => item.id === message.chat_id)
  if (!chat) return undefined
  const other = otherUserOfChat(chat)
  if (other && other.id === message.user_id) return other
  return other
}

const pinnedSnippet = (message: Message): string =>
  `${message.user_id === currentUserId.value ? 'Вы: ' : senderNameOfMessage(message) + ': '}${snippetOf(message)}`

// ---------- Дата и время ----------
const toDate = (value: string | Date): Date => (typeof value === 'string' ? new Date(value) : value)

const isToday = (date: Date): boolean => date.toDateString() === new Date().toDateString()
const isYesterday = (date: Date): boolean => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return date.toDateString() === yesterday.toDateString()
}

const formatChatTime = (timestamp: string): string => {
  const date = toDate(timestamp)
  if (isToday(date)) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  if (isYesterday(date)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const formatMsgTime = (timestamp: string): string =>
  toDate(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

const dayLabel = (date: Date): string => {
  if (isToday(date)) return 'Сегодня'
  if (isYesterday(date)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ---------- Файлы ----------
const mediaAbsolute = (path: string): string => mediaUrl(path)

const isImageFile = (file: MessageFile): boolean => file.mime?.startsWith('image/') ?? false

const fileIcon = (file: MessageFile): string => {
  if (file.mime?.startsWith('image/')) return 'pi pi-image'
  if (file.mime?.startsWith('video/')) return 'pi pi-video'
  if (file.mime === 'application/pdf') return 'pi pi-file-pdf'
  if (file.mime?.startsWith('audio/')) return 'pi pi-volume-up'
  if (file.mime?.startsWith('text/')) return 'pi pi-file'
  return 'pi pi-file'
}

const formatBytes = (size: number | null): string => {
  if (!size) return ''
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}

// ---------- Реакции ----------
const hasMyReaction = (message: Message, emoji: string): boolean =>
  message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)

const toggleEmojiPicker = (messageId: number) => {
  emojiPickerFor.value = emojiPickerFor.value === messageId ? null : messageId
}

const closePopups = () => {
  emojiPickerFor.value = null
  emojiMenuOpen.value = false
}

const toggleReaction = async (message: Message, emoji: string) => {
  const mine = hasMyReaction(message, emoji)
  try {
    if (mine) {
      await removeMessageReaction(message.id)
    } else {
      await setMessageReaction(message.id, emoji)
    }
    emojiPickerFor.value = null
    await refreshThread()
  } catch (error) {
    console.error('Не удалось изменить реакцию:', getErrorMessage(error))
  }
}

// ---------- Загрузка данных ----------
const loadChats = async () => {
  loadingChats.value = true
  try {
    chats.value = await fetchMyChats()
  } catch (error) {
    console.error('Не удалось загрузить чаты:', getErrorMessage(error))
  } finally {
    loadingChats.value = false
  }
}

const loadMessages = async (chatId: number) => {
  messagesLoading.value = true
  try {
    messages.value = await fetchMessages(chatId)
  } catch (error) {
    console.error('Не удалось загрузить сообщения:', getErrorMessage(error))
  } finally {
    messagesLoading.value = false
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
  await Promise.all([loadMessages(chatId), loadPinned(chatId), loadChats()])
  await nextTick()
  scrollToBottom()
}

const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
  }
}

// ---------- Выбор чата ----------
const selectChat = async (chatId: number) => {
  if (selectedChatId.value === chatId) return
  selectedChatId.value = chatId
  sendError.value = ''
  messages.value = []
  pinnedMessages.value = []
  inlineQuery.value = ''
  inlineSearchOpen.value = false
  clearReply()
  await Promise.all([loadMessages(chatId), loadPinned(chatId)])
  scrollToBottom()
}

const startChat = async (user: SearchUserResult) => {
  searchError.value = ''
  try {
    const chat = await openPrivateChat(user.id)
    upsertChat(chat)
    searchQuery.value = ''
    userResults.value = []
    view.value = 'chats'
    selectedChatId.value = chat.id
    messages.value = []
    pinnedMessages.value = []
    clearReply()
    await Promise.all([loadMessages(chat.id), loadPinned(chat.id)])
    scrollToBottom()
  } catch (error) {
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
}

const openChatWithContact = async (contact: SearchUserResult) => {
  view.value = 'chats'
  await startChat(contact)
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
    const message = await sendNewMessage(chatId, text, replyTarget.value?.id)
    newMessage.value = ''
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

const onFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
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
    await setMessagePinned(message.id, !message.is_pinned)
    const chatId = selectedChatId.value
    if (chatId !== null) {
      await Promise.all([loadMessages(chatId), loadPinned(chatId)])
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

const deleteMessageOf = async (message: Message) => {
  if (!window.confirm('Удалить это сообщение?')) return
  try {
    await deleteMessage(message.id)
    const chatId = selectedChatId.value
    if (chatId !== null) {
      await Promise.all([loadMessages(chatId), loadPinned(chatId), loadChats()])
    }
  } catch (error) {
    console.error('Не удалось удалить сообщение:', getErrorMessage(error))
  }
}

// ---------- Поиск по сообщениям ----------
const toggleInlineSearch = () => {
  inlineSearchOpen.value = !inlineSearchOpen.value
  if (!inlineSearchOpen.value) inlineQuery.value = ''
}

// ---------- Эмодзи в поле ввода ----------
const appendEmoji = (emoji: string) => {
  newMessage.value = `${newMessage.value}${emoji}`
  emojiMenuOpen.value = false
}

// ---------- Поиск людей ----------
const focusSearch = () => {
  nextTick(() => searchInputRef.value?.focus())
}

let searchTimer: number | null = null
watch(searchQuery, (value) => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  searchError.value = ''
  const query = value.trim()
  if (!query) {
    userResults.value = []
    searching.value = false
    return
  }

  searching.value = true
  searchTimer = window.setTimeout(async () => {
    try {
      userResults.value = await searchUsers(query)
    } catch (error) {
      searchError.value = getErrorMessage(error, 'Не удалось выполнить поиск')
    } finally {
      searching.value = false
    }
  }, 350)
})

// ---------- Опрос (polling) ----------
let pollTimer: number | null = null

const stopPolling = () => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

const startPolling = () => {
  stopPolling()
  pollTimer = window.setInterval(async () => {
    if (!authStore.isAuthenticated) return
    try {
      chats.value = await fetchMyChats()
    } catch (error) {
      console.error('Не удалось обновить чаты:', getErrorMessage(error))
    }

    const chatId = selectedChatId.value
    if (chatId !== null) {
      try {
        const previousIds = new Set(messages.value.map((message) => message.id))
        const fresh = await fetchMessages(chatId)
        messages.value = fresh
        const hasNew = fresh.some((message) => !previousIds.has(message.id))
        const pinned = await fetchPinnedMessages(chatId)
        const pinnedChanged =
          pinned.map((item) => item.id).join(',') !==
          pinnedMessages.value.map((item) => item.id).join(',')
        if (pinnedChanged) pinnedMessages.value = pinned
        if (hasNew) {
          await nextTick()
          scrollToBottom()
        }
      } catch (error) {
        console.error('Не удалось обновить сообщения:', getErrorMessage(error))
      }
    }
  }, 3000)
}

// ---------- Навигация ----------
const goToProfile = () => {
  showProfileModal.value = true
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
      startPolling()
    } else {
      stopPolling()
      chats.value = []
      messages.value = []
      pinnedMessages.value = []
      contacts.value = []
      userResults.value = []
      selectedChatId.value = null
    }
  },
  { immediate: true }
)

onMounted(async () => {
  await authStore.initializeApp()
  scrollToBottom()
})

onBeforeUnmount(() => {
  stopPolling()
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
  }
})

watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    showLoginModal.value = !isAuthenticated
  },
  { immediate: true }
)

watch(
  selectedChatId,
  () => {
    closePopups()
    clearReply()
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.messenger-body {
  flex: 1;
  display: flex;
  min-height: 0;
  background: #e7ebf0;
}

.side-panel {
  width: 320px;
  background: #ffffff;
  border-right: 1px solid #e2e6ea;
  display: flex;
  flex-direction: column;
  min-height: 0;
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

/* ---------- Общие элементы ---------- */
.icon-btn {
  background: none;
  border: none;
  color: #52626f;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #202b34;
}

.round-btn {
  background: none;
  border: none;
  color: #5b6b79;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
}

.round-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #1d2731;
}

.round-btn.danger:hover {
  color: #d64545;
}

.round-btn.muted {
  color: #9aa7b2;
}

.avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1rem;
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
  position: relative;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar.mini {
  width: 30px;
  height: 30px;
  font-size: 0.72rem;
}

.inline-error {
  color: #d64545;
  font-size: 12px;
  padding: 6px 14px;
  background: #fdecec;
}

/* ---------- Заголовки панелей ---------- */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #ffffff;
}

.panel-title {
  font-size: 19px;
  font-weight: 600;
  margin: 0;
  color: #1c2733;
}

.panel-header-left,
.panel-header-right {
  display: flex;
  gap: 2px;
}

.panel-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 7px 12px;
  background: #f1f3f5;
  border-radius: 10px;
}

.search-icon {
  color: #8595a2;
  font-size: 0.9rem;
}

.panel-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: #1c2733;
}

/* ---------- Списки ---------- */
.section-label {
  padding: 8px 14px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: #8295a3;
  user-select: none;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 6px;
}

.row-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}

.row-item:hover {
  background: #f2f4f6;
}

.row-item.active {
  background: #e3f2e5;
}

.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.row-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row-title {
  font-size: 15px;
  font-weight: 600;
  color: #141d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-time {
  font-size: 12px;
  color: #97a5b0;
  flex-shrink: 0;
}

.row-sub {
  font-size: 13.5px;
  color: #71808d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-sub.preview {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tick {
  font-size: 0.85rem;
  color: #37aee2;
  flex-shrink: 0;
}

.unread-badge {
  background: #43c56a;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 20px;
  height: 20px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  flex-shrink: 0;
}

.row-arrow {
  color: #9aa7b2;
  font-size: 0.95rem;
}

.people-results {
  border-bottom: 1px solid #eef0f2;
}

.search-status,
.empty-hint {
  padding: 14px;
  color: #93a0ab;
  font-size: 13.5px;
  text-align: center;
}

/* ---------- Пустое состояние чата ---------- */
.chat-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #7c8a96;
  padding: 24px;
  background: transparent;
}

.placeholder-icon {
  font-size: 4rem;
  color: #b9c6cf;
  margin-bottom: 14px;
}

.chat-placeholder h3 {
  margin: 0 0 6px;
  color: #52626f;
}

.ghost-btn {
  margin-top: 14px;
  border: 1px solid #b9c6cf;
  background: #fff;
  color: #3f7c56;
  padding: 9px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.ghost-btn:hover {
  background: #eef6ef;
}

/* ---------- Шапка чата ---------- */
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e6ea;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  z-index: 2;
}

.back-btn {
  display: none;
}

.chat-avatar {
  width: 40px;
  height: 40px;
}

.chat-header-info {
  flex: 1;
  min-width: 0;
}

.chat-title {
  font-size: 16px;
  font-weight: 600;
  color: #141d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-subtitle {
  font-size: 13px;
  color: #7b8a96;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* ---------- Закреплённые ---------- */
.pinned-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 16px;
  background: #fffdf4;
  border-bottom: 1px solid #efe4c8;
}

.pinned-icon {
  color: #c9a227;
  font-size: 1rem;
  margin-top: 3px;
}

.pinned-content {
  flex: 1;
  min-width: 0;
}

.pinned-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #8a7320;
  font-weight: 600;
}

.pinned-count {
  background: #f3e6b8;
  color: #8a7320;
  border-radius: 10px;
  padding: 0 6px;
  font-size: 11px;
}

.pinned-item {
  font-size: 13.5px;
  color: #4a4a3c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 3px;
}

.pinned-sender {
  font-weight: 600;
  color: #1e7a43;
  margin-right: 6px;
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

.msg {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 3px 0;
  max-width: 60%;
}

.msg.out {
  align-self: flex-end;
  align-items: flex-end;
}

.msg.in {
  align-self: flex-start;
  align-items: flex-start;
}

.msg-bubble {
  position: relative;
  padding: 7px 11px 6px;
  border-radius: 12px;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
  min-width: 70px;
}

.msg.out .msg-bubble {
  background: #dcf8c6;
  border-top-right-radius: 3px;
}

.msg.in .msg-bubble {
  background: #ffffff;
  border-top-left-radius: 3px;
}

.msg-text {
  display: block;
  color: #111;
  font-size: 14.5px;
  line-height: 1.35;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.msg-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 2px;
}

.msg-time {
  font-size: 11px;
  color: #8a98a3;
}

.msg-ticks {
  font-size: 12px;
  color: #99a7b1;
}

.msg-ticks.read {
  color: #3aa6e0;
}

/* Ответ-цитата */
.reply-quote {
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.06);
  border-left: 3px solid #3aa6e0;
  border-radius: 6px;
  padding: 5px 9px;
  margin-bottom: 5px;
  cursor: pointer;
  min-width: 120px;
}

.msg.out .reply-quote {
  border-left-color: #3f9d56;
}

.quote-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #3aa6e0;
}

.quote-name.mine {
  color: #3f9d56;
}

.quote-text {
  font-size: 13px;
  color: #5c6a75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Вложения */
.attachment {
  display: block;
  margin-bottom: 4px;
  text-decoration: none;
}

.attachment-image {
  max-width: 300px;
  max-height: 260px;
  border-radius: 8px;
  display: block;
}

.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f4f6f8;
  border-radius: 8px;
  padding: 8px 12px;
  color: #2f3b44;
}

.attachment-card i {
  font-size: 1.6rem;
  color: #d4585e;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #141d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.attachment-meta {
  font-size: 12px;
  color: #8a98a3;
}

/* Действия при наведении */
.msg-actions {
  position: absolute;
  top: -14px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
  display: flex;
  gap: 2px;
  padding: 2px 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  z-index: 5;
}

.msg.in .msg-actions {
  left: 4px;
}

.msg.out .msg-actions {
  right: 4px;
}

.msg:hover .msg-actions,
.msg:focus-within .msg-actions {
  opacity: 1;
  pointer-events: auto;
}

.msg-actions .round-btn {
  width: 28px;
  height: 28px;
  font-size: 0.9rem;
}

/* Реакции */
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.reaction-chip {
  border: 1px solid #e0e4e8;
  background: #ffffff;
  color: #43525d;
  font-size: 13px;
  border-radius: 14px;
  padding: 2px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.reaction-chip.mine {
  background: #d8efdd;
  border-color: #7cc48c;
}

.reaction-count {
  font-size: 11.5px;
  font-weight: 600;
}

/* Палитра эмодзи */
.emoji-picker {
  position: absolute;
  top: -46px;
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  z-index: 10;
}

.msg.in .emoji-picker {
  left: 4px;
}

.msg.out .emoji-picker {
  right: 4px;
}

.emoji-option {
  background: transparent;
  border: none;
  font-size: 19px;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.emoji-option:hover {
  background: #f0f2f4;
  transform: scale(1.18);
}

.emoji-option.active {
  background: #e3f2e5;
}

.emoji-picker.bottom {
  position: absolute;
  top: auto;
  bottom: 56px;
  right: 14px;
  left: auto;
}

/* Поиск по сообщениям */
.inline-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e2e6ea;
}

.inline-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
}

/* ---------- Ввод ---------- */
.input-area {
  padding: 10px 14px;
  background: #f0f2f5;
  border-top: 1px solid #e2e6ea;
  position: relative;
}

.reply-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border-left: 3px solid #3aa6e0;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
}

.reply-bar-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.reply-bar-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #3aa6e0;
}

.reply-bar-text {
  font-size: 13px;
  color: #5c6a75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #ffffff;
  border-radius: 12px;
  padding: 5px 10px;
  position: relative;
}

.text-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  background: transparent;
  padding: 7px 4px;
  color: #141d26;
}

.send-btn {
  background: #2ea25e;
  color: #fff;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
}

.send-btn:hover {
  background: #288e52;
}

.hidden-file {
  display: none;
}

.chat-status {
  padding: 12px;
  text-align: center;
  color: #8a98a3;
  font-size: 13.5px;
}

/* ---------- Нижняя навигация ---------- */
.bottom-nav {
  display: flex;
  background: #ffffff;
  border-top: 1px solid #e2e6ea;
  justify-content: center;
  gap: 12px;
  padding: 4px 0 6px;
  flex-shrink: 0;
}

.nav-btn {
  border: none;
  background: transparent;
  color: #7a8994;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 22px;
  cursor: pointer;
  font-size: 11px;
  border-radius: 8px;
}

.nav-btn i {
  font-size: 1.3rem;
}

.nav-btn.active {
  color: #1e9b51;
}

.nav-btn:hover {
  background: #f2f4f6;
}

.nav-icon-wrap {
  position: relative;
  display: inline-flex;
}

.nav-badge {
  position: absolute;
  top: -6px;
  right: -12px;
  background: #e04545;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.rotated {
  transform: rotate(180deg);
}

@media (max-width: 820px) {
  .side-panel {
    width: 84px;
  }

  .side-panel .panel-title,
  .side-panel .row-text,
  .side-panel .panel-search,
  .side-panel .section-label,
  .side-panel .search-status,
  .side-panel .empty-hint {
    display: none;
  }

  .row-item {
    justify-content: center;
    padding: 8px;
  }

  .back-btn {
    display: inline-flex;
  }
}
</style>
