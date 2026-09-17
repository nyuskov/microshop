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
      <!-- Фильтры списка: быстро отсечь непрочитанное, личные или группы.
           Ряд листается (папки могут не влезать): колесом мыши, свайпом и
           перетаскиванием мышью — см. useHScroll. -->
      <div
        v-if="!props.selectionMode"
        ref="filtersEl"
        class="chat-filters"
        :class="{ 'fade-start': filterEdges.start, 'fade-end': filterEdges.end }"
        role="tablist"
        aria-label="Фильтр чатов"
        @scroll.passive="refreshFilterEdges"
        @wheel.passive="onFiltersWheel"
        @pointerdown="onFiltersPointerDown"
        @pointermove="onFiltersPointerMove"
        @pointerup="onFiltersPointerUp"
        @pointercancel="onFiltersPointerUp"
        @pointerleave="onFiltersPointerUp"
      >
        <button
          v-for="filter in props.filters"
          :key="filter.key"
          type="button"
          class="chat-filter"
          :class="{ active: props.filter === filter.key, folder: isFolderKey(filter.key) }"
          :data-filter="filter.key"
          role="tab"
          :aria-selected="props.filter === filter.key"
          :aria-label="folderHint(filter.key) || undefined"
          @click="onFilterClick(filter.key)"
          @contextmenu.prevent="manageFolder(filter.key)"
          @pointerdown="onFilterDown(filter.key)"
          @pointerup="cancelFilterHold"
          @pointerleave="cancelFilterHold"
          @pointercancel="cancelFilterHold"
        >
          <q-icon
            v-if="isFolderKey(filter.key)"
            :name="icon('folder')"
            size="15px"
            aria-hidden="true"
          />
          {{ filter.title }}
          <span v-if="filterCount(filter.key)" class="chat-filter-count">
            {{ filterCount(filter.key) > 99 ? '99+' : filterCount(filter.key) }}
          </span>
        </button>
        <!-- Создание папки: папок нет — это первый вход, папки есть — рядом с ними. -->
        <button
          type="button"
          class="chat-filter chat-filter-add"
          title="Новая папка"
          aria-label="Новая папка чатов"
          @click="emit('create-folder')"
        >
          <q-icon :name="icon('add')" size="16px" />
        </button>
      </div>

      <div class="section-label">Недавние</div>
      <div v-if="!props.chats.length" class="empty-hint">
        <template v-if="isFolderKey(props.filter)">
          В папке пока нет чатов — добавьте их через «В папку» в меню чата.
        </template>
        <template v-else>
          Найдите пользователя по логину или телефону и начните переписку
        </template>
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
                  <template v-if="isChatTyping(chat, props.typingChatIds)">
                    <span class="sr-only">печатает</span>
                    <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  </template>
                  <template v-else-if="draftOf(chat, props.drafts)">
                    Черновик: {{ draftOf(chat, props.drafts) }}
                  </template>
                  <template v-else>
                    <!-- Звонок в превью: иконка вместо галочки — по ней видно, что
                         был звонок (аудио/видео) и чем закончился (пропущен —
                         красным), иначе в строке не было ничего. -->
                    <q-icon
                      v-if="previewCallOf(chat.last_message)"
                      :name="icon(previewCallOf(chat.last_message)?.icon ?? 'call')"
                      class="call-mark"
                      :class="{ missed: previewCallOf(chat.last_message)?.missed }"
                      size="16px"
                      aria-hidden="true"
                    />
                    <q-icon
                      v-else-if="lastMessageIsOut(chat, props.currentUserId)"
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
import { onBeforeUnmount, nextTick, watch } from 'vue'
import { FOLDER_FILTER_PREFIX } from '@/utils/chatFolders'
import { useHScroll } from '@/composables/useHScroll'
import { avatarStyle, initials } from '@/utils/user'
import { formatChatTime } from '@/utils/format'
import {
  chatAvatarOf,
  chatPeerOnline,
  chatTitleOf,
  draftOf,
  isChatTyping,
  lastMessageIsOut,
  previewCallOf,
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
  /** Сколько чатов с непрочитанными — счётчик на фильтре «Непрочитанные». */
  unreadCount: number
  /** Сколько чатов в архиве — счётчик на чипе «Архив» (заодно видно, живой ли он). */
  archivedCount?: number
  /** Сколько из архивных чатов с непрочитанными: подсвечиваем счётчик. */
  archivedUnreadCount?: number
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
  /** Создать новую папку чатов (кнопка «+» в ряду фильтров). */
  (e: 'create-folder'): void
  /** Открыть управление папкой (долгий тап или правый клик по чипу папки). */
  (e: 'manage-folder', id: string): void
  (e: 'row-pointer-down', chatId: number): void
  (e: 'row-pointer-up'): void
  (e: 'row-pointer-cancel'): void
}>()

// ---------- Чипы папок ----------
// Фильтр папки приходит как `folder:<id>`: по этому префиксу отличаем свои папки
// от базовых чипов (и рисуем иконку). Управление папкой — долгий тап (телефон)
// или правый клик (десктоп): отдельной кнопки на маленьком чипе не поместить.
const FOLDER_HOLD_MS = 500
const isFolderKey = (key: string): boolean => key.startsWith(FOLDER_FILTER_PREFIX)
const folderHint = (key: string): string =>
  isFolderKey(key) ? 'Папка чатов: долгий тап — изменить' : ''

