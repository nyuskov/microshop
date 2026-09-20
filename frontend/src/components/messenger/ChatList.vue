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

      <div v-if="!props.chats.length" class="empty-hint">
        <template v-if="isFolderKey(props.filter)">
          В папке пока нет чатов — добавьте их через «В папку» в меню чата.
        </template>
        <!-- Каналы ищут поиском в шапке (вкладка «Каналы»): отдельной кнопки
             не нужно — подсказка говорит, ГДЕ искать. -->
        <template v-else-if="props.filter === 'channels'">
          Вы пока не подписаны на каналы — найдите их поиском по названию или адресу
        </template>
        <template v-else>
          Найдите пользователя по логину или телефону и начните переписку
        </template>
      </div>
      <div
        v-else
        class="chat-scroll"
        @scroll.passive="props.handleScroll($event.currentTarget as HTMLElement)"
      >
        <div v-for="chat in props.chats" :key="chat.id" class="chat-row">
          <!-- Подсказка свайпа: что произойдёт, если отпустить палец (как в
               Телеграме). Показываем только во время жеста: строка прозрачная,
               и подсказка под ней была бы видна всегда. -->
          <div
            v-if="swipeChatId === chat.id && swipeDx !== 0"
            class="row-swipe"
            :class="[swipeDx > 0 ? 'pin' : 'archive', { ready: swipeReady }]"
            aria-hidden="true"
          >
            <q-icon :name="icon(swipeActionOf(chat.id).icon)" size="18px" />
            <span>{{ swipeActionOf(chat.id).title }}</span>
          </div>
          <button
            class="row-item"
            :class="{
              active: !props.selectionMode && props.selectedChatId === chat.id,
              selected: isSelected(chat.id),
              swiping: swipeChatId === chat.id
            }"
            :style="rowSwipeStyle(chat.id)"
            @pointerdown="emit('row-pointer-down', chat.id)"
            @pointerup="emit('row-pointer-up')"
            @pointercancel="emit('row-pointer-cancel')"
            @pointerleave="emit('row-pointer-up')"
            @click="emit('row-click', chat.id)"
            @touchstart.passive="onRowTouchStart(chat.id, $event)"
            @touchmove.passive="onRowTouchMove"
            @touchend.passive="onRowTouchEnd"
            @touchcancel.passive="onRowTouchEnd"
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
                    size="17px"
                    class="row-channel"
                    aria-hidden="true"
                  />
                  {{ chatTitleOf(chat, props.currentUserId) }}
                </span>
                <span class="row-time">
                  <q-icon
                    v-if="isMutedOf(chat.id)"
                    :name="icon('notifications_off')"
                    size="16px"
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
                    typing: activityOf(chat) !== null,
                    draft: draftOf(chat, props.drafts) !== null
                  }"
                >
                  <template v-if="activityOf(chat) === 'text'">
                    <span class="sr-only">печатает</span>
                    <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  </template>
                  <!-- Запись голосового, отправка файла и т.п. — словами: только
                       точками их не различить. -->
                  <template v-else-if="activityOf(chat)">
                    {{ peerActivityLabel(activityOf(chat) as PeerActivityKind) }}
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
import { chatSwipeAction } from '@/utils/chatSwipe'
import type { Chat } from '@/types'
import { computed, onBeforeUnmount, nextTick, ref, watch } from 'vue'
import { FOLDER_FILTER_PREFIX } from '@/utils/chatFolders'
import { useHScroll } from '@/composables/useHScroll'
import { avatarStyle, initials } from '@/utils/user'
import { formatChatTime } from '@/utils/format'
import {
  chatActivityKind,
  chatAvatarOf,
  chatPeerOnline,
  chatTitleOf,
  draftOf,
  lastMessageIsOut,
  previewCallOf,
  previewText
} from '@/utils/chatPreview'
import { peerActivityLabel, type PeerActivityKind } from '@/utils/peerActivity'

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
  /** Виды активности по чатам: «печатает…», «записывает голосовое…» и т.п. */
  chatActivities?: Record<number, PeerActivityKind>
  mutedChatIds?: number[]
  /** Закреплённые чаты: нужны подписи свайпа («Закрепить»/«Открепить»). */
  pinnedChatIds?: number[]
  /** Архивные чаты: подпись свайпа — «В архив» или «Из архива». */
  archivedChatIds?: number[]
  onlineUserIds?: number[]
  /** Скролл списка: по нему видно, что человек листает чаты (жесты — в сайдбаре). */
  handleScroll: (el: HTMLElement) => void
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
  /** Свайп вправо по строке: закрепить/открепить чат. */
  (e: 'swipe-pin', chatId: number): void
  /** Свайп влево по строке: в архив или из архива. */
  (e: 'swipe-archive', chatId: number): void
  /** Свайп влево, когда в настройках выбран вариант «Уведомления». */
  (e: 'swipe-mute', chatId: number): void
}>()

// ---------- Свайпы по строке (телефон) ----------
/**
 * Вправо — закрепить/открепить, влево — в архив/из архива: те же действия, что
 * в меню чата и в панели выделения, но без долгого тапа и двух нажатий.
 *
 * Жест только ПОДСКАЗЫВАЕТ и срабатывает по отпусканию: содержимое строки мы не
 * сдвигаем на всю ширину, а показываем цветную подложку с подписью — сдвиг увёл
 * бы правый край строки за границу списка и его срезало бы `overflow`.
 */
