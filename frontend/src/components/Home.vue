<script setup lang="ts">
import Products from './Products.vue';
import Users from './Users.vue';
import Login from './Login.vue';
import {
  getAddress,
  getCSRFToken
} from '../stores/auth.ts';

type BackendServer = {
  address: string | null,
  csrfToken: string,
}
const backendServer: BackendServer = {
  address: getAddress(),
  csrfToken: getCSRFToken(),
}
const api_prefix: string = "/api/v1";
let saySomething: string = "Ебал я это ваше программирование!";
console.log(saySomething);
</script>

<template>
  <div class="content">
    <h1>Hello!</h1>

    <h3>Регистрация:</h3>
    <Login :backendServer="backendServer"></Login>

    <h3>Пользователи:</h3>
    <Users :backendServer="backendServer"></Users>

    <h3>Товары:</h3>
    <Products :backendServer="backendServer" :api_prefix="api_prefix"></Products>
  </div>
</template>

<style scoped>
.content {
  align-items: center;
  display: flex;
  flex-direction: column;
}
</style>
