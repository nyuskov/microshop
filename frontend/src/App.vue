<script setup lang="ts">
import {
  backendServer,
  useAuthStore
} from './stores/auth.ts';
import { Badge, Menu, Button, MenuItem } from 'primevue';
import { ref, type Ref } from 'vue';
import { useRouter, type Router, type RouteRecordNormalized } from 'vue-router';
import FormLogin from './components/FormLogin.vue';
import FormRegister from './components/FormRegister.vue';
import DataTableProduct from './components/DataTableProduct.vue';
import DataTableUser from './components/DataTableUser.vue';

const authStore = useAuthStore();
const router: Router = useRouter();
const routes: RouteRecordNormalized[] = router.getRoutes();
const redirectRegPath = "/auth/register/";
const redirectLoginPath = "/auth/login/";

let isActive: Ref<{
  users: boolean;
  products: boolean;
}, {
  users: boolean;
  products: boolean;
}> = ref(
  {
    "users": false,
    "products": false,
  },
);

let popup: Ref<boolean, boolean> = ref(true);
let saySomething: string = "Ебал я это ваше программирование!";

const items: Array<Object> = [
  {
    label: 'Пользователи',
    icon: 'pi pi-fw pi-user',
  },
  {
    label: 'Товары',
    icon: 'pi pi-fw pi-cart-arrow-down',
  },
  {
    separator: true,
  },
  {
    label: 'Выйти',
    icon: 'pi pi-fw pi-sign-out',
  },
];

function toggleMenu() {
  popup.value = !popup.value;
}

function toggleContent(name: string) {
  let newRoute = routes.find(route => route.name === name);
  if (newRoute && newRoute["path"] === router.currentRoute.value.path) {
    return true;
  } else {
    return false;
  }
}

async function toggleMenuItem(item: MenuItem) {
  isActive.value.users = false;
  isActive.value.products = false;

  if (item["label"] === "Выйти") {
    await authStore.logout();
  } else if (item["label"] === "Пользователи") {
    isActive.value.users = true;
  } else if (item["label"] === "Товары") {
    isActive.value.products = true;
  }

  popup.value = !popup.value;
}

</script>

<template>
  <section v-if="toggleContent('Home')">
    <div v-if="authStore.isAuthenticated">
      <Button type="button" icon="pi pi-ellipsis-v" @click="toggleMenu" aria-haspopup="true"
        aria-controls="overlay_menu" />
      <Menu ref="menu" id="overlay_menu" :model="items" :popup="popup">
        <template #item="{ item, props }">
          <a v-ripple class="flex align-items-center" @click="toggleMenuItem(item)" v-bind="props.action">
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
      <div class="content" v-if="!authStore.isAuthenticated">
        <Button severity="secondary" @click="router.push(redirectRegPath)">Зарегистрироваться</Button>
        <span>или</span>
        <Button severity="secondary" @click="router.push(redirectLoginPath)">Войти</Button>
      </div>
      <div class="content" v-if="authStore.isAuthenticated">
        <DataTableUser v-if="isActive['users']" :backendServer />
        <DataTableProduct v-if="isActive['products']" :backendServer />
      </div>
    </div>
  </section>
  <section v-if="toggleContent('Login')">
    <FormLogin />
  </section>
  <section v-if="toggleContent('Register')">
    <FormRegister />
  </section>
</template>

<style scoped>
/* Content */
.content {
  align-items: center;
  display: flex;
  flex-direction: column;
}
</style>
