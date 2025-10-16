<script setup lang="ts">
import { Badge, Menu, Button } from 'primevue';
import { ref, type Ref } from 'vue';
import { useRouter, type Router, type RouteRecordNormalized } from 'vue-router';
import DataTableProducts from './DataTableProducts.vue';
import DataTableUsers from './DataTableUsers.vue';
import type { MenuItem } from 'primevue/menuitem';
import { useAuthStore } from '@/stores/auth';

const $auth_store = useAuthStore();
const $router: Router = useRouter();
const routes: RouteRecordNormalized[] = $router.getRoutes();
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

let _popup: Ref<boolean, boolean> = ref(true);

const items: Array<Object> = [
    {
        label: 'Пользователи',
        icon: 'fa-solid fa-user',
    },
    {
        label: 'Товары',
        icon: 'fa-solid fa-cart-shopping',
    },
    {
        separator: true,
    },
    {
        label: 'Выйти',
        icon: 'fa-solid fa-right-from-bracket',
    },
];

function toggleMenu() {
    _popup.value = !_popup.value;
}

function toggleContent(name: string) {
    let newRoute = routes.find(route => route.name === name);
    if (newRoute && newRoute["path"] === $router.currentRoute.value.path) {
        return true;
    } else {
        return false;
    }
}

async function toggleMenuItem(item: MenuItem) {
    _is_active.value.users = false;
    _is_active.value.products = false;

    if (item["label"] === "Выйти") {
        await $auth_store.logout();
    } else if (item["label"] === "Пользователи") {
        _is_active.value.users = true;
    } else if (item["label"] === "Товары") {
        _is_active.value.products = true;
    }

    _popup.value = !_popup.value;
}
</script>

<template>
    <div v-if="$auth_store.is_authenticated">
        <Button type="button" icon="pi pi-ellipsis-v" @click="toggleMenu()" aria-haspopup="true"
            aria-controls="overlay_menu" />
        <Menu ref="menu" id="overlay_menu" :model="items" :popup="_popup">
            <template #item="{ item, props }">
                <a v-ripple class="flex align-items-center" @click="toggleMenuItem(item)" v-bind="props.action">
                    <span :class="item.icon" />
                    <span class="ml-2">{{ item.label }}</span>
                    <Badge v-if="item.badge" class="ml-auto" :value="item.badge" />
                    <span v-if="item.shortcut"
                        class="ml-auto border-1 surface-border border-round surface-100 text-xs p-1">{{
                            item.shortcut }}</span>
                </a>
            </template>
        </Menu>
    </div>
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