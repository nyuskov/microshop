<template>
  <span
    class="brand-spinner"
    :style="spinnerStyle"
    role="status"
    :aria-label="label ?? t('Загрузка')"
  ></span>
</template>

<script setup lang="ts">
/**
 * Кружок ожидания в стиле приложения.
 *
 * Зачем общий компонент: одинаковый кружок нужен нескольким состояниям —
 * восстановление чата из адреса, окно звонка из уведомления, ожидание
 * расшифровки кадра — и разнобой в размерах и цветах заметен сразу.
 *
 * ВАЖНО: подписи рядом с кружком нет (решение владельца: «все надписи рядом с
 * кружком убрать»). Крутящееся кольцо само говорит, что идёт ожидание, а текст
 * «Открываю чат…» только мешал. Для экранного диктора подпись остаётся — она в
 * `aria-label` и на экране не видна.
 */
import { computed } from 'vue'
import { t } from '@/i18n'

const props = defineProps<{
  /** Диаметр в пикселях: состояния берут свой размер (крупный — у звонка). */
  size?: number
  /** Что сообщить экранному диктору (визуально не показывается). */
  label?: string
}>()

/**
 * Толщина кольца растёт вместе с размером: у мелкого кружка линия не должна
 * выглядеть толстой, а у крупного — волосяной.
 */
const spinnerStyle = computed<Record<string, string>>(() => {
  const size = props.size ?? 56
  return {
    width: `${size}px`,
    height: `${size}px`,
    borderWidth: `${Math.max(3, Math.round(size / 14))}px`
  }
})
</script>

<style scoped>
/* Цвета — только токены. Полоску можно переопределить переменной
   `--brand-spinner-track` (тёмный оверлей, экран звонка со своей палитрой). */
.brand-spinner {
  display: inline-block;
  /* `size` — это видимый диаметр: без border-box рамка добавлялась бы к нему
     (size 56 давал бы круг 64px). Замер по `getBoundingClientRect()` для кружка
     обманчив: у повёрнутого квадрата габарит больше стороны (до 1.41×) —
     сверять надо computed `width`. */
  box-sizing: border-box;
  border-style: solid;
  border-radius: var(--ms-radius-pill);
  border-color: var(--brand-spinner-track, var(--ms-accent-soft));
  border-top-color: var(--ms-accent);
  animation: brand-spinner-rotate 0.9s linear infinite;
}

/* При «уменьшить движение» анимацию замедляем, но не убираем: иначе непонятно,
   что что-то происходит. */
@media (prefers-reduced-motion: reduce) {
  .brand-spinner {
    animation-duration: 2.4s;
  }
}

@keyframes brand-spinner-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
