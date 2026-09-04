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
      <button @click="saveSettings" class="save-btn">Сохранить</button>
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

const settings = reactive<Settings>({
  username: '',
  email: '',
  theme: 'light'
})

const saveSettings = () => {
  // Save settings logic would go here
  console.log('Settings saved:', settings)
  alert('Настройки сохранены!')
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

.save-btn {
  background-color: #007bff;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  width: fit-content;
}

.save-btn:hover {
  background-color: #0056b3;
}
</style>
