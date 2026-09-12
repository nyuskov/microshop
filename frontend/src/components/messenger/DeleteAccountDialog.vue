<template>
  <q-dialog :model-value="true" @update:model-value="emit('close')">
    <q-card class="mod-card">
      <q-card-section class="row no-wrap items-center q-py-sm">
        <q-icon :name="icon('warning')" size="20px" color="negative" class="q-mr-sm" />
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
        <div class="mod-password-wrap">
          <input
            id="delete-account-password"
            v-model="password"
            class="mod-input"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="Введите пароль"
          />
          <button
            type="button"
            class="mod-password-eye"
            :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
            @click="showPassword = !showPassword"
          >
            <q-icon :name="icon(showPassword ? 'visibility_off' : 'visibility')" size="18px" />
          </button>
        </div>

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
import { icon } from '@/utils/icons'
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
// Показ пароля («глазок») — чтобы можно было проверить, что ввёл верно.
const showPassword = ref(false)

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
  color: var(--ms-danger);
}

.mod-hint {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ms-muted);
}

.mod-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--ms-muted);
}

.mod-label.gap-top {
  margin-top: 14px;
}

.mod-label code {
  background: var(--ms-surface-2);
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

/* Поле пароля с «глазком»: кнопка лежит поверх инпута справа. */
.mod-password-wrap {
  position: relative;
  display: flex;
}

.mod-password-wrap .mod-input {
  padding-right: 42px;
}

.mod-password-eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--ms-muted-3);
  cursor: pointer;
}

.mod-password-eye:hover {
  background: color-mix(in srgb, var(--ms-accent, #2ea25e) 12%, transparent);
  color: var(--ms-accent, #2ea25e);
}

.mod-error {
  margin: 10px 0 0;
  color: var(--ms-danger);
  font-size: 13px;
}
</style>
