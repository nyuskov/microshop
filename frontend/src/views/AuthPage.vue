<template>
  <div class="auth-page">
    <!-- Экран входа и экран регистрации по ссылке-приглашению: обе страницы
         открываются роутером и должны стоять по центру окна. -->
    <InviteRegister v-if="kind === 'invite'" />
    <Login v-else />
  </div>
</template>

<script setup lang="ts">
import InviteRegister from '@/components/InviteRegister.vue'
import Login from '@/components/Login.vue'

/**
 * Страница авторизации: вход и регистрация по приглашению.
 *
 * Зачем обёртка: карточка входа прижималась к ВЕРХУ окна, когда экран открывался
 * по адресу (`/auth/login/` — сюда переводит охрана роутера всех, кто не вошёл).
 * Центрированием раньше занималась модалка (`LoginModal` → `q-dialog`, он и
 * выравнивает содержимое), а у страницы такого родителя не было: правило центровки
 * живёт здесь, а не в самих экранах, иначе в модалке карточка растянулась бы на
 * весь экран.
 *
 * Высоту берём из `--ms-vv-h` (визуальная область, её считает
 * `useVisualViewport`): на телефоне с открытой клавиатурой layout-viewport не
 * меняется, и без этого карточка уезжала бы под клавиатуру. Значение может быть
 * меньше содержимого — тогда страница прокручивается, а не обрезается.
 */
defineProps<{ kind?: 'login' | 'invite' }>()
</script>

<style scoped>
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--ms-vv-h, 100dvh);
  padding: 24px 0;
  box-sizing: border-box;
}
</style>
