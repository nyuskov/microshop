<script setup lang="ts">
import Posts from './Posts.vue'
import Users from './Users.vue'
import GroupsPage from './GroupsPage.vue'
import Toolbar from 'primevue/toolbar'
import Sidebar from 'primevue/sidebar'
import PanelMenu from 'primevue/panelmenu'
import { Button } from 'primevue'
import { ref, type Ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
// Импортируем компонент модалки логина
import LoginModal from './LoginModal.vue'

const authStore = useAuthStore()
authStore.initializeApp()

const themeStore = useThemeStore()
const router = useRouter()
const redirectReg = '/auth/registration/'
const redirectLogin = '/auth/login/'

// State for active components
const isActiveUsers: Ref<boolean> = ref(false)
const isActivePosts: Ref<boolean> = ref(false)
const isActiveGroups: Ref<boolean> = ref(false)

const isAuthorized = computed(() => authStore.isAuthenticated)
const isAdmin = computed(() => authStore.isAdmin)

// State for the drawer (sidebar menu)
const drawerVisible = ref(false)

// State for login modal
const showLoginModal = ref(false)

// Define menu items as a single root panel for PanelMenu
const menuItems = computed(() => {
  const baseItems = [
    {
      label: 'Навигация',
      items: [
        ...(isAdmin.value
          ? [
              {
                label: 'Пользователи',
                icon: 'pi pi-fw pi-user',
                command: () => {
                  isActiveUsers.value = true
                  isActivePosts.value = false
                  isActiveGroups.value = false
                  drawerVisible.value = false
                }
              },
              {
                label: 'Группы',
                icon: 'pi pi-fw pi-users',
                command: () => {
                  isActiveGroups.value = true
                  isActiveUsers.value = false
                  isActivePosts.value = false
                  drawerVisible.value = false
                }
              }
            ]
          : []),
        {
          label: 'Посты',
          icon: 'pi pi-fw pi-file-edit',
          command: () => {
            isActiveUsers.value = false
            isActivePosts.value = true
            isActiveGroups.value = false
            drawerVisible.value = false
          }
        }
      ]
    },
    {
      label: 'Настройки',
      items: [
        {
          label: 'Настройки профиля',
          icon: 'pi pi-user-edit',
          command: () => {
            router.push('/user-profile')
            drawerVisible.value = false
          }
        },
        {
          label: `Тема (${themeStore.currentTheme})`,
          icon: themeStore.currentTheme === 'light' ? 'pi pi-sun' : 'pi pi-moon',
          command: () => {
            themeStore.toggleTheme()
          }
        },
        {
          label: 'Выйти',
          icon: 'pi pi-fw pi-sign-out',
          command: async () => {
            isActiveUsers.value = false
            isActivePosts.value = false
            isActiveGroups.value = false
            await authStore.logout(router)
            drawerVisible.value = false
          }
        }
      ]
    }
  ]
  return baseItems
})

// Function to toggle the drawer visibility
function toggleDrawer() {
  drawerVisible.value = !drawerVisible.value
}

// Function to close the drawer
function closeDrawer() {
  drawerVisible.value = false
}

// Функция для открытия модалки логина
function openLoginModal() {
  if (!authStore.isAuthenticated) {
    showLoginModal.value = true
  }
}

// Функция для закрытия модалки логина
function closeLoginModal() {
  showLoginModal.value = false
}

// Следим за изменением статуса аутентификации
import { watch } from 'vue'
watch(
  () => authStore.isAuthenticated,
  (isAuth) => {
    if (isAuth) {
      // Если пользователь аутентифицировался, закрываем модалку
      showLoginModal.value = false
      // Если пользователь только что вошел, можно показать приветствие
      console.log('User authenticated successfully!')
    }
  }
)

// При монтировании проверяем, нужно ли показать модалку
import { onMounted } from 'vue'
onMounted(() => {
  // Если пользователь не аутентифицирован, но пытается зайти на защищенную страницу
  // можно автоматически открыть модалку, но лучше это делать через роутер
  const path = router.currentRoute.value.path
  if (!authStore.isAuthenticated && path !== '/auth/login/' && path !== '/auth/registration/') {
    // Например, если пользователь на главной странице и не авторизован
    // showLoginModal.value = true // Раскомментируйте, если нужно автоматически показывать модалку
  }
})
</script>

<template>
  <div class="layout-wrapper">
    <!-- Top Toolbar with a permanent menu button -->
    <header v-if="isAuthorized" class="top-toolbar">
      <Toolbar>
        <template #start>
          <!-- Hamburger button to toggle the drawer -->
          <Button
            icon="pi pi-bars"
            @click="toggleDrawer"
            class="p-2 m-1"
            severity="warning"
            text
            rounded
          />
        </template>

        <template #center>
          <!-- Можно добавить заголовок страницы -->
        </template>

        <template #end>
          <!-- Кнопка для выхода (можно добавить для удобства) -->
          <Button
            icon="pi pi-sign-out"
            @click="authStore.logout(router)"
            severity="danger"
            text
            rounded
            label="Выйти"
          />
        </template>
      </Toolbar>
    </header>

    <!-- Sliding Drawer Menu (Sidebar) -->
    <Sidebar
      v-if="isAuthorized"
      v-model:visible="drawerVisible"
      :pt="{
        root: { class: 'custom-sidebar-root' },
        content: { class: 'custom-sidebar-content' }
      }"
      position="left"
    >
      <PanelMenu :model="menuItems" class="p-0 border-0 bg-transparent" />
    </Sidebar>

    <!-- Main content area -->
    <main class="main-content" @click="closeDrawer" v-if="isAuthorized">
      <div class="content">
        <h1 class="text-center">Hello!</h1>
        <!-- Show Users, Posts, or Groups based on state, exclusively -->
        <Users
          v-if="isActiveUsers && !isActivePosts && !isActiveGroups"
          :isActiveUsers="isActiveUsers"
        ></Users>
        <Posts v-if="isActivePosts && !isActiveUsers && !isActiveGroups"></Posts>
        <GroupsPage v-if="isActiveGroups && !isActiveUsers && !isActivePosts"></GroupsPage>

        <!-- Optional: Default message when no specific view is selected -->
        <div
          v-if="!isActiveUsers && !isActivePosts && !isActiveGroups"
          class="default-view-message text-center p-4"
        >
          <p>Выберите "Посты", "Пользователи" или "Группы" в меню.</p>
        </div>
      </div>
    </main>

    <!-- Content for non-authorized users -->
    <main v-if="!isAuthorized" class="main-content-unauthorized">
      <div class="content">
        <h1 class="text-center">Hello!</h1>
        <div class="text-center">
          <p>
            Добро пожаловать! Пожалуйста, войдите или зарегистрируйтесь для доступа к дополнительным
            возможностям.
          </p>
          <Button severity="warning" @click="router.push(redirectReg)">Зарегистрироваться</Button>
          <span class="mx-2">или</span>
          <Button severity="warning" @click="openLoginModal">Войти</Button>
        </div>
      </div>
    </main>

    <!-- Login Modal -->
    <LoginModal :visible="showLoginModal" @close-modal="closeLoginModal" />
  </div>
