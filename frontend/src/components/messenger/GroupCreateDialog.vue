<template>
  <q-card class="grp-create-card">
    <q-card-section class="row no-wrap items-center grp-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">Новая группа</div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
    </q-card-section>
    <q-separator />
    <q-card-section class="grp-body">
      <label class="grp-label" for="grp-name">Название группы</label>
      <input
        id="grp-name"
        v-model="name"
        class="grp-input"
        type="text"
        maxlength="100"
        placeholder="Например, «Семья» или «Коллеги»"
        @keyup.enter="tryCreate"
      />

      <label class="grp-label" for="grp-desc">Описание (необязательно)</label>
      <textarea
        id="grp-desc"
        v-model="description"
        class="grp-input grp-textarea"
        rows="2"
        maxlength="1024"
        placeholder="О чём эта группа?"
      ></textarea>

      <div class="grp-label grp-count">
        Участники
        <span v-if="selected.size" class="grp-selected-count">выбрано: {{ selected.size }}</span>
      </div>
      <div class="grp-search">
        <q-icon name="search" class="grp-search-icon" size="17px" aria-hidden="true" />
        <input
          v-model="query"
          class="grp-search-input"
          type="text"
          placeholder="Поиск по имени или логину"
        />
      </div>

      <div v-if="!filtered.length" class="grp-empty">
        {{
          contacts.length
            ? 'Никого не найдено'
            : 'Контактов пока нет — добавьте пользователей из телефонной книги.'
        }}
      </div>
      <div v-else class="grp-list">
        <button
          v-for="contact in filtered"
          :key="contact.id"
          class="grp-row"
          type="button"
          :class="{ on: selected.has(contact.id) }"
          @click="toggle(contact.id)"
        >
          <span class="avatar" :style="avatarStyle(displayName(contact))">
            <img
              v-if="avatarUrlOf(contact)"
              :src="avatarUrlOf(contact)"
              class="avatar-img"
              alt=""
            />
            <template v-else>{{ initials(displayName(contact)) }}</template>
          </span>
          <span class="grp-row-text">
            <span class="grp-row-title">{{ displayName(contact) }}</span>
            <span class="grp-row-sub"
              >@{{ contact.username
              }}<template v-if="contact.phone_number"> · {{ contact.phone_number }}</template></span
            >
          </span>
          <span class="grp-check" :class="{ on: selected.has(contact.id) }" aria-hidden="true">
            <q-icon v-if="selected.has(contact.id)" name="check" size="15px" />
          </span>
        </button>
      </div>

      <p v-if="error" class="grp-error">{{ error }}</p>
    </q-card-section>
    <q-separator />
    <q-card-actions align="right" class="grp-actions">
      <q-btn flat label="Отмена" v-close-popup />
      <q-btn
        unelevated
        color="primary"
        label="Создать группу"
        :disable="busy || !canCreate"
        @click="tryCreate"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { createGroupChat, type SearchUserResult } from '@/services/chatService'
import type { Chat } from '@/types'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'

const props = defineProps<{
  /** Все пользователи, которых можно пригласить (кроме текущего). */
  contacts: SearchUserResult[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', chat: Chat): void
}>()

const name = ref('')
const description = ref('')
const query = ref('')
const selected = ref<Set<number>>(new Set())
const busy = ref(false)
const error = ref('')

const filtered = computed<SearchUserResult[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.contacts
  return props.contacts.filter((contact) =>
    [contact.username, contact.first_name, contact.last_name, contact.phone_number]
      .filter(Boolean)
      .some((part) => (part as string).toLowerCase().includes(q))
  )
})

const canCreate = computed<boolean>(() => name.value.trim().length > 0 && selected.value.size > 0)

const toggle = (userId: number) => {
  const next = new Set(selected.value)
  if (next.has(userId)) next.delete(userId)
  else next.add(userId)
  selected.value = next
}

const tryCreate = async () => {
  if (!canCreate.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const chat = await createGroupChat(
      name.value.trim(),
      Array.from(selected.value),
      description.value.trim() || null
    )
    emit('created', chat)
  } catch (err) {
    error.value = getErrorMessage(err, 'Не удалось создать группу')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.grp-create-card {
  width: min(480px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  border-radius: var(--ms-radius-lg, 18px);
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #141d26);
}

.grp-head {
  padding: 8px 8px 8px 18px;
}

.grp-body {
  padding: 12px 18px 14px;
  max-height: 72vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.grp-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--ms-muted, #71808d);
  margin: 10px 0 5px;
}

.grp-label.grp-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.grp-selected-count {
  color: var(--ms-accent, #2ea25e);
  text-transform: none;
}

.grp-input {
  width: 100%;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #ffffff);
  color: var(--ms-text, #1c2733);
  padding: 10px 12px;
  font-size: 14.5px;
  font-family: var(--ms-font), sans-serif;
}

.grp-input:focus {
  outline: none;
  border-color: var(--ms-accent, #2ea25e);
}

.grp-textarea {
  resize: none;
  line-height: 1.35;
}

.grp-search {
  position: relative;
  display: flex;
  align-items: center;
}

.grp-search-icon {
  position: absolute;
  left: 10px;
  color: var(--ms-muted, #71808d);
  pointer-events: none;
}

.grp-search-input {
  width: 100%;
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  background: var(--ms-surface-2, #ffffff);
  color: var(--ms-text, #1c2733);
  padding: 9px 12px 9px 34px;
  font-size: 14px;
  font-family: var(--ms-font), sans-serif;
}

.grp-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 40vh;
  overflow-y: auto;
}

.grp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 7px 8px;
  border-radius: 11px;
  cursor: pointer;
  text-align: left;
  font-family: var(--ms-font), sans-serif;
}

.grp-row:hover {
  background: var(--ms-hover, #f2f4f6);
}

.grp-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.grp-row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.grp-row-sub {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

.grp-check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--ms-border, #cfd6dd);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
}

.grp-check.on {
  background: var(--ms-accent, #2ea25e);
  border-color: var(--ms-accent, #2ea25e);
}

.grp-empty {
  padding: 18px 0;
  text-align: center;
  color: var(--ms-muted, #71808d);
  font-size: 13px;
}

.grp-error {
  margin: 8px 0 0;
  color: #e0533d;
  font-size: 13px;
}

.grp-actions {
  padding: 8px 12px;
}

/* Общий аватар (как в списках чатов/контактов) */
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  flex-shrink: 0;
  overflow: hidden;
  user-select: none;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
