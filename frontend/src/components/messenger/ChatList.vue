<template>
  <div class="chats-panel">
    <!-- Скелетоны: показываем структуру списка вместо текста «Загрузка…» -->
    <div v-if="props.loading" class="sk-list" aria-busy="true">
      <span class="sr-only">Загрузка диалогов…</span>
      <div v-for="n in 6" :key="n" class="sk-row">
        <span class="sk-avatar"></span>
        <span class="sk-lines">
          <span class="sk-line" :style="{ width: 40 + ((n * 13) % 35) + '%' }"></span>
          <span class="sk-line short"></span>
        </span>
      </div>
    </div>

    <template v-else>
      <!-- Фильтры списка: быстро отсечь непрочитанное, личные или группы -->
      <div
        v-if="!props.selectionMode"
        class="chat-filters"
        role="tablist"
        aria-label="Фильтр чатов"
      >
        <button
          v-for="filter in props.filters"
          :key="filter.key"
          type="button"
          class="chat-filter"
          :class="{ active: props.filter === filter.key }"
          role="tab"
          :aria-selected="props.filter === filter.key"
          @click="emit('update:filter', filter.key)"
        >
          {{ filter.title }}
          <span v-if="filter.key === 'unread' && props.unreadCount" class="chat-filter-count">
            {{ props.unreadCount > 99 ? '99+' : props.unreadCount }}
          </span>
        </button>
      </div>

      <div class="section-label">Недавние</div>
      <div v-if="!props.chats.length" class="empty-hint">
        Найдите пользователя по логину или телефону и начните переписку
      </div>
      <div
        v-else
        class="chat-scroll"
        @scroll.passive="props.handleScroll($event.currentTarget as HTMLElement)"
        @touchstart.passive="props.handleTouchStart($event)"
        @touchmove.passive="props.handleTouchMove($event, $event.currentTarget as HTMLElement)"
      >
        <div v-for="chat in props.chats" :key="chat.id" class="chat-row">
          <button
            class="row-item"
            :class="{
              active: !props.selectionMode && props.selectedChatId === chat.id,
              selected: isSelected(chat.id)
            }"
            @pointerdown="emit('row-pointer-down', chat.id)"
            @pointerup="emit('row-pointer-up')"
            @pointercancel="emit('row-pointer-cancel')"
            @pointerleave="emit('row-pointer-up')"
            @click="emit('row-click', chat.id)"
          >
            <span
              v-if="props.selectionMode"
              class="row-selector"
              :class="{ on: isSelected(chat.id) }"
            >
              <q-icon v-if="isSelected(chat.id)" :name="icon('check')" size="15px" />
            </span>
            <span
              class="avatar-wrap"
              :class="{ online: chatPeerOnline(chat, props.currentUserId, props.onlineUserIds) }"
            >
              <span
                class="avatar"
                :style="
                  chat.is_self ? savedStyle : avatarStyle(chatTitleOf(chat, props.currentUserId))
                "
              >
                <q-icon
                  v-if="chat.is_self"
                  :name="icon('bookmark')"
                  size="20px"
                  aria-hidden="true"
                />
                <img
                  v-else-if="chatAvatarOf(chat, props.currentUserId)"
                  :src="chatAvatarOf(chat, props.currentUserId)"
                  class="avatar-img"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <template v-else>{{ initials(chatTitleOf(chat, props.currentUserId)) }}</template>
              </span>
            </span>
            <span class="row-text">
              <span class="row-line">
                <span class="row-title">
                  <q-icon
                    v-if="chat.is_channel"
                    :name="icon('campaign')"
                    size="15px"
                    class="row-channel"
                    aria-hidden="true"
                  />
                  {{ chatTitleOf(chat, props.currentUserId) }}
                </span>
                <span class="row-time">
                  <q-icon
                    v-if="isMutedOf(chat.id)"
                    :name="icon('notifications_off')"
                    size="14px"
                    class="row-muted"
                    aria-hidden="true"
                  />
                  {{ chat.last_message ? formatChatTime(chat.last_message.timestamp) : '' }}
                </span>
              </span>
              <span class="row-line">
                <span
                  class="row-sub preview"
                  :class="{
                    typing: isChatTyping(chat, props.typingChatIds),
                    draft: draftOf(chat, props.drafts) !== null
                  }"
                >
                  <template v-if="isChatTyping(chat, props.typingChatIds)">печатает…</template>
                  <template v-else-if="draftOf(chat, props.drafts)">
                    Черновик: {{ draftOf(chat, props.drafts) }}
                  </template>
                  <template v-else>
                    <q-icon
                      v-if="lastMessageIsOut(chat, props.currentUserId)"
                      :name="icon('done')"
                      class="tick"
                      size="16px"
                    />
                    {{ previewText(chat, props.currentUserId) }}
                  </template>
                </span>
                <span v-if="chat.unread_count > 0" class="unread-badge">
                  {{ chat.unread_count }}
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Список чатов: фильтры, скелетоны загрузки и строки диалогов.
 *
 * Вынесено из `ChatSidebar.vue`: сам сайдбар остаётся владельцем жестов (скролл
 * вверх сжимает полосу историй, протяжка списка вниз раскрывает её) и режима
 * выделения — поэтому обработчики приходят сюда функциями, а события строк
 * уходят наверх (`select`, `row-pointer-*`). Подписи строки живут в
 * `utils/chatPreview.ts` и покрыты тестами.
 */