</template>

<style scoped>
/* Styles for the layout with a top toolbar and a sliding drawer */
.layout-wrapper {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.top-toolbar {
  z-index: 1001;
  background-color: var(--surface-color);
  border-bottom: 1px solid var(--border-color);
}

.main-content,
.main-content-unauthorized {
  flex: 1;
  padding: 1rem;
  margin-top: 1rem;
  transition: margin-left 0.3s ease;
}

.drawer-menu-items {
  height: 100%;
}

.drawer-menu-items ul {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.drawer-menu-items li {
  width: 100%;
}

.p-2 {
  padding: var(--spacing-medium);
}
.m-1 {
  margin: var(--spacing-small);
}
.my-2 {
  margin-top: var(--spacing-medium);
  margin-bottom: var(--spacing-medium);
}
.mr-2 {
  margin-right: var(--spacing-medium);
}
.no-underline {
  text-decoration: none;
}
.text-color {
  color: var(--text-color);
}
.hover\:surface-100:hover {
  background-color: var(--surface-color);
}
.dark\.hover\:surface-700:hover {
  background-color: color-mix(in srgb, var(--surface-color) 80%, black);
}
.border-round {
  border-radius: var(--border-radius);
}
.transition-colors {
  transition:
    background-color,
    color 0.2s ease;
}
.transition-duration-150 {
  transition-duration: 0.15s;
}
</style>

<style>
/* Global styles for the simplified pt classes */
.custom-sidebar-root {
  width: 22rem;
}

.custom-sidebar-root.p-sidebar-left {
  width: 22rem;
}

.custom-sidebar-content {
  padding: 0;
}

.custom-sidebar-content :deep(.p-sidebar-header) {
  display: none;
}

.custom-sidebar-content :deep(.p-panelmenu) {
  border: none;
  background: transparent;
  border-radius: 0;
  padding: 0.5rem 0;
}

.custom-sidebar-content :deep(.p-panelmenu .p-panelmenu-header .p-panelmenu-header-content) {
  border-radius: 0 !important;
  background: transparent;
  border: none;
}

.custom-sidebar-content :deep(.p-panelmenu .p-panelmenu-content) {
  border-radius: 0 !important;
  background: transparent;
  border: none;
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link) {
  color: var(--text-color);
  border-radius: var(--border-radius);
  margin: 0.1rem 0.5rem;
  transition: background-color 0.2s ease;
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link):hover {
  background-color: color-mix(in srgb, var(--warning-color) 20%, transparent);
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link):focus {
  outline: 2px solid var(--warning-color);
  outline-offset: 2px;
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link .p-menuitem-icon) {
  color: var(--warning-color);
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link .p-menuitem-text) {
  color: var(--text-color);
}
</style>
