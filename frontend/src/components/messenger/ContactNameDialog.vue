<template>
  <q-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event === true)"
  >
    <q-card class="cn-card">
      <q-card-section class="cn-head">
        <div class="cn-title">{{ isContact ? 'Имя контакта' : 'Добавить в контакты' }}</div>
        <q-space />
        <q-btn flat round dense :icon="icon('close')" v-close-popup :aria-label="t('Закрыть')" />
      </q-card-section>
      <q-separator />
      <q-card-section class="cn-body">
        <div class="cn-hero">
          <span class="cn-avatar" :style="avatarStyle(displayName(user))">
            <img v-if="avatarUrlOf(user)" :src="avatarUrlOf(user)" class="cn-avatar-img" alt="" />
            <template v-else>{{ initials(displayName(user)) }}</template>
          </span>
          <span class="cn-hero-text">
            <span class="cn-hero-name">{{ displayName(user) }}</span>
            <span class="cn-hero-sub">@{{ user.username }}</span>
          </span>
        </div>

        <q-input
          v-model="draft"
          outlined
          dense
          autofocus
          maxlength="120"
          :label="t('Имя контакта')"
          :placeholder="t('Например: Мама')"
          :disable="busy"
          @keyup.enter="submit"
        />
        <p class="cn-hint">
          {{
            t(
              'Имя видите только вы — в списке чатов, шапке и уведомлениях. Собеседник его не видит.'
            )
          }}
        </p>
        <p v-if="error" class="cn-error">{{ error }}</p>
      </q-card-section>
      <q-card-actions class="cn-actions">
        <q-btn
          v-if="isContact"
          flat
          no-caps
          color="negative"
          :label="t('Удалить из контактов')"
          :disable="busy"
          @click="remove"
        />
        <q-space />
        <q-btn flat no-caps :label="t('Отмена')" v-close-popup />
        <q-btn
          unelevated
          no-caps
          color="primary"
          :label="isContact ? 'Сохранить' : 'Добавить'"
          :loading="busy"
          :disable="busy"
          @click="submit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
/** Диалог «Добавить в контакты / Имя контакта» (Telegram-подобный). */
import { computed, ref, watch } from 'vue'

import { getErrorMessage } from '@/services/errors'
import { useContactsStore } from '@/stores/contacts'
import type { ChatUser } from '@/types'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { icon } from '@/utils/icons'
import { t } from '@/i18n'

const props = defineProps<{
  modelValue: boolean
  user: ChatUser
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
  (e: 'removed'): void
}>()

const contactsStore = useContactsStore()
const draft = ref('')
const busy = ref(false)
const error = ref('')

const isContact = computed(() => contactsStore.isContact(props.user.id))

// Открыли диалог — подставляем текущее личное имя (если оно есть).
watch(
  () => [props.modelValue, props.user.id] as const,
  ([open]) => {
    if (!open) return
    draft.value = contactsStore.nameOf(props.user.id)
    error.value = ''
  },
  { immediate: true }
)

const submit = async () => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await contactsStore.save(props.user.id, draft.value)
    emit('saved')
    emit('update:modelValue', false)
  } catch (err) {
    error.value = getErrorMessage(err, t('Не удалось сохранить контакт'))
  } finally {
    busy.value = false
  }
}

const remove = async () => {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await contactsStore.remove(props.user.id)
    emit('removed')
    emit('update:modelValue', false)
  } catch (err) {
    error.value = getErrorMessage(err, t('Не удалось убрать из контактов'))
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.cn-card {
  width: min(420px, calc(100vw - 32px));
  border-radius: var(--ms-radius-lg, 18px);
}

.cn-head {
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 8px 8px 8px 20px;
}

.cn-title {
  font-weight: 600;
}

.cn-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cn-hero {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cn-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-on-accent);
  font-weight: 600;
  overflow: hidden;
  flex-shrink: 0;
}

.cn-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cn-hero-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cn-hero-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cn-hero-sub {
  font-size: 12.5px;
  color: var(--ms-muted-3);
}

.cn-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-muted-3);
}

.cn-error {
  margin: 0;
  font-size: 12.5px;
  color: var(--ms-danger);
}

.cn-actions {
  padding: 8px 12px 12px;
}
</style>
