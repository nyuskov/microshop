<script setup lang="ts">
import Posts from "./Posts.vue"; // Изменили импорт
import Users from "./Users.vue";
// Удаляем импорт backendServer
// import { backendServer } from '../stores/auth.ts';
import Menubar from "primevue/menubar";
import { InputText, Badge, Menu, Button } from "primevue";
import { ref, type Ref, computed } from "vue"; // Добавлен import computed
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth"; // Импортируем хранилище

// Инициализируем приложение при создании компонента Home
const authStore = useAuthStore();
authStore.initializeApp(); // Вызываем инициализацию

const router = useRouter();
const redirectReg = "/auth/registration/";
const redirectLogin = "/auth/login/";

let isActiveUsers: Ref<boolean> = ref(false);
let isActivePosts: Ref<boolean> = ref(false); // Изменили имя переменной
// let isActiveProducts: Ref<boolean> = ref(false); // Закомментировали старую

// Создаем вычисляемую переменную, связанную с состоянием аутентификации
const isAuthorized = computed(() => authStore.isAuthenticated);

let popup: Ref<boolean> = ref(true);
let saySomething: string = "Ебал я это ваше программирование!";
console.log(saySomething);

const items: Array<Object> = [
  {
    label: "Пользователи",
    icon: "pi pi-fw pi-user",
    command: () => {
      isActiveUsers.value = true;
      isActivePosts.value = false; // Изменили логику
      // isActiveProducts.value = false;
      popup.value = !popup.value;
    },
  },
  {
    label: "Посты", // Изменили название пункта меню
    icon: "pi pi-fw pi-file-edit", // Выбрали подходящую иконку
    command: () => {
      isActiveUsers.value = false;
      isActivePosts.value = true; // Изменили логику
      // isActiveProducts.value = true;
      popup.value = !popup.value;
    },
  },
  {
    separator: true,
  },
  {
    label: "Выйти",
    icon: "pi pi-fw pi-sign-out",
    command: async () => { // Сделан асинхронным
      isActiveUsers.value = false;
      isActivePosts.value = false; // Изменили логику
      // isActiveProducts.value = false;
      // popup.value = !popup.value; // Не меняем popup здесь, если не нужно
      await authStore.logout(router); // Вызов действия logout из стора
    },
  },
];

function toggle() {
  popup.value = !popup.value;
}
</script>

<template>
  <div v-if="isAuthorized">
    <Button
      type="button"
      icon="pi pi-ellipsis-v"
      @click="toggle"
      aria-haspopup="true"
      aria-controls="overlay_menu"
    />
    <Menu ref="menu" id="overlay_menu" :model="items" :popup="popup">
      <template #item="{ item, props }">
        <a v-ripple class="flex align-items-center" v-bind="props.action">
          <span :class="item.icon" />
          <span class="ml-2">{{ item.label }}</span>
          <Badge v-if="item.badge" class="ml-auto" :value="item.badge" />
          <span
            v-if="item.shortcut"
            class="ml-auto border-1 surface-border border-round surface-100 text-xs p-1"
            >{{ item.shortcut }}</span
          >
        </a>
      </template>
    </Menu>
  </div>
  <div class="content">
    <h1>Hello!</h1>
    <div v-if="!isAuthorized">
      <p>
        Добро пожаловать! Пожалуйста, войдите или зарегистрируйтесь для доступа
        к дополнительным возможностям.
      </p>
      <Button severity="secondary" @click="router.push(redirectReg)"
        >Зарегистрироваться</Button
      >
      <span>или</span>
      <Button severity="secondary" @click="router.push(redirectLogin)"
        >Войти</Button
      >
    </div>
    <div v-if="isAuthorized">
      <!-- Компонент Users и новый компонент Posts -->
      <Users :isActiveUsers></Users>
      <Posts v-if="isActivePosts"></Posts> <!-- Отображаем Posts вместо Products -->
    </div>
  </div>
</template>

<style src="../assets/css/style.css" scoped></style>
