<template>
  <div class="device">
    <p class="device-hint">
      {{
        t(
          'Здесь видно, что умеет ЭТО устройство и этот браузер. Самые частые «не работает» — про окружение, а не про приложение: во встроенном браузере редактора нет сервиса моделей Chrome, в WebView на телефоне нет распознавания речи, а показ экрана умеют только настольные браузеры.'
        )
      }}
    </p>

    <p class="device-where">
      Открыто: <strong>{{ label }}</strong> · {{ summary }}
    </p>

    <ul class="device-list">
      <li v-for="item in items" :key="item.key" class="device-item">
        <span class="device-mark" :class="item.state" aria-hidden="true">
          <q-icon :name="icon(markOf(item.state))" size="18px" />
        </span>
        <div class="device-text">
          <span class="device-title">
            {{ item.title }}
            <span class="device-state" :class="item.state">{{ stateLabel(item.state) }}</span>
          </span>
          <span class="device-desc">{{ item.text }}</span>
          <span v-if="item.hint" class="device-tip">{{ item.hint }}</span>
        </div>
      </li>
    </ul>

    <p class="device-note">
      {{
        t(
          'Проверяется только наличие возможностей — ничего не скачивается и никуда не отправляется. Модель перевода браузер скачает при первом переводе, и только после нажатия.'
        )
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Раздел «Устройство» в настройках профиля.
 *
 * Живёт отдельным компонентом (а не разметкой внутри `UserProfile.vue`), потому
 * что профиль и без него больше пяти тысяч строк, и грузится лениво — как
 * «Технические работы» и «Внешний вид».
 *
 * Проверки дешёвые и без сети (`utils/browserSupport.ts`): состояние моделей
 * намеренно не выясняем — скачивание требует нажатия, а не фоновой пробы.
 */
import { computed } from 'vue'

import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import {
  browserLabel,
  deviceReport,
  supportSummary,
  type DeviceSupportState
} from '@/utils/browserSupport'

const items = computed(() => deviceReport())
const label = computed(() => browserLabel())
const summary = computed(() => supportSummary(items.value))

const markOf = (state: DeviceSupportState): string => {
  if (state === 'ok') return 'check_circle'
  if (state === 'partial') return 'warning'
  return 'error'
}

const stateLabel = (state: DeviceSupportState): string => {
  if (state === 'ok') return 'работает'
  if (state === 'partial') return 'с оговоркой'
  return 'недоступно'
}
</script>

<style scoped>
.device {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.device-hint,
.device-note,
.device-where {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.4;
  color: var(--ms-muted, #71808d);
}

.device-note {
  font-size: var(--ms-fs-xs);
}

.device-where strong {
  color: var(--ms-text);
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.device-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: var(--ms-radius-md, 8px);
  background: var(--ms-surface-2, rgba(0, 0, 0, 0.03));
}

.device-mark {
  display: inline-flex;
  flex-shrink: 0;
  margin-top: 1px;
}

.device-mark.ok {
  color: var(--ms-accent, #2ea25e);
}

.device-mark.partial {
  color: var(--ms-warn, #b8860b);
}

.device-mark.no {
  color: var(--ms-danger, #d64545);
}

.device-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.device-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  color: var(--ms-text);
}

.device-state {
  font-size: var(--ms-fs-xs);
  font-weight: 500;
  text-transform: lowercase;
}

.device-state.ok {
  color: var(--ms-accent, #2ea25e);
}

.device-state.partial {
  color: var(--ms-warn, #b8860b);
}

.device-state.no {
  color: var(--ms-danger, #d64545);
}

.device-desc {
  font-size: var(--ms-fs-sm);
  line-height: 1.35;
  color: var(--ms-text);
}

.device-tip {
  font-size: var(--ms-fs-xs);
  line-height: 1.35;
  color: var(--ms-muted, #71808d);
}
</style>
