import Messenger from '../views/Messenger.vue' // Импортируем новый компонент
// import Home from '../components/Home.vue' // Закомментируем старый
// import Registration from '../components/Registration.vue' // Закомментировал импорт
import Login from '../components/Login.vue'
import { createRouter, createWebHistory, type RouteLocation } from 'vue-router'
import { useAuthStore } from '@/stores/auth' // Import the auth store

const routes = [
  {
    path: '/', // Главная страница
    name: 'Messenger', // Переименуем для ясности
    component: Messenger // Используем новый компонент
  },
  // Ссылка-профиль: https://pismo.space/u/<логин>. Открывается тот же
  // мессенджер — он сам находит человека по логину и открывает с ним чат
  // (см. resolveProfileLink в Messenger.vue).
  {
    path: '/u/:username',
    name: 'ProfileLink',
    component: Messenger
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
  // Любой другой адрес — на главную. Без этого правила неизвестный путь давал
  // пустой экран: nginx отдаёт index.html для всех путей, а роутер маршрут не
  // находил и не рисовал ничего.
  {
    path: '/:pathMatch(.*)*',
    redirect: (to: RouteLocation) => ({ path: '/', query: to.query })
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
  // Добавляем 'Messenger' в список публичных маршрутов.
  // 'ProfileLink' тоже публичный: по ссылке может прийти незарегистрированный
  // человек — мессенджер покажет ему экран входа, а после входа откроет чат.
  const publicRoutes = ['Login', 'Messenger', 'ProfileLink']

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
