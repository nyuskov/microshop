<template>
  <div class="people-results">
    <div class="search-mode-tabs" role="tablist" aria-label="Область поиска">
      <button
        class="search-mode-tab"
        :class="{ active: props.mode === 'people' }"
        role="tab"
        :aria-selected="props.mode === 'people'"
        @click="emit('set-mode', 'people')"
      >
        Люди
      </button>
      <button
        class="search-mode-tab"
        :class="{ active: props.mode === 'messages' }"
        role="tab"
        :aria-selected="props.mode === 'messages'"
        @click="emit('set-mode', 'messages')"
      >
        Сообщения
      </button>
    </div>

    <div v-if="props.loading" class="search-status">Поиск…</div>

    <!-- Люди -->
    <template v-else-if="props.mode === 'people' && props.users.length">
      <div class="section-label">Найти людей</div>
      <button
        v-for="user in props.users"
        :key="user.id"
        class="row-item"
        @click="emit('pick-user', user)"
      >
        <span class="avatar" :style="avatarStyle(displayName(user))">
          <img
            v-if="avatarUrlOf(user)"
            :src="avatarUrlOf(user)"
            class="avatar-img"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ initials(displayName(user)) }}</template>
        </span>
        <span class="row-text">
          <span class="row-title">
            <template v-for="(part, i) in parts(displayName(user))" :key="'n' + i">
              <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span class="row-sub">
            <template v-for="(part, i) in parts('@' + user.username)" :key="'u' + i">
              <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
            <template v-if="user.phone_number"> · {{ user.phone_number }}</template>
          </span>
        </span>
        <q-icon :name="icon('chevron_right')" class="row-arrow" size="20px" />
      </button>
    </template>
    <div v-else-if="props.mode === 'people'" class="search-status">Никого не найдено</div>

    <!-- Сообщения (по всем диалогам) -->
    <template v-else-if="props.messages.length">
      <div class="section-label">Найдено в чатах</div>
      <button
        v-for="msg in props.messages"
        :key="msg.id"
        class="row-item"
        @click="emit('pick-message', msg)"
      >
        <span class="avatar" :style="avatarStyle(chatTitleOf(msg))">
          <img
            v-if="chatAvatarOf(msg)"
            :src="chatAvatarOf(msg)"
            class="avatar-img"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ initials(chatTitleOf(msg)) }}</template>
        </span>
        <span class="row-text">
          <span class="row-line">
            <span class="row-title msg-result-chat">{{ chatTitleOf(msg) }}</span>
            <span class="row-time">{{ formatMsgTime(msg.timestamp) }}</span>
          </span>
          <span class="row-sub msg-result-snippet">
            {{ senderPrefix(msg)
            }}<template v-for="(part, i) in parts(snippetOf(msg))" :key="'s' + i">
              <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
        </span>
        <q-icon :name="icon('chevron_right')" class="row-arrow" size="20px" />
      </button>
    </template>
    <div v-else class="search-status">Ничего не найдено</div>
  </div>
</template>

<script setup lang="ts">
/**
 * Результаты глобального поиска: переключатель «Люди/Сообщения», найденные люди
 * и сообщения по всем диалогам.
 *
 * Вынесено из `ChatSidebar.vue`: панель поиска (поле ввода, жесты, значок в
 * шапке) остаётся в сайдбаре, а отрисовка результатов живёт отдельно. Общие
 * стили строк и подсветки совпадений — в `assets/rows.css` (область `.ms-rows`),
 * здесь только то, что относится к самим результатам.
 */
import { icon } from '@/utils/icons'
import type { Chat, Message } from '@/types'
import type { SearchUserResult } from '@/services/chatService'
import type { SearchMode } from '@/composables/useGlobalSearch'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { formatMsgTime } from '@/utils/format'
import { splitByQuery } from '@/utils/search'
import {
  messageChatAvatar,
  messageChatTitle,
  messageSenderPrefix,
  messageSnippetText
} from '@/utils/messageSearch'

const props = defineProps<{
  /** Текущий запрос — по нему подсвечиваем совпадения. */
  query: string
  /** Что показываем: людей или сообщения. */
  mode: SearchMode
  users: SearchUserResult[]
  messages: Message[]
  loading: boolean
  /** Чаты пользователя: по ним определяем, в каком чате нашлось сообщение. */
  chats: Chat[]
  currentUserId: number | null
}>()

const emit = defineEmits<{
  (e: 'set-mode', mode: SearchMode): void
  (e: 'pick-user', user: SearchUserResult): void
  (e: 'pick-message', message: Message): void
}>()

/** Части текста с подсветкой совпадений по текущему запросу. */
const parts = (text: string) => splitByQuery(text, props.query)

const chatTitleOf = (message: Message): string =>
  messageChatTitle(props.chats, message, props.currentUserId)

const chatAvatarOf = (message: Message): string | undefined =>
  messageChatAvatar(props.chats, message, props.currentUserId)

const senderPrefix = (message: Message): string => messageSenderPrefix(message, props.currentUserId)

const snippetOf = (message: Message): string => messageSnippetText(message)
</script>

<style scoped>
/* Режимные вкладки прилипают к верху: результаты длинные и прокручиваются
   внутри своей области, а переключатель «Люди/Сообщения» остаётся на месте. */
.search-mode-tabs {
  display: flex;
  gap: 6px;
  padding: 2px 14px 8px;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--ms-surface);
}

.search-mode-tab {
  flex: 1;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-muted, #71808d);
  border-radius: 10px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.12s;
}

.search-mode-tab:hover {
  background: var(--ms-hover, #f2f4f6);
}

.search-mode-tab.active {
  border-color: var(--ms-accent, #2ea25e);
  color: var(--ms-accent, #2ea25e);
  background: var(--ms-accent-soft, #e3f2e5);
}

.msg-result-chat {
  color: var(--ms-accent, #2ea25e);
}

.msg-result-snippet {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
