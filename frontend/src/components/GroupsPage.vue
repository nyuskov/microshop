<template>
  <div class="groups-container">
    <h1 class="groups-title">Управление Группами</h1>
    <div class="groups-controls">
      <button @click="loadGroups" class="btn btn-refresh">Обновить Группы</button>
      <button @click="showCreateForm = !showCreateForm" class="btn btn-toggle-form">
        {{ showCreateForm ? 'Отмена' : 'Создать Новую Группу' }}
      </button>
    </div>

    <!-- Форма создания -->
    <form v-if="showCreateForm" @submit.prevent="createNewGroup" class="group-form">
      <input v-model="newGroupName" placeholder="Название Группы" required class="form-input" />
      <textarea
        v-model="newGroupDescription"
        placeholder="Описание"
        class="form-textarea"
      ></textarea>
      <button type="submit" class="btn btn-submit">Создать Группу</button>
    </form>

    <!-- Список групп -->
    <div class="groups-list">
      <div v-for="group in groups" :key="group.id" class="group-card">
        <div class="group-header">
          <h3 class="group-name">
            <strong>{{ group.name }}</strong>
          </h3>
          <p class="group-description">{{ group.description }}</p>
        </div>

        <!-- Отображение пользователей в группе -->
        <div v-if="group.users && group.users.length > 0" class="group-users">
          <h4 class="users-subtitle">Пользователи в этой группе:</h4>
          <ul class="users-list">
            <li v-for="user in group.users" :key="user.id" class="user-item">
              {{ user.username }} ({{ user.email }})
            </li>
          </ul>
        </div>
        <div v-else class="no-users">
          <p>В этой группе нет пользователей.</p>
        </div>

        <div class="group-actions">
          <button @click="selectGroupForEdit(group)" class="btn btn-action btn-info">
            Редактировать
          </button>
          <button @click="deleteGroup(group.id)" class="btn btn-action btn-danger">Удалить</button>
          <button @click="selectedGroupForUsers = group" class="btn btn-action btn-manage">
            Управление Пользователями
          </button>
        </div>

        <!-- Форма редактирования для выбранной группы -->
        <form
          v-if="group.id === editingGroupId"
          @submit.prevent="updateExistingGroup(group.id)"
          class="group-edit-form"
        >
          <input v-model="updatedGroupName" placeholder="Новое Название" class="form-input" />
          <textarea
            v-model="updatedGroupDescription"
            placeholder="Новое Описание"
            class="form-textarea"
          ></textarea>
          <button type="submit" class="btn btn-submit">Сохранить Изменения</button>
          <button type="button" @click="editingGroupId = null" class="btn btn-cancel">
            Отмена
          </button>
        </form>

        <!-- Компонент управления пользователями для этой группы -->
        <ManageGroupUsers
          v-if="selectedGroupForUsers && selectedGroupForUsers.id === group.id"
          :selected-group="selectedGroupForUsers"
          @users-updated="handleUsersUpdated"
          @close-requested="handleCloseRequested"
          class="manage-users-inline"
        />
      </div>
    </div>

    <!-- Компонент управления пользователями (ранее был здесь) -->
    <!-- <ManageGroupUsers 
      :selected-group="selectedGroupForUsers" 
      @users-updated="handleUsersUpdated" /> -->

    <div v-if="loading" class="loading">Загрузка...</div>
    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup as apiDeleteGroup
} from '@/services/api'
import type { Group } from '@/types'
import ManageGroupUsers from './ManageGroupUsers.vue' // Импортируем новый компонент

const groups = ref<Group[]>([])
const loading = ref(false)
const error = ref('')
const showCreateForm = ref(false)
const newGroupName = ref('')
const newGroupDescription = ref('')

const editingGroupId = ref<number | null>(null)
const updatedGroupName = ref('')
const updatedGroupDescription = ref('')

const selectedGroupForUsers = ref<Group | null>(null) // Состояние для выбранной группы для управления пользователями

