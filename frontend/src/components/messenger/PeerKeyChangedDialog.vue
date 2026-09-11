<template>
  <q-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event === true)"
  >
    <q-card class="pk-card">
      <q-card-section class="pk-head">
        <div class="pk-title">Собеседник сменил ключ шифрования</div>
        <q-space />
        <q-btn flat round dense :icon="icon('close')" v-close-popup aria-label="Закрыть" />
      </q-card-section>
      <q-separator />
      <q-card-section class="pk-body">
        <p class="pk-text">
          <template v-if="peerName">У «{{ peerName }}» </template>
          <template v-else>У собеседника </template>
          теперь другой ключ сквозного шифрования. Обычно так и бывает, если он зашёл с нового
          телефона или почистил данные браузера — тогда переписка просто перешифровывается на новый
          ключ.
        </p>
        <p class="pk-text">
          Но такой же ключ мог подставить и тот, кто получил доступ к его аккаунту: тогда новые
          сообщения он сможет читать.
        </p>
        <p class="pk-hint">
          Если сомневаетесь — позвоните собеседнику по телефону и спросите, менял ли он устройство.
          До ответа не отправляйте в этот чат пароли, коды и документы.
        </p>
        <div class="pk-actions">
          <q-btn
            unelevated
            no-caps
            color="primary"
            label="Понятно, это его устройство"
            @click="accept"
          />
          <q-btn flat no-caps label="Закрыть" v-close-popup />
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/**
 * Предупреждение о смене ключа собеседника (TOFU для E2EE).
 *
 * Ключ сквозного шифрования привязан к устройству, поэтому он меняется при входе
 * с нового устройства — и это нормально. Плохой случай тот же: подменить ключ
 * может и тот, кто угнал аккаунт, чтобы читать чужую переписку (MITM). Сервер
 * отличить эти случаи не может, а человек — может (он знает, менял ли друг
 * телефон), поэтому приложение обязано спросить, а не шифровать молча.
 */
import { icon } from '@/utils/icons'

defineProps<{
  modelValue: boolean
  /** Имя собеседника для текста (пусто — если не смогли определить). */
  peerName?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** Человек подтвердил новый ключ — больше не предупреждаем. */
  (e: 'accept'): void
}>()

const accept = () => {
  emit('accept')
  emit('update:modelValue', false)
}
</script>

<style scoped>
.pk-card {
  width: min(480px, calc(100vw - 32px));
  border-radius: var(--ms-radius-lg, 18px);
}

.pk-head {
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 8px 8px 8px 20px;
}

.pk-title {
  font-weight: 600;
}

.pk-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pk-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
}

.pk-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ms-muted, #93a0ab);
}

.pk-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  margin-top: 2px;
}
</style>
