<template>
  <div v-if="rows.length" class="scheduled-bar">
    <!-- Строка шапки: иконка, счётчик и ближайшее время — свернутое состояние.
         Раскрывается тапом/кликом, как шторка закреплённых. -->
    <div class="scheduled-head">
      <q-icon :name="icon('schedule')" class="scheduled-icon" size="17px" aria-hidden="true" />
      <button class="scheduled-toggle" type="button" :aria-expanded="open" @click="open = !open">
        <span class="scheduled-title">{{ t('Отложенные') }}</span>
        <span class="scheduled-count">{{ rows.length }}</span>
        <span class="scheduled-next">ближайшее {{ formatScheduledAt(rows[0]!.send_at) }}</span>
        <q-icon
          :name="icon('expand_more')"
          class="scheduled-chevron"
          :class="{ rotated: open }"
          size="18px"
          aria-hidden="true"
        />
      </button>
    </div>

    <!-- Список: время, начало текста и отмена. Отмена — своё сообщение, чужого
         здесь быть не может (`GET /messages/scheduled/` отдаёт только мои). -->
    <div v-if="open" class="scheduled-list">
      <div v-for="item in rows" :key="item.id" class="scheduled-item">
        <div class="scheduled-info">
          <span class="scheduled-when">{{ formatScheduledAt(item.send_at) }}</span>
          <span class="scheduled-preview">{{ preview(item) }}</span>
        </div>
        <button
          class="icon-btn scheduled-cancel"
          type="button"
          :title="t('Отменить отправку')"
          :aria-label="t('Отменить отложенную отправку')"
          @click="emit('cancel', item.id)"
        >
          <q-icon :name="icon('close')" size="18px" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import type { ScheduledMessage } from '@/types'
import { icon } from '@/utils/icons'
import { formatScheduledAt } from '@/utils/scheduledSend'
import { t } from '@/i18n'

const props = defineProps<{
  /** Отложенные сообщения открытого чата (уже отсортированы по времени). */
  rows: ScheduledMessage[]
  /** Расшифрованные тексты по id: в E2EE-чате на сервере лежит шифротекст. */
  decrypted?: Record<number, string>
}>()

const emit = defineEmits<{
  (e: 'cancel', scheduledId: number): void
}>()

const open = ref(false)

// Сменили чат — шторка снова свёрнута: открытая панель от прошлого чата тут
// выглядит как «зависший» UI.
watch(
  () => props.rows,
  () => {
    open.value = false
  }
)

/**
 * Начало текста для списка. Для шифрованного чата показываем нейтральную
 * подпись: на сервере шифротекст, и в списке он выглядел бы мусором.
 */
const preview = (item: ScheduledMessage): string => {
  const text = props.decrypted?.[item.id] ?? (item.encrypted ? '' : item.text)
  const trimmed = text.trim()
  if (!trimmed) return t('Зашифрованное сообщение')
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
}
</script>

<style scoped>
/* Шторка отложенных: тоном акцента, без рамок — как закреплённые и выделение. */
.scheduled-bar {
  display: flex;
  flex-direction: column;
  /* Содержимое стоит по центру полосы (`justify-content: center` — при
     свёрнутом виде полоса выше одной строки), а не прижимается к верху. */
  justify-content: center;
  align-items: stretch;
  gap: 2px;
  min-height: 44px;
  padding: 6px 12px 6px 16px;
  background: color-mix(in srgb, var(--ms-accent) 12%, transparent);
}

.scheduled-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  /* Явная межстрочная высота: без неё иконка и текст разного размера встают по
     базовой линии и содержимое кажется смещённым вниз. */
  line-height: 1.2;
}

.scheduled-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-accent-strong);
}

.scheduled-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  /* Без вертикальных отступов: высоту строки задаёт `.scheduled-head`, иначе
     текст съезжает относительно иконки и шеврона. */
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--ms-text);
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  line-height: 1.2;
  text-align: left;
  cursor: pointer;
}

.scheduled-title {
  flex: none;
}

.scheduled-count {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--ms-accent) 26%, transparent);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  line-height: 1;
}

.scheduled-next {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ms-muted);
  font-size: var(--ms-fs-xs);
  font-weight: 500;
  line-height: 1.2;
}

.scheduled-chevron {
  flex: none;
  display: flex;
  align-items: center;
  margin-left: auto;
  color: var(--ms-muted);
  transition: transform 0.18s ease;
}

.scheduled-chevron.rotated {
  transform: rotate(180deg);
}

.scheduled-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scheduled-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 4px 2px;
  border-radius: 8px;
}

.scheduled-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
}

.scheduled-when {
  color: var(--ms-accent-strong);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
}

.scheduled-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ms-text);
  font-size: var(--ms-fs-sm);
}

.scheduled-cancel {
  flex: none;
  color: var(--ms-muted);
}

/* Кнопки интерфейса (крестик отмены) — как в шапке чата. */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.icon-btn:hover {
  background: color-mix(in srgb, var(--ms-accent) 16%, transparent);
  color: var(--ms-text-strong);
}

@media (prefers-reduced-motion: reduce) {
  .scheduled-chevron {
    transition: none;
  }
}
</style>
