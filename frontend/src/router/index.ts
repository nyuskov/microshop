import Messenger from '../views/Messenger.vue' // Импортируем новый компонент
// import Home from '../components/Home.vue' // Закомментируем старый
// import Registration from '../components/Registration.vue' // Закомментировал импорт
import Login from '../components/Login.vue'
import UserProfile from '../views/UserProfile.vue'
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth' // Import the auth store

const routes = [
  {
    path: '/', // Главная страница
    name: 'Messenger', // Переименуем для ясности
    component: Messenger // Используем новый компонент
  },
  // {
  //   path: '/auth/registration/',
  //   name: 'Registration',
  //   component: Registration
  // },
  {
    path: '/auth/login/',
    name: 'Login',
    component: Login
  },
  {
    path: '/user-profile',
    name: 'UserProfile',
    component: UserProfile
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes
})

// Global navigation guard
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  // Define routes that do not require authentication
  const publicRoutes = ['Login'] // Убираю 'Registration' из списка публичных маршрутов

  // Check if the route requires authentication
  if (!publicRoutes.includes(to.name as string)) {
    // If the user is not authenticated, redirect to login
    if (!authStore.isAuthenticated) {
      next({ name: 'Login' })
    } else {
      // If authenticated, proceed to the route
      next()
    }
  } else {
    // If the route is public, proceed
    next()
  }
})

export default router
