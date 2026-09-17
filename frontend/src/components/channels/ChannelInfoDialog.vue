<template>
  <q-card class="ch-info-card">
    <q-card-section class="row no-wrap items-center ch-info-head">
      <div class="text-subtitle1 text-weight-medium ellipsis">Канал</div>
      <q-space />
      <q-btn flat round dense icon="close" v-close-popup aria-label="Закрыть" />
    </q-card-section>
    <q-separator />
    <!-- Вкладки — кнопками: в приложении уже так сделаны фильтры списка,
         а q-tabs затянул бы в бандл лишние компоненты и их стили. Лента
         листается колесом и перетаскиванием: разделов у владельца больше,
         чем влезает, и на веб-версии без этого последние были недоступны. -->
    <div
      ref="tabsEl"
      class="ch-info-tabs"
      :class="{ 'fade-start': tabsEdges.start, 'fade-end': tabsEdges.end }"
      role="tablist"
      aria-label="Разделы канала"
      @scroll.passive="refreshTabsEdges"
      @wheel.passive="onTabsWheel"
      @pointerdown="onTabsPointerDown"
      @pointermove="onTabsPointerMove"
      @pointerup="onTabsPointerUp"
      @pointerleave="onTabsPointerUp"
      @pointercancel="onTabsPointerUp"
    >
      <button
        v-for="entry in TABS"
        :key="entry.key"
        type="button"
        class="ch-tab"
        :class="{ active: tab === entry.key }"
        role="tab"
        :aria-selected="tab === entry.key"
        @click="tab = entry.key"
      >
        {{ entry.title() }}
      </button>
    </div>
    <q-separator />

    <q-card-section class="ch-info-body">
      <!-- Настройки (владелец и админы) -->
      <template v-if="tab === 'settings' && canManage">
        <label class="ch-label" for="ch-info-title">Название</label>
        <input id="ch-info-title" v-model="title" class="ch-input" maxlength="128" />

        <label class="ch-label" for="ch-info-desc">Описание</label>
        <textarea
          id="ch-info-desc"
          v-model="description"
          class="ch-input ch-textarea"
          rows="2"
          maxlength="512"
        ></textarea>

        <label class="ch-switch">
          <input v-model="isPublic" type="checkbox" />
          <span>
            <span class="ch-switch-title">Публичный канал</span>
            <span class="ch-switch-sub">
              Ссылка <b>pismo.space/c/{{ username || 'адрес' }}</b
              >, канал виден в поиске.
            </span>
          </span>
        </label>

        <template v-if="isPublic">
          <label class="ch-label" for="ch-info-username">Адрес канала</label>
          <input
            id="ch-info-username"
            v-model="username"
            class="ch-input"
            maxlength="32"
            placeholder="my_channel"
          />
        </template>

        <div class="ch-info-actions">
          <q-btn
            unelevated
            color="primary"
            label="Сохранить"
            :loading="saving"
            :disable="!dirty"
            @click="save"
          />
          <q-btn flat color="negative" label="Отписаться" v-close-popup @click="leave" />
        </div>
        <p class="ch-hint">
          Постов: {{ channel?.posts ?? 0 }} · подписчиков: {{ channel?.subscribers ?? 0 }}
        </p>
      </template>

      <!-- Карточка подписчика: только чтение (правит владелец/админ) -->
      <template v-else-if="tab === 'settings'">
        <p class="ch-readonly-title">{{ channel?.title }}</p>
        <p v-if="channel?.description" class="ch-readonly-desc">{{ channel.description }}</p>
        <p class="ch-hint">
          <template v-if="channel?.username"> @{{ channel.username }} · </template>
          {{ channel?.subscribers ?? 0 }} подписчиков · постов: {{ channel?.posts ?? 0 }}
        </p>
        <div class="ch-info-actions">
          <q-btn flat color="negative" label="Отписаться" v-close-popup @click="leave" />
        </div>
      </template>

      <!-- Подписчики и админы -->
      <template v-else-if="tab === 'people'">
        <p v-if="!people.length" class="ch-hint">Загружаем…</p>
        <div v-else class="ch-people">
          <div v-for="person in people" :key="person.id" class="ch-person">
            <span class="ch-person-name">
              {{ person.name }}
              <span class="ch-person-role">{{ roleLabel(person.role) }}</span>
            </span>
            <template v-if="isOwner && person.role !== 'creator'">
              <q-btn
                flat
                dense
                size="sm"
                :label="person.role === 'admin' ? 'Снять админа' : 'Сделать админом'"
                @click="toggleAdmin(person)"
              />
            </template>
          </div>
        </div>
        <p class="ch-hint">Назначать админов может только владелец канала.</p>
      </template>

      <!-- Предложенные посты -->
      <template v-else>
        <p v-if="!pending.length" class="ch-hint">Новых предложек нет.</p>
        <div v-else class="ch-suggestions">
          <div v-for="item in pending" :key="item.id" class="ch-suggestion">
            <div class="ch-suggestion-head">{{ item.author_name }}</div>
            <p class="ch-suggestion-text">{{ item.text }}</p>
            <div class="ch-suggestion-actions">
              <q-btn
                unelevated
                dense
                size="sm"
                color="primary"
                label="Опубликовать"
                @click="review(item, true)"
              />
              <q-btn
                flat
                dense
                size="sm"
                color="negative"
                label="Отклонить"
                @click="review(item, false)"
              />
            </div>
          </div>
        </div>
      </template>

      <p v-if="error" class="ch-error">{{ error }}</p>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Notify } from 'quasar'

import {
  approveSuggestion,
  fetchChannel,
  fetchChannelSubscribers,
  fetchSuggestions,
  leaveChannel,
  rejectSuggestion,
  setChannelAdmin,
  updateChannel
} from '@/services/channelService'
import { getErrorMessage } from '@/services/errors'
import { useHScroll } from '@/composables/useHScroll'
import type { ChannelCard, ChannelSuggestion } from '@/types'

const props = defineProps<{
  chatId: number
  open: boolean
  /** Моя роль в канале: creator/admin/member. */
  role: string
}>()

const emit = defineEmits<{
  (e: 'updated'): void
  (e: 'left'): void
}>()

interface Person {
  id: number
  username: string
  name: string
  role: string
}

/** Вкладки карточки канала. */
type ChannelTabKey = 'settings' | 'people' | 'suggestions'

const tab = ref<ChannelTabKey>('settings')

/** Вкладки диалога: подписи зависят от счётчиков, поэтому функции.
 *  Вкладки подписчиков и предложек видны только тем, кто ими управляет. */
const TABS = computed<ReadonlyArray<{ key: ChannelTabKey; title: () => string }>>(() => {
  const tabs: { key: ChannelTabKey; title: () => string }[] = [
    { key: 'settings', title: () => (canManage.value ? 'Настройки' : 'О канале') }
  ]
  if (canManage.value) {
    tabs.push(
      { key: 'people', title: () => `Подписчики · ${channel.value?.subscribers ?? 0}` },
      { key: 'suggestions', title: () => `Предложки · ${pending.value.length}` }
    )
  }
  return tabs
})

/** Лента вкладок: разделов у владельца несколько — на узком экране они
 *  не влезают, а в веб-версии без прокрутки последние пропадали. */
const {
  el: tabsEl,
  edges: tabsEdges,
  refresh: refreshTabsEdges,
  onWheel: onTabsWheel,
  onPointerDown: onTabsPointerDown,
  onPointerMove: onTabsPointerMove,
  onPointerUp: onTabsPointerUp
} = useHScroll(() => TABS.value.length)
const channel = ref<ChannelCard | null>(null)
const people = ref<Person[]>([])
const pending = ref<ChannelSuggestion[]>([])
const title = ref('')
const description = ref('')
const isPublic = ref(false)
const username = ref('')
const saving = ref(false)
const error = ref('')

const isOwner = computed(() => props.role === 'creator')
/** Править настройки могут владелец и админы (сервер проверяет то же самое). */
const canManage = computed(() => props.role === 'creator' || props.role === 'admin')
const dirty = computed(() => {
  const current = channel.value
  if (!current) return false
  return (
    title.value !== current.title ||
    (description.value || '') !== (current.description ?? '') ||
    isPublic.value !== Boolean(current.is_public) ||
    username.value !== (current.username ?? '')
  )
})

const roleLabel = (role: string): string =>
  role === 'creator' ? 'владелец' : role === 'admin' ? 'админ' : ''

const load = async () => {
  try {
    channel.value = await fetchChannel(props.chatId)
    title.value = channel.value.title
    description.value = channel.value.description ?? ''
    isPublic.value = Boolean(channel.value.is_public)
    username.value = channel.value.username ?? ''
    if (props.role === 'creator' || props.role === 'admin') {
      people.value = await fetchChannelSubscribers(props.chatId)
      pending.value = await fetchSuggestions(props.chatId, true)
    }
  } catch (err) {
    error.value = getErrorMessage(err)
  }
}

const save = async () => {
  saving.value = true
  error.value = ''
  try {
    channel.value = await updateChannel(props.chatId, {
      title: title.value.trim(),
      description: description.value.trim() || null,
      is_public: isPublic.value,
      username: isPublic.value ? username.value : null
    })
    emit('updated')
    Notify.create({ type: 'positive', message: 'Канал сохранён' })
  } catch (err) {
    error.value = getErrorMessage(err)
  } finally {
    saving.value = false
  }
}

const toggleAdmin = async (person: Person) => {
  try {
    await setChannelAdmin(props.chatId, person.id, person.role !== 'admin')
    await load()
  } catch (err) {
    error.value = getErrorMessage(err)
  }
}

const review = async (item: ChannelSuggestion, approve: boolean) => {
  try {
    if (approve) await approveSuggestion(props.chatId, item.id)
    else await rejectSuggestion(props.chatId, item.id)
    pending.value = pending.value.filter((entry) => entry.id !== item.id)
    emit('updated')
  } catch (err) {
    error.value = getErrorMessage(err)
  }
}

const leave = async () => {
  try {
    await leaveChannel(props.chatId)
    emit('left')
  } catch (err) {
    error.value = getErrorMessage(err)
  }
}

watch(
  () => [props.open, props.chatId],
  ([open]) => {
    if (open) {
      // Всегда открываем с первой вкладки: у подписчика других и нет.
      tab.value = 'settings'
      void load()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.ch-info-card {
  width: min(520px, 94vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--ms-surface, #fff);
  color: var(--ms-text, #141d26);
  font-family: var(--ms-font), sans-serif;
}

.ch-info-head {
  padding: 12px 14px;
}

.ch-info-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
  scrollbar-width: none;
}

.ch-info-tabs::-webkit-scrollbar {
  display: none;
}

/* Затухание у края: подсказка, что вкладок больше, чем видно. */
.ch-info-tabs.fade-end {
  mask-image: linear-gradient(to right, black calc(100% - 10px), transparent);
}

.ch-info-tabs.fade-start {
  mask-image: linear-gradient(to right, transparent, black 10px);
}

.ch-info-tabs.fade-start.fade-end {
  mask-image: linear-gradient(
    to right,
    transparent,
    black 10px,
    black calc(100% - 10px),
    transparent
  );
}

.ch-tab {
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  padding: 6px 12px;
  background: transparent;
  color: var(--ms-muted, #71808d);
  font-family: var(--ms-font), sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.ch-tab:hover {
  background: var(--ms-hover, #eef2f6);
}

.ch-tab.active {
  background: var(--ms-accent-soft, #e3f2e5);
  color: var(--ms-accent, #2ea25e);
  font-weight: 600;
}

.ch-info-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}

.ch-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
}

/* Карточка подписчика (только чтение). */
.ch-readonly-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.ch-readonly-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
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

.ch-info-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.ch-people,
.ch-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ch-person {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ch-person-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ch-person-role {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

.ch-suggestion {
  border: 1px solid var(--ms-border, #dfe5ea);
  border-radius: 11px;
  padding: 10px;
}

.ch-suggestion-head {
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-muted, #71808d);
}

.ch-suggestion-text {
  margin: 4px 0 8px;
  font-size: 14px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}

.ch-suggestion-actions {
  display: flex;
  gap: 8px;
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
</style>
