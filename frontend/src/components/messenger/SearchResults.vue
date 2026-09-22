<template>
  <div class="people-results">
    <div class="search-mode-tabs" role="tablist" :aria-label="t('Область поиска')">
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
      <button
        class="search-mode-tab"
        :class="{ active: props.mode === 'channels' }"
        role="tab"
        :aria-selected="props.mode === 'channels'"
        @click="emit('set-mode', 'channels')"
      >
        Каналы
      </button>
    </div>

    <div v-if="props.loading" class="search-status">{{ t('Поиск…') }}</div>

    <!-- Люди -->
    <template v-else-if="props.mode === 'people' && props.users.length">
      <div class="section-label">{{ t('Найти людей') }}</div>
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
    <div v-else-if="props.mode === 'people'" class="search-status">{{ t('Никого не найдено') }}</div>

    <!-- Сообщения (по всем диалогам) -->
    <div v-else-if="props.mode === 'messages' && hasAnyMessage">
      <template v-if="props.messages.length">
        <div class="section-label">{{ t('Найдено в чатах') }}</div>
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

      <!-- Зашифрованные чаты: их текст сервер не видит вовсе, поэтому ищем по
           индексу на ЭТОМ устройстве — и подписываем это честно. -->
      <template v-if="localList.length">
        <div class="section-label search-local-label">
          <q-icon :name="icon('lock')" size="14px" />
          В зашифрованных чатах — на этом устройстве
        </div>
        <button
          v-for="msg in localList"
          :key="'local-' + msg.id"
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
              }}<template v-for="(part, i) in parts(snippetOf(msg))" :key="'l' + i">
                <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
          </span>
          <q-icon :name="icon('chevron_right')" class="row-arrow" size="20px" />
        </button>
      </template>
    </div>
    <div v-else-if="props.mode === 'messages'" class="search-status">{{ t('Ничего не найдено') }}</div>

    <!-- Каналы (каталог): публичные каналы по названию и адресу -->
    <template v-else-if="props.channels.length">
      <div class="section-label">{{ t('Публичные каналы') }}</div>
      <button
        v-for="channel in props.channels"
        :key="channel.id"
        class="row-item"
        @click="emit('pick-channel', channel)"
      >
        <span class="avatar rounded" :style="avatarStyle(channel.title)">
          <img
            v-if="channel.avatar_thumb_url || channel.avatar_url"
            :src="(channel.avatar_thumb_url || channel.avatar_url) as string"
            class="avatar-img"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ initials(channel.title) }}</template>
        </span>
        <span class="row-text">
          <span class="row-title">
            <template v-for="(part, i) in parts(channel.title)" :key="'c' + i">
              <mark v-if="part.hit" class="search-hit">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span class="row-sub">
            <template v-if="channel.username">@{{ channel.username }} · </template>
            {{ channel.subscribers }}
            {{ channel.subscribers === 1 ? 'подписчик' : 'подписчиков' }}
            <template v-if="channel.description"> · {{ channel.description }}</template>
          </span>
        </span>
        <!-- Уже подписан — вместо стрелки метка: тап открывает карточку канала. -->
        <q-icon
          v-if="channel.role"
          :name="icon('check')"
          class="row-arrow"
          size="20px"
          :title="t('Вы подписаны')"
        />
        <q-icon v-else :name="icon('chevron_right')" class="row-arrow" size="20px" />
      </button>
    </template>
    <div v-else class="search-status">{{ t('Ничего не найдено') }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * Результаты глобального поиска: переключатель «Люди / Сообщения / Каналы»,
 * найденные люди, сообщения по всем диалогам и публичные каналы (каталог).
 *
 * Одно место на все запросы — и один экран в интерфейсе: отдельный «каталог
 * каналов» был бы вторым входом к тому же серверному поиску, а так человек ищет
 * везде привычным полем в шапке и только переключает вкладку.
 *
 * Вынесено из `ChatSidebar.vue`: панель поиска (поле ввода, жесты, значок в
 * шапке) остаётся в сайдбаре, а отрисовка результатов живёт отдельно. Общие
 * стили строк и подсветки совпадений — в `assets/rows.css` (область `.ms-rows`),
 * здесь только то, что относится к самим результатам.
 */
import { computed } from 'vue'
import { icon } from '@/utils/icons'
import type { ChannelCard, Chat, Message } from '@/types'
import type { SearchUserResult } from '@/services/chatService'
import type { SearchMode } from '@/composables/useGlobalSearch'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { formatMsgTime } from '@/utils/format'
import { splitByQuery } from '@/utils/search'
import { t } from '@/i18n'
import {
  messageChatAvatar,
  messageChatTitle,
  messageSenderPrefix,
  messageSnippetText
} from '@/utils/messageSearch'

const props = defineProps<{
  /** Текущий запрос — по нему подсвечиваем совпадения. */
  query: string
  /** Что показываем: людей, сообщения или публичные каналы. */
  mode: SearchMode
  users: SearchUserResult[]
  messages: Message[]
  /**
   * Совпадения из зашифрованных чатов: индекс лежит на устройстве, сервер такой
   * текст не видит (см. `utils/localSearchIndex.ts`). Показываем отдельным блоком;
   * не передан — считаем, что локальный поиск ничего не нашёл.
   */
  localMessages?: Message[]
  /** Найденные публичные каналы (каталог, вкладка «Каналы»). */
  channels: ChannelCard[]
  loading: boolean
  /** Чаты пользователя: по ним определяем, в каком чате нашлось сообщение. */
  chats: Chat[]
  currentUserId: number | null
}>()

const emit = defineEmits<{
  (e: 'set-mode', mode: SearchMode): void
  (e: 'pick-user', user: SearchUserResult): void
  (e: 'pick-message', message: Message): void
  /** Выбран канал: показываем карточку подписки. */
  (e: 'pick-channel', channel: ChannelCard): void
}>()

/** Части текста с подсветкой совпадений по текущему запросу. */
const parts = (text: string) => splitByQuery(text, props.query)

/** Локальные совпадения: проп необязателен, чтобы компонент жил и без индекса. */
const localList = computed<Message[]>(() => props.localMessages ?? [])

/** Есть что показать хоть из одного источника (сервер или индекс на устройстве). */
const hasAnyMessage = computed<boolean>(
  () => props.messages.length > 0 || localList.value.length > 0
)

const chatTitleOf = (message: Message): string =>
  messageChatTitle(props.chats, message, props.currentUserId)

const chatAvatarOf = (message: Message): string | undefined =>
  messageChatAvatar(props.chats, message, props.currentUserId)

const senderPrefix = (message: Message): string => messageSenderPrefix(message, props.currentUserId)

const snippetOf = (message: Message): string => messageSnippetText(message)
</script>

<style scoped>
/* Режимные вкладки прилипают к верху: результаты длинные и прокручиваются
   внутри своей области, а переключатель остаётся на месте. */
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

/* Блок «в зашифрованных чатах»: замок сразу говорит, почему это отдельный
   список (искать там может только само устройство). */
.search-local-label {
  display: flex;
  align-items: center;
  gap: 5px;
}

.msg-result-snippet {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
