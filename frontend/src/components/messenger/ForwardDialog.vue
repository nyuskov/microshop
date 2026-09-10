<template>
  <Teleport to="body">
    <div
      class="fwd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Переслать сообщение"
      @mousedown.self="emit('close')"
    >
      <div class="fwd-card">
        <!-- Шапка -->
        <header class="fwd-head">
          <div class="fwd-title">
            <q-icon :name="icon('forward')" size="19px" />
            <span>Переслать</span>
          </div>
          <button class="fwd-icon-btn" title="Закрыть" @click="emit('close')">
            <q-icon :name="icon('close')" size="20px" />
          </button>
        </header>

        <!-- Превью пересылаемых сообщений -->
        <div class="fwd-preview">
          <span class="fwd-preview-label">{{ previewLabel }}</span>
          <span class="fwd-preview-text">
            <q-icon v-if="previewIcon" :name="icon(previewIcon)" size="16px" />
            {{ previewSnippet }}
          </span>
        </div>

        <!-- Поиск по чатам -->
        <div class="fwd-search">
          <q-icon :name="icon('search')" class="fwd-search-icon" size="17px" />
          <input
            v-model="query"
            class="fwd-search-input"
            type="text"
            placeholder="Поиск чата…"
            aria-label="Поиск чата"
          />
        </div>

        <!-- Список чатов -->
        <div v-if="available.length" class="fwd-list">
          <button
            v-for="chat in filteredChats"
            :key="chat.id"
            class="fwd-item"
            :class="{ selected: isSelected(chat.id) }"
            @click="toggle(chat.id)"
          >
            <span class="avatar" :style="avatarStyle(chatTitleOf(chat))">
              <img
                v-if="avatarUrlOf(chatPeerOf(chat))"
                :src="avatarUrlOf(chatPeerOf(chat))"
                class="avatar-img"
                alt=""
              />
              <template v-else>{{ initials(chatTitleOf(chat)) }}</template>
            </span>
            <span class="fwd-item-text">
              <span class="fwd-item-title">{{ chatTitleOf(chat) }}</span>
              <span class="fwd-item-sub">{{ itemSubtitle(chat) }}</span>
            </span>
            <span class="fwd-check">
              <q-icon v-if="isSelected(chat.id)" :name="icon('check')" size="16px" />
            </span>
          </button>

          <div v-if="!filteredChats.length" class="fwd-empty">Ничего не найдено</div>
        </div>

        <div v-else class="fwd-empty tall">
          Нет других чатов для пересылки. Найдите собеседника и начните диалог.
        </div>

        <!-- Низ: количество + кнопки -->
        <footer class="fwd-foot">
          <span class="fwd-count">{{
            selectedIds.length ? `Выбрано: ${selectedIds.length}` : 'Выберите чат для пересылки'
          }}</span>
          <div class="fwd-actions">
            <button class="fwd-btn ghost" :disabled="sending" @click="emit('close')">Отмена</button>
            <button
              class="fwd-btn send"
              :disabled="sending || selectedIds.length === 0"
              @click="confirmForward"
            >
              <q-icon :name="icon('forward')" size="17px" />
              <span>{{ sending ? 'Пересылаю…' : 'Переслать' }}</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, ref } from 'vue'
import type { Chat, Message } from '@/types'
import { avatarStyle, avatarUrlOf, chatPeer, chatPeerTitle, initials } from '@/utils/user'
import { fileIcon, mediaTypeLabel, messageSnippet } from '@/utils/media'

const props = defineProps<{
  /** Пересылаемое сообщение (одно) либо список (мультивыбор). */
  source: Message | Message[]
  /** Все чаты пользователя; текущий будет исключён из списка. */
  chats: Chat[]
  currentUserId: number | null
  /** Id открытого чата (в него пересылать не даём). */
  currentChatId: number | null
  /** Идёт ли отправка (блокирует кнопки). */
  sending: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'forward', chatIds: number[]): void
}>()

const query = ref('')
const selectedIds = ref<number[]>([])

/** Один или несколько источников пересылки. */
const sources = computed<Message[]>(() =>
  Array.isArray(props.source) ? props.source : [props.source]
)

const previewLabel = computed<string>(() =>
  sources.value.length > 1 ? `Сообщения: ${sources.value.length}` : 'Сообщение'
)

const previewIcon = computed<string | null>(() => {
  const single = sources.value.length === 1 ? sources.value[0] : null
  return single?.file ? fileIcon(single.file) : null
})

const previewSnippet = computed<string>(() => {
  if (sources.value.length === 1 && sources.value[0]) return messageSnippet(sources.value[0])
  const shown = sources.value
    .slice(0, 3)
    .map((m) => messageSnippet(m))
    .filter(Boolean)
  const tail = sources.value.length > 3 ? ` … +${sources.value.length - 3}` : ''
  return `${shown.join(' · ')}${tail}`
})

/** Чаты, доступные для пересылки (все, кроме текущего). */
const available = computed<Chat[]>(() =>
  props.chats.filter((chat) => chat.id !== props.currentChatId)
)

const chatPeerOf = (chat: Chat) => chatPeer(chat, props.currentUserId)
const chatTitleOf = (chat: Chat): string => chatPeerTitle(chat, props.currentUserId)

const filteredChats = computed<Chat[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return available.value
  return available.value.filter((chat) => chatTitleOf(chat).toLowerCase().includes(q))
})

const itemSubtitle = (chat: Chat): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  const body = last.file ? mediaTypeLabel(last.file) : last.text
  if (last.forwarded_from) return `${body} ↪`
  return last.user_id === props.currentUserId ? `Вы: ${body}` : body
}

const isSelected = (id: number): boolean => selectedIds.value.includes(id)

const toggle = (id: number) => {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

const confirmForward = () => {
  if (selectedIds.value.length === 0 || props.sending) return
  emit('forward', [...selectedIds.value])
}
</script>

<style scoped>
.fwd-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(15, 20, 26, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: fwd-fade 0.15s ease-out;
  font-family: var(--ms-font);
}

.fwd-card {
  width: min(460px, 100%);
  max-height: min(640px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #1c2733);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  animation: fwd-pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

@keyframes fwd-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes fwd-pop {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Шапка */
.fwd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 4px;
}

.fwd-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ms-text-strong, #141d26);
}

.fwd-title i {
  color: var(--ms-accent, #2ea25e);
  font-size: 1.1rem;
}

.fwd-icon-btn {
  background: none;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: var(--ms-icon, #52626f);
  cursor: pointer;
}

.fwd-icon-btn:hover {
  background: var(--ms-hover, #f2f4f6);
  color: var(--ms-text-strong, #141d26);
}

/* Превью сообщения */
.fwd-preview {
  display: flex;
  flex-direction: column;
  margin: 8px 16px 6px;
  padding: 8px 12px;
  background: var(--ms-accent-soft, #e3f2e5);
  border-left: 3px solid var(--ms-accent, #2ea25e);
  border-radius: 10px;
}

.fwd-preview-label {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ms-accent, #2ea25e);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 2px;
}

.fwd-preview-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  color: var(--ms-text, #1c2733);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Поиск */
.fwd-search {
  position: relative;
  margin: 8px 16px 6px;
}

.fwd-search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.9rem;
  color: var(--ms-icon-3, #9aa7b2);
}

.fwd-search-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
  border-radius: 10px;
  padding: 9px 12px 9px 32px;
  font-size: 14px;
  outline: none;
}

.fwd-search-input:focus {
  border-color: var(--ms-accent, #2ea25e);
  background: var(--ms-surface, #ffffff);
}

/* Список */
.fwd-list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 4px 8px;
}

.fwd-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 12px;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
}

.fwd-item:hover {
  background: var(--ms-hover, #f2f4f6);
}

.fwd-item.selected {
  background: var(--ms-accent-soft, #e3f2e5);
}

.avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  flex: none;
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fwd-item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.fwd-item-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ms-text-strong, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fwd-item-sub {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Галочка выбора */
.fwd-check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--ms-border, #d4d9e0);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  transition: all 0.12s ease;
  color: transparent;
  font-size: 0.7rem;
}

.fwd-item.selected .fwd-check {
  background: var(--ms-accent, #2ea25e);
  border-color: var(--ms-accent, #2ea25e);
  color: #fff;
}

.fwd-empty {
  padding: 24px 20px;
  text-align: center;
  color: var(--ms-muted, #71808d);
  font-size: 13.5px;
}

.fwd-empty.tall {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Низ */
.fwd-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #ffffff);
}

.fwd-count {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  font-weight: 500;
}

.fwd-actions {
  display: flex;
  gap: 8px;
}

.fwd-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  border-radius: 10px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
}

.fwd-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.fwd-btn.ghost {
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
}

.fwd-btn.ghost:hover:not(:disabled) {
  background: var(--ms-hover, #e8ebef);
}

.fwd-btn.send {
  background: var(--ms-accent, #2ea25e);
  color: #fff;
}

.fwd-btn.send:hover:not(:disabled) {
  background: var(--ms-accent-strong, #288e52);
}
</style>
