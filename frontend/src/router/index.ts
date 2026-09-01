import Home from '../components/Home.vue'
import Registration from '../components/Registration.vue'
import Login from '../components/Login.vue'
import UserProfile from '../views/UserProfile.vue'
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
  },
  {
    path: '/auth/registration/',
    name: 'Registration',
    component: Registration,
  },
  {
    path: '/auth/login/',
    name: 'Login',
    component: Login,
  },
  {
    path: '/user-profile',
    name: 'UserProfile',
    component: UserProfile,
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes,
})

export default router