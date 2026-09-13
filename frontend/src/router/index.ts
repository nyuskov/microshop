import Messenger from '../views/Messenger.vue' // Импортируем новый компонент
// import Home from '../components/Home.vue' // Закомментируем старый
// import Registration from '../components/Registration.vue' // Закомментировал импорт
import Login from '../components/Login.vue'
import { createRouter, createWebHistory } from 'vue-router'
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
  // Ссылка-канал: https://pismo.space/c/<адрес>. Открывается тот же мессенджер:
  // он показывает экран подписки на канал, а не сразу ленту — человек мог ещё не
  // подписаться (см. openChannelLink в Messenger.vue). Без этого маршрута адрес
  // попадал в `/:pathMatch(.*)*` и открывалась «Страница не найдена».
  {
    path: '/c/:username',
    name: 'ChannelLink',
    component: Messenger
  },
  // Ссылка-приглашение в группу: https://pismo.space/j/<токен>. Открывается тот
  // же мессенджер: он показывает карточку группы и предлагает вступить
  // (см. resolveInviteLink в Messenger.vue).
  {
    path: '/j/:token',
    name: 'GroupInvite',
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
  // Неизвестный адрес — экран «Страница не найдена» в стиле приложения.
  // Раньше тут был редирект на главную: nginx отдаёт index.html для любого пути
  // (SPA-фолбэк), и человек, попавший на битую ссылку, молча оказывался в
  // списке чатов, не понимая, что адрес неверный. Статический `public/404.html`
  // при этом остаётся для случаев вне приложения (нет файла/ассета).
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/NotFound.vue')
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
  const publicRoutes = [
    'Login',
    'Messenger',
    'ProfileLink',
    'ChannelLink',
    'GroupInvite',
    'NotFound'
  ]

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
