<template>
  <div v-if="!authStore.isAdmin" class="access-denied">
    <h3>Доступ запрещён</h3>
    <p>Только суперадминистраторы могут просматривать группы.</p>
  </div>

  <div v-else-if="groups" class="groups-section">
    <h3>Группы:</h3>
    <DataTable :value="groups" tableStyle="min-width: 50rem">
      <Column field="id" header="ID"></Column>
      <Column field="name" header="Name"></Column>
      <Column field="description" header="Description"></Column>
    </DataTable>
  </div>

  <div v-else-if="loading" class="loading">
    <h3>Загрузка...</h3>
  </div>

  <div v-else class="error">
    <h3>Ошибка при загрузке групп.</h3>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import { useAuthStore } from "../stores/auth";
import { groupApi } from "../services/api";

const authStore = useAuthStore();
const groups = ref(null);
const loading = ref(true);
const error = ref(null);

async function loadGroups() {
  if (!authStore.isAdmin) {
    console.error("Access denied: User is not an admin.");
    return;
  }

  try {
    groups.value = await groupApi.fetchGroups();
    console.log(groups.value);
  } catch (err) {
    console.error("An error occurred during fetch groups:", err);
    error.value = err;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadGroups();
});
</script>

<style scoped>
.groups-section {
  padding: 1rem;
}

.access-denied,
.loading,
.error {
  padding: 1rem;
  text-align: center;
}
</style>