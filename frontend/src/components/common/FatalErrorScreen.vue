<template>
  <ErrorScreen
    v-if="fatalError"
    overlay
    tone="danger"
    code="500"
    title="Что-то пошло не так"
    text="Приложение столкнулось с ошибкой и не смогло продолжить. Перезагрузка обычно помогает — данные и переписка не потеряны."
  >
    <template #extra>
      <code class="fatal-detail">{{ fatalError }}</code>
    </template>
    <template #actions>
      <q-btn unelevated no-caps color="primary" label="Перезагрузить" @click="reload" />
      <q-btn flat no-caps label="Продолжить работу" @click="dismiss" />
    </template>
    <template #foot>
      <span>Ошибка повторяется? Напишите на</span>
      <a href="mailto:nyuskov@gmail.com">nyuskov@gmail.com</a>
    </template>
  </ErrorScreen>
</template>

<script setup lang="ts">
/**
 * Полноэкранный экран фатальной ошибки приложения.
 *
 * Ловим необработанные ошибки Vue и `window.onerror` (см. `utils/fatalError.ts` и
 * `main.ts`) и показываем понятное сообщение с перезагрузкой вместо белого
 * экрана. Сетевые ошибки сюда не попадают: их разбирает интерфейс (плашка
 * «нет сети», повтор запросов).
 *
 * Дополняет статическую `public/500.html`: та нужна, когда приложение вообще не
 * загрузилось (ошибка на уровне сервера/статики). Вид общий — `ErrorScreen`.
 */
import { clearFatalError, fatalError } from '@/utils/fatalError'

import ErrorScreen from '@/components/common/ErrorScreen.vue'

const reload = () => {
  window.location.reload()
}

const dismiss = () => {
  clearFatalError()
}
</script>

<style scoped>
/* Показываем сам текст ошибки: по нему видно, что именно сломалось — это
   важно для разбора жалоб («белый экран» ничего не говорит). */
.fatal-detail {
  display: block;
  margin: 0 0 16px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface-2, #f6f8f9);
  color: var(--ms-muted, #7c8a96);
  font-family: var(--ms-font-mono, monospace);
  font-size: 12px;
  text-align: left;
  word-break: break-word;
  max-height: 96px;
  overflow: auto;
}
</style>
