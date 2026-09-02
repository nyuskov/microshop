<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useAuthStore } from '../stores/auth'
import { fetchUserGroups } from '@/services/api' // Импортируем новую функцию
import { User } from '@/types' // Импортируем обновлённый тип User

const authStore = useAuthStore()
// Тип ExtendedUser теперь просто User, так как он обновлён
type ExtendedUser = User & { groups?: import('@/types').Group[] }
const users = ref<ExtendedUser[] | null>(null)
const api_prefix = '/api/v1'

async function getUsersList() {
  const backendHost = window.location.hostname
  const backendUrl = `https://${backendHost}:8000`

  const accessToken = authStore.accessToken

  if (!accessToken) {
    console.error('Cannot fetch users: Access token is missing.')
    return
  }

  try {
    const response = await fetch(`${backendUrl}${api_prefix}/users/`, {
      method: 'GET',
      cache: 'reload',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      credentials: 'include'
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const usersData: ExtendedUser[] = await response.json()
    console.log(usersData)

    // Для каждого пользователя загрузим его группы
    const usersWithGroups = await Promise.all(
      usersData.map(async (user) => {
        try {
          const userGroups = await fetchUserGroups(user.id)
          return { ...user, groups: userGroups } // Добавляем поле groups к пользователю
        } catch (groupErr) {
          console.error(`Failed to load groups for user ${user.id}:`, groupErr)
          return { ...user, groups: [] } // В случае ошибки присваиваем пустой список
        }
      })
    )

    users.value = usersWithGroups
    console.log(users.value)
  } catch (err) {
    console.error('An error occurred during get users list:', err)
  }
}

onMounted(async () => {
  await getUsersList()
})
</script>

<template>
  <div v-if="users" class="users-section">
    <h3>Пользователи:</h3>
    <DataTable :value="users" tableStyle="min-width: 50rem">
      <Column field="username" header="Username"></Column>
      <Column field="email" header="Email"></Column>
      <!-- Отображение полей из profile -->
      <Column field="profile.first_name" header="First Name"></Column>
      <Column field="profile.last_name" header="Last Name"></Column>
      <Column field="profile.bio" header="Bio"></Column>
      <!-- Отображение количества постов или первых N символов -->
      <Column field="posts" header="Posts Count">
        <template #body="{ data }">
          {{ data.posts.length }}
        </template>
      </Column>
      <!-- Новая колонка для отображения групп -->
      <Column field="groups" header="Groups">
        <template #body="{ data }">
          <span v-if="data.groups && data.groups.length > 0">
            {{ data.groups.map((g) => g.name).join(', ') }}
          </span>
          <span v-else> No groups </span>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.users-section {
  padding: 1rem;
}

/* DataTable styles are handled by PrimeVue theme */
</style>
