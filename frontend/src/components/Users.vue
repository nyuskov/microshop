<script setup lang="ts">
import { onMounted, ref, type Ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import { useAuthStore } from "../stores/auth"; // Импортируем хранилище
// Удаляем импорт getCSRFToken

// Удаляем пропсы, связанные с backendServer
defineProps({
  isActiveUsers: Boolean,
});

let users: Ref<null, null> = ref(null);
const api_prefix: string = "/api/v1";

async function getUsersList() {
  // Получаем адрес бэкенда динамически
  const backendHost = window.location.hostname;
  const backendUrl = `https://${backendHost}:8000`; // Предполагаем HTTPS для бэкенда, если фронтенд на HTTPS

  // Получаем экземпляр хранилища
  const authStore = useAuthStore();

  // Получаем JWT-токен из хранилища
  const accessToken = authStore.accessToken;

  // Проверяем, есть ли токен
  if (!accessToken) {
    console.error("Cannot fetch users: Access token is missing.");
    return;
  }

  // Выполняем fetch с Authorization заголовком
  await fetch(`${backendUrl}${api_prefix}/users/`, {
    method: "GET",
    cache: "reload",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`, // Используем JWT-токен
    },
    credentials: "include", // Оставляем, если нужны куки
  })
    .then(async function (response) {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      users.value = await response.json();
      console.log(users.value);
    })
    .catch((err) => {
      let error: string = "An error occurred during get users list : " + err;
      console.log(error);
    });
}

// Удаляем локальную копию функции getCSRFToken

onMounted(async function () {
  await getUsersList();
});
</script>

<template>
  <h3 v-if="isActiveUsers">Пользователи:</h3>
  <DataTable v-if="isActiveUsers" :value="users" tableStyle="min-width: 50rem">
    <Column field="username" header="Username"></Column>
    <Column field="email" header="Email"></Column>
    <Column field="first_name" header="First name"></Column>
    <Column field="last_name" header="Last name"></Column>
    <Column field="bio" header="Biography"></Column>
    <Column field="posts" header="Posts"></Column>
  </DataTable>
</template>

<style scoped></style>
