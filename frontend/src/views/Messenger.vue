<template>
  <div class="messenger-container">
    <aside class="sidebar">
      <div class="search-bar">
        <span class="pi pi-search search-icon"></span>
        <InputText
          v-model="searchQuery"
          placeholder="Поиск по логину или телефону"
          class="search-input"
        />
      </div>

      <div v-if="searchError" class="search-error">{{ searchError }}</div>

      <!-- Результаты поиска людей -->
      <div v-if="searchQuery.trim()" class="people-results">
        <div v-if="searching" class="search-status">Поиск…</div>
        <template v-else-if="userResults.length">
          <div class="people-results-title">Найти людей</div>
          <div
            v-for="user in userResults"
            :key="user.id"
            class="people-result"
            @click="startChat(user)"
          >
            <div class="result-avatar">{{ initials(displayName(user)) }}</div>
            <div class="result-info">
              <div class="result-name">{{ displayName(user) }}</div>
              <div class="result-meta">
                @{{ user.username
                }}<template v-if="user.phone_number"> · {{ user.phone_number }}</template>
              </div>
            </div>
            <Button
              icon="pi pi-comment"
              text
              rounded
              severity="secondary"
              aria-label="Начать чат"
            />
          </div>
        </template>
        <div v-else class="search-status">Никого не найдено</div>
      </div>

      <div class="chat-list-header">Диалоги</div>
      <div v-if="loadingChats" class="chat-list-status">Загрузка…</div>
      <div v-else-if="!filteredChats.length" class="chat-list-status">
        Найдите пользователя по логину или телефону и начните переписку
      </div>
      <div class="chat-list">
        <div
          v-for="chat in filteredChats"
          :key="chat.id"
          class="chat-item"
          :class="{ active: selectedChatId === chat.id }"
          @click="selectChat(chat.id)"
        >
          <div class="chat-avatar">
            {{ initials(chatTitle(chat)) }}
          </div>
          <div class="chat-info">
            <div class="chat-name">{{ chatTitle(chat) }}</div>
            <div class="chat-preview">{{ previewText(chat) }}</div>
          </div>
          <div class="chat-time">
            {{ chat.last_message ? formatListDate(chat.last_message.timestamp) : '' }}
          </div>
        </div>
      </div>
    </aside>

    <main class="chat-area">
      <div class="chat-header">
        <div class="header-info">
          <template v-if="selectedChat">
            <Avatar
              :label="initials(chatTitle(selectedChat))"
              shape="circle"
              class="chat-avatar-big"
            />
            <div class="header-chat-block">
              <div class="chat-name">{{ chatTitle(selectedChat) }}</div>
              <div class="chat-subtitle">{{ chatSubtitle(selectedChat) }}</div>
            </div>
          </template>
          <template v-else>
            <div class="header-chat-block">
              <div class="chat-name">Мессенджер</div>
              <div class="chat-subtitle">Личные сообщения</div>
            </div>
          </template>
        </div>
        <div class="header-actions">
          <Avatar
            :label="selfInitial"
            size="large"
            shape="circle"
            class="profile-avatar-clickable"
            @click="goToProfile"
          />
          <Button icon="pi pi-cog" severity="secondary" text rounded @click="goToSettings" />
        </div>
      </div>

      <div v-if="selectedChat" class="messages-container" ref="messagesContainerRef">
        <div
          v-for="message in messages"
          :key="message.id"
          class="message-wrapper"
          :class="{
            'message-sent': message.user_id === currentUserId,
            'message-received': message.user_id !== currentUserId
          }"
        >
          <div class="message-content">
            <div class="message-text">{{ message.text }}</div>
            <div class="message-time">{{ formatTime(message.timestamp) }}</div>
          </div>
        </div>
        <div v-if="messagesLoading" class="chat-list-status">Загрузка сообщений…</div>
      </div>

      <div v-else class="chat-empty">
        <i class="pi pi-comments chat-empty-icon"></i>
        <p>
          Выберите диалог слева или найдите собеседника по логину или телефону, чтобы начать
          переписку.
        </p>
      </div>

      <div v-if="selectedChat" class="input-area">
        <div v-if="sendError" class="send-error">{{ sendError }}</div>
        <div class="input-wrapper">
          <InputText
            v-model="newMessage"
            placeholder="Введите сообщение..."
            class="message-input"
            :disabled="sending"
            @keypress.enter="sendMessage"
          />
          <Button
            icon="pi pi-paper-plane"
            @click="sendMessage"
            :disabled="!newMessage.trim() || sending"
          />
        </div>
      </div>
    </main>
  </div>

  <!-- Settings Modal -->
  <Dialog
    v-model:visible="showSettingsModal"
    header="Настройки"
    :modal="true"
    :closable="true"
    :style="{ width: '50vw' }"
    @hide="showSettingsModal = false"
  >
    <Suspense>
      <template #default>
        <SettingsView @close-modal="showSettingsModal = false" />
      </template>
      <template #fallback>
        <div>Загрузка настроек...</div>
      </template>
    </Suspense>
  </Dialog>

  <!-- Profile Modal -->
  <Dialog
    v-model:visible="showProfileModal"
    header="Профиль пользователя"
    :modal="true"
    :closable="true"
    :style="{ width: '50vw' }"
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
  <!-- Отображаем модалку, если пользователь не аутентифицирован -->
  <LoginModal :visible="showLoginModal" @close-modal="onLoginModalClose" />
  <!-- Удален лишний оверлей -->
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Avatar from 'primevue/avatar'
import Dialog from 'primevue/dialog'
import LoginModal from '@/components/LoginModal.vue'
import { useAuthStore } from '@/stores/auth'
import { getErrorMessage } from '@/services/errors'
import {
  fetchMyChats,
  fetchMessages,
  openPrivateChat,
  searchUsers,
  sendNewMessage,
  type SearchUserResult
} from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import SettingsView from './SettingsView.vue'
import UserProfile from './UserProfile.vue'

