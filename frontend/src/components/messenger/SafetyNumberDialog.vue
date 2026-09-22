<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="sn-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <div class="sn-title">{{ t('Проверка шифрования') }}</div>
        <q-space />
        <q-btn flat round dense :icon="icon('close')" :aria-label="t('Закрыть')" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="sn-body">
        <p class="sn-text">
          Сравните этот код с
          <template v-if="peerName">«{{ peerName }}»</template>
          <template v-else>{{ t('собеседником') }}</template>
          — лично, по телефону или голосом. Если код совпадает, переписку читаете только вы двое:
          ключи не подменены, и сервер в середине отсутствует.
        </p>

        <div v-if="loading" class="sn-state"><span class="sn-spinner"></span> {{ t('Считаем код…') }}</div>
        <div v-else-if="!code" class="sn-state">
          Ключ собеседника пока неизвестен: проверять нечего, пока он не зайдёт в приложение.
        </div>
        <template v-else>
          <div class="sn-code" role="group" :aria-label="t('Код проверки')">
            <span v-for="(group, index) in code.groups" :key="index" class="sn-group">
              {{ group }}
            </span>
          </div>
          <p class="sn-short">
            Короткая версия (30 цифр): <b>{{ code.shortGroups.join(' ') }}</b>
          </p>

          <div class="sn-actions">
            <q-btn
              unelevated
              no-caps
              color="primary"
              :icon="icon('content_copy')"
              :label="t('Скопировать код')"
              @click="copy"
            />
          </div>
          <p v-if="copied" class="sn-copied">{{ t('Код скопирован') }}</p>

          <p class="sn-hint">
            Код меняется, если кто-то из вас зайдёт с нового устройства (ключ привязан к
            устройству). Тогда сверьте код заново — это нормально.
          </p>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Экран сверки ключей сквозного шифрования (safety number).
 *
 * Зачем: ключи ходят через сервер, значит именно он мог бы подменить ключ
 * собеседника и читать переписку. Отличить подмену может только человек —
 * сравнив одинаковый у обоих код. Совпал — шифрование подтверждено.
 *
 * Код считается на устройстве из публичных ключей обоих участников
 * (`services/e2ee.ts::safetyNumberWithPeer`), на сервер ничего не отправляется.
 */
import { onMounted, ref } from 'vue'

import { icon } from '@/utils/icons'
import { safetyNumberWithPeer } from '@/services/e2ee'
import type { SafetyCode } from '@/utils/safetyNumber'
import { t } from '@/i18n'

const props = defineProps<{
  /** Мой id (владелец устройства). */
  myUserId: number | null
  /** Собеседник: его ключ и подпись в объяснении. */
  peerId: number
  peerName: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const code = ref<SafetyCode | null>(null)
const loading = ref(true)
const copied = ref(false)

onMounted(async () => {
  if (props.myUserId === null) {
    loading.value = false
    return
  }
  try {
    code.value = await safetyNumberWithPeer(props.myUserId, props.peerId)
  } finally {
    loading.value = false
  }
})

const copy = async () => {
  if (!code.value) return
  try {
    await navigator.clipboard.writeText(code.value.digits)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Буфер обмена недоступен (нет разрешения) — код видно на экране, это не беда.
  }
}
</script>

<style scoped>
.sn-card {
  width: min(480px, 96vw);
  background: var(--ms-surface);
  color: var(--ms-text);
  border-radius: 14px;
}

.sn-title {
  font-family: var(--ms-font-display);
  font-size: var(--ms-fs-lg);
}

.sn-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sn-text,
.sn-hint,
.sn-short {
  margin: 0;
  font-size: var(--ms-fs-sm);
  line-height: 1.45;
  color: var(--ms-muted);
}

.sn-hint {
  color: var(--ms-muted-2);
}

/* Код группами по 5 цифр: так его удобно читать вслух и сверять по частям. */
.sn-code {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 12px;
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  background: var(--ms-surface-2);
}

.sn-group {
  font-family: var(--ms-font-mono, monospace);
  font-size: calc(19px * var(--ms-text-scale, 1));
  font-weight: 600;
  letter-spacing: 0.06em;
}

.sn-actions {
  display: flex;
  gap: 8px;
}

.sn-copied {
  margin: 0;
  font-size: var(--ms-fs-sm);
  color: var(--ms-accent);
}

.sn-state {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--ms-fs-sm);
  color: var(--ms-muted);
}

.sn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--ms-border);
  border-top-color: var(--ms-accent);
  border-radius: 50%;
  animation: sn-spin 0.8s linear infinite;
}

@keyframes sn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
