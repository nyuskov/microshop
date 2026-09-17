<template>
  <section ref="root" class="panel-section" :class="{ open: visible }" :data-section="sectionKey">
    <h3 class="panel-section-title">
      <span class="panel-section-name">{{ title }}</span>
      <span v-if="(count ?? 0) > 0" class="panel-section-count">{{ count }}</span>
    </h3>
    <!-- Содержимое рисуем только когда секция дошла до экрана: в каталоге
         эмодзи ~1900 символов, и держать их все в разметке сразу — заметная
         работа на ровном месте. -->
    <slot v-if="visible" />
  </section>
</template>

<script setup lang="ts">
/**
 * Секция вертикальной панели: заголовок плюс содержимое под ним.
 *
 * Зачем секции, а не только вкладки: вкладки прятали содержимое — человек видел
 * одну категорию и не понимал, что есть ещё. Столбиком видно всё подряд, а лента
 * значков сверху (`MessageComposer.vue`) служит быстрым переходом к нужной
 * секции — как в Telegram, где полоса категорий и содержимое работают вместе.
 *
 * Содержимое монтируется лениво (`useVisibleOnce`): до экрана дошли — рисуем.
 * Прокрутка к секции из ленты тоже срабатывает: элемент становится видимым, и
 * содержимое подгружается на месте.
 */
import { ref } from 'vue'

import { useVisibleOnce } from '@/composables/useVisibleOnce'

defineProps<{
  /** Ключ секции: по нему лента находит её на экране (`data-section`). */
  sectionKey: string
  /** Название секции («Смайлы», «Недавние», имя пака). */
  title: string
  /** Сколько элементов внутри (не показываем при нуле). */
  count?: number
}>()

const root = ref<HTMLElement | null>(null)
const { visible } = useVisibleOnce(root)
</script>

<style scoped>
.panel-section {
  padding-bottom: var(--ms-space-2);
}

.panel-section-title {
  display: flex;
  align-items: center;
  gap: var(--ms-space-2);
  margin: 0 0 var(--ms-space-1);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  color: var(--ms-muted-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.panel-section-count {
  font-weight: 400;
  text-transform: none;
  color: var(--ms-muted-3);
}
</style>
