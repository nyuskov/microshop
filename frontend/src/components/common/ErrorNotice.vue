<template>
  <div
    class="error-notice"
    role="alert"
    @pointerenter="pause"
    @pointerleave="resume"
    @focusin="pause"
    @focusout="resume"
  >
    <span class="error-notice-text">{{ message }}</span>
    <button
      v-if="canRetry"
      type="button"
      class="error-notice-retry"
      title="Повторить"
      aria-label="Повторить отправку"
      @click="emit('retry')"
    >
      <q-icon :name="icon('replay')" size="18px" />
    </button>
    <button
      type="button"
      class="error-notice-close"
      title="Закрыть"
      aria-label="Закрыть сообщение об ошибке"
      @click="emit('dismiss')"
    >
      <q-icon :name="icon('close')" size="18px" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Плашка ошибки над полем ввода (и над списком чатов) — с закрытием и автоскрытием.
 *
 * Раньше плашка жила до следующего действия: закрыть её было нельзя, сама она
 * не пропадала, и «Не удалось отправить стикер» висело на экране всё то время,
 * пока человек не попробует сделать что-то ещё. Теперь у неё есть крестик, а
 * через `timeout` мс она уходит сама.
 *
 * Пока на плашку смотрят курсором или в неё попал фокус, отсчёт стоит: текст не
 * должен исчезать из-под руки, которую человек как раз тянет к крестику.
 */
import { onBeforeUnmount, watch } from 'vue'
import { icon } from '@/utils/icons'

const props = withDefaults(
  defineProps<{
    /** Текст ошибки. Пустая строка — плашки нет (её скрывает `v-if` родителя). */
    message: string
    /** Через сколько миллисекунд закрыться самой. 0 — ждать крестика. */
    timeout?: number
    /**
     * Есть что повторить (неудачная отправка) — показываем кнопку. Что именно
     * повторяется, решает родитель: плашка только сообщает о желании.
     */
    canRetry?: boolean
  }>(),
  { timeout: 8000, canRetry: false }
)

const emit = defineEmits<{
  (e: 'dismiss'): void
  (e: 'retry'): void
}>()

let timer: ReturnType<typeof setTimeout> | null = null

const stopTimer = () => {
  if (timer !== null) {
    globalThis.clearTimeout(timer)
    timer = null
  }
}

const startTimer = () => {
  stopTimer()
  if (props.timeout <= 0) return
  timer = globalThis.setTimeout(() => {
    timer = null
    emit('dismiss')
  }, props.timeout)
}

// Новое сообщение — отсчёт заново: текст ошибки мог смениться
// («Не удалось отправить стикер» после «…сообщение»).
watch(() => props.message, startTimer, { immediate: true })

const pause = () => stopTimer()
const resume = () => startTimer()

onBeforeUnmount(stopTimer)
</script>

<style scoped>
.error-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ms-danger);
  font-size: var(--ms-fs-sm);
  line-height: 1.35;
  /* Слева отступ как у строк списка (14px), справа — под круглые кнопки. */
  padding: 5px 5px 5px 12px;
  background: var(--ms-danger-bg);
  border-radius: var(--ms-radius-sm);
}

.error-notice-text {
  flex: 1;
  min-width: 0;
}

/* Повтор и закрытие — две одинаковые круглые кнопки: раньше повтор был
   подписанным прямоугольником, и правый край плашки выглядел кособоко. */
.error-notice-retry,
.error-notice-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

/* Мобильный: те же правила размера, что у остальных кнопок приложения
   (`appearance.css`: до 600px круглые кнопки крупнее). */
@media (max-width: 600px) {
  .error-notice-retry,
  .error-notice-close {
    width: 34px;
    height: 34px;
  }
}

.error-notice-retry:hover,
.error-notice-close:hover {
  background: var(--ms-hover);
}

.error-notice-retry:focus-visible,
.error-notice-close:focus-visible {
  outline: 2px solid var(--ms-accent);
  outline-offset: 1px;
}
</style>
