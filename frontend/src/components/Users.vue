<script setup lang="ts">
import { onMounted, ref, type Ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import { useAuthStore } from "../stores/auth"; // Импортируем хранилище

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

  // Убеждаемся, что CSRF токен установлен
  await authStore.setCsrfToken();

  // Получаем токен
  const csrfToken = getCSRFToken(); // Используем функцию из auth.ts

  if (csrfToken) {
    await fetch(`${backendUrl}${api_prefix}/users/`, {
      method: "GET",
      cache: "reload",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken,
      },
      credentials: "include",
    })
      .then(async function (response) {
        users.value = await response.json();
        console.log(users.value);
      })
      .catch((err) => {
        let error: string = "An error occurred during get users list : " + err;
        console.log(error);
      });
  } else {
    console.error("Cannot fetch users: CSRF token is missing.");
  }
}

// Функция для получения CSRF токена, скопирована из auth.ts
function getCSRFToken() {
  const name = "csrftoken";
  let cookieValue = null;
  if (document.cookie && document.cookie !== "") {
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === name + "=") {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

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
