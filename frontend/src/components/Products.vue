<script setup lang="ts">
import { onMounted, ref, type Ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const api_prefix: string = '/api/v1'

interface Product {
  id: number
  name: string
  // добавьте другие поля продукта по мере необходимости
}

const products: Ref<Product[] | null> = ref(null)

async function getProductsList() {
  const backendHost = window.location.hostname
  const backendUrl = `https://${backendHost}:8000`

  const authStore = useAuthStore()
  await authStore.setCsrfToken()

  const csrfToken = getCSRFToken()

  if (csrfToken) {
    await fetch(`${backendUrl}${api_prefix}/products/`, {
      method: 'GET',
      cache: 'reload',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken
      },
      credentials: 'include'
    })
      .then(async function (response) {
        products.value = await response.json()
        console.log(products.value)
      })
      .catch((err) => {
        const error: string = 'An error occurred during get products list : ' + err
        console.log(error)
      })
  } else {
    console.error('Cannot fetch products: CSRF token is missing.')
  }
}

function getCSRFToken() {
  const name = 'csrftoken'
  let cookieValue = null
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';')
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim()
      if (cookie.substring(0, name.length + 1) === name + '=') {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1))
        break
      }
    }
  }
  return cookieValue
}
onMounted(async function () {
  // await getUsersList();
  await getProductsList()
})
</script>

<template>
  <div class="products-container">
    <h2>Продукты</h2>
    <p>Функционал для продуктов будет добавлен позже.</p>
  </div>
</template>

<style scoped>
.products-container {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}
</style>
