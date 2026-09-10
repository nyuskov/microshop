<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="mod-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <q-icon name="warning" size="20px" color="negative" class="q-mr-sm" />
        <div class="text-subtitle1 text-weight-medium">Удаление аккаунта</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Закрыть" @click="emit('close')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="mod-body">
        <p class="mod-danger">
          Аккаунт и все данные будут удалены <strong>безвозвратно</strong>: профиль, аватар,
          переписка, вложения, push-подписки. Восстановить их не получится.
        </p>
        <p class="mod-hint">
          У собеседников сохранится история переписки, но ваши сообщения исчезнут.
        </p>

        <label class="mod-label" for="delete-account-password">Пароль аккаунта</label>
        <input
          id="delete-account-password"
          v-model="password"
          class="mod-input"
          type="password"
          autocomplete="current-password"
          placeholder="Введите пароль"
        />

        <label class="mod-label gap-top" for="delete-account-confirm">
          Введите <code>{{ DELETE_ACCOUNT_CONFIRM }}</code> для подтверждения
        </label>
        <input
          id="delete-account-confirm"
          v-model="confirm"
          class="mod-input"
          type="text"
          autocomplete="off"
          :placeholder="DELETE_ACCOUNT_CONFIRM"
        />

        <p v-if="error" class="mod-error" role="alert">{{ error }}</p>
      </q-card-section>

      <q-separator />
      <q-card-actions class="row justify-end q-gutter-sm q-pa-md">
        <q-btn flat no-caps label="Отмена" @click="emit('close')" />
        <q-btn
          unelevated
          no-caps
          color="negative"
          label="Удалить аккаунт"
          :disable="!canDelete"
          :loading="deleting"
          @click="submit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { DELETE_ACCOUNT_CONFIRM, deleteAccount } from '@/services/moderation'
import { getErrorMessage } from '@/services/errors'

const emit = defineEmits<{
  (e: 'close'): void
  /** Аккаунт удалён — родитель разлогинивает и закрывает профиль. */
  (e: 'deleted'): void
}>()

const password = ref('')
const confirm = ref('')
const deleting = ref(false)
const error = ref('')

const canDelete = computed(
  () => password.value.length > 0 && confirm.value.trim() === DELETE_ACCOUNT_CONFIRM
)

const submit = async () => {
  if (!canDelete.value || deleting.value) return
  deleting.value = true
  error.value = ''
  try {
    await deleteAccount(password.value)
    emit('deleted')
    emit('close')
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось удалить аккаунт')
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.mod-card {
  width: min(460px, calc(100vw - 32px));
  border-radius: 18px;
}

.mod-body {
  max-height: 66vh;
  overflow: auto;
}

.mod-danger {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.5;
  color: #d64545;
}

.mod-hint {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ms-text-muted, #6b7784);
}

.mod-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--ms-text-muted, #6b7784);
}

.mod-label.gap-top {
  margin-top: 14px;
}

.mod-label code {
  background: rgba(127, 127, 127, 0.14);
  border-radius: 5px;
  padding: 1px 5px;
}

.mod-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #f7f9fb);
  color: inherit;
  font-family: inherit;
  font-size: 14px;
}

.mod-error {
  margin: 10px 0 0;
  color: #d64545;
  font-size: 13px;
}
</style>
