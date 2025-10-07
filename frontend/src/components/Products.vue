<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';

const props = defineProps({
  backendServer: Object,
  isActiveProducts: Boolean,
})

const api_prefix: string = "/api/v1";
let products: Ref<null, null> = ref(null)

async function getProductsList() {
  if (props.backendServer != undefined) {
    await fetch(
      'https://' + props.backendServer.address + api_prefix + '/products/', {
      method: 'GET',
      cache: "reload",
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': props.backendServer.csrfToken
      },

      credentials: 'include',
    }).then(async function (response) {
      products.value = await response.json();
      console.log(products.value);
    }).catch((err) => {
      let error: string = 'An error occurred during get products list : ' + err;
      console.log(error);
    });
  }
}
onMounted(async function () {
  // await getUsersList();
  await getProductsList();
})
</script>

<template>
  <h3 v-if="isActiveProducts">Товары:</h3>
  <DataTable v-if="isActiveProducts" :value="products" tableStyle="min-width: 50rem">
    <Column field="name" header="Name"></Column>
    <Column field="price" header="Price"></Column>
    <Column field="description" header="Description"></Column>
  </DataTable>
</template>

<style scoped></style>