// Получаю экземпляр store
const authStore = useAuthStore()

// State variables for modals
const showSettingsModal = ref(false)
const showProfileModal = ref(false)
// Инициализируем showLoginModal как true, полагаясь на watch для обновления
const showLoginModal = ref(true)

// Данные мессенджера
const chats = ref<Chat[]>([])
const messages = ref<Message[]>([])
const loadingChats = ref(false)
const messagesLoading = ref(false)
const selectedChatId = ref<number | null>(null)
const newMessage = ref('')
const sending = ref(false)
const sendError = ref('')
const searchQuery = ref('')
const searching = ref(false)
const userResults = ref<SearchUserResult[]>([])
const searchError = ref('')
const messagesContainerRef = ref<HTMLElement | null>(null)

// Текущий пользователь (id появляется в /jwt/users/me)
const currentUserId = computed<number | null>(() => authStore.current_user?.id ?? null)

const selectedChat = computed<Chat | null>(() => {
  if (selectedChatId.value === null) return null
  return chats.value.find((chat) => chat.id === selectedChatId.value) ?? null
})

const filteredChats = computed<Chat[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return chats.value
  return chats.value.filter((chat) => {
    const other = otherUserOf(chat)
    const title = other ? displayName(other) : chat.name
    const phone = other?.phone_number ?? ''
    return (
      title.toLowerCase().includes(query) ||
      chat.name.toLowerCase().includes(query) ||
      phone.toLowerCase().includes(query)
    )
  })
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

const selfInitial = computed<string>(() => {
  const user = authStore.current_user
  return user ? initials(displayName(user)) : 'U'
})

const otherUserOf = (chat: Chat): ChatUser | undefined => {
  if (currentUserId.value !== null) {
    const found = chat.users.find((user) => user.id !== currentUserId.value)
    if (found) return found
  }
  return chat.users[0]
}

const chatTitle = (chat: Chat): string => {
  const other = otherUserOf(chat)
  return other ? displayName(other) : chat.name
}

const chatSubtitle = (chat: Chat): string => {
  const other = otherUserOf(chat)
  if (!other) return chat.name
  const parts: string[] = [`@${other.username}`]
  if (other.phone_number) parts.push(other.phone_number)
  return parts.join(' · ')
}

const previewText = (chat: Chat): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  const prefix = last.user_id === currentUserId.value ? 'Вы: ' : ''
  return prefix + last.text
}

const toDate = (value: string | Date): Date => (typeof value === 'string' ? new Date(value) : value)

const formatListDate = (timestamp: string): string => {
  const date = toDate(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня'
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера'
  }
  return date.toLocaleDateString('ru-RU')
}

