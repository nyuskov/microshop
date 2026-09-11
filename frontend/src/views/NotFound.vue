<template>
  <div class="notfound">
    <EmptyState
      icon="search"
      title="Страница не найдена"
      hint="Возможно, ссылка устарела, чат удалён или в адресе опечатка."
    >
      <template #action>
        <div class="notfound-actions">
          <q-btn unelevated no-caps color="primary" label="К чатам" @click="goHome" />
          <q-btn flat no-caps label="Назад" @click="goBack" />
        </div>
      </template>
    </EmptyState>
    <p class="notfound-hint">
      Кажется, это ошибка приложения? Напишите на
      <a href="mailto:nyuskov@gmail.com">nyuskov@gmail.com</a>.
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Экран «Страница не найдена» внутри приложения.
 *
 * Так выглядит неизвестный адрес (`/blabla`): nginx для любого пути отдаёт
 * index.html (SPA-фолбэк), поэтому решение принимает роутер — раньше он молча
 * уводил на список чатов, и человек не понимал, что попал не туда.
 * Для «жёстких» 404 вне приложения (нет файла/ассета) есть статическая
 * `public/404.html` в том же стиле.
 */
import { useRouter } from 'vue-router'

import EmptyState from '@/components/common/EmptyState.vue'

const router = useRouter()

const goHome = () => {
  // replace: неверный адрес не должен оставаться в истории «назад».
  void router.replace({ name: 'Messenger' })
}

const goBack = () => {
  if (window.history.length > 1) {
    router.back()
    return
  }
  void router.replace({ name: 'Messenger' })
}
</script>

<style scoped>
.notfound {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 100vh;
  padding: 24px;
  text-align: center;
  background: var(--ms-body, #eef1f4);
}

.notfound-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.notfound-hint {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ms-muted, #7c8a96);
}

.notfound-hint a {
  color: var(--ms-accent, #2ea25e);
  text-decoration: none;
}
</style>
