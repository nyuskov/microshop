<template>
  <div class="empty-state" :class="{ 'empty-state--compact': compact }">
    <q-icon v-if="icon" :name="faIcon(icon)" class="empty-state__icon" aria-hidden="true" />
    <p v-if="title" class="empty-state__title">{{ title }}</p>
    <p v-if="hint" class="empty-state__hint">{{ hint }}</p>
    <div v-if="$slots.action" class="empty-state__action">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon as faIcon } from '@/utils/icons'

/** Единое «пустое состояние» (нет чата/сообщений/результатов поиска…).
 *  Большой вариант — для пустых областей, `compact` — компактная строка
 *  с muted-текстом внутри списков/лент. Цвета на --ms-* токенах. */
withDefaults(
  defineProps<{
    icon?: string
    title?: string
    hint?: string
    compact?: boolean
  }>(),
  { compact: false }
)
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--ms-space-1);
  padding: var(--ms-space-3);
  color: var(--ms-muted, #7c8a96);
  user-select: none;
}

.empty-state__icon {
  font-size: 60px;
  line-height: 1;
  color: var(--ms-icon-3, #b9c6cf);
  margin-bottom: var(--ms-space-2);
}

.empty-state__title {
  margin: 0;
  font-size: var(--ms-fs-xl);
  font-weight: 600;
  line-height: 1.3;
  color: var(--ms-text);
}

.empty-state__hint {
  margin: 0;
  font-size: var(--ms-fs-md);
  line-height: 1.45;
  color: var(--ms-muted, #7c8a96);
  max-width: 320px;
}

.empty-state__action {
  margin-top: var(--ms-space-2);
}

/* Компактный вариант для лент/списков: мелкий muted-текст без иконки */
.empty-state--compact {
  padding: var(--ms-space-2) var(--ms-space-3);
  gap: 2px;
}

.empty-state--compact .empty-state__title {
  font-size: var(--ms-fs-md);
  font-weight: 500;
  color: var(--ms-muted-2, #8a98a3);
}

.empty-state--compact .empty-state__hint {
  font-size: var(--ms-fs-sm);
}
</style>
