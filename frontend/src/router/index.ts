import { createRouter, createWebHistory } from 'vue-router'
import FormRegister from '@/views/FormRegister.vue';
import FormLogin from '@/views/FormLogin.vue';
import Landing from '@/views/Landing.vue';
import ContentMain from '@/views/ContentMain.vue';

const routes = [
  {
    path: '/',
    name: 'home',
    component: ContentMain,
  },
  {
    path: '/auth/register/',
    name: 'register',
    component: FormRegister,
  },
  {
    path: '/auth/login/',
    name: 'login',
    component: FormLogin,
  },
  {
    path: "/todo/",
    name: "landing",
    component: Landing
  },
  {
    path: "/todo/project/:id",
    name: "project",
    component: () => import("@/views/ToDoProject.vue"),
    props: true
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes,
  scrollBehavior(to, from, savedPosition) { return { top: 0 } },
})

export default router