import { icon } from '@/utils/icons'
import type { Chat } from '@/types'
import { avatarStyle, initials } from '@/utils/user'
import { formatChatTime } from '@/utils/format'
import {
  chatAvatarOf,
  chatPeerOnline,
  chatTitleOf,
  draftOf,
  isChatTyping,
  lastMessageIsOut,
  previewText
} from '@/utils/chatPreview'

const props = defineProps<{
  /** Чаты для показа: уже отфильтрованные и упорядоченные (закреплённые вверху). */
  chats: Chat[]
  loading: boolean
  currentUserId: number | null
  selectedChatId: number | null
  selectionMode: boolean
  selectedIds: number[]
  /** Активный фильтр списка («Все», «Непрочитанные», …). */
  filter: string
  filters: { key: string; title: string }[]
  /** Сколько чатов с непрочитанными — счётчик на фильтре. */
  unreadCount: number
  drafts?: Record<number, string>
  typingChatIds?: number[]
  mutedChatIds?: number[]
  onlineUserIds?: number[]
  /** Скролл списка (жесты живут в сайдбаре) и протяжка вниз у самого верха. */
  handleScroll: (el: HTMLElement) => void
  handleTouchStart: (event: TouchEvent) => void
  handleTouchMove: (event: TouchEvent, el: HTMLElement) => void
}>()

const emit = defineEmits<{
  /** Клик по строке: обычное открытие чата или отметка в режиме выделения. */
  (e: 'row-click', chatId: number): void
  (e: 'update:filter', key: string): void
  (e: 'row-pointer-down', chatId: number): void
  (e: 'row-pointer-up'): void
  (e: 'row-pointer-cancel'): void
}>()

/** Аватар-«книжечка» для «Сохранённых сообщений». */
const savedStyle: Record<string, string> = {
  background: 'linear-gradient(135deg, #3b82f6, #1e40af)'
}

const isSelected = (chatId: number): boolean => props.selectedIds.includes(chatId)
const isMutedOf = (chatId: number): boolean => props.mutedChatIds?.includes(chatId) ?? false
</script>

<style scoped>
/* Список занимает место раздела: фильтры сверху, прокрутка — остаток высоты. */
.chats-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-filters {
  display: flex;
  gap: 5px;
  padding: 8px 12px 4px;
  overflow-x: auto;
  scrollbar-width: none;
  /* Затухание у правого края: подсказка, что ряд фильтров можно прокрутить
     (на узких экранах чипы не влезают целиком). Ширина затухания — в пределах
     бокового отступа, поэтому влезающий ряд не подтемняется. */
  mask-image: linear-gradient(to right, black calc(100% - 10px), transparent);
}

.chat-filters::-webkit-scrollbar {
  display: none;
}

.chat-filter {
  flex: 0 0 auto;
  /* Область нажатия расширяет ::after — ей нужна своя система координат. */
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: none;
  border-radius: 11px;
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.chat-filter.active {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
  font-weight: 600;
}

/* Сам чип компактный (пять фильтров должны влезать в 390 px), а область
   нажатия расширена невидимым слоем — палец толще чипа 26 px. */
.chat-filter::after {
  content: '';
  position: absolute;
  inset: -4px -2px;
}

.chat-filter-count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
}
</style>
