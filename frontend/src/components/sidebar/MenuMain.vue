<script setup lang="ts">
import { Badge, Menu, Button } from 'primevue';
import { ref, type Ref } from 'vue';
import type { MenuItem } from 'primevue/menuitem';
import { useAuthStore } from '@/stores/auth';

const $auth_store = useAuthStore();

const props = defineProps<{
    is_active: {
        users: boolean;
        products: boolean;
    }
}>();

let _popup: Ref<boolean, boolean> = ref(true);

const items: Array<Object> = [
    // {
    //     icon: 'fa-solid fa-xmark',
    // },
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

async function toggleMenuItem(item: MenuItem) {
    if (item["label"]) {
        props.is_active.users = false;
        props.is_active.products = false;
    }

    if (item["label"] === "Выйти") {
        _popup.value = !_popup.value;
        await $auth_store.logout();
    } else if (item["label"] === "Пользователи") {
        props.is_active.users = true;
    } else if (item["label"] === "Товары") {
        props.is_active.products = true;
    }
}
</script>

<template>
    <div class="menu" v-if="$auth_store.is_authenticated">
        <Menu id="overlay_menu" :model="items" :popup="_popup">
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
        <Button type="button" icon="fa-solid fa-bars" v-show="_popup" @click="toggleMenu()" aria-haspopup="true"
            aria-controls="overlay_menu" class="button button_limited button_grey" />
        <Button type="button" icon="fa-solid fa-xmark" class="button button_limited button_grey" v-show="!_popup"
            @click="toggleMenu()" aria-haspopup="true" aria-controls="overlay_menu" />
    </div>
</template>

<style scoped>
.menu {
    display: flex;
    position: absolute;
    width: 250px;
    height: 100vh;
}

.button_limited {
    width: 35px;
    height: 35px;
}

.button_grey {
    background-color: slategrey;
}
</style>