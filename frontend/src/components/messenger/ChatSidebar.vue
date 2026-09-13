<template>
  <aside ref="rootEl" class="side-panel ms-rows">
    <!-- Разделы переключаются нижним меню, поэтому шапка одна на все вкладки:
         сверху остаются только действия, которых в нижнем меню нет. -->
    <!-- Режим выделения чатов (вход по удержанию) -->
    <div v-if="selectionMode" class="selection-bar">
      <button class="icon-btn" title="Отмена" @click="exitSelection">
        <q-icon :name="icon('close')" size="20px" />
      </button>
      <span class="selection-count">{{ selectedIds.length }}</span>
      <div class="selection-actions">
        <button
          class="icon-btn"
          :class="{ on: selectionAllMuted }"
          :title="selectionAllMuted ? 'Включить уведомления' : 'Замьютить выбранные'"
          aria-label="Мьют/анмьют выбранных"
          @click="onBulkMute"
        >
          <q-icon
            :name="icon(selectionAllMuted ? 'notifications' : 'notifications_off')"
            size="20px"
          />
        </button>
        <button
          class="icon-btn"
          :class="{ on: selectionAllPinned }"
          :title="selectionAllPinned ? 'Открепить выбранные' : 'Закрепить выбранные'"
          aria-label="Пин/анпин выбранных"
          @click="onBulkPin"
        >
          <q-icon :name="icon('push_pin')" size="20px" />
        </button>
        <button
          class="icon-btn danger"
          title="Удалить выбранные"
          aria-label="Удалить выбранные"
          @click="onBulkDelete"
        >
          <q-icon :name="icon('delete')" size="20px" />
        </button>
        <button
          class="icon-btn"
          :class="{ on: allVisibleSelected }"
          title="Выбрать все"
          aria-label="Выбрать все"
          @click="toggleSelectAll"
        >
          <q-icon :name="icon('done_all')" size="20px" />
        </button>
      </div>
    </div>

    <div v-else class="panel-header">
      <!-- Значок приложения в углу шапки (как иконка мессенджера). -->
      <!-- <span class="app-mark" aria-hidden="true">
        <img src="/favicon.svg" alt="" width="34" height="34" />
      </span> -->

      <!-- Истории: сжатый ряд кружков рядом со значком приложения. Кликабельность
           видна по зелёному ореолу, нажатие раскрывает полосу под шапкой. -->
      <StoriesStrip
        v-if="view === 'chats'"
        mini
        @toggle-expand="toggleStoriesExpand"
        @open-story="emit('open-story', $event)"
      />

      <div class="panel-header-right">
        <button
          v-if="view === 'chats'"
          class="icon-btn"
          :class="{ open: searchOpen }"
          :title="searchOpen ? 'Закрыть поиск' : 'Поиск'"
          :aria-label="searchOpen ? 'Закрыть поиск' : 'Поиск'"
          @click="toggleSearch"
        >
          <q-icon :name="icon('search')" size="20px" />
        </button>
        <button
          v-if="view === 'contacts'"
          class="icon-btn"
          title="Добавить из контактов телефона"
          aria-label="Добавить из контактов телефона"
          @click="onAddFromPhone"
        >
          <q-icon :name="icon('contacts')" size="20px" />
        </button>
        <span ref="menuWrapEl" class="ms-dropdown-wrap" @click.stop>
          <button
            class="icon-btn"
            :class="{ open: settingsMenuOpen }"
            title="Ещё"
            aria-label="Ещё"
            @click="toggleSettingsMenu"
          >
            <q-icon :name="icon('more_vert')" size="20px" />
          </button>
          <div v-if="settingsMenuOpen" class="ms-dropdown">
            <button
              v-for="action in SETTINGS_ACTIONS"
              :key="action.key"
              class="ms-dropdown-item"
              @click="runSettingsAction(action)"
            >
              <q-icon :name="icon(action.icon)" size="19px" />
              <span>{{ action.label }}</span>
            </button>
          </div>
        </span>
        <button
          class="self-profile-btn"
          title="Настройки профиля"
          aria-label="Настройки профиля"
          @click="emit('open-profile')"
        >
          <span class="avatar self-avatar" :style="avatarStyle(selfName)">
            <img
              v-if="selfAvatarUrl"
              :src="selfAvatarUrl"
              class="avatar-img"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <template v-else>{{ selfName ? initials(selfName) : 'U' }}</template>
          </span>
        </button>
      </div>
    </div>

    <!-- Глобальный поиск: раскрывается слайдом вниз прямо из-под шапки — так же,
         как полоса историй, и так же сжимается (значок в шапке или прокрутка
         списка вверх). Главная страница при этом остаётся на месте: список
         чатов виден и с открытым полем поиска, пока запрос пуст. -->
    <Transition name="slide-down" v-bind="slideDown">
      <div v-if="view === 'chats' && !selectionMode && searchOpen" class="search-collapse">
        <div class="panel-search search-head">
          <q-icon :name="icon('search')" class="search-icon" size="17px" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            class="panel-search-input"
            type="text"
            placeholder="Поиск людей и сообщений"
            aria-label="Глобальный поиск"
            @keydown.esc="closeSearch"
          />
          <button
            v-if="searchQuery.trim()"
            class="icon-btn search-clear"
            title="Очистить"
            aria-label="Очистить"
            @click="searchQuery = ''"
          >
            <q-icon :name="icon('close')" size="18px" />
          </button>
        </div>
      </div>
    </Transition>

    <!-- Разделы меняются плавно: короткий сдвиг + затухание. -->
    <Transition name="section" mode="out-in">
      <div :key="view" class="section-body">
        <!-- Диалоги -->
        <template v-if="view === 'stories'">
          <div class="chat-scroll">
            <StoriesFeed @open-story="emit('open-story', $event)" />
          </div>
        </template>

        <template v-else-if="view === 'chats'">
          <div v-if="searchError" class="inline-error">{{ searchError }}</div>

          <!-- Результаты поиска: люди / сообщения (в SearchResults.vue) -->
          <SearchResults
            v-if="searchActive"
            :query="searchQuery"
            :mode="searchMode"
            :users="userResults"
            :messages="messageResults"
            :loading="searching"
            :chats="chats"
            :current-user-id="currentUserId"
            @set-mode="setSearchMode"
            @pick-user="openChatWithUser"
            @pick-message="openMessageResult"
          />

          <!-- Список чатов: фильтры, скелетоны, строки (в ChatList.vue) -->
          <template v-else>
            <!-- Истории: раскрытая полоса под шапкой. Появляется по нажатию на
                 кружки в шапке или по протяжке списка вниз у самого верха. -->
            <Transition name="slide-down" v-bind="slideDown">
              <div v-if="storiesExpanded" class="stories-collapse">
                <StoriesStrip @open-story="emit('open-story', $event)" />
              </div>
            </Transition>
            <ChatList
              :chats="orderedChats"
              :loading="loadingChats"
              :current-user-id="currentUserId"
              :selected-chat-id="selectedChatId"
              :selection-mode="selectionMode"
              :selected-ids="selectedIds"
              :filter="chatFilter"
              :filters="CHAT_FILTERS"
              :unread-count="unreadChatCount"
              :drafts="drafts"
              :typing-chat-ids="typingChatIds"
              :muted-chat-ids="mutedChatIds"
              :online-user-ids="onlineUserIds"
              :handle-scroll="onChatsScroll"
              :handle-touch-start="onListTouchStart"
              :handle-touch-move="onListTouchMove"
              @update:filter="chatFilter = $event as ChatFilterKey"
              @row-click="onRowClick"
              @row-pointer-down="onRowPointerDown"
              @row-pointer-up="onRowPointerUp"
              @row-pointer-cancel="onRowPointerCancel"
            />
          </template>
        </template>

        <!-- Контакты: поиск, найденные в мессенджере, импорт из книги -->
        <ContactsPanel
          v-else
          :contacts="contacts"
          :current-user-id="currentUserId"
          :loading="contactsLoading"
          :phone-matched="phoneMatched"
          :phone-busy="phoneBusy"
          :phone-error="phoneError"
          :phone-import-open="phoneImportOpen"
          @pick="openChatWithContact"
          @rename="openContactName"
          @clear-phone="clearPhoneMatch"
          @pick-phone="openPhoneMatch"
        />
      </div>
    </Transition>

    <!-- Нижняя навигация: основные разделы приложения -->
    <nav class="bottom-nav" aria-label="Разделы">
      <button
        class="bottom-nav-btn"
        :class="{ active: view === 'chats' }"
        type="button"
        @click="emit('to-chats')"
      >
        <q-icon :name="icon('forum')" size="22px" />
        <span>Чаты</span>
        <span v-if="unreadCount" class="bottom-nav-badge">{{
          unreadCount > 99 ? '99+' : unreadCount
        }}</span>
      </button>
      <button
        class="bottom-nav-btn"
        :class="{ active: view === 'stories' }"
        type="button"
        @click="emit('to-stories')"
      >
        <q-icon :name="icon('auto_stories')" size="22px" />
        <span>Истории</span>
        <span v-if="storiesStore.hasUnseen" class="bottom-nav-dot"></span>
      </button>
      <button
        class="bottom-nav-btn"
        :class="{ active: view === 'contacts' }"
        type="button"
        @click="emit('to-contacts')"
      >
        <q-icon :name="icon('group')" size="22px" />
        <span>Контакты</span>
      </button>
    </nav>

    <!-- Личное имя контакта: добавление / переименование / удаление -->
    <ContactNameDialog
      v-if="contactDialogUser"
      v-model="contactDialogOpen"
      :user="contactDialogUser"
    />
  </aside>

  <!-- Окно импорта контактов из телефонной книги — в PhoneImportDialog.vue. -->
  <PhoneImportDialog
    v-model:manual-phones="manualPhones"
    :open="phoneImportOpen"
    :busy="phoneBusy"
    :error="phoneError"
    :supported="phoneContactsSupported"
    :matched="phoneMatched"
    @close="closePhoneImport"
    @pick-device="pickDeviceContacts"
    @find="findByManualPhones"
    @pick="openPhoneMatch"
  />
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { useStoriesStore } from '@/stores/stories'
import StoriesFeed from '@/components/stories/StoriesFeed.vue'
import StoriesStrip from '@/components/stories/StoriesStrip.vue'
import ContactNameDialog from '@/components/messenger/ContactNameDialog.vue'
import PhoneImportDialog from '@/components/messenger/PhoneImportDialog.vue'
import ChatList from '@/components/messenger/ChatList.vue'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { openPrivateChat, type SearchUserResult } from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import { avatarStyle, initials, isGroupChat } from '@/utils/user'
import { useChatSelection } from '@/composables/useChatSelection'
import { usePhoneImport } from '@/composables/usePhoneImport'
import { useSlideDown } from '@/composables/useSlideDown'
import { useGlobalSearch } from '@/composables/useGlobalSearch'