const loadGroups = async () => {
  loading.value = true
  error.value = ''
  try {
    groups.value = await fetchGroups() // fetchGroups уже возвращает группы с пользователями
  } catch (err) {
    error.value = 'Не удалось загрузить группы.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Новая функция-обработчик события
const handleUsersUpdated = (groupId: number) => {
  console.log(`Пользователи в группе ${groupId} были обновлены. Обновляем список групп.`)
  loadGroups() // Обновляем весь список групп
  // Сбрасываем selectedGroupForUsers, чтобы закрыть форму после обновления
  selectedGroupForUsers.value = null
}

// Новая функция-обработчик события закрытия
const handleCloseRequested = () => {
  console.log('Запрос на закрытие формы управления пользователями.')
  // Сбрасываем selectedGroupForUsers, чтобы закрыть форму
  selectedGroupForUsers.value = null
}

const createNewGroup = async () => {
  try {
    const newGroup = await createGroup({
      name: newGroupName.value,
      description: newGroupDescription.value
    })
    groups.value.push(newGroup)
    newGroupName.value = ''
    newGroupDescription.value = ''
    showCreateForm.value = false
  } catch (err) {
    error.value = 'Не удалось создать группу.'
    console.error(err)
  }
}

const selectGroupForEdit = (group: Group) => {
  editingGroupId.value = group.id
  updatedGroupName.value = group.name
  updatedGroupDescription.value = group.description || ''
}

const updateExistingGroup = async (id: number) => {
  try {
    const updatedGroup = await updateGroup(id, {
      name: updatedGroupName.value,
      description: updatedGroupDescription.value
    })
    const index = groups.value.findIndex((g) => g.id === id)
    if (index !== -1) {
      groups.value[index] = updatedGroup
    }
    editingGroupId.value = null
  } catch (err) {
    error.value = 'Не удалось обновить группу.'
    console.error(err)
  }
}

const deleteGroup = async (id: number) => {
  if (!confirm('Вы уверены, что хотите удалить эту группу?')) return
  try {
    await apiDeleteGroup(id)
    groups.value = groups.value.filter((g) => g.id !== id)
  } catch (err) {
    error.value = 'Не удалось удалить группу.'
    console.error(err)
  }
}

onMounted(() => {
  loadGroups()
})
</script>

<style scoped>
.groups-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
  color: var(--text-color); /* Используем глобальный цвет текста */
}

.groups-title {
  text-align: center;
  color: var(--primary-color); /* Используем глобальный primary цвет */
  margin-bottom: 20px;
}

.groups-controls {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 20px;
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color); /* Используем глобальный цвет границы */
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition:
    background-color 0.3s,
    color 0.3s;
  text-decoration: none;
  display: inline-block;
  text-align: center;
  line-height: 1.4;
}

.btn-refresh {
  background-color: var(--primary-color); /* Используем глобальный primary цвет */
  color: white;
}

.btn-refresh:hover {
  background-color: var(--primary-light); /* Используем глобальный lighter primary цвет */
}

.btn-toggle-form {
  background-color: var(--secondary-color); /* Используем глобальный secondary цвет */
  color: black; /* Текст на светлом фоне лучше черный */
}

.btn-toggle-form:hover {
  background-color: #f0d58d; /* Темнее secondary для hover */
}

.btn-action {
  margin-right: 5px;
  color: white;
  border: none; /* Убираем границу для внутренних кнопок */
}

.btn-info {
  background-color: var(--info-color); /* Используем глобальный info цвет */
}

.btn-info:hover {
  background-color: #3a6a87; /* Темнее info для hover */
}

.btn-danger {
  background-color: var(--danger-color); /* Используем глобальный danger цвет */
}

.btn-danger:hover {
  background-color: #d92534; /* Темнее danger для hover */
}

.btn-manage {
  background-color: var(--primary-color); /* Используем primary для управления */
  color: white;
}

.btn-manage:hover {
  background-color: var(--primary-light); /* Используем lighter primary для hover */
}

.btn-submit {
  background-color: var(--success-color); /* Используем глобальный success цвет */
  color: white;
  border: none;
}

.btn-submit:hover {
  background-color: #7a3d10; /* Темнее success для hover */
}

.btn-cancel {
  background-color: var(--text-light); /* Используем светло-серый как нейтральный */
  color: white;
  border: none;
  margin-left: 5px;
}

.btn-cancel:hover {
  background-color: #5a6268; /* Темнее нейтрального для hover */
}

.group-form,
.group-edit-form {
  background-color: var(--surface-color); /* Используем глобальный surface цвет */
  padding: 15px;
  border-radius: 5px;
  margin-bottom: 20px;
  border: 1px solid var(--border-color); /* Добавим границу */
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 8px;
  margin-bottom: 10px;
  border: 1px solid var(--border-color); /* Используем глобальный цвет границы */
  border-radius: 4px;
  box-sizing: border-box;
  background-color: var(--background-color); /* Используем глобальный background цвет */
  color: var(--text-color); /* Используем глобальный цвет текста */
}

.form-textarea {
  height: 80px;
  resize: vertical;
}

.groups-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.group-card {
  border: 1px solid var(--border-color); /* Используем глобальный цвет границы */
  border-radius: 5px;
  padding: 15px;
  background-color: var(--surface-color); /* Используем глобальный surface цвет */
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.group-header {
  margin-bottom: 10px;
}

.group-name {
  margin: 0 0 5px 0;
  color: var(--text-color); /* Используем глобальный цвет текста */
}

.group-description {
  margin: 0;
  color: var(--text-light); /* Используем глобальный light текст */
  font-style: italic;
}

.group-users {
  margin: 10px 0;
}

.users-subtitle {
  font-size: 14px;
  color: var(--text-color); /* Используем глобальный цвет текста */
  margin: 0 0 5px 0;
}

.users-list {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

.user-item {
  padding: 2px 0;
  border-bottom: 1px solid var(--border-color); /* Используем глобальный цвет границы */
}

.no-users {
  margin: 10px 0;
  color: var(--text-light); /* Используем глобальный light текст */
  font-style: italic;
}

/* Стили для компонента ManageGroupUsers внутри карточки */
.manage-users-inline {
  margin-top: 15px; /* Отступ сверху от кнопок/формы редактирования */
  /* padding и border уже определены в стилях самого компонента ManageGroupUsers */
}

.loading,
.error {
  text-align: center;
  padding: 10px;
  margin-top: 20px;
}

.loading {
  color: var(--primary-color); /* Используем глобальный primary цвет */
}

.error {
  color: var(--danger-color); /* Используем глобальный danger цвет */
}
</style>
