<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="reminder-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="reminder-title">{{ t('Напомнить о сообщении') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="reminder-body">
        <p class="reminder-hint">
          Вернём вас к этому сообщению в выбранное время. Уведомление придёт, даже если приложение
          закрыто<template v-if="chatTitle"> — из чата «{{ chatTitle }}»</template>.
        </p>

        <!-- О чём напоминаем: без этого списка непонятно, к какой строке вернёшься. -->
        <p v-if="preview" class="reminder-preview">{{ preview }}</p>

        <div v-if="reminder" class="reminder-current" role="status">
          <q-icon :name="icon('notifications')" size="16px" aria-hidden="true" />
          <span>Напоминание уже стоит: {{ existingLabel }}</span>
        </div>

        <ul class="reminder-list" role="radiogroup" :aria-label="t('Когда напомнить')">
          <li v-for="preset in presets" :key="preset.label">
            <button
              class="reminder-row"
              type="button"
              role="radio"
              :aria-checked="false"
              :disabled="busy"
              @click="emit('save', reminderSendAt(preset.at))"
            >
              <q-icon :name="icon('schedule')" size="18px" aria-hidden="true" />
              <span class="reminder-name">{{ preset.label }}</span>
            </button>
          </li>
        </ul>

        <!-- Убрать можно только существующее: для нового напоминания кнопка
             обещала бы действие, которого нет. -->
        <button
          v-if="reminder"
          class="reminder-row danger"
          type="button"
          :disabled="busy"
          @click="emit('remove')"
        >
          <q-icon :name="icon('notifications_off')" size="18px" aria-hidden="true" />
          <span class="reminder-name">{{ t('Убрать напоминание') }}</span>
        </button>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { MessageReminder } from '@/types'
import { icon } from '@/utils/icons'
import { formatScheduledAt } from '@/utils/scheduledSend'
import { reminderPresets, reminderSendAt } from '@/utils/reminders'
import { t } from '@/i18n'

/**
 * Выбор времени напоминания о сообщении.
 *
 * Время выбирается готовыми вариантами, а не полем ввода: родные
 * `<input type="time">`/`type="date"` в этом проекте не используем (в WebView они
 * открываются системным окном далеко от места, см. `SelectField`), а свой
 * календарь ради этой функции — лишний вес в бандле.
 *
 * Само напоминание живёт на сервере: закрытое приложение разбудит push, а не
 * таймер в браузере.
 */
const props = defineProps<{
  /** Сообщение, о котором напоминаем. */
  messageId: number
  /** Начало текста сообщения — чтобы было видно, о чём речь. */
  preview?: string
  /** Заголовок чата для пояснения. */
  chatTitle?: string
  /** Уже стоящее напоминание об этом сообщении (null — его нет). */
  reminder: MessageReminder | null
  /** Запрос в полёте: кнопки временно недоступны. */
  busy?: boolean
}>()

const emit = defineEmits<{
  /** Выбрано время: сохранить (или перенести) напоминание. */
  (e: 'save', remindAt: string): void
  /** Убрать напоминание. */
  (e: 'remove'): void
  (e: 'close'): void
}>()

// Список считаем один раз при открытии: если человек оставил диалог открытым,
// «через 20 минут» должно означать те же 20 минут, а не сдвигаться с каждым тиком.
const presets = reminderPresets()

const existingLabel = computed(() =>
  props.reminder ? formatScheduledAt(props.reminder.remind_at) : ''
)
</script>

<style scoped>
.reminder-card {
  width: min(420px, 94vw);
  background: var(--ms-surface);
  color: var(--ms-text);
  border-radius: 14px;
}

.reminder-title {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
}

.reminder-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reminder-hint {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.45;
  color: var(--ms-muted-2);
}

.reminder-preview {
  margin: 0;
  padding: 8px 10px;
  border-left: 3px solid var(--ms-accent);
  border-radius: 6px;
  background: var(--ms-surface-2);
  font-size: var(--ms-fs-sm);
  line-height: 1.4;
  /* Длинное сообщение не должно растягивать диалог: три строки и многоточие. */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.reminder-current {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted-2);
}

.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reminder-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  background: var(--ms-surface);
  color: var(--ms-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.reminder-row:hover {
  background: var(--ms-hover);
}

.reminder-row:disabled {
  opacity: 0.6;
  cursor: default;
}

.reminder-row.danger {
  color: var(--ms-danger);
}

.reminder-name {
  flex: 1;
}
</style>
