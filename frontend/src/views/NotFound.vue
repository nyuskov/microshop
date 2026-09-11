<template>
  <ErrorScreen
    code="404"
    title="Страница не найдена"
    text="Возможно, ссылка устарела, чат удалён или в адресе опечатка. Проверьте адрес или вернитесь в приложение."
  >
    <template #actions>
      <q-btn unelevated no-caps color="primary" label="К чатам" @click="goHome" />
      <q-btn flat no-caps label="Назад" @click="goBack" />
    </template>
    <template #foot>
      <span>Кажется, это ошибка приложения?</span>
      <a href="mailto:nyuskov@gmail.com">nyuskov@gmail.com</a>
    </template>
  </ErrorScreen>
</template>

<script setup lang="ts">
/**
 * Экран «Страница не найдена» внутри приложения.
 *
 * Так выглядит неизвестный адрес (`/blabla`): nginx для любого пути отдаёт
 * index.html (SPA-фолбэк), поэтому решение принимает роутер — раньше он молча
 * уводил на список чатов, и человек не понимал, что попал не туда.
 * Для «жёстких» 404 вне приложения (нет файла/ассета) есть статическая
 * `public/404.html` — тот же полноэкранный вид, что даёт `ErrorScreen`.
 */
import { useRouter } from 'vue-router'

import ErrorScreen from '@/components/common/ErrorScreen.vue'

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
