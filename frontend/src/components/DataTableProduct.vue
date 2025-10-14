<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';

const props = defineProps({
  backend_server: Object,
})
const request_path: string = "/api/v1/products/";
let _products: Ref<null, null> = ref(null);
let _result: Ref<string, string> = ref("");

async function getProductsList() {
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
      _products.value = await response.json();
    }).catch((error) => {
      _result.value = 'Ошибка при выполнении запроса: ' + error;
    });
  }
}

onMounted(async function () {
  // await getUsersList();
  await getProductsList();
})
</script>

<template>
  <h3>Товары:</h3>
  <DataTable :value="_products" tableStyle="min-width: 50rem">
    <Column field="name" header="Name"></Column>
    <Column field="price" header="Price"></Column>
    <Column field="description" header="Description"></Column>
  </DataTable>
  <Message severity="error">{{ _result }}</Message>
</template>

<style scoped></style>
