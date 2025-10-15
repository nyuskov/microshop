<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import { Message } from 'primevue';
import { getItems } from '../api/items';

let _users: Ref<Array<Record<string, string>>, Array<Record<string, string>>> = ref([]);
let _result: Ref<string, string> = ref("");
const request_path: string = "/api/v1/users/";

onMounted(async function () {
  await getItems(request_path, _users, _result);
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
  <Message severity="error" v-show="_result">{{ _result }}</Message>
</template>

<style scoped></style>
