<template>
  <div v-if="fatalError" class="fatal" role="alertdialog" aria-labelledby="fatal-title">
    <div class="fatal-card">
      <div class="fatal-brand" aria-hidden="true">
        <q-icon :name="icon('error')" size="34px" />
      </div>
      <h1 id="fatal-title" class="fatal-title">Что-то пошло не так</h1>
      <p class="fatal-text">
        Приложение столкнулось с ошибкой и не смогло продолжить. Перезагрузка обычно помогает —
        данные и переписка не потеряны.
      </p>
      <code v-if="fatalError" class="fatal-detail">{{ fatalError }}</code>
      <div class="fatal-actions">
        <q-btn unelevated no-caps color="primary" label="Перезагрузить" @click="reload" />
        <q-btn flat no-caps label="Продолжить работу" @click="dismiss" />
      </div>
      <p class="fatal-hint">
        Ошибка повторяется? Напишите на
        <a href="mailto:nyuskov@gmail.com">nyuskov@gmail.com</a>.
      </p>
    </div>
  </div>
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
 * загрузилось (ошибка на уровне сервера/статики).
 */
import { icon } from '@/utils/icons'
import { clearFatalError, fatalError } from '@/utils/fatalError'

const reload = () => {
  window.location.reload()
}

const dismiss = () => {
  clearFatalError()
}
</script>

<style scoped>
.fatal {
  position: fixed;
  inset: 0;
  z-index: 40000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--ms-body, #eef1f4);
}

.fatal-card {
  width: min(520px, 100%);
  text-align: center;
  padding: 28px 22px 24px;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 18px;
  background: var(--ms-surface, #fff);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.18);
}

.fatal-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 16px;
  background: var(--ms-danger-bg, #fdecea);
  color: var(--ms-danger, #d64545);
}

.fatal-title {
  margin: 0 0 8px;
  font-size: 21px;
  line-height: 1.3;
}

.fatal-text {
  margin: 0 0 14px;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--ms-muted, #7c8a96);
}

.fatal-detail {
  display: block;
  margin: 0 0 16px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--ms-surface-2, #f6f8f9);
  color: var(--ms-muted, #7c8a96);
  font-size: 12px;
  text-align: left;
  word-break: break-word;
  max-height: 96px;
  overflow: auto;
}

.fatal-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.fatal-hint {
  margin: 18px 0 0;
  font-size: 12.5px;
  color: var(--ms-muted, #7c8a96);
}

.fatal-hint a {
  color: var(--ms-accent, #2ea25e);
  text-decoration: none;
}
</style>
