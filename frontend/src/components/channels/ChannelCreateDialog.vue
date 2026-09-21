<template>
  <q-card class="ch-create-card">
    <q-card-section class="row no-wrap items-center ch-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">{{ t('Новый канал') }}</div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup :aria-label="t('Закрыть')" />
    </q-card-section>
    <q-separator />
    <q-card-section class="ch-body">
      <label class="ch-label" for="ch-title">{{ t('Название канала') }}</label>
      <input
        id="ch-title"
        v-model="title"
        class="ch-input"
        type="text"
        maxlength="128"
        :placeholder="t('Например, «Новости проекта»')"
        @keyup.enter="tryCreate"
      />

      <label class="ch-label" for="ch-desc">{{ t('Описание (необязательно)') }}</label>
      <textarea
        id="ch-desc"
        v-model="description"
        class="ch-input ch-textarea"
        rows="2"
        maxlength="512"
        :placeholder="t('О чём канал?')"
      ></textarea>

      <label class="ch-switch">
        <input v-model="isPublic" type="checkbox" />
        <span>
          <span class="ch-switch-title">{{ t('Публичный канал') }}</span>
          <span class="ch-switch-sub">
            {{ t('Виден в поиске и открывается по ссылке') }} <b>pismo.space/c/адрес</b
            >{{ t('. Выключено — вход только по ссылке-приглашению.') }}
          </span>
        </span>
      </label>

      <template v-if="isPublic">
        <label class="ch-label" for="ch-username">{{ t('Адрес канала') }}</label>
        <div class="ch-alias">
          <span class="ch-alias-prefix">pismo.space/c/</span>
          <input
            id="ch-username"
            v-model="username"
            class="ch-alias-input"
            type="text"
            maxlength="32"
            placeholder="my_channel"
            @input="normalizeAlias"
          />
        </div>
        <p class="ch-hint">
          {{ t('Латиница, цифры и подчёркивание, 4–32 символа, начинается с буквы.') }}
        </p>
      </template>

      <p v-if="error" class="ch-error">{{ error }}</p>
      <p class="ch-hint">{{ t('Каналов на аккаунт: до 10. Публикуют владелец и админы.') }}</p>
    </q-card-section>
    <q-separator />
    <q-card-actions align="right" class="ch-actions">
      <q-btn flat label="Отмена" v-close-popup />
      <q-btn
        unelevated
        color="primary"
        label="Создать"
        :loading="creating"
        :disable="!title.trim() || (isPublic && username.length < 4)"
        @click="tryCreate"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { createChannel } from '@/services/channelService'
import { getErrorMessage } from '@/services/errors'
import { t } from '@/i18n'
import type { ChannelCard } from '@/types'

const emit = defineEmits<{
  (e: 'created', channel: ChannelCard): void
  (e: 'close'): void
}>()

const title = ref('')
const description = ref('')
const isPublic = ref(false)
const username = ref('')
const creating = ref(false)
const error = ref('')

/** Приводит адрес к допустимому виду прямо при вводе (нижний регистр, без мусора). */
const normalizeAlias = () => {
  username.value = username.value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32)
}

const tryCreate = async () => {
  if (creating.value) return
  if (!title.value.trim()) {
    error.value = t('Нужно название канала')
    return
  }
  if (isPublic.value && username.value.length < 4) {
    error.value = t('Для публичного канала нужен адрес (минимум 4 символа)')
    return
  }
  creating.value = true
  error.value = ''
  try {
    const channel = await createChannel({
      title: title.value.trim(),
      description: description.value.trim() || null,
      is_public: isPublic.value,
      username: isPublic.value ? username.value : null
    })
    emit('created', channel)
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.ch-create-card {
  width: min(460px, 92vw);
  border-radius: 16px;
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #141d26);
  font-family: var(--ms-font), sans-serif;
}

.ch-head {
  padding: 12px 14px;
}

.ch-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}

.ch-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
  margin-top: 2px;
}

.ch-input {
  width: 100%;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #ffffff);
  color: var(--ms-text, #1c2733);
  padding: 9px 12px;
  font-size: 14px;
  font-family: var(--ms-font), sans-serif;
}

.ch-input:focus {
  outline: none;
  border-color: var(--ms-accent, #2ea25e);
}

.ch-textarea {
  resize: none;
  line-height: 1.35;
}

.ch-switch {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  cursor: pointer;
}

.ch-switch-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
}

.ch-switch-sub {
  display: block;
  font-size: 12px;
  color: var(--ms-muted, #71808d);
  line-height: 1.35;
}

.ch-alias {
  display: flex;
  align-items: center;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #ffffff);
  padding-left: 10px;
}

.ch-alias-prefix {
  font-size: 13px;
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
}

.ch-alias-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--ms-text, #1c2733);
  padding: 9px 10px;
  font-size: 14px;
  font-family: var(--ms-font), sans-serif;
}

.ch-alias-input:focus {
  outline: none;
}

.ch-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ms-muted, #71808d);
  line-height: 1.35;
}

.ch-error {
  margin: 0;
  font-size: 13px;
  color: var(--ms-danger, #d64545);
}

.ch-actions {
  padding: 10px 14px;
}
</style>
