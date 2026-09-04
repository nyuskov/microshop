<template>
  <div class="settings-container">
    <h1>Настройки</h1>
    <div class="settings-content">
      <div class="setting-item">
        <label for="username">Имя пользователя:</label>
        <input type="text" id="username" v-model="settings.username" />
      </div>
      <div class="setting-item">
        <label for="email">Email:</label>
        <input type="email" id="email" v-model="settings.email" />
      </div>
      <div class="setting-item">
        <label for="theme">Тема:</label>
        <select id="theme" v-model="settings.theme">
          <option value="light">Светлая</option>
          <option value="dark">Темная</option>
        </select>
      </div>
      <div class="button-group">
        <button @click="saveSettings" class="save-btn">Сохранить</button>
        <button @click="closeModal" class="cancel-btn">Отмена</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue'

interface Settings {
  username: string
  email: string
  theme: string
}

// Define emits
const emit = defineEmits(['close-modal'])

const settings = reactive<Settings>({
  username: '',
  email: '',
  theme: 'light'
})

const saveSettings = () => {
  // Save settings logic would go here
  console.log('Settings saved:', settings)
  alert('Настройки сохранены!')
  emit('close-modal')
}

const closeModal = () => {
  emit('close-modal')
}

onMounted(() => {
  // Load settings logic would go here
  console.log('Loading settings...')
})
</script>

<style scoped>
.settings-container {
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-item label {
  font-weight: bold;
  margin-bottom: 5px;
}

.setting-item input,
.setting-item select {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.button-group {
  display: flex;
  gap: 10px;
}

.save-btn,
.cancel-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  width: fit-content;
}

.save-btn {
  background-color: #007bff;
  color: white;
}

.save-btn:hover {
  background-color: #0056b3;
}

.cancel-btn {
  background-color: #6c757d;
  color: white;
}

.cancel-btn:hover {
  background-color: #5a6268;
}
</style>
