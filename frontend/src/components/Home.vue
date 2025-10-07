<script setup lang="ts">
import Products from './Products.vue';
import Users from './Users.vue';
import {
  backendServer
} from '../stores/auth.ts';
import Menubar from 'primevue/menubar';
import { InputText, Badge } from 'primevue';
import { ref, type Ref } from 'vue';

let isActiveUsers: Ref<boolean, boolean> = ref(false);
let isActiveProducts: Ref<boolean, boolean> = ref(false);
let saySomething: string = "Ебал я это ваше программирование!";
console.log(saySomething);

const items: Array<Object> = [
  {
    label: 'Users',
    icon: 'pi pi-fw pi-user',
    command: () => { isActiveUsers.value = true; isActiveProducts.value = false; }
  },
  {
    label: 'Products',
    icon: 'pi pi-fw pi-user',
    command: () => { isActiveUsers.value = false; isActiveProducts.value = true; }
  },
];

</script>

<template>
  <Menubar :model="items">
    <template #item="{ item, props, hasSubmenu, root }">
      <a class="flex align-items-center" v-bind="props.action">
        <span :class="item.icon" />
        <span class="ml-2">{{ item.label }}</span>
        <Badge v-if="item.badge" :class="{ 'ml-auto': !root, 'ml-2': root }" :value="item.badge" />
        <span v-if="item.shortcut" class="ml-auto border-1 surface-border border-round surface-100 text-xs p-1">{{
          item.shortcut }}</span>
        <i v-if="hasSubmenu"
          :class="['pi pi-angle-down', { 'pi-angle-down ml-2': root, 'pi-angle-right ml-auto': !root }]"></i>
      </a>
    </template>
  </Menubar>
  <div class="content">
    <h1>Hello!</h1>
    <Users :isActiveUsers :backendServer></Users>
    <Products :isActiveProducts :backendServer></Products>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>