/**
 * Панель результатов поиска и раздел «Контакты» нужны не при старте (вкладка
 * «Контакты» и запрос в поиске) — грузим их отдельными чанками, чтобы основной
 * бандл оставался компактным. Список чатов, наоборот, нужен сразу.
 */
const SearchResults = defineAsyncComponent(() => import('@/components/messenger/SearchResults.vue'))
const ContactsPanel = defineAsyncComponent(() => import('@/components/messenger/ContactsPanel.vue'))

/** Общие хуки раскрытия для поиска и полосы историй (см. composables/useSlideDown). */
const slideDown = useSlideDown()

const props = defineProps<{
  view: 'chats' | 'contacts' | 'stories'
  currentUserId: number | null
  chats: Chat[]
  contacts: ChatUser[]
  selectedChatId: number | null
  loadingChats: boolean
  contactsLoading: boolean
  /** id пользователей, которые сейчас «в сети» (присутствие из WS). */
  onlineUserIds?: number[]
  /** id чатов, где собеседник сейчас печатает. */
  typingChatIds?: number[]
  /** id закреплённых чатов (показываются вверху списка). */
  pinnedChatIds?: number[]
  /** id замьюченных чатов (без всплывающих уведомлений). */
  mutedChatIds?: number[]
  /** Сохранённые черновики по id чата (показываются в превью). */
  drafts?: Record<number, string>
  /** Имя и аватар текущего пользователя (кнопка «Настройки профиля»). */
  selfName: string
  selfAvatarUrl: string | undefined
  /** Администратор: показывает в «⋯» разбор жалоб. */
  isAdmin?: boolean
  /** Всего непрочитанных сообщений (бейдж на вкладке «Чаты»). */
  unreadCount?: number
}>()

