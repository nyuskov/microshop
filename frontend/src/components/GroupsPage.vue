<template>
  <div>
    <h1>Groups Management</h1>
    <div>
      <button @click="loadGroups">Refresh Groups</button>
      <button @click="showCreateForm = !showCreateForm">
        {{ showCreateForm ? 'Cancel' : 'Create New Group' }}
      </button>
    </div>

    <!-- Форма создания -->
    <form v-if="showCreateForm" @submit.prevent="createNewGroup">
      <input v-model="newGroupName" placeholder="Group Name" required />
      <textarea v-model="newGroupDescription" placeholder="Description"></textarea>
      <button type="submit">Create Group</button>
    </form>

    <!-- Список групп -->
    <ul>
      <li v-for="group in groups" :key="group.id">
        <strong>{{ group.name }}</strong> - {{ group.description }}
        <!-- Отображение пользователей в группе -->
        <div v-if="group.users && group.users.length > 0">
          <h4>Users in this group:</h4>
          <ul>
            <li v-for="user in group.users" :key="user.id">
              {{ user.username }} ({{ user.email }})
            </li>
          </ul>
        </div>
        <div v-else>
          <p>No users in this group.</p>
        </div>
        <div class="group-actions">
          <button @click="selectGroupForEdit(group)">Edit</button>
          <button @click="deleteGroup(group.id)">Delete</button>
          <!-- Новая кнопка для управления пользователями -->
          <button @click="selectedGroupForUsers = group">Manage Users</button>
        </div>

        <!-- Форма редактирования для выбранной группы -->
        <form v-if="group.id === editingGroupId" @submit.prevent="updateExistingGroup(group.id)">
          <input v-model="updatedGroupName" placeholder="New Name" />
          <textarea v-model="updatedGroupDescription" placeholder="New Description"></textarea>
          <button type="submit">Save Changes</button>
          <button type="button" @click="editingGroupId = null">Cancel</button>
        </form>
      </li>
    </ul>

    <!-- Компонент управления пользователями -->
    <ManageGroupUsers 
      :selected-group="selectedGroupForUsers" 
      @users-updated="handleUsersUpdated" />

    <div v-if="loading">Loading...</div>
    <div v-if="error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchGroups, createGroup, updateGroup, deleteGroup } from '@/services/api';
import { Group } from '@/types';
import ManageGroupUsers from './ManageGroupUsers.vue'; // Импортируем новый компонент

const groups = ref<Group[]>([]);
const loading = ref(false);
const error = ref('');
const showCreateForm = ref(false);
const newGroupName = ref('');
const newGroupDescription = ref('');

const editingGroupId = ref<number | null>(null);
const updatedGroupName = ref('');
const updatedGroupDescription = ref('');

const selectedGroupForUsers = ref<Group | null>(null); // Состояние для выбранной группы для управления пользователями

const loadGroups = async () => {
  loading.value = true;
  error.value = '';
  try {
    groups.value = await fetchGroups(); // fetchGroups уже возвращает группы с пользователями
  } catch (err) {
    error.value = 'Failed to load groups.';
    console.error(err);
  } finally {
    loading.value = false;
  }
};

// Новая функция-обработчик события
const handleUsersUpdated = (groupId: number) => {
  console.log(`Users in group ${groupId} were updated. Refreshing groups list.`);
  loadGroups(); // Обновляем весь список групп
};

const createNewGroup = async () => {
  try {
    const newGroup = await createGroup({
      name: newGroupName.value,
      description: newGroupDescription.value,
    });
    groups.value.push(newGroup);
    newGroupName.value = '';
    newGroupDescription.value = '';
    showCreateForm.value = false;
  } catch (err) {
    error.value = 'Failed to create group.';
    console.error(err);
  }
};

const selectGroupForEdit = (group: Group) => {
  editingGroupId.value = group.id;
  updatedGroupName.value = group.name;
  updatedGroupDescription.value = group.description || '';
};

const updateExistingGroup = async (id: number) => {
  try {
    const updatedGroup = await updateGroup(id, {
      name: updatedGroupName.value,
      description: updatedGroupDescription.value,
    });
    const index = groups.value.findIndex(g => g.id === id);
    if (index !== -1) {
      groups.value[index] = updatedGroup;
    }
    editingGroupId.value = null;
  } catch (err) {
    error.value = 'Failed to update group.';
    console.error(err);
  }
};

const deleteGroup = async (id: number) => {
  if (!confirm('Are you sure you want to delete this group?')) return;
  try {
    await deleteGroup(id);
    groups.value = groups.value.filter(g => g.id !== id);
  } catch (err) {
    error.value = 'Failed to delete group.';
    console.error(err);
  }
};

onMounted(() => {
  loadGroups();
});
</script>

<style scoped>
.group-actions {
  margin-top: 5px;
}
</style>