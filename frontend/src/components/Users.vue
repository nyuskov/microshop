<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';

const props = defineProps({
  backendServer: Object,
  isActiveUsers: Boolean,
})

let users: Ref<null, null> = ref(null);
const api_prefix: string = "/api/v1";

async function getUsersList() {
  if (props.backendServer != undefined) {
    await fetch(
      'https://' + props.backendServer.address + api_prefix + '/users/', {
      method: 'GET',
      cache: "reload",
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': props.backendServer.csrfToken
      },

      credentials: 'include',
    }).then(async function (response) {
      users.value = await response.json();
      console.log(users.value);
    }).catch((err) => {
      let error: string = 'An error occurred during get users list : ' + err;
      console.log(error);
    });
  }
}
onMounted(async function () {
  // await getUsersList();
  await getUsersList();
})
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
