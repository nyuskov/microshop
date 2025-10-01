<script setup lang="ts">
import Products from './Products.vue';
import Users from './Users.vue';
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
const api_prefix: string = "/api/v1"
let saySomething: string = "Ебал я это ваше программирование!"
console.log(saySomething)
</script>

<template>
  <h1>Hello!</h1>

  <h3>Users:</h3>
  <Users :backendServer="backendServer"></Users>

  <h3>Products:</h3>
  <Products :backendServer="backendServer" :api_prefix="api_prefix"></Products>
</template>

<style scoped></style>