let folderHoldTimer: number | undefined
const cancelFilterHold = () => {
  if (folderHoldTimer !== undefined) {
    window.clearTimeout(folderHoldTimer)
    folderHoldTimer = undefined
  }
}

const onFilterDown = (key: string) => {
  cancelFilterHold()
  if (!isFolderKey(key)) return
  folderHoldTimer = window.setTimeout(() => {
    folderHoldTimer = undefined
    emit('manage-folder', key.slice(FOLDER_FILTER_PREFIX.length))
  }, FOLDER_HOLD_MS)
}

const manageFolder = (key: string) => {
  cancelFilterHold()
  if (isFolderKey(key)) emit('manage-folder', key.slice(FOLDER_FILTER_PREFIX.length))
}

onBeforeUnmount(cancelFilterHold)

/**
 * Число в счётчике на чипе.
 *
 * «Непрочитанные» — сколько чатов ждут прочтения; «Архив» — сколько архивных
 * непрочитано (чтобы не пропустить сообщение в убранном чате). У остальных
 * чипов счётчика нет.
 */
const filterCount = (key: string): number => {
  if (key === 'unread') return props.unreadCount
  if (key === 'archived') return props.archivedUnreadCount ?? 0
  return 0
}

/** Аватар-«книжечка» для «Сохранённых сообщений». */
const savedStyle: Record<string, string> = {
  background: 'linear-gradient(135deg, #3b82f6, #1e40af)'
}

const isSelected = (chatId: number): boolean => props.selectedIds.includes(chatId)
const isMutedOf = (chatId: number): boolean => props.mutedChatIds?.includes(chatId) ?? false

// Ряд фильтров на узких экранах шире панели (шесть базовых чипов не влезают в
// 320–390 px), а папок может быть до десяти — поэтому ряд листается колесом
// мыши, свайпом и перетаскиванием мышью (общий механизм — useHScroll).
// Затухания по краям показываем только там, где правда есть скрытое: статичная
// маска прятала текст чипа в конце прокрутки.
const {
  el: filtersEl,
  edges: filterEdges,
  refresh: refreshFilterEdges,
  onWheel: onFiltersWheel,
  onPointerDown: onFiltersPointerDown,
  onPointerMove: onFiltersPointerMove,
  onPointerUp: onFiltersPointerUpRaw,
  wasDragged: filtersWereDragged,
  reveal: revealFilter
} = useHScroll(() => props.filters.length)

/** Отпускание указателя: гасим ещё и таймер долгого тапа по чипу папки. */
const onFiltersPointerUp = () => {
  onFiltersPointerUpRaw()
  cancelFilterHold()
}

/** Клик по чипу: фильтр, но не после перетаскивания ряда. */
const onFilterClick = (key: string) => {
  if (filtersWereDragged()) return
  emit('update:filter', key)
  // Выбранная папка должна быть видна — догоняем её, если она уехала за край.
  void nextTick(() => revealFilter(`[data-filter="${key}"]`))
}

// Фильтр сменили не только кликом (горячие клавиши, удаление папки) — тоже
// показываем активный чип.
watch(
  () => props.filter,
  (key) => void nextTick(() => revealFilter(`[data-filter="${key}"]`))
)
</script>

<style scoped>
/* Список занимает место раздела: фильтры сверху, прокрутка — остаток высоты. */
.chats-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Ряд чипов: листается мышью и пальцем, поэтому курсор-«рука». */
.chat-filters {
  display: flex;
  gap: 4px;
  padding: 8px 12px 4px;
  overflow-x: auto;
  /* Прокрутка ряда не должна утаскивать за собой список чатов при достижении края. */
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}

/* Затухание у того края, где действительно есть скрытые чипы: это подсказка,
   что ряд листается (колесом, трекпадом или свайпом). Ширина затухания —
   в пределах бокового отступа, поэтому влезающий ряд не подтемняется. */
.chat-filters.fade-end {
  mask-image: linear-gradient(to right, black calc(100% - 10px), transparent);
}

.chat-filters.fade-start {
  mask-image: linear-gradient(to right, transparent, black 10px);
}

.chat-filters.fade-start.fade-end {
  mask-image: linear-gradient(
    to right,
    transparent,
    black 10px,
    black calc(100% - 10px),
    transparent
  );
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
  padding: 4px 4px;
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

/* Чип папки: иконка показывает, что это своя папка, а не базовый фильтр. */
.chat-filter.folder {
  border: 1px solid var(--ms-border);
}

.chat-filter-add {
  padding: 4px 7px;
  border: 1px dashed var(--ms-border);
  background: transparent;
  color: var(--ms-muted-2);
}

.chat-filter-add:hover {
  color: var(--ms-text);
  border-color: var(--ms-accent-border);
}

/* Сам чип компактный (шесть фильтров должны влезать в 320–390 px), а область
   нажатия расширена невидимым слоем — палец толще чипа 25 px. */
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
