<template>
  <Teleport to="body">
    <div
      class="shr-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Отправить в Pismo"
      @mousedown.self="emit('close')"
    >
      <div class="shr-card">
        <!-- Шапка -->
        <header class="shr-head">
          <div class="shr-title">
            <q-icon :name="icon('send')" size="19px" />
            <span>Отправить в Pismo</span>
          </div>
          <button class="shr-icon-btn" title="Закрыть" @click="emit('close')">
            <q-icon :name="icon('close')" size="20px" />
          </button>
        </header>

        <!-- Что именно отправим (текст/ссылка и картинка, если она есть) -->
        <div class="shr-preview">
          <img v-if="previewUrl" :src="previewUrl" class="shr-preview-img" alt="" />
          <div class="shr-preview-body">
            <span class="shr-preview-label">Содержимое из другого приложения</span>
            <span class="shr-preview-text">{{
              text.trim() || (fileName ? `Файл: ${fileName}` : 'Файл')
            }}</span>
          </div>
        </div>

        <!-- Поиск по чатам -->
        <div class="shr-search">
          <q-icon :name="icon('search')" class="shr-search-icon" size="17px" />
          <input
            v-model="query"
            class="shr-search-input"
            type="text"
            placeholder="Поиск чата…"
            aria-label="Поиск чата"
          />
        </div>

        <!-- Список чатов -->
        <div v-if="chats.length" class="shr-list">
          <button
            v-for="chat in filteredChats"
            :key="chat.id"
            class="shr-item"
            :class="{ selected: selectedId === chat.id }"
            @click="selectedId = chat.id"
          >
            <span class="avatar" :style="avatarStyle(titleOf(chat))">
              <img v-if="avatarOf(chat)" :src="avatarOf(chat)" class="avatar-img" alt="" />
              <template v-else>{{ initials(titleOf(chat)) }}</template>
            </span>
            <span class="shr-item-text">
              <span class="shr-item-title">{{ titleOf(chat) }}</span>
              <span class="shr-item-sub">{{ itemSubtitle(chat) }}</span>
            </span>
            <span class="shr-check">
              <q-icon v-if="selectedId === chat.id" :name="icon('check')" size="16px" />
            </span>
          </button>

          <div v-if="!filteredChats.length" class="shr-empty">Ничего не найдено</div>
        </div>

        <div v-else class="shr-empty tall">
          Чатов пока нет. Найдите собеседника в «Контактах» — и вернитесь к отправке.
        </div>

        <!-- Низ: выбранный чат + кнопки -->
        <footer class="shr-foot">
          <span class="shr-count">{{
            selectedChat ? `Отправить в «${titleOf(selectedChat)}»` : 'Выберите чат'
          }}</span>
          <div class="shr-actions">
            <button class="shr-btn ghost" :disabled="busy" @click="emit('close')">Отмена</button>
            <button
              class="shr-btn send"
              :disabled="busy || selectedId === null"
              @click="confirmShare"
            >
              <q-icon :name="icon('send')" size="17px" />
              <span>{{ busy ? 'Отправляю…' : 'Отправить' }}</span>
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
import type { Chat } from '@/types'
import {
  avatarStyle,
  avatarUrlOf,
  chatPeer,
  chatTitle,
  groupAvatarUrl,
  initials
} from '@/utils/user'
import { mediaTypeLabel } from '@/utils/media'

const props = defineProps<{
  /** Текст (или ссылка) из другого приложения. */
  text: string
  /** Имя присланного файла (если он есть). */
  fileName?: string
  /** Object URL превью картинки (если это изображение). */
  previewUrl?: string | null
  /** Все чаты пользователя. */
  chats: Chat[]
  currentUserId: number | null
  /** Идёт ли отправка (блокирует кнопки). */
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'share', chatId: number): void
}>()

const query = ref('')
const selectedId = ref<number | null>(null)

const titleOf = (chat: Chat): string => chatTitle(chat, props.currentUserId)

