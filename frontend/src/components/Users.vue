<script setup lang="ts">
import { onMounted, ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import { useAuthStore } from "../stores/auth";

const authStore = useAuthStore();
const users = ref(null);
const api_prefix = "/api/v1";

async function getUsersList() {
  const backendHost = window.location.hostname;
  const backendUrl = `https://${backendHost}:8000`;
  
  const accessToken = authStore.accessToken;
  
  if (!accessToken) {
    console.error("Cannot fetch users: Access token is missing.");
    return;
  }

  try {
    const response = await fetch(`${backendUrl}${api_prefix}/users/`, {
      method: "GET",
      cache: "reload",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: "include",
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    users.value = await response.json();
    console.log(users.value);
  } catch (err) {
    console.error("An error occurred during get users list:", err);
  }
}

onMounted(async () => {
  await getUsersList();
});
</script>

<template>
  <div v-if="users" class="users-section">
    <h3>Пользователи:</h3>
    <DataTable :value="users" tableStyle="min-width: 50rem">
      <Column field="username" header="Username"></Column>
      <Column field="email" header="Email"></Column>
      <Column field="first_name" header="First name"></Column>
      <Column field="last_name" header="Last name"></Column>
      <Column field="bio" header="Biography"></Column>
      <Column field="posts" header="Posts"></Column>
    </DataTable>
  </div>
</template>

<style scoped>
.users-section {
  padding: 1rem;
}

/* DataTable styles are handled by PrimeVue theme */
</style>