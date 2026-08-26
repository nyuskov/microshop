<script setup lang="ts">
import { onMounted, ref, type Ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import { useAuthStore } from "../stores/auth";

const props = defineProps({
  isActiveProducts: Boolean,
});

const api_prefix: string = "/api/v1";
let products: Ref<any[] | null> = ref(null);

async function getProductsList() {
  const backendHost = window.location.hostname;
  const backendUrl = `https://${backendHost}:8000`;

  const authStore = useAuthStore();
  await authStore.setCsrfToken();

  const csrfToken = getCSRFToken();

  if (csrfToken) {
    await fetch(`${backendUrl}${api_prefix}/products/`, {
      method: "GET",
      cache: "reload",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken,
      },
      credentials: "include",
    })
      .then(async function (response) {
        products.value = await response.json();
        console.log(products.value);
      })
      .catch((err) => {
        let error: string =
          "An error occurred during get products list : " + err;
        console.log(error);
      });
  } else {
    console.error("Cannot fetch products: CSRF token is missing.");
  }
}

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
  // await getUsersList();
  await getProductsList();
});
</script>

<template>
  <h3 v-if="isActiveProducts">Товары:</h3>
  <DataTable
    v-if="isActiveProducts"
    :value="products"
    tableStyle="min-width: 50rem"
  >
    <Column field="name" header="Name"></Column>
    <Column field="price" header="Price"></Column>
    <Column field="description" header="Description"></Column>
  </DataTable>
</template>

<style scoped></style>