const storiesStore = useStoriesStore()

const emit = defineEmits<{
  (e: 'to-contacts'): void
  (e: 'to-stories'): void
  (e: 'open-story', storyId: number): void
  (e: 'to-chats'): void
  (e: 'open-profile'): void
  (e: 'select-chat', chatId: number): void
  (e: 'chat-opened', chat: Chat): void
  (e: 'open-message', chatId: number, messageId: number): void
  (e: 'toggle-pin', chatId: number): void
  (e: 'toggle-mute', chatId: number): void
  (e: 'bulk-mute', chatIds: number[], muted: boolean): void
  (e: 'bulk-pin', chatIds: number[], pinned: boolean): void
  (e: 'bulk-delete', chatIds: number[]): void
  /** Открыть диалог «Новая группа». */
  (e: 'create-group'): void
  /** Открыть диалог «Новый канал». */
  (e: 'create-channel'): void
  /** Открыть список заблокированных пользователей. */
  (e: 'open-blocked'): void
  /** Открыть разбор жалоб (только администраторы). */
  (e: 'open-reports'): void
}>()

/** Пункт меню «⋯»: иконка Material + подпись. */
interface SettingsAction {
  key: 'group' | 'channel' | 'blocked' | 'reports'
  label: string
  icon: string
}

// Пункты верхнего меню «⋯»; «Жалобы» видят только администраторы.
const SETTINGS_ACTIONS = computed<SettingsAction[]>(() => {
  const items: SettingsAction[] = [
    { key: 'group', label: 'Новая группа', icon: 'group_add' },
    { key: 'channel', label: 'Новый канал', icon: 'campaign' },
    { key: 'blocked', label: 'Заблокированные', icon: 'block' }
  ]
  if (props.isAdmin) items.push({ key: 'reports', label: 'Жалобы', icon: 'flag' })
  return items
})