const SWIPE_ROW_MAX = 96
/** Порог срабатывания: меньше него жест считается случайным и строка едет назад. */
const SWIPE_ROW_TRIGGER = 64
/** С какого движения решаем, что это свайп, а не листание списка. */
const SWIPE_AXIS_MIN = 12

const swipeChatId = ref<number | null>(null)
const swipeDx = ref(0)
let swipeStartX = 0
let swipeStartY = 0
let swipeAxis: 'none' | 'x' | 'y' = 'none'

const swipeReady = computed(() => Math.abs(swipeDx.value) >= SWIPE_ROW_TRIGGER)

const isPinnedOf = (chatId: number): boolean => props.pinnedChatIds?.includes(chatId) ?? false
const isArchivedOf = (chatId: number): boolean => props.archivedChatIds?.includes(chatId) ?? false

/** Подпись и значок подложки: зависят от направления и текущего состояния чата. */
const swipeActionOf = (chatId: number): { icon: string; title: string } => {
  if (swipeDx.value > 0) {
    return { icon: 'push_pin', title: isPinnedOf(chatId) ? 'Открепить' : 'Закрепить' }
  }
  // Левый свайп настраивается (см. utils/chatSwipe.ts): подпись должна обещать
  // ровно то действие, которое выполнится.
  if (chatSwipeAction.value === 'mute') {
    const muted = isMutedOf(chatId)
    return {
      icon: muted ? 'notifications' : 'notifications_off',
      title: muted ? 'Включить уведомления' : 'Выключить уведомления'
    }
  }
  return { icon: 'archive', title: isArchivedOf(chatId) ? 'Из архива' : 'В архив' }
}

const rowSwipeStyle = (chatId: number): Record<string, string> | undefined =>
  swipeChatId.value === chatId && swipeDx.value
    ? { transform: `translateX(${swipeDx.value}px)` }
    : undefined

const resetRowSwipe = () => {
  swipeChatId.value = null
  swipeDx.value = 0
  swipeStartX = 0
  swipeStartY = 0
  swipeAxis = 'none'
}

const onRowTouchStart = (chatId: number, event: TouchEvent) => {
  // В режиме выделения строки отмечают пальцем — свайп там только мешает.
  if (props.selectionMode) return
  const touch = event.touches[0]
  if (!touch) return
  resetRowSwipe()
  swipeChatId.value = chatId
  swipeStartX = touch.clientX
  swipeStartY = touch.clientY
}

const onRowTouchMove = (event: TouchEvent) => {
  if (swipeChatId.value === null || props.selectionMode) return
  const touch = event.touches[0]
  if (!touch) return
  const dx = touch.clientX - swipeStartX
  const dy = touch.clientY - swipeStartY
  if (swipeAxis === 'none') {
    if (Math.abs(dx) < SWIPE_AXIS_MIN && Math.abs(dy) < SWIPE_AXIS_MIN) return
    swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (swipeAxis === 'y') {
      // Вертикальное листание списка: наш жест даже не начинался.
      resetRowSwipe()
      return
    }
    // Свайп отменяет удержание: иначе на медленном движении открылся бы режим
    // выделения (он стартует через 480 мс, жест длится дольше).
    emit('row-pointer-cancel')
  }
  if (swipeAxis !== 'x') return
  swipeDx.value = Math.max(-SWIPE_ROW_MAX, Math.min(SWIPE_ROW_MAX, dx))
}

const onRowTouchEnd = () => {
  const dx = swipeDx.value
  const chatId = swipeChatId.value
  resetRowSwipe()
  if (chatId === null || Math.abs(dx) < SWIPE_ROW_TRIGGER) return
  if (dx > 0) emit('swipe-pin', chatId)
  else if (chatSwipeAction.value === 'mute') emit('swipe-mute', chatId)
  else emit('swipe-archive', chatId)
}

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

/**
 * Чем занят собеседник в этой строке.
 *
 * В групповых чатах подпись не показываем: без имени она бесполезна, а место в
 * строке одно (см. `chatActivityKind`).
 */
const activityOf = (chat: Chat): PeerActivityKind | null =>
  chatActivityKind(chat, props.chatActivities)

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
  /* 6px, а не 4: чип — самая частая цель на телефоне, 26 px по высоте в него
     не попадают; ряд всё равно влезает, высота ширину не меняет. */
  padding: 6px 4px;
  border: none;
  border-radius: var(--ms-radius-sm);
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
  padding: 6px 7px;
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
  inset: -5px -3px;
}

.chat-filter-count {
  padding: 0 5px;
  border-radius: var(--ms-radius-pill);
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
}

/* ---------- Свайп по строке чата ---------- */
/* Подложка лежит ПОД строкой: пока палец ведёт, видно, что случится. Место
   взято у строки, саму строку мы не сдвигаем (см. swipeActionOf). */
.row-swipe {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  font-size: var(--ms-fs-sm);
  font-weight: 600;
}

.row-swipe .q-icon {
  flex: 0 0 auto;
}

/* Свайп вправо — закрепление: подложка слева. */
.row-swipe.pin {
  justify-content: flex-start;
}

/* Свайп влево — архив: подложка справа. */
.row-swipe.archive {
  justify-content: flex-end;
}

/* Порог пройден — действие сработает по отпусканию. */
.row-swipe.ready {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
}

/* Пока строка едет, она непрозрачная: сквозь неё была бы видна подложка. */
.row-item.swiping {
  background: var(--ms-surface);
}
</style>
