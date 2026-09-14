import Messenger from '../views/Messenger.vue' // Импортируем новый компонент
// import Home from '../components/Home.vue' // Закомментируем старый
// import Registration from '../components/Registration.vue' // Закомментировал импорт
import Login from '../components/Login.vue'
import InviteRegister from '../components/InviteRegister.vue'
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
  // Персональная ссылка-приглашение на регистрацию: /invite/<токен>. Единственный
  // способ создать аккаунт, пока публичная регистрация выключена (см.
  // backend/scripts/create_invite.py). Доступна и без входа — иначе
  // приглашённый не смог бы завершить регистрацию.
  {
    path: '/invite/:token',
    name: 'InviteRegister',
    component: InviteRegister
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

// До авторизации приложение должно быть только формой входа: даже
// профильные, канальные и invite-ссылки не открывают Messenger напрямую.
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  if (to.name === 'Login') {
    // Авторизованный пользователь не должен видеть форму входа при прямом
    // переходе на /auth/login/.
    if (authStore.isAuthenticated) {
      next({ name: 'Messenger' })
    } else {
      next()
    }
    return
  }

  if (to.name === 'InviteRegister') {
    // Ссылка-приглашение — единственный способ зарегистрироваться без
    // публичной регистрации, поэтому она должна открываться и без входа.
    if (authStore.isAuthenticated) {
      next({ name: 'Messenger' })
    } else {
      next()
    }
    return
  }

  if (!authStore.isAuthenticated) {
    next({ name: 'Login' })
    return
  }

  next()
})

export default router