/**
 * Истории: в шапке лежат сжатые кружки, а сама полоса раскрывается под шапкой.
 *
 * Раскрыть можно нажатием на кружки в шапке или протяжкой списка вниз у самого
 * верха (вместе с полосой открывается и поле поиска); прокрутка списка вверх —
 * снова сжимает обе панели (как в Telegram). Выбор запоминаем, чтобы после
 * перезапуска всё осталось как у человека было.
 */
const STORIES_EXPANDED_KEY = 'pismo_stories_expanded'
const readStoriesExpanded = (): boolean => {
  try {
    return localStorage.getItem(STORIES_EXPANDED_KEY) === '1'
  } catch {
    /* localStorage недоступен — считаем, что полоса сжата */
    return false
  }
}
const storiesExpanded = ref(readStoriesExpanded())

const setStoriesExpanded = (value: boolean) => {
  if (storiesExpanded.value === value) return
  storiesExpanded.value = value
  try {
    localStorage.setItem(STORIES_EXPANDED_KEY, value ? '1' : '0')
  } catch {
    /* приватный режим — выбор запомнится только до перезагрузки */
  }
}

const toggleStoriesExpand = () => setStoriesExpanded(!storiesExpanded.value)

// Копим движение в пределах шага: без этого микро-дрожание скролла мигало бы полосой.
const STORIES_SCROLL_STEP = 24
let storiesScrollAcc = 0
let storiesLastTop = 0
let storiesRaf = 0
/** Список пересоздали — первое событие скролла только задаёт отсчёт. */
let storiesResetPending = false
const onChatsScroll = (el: HTMLElement) => {
  if (storiesRaf) return
  storiesRaf = requestAnimationFrame(() => {
    storiesRaf = 0
    const top = el.scrollTop
    if (storiesResetPending) {
      storiesResetPending = false
      storiesLastTop = top
      storiesScrollAcc = 0
      return
    }
    const delta = top - storiesLastTop
    storiesLastTop = top
    // У самого верха списка ничего не сжимаем: там работает протяжка вниз.
    if (top <= 8) {
      storiesScrollAcc = 0
      return
    }
    const step = STORIES_SCROLL_STEP
    storiesScrollAcc = Math.max(-step, Math.min(step, storiesScrollAcc + delta))
    if (storiesScrollAcc >= step) {
      storiesScrollAcc = 0
      setStoriesExpanded(false)
      // Поле поиска уезжает вверх вместе с полосой историй: обе панели
      // раскрываются протяжкой вниз и сжимаются прокруткой списка.
      if (searchOpen.value) closeSearch()
    }
  })
}

/**
 * Протяжка списка вниз у самого верха раскрывает панели под шапкой — поле
 * поиска и истории, как в Telegram. Срабатывает один раз на касание.
 */
const PULL_EXPAND_PX = 48
let pullStartY = 0
let pullUsed = false
const onListTouchStart = (event: TouchEvent) => {
  pullStartY = event.touches[0]?.clientY ?? 0
  pullUsed = false
}
const onListTouchMove = (event: TouchEvent, el: HTMLElement) => {
  if (pullUsed || el.scrollTop > 0) return
  const y = event.touches[0]?.clientY ?? 0
  if (y - pullStartY < PULL_EXPAND_PX) return
  pullUsed = true
  setStoriesExpanded(true)
  revealSearch()
}

