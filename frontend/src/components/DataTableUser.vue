<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';

const props = defineProps({
  backend_server: Object,
})
let _users: Ref<null, null> = ref(null);
let _result: Ref<string, string> = ref("");
const request_path: string = "/api/v1/users/";

async function getUsersList() {
  if (props.backend_server != undefined) {
    await fetch(
      'https://' + props.backend_server.address + request_path, {
      method: 'GET',
      cache: "reload",
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': props.backend_server.csrf_token
      },

      credentials: 'include',
    }).then(async function (response) {
      _users.value = await response.json();
    }).catch((error) => {
      _result.value = 'Ошибка при выполнении запроса: ' + error;
    });
  }
}

onMounted(async function () {
  // await getUsersList();
  await getUsersList();
})
</script>

<template>
  <h3>Пользователи:</h3>
  <DataTable :value="_users" tableStyle="min-width: 50rem">
    <Column field="username" header="Username"></Column>
    <Column field="email" header="Email"></Column>
    <Column field="first_name" header="First name"></Column>
    <Column field="last_name" header="Last name"></Column>
    <Column field="bio" header="Biography"></Column>
    <Column field="posts" header="Posts"></Column>
  </DataTable>
  <Message severity="error">{{ _result }}</Message>
</template>

<style scoped></style>
