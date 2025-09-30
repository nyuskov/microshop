<script setup lang="ts">
import Products from './Products.vue';
import {
  getAddress,
  getCSRFToken
} from '../stores/auth.ts'
type BackendServer = {
  address: string | null,
  csrfToken: string,
}
const backendServer: BackendServer = {
  address: getAddress(),
  csrfToken: getCSRFToken(),
}
let saySomething: string = "Ебал я это ваше программирование!"
console.log(saySomething)
</script>

<template>
  <h1>Hello!</h1>
  <h3>Products:</h3>
  <Products :backendServer="backendServer"></Products>
</template>

<style scoped></style>