// Список пересоздаётся при смене раздела и при открытии поиска — отсчёт заново
// (сам элемент списка теперь живёт в ChatList.vue, поэтому о пересоздании
// узнаём по смене раздела/режима поиска). Объявление — ниже, рядом с поиском.
onBeforeUnmount(() => {
  if (storiesRaf) cancelAnimationFrame(storiesRaf)
})
const rootEl = ref<HTMLElement | null>(null)
/** Обёртка меню «⋯» (кнопка + выпадающий список) — по ней считаем «клик мимо». */
const menuWrapEl = ref<HTMLElement | null>(null)
const settingsMenuOpen = ref(false)
// Тап/клик мимо меню закрывает «⋯».
//
// ВАЖНО: «мимо» считаем относительно самого меню, а не всей панели: на телефоне
// панель занимает весь экран, и тап «в сторону» попадал ВНУТРЬ панели — меню
// не закрывалось (выглядело как «залипло»).
let outsideHandler: ((event: PointerEvent) => void) | null = null
watch(settingsMenuOpen, (open) => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
  if (open) {
    outsideHandler = (event: PointerEvent) => {
      const wrap = menuWrapEl.value
      if (wrap && !wrap.contains(event.target as Node)) settingsMenuOpen.value = false
    }
    document.addEventListener('pointerdown', outsideHandler)
  }
})

// Поиск живёт в своём композабле (запрос, режим, результаты, задержка, ошибка) —
// здесь остаётся только «открыт/закрыт»: панель, значок в шапке и жесты.
// Имена через двоеточие — чтобы разметка не менялась при переезде состояния.
const {
  query: searchQuery,
  mode: searchMode,
  users: userResults,
  messages: messageResults,
  loading: searching,
  error: searchError,
  hasQuery: searchHasQuery,
  setMode: setSearchMode,
  setError: setSearchError,
  reset: resetSearch
} = useGlobalSearch()
/** Диалог «Добавить в контакты / Имя контакта». */
const contactDialogOpen = ref(false)
const contactDialogUser = ref<ChatUser | null>(null)

const openContactName = (user: ChatUser | SearchUserResult) => {
  contactDialogUser.value = user as ChatUser
  contactDialogOpen.value = true
}

const searchInputRef = ref<HTMLInputElement | null>(null)

/** Закреплён ли чат. */
const isPinnedOf = (chatId: number): boolean => props.pinnedChatIds?.includes(chatId) ?? false

/** Замьючен ли чат. */
const isMutedOf = (chatId: number): boolean => props.mutedChatIds?.includes(chatId) ?? false

// ---------- Режим выделения чатов (long-press; как в Telegram) ----------
// Вход: удержание на чате (~0,5 с). В режиме выделения клик по чату —
// отметить/снять; сверху появляется панель действий (мьют/удалить/выбрать все).
// Логика живёт в composables/useChatSelection.ts (и покрыта тестами).
const {
  selectionMode,
  selectedIds,
  isSelecting,
  exitSelection,
  allVisibleSelected,
  selectionAllMuted,
  selectionAllPinned,
  toggleSelectAll,
  onBulkMute,
  onBulkPin,
  onBulkDelete,
  onRowPointerDown,
  onRowPointerUp,
  onRowPointerCancel,
  onRowClick
} = useChatSelection({
  visibleChatIds: () => orderedChats.value.map((chat) => chat.id),
  isMuted: (chatId) => isMutedOf(chatId),
  isPinned: (chatId) => isPinnedOf(chatId),
  openChat: (chatId) => selectChat(chatId),
  onBulkMute: (ids, muted) => emit('bulk-mute', ids, muted),
  onBulkPin: (ids, pinned) => emit('bulk-pin', ids, pinned),
  onBulkDelete: (ids) => emit('bulk-delete', ids)
})

/**
 * Горячие клавиши на десктопе: ↑/↓ — соседний чат, Ctrl/⌘+F — поиск.
 * В полях ввода клавиши не перехватываем.
 */
const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

const onHotkeys = (event: KeyboardEvent) => {
  if (props.view !== 'chats' || selectionMode.value) return
  const meta = event.ctrlKey || event.metaKey
  if (meta && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    openSearch()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  if (meta || event.altKey || event.shiftKey) return
  if (isTypingTarget(event.target) || searchOpen.value) return
  const list = orderedChats.value.filter((chat) => !chat.is_self)
  if (!list.length) return
  event.preventDefault()
  const currentIndex = list.findIndex((chat) => chat.id === props.selectedChatId)
  const step = event.key === 'ArrowDown' ? 1 : -1
  const nextIndex =
    currentIndex === -1 ? 0 : Math.min(list.length - 1, Math.max(0, currentIndex + step))
  emit('select-chat', list[nextIndex].id)
}

onMounted(() => window.addEventListener('keydown', onHotkeys))
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkeys))

