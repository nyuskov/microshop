import { createRouter, createWebHistory } from 'vue-router'
import FormRegister from '@/components/auth/FormRegister.vue';
import FormLogin from '@/components/auth/FormLogin.vue';
import ToDos from '@/components/todo/ToDos.vue';
import ContentMain from '@/components/content/ContentMain.vue';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: ContentMain,
  },
  {
    path: '/auth/register/',
    name: 'Register',
    component: FormRegister,
  },
  {
    path: '/auth/login/',
    name: 'Login',
    component: FormLogin,
  },
  {
    path: '/todo/',
    name: 'Todo',
    component: ToDos,
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes,
})

export default router
