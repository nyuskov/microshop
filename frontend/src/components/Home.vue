<script setup lang="ts">
import Products from './Products.vue';
import Users from './Users.vue';
import {
  backendServer
} from '../stores/auth.ts';

let saySomething: string = "Ебал я это ваше программирование!";
console.log(saySomething);
</script>

<template>
  <div class="content">
    <h1>Hello!</h1>

    <h3>Пользователи:</h3>
    <Users :backendServer="backendServer"></Users>

    <h3>Товары:</h3>
    <Products :backendServer="backendServer"></Products>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>