// Родителю нужен режим выделения: системная «назад» должна выходить из него
// (см. `onAppPopState` в Messenger.vue). Отдаём функции — так не важно, как Vue
// разворачивает ref'ы при доступе к дочернему компоненту.
defineExpose({ exitSelection, isSelecting, selectionMode })

// Выход из режима выделения при внешних изменениях (смена вкладки/чата).
watch([() => props.view, () => props.selectedChatId], () => {
  if (selectionMode.value) exitSelection()
})

/** Фильтры списка чатов: все / непрочитанные / личные / группы / каналы. */
type ChatFilterKey = 'all' | 'unread' | 'private' | 'groups' | 'channels'

const CHAT_FILTERS: { key: ChatFilterKey; title: string }[] = [
  { key: 'all', title: 'Все' },
  { key: 'unread', title: 'Непрочитанные' },
  { key: 'private', title: 'Личные' },
  { key: 'groups', title: 'Группы' },
  { key: 'channels', title: 'Каналы' }
]

const chatFilter = ref<ChatFilterKey>('all')

/** Сколько чатов с непрочитанными — счётчик на фильтре. */
const unreadChatCount = computed(
  () => props.chats.filter((chat) => (chat.unread_count ?? 0) > 0).length
)

/** Чаты после фильтра по чипам («Все», «Непрочитанные», «Личные» и т. д.). */
const filteredChats = computed<Chat[]>(() =>
  props.chats.filter((chat) => {
    if (chatFilter.value === 'unread') return (chat.unread_count ?? 0) > 0
    // Канал — тоже групповой чат, поэтому в «Группах» его не показываем.
    if (chatFilter.value === 'groups') return isGroupChat(chat) && !chat.is_channel
    if (chatFilter.value === 'channels') return !!chat.is_channel
    if (chatFilter.value === 'private') return !isGroupChat(chat)
    return true
  })
)

/** Чаты для показа: «Сохранённые сообщения», затем закреплённые, затем остальные. */
const orderedChats = computed<Chat[]>(() => {
  const pinned = new Set(props.pinnedChatIds ?? [])
  const self = filteredChats.value.filter((chat) => chat.is_self)
  const others = filteredChats.value.filter((chat) => !chat.is_self)
  if (pinned.size === 0) return [...self, ...others]
  const top = others.filter((chat) => pinned.has(chat.id))
  const rest = others.filter((chat) => !pinned.has(chat.id))
  return [...self, ...top, ...rest]
})

const toggleSettingsMenu = () => {
  settingsMenuOpen.value = !settingsMenuOpen.value
}

const runSettingsAction = (action: SettingsAction) => {
  settingsMenuOpen.value = false
  if (action.key === 'group') emit('create-group')
  if (action.key === 'channel') emit('create-channel')
  if (action.key === 'blocked') emit('open-blocked')
  if (action.key === 'reports') emit('open-reports')
}

const searchOpen = ref(false)

/**
 * Поиск что-то ищет: панель открыта И запрос непустой.
 *
 * Пока запроса нет, поиск ничего не подменяет — список чатов остаётся на
 * месте, а поле лишь раскрывается над ним. По этому признаку разметка и
 * выбирает: результаты (`people-results`) или обычный список с фильтрами.
 */
const searchActive = computed(() => searchOpen.value && searchHasQuery.value)

// Список пересоздаётся при смене раздела и при открытии поиска: первое событие
// скролла после этого только задаёт отсчёт (иначе дельта считалась бы от
// прокрутки прошлого списка и полоса историй схлопывалась бы рывком).
watch([() => props.view, searchActive], () => {
  storiesResetPending = true
  storiesScrollAcc = 0
})

/** Показать поле поиска, не забирая фокус (протяжка списка вниз, как истории). */
const revealSearch = () => {
  settingsMenuOpen.value = false
  searchOpen.value = true
}

/** Открыть глобальный поиск по значку в шапке: панель раскрывается, фокус в поле. */
const openSearch = () => {
  revealSearch()
  // preventScroll: панель в этот момент ещё свёрнута (высота 0, клип) — без этого
  // браузер «докручивает» список к нулевому полю и прокрутка прыгает.
  requestAnimationFrame(() => searchInputRef.value?.focus({ preventScroll: true }))
}

/**
 * Значок поиска в шапке — переключатель: открывает панель и им же закрывается.
 * Отдельной стрелки «назад» в самой панели нет.
 */
const toggleSearch = () => {
  if (searchOpen.value) closeSearch()
  else openSearch()
}

