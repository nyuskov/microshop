<template>
  <div class="pinned-bar" @click="emit('close-popups')">
    <!-- Строка шапки: иконка, заголовок и кнопка центрированы по вертикали в
         одной строке высотой с кнопку. Раньше иконка и кнопка выравнивались по
         верху (`align-items: flex-start`), и при одной строке текста заголовок
         «плавал»: текст выше центра кнопки. -->
    <div class="pinned-head-row">
      <q-icon :name="icon('push_pin')" class="pinned-icon" size="17px" aria-hidden="true" />
      <button class="pinned-toggle" type="button" @click.stop="open = !open">
        <span class="pinned-title">{{ t('Закреплённые сообщения') }}</span>
        <span class="pinned-count">{{ rows.length }}</span>
        <q-icon
          :name="icon('expand_more')"
          class="pinned-chevron"
          :class="{ rotated: open }"
          size="18px"
          aria-hidden="true"
        />
      </button>
      <button
        class="icon-btn pinned-close"
        type="button"
        :title="t('Скрыть')"
        :aria-label="t('Скрыть закреплённые сообщения')"
        @click.stop="emit('close')"
      >
        <q-icon :name="icon('close')" size="18px" />
      </button>
    </div>

    <!-- Список закреплённых: строки-переходы к сообщению. -->
    <div v-if="open" class="pinned-list">
      <div
        v-for="item in rows"
        :key="item.id"
        class="pinned-item"
        role="button"
        tabindex="0"
        :title="t('Перейти к сообщению')"
        @click.stop="emit('scroll-to', item.id)"
        @keydown.enter.prevent="emit('scroll-to', item.id)"
        @keydown.space.prevent="emit('scroll-to', item.id)"
      >
        <span class="pinned-sender">{{ item.sender }}</span>
        {{ item.snippet }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { t } from '@/i18n'
interface PinnedRow {
  id: number
  sender: string
  snippet: string
}

defineProps<{
  rows: PinnedRow[]
}>()

const open = defineModel<boolean>('open', { default: true })

const emit = defineEmits<{
  (e: 'scroll-to', messageId: number): void
  (e: 'close-popups'): void
  /** Скрыть шторку закреплённых (крестик). */
  (e: 'close'): void
}>()
</script>

<style scoped>
/* Шторка закреплённых: шапка (иконка, заголовок, кнопки) и раскрытый список. */
.pinned-bar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 12px 6px 16px;
  /* Шторку отбиваем тоном (`--ms-pinned-bg`), а не линией: рамка под ней
     читалась как вторая граница шапки чата. */
  background: var(--ms-pinned-bg);
}

/* Строка шапки: всё по вертикальному центру одной строки высотой с кнопку.
   Раньше иконка и кнопка выравнивались по верху (`align-items: flex-start`), и
   при одной строке текста заголовок «плавал» выше центра кнопки. */
.pinned-head-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.pinned-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-pinned-icon);
}

/* Заголовок — кнопка: вся строка раскрывает и сворачивает список. */
.pinned-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  border: none;
  background: transparent;
  color: var(--ms-pinned-text);
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.pinned-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Счётчик: круглая плашка с цифрой по центру (и по горизонтали, и по вертикали). */
.pinned-count {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--ms-pinned-chip-bg);
  color: var(--ms-pinned-text);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  line-height: 1;
}

.pinned-chevron {
  flex: none;
  color: var(--ms-pinned-text);
  transition: transform 0.15s ease;
}

.pinned-close {
  flex: none;
}

.pinned-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0 4px 25px;
}

.pinned-item {
  font-size: 13.5px;
  line-height: 1.35;
  color: var(--ms-pinned-item);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: pointer;
}

.pinned-item:hover {
  background: color-mix(in srgb, var(--ms-icon) 10%, transparent);
}

.pinned-sender {
  font-weight: 600;
  color: var(--ms-accent);
  margin-right: 6px;
}

/* Стрелка «развернуть/свернуть» поворачивается, когда список открыт. */
.rotated {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .pinned-chevron {
    transition: none;
  }
}
</style>
