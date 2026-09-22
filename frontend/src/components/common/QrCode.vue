<script setup lang="ts">
import { computed } from 'vue'

import { createQrMatrix, qrSvgPath, qrSvgSize } from '@/utils/qr'
import { t } from '@/i18n'

/**
 * QR-код ссылки: рисуем сами (см. `utils/qr.ts`), без картинки с сервера и без
 * библиотеки — код нужен, чтобы человек навёл камеру с другого телефона.
 *
 * Внутри SVG один `<path>`: соседние тёмные модули склеены в полосы, поэтому
 * разметка компактная, а рисование дешёвое (важно на телефоне).
 */

const props = withDefaults(
  defineProps<{
    /** Что зашифровать — обычно ссылка. */
    value: string
    /** Сторона квадрата в пикселях (внутри уже есть поле покоя). */
    size?: number
    /** Подпись для экранного диктора: в самом коде текста нет. */
    label?: string
  }>(),
  { size: 172 }
)

/**
 * Текст слишком длинный → кода не будет: показываем пустоту, но не ломаем окно
 * (в `createQrMatrix` на это есть явная ошибка).
 */
const matrix = computed(() => {
  try {
    return createQrMatrix(props.value)
  } catch {
    return null
  }
})

const path = computed(() => (matrix.value ? qrSvgPath(matrix.value) : ''))

const viewSize = computed(() => (matrix.value ? qrSvgSize(matrix.value) : 0))
</script>

<template>
  <svg
    v-if="matrix"
    class="qr"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${viewSize} ${viewSize}`"
    role="img"
    :aria-label="label ?? t('QR-код ссылки')"
    shape-rendering="crispEdges"
  >
    <rect class="qr-bg" :width="viewSize" :height="viewSize" />
    <path class="qr-modules" :d="path" />
  </svg>
</template>

<style scoped>
/* Модули тёмные на светлом в любой теме: «негатив» сканеры читают через раз,
   а цвета берём токенами (--ms-qr-*), чтобы значение было одно на всё приложение. */
.qr {
  display: block;
  border-radius: var(--ms-radius-sm);
}

.qr-bg {
  fill: var(--ms-qr-bg);
}

.qr-modules {
  fill: var(--ms-qr-fg);
}
</style>
