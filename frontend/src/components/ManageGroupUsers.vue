<template>
  <div v-if="selectedGroup" class="manage-users-container">
    <h3 class="manage-users-title">Управление Пользователями в Группе: {{ selectedGroup.name }}</h3>
    <div v-if="loading" class="loading">Загрузка...</div>
    <div v-else class="manage-users-content">
      <!-- Левая колонка: Доступные пользователи -->
      <div class="column-section">
        <h4 class="column-title">Доступные пользователи</h4>
        <select
          id="available-users-select"
          multiple
          v-model="selectedAvailableUsers"
          size="10"
          class="user-select"
        >
          <option v-for="user in availableUsers" :key="user.id" :value="user">
            {{ user.username }} ({{ user.email }})
          </option>
        </select>
      </div>

      <!-- Кнопки управления -->
      <div class="transfer-buttons">
        <button @click="moveToGroup" class="btn btn-transfer" title="Добавить в группу">
          &gt;&gt;
        </button>
        <button @click="moveFromGroup" class="btn btn-transfer" title="Удалить из группы">
          &lt;&lt;
        </button>
      </div>

      <!-- Правая колонка: Пользователи в группе -->
      <div class="column-section">
        <h4 class="column-title">Пользователи в группе</h4>
        <select
          id="group-users-select"
          multiple
          v-model="selectedGroupUsers"
          size="10"
          class="user-select"
        >
          <option v-for="user in groupUsers" :key="user.id" :value="user">
            {{ user.username }} ({{ user.email }})
          </option>
        </select>
      </div>

      <!-- Кнопки действий внизу -->
      <div class="action-buttons">
        <button @click="saveUsersToGroup" class="btn btn-submit">Сохранить изменения</button>
        <button @click="cancelChanges" class="btn btn-cancel">Отмена</button>
      </div>
    </div>
  </div>
  <div v-else class="no-group-selected">
    <p>Пожалуйста, сначала выберите группу.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { fetchAllUsers } from '@/services/api' // Предполагается, что у вас есть функция для получения всех пользователей
import { fetchUsersInGroup, updateUsersInGroup } from '@/services/api'
import { Group, User } from '@/types'

interface Props {
  selectedGroup: Group | null
}

// Определяем события, которые будут эмититься
const emit = defineEmits<{
  usersUpdated: [groupId: number]
  closeRequested: [] // Новое событие для запроса закрытия
}>()

const props = defineProps<Props>()

const loading = ref(false)
// Список всех пользователей
const allUsers = ref<User[]>([])
// Список пользователей, принадлежащих к группе (рабочее состояние)
const groupUsers = ref<User[]>([])
// Список пользователей, принадлежащих к группе при загрузке (для отмены)
const initialGroupUsers = ref<User[]>([])
// Список доступных пользователей (все - пользователи_в_группе)
const availableUsers = computed(() => {
  const groupUserIds = new Set(groupUsers.value.map((u) => u.id))
  return allUsers.value.filter((user) => !groupUserIds.has(user.id))
})
// Выбранные пользователи для перемещения
const selectedAvailableUsers = ref<User[]>([])
const selectedGroupUsers = ref<User[]>([])

// Загрузка всех пользователей и пользователей в группе при выборе группы
watch(
  () => props.selectedGroup,
  async (newGroup) => {
    if (newGroup) {
      loading.value = true
      try {
        // Загружаем всех пользователей
        allUsers.value = await fetchAllUsers()
        // Загружаем пользователей в выбранной группе
        const usersInGroup = await fetchUsersInGroup(newGroup.id)
        // Устанавливаем пользователей в группе
        groupUsers.value = [...usersInGroup] // Создаём копию
        initialGroupUsers.value = [...usersInGroup] // Сохраняем начальное состояние для отмены
        // Сбросим выделение
        selectedAvailableUsers.value = []
        selectedGroupUsers.value = []
      } catch (error) {
        console.error('Failed to load users for group:', error)
      } finally {
        loading.value = false
      }
    } else {
      // Сброс данных, если группа не выбрана
      allUsers.value = []
      groupUsers.value = []
      initialGroupUsers.value = []
      selectedAvailableUsers.value = []
      selectedGroupUsers.value = []
    }
  },
  { immediate: true }
)