/** Закрыть глобальный поиск и сбросить запрос с результатами. */
const closeSearch = () => {
  searchOpen.value = false
  resetSearch()
}

const selectChat = (chatId: number) => {
  settingsMenuOpen.value = false
  emit('select-chat', chatId)
}

/** Открытие приватного чата с найденным по поиску пользователем. */
const openChatWithUser = async (user: SearchUserResult) => {
  setSearchError('')
  try {
    const chat = await openPrivateChat(user.id)
    closeSearch()
    settingsMenuOpen.value = false
    emit('chat-opened', chat)
  } catch (error) {
    setSearchError(getErrorMessage(error, 'Не удалось начать переписку'))
  }
}

/** Переход к найденному сообщению в его чате. */
const openMessageResult = (message: Message) => {
  closeSearch()
  settingsMenuOpen.value = false
  emit('open-message', message.chat_id, message.id)
}

/** Открытие приватного чата из вкладки «Контакты». */
const openChatWithContact = async (contact: SearchUserResult) => {
  setSearchError('')
  try {
    const chat = await openPrivateChat(contact.id)
    settingsMenuOpen.value = false
    emit('chat-opened', chat)
  } catch (error) {
    // Ошибку показывает разметка вкладки «Чаты» (как в исходном Messenger).
    setSearchError(getErrorMessage(error, 'Не удалось начать переписку'))
  }
}

// ---------- Импорт контактов из телефонной книги ----------
// Логика — в composables/usePhoneImport.ts (книга телефона или вставка номеров).
const {
  phoneImportOpen,
  phoneBusy,
  phoneError,
  manualPhones,
  phoneMatched,
  phoneContactsSupported,
  closePhoneImport,
  pickDeviceContacts,
  clearPhoneMatch,
  onAddFromPhone,
  findByManualPhones,
  openPhoneMatch
} = usePhoneImport({ openChat: (user) => openChatWithContact(user) })

// Закрываем «⋯» и глобальный поиск при смене вкладки или выбранного чата извне.
watch([() => props.view, () => props.selectedChatId], () => {
  settingsMenuOpen.value = false
  if (searchOpen.value) closeSearch()
})

onBeforeUnmount(() => {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler)
    outsideHandler = null
  }
})
</script>

