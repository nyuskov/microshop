<template>
  <q-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event === true)"
  >
    <q-card class="sa-card">
      <q-card-section class="sa-head">
        <div class="sa-title">Новый вход в аккаунт</div>
        <q-space />
        <q-btn flat round dense :icon="icon('close')" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="sa-body">
        <p class="sa-text">
          Мы прислали уведомление о входе с нового устройства
          <template v-if="latest">({{ latest.device }} · {{ latest.ip }})</template>. Если вы этого
          не делали — закройте доступ чужим.
        </p>

        <div v-if="state === 'done'" class="sa-result">{{ result }}</div>
        <div v-else class="sa-actions">
          <q-btn
            unelevated
            no-caps
            color="primary"
            label="Это не я — завершить все сессии"
            :loading="busy === 'revoke'"
            :disable="busy !== null"
            @click="revokeAll"
          />
          <q-btn
            flat
            no-caps
            color="negative"
            label="Заморозить аккаунт"
            :disable="busy !== null"
            @click="freeze"
          />
          <q-btn flat no-caps label="Это был(а) я" v-close-popup :disable="busy !== null" />
        </div>
        <p v-if="error" class="sa-error">{{ error }}</p>
        <p class="sa-hint">
          Заморозка закрывает вход полностью — разморозить можно кодом на подтверждённый e-mail
          аккаунта.
        </p>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Диалог «Новый вход в аккаунт» (открывается из push и с `?security=1`).
 *
 * Задача — дать владельцу действие в один тап: завершить чужие сессии или
 * заморозить аккаунт. Подробности (устройство/IP) берём из списка активных
 * входов, чтобы не тащить их через уведомление.
 */
import { computed, onMounted, ref } from 'vue'

import { getErrorMessage } from '@/services/errors'
import { useAuthStore, type AuthSession } from '@/stores/auth'
import { icon } from '@/utils/icons'

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const authStore = useAuthStore()
const sessions = ref<AuthSession[]>([])
const busy = ref<'revoke' | 'freeze' | null>(null)
const error = ref('')
const state = ref<'idle' | 'done'>('idle')
const result = ref('')

/** Последний вход, который не является текущим устройством (тот самый «новый»). */
const latest = computed<AuthSession | null>(() => {
  const others = sessions.value.filter((row) => !row.current)
  return others[0] ?? sessions.value[0] ?? null
})

onMounted(async () => {
  try {
    sessions.value = await authStore.fetchSessions()
  } catch {
    /* список не критичен: действия работают и без него */
  }
})

/** «Это не я»: остальные устройства выходят сразу, текущее остаётся. */
const revokeAll = async () => {
  busy.value = 'revoke'
  error.value = ''
  try {
    await authStore.revokeAllSessions()
    result.value = 'Остальные устройства вышли из аккаунта.'
    state.value = 'done'
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось завершить сессии')
  } finally {
    busy.value = null
  }
}

/** Заморозка: вход закрыт для всех до подтверждения владения почтой. */
const freeze = async () => {
  busy.value = 'freeze'
  error.value = ''
  try {
    result.value = await authStore.freezeAccount()
    state.value = 'done'
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось заморозить аккаунт')
  } finally {
    busy.value = null
  }
}
</script>

<style scoped>
.sa-card {
  width: min(460px, calc(100vw - 32px));
  border-radius: var(--ms-radius-lg, 18px);
}

.sa-head {
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 8px 8px 8px 20px;
}

.sa-title {
  font-weight: 600;
}

.sa-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sa-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
}

.sa-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.sa-result {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ms-ok-bg, #e7f5ec);
  color: var(--ms-accent-strong, #1b7a3d);
  font-size: 13px;
  font-weight: 600;
}

.sa-error {
  margin: 0;
  color: var(--ms-danger, #c0392b);
  font-size: 13px;
}

.sa-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-muted, #93a0ab);
}
</style>
