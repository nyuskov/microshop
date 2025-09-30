<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';

const props = defineProps({
  backendServer: Object,
})

let products: Ref<null, null> = ref(null)

async function getProductsList() {
  await fetch(
    'http://' + props.backendServer.address + '/api/v1/products/', {
    method: 'GET',
    cache: "reload",
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': props.backendServer.csrfToken
    },

    credentials: 'include',
  }).then(async function (response) {
    products.value = await response.json();
    console.log(products);
  }).catch((err) => {
    let error: string = 'An error occurred during get products list : ' + err;
    console.log(error);
  });
}
onMounted(async function () {
  // await getUsersList();
  await getProductsList();
})
</script>

<template>
  <DataTable :value="products" tableStyle="min-width: 50rem">
    <Column field="name" header="Name"></Column>
    <Column field="price" header="Price"></Column>
    <Column field="description" header="Description"></Column>
  </DataTable>
</template>

<style scoped></style>