<style scoped>
.side-panel {
  width: 100%;
  height: 100%;
  background: var(--ms-surface);
  border-right: 1px solid var(--ms-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.icon-btn.open {
  color: var(--ms-accent, #1e9b51);
}

.inline-error {
  color: var(--ms-danger);
  font-size: 12px;
  padding: 6px 14px;
  background: var(--ms-danger-bg);
}

/* ---------- Заголовки панелей ---------- */
.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  background: var(--ms-surface);
}

/* Значок приложения в углу шапки: тот же размер, что у аватара профиля. */
.app-mark {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
}

.app-mark img {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  /* Круг гарантирован: clip-path не зависит от overflow у родителя. */
  clip-path: circle(50%);
}

/* Плавная смена разделов нижнего меню. */
.section-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.section-enter-active,
.section-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.section-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.section-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .section-enter-active,
  .section-leave-active {
    transition: none;
  }
}

.panel-header-right {
  display: flex;
  gap: 2px;
  /* Правая группа иконок прижата к краю: слева — значок приложения и истории. */
  margin-left: auto;
}

/* Кнопка «Профиль»: вместо иконки показываем мини-аватар пользователя.
   Размер — как у иконки «Информация о чате» в шапке чата (40px). */
.self-profile-btn {
  background: none;
  border: none;
  padding: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.self-profile-btn:hover {
  background: var(--ms-hover, #f2f4f6);
}

/* Размер задаём через родителя: собственное правило `.self-avatar` имеет ту же
   специфичность, что и `.ms-rows .avatar` из assets/rows.css, и при переносе
   общих стилей проиграло бы ему по порядку подключения — значок профиля
   раздувался до размера аватара строки чата (46px).
   padding-top — оптическая центровка: прописные инициалы без строчных букв
   сидят выше центра, потому что строка центрируется с запасом под выносные
   элементы. Сдвиг равен отступу (box-sizing — чтобы круг остался 40px). */
.self-profile-btn .self-avatar {
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  padding-top: 2px;
  font-size: 0.9rem;
}

/* Поле поиска под шапкой: боковые отступы как у обычного поля, высоту задаёт
   содержимое (стрелки «назад» в панели нет — закрывает значок в шапке). */
.search-head {
  margin: 8px 10px 10px;
}

.search-clear {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
}

.search-head .panel-search-input {
  min-width: 0;
}

/* Фильтры списка чатов. */
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

.chat-filter-count {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: 10.5px;
  font-weight: 600;
}

/* Обёртки, которые раскрываются слайдом вниз из-под шапки: полоса историй и
   поле поиска. Клип идёт по реальной высоте содержимого — её считает
   useSlideDown (см. composables/useSlideDown.ts), поэтому здесь только «коробка».
   flex-shrink: 0 — иначе флекс-контейнер сжимал бы панель вместо списка. */
.stories-collapse,
.search-collapse {
  overflow: hidden;
  flex-shrink: 0;
}

/* Время перехода держать согласованным с useSlideDown (там 0.28s). */
.slide-down-enter-active,
.slide-down-leave-active {
  overflow: hidden;
  /* Высота меняется каждый кадр — заранее готовим слой. */
  will-change: height, opacity;
  transition:
    height 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.2s ease;
}

/* Содержимое «доезжает» от шапки вниз при открытии и уезжает обратно вверх при
   закрытии — движение читается как слайд, а не как схлопывание высоты на месте. */
.slide-down-enter-active > *,
.slide-down-leave-active > * {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.slide-down-enter-from > *,
.slide-down-leave-to > * {
  transform: translateY(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .slide-down-enter-active,
  .slide-down-leave-active,
  .slide-down-enter-active > *,
  .slide-down-leave-active > * {
    transition: none;
  }
}

.tick {
  font-size: 0.85rem;
  color: var(--ms-tick);
  flex-shrink: 0;
}

/* Заглушка списка: «Контактов пока нет» и т. п.
   (`.search-status` и `.people-results` - в assets/rows.css: их делят список чатов,
   поиск и контакты.) */
/* Dropdown-меню «⋯» */
.ms-dropdown-wrap {
  position: relative;
  display: inline-flex;
}

.ms-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: 12px;
  box-shadow: var(--ms-shadow-pop);
  padding: 6px;
  z-index: 120;
  display: flex;
  flex-direction: column;
}

.ms-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 9px 12px;
  border-radius: 9px;
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  font-family: inherit;
  color: var(--ms-text);
  white-space: nowrap;
}

.ms-dropdown-item:hover {
  background: var(--ms-hover);
}

.ms-dropdown-item i {
  width: 18px;
  text-align: center;
  font-size: 1rem;
  color: var(--ms-icon-2);
}

.ms-dropdown-item .q-icon {
  width: 18px;
  text-align: center;
  color: var(--ms-icon-2);
}

/* Нижний отступ до «плавающей» панели разделов (safe-area учтён в ней). */

/* ---------- Режим выделения чатов (вход по удержанию) ---------- */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #ffffff);
}

.selection-count {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--ms-text, #141d26);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.selection-actions .icon-btn.danger {
  color: var(--ms-danger, #d64545);
}
/* ---------- Нижняя навигация (чаты / истории / контакты) ---------- */
/* «Плавающая» панель разделов: отступ от краёв экрана, радиус, рамка и мягкая
   тень. Тон панели отличается от полотна, рамка полноцветная (не полупрозрачная),
   тень даёт «подъём» — иначе панель выглядит бледной и непонятно, где границы. */
.bottom-nav {
  display: flex;
  align-items: stretch;
  margin: 0 8px calc(8px + env(safe-area-inset-bottom, 0px));
  border-radius: 18px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface-2);
  box-shadow: var(--ms-shadow-float);
  overflow: hidden;
}

.bottom-nav-btn {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 0 8px;
  border: none;
  background: transparent;
  color: var(--ms-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  cursor: pointer;
  transition: color 0.16s ease;
}

/* Активная вкладка — только цветом: фон/подложка здесь лишние. */
.bottom-nav-btn.active {
  color: var(--ms-accent);
  font-weight: 600;
}

.bottom-nav-btn:hover {
  color: var(--ms-text-strong, var(--ms-text));
}

.bottom-nav-btn.active:hover {
  color: var(--ms-accent);
}

/* Точка «есть новое»: прижата к «пилюле» иконки, а не к краю кнопки. */
.bottom-nav-badge {
  position: absolute;
  top: 3px;
  right: calc(50% - 26px);
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 10px;
  background: var(--ms-accent);
  color: var(--ms-on-accent);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 19px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--ms-surface-2);
}

.bottom-nav-dot {
  position: absolute;
  top: 5px;
  right: calc(50% - 17px);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ms-accent);
  box-shadow: 0 0 0 2px var(--ms-surface);
}

@media (max-width: 380px) {
  .bottom-nav-btn {
    font-size: 10.5px;
    padding: 6px 0 7px;
  }
}
</style>
