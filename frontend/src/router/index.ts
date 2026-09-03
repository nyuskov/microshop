import Messenger from '../views/Messenger.vue' // Импортируем новый компонент
// import Home from '../components/Home.vue' // Закомментируем старый
import Registration from '../components/Registration.vue'
import Login from '../components/Login.vue'
import UserProfile from '../views/UserProfile.vue'
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/', // Главная страница
    name: 'Messenger', // Переименуем для ясности
    component: Messenger // Используем новый компонент
  },
  {
    path: '/auth/registration/',
    name: 'Registration',
    component: Registration
  },
  {
    path: '/auth/login/',
    name: 'Login',
    component: Login
  },
  {
    path: '/user-profile',
    name: 'UserProfile',
    component: UserProfile
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes
})

export default router
