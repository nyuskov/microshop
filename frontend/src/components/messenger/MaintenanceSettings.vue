<template>
  <div class="maintenance">
    <p class="maintenance-hint">
      Включите, когда сервис обновляется или что-то чинится: вместо мессенджера все увидят понятный
      экран «идут технические работы» — без ошибок и пустых списков. Вход в аккаунт, уведомления о
      доступности и ваш собственный доступ продолжают работать, так что выключить режим можно оттуда
      же.
    </p>

    <div class="maintenance-toggle">
      <div class="maintenance-toggle-text">
        <span class="maintenance-toggle-name">Режим технических работ</span>
        <span class="maintenance-toggle-desc">
          {{
            enabled
              ? 'Включён — приложение закрыто для всех, кроме вас'
              : 'Выключен — работает как обычно'
          }}
        </span>
      </div>
      <q-toggle v-model="enabled" color="primary" keep-color :disable="busy" />
    </div>

    <label class="maintenance-label" for="maintenance-message">Текст на экране</label>
    <textarea
      id="maintenance-message"
      v-model="message"
      class="maintenance-field"
      rows="2"
      :maxlength="MESSAGE_MAX_LENGTH"
      placeholder="Например: обновляем сервис, вернёмся к 15:00"
      :disabled="busy"
    />
    <p class="maintenance-counter">{{ message.length }} / {{ MESSAGE_MAX_LENGTH }}</p>

    <p v-if="state" class="maintenance-state">
      <template v-if="state.enabled">Включён с {{ momentOf(state.since) }}</template>
      <template v-else>Последнее переключение: {{ momentOf(state.since) || '—' }}</template>
    </p>

    <button class="maintenance-btn primary" type="button" :disabled="busy" @click="save">
      <q-icon :name="icon('check')" size="17px" />
      <span>{{ busy ? 'Сохраняем…' : 'Сохранить' }}</span>
    </button>

    <p v-if="notice" class="maintenance-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="maintenance-notice error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * Раздел админской панели «Технические работы».
 *
 * Рубильник лежит в БД на сервере (`app_settings` через
 * `api_v1/system/views.py`), поэтому переключается на живом сервисе: ни правки
 * `.env`, ни перезапуска контейнеров не нужно. Доступен только администратору —
 * сервер это проверяет сам, а обычный пользователь до раздела не дойдёт (вход в
 * служебные разделы — пункт «Администрирование» в настройках профиля).
 */
import { onMounted, ref } from 'vue'

import { getErrorMessage } from '@/services/errors'
import {
  fetchMaintenanceStatus,
  realMaintenanceEnabled,
  setMaintenanceMode,
  type MaintenanceStatus
} from '@/services/maintenance'
import { parseServerTime } from '@/utils/format'
import { icon } from '@/utils/icons'

/** Предел длины совпадает с серверным (`api_v1/system/views.py`). */
const MESSAGE_MAX_LENGTH = 300

const enabled = ref(false)
const message = ref('')
const state = ref<MaintenanceStatus | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')

/** Время переключения в понятном виде (в часовом поясе человека). */
const momentOf = (iso: string | null): string => {
  if (!iso) return ''
  const date = parseServerTime(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function load() {
  error.value = ''
  try {
    const status = await fetchMaintenanceStatus()
    state.value = status
    // Панель показывает НАСТОЯЩЕЕ состояние: администратору сервер отдаёт
    // `enabled=false`, чтобы приложение перед ним не закрывалось заглушкой.
    const real = realMaintenanceEnabled(status)
    enabled.value = real
    message.value = real ? status.message : ''
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось узнать состояние режима')
  }
}

onMounted(load)

async function save() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    // Пустое поле — не ошибка: сервер подставит свой текст по умолчанию.
    const status = await setMaintenanceMode(enabled.value, message.value)
    state.value = status
    const real = realMaintenanceEnabled(status)
    enabled.value = real
    message.value = real ? status.message : ''
    notice.value = real
      ? 'Режим включён: пользователи видят экран технических работ.'
      : 'Режим выключен: приложение снова работает как обычно.'
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось переключить режим')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.maintenance {
  display: flex;
  flex-direction: column;
  padding: 4px 0 8px;
}

.maintenance-hint {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.maintenance-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: 12px;
}

.maintenance-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.maintenance-toggle-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text);
}

.maintenance-toggle-desc {
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--ms-muted);
}

.maintenance-label {
  margin: 16px 0 6px;
  font-size: 12px;
  color: var(--ms-muted);
}

.maintenance-field {
  width: 100%;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  color: var(--ms-text);
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  resize: vertical;
}

.maintenance-field:focus-visible {
  outline: 2px solid var(--ms-accent);
  outline-offset: 1px;
}

.maintenance-counter {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ms-muted);
  text-align: right;
}

.maintenance-state {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--ms-muted-2);
}

.maintenance-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 14px;
  font-family: inherit;
  font-size: 13px;
  color: var(--ms-text);
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: 10px;
  cursor: pointer;
}

.maintenance-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.maintenance-btn.primary {
  margin-top: 14px;
  color: var(--ms-on-accent);
  background: var(--ms-accent);
  border-color: var(--ms-accent);
}

.maintenance-notice {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--ms-muted-2);
}

.maintenance-notice.error {
  color: var(--ms-danger);
}
</style>
