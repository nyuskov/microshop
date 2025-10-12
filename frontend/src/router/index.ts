import { createRouter, createWebHistory } from 'vue-router'
import App from '@/App.vue';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: App,
  },
  {
    path: '/auth/register/',
    name: 'Register',
    component: App,
  },
  {
    path: '/auth/login/',
    name: 'Login',
    component: App,
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes,
})

export default router
