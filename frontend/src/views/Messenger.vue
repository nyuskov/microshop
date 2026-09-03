<template>
  <div class="messenger-layout">
    <div class="chat-list">
      <h3>Чаты</h3>
      <ul>
        <li v-for="chat in chats" :key="chat.id" @click="selectChat(chat)">
          {{ chat.name }}
        </li>
      </ul>
      <button @click="createNewChat">Создать чат</button>
    </div>
    <div class="chat-window">
      <div v-if="selectedChat" class="messages-container">
        <h4>{{ selectedChat.name }}</h4>
        <div class="messages">
          <div v-for="message in messages" :key="message.id" class="message">
            <strong>{{ message.user_id }}:</strong> {{ message.text }}
          </div>
        </div>
        <div class="input-area">
          <input v-model="newMessageText" placeholder="Введите сообщение..." />
          <button @click="sendMessage">Отправить</button>
        </div>
      </div>
      <div v-else class="no-chat-selected">
        <p>Выберите чат для просмотра сообщений</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
// Подключаем реальный сервис
import {
  fetchChats,
  fetchMessages,
  sendNewMessage,
  createChat as apiCreateChat
} from '@/services/chatService'
// Импортируем типы
import type { Chat, Message } from '@/types'

const chats = ref<Chat[]>([])
const messages = ref<Message[]>([])
const selectedChat = ref<Chat | null>(null)
const newMessageText = ref('')

const loadChats = async () => {
  try {
    chats.value = await fetchChats()
  } catch (error) {
    console.error('Ошибка загрузки чатов:', error)
  }
}

const loadMessages = async (chatId: number) => {
  try {
    messages.value = await fetchMessages(chatId)
  } catch (error) {
    console.error(`Ошибка загрузки сообщений для чата ${chatId}:`, error)
  }
}

const selectChat = (chat: Chat) => {
  selectedChat.value = chat
  loadMessages(chat.id)
}

const sendMessage = async () => {
  if (newMessageText.value.trim() && selectedChat.value) {
    try {
      const newMsgPayload = {
        text: newMessageText.value,
        user_id: 1, // Заглушка, должна быть реальная сессия
        chat_id: selectedChat.value.id
      }
      const newMsg = await sendNewMessage(newMsgPayload)
      messages.value.push(newMsg)
      newMessageText.value = ''
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error)
    }
  }
}

const createNewChat = async () => {
  const newName = prompt('Введите название нового чата:')
  if (newName) {
    try {
      const newChatPayload = { name: newName }
      const newChat = await apiCreateChat(newChatPayload)
      chats.value.push(newChat)
    } catch (error) {
      console.error('Ошибка создания чата:', error)
    }
  }
}

onMounted(() => {
  loadChats()
})
</script>

<style scoped>
.messenger-layout {
  display: flex;
  height: 100vh;
}

.chat-list {
  width: 250px;
  border-right: 1px solid #ccc;
  padding: 1rem;
  display: flex;
  flex-direction: column;
}

.chat-list ul {
  list-style-type: none;
  padding: 0;
}

.chat-list li {
  padding: 0.5rem;
  cursor: pointer;
  border-bottom: 1px solid #eee;
}

.chat-list li:hover {
  background-color: #f0f0f0;
}

.chat-window {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.messages-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  border-bottom: 1px solid #eee;
}

.message {
  margin-bottom: 0.5rem;
  padding: 0.5rem;
  background-color: #f9f9f9;
  border-radius: 4px;
}

.input-area {
  padding: 1rem;
  display: flex;
}

.input-area input {
  flex: 1;
  padding: 0.5rem;
  margin-right: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.input-area button {
  padding: 0.5rem 1rem;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.no-chat-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-style: italic;
  color: #888;
}
</style>
