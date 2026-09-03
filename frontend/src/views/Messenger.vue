<template>
  <div class="messenger-container">
    <div class="sidebar">
      <div class="search-bar">
        <InputText v-model="searchQuery" placeholder="Поиск..." class="search-input" />
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
            <i class="pi pi-user"></i>
          </div>
          <div class="chat-info">
            <div class="chat-name">{{ chat.name }}</div>
            <div class="chat-preview">
              {{ chat.lastMessage ? chat.lastMessage.text : 'Нет сообщений' }}
            </div>
          </div>
          <div class="chat-time">
            {{ chat.lastMessage ? formatDate(chat.lastMessage.timestamp) : formatDate(new Date()) }}
          </div>
        </div>
      </div>
    </div>

    <div class="chat-area">
      <div class="chat-header">
        <div class="header-info">
          <div class="chat-avatar-small">
            <i class="pi pi-user"></i>
          </div>
          <div class="chat-name">{{ selectedChatName }}</div>
        </div>
        <div class="header-actions">
          <Button icon="pi pi-ellipsis-v" severity="secondary" text rounded />
        </div>
      </div>

      <div class="messages-container" ref="messagesContainerRef">
        <div
          v-for="(message, index) in currentMessages"
          :key="index"
          class="message-wrapper"
          :class="{
            'message-sent': message.senderId === currentUserId,
            'message-received': message.senderId !== currentUserId
          }"
        >
          <div class="message-content">
            <div class="message-text">{{ message.text }}</div>
            <div class="message-time">
              {{ formatTime(message.timestamp) }}
            </div>
          </div>
        </div>
      </div>

      <div class="input-area">
        <div class="input-wrapper">
          <Button icon="pi pi-plus" severity="secondary" text rounded />
          <InputText
            v-model="newMessage"
            placeholder="Введите сообщение..."
            class="message-input"
            @keypress.enter="sendMessage"
          />
          <Button icon="pi pi-paper-plane" @click="sendMessage" :disabled="!newMessage.trim()" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

// Define types
interface Chat {
  id: number
  name: string
  lastMessage?: Message
}

interface Message {
  id: number
  text: string
  timestamp: Date
  senderId: number
}

// State variables
const chats = ref<Chat[]>([
  {
    id: 1,
    name: 'Иван Петров',
    lastMessage: { text: 'Привет!', timestamp: new Date(Date.now() - 3600000), id: 1, senderId: 2 }
  },
  {
    id: 2,
    name: 'Анна Смирнова',
    lastMessage: {
      text: 'Как дела?',
      timestamp: new Date(Date.now() - 86400000),
      id: 2,
      senderId: 3
    }
  },
  {
    id: 3,
    name: 'Групповой чат',
    lastMessage: {
      text: 'Новое собрание',
      timestamp: new Date(Date.now() - 172800000),
      id: 3,
      senderId: 1
    }
  }
])
const messages = ref<Message[][]>([
  [
    { id: 1, text: 'Привет!', timestamp: new Date(Date.now() - 3600000), senderId: 2 },
    { id: 2, text: 'Привет, как дела?', timestamp: new Date(Date.now() - 3500000), senderId: 1 },
    { id: 3, text: 'Отлично, спасибо!', timestamp: new Date(Date.now() - 3400000), senderId: 2 }
  ],
  [
    { id: 1, text: 'Как дела?', timestamp: new Date(Date.now() - 86400000), senderId: 3 },
    { id: 2, text: 'Хорошо, спасибо', timestamp: new Date(Date.now() - 86300000), senderId: 1 }
  ],
  [
    { id: 1, text: 'Новое собрание', timestamp: new Date(Date.now() - 172800000), senderId: 1 },
    { id: 2, text: 'Когда?', timestamp: new Date(Date.now() - 172700000), senderId: 2 },
    { id: 3, text: 'Завтра в 10', timestamp: new Date(Date.now() - 172600000), senderId: 3 }
  ]
])
const selectedChatId = ref<number | null>(1)
const newMessage = ref('')
const searchQuery = ref('')
const currentUserId = ref(1) // Simulate current user ID
const messagesContainerRef = ref<HTMLElement | null>(null)

// Computed properties
const filteredChats = computed(() => {
  if (!searchQuery.value) return chats.value
  return chats.value.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
})

const currentMessages = computed(() => {
  if (selectedChatId.value === null) return []
  const index = chats.value.findIndex((chat) => chat.id === selectedChatId.value)
  return index !== -1 ? messages.value[index] : []
})

const selectedChatName = computed(() => {
  if (selectedChatId.value === null) return 'Выберите чат'
  const chat = chats.value.find((chat) => chat.id === selectedChatId.value)
  return chat ? chat.name : 'Выберите чат'
})

// Functions
const selectChat = (id: number) => {
  selectedChatId.value = id
  scrollToBottom()
}

const sendMessage = () => {
  if (!newMessage.value.trim() || selectedChatId.value === null) return

  const chatIndex = chats.value.findIndex((chat) => chat.id === selectedChatId.value)
  if (chatIndex === -1) return

  const newMsg: Message = {
    id: Date.now(),
    text: newMessage.value,
    timestamp: new Date(),
    senderId: currentUserId.value
  }

  // Add message to current chat
  messages.value[chatIndex] = [...messages.value[chatIndex], newMsg]

  // Update last message in chat
  chats.value[chatIndex].lastMessage = newMsg

  // Clear input
  newMessage.value = ''

  // Auto-scroll to bottom
  nextTick(scrollToBottom)
}

const formatDate = (date: Date) => {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня'
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера'
  } else {
    return date.toLocaleDateString('ru-RU')
  }
}

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight
  }
}

// Watch for new messages and scroll to bottom
watch(
  currentMessages,
  () => {
    nextTick(scrollToBottom)
  },
  { deep: true }
)

// Initialize
onMounted(() => {
  scrollToBottom()
})
</script>

<style scoped>
.messenger-container {
  display: flex;
  height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4edf5 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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

.chat-avatar-small {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4776e6 0%, #8e54e9 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 16px;
  margin-right: 15px;
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
