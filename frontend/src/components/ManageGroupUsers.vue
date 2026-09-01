<template>
  <div v-if="selectedGroup">
    <h3>Manage Users in Group: {{ selectedGroup.name }}</h3>
    <div v-if="loading">Loading...</div>
    <div v-else>
      <div>
        <label>Select Users:</label>
        <select multiple v-model="selectedUserIds" size="10">
          <option v-for="user in allUsers" :key="user.id" :value="user.id">
            {{ user.username }} ({{ user.email }})
          </option>
        </select>
      </div>
      <button @click="saveUsersToGroup">Save Users to Group</button>
    </div>
  </div>
  <div v-else>
    <p>Please select a group first.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { fetchAllUsers } from '@/services/api'; // Предполагается, что у вас есть функция для получения всех пользователей
import { fetchUsersInGroup, updateUsersInGroup } from '@/services/api';
import { Group, User } from '@/types';

interface Props {
  selectedGroup: Group | null;
}

const emit = defineEmits<{
  usersUpdated: [groupId: number];
}>();

const props = defineProps<Props>();

const loading = ref(false);
const allUsers = ref<User[]>([]);
const selectedUserIds = ref<number[]>([]);

// Загрузка всех пользователей и пользователей в группе при выборе группы
watch(() => props.selectedGroup, async (newGroup) => {
  if (newGroup) {
    loading.value = true;
    try {
      // Загружаем всех пользователей
      allUsers.value = await fetchAllUsers();
      // Загружаем пользователей в выбранной группе
      const usersInGroup = await fetchUsersInGroup(newGroup.id);
      // Устанавливаем выбранные ID как ID пользователей в группе, фильтруя некорректные значения
      // Проверяем, что u.id существует и является числом
      selectedUserIds.value = usersInGroup
        .map(u => u.id) // Извлекаем id
        .filter(id => typeof id === 'number' && Number.isInteger(id)); // Фильтруем только целые числа
    } catch (error) {
      console.error('Failed to load users for group:', error);
      // Опционально: установить сообщение об ошибке
      // error.value = 'Failed to load users for group.'; (потребуется добавить ref для error)
    } finally {
      loading.value = false;
    }
  } else {
    // Сброс данных, если группа не выбрана
    allUsers.value = [];
    selectedUserIds.value = [];
  }
}, { immediate: true }); // immediate: true запустит watch при создании компонента

const saveUsersToGroup = async () => {
  if (!props.selectedGroup) return;

  // Дополнительно проверим перед отправкой
  const validUserIds = selectedUserIds.value.filter(id => typeof id === 'number' && Number.isInteger(id));

  if (validUserIds.length !== selectedUserIds.value.length) {
    console.warn('Some selected user IDs were invalid and have been filtered out.', selectedUserIds.value, validUserIds);
  }

  try {
    await updateUsersInGroup(props.selectedGroup.id, validUserIds); // Отправляем отфильтрованные ID
    alert('Users successfully updated in group!');
    // Сообщаем родительскому компоненту, что пользователи в группе были обновлены
    emit('usersUpdated', props.selectedGroup.id);
  } catch (error) {
    console.error('Failed to update users in group:', error);
    alert('An error occurred while updating users.');
  }
};
</script>

<style scoped>
/* Добавьте стили по желанию */
</style>