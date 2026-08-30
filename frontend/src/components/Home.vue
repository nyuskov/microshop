<script setup lang="ts">
import Posts from "./Posts.vue";
import Users from "./Users.vue";
// Import Toolbar, Sidebar, and PanelMenu from PrimeVue
import Toolbar from "primevue/toolbar";
import Sidebar from "primevue/sidebar";
import PanelMenu from "primevue/panelmenu";
import { Button } from "primevue";
import { ref, type Ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
// Import the theme store
import { useThemeStore } from '../stores/theme';

const authStore = useAuthStore();
authStore.initializeApp();

// Get the theme store instance
const themeStore = useThemeStore();
const router = useRouter();
const redirectReg = "/auth/registration/";
const redirectLogin = "/auth/login/";

// State for active components
let isActiveUsers: Ref<boolean> = ref(false);
let isActivePosts: Ref<boolean> = ref(false);

const isAuthorized = computed(() => authStore.isAuthenticated);

// State for the drawer (sidebar menu)
const drawerVisible = ref(false);

// Define menu items as a single root panel for PanelMenu
const menuItems = computed(() => [
  {
    label: "Навигация",
    items: [
      {
        label: "Пользователи",
        icon: "pi pi-fw pi-user",
        command: () => {
          isActiveUsers.value = true;
          isActivePosts.value = false;
          drawerVisible.value = false; // Close drawer after selection
        },
      },
      {
        label: "Посты",
        icon: "pi pi-fw pi-file-edit",
        command: () => {
          isActiveUsers.value = false;
          isActivePosts.value = true;
          drawerVisible.value = false; // Close drawer after selection
        },
      },
    ],
  },
  {
    label: "Настройки",
    items: [
      {
        label: `Тема (${themeStore.currentTheme})`,
        icon: themeStore.currentTheme === 'light' ? "pi pi-sun" : "pi pi-moon",
        command: () => {
            themeStore.toggleTheme();
            // Keep drawer open after theme change
        },
      },
      {
        label: "Выйти",
        icon: "pi pi-fw pi-sign-out",
        command: async () => {
          isActiveUsers.value = false;
          isActivePosts.value = false;
          await authStore.logout(router);
          drawerVisible.value = false; // Close drawer after logout
        },
      },
    ],
  }
]);

// Function to toggle the drawer visibility
function toggleDrawer() {
  drawerVisible.value = !drawerVisible.value;
}

// Function to close the drawer
function closeDrawer() {
  drawerVisible.value = false;
}
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

        <!-- Optional: Add other elements to the center/end of the toolbar here -->
        <template #center>
          <!-- e.g., Page title could go here -->
        </template>
      </Toolbar>
    </header>

    <!-- Sliding Drawer Menu (Sidebar) -->
    <Sidebar
      v-if="isAuthorized"
      v-model:visible="drawerVisible"
      :pt="{
        root: { class: 'custom-sidebar-root' },
        content: { class: 'custom-sidebar-content' },
      }"
      position="left"
    >
      <!-- Use PrimeVue PanelMenu for correct menu rendering -->
      <PanelMenu :model="menuItems" class="p-0 border-0 bg-transparent" />
    </Sidebar>

    <!-- Main content area -->
    <main class="main-content" @click="closeDrawer" v-if="isAuthorized">
      <div class="content">
        <h1 class="text-center">Hello!</h1>
        <!-- Show Users OR Posts based on state, exclusively -->
        <Users v-if="isActiveUsers && !isActivePosts" :isActiveUsers="isActiveUsers"></Users>
        <Posts v-if="isActivePosts && !isActiveUsers"></Posts>
        <!-- Optional: Default message when no specific view is selected -->
        <div v-if="!isActiveUsers && !isActivePosts" class="default-view-message text-center p-4">
          <p>Выберите "Посты" или "Пользователи" в меню.</p>
        </div>
      </div>
    </main>

    <!-- Content for non-authorized users -->
    <main v-if="!isAuthorized" class="main-content-unauthorized">
      <div class="content">
        <h1 class="text-center">Hello!</h1>
        <div class="text-center">
          <p>
            Добро пожаловать! Пожалуйста, войдите или зарегистрируйтесь для доступа
            к дополнительным возможностям.
          </p>
          <Button severity="warning" @click="router.push(redirectReg)"
            >Зарегистрироваться</Button
          >
          <span class="mx-2">или</span>
          <Button severity="warning" @click="router.push(redirectLogin)"
            >Войти</Button
          >
        </div>
      </div>
    </main>
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
  z-index: 1001; /* Higher than the sidebar to stay on top when it's open */
  background-color: var(--surface-color); /* Use theme surface color, should be dark in dark mode now */
  border-bottom: 1px solid var(--border-color);
}

.main-content, .main-content-unauthorized {
  flex: 1;
  padding: 1rem;
  margin-top: 1rem; /* Account for the fixed header */
  transition: margin-left 0.3s ease; /* Smooth transition if needed */
}

/* Style the menu items inside the drawer */
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

/* Utility-like classes can be defined here if not in global styles */
.p-2 { padding: var(--spacing-medium); }
.m-1 { margin: var(--spacing-small); }
.my-2 { margin-top: var(--spacing-medium); margin-bottom: var(--spacing-medium); }
.mr-2 { margin-right: var(--spacing-medium); }
.no-underline { text-decoration: none; }
.text-color { color: var(--text-color); }
.hover\:surface-100:hover { background-color: var(--surface-color); }
.dark\.hover\:surface-700:hover { background-color: color-mix(in srgb, var(--surface-color) 80%, black); } /* Fallback for dark hover */
.border-round { border-radius: var(--border-radius); }
.transition-colors { transition: background-color, color 0.2s ease; }
.transition-duration-150 { transition-duration: 0.15s; }
</style>

<style>
/* Global styles for the simplified pt classes */
.custom-sidebar-root {
  width: 22rem; /* Set a default width, slightly wider for PanelMenu */
}

.custom-sidebar-root.p-sidebar-left {
  width: 22rem; /* Ensure width for left position */
}

.custom-sidebar-content {
  padding: 0; /* Remove default padding */
}

.custom-sidebar-content :deep(.p-sidebar-header) {
  display: none; /* Hide default header */
}

/* Style the PanelMenu inside the sidebar */
.custom-sidebar-content :deep(.p-panelmenu) {
  border: none; /* Remove default border */
  background: transparent; /* Make background transparent */
  border-radius: 0; /* Remove border radius to fit sidebar */
  padding: 0.5rem 0; /* Add some padding inside the menu */
}

.custom-sidebar-content :deep(.p-panelmenu .p-panelmenu-header .p-panelmenu-header-content) {
  border-radius: 0 !important; /* Remove header border radius */
  background: transparent; /* Ensure header is transparent */
  border: none; /* Remove header border */
}

.custom-sidebar-content :deep(.p-panelmenu .p-panelmenu-content) {
  border-radius: 0 !important; /* Remove content border radius */
  background: transparent; /* Ensure content is transparent */
  border: none; /* Remove content border */
}

/* Style the links inside PanelMenu items to use the warning/orange color */
.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link) {
  color: var(--text-color); /* Use theme text color */
  border-radius: var(--border-radius); /* Apply border radius */
  margin: 0.1rem 0.5rem; /* Add some margin for spacing */
  transition: background-color 0.2s ease; /* Smooth transition for hover */
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link):hover {
  background-color: color-mix(in srgb, var(--warning-color) 20%, transparent); /* Light orange hover */
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link):focus {
  outline: 2px solid var(--warning-color); /* Focus ring using warning color */
  outline-offset: 2px;
}

/* Attempt to style the icon and label inside the link */
.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link .p-menuitem-icon) {
  color: var(--warning-color); /* Icon color to warning */
}

.custom-sidebar-content :deep(.p-panelmenu .p-menuitem .p-menuitem-link .p-menuitem-text) {
  color: var(--text-color); /* Text color */
}
</style>