/** Аватар чата: у группы — свой, у личного — фото собеседника. */
const avatarOf = (chat: Chat): string | undefined =>
  groupAvatarUrl(chat) ?? avatarUrlOf(chatPeer(chat, props.currentUserId))

const filteredChats = computed<Chat[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.chats
  return props.chats.filter((chat) => titleOf(chat).toLowerCase().includes(q))
})

const selectedChat = computed<Chat | null>(
  () => props.chats.find((chat) => chat.id === selectedId.value) ?? null
)

const itemSubtitle = (chat: Chat): string => {
  const last = chat.last_message
  if (!last) return 'Нет сообщений'
  const body = last.file ? mediaTypeLabel(last.file) : last.text
  if (last.forwarded_from) return `${body} ↪`
  return last.user_id === props.currentUserId ? `Вы: ${body}` : body
}

const confirmShare = () => {
  if (selectedId.value === null || props.busy) return
  emit('share', selectedId.value)
}
</script>

<style scoped>
.shr-overlay {
  position: fixed;
  inset: 0;
  z-index: 4500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(12, 16, 22, 0.55);
  font-family: var(--ms-font);
}

.shr-card {
  display: flex;
  flex-direction: column;
  width: min(440px, calc(100vw - 24px));
  max-height: min(620px, 88vh);
  overflow: hidden;
  background: var(--ms-surface, #ffffff);
  color: var(--ms-text, #1c2733);
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: var(--ms-radius-lg, 18px);
}

.shr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 12px 16px;
}

.shr-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ms-text-strong, #141d26);
}

.shr-title i {
  color: var(--ms-accent, #2ea25e);
}

.shr-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ms-icon, #52626f);
  cursor: pointer;
}

.shr-icon-btn:hover {
  background: var(--ms-hover, #f2f4f6);
  color: var(--ms-text-strong, #141d26);
}

.shr-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 10px;
  padding: 8px 10px;
  background: var(--ms-accent-soft, #e3f2e5);
  border-left: 3px solid var(--ms-accent, #2ea25e);
  border-radius: 8px;
}

.shr-preview-img {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 6px;
}

.shr-preview-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.shr-preview-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: var(--ms-accent, #2ea25e);
}

.shr-preview-text {
  font-size: 13px;
  line-height: 1.35;
  color: var(--ms-text, #1c2733);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.shr-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 8px;
  padding: 0 10px;
  height: 38px;
  border: 1px solid var(--ms-border, #e2e6ea);
  border-radius: 10px;
  background: var(--ms-surface-2, #f0f2f5);
}

.shr-search-icon {
  color: var(--ms-icon-3, #9aa7b2);
}

.shr-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--ms-text, #1c2733);
}

.shr-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 4px;
}

.shr-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.shr-item:hover {
  background: var(--ms-hover, #f2f4f6);
}

.shr-item.selected {
  background: var(--ms-accent-soft, #e3f2e5);
}

.shr-item .avatar {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #fff;
  font-weight: 600;
  font-size: 15px;
}

.shr-item .avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.shr-item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shr-item-title {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--ms-text-strong, #141d26);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shr-item-sub {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shr-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid var(--ms-border, #d4d9e0);
  color: #fff;
}

.shr-item.selected .shr-check {
  background: var(--ms-accent, #2ea25e);
  border-color: var(--ms-accent, #2ea25e);
}

.shr-empty {
  padding: 18px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--ms-muted, #71808d);
}

.shr-empty.tall {
  padding: 28px 20px;
}

.shr-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #ffffff);
}

.shr-count {
  font-size: 12.5px;
  color: var(--ms-muted, #71808d);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shr-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.shr-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 0;
  border-radius: 10px;
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.shr-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.shr-btn.ghost {
  background: var(--ms-surface-2, #f0f2f5);
  color: var(--ms-text, #1c2733);
}

.shr-btn.ghost:hover:not(:disabled) {
  background: var(--ms-hover, #e8ebef);
}

.shr-btn.send {
  background: var(--ms-accent, #2ea25e);
  color: #fff;
}

.shr-btn.send:hover:not(:disabled) {
  background: var(--ms-accent-strong, #288e52);
}
</style>