const formatTime = (timestamp: string): string => {
  return toDate(timestamp).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
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
    await nextTick()
    scrollToBottom()
  } catch (error) {
    console.error('Не удалось загрузить сообщения:', getErrorMessage(error))
  } finally {
    messagesLoading.value = false
  }
}

const selectChat = async (chatId: number) => {
  selectedChatId.value = chatId
  sendError.value = ''
  messages.value = []
  await loadMessages(chatId)
}

const startChat = async (user: SearchUserResult) => {
  searchError.value = ''
  try {
    const chat = await openPrivateChat(user.id)
    const index = chats.value.findIndex((item) => item.id === chat.id)
    if (index === -1) {
      chats.value.unshift(chat)
    } else {
      chats.value[index] = chat
    }
    searchQuery.value = ''
    userResults.value = []
    selectedChatId.value = chat.id
    messages.value = []
    await loadMessages(chat.id)
  } catch (error) {
    searchError.value = getErrorMessage(error, 'Не удалось начать переписку')
  }
}

const sendMessage = async () => {
  const chatId = selectedChatId.value
  const text = newMessage.value.trim()
  if (chatId === null || !text || sending.value) return

  sending.value = true
  sendError.value = ''
  try {
    const message = await sendNewMessage(chatId, text)
    newMessage.value = ''
    messages.value = [...messages.value, message]
    await loadChats()
    await nextTick()
    scrollToBottom()
  } catch (error) {
    sendError.value = getErrorMessage(error, 'Не удалось отправить сообщение')
  } finally {
    sending.value = false
  }
}

// ---------- Поиск пользователей ----------
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

