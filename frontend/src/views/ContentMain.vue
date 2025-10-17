<script setup lang="ts">
import { Button } from 'primevue';
import { ref, type Ref } from 'vue';
import { useRouter, type Router, type RouteRecordNormalized } from 'vue-router';
import DataTableProducts from '@/components/content/DataTableProducts.vue';
import DataTableUsers from '@/components/content/DataTableUsers.vue';
import { useAuthStore } from '@/stores/auth';
import MenuMain from '@/components/sidebar/MenuMain.vue';

const $auth_store = useAuthStore();
const $router: Router = useRouter();
// const routes: RouteRecordNormalized[] = $router.getRoutes();
const redirect_paths: Record<string, string> = {
    "register": "/auth/register/",
    "login": "/auth/login/"
}

let _is_active: Ref<{
    users: boolean;
    products: boolean;
}, {
    users: boolean;
    products: boolean;
}> = ref(
    {
        "users": false,
        "products": false,
    },
);
</script>

<template>
    <MenuMain :is_active="_is_active"></MenuMain>
    <div class="content">
        <h1>Hello!</h1>
        <div class="content" v-if="!$auth_store.is_authenticated">
            <Button severity="secondary" @click="$router.push(redirect_paths['register'])">Зарегистрироваться</Button>
            <span>или</span>
            <Button severity="secondary" @click="$router.push(redirect_paths['login'])">Войти</Button>
        </div>
        <div class="content" v-if="$auth_store.is_authenticated">
            <DataTableUsers v-if="_is_active['users']" />
            <DataTableProducts v-if="_is_active['products']" />
        </div>
    </div>
</template>

<style scoped>
/* Content */
.content {
    align-items: center;
    display: flex;
    flex-direction: column;
}
</style>