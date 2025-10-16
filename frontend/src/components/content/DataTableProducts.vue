<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import { Message } from 'primevue';
import { getItems } from '@/api/items';

const request_path: string = "/api/v1/products/";
let _products: Ref<Array<Record<string, string>>, Array<Record<string, string>>> = ref([]);
let _result: Ref<string, string> = ref("");

onMounted(async function () {
  await getItems(request_path, _products, _result);
})
</script>

<template>
  <h3>Товары:</h3>
  <DataTable :value="_products" tableStyle="min-width: 50rem">
    <Column field="name" header="Name"></Column>
    <Column field="price" header="Price"></Column>
    <Column field="description" header="Description"></Column>
  </DataTable>
  <Message severity="error" v-show="_result">{{ _result }}</Message>
</template>

<style scoped></style>