// Функция для перемещения из доступных в группу
const moveToGroup = () => {
  // Добавляем выбранных пользователей в groupUsers
  groupUsers.value = [...groupUsers.value, ...selectedAvailableUsers.value]
  // Сбрасываем выделение в левой колонке
  selectedAvailableUsers.value = []
}

// Функция для перемещения из группы в доступные
const moveFromGroup = () => {
  // Фильтруем groupUsers, исключая выбранных
  groupUsers.value = groupUsers.value.filter(
    (user) => !selectedGroupUsers.value.some((selectedUser) => selectedUser.id === user.id)
  )
  // Сбрасываем выделение в правой колонке
  selectedGroupUsers.value = []
}

// Функция для сохранения изменений на сервере
const saveUsersToGroup = async () => {
  if (!props.selectedGroup) return

  // Извлекаем ID пользователей из списка groupUsers
  const userIdsToSet = groupUsers.value.map((user) => user.id)

  try {
    await updateUsersInGroup(props.selectedGroup.id, userIdsToSet)
    // Сообщаем родительскому компоненту, что пользователи в группе были обновлены
    emit('usersUpdated', props.selectedGroup.id)
    // Закрываем форму после успешного сохранения
    emit('closeRequested')
  } catch (error) {
    console.error('Failed to update users in group:', error)
    // Ошибка обрабатывается в GroupsPage.vue через emit
  }
}

// Функция для отмены изменений
const cancelChanges = () => {
  // Восстанавливаем начальное состояние groupUsers
  groupUsers.value = [...initialGroupUsers.value]
  // Сбрасываем выделение
  selectedAvailableUsers.value = []
  selectedGroupUsers.value = []
  // Закрываем форму при отмене
  emit('closeRequested')
}
</script>

<style scoped>
.manage-users-container {
  margin-top: 20px;
  padding: 15px;
  border: 1px solid var(--border-color); /* Используем глобальный цвет границы */
  border-radius: 5px;
  background-color: var(--surface-color); /* Используем глобальный surface цвет */
}

.manage-users-title {
  margin-top: 0;
  color: var(--text-color); /* Используем глобальный цвет текста */
}

.loading {
  color: var(--primary-color); /* Используем глобальный primary цвет */
}

/* Изменяем layout на grid для трёх колонок: доступные | кнопки | в группе и строки с кнопками внизу */
.manage-users-content {
  display: grid;
  grid-template-columns: 1fr auto 1fr; /* Левая колонка, кнопки, правая колонка */
  grid-template-rows: auto 1fr auto; /* Заголовки, списки, кнопки */
  gap: 15px;
  align-items: start; /* Выравнивание элементов по верхнему краю */
}

.column-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
  /* Занимает всю высоту ячейки */
  height: 100%;
}

.column-title {
  font-size: 14px;
  color: var(--text-color); /* Используем глобальный цвет текста */
  margin: 0 0 5px 0;
}

.user-select {
  width: 100%;
  padding: 5px;
  border: 1px solid var(--border-color); /* Используем глобальный цвет границы */
  border-radius: 4px;
  background-color: var(--background-color); /* Используем глобальный background цвет */
  color: var(--text-color); /* Используем глобальный цвет текста */
  font-size: 14px;
  min-height: 200px; /* Минимальная высота для лучшего вида */
  /* Занимает всю доступную высоту */
  height: 100%;
  /* Предотвращает overflow, если элементов много */
  overflow-y: auto;
}

.transfer-buttons {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  /* Выравнивание по центру по вертикали */
  align-self: center;
}

.action-buttons {
  /* Занимает последнюю строку и все три колонки */
  grid-column: 1 / 4; /* С 1-й по 4-ю линию (охватывает 1fr auto 1fr) */
  grid-row: 3;
  display: flex;
  gap: 10px;
  justify-content: flex-start; /* Кнопки прижаты к левому краю */
  margin-top: 15px; /* Отступ сверху */
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

.btn-transfer {
  background-color: var(--primary-color); /* Используем primary цвет для стрелок */
  color: white;
  border: none;
  padding: 10px 15px; /* Больше отступов для удобства */
  font-weight: bold;
}

.btn-transfer:hover {
  background-color: var(--primary-light); /* Темнее primary для hover */
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
}

.btn-cancel:hover {
  background-color: #5a6268; /* Темнее нейтрального для hover */
}

.no-group-selected {
  padding: 10px;
  color: var(--text-light); /* Используем глобальный light текст */
  font-style: italic;
}
</style>