// ---------- Опрос новых сообщений (polling) ----------
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

    if (selectedChatId.value !== null) {
      try {
        const previousIds = new Set(messages.value.map((message) => message.id))
        const fresh = await fetchMessages(selectedChatId.value)
        messages.value = fresh
        const hasNew = fresh.some((message) => !previousIds.has(message.id))
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

const goToSettings = () => {
  showSettingsModal.value = true
}

const onLoginModalClose = () => {
  console.log('Login modal close event received in Messenger.vue. Closing modal.')
  showLoginModal.value = false
}

// ---------- Жизненный цикл ----------
const ready = computed(() => authStore.isAuthenticated && currentUserId.value !== null)

watch(
  ready,
  async (isReady) => {
    if (isReady) {
      await loadChats()
      startPolling()
    } else {
      stopPolling()
      chats.value = []
      messages.value = []
      userResults.value = []
      selectedChatId.value = null
    }
  },
  { immediate: true }
)

onMounted(async () => {
  // Ждем полной инициализации store
  await authStore.initializeApp()
  if (messagesContainerRef.value) {
    scrollToBottom()
  }
})

onBeforeUnmount(() => {
  stopPolling()
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
  }
})

// Следим за изменением состояния аутентификации
watch(
  () => authStore.isAuthenticated,
  (isAuthenticated) => {
    // Показываем модалку входа, пока пользователь не аутентифицирован
    showLoginModal.value = !isAuthenticated
  },
  { immediate: true }
)
</script>

<style scoped>
.messenger-container {
  display: flex;
  height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4edf5 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  position: relative; /* Для правильного позиционирования оверлея */
}

.sidebar {
  width: 300px;
  background: #ffffff;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
}

.search-bar {
  padding: 15px;
  background: #f0f2f5;
  border-bottom: 1px solid #e0e0e0;
}

.search-input {
  width: 100%;
  border-radius: 20px;
  border: 1px solid #e0e0e0;
  padding: 8px 15px;
  background: white;
}

.chat-list {
  overflow-y: auto;
  flex-grow: 1;
}

.chat-item {
  display: flex;
  align-items: center;
  padding: 12px 15px;
  cursor: pointer;
  transition: background 0.2s;
  border-bottom: 1px solid #f0f2f5;
}

.chat-item:hover {
  background: #f5f7fa;
}

.chat-item.active {
  background: #e4edf5;
}

.chat-avatar {
  width: 45px;
  height: 45px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4776e6 0%, #8e54e9 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 18px;
  margin-right: 15px;
  flex-shrink: 0;
}

.chat-info {
  flex-grow: 1;
  min-width: 0;
}

.chat-name {
  font-weight: 600;
  color: #0a0a0a;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-preview {
  font-size: 14px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-time {
  font-size: 12px;
  color: #999;
  text-align: right;
  flex-shrink: 0;
  margin-left: 5px;
  min-width: 50px;
}

.chat-area {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  background: url('@/assets/chat-bg.jpg') repeat;
  background-size: cover;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background: #ffffff;
  border-bottom: 1px solid #e0e0e0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.header-info {
  display: flex;
  align-items: center;
}

/* Стили для аватара профиля */
.profile-avatar-clickable {
  width: 40px !important;
  height: 40px !important;
  cursor: pointer;
  margin-right: 15px;
  background: linear-gradient(135deg, #4776e6 0%, #8e54e9 100%) !important;
  color: white !important;
}

.profile-avatar-clickable:hover {
  opacity: 0.8;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.messages-container {
  flex-grow: 1;
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.message-wrapper {
  max-width: 70%;
  display: flex;
}

.message-wrapper.message-sent {
  align-self: flex-end;
}

.message-wrapper.message-received {
  align-self: flex-start;
}

.message-content {
  position: relative;
  padding: 12px 16px;
  border-radius: 18px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  animation: fadeIn 0.3s ease;
}

.message-sent .message-content {
  background: #dcf8c6;
  border-top-right-radius: 4px;
}

.message-received .message-content {
  background: white;
  border-top-left-radius: 4px;
}

.message-text {
  margin-bottom: 5px;
  word-wrap: break-word;
}

.message-time {
  font-size: 11px;
  color: #666;
  text-align: right;
}

.input-area {
  padding: 15px;
  background: #f0f2f5;
  border-top: 1px solid #e0e0e0;
}

.input-wrapper {
  display: flex;
  align-items: center;
  background: white;
  border-radius: 24px;
  padding: 5px 15px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.message-input {
  flex-grow: 1;
  border: none;
  outline: none;
  padding: 10px 15px;
  font-size: 16px;
  background: transparent;
}

.message-input:focus {
  box-shadow: none;
}

/* Анимация fadeIn */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Удалены стили для оверлея */
/* .overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.1);
  z-index: 999;
  pointer-events: auto;
} */

/* Панель поиска людей */
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 15px;
  background: #f0f2f5;
  border-bottom: 1px solid #e0e0e0;
}

.search-icon {
  color: #888;
  font-size: 0.9rem;
}

.search-input {
  flex: 1;
  width: auto;
}

.search-error,
.send-error {
  font-size: 13px;
  color: #d32f2f;
  padding: 6px 15px;
  background: #fdecea;
}

.send-error {
  border-radius: 8px;
  margin-bottom: 8px;
  padding: 8px 12px;
}

.people-results {
  border-bottom: 1px solid #e0e0e0;
  max-height: 40vh;
  overflow-y: auto;
  background: #ffffff;
}

.people-results-title {
  padding: 8px 15px 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #999;
}

.people-result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 15px;
  cursor: pointer;
  transition: background 0.2s;
}

.people-result:hover {
  background: #f5f7fa;
}

.result-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4776e6 0%, #8e54e9 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 15px;
  font-weight: 600;
  flex-shrink: 0;
}

.result-info {
  flex-grow: 1;
  min-width: 0;
}

.result-name {
  font-weight: 600;
  color: #0a0a0a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-meta {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-status,
.chat-list-status {
  padding: 12px 15px;
  color: #888;
  font-size: 13px;
}

.chat-list-header {
  padding: 12px 15px 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #999;
}

/* Аватар и название собеседника в шапке */
.chat-avatar-big {
  width: 42px !important;
  height: 42px !important;
  background: linear-gradient(135deg, #4776e6 0%, #8e54e9 100%) !important;
  color: white !important;
  font-weight: 600;
  margin-right: 12px;
  flex-shrink: 0;
}

.header-chat-block {
  min-width: 0;
}

.chat-subtitle {
  font-size: 13px;
  color: #777;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Пустое состояние при отсутствии выбранного чата */
.chat-empty {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #888;
  padding: 20px;
  background: #eef1f5;
}

.chat-empty-icon {
  font-size: 3rem;
  color: #c0c8d4;
  margin-bottom: 12px;
}

@media (max-width: 768px) {
  .messenger-container {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    height: 40vh;
    border-right: none;
    border-bottom: 1px solid #e0e0e0;
  }
}
</style>
