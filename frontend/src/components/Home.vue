<script setup lang="ts">
import Products from './Products.vue';
import Users from './Users.vue';
import {
  backendServer
} from '../stores/auth.ts';
import Menubar from 'primevue/menubar';
import { InputText, Badge, Menu, Button } from 'primevue';
import { ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const redirectReg = "/auth/registration/";
const redirectLogin = "/auth/login/";
let isActive: Ref<Object, Object> = ref(
  {
    "users": false,
    "products": false,
  },
);
let isAuthorized: Ref<boolean, boolean> = ref(false);
let popup: Ref<boolean, boolean> = ref(true);
let saySomething: string = "Ебал я это ваше программирование!";

const items: Array<Object> = [
  {
    label: 'Пользователи',
    icon: 'pi pi-fw pi-user',
    command: () => {
      isActive.value = {
        "users": true,
        "products": false,
      };
      popup.value = !popup.value;
    }
  },
  {
    label: 'Товары',
    icon: 'pi pi-fw pi-cart-arrow-down',
    command: () => {
      isActive.value = {
        "users": false,
        "products": true,
      };
      popup.value = !popup.value;
    }
  },
  {
    separator: true,
  },
  {
    label: 'Выйти',
    icon: 'pi pi-fw pi-sign-out',
    command: () => {
      isActive.value = {
        "users": false,
        "products": false,
      };
      isAuthorized.value = false;
      popup.value = !popup.value;
    }
  },
];

function toggle() {
  popup.value = !popup.value;
}

</script>

<template>
  <div v-if="isAuthorized">
    <Button type="button" icon="pi pi-ellipsis-v" @click="toggle" aria-haspopup="true" aria-controls="overlay_menu" />
    <Menu ref="menu" id="overlay_menu" :model="items" :popup="popup">
      <template #item="{ item, props }">
        <a v-ripple class="flex align-items-center" v-bind="props.action">
          <span :class="item.icon" />
          <span class="ml-2">{{ item.label }}</span>
          <Badge v-if="item.badge" class="ml-auto" :value="item.badge" />
          <span v-if="item.shortcut" class="ml-auto border-1 surface-border border-round surface-100 text-xs p-1">{{
            item.shortcut }}</span>
        </a>
      </template>
    </Menu>
  </div>
  <div class="content">
    <h1>Hello!</h1>
    <p>{{ saySomething }}</p>
    <div class="content" v-if="!isAuthorized">
      <Button severity="secondary" @click="router.push(redirectReg)">Зарегистрироваться</Button>
      <span>или</span>
      <Button severity="secondary" @click="router.push(redirectLogin)">Войти</Button>
    </div>
    <div class="content" v-if="isAuthorized">
      <Users v-if="isActive['users']" :backendServer></Users>
      <Products v-if="isActive['products']" :backendServer></Products>
    </div>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>
