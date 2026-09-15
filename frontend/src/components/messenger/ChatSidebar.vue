<template>
  <aside class="side-panel ms-rows">
    <!-- Шапка панели (обычный режим и режим выделения чатов — в SidebarHeader.vue) -->
    <SidebarHeader
      :selection-mode="selectionMode"
      :selected-count="selectedIds.length"
      :selection-all-muted="selectionAllMuted"
      :selection-all-pinned="selectionAllPinned"
      :all-visible-selected="allVisibleSelected"
      :view="view"
      :expanded="storiesExpanded"
      :search-open="searchOpen"
      :self-name="selfName"
      :self-avatar-url="selfAvatarUrl"
      @exit-selection="exitSelection"
      @bulk-mute="onBulkMute"
      @bulk-pin="onBulkPin"
      @bulk-delete="onBulkDelete"
      @toggle-select-all="toggleSelectAll"
      @toggle-stories-expand="toggleStoriesExpand"
      @open-story="emit('open-story', $event)"
      @toggle-search="toggleSearch"
      @add-from-phone="onAddFromPhone"
      @to-contacts="emit('to-contacts')"
      @to-chats="emit('to-chats')"
      @open-profile="emit('open-profile')"
      @create-group="emit('create-group')"
      @create-channel="emit('create-channel')"
      @open-blocked="emit('open-blocked')"
    />

    <!-- Истории и поиск под шапкой. Порядок как в Telegram: первой выезжает
         полоса историй (она раскрывается «сильнее» — вторым шагом), ниже неё
         поле поиска. Обе сжимаются прокруткой списка вверх. -->
    <Transition name="slide-strong" v-bind="slideDownStories">
      <div
        v-if="view === 'chats' && !selectionMode && storiesExpanded && !searchActive"
        class="stories-collapse"
      >
        <StoriesStrip @open-story="emit('open-story', $event)" />
      </div>
    </Transition>

    <!-- Глобальный поиск: раскрывается слайдом вниз прямо из-под шапки и
         сжимается значком в шапке или прокруткой списка вверх. Главная страница
         при этом остаётся на месте: список чатов виден и с открытым полем
         поиска, пока запрос пуст. -->
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
        <template v-if="view === 'chats'">
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

    <!-- Админская «шестерёнка» — только значок в левом нижнем углу панели, как
         управление в VS Code. Сюда уходят ВСЕ служебные разделы (приглашения,
         жалобы и журнал модерации), чтобы не мешаться в обычных настройках
         профиля. Подписи нет намеренно: строка во всю ширину читалась как ещё
         один раздел списка чатов, а смысл кнопки объясняют title и aria-label.
         Видна только аккаунту администратора. -->
    <button
      v-if="isAdmin && !selectionMode"
      class="admin-gear"
      type="button"
      title="Администрирование"
      aria-label="Администрирование"
      @click="emit('open-admin')"
    >
      <q-icon :name="icon('admin_panel_settings')" size="22px" />
    </button>

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
import StoriesStrip from '@/components/stories/StoriesStrip.vue'
import SidebarHeader from '@/components/messenger/SidebarHeader.vue'
import ContactNameDialog from '@/components/messenger/ContactNameDialog.vue'
import PhoneImportDialog from '@/components/messenger/PhoneImportDialog.vue'
import ChatList from '@/components/messenger/ChatList.vue'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { openPrivateChat, type SearchUserResult } from '@/services/chatService'
import type { Chat, ChatUser, Message } from '@/types'
import { isGroupChat } from '@/utils/user'
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

/**
 * Хуки раскрытия (см. composables/useSlideDown): у поиска — обычный слайд,
 * у полосы историй — усиленный (она раскрывается вторым шагом и живёт выше).
 */
const slideDown = useSlideDown()
const slideDownStories = useSlideDown()

const props = defineProps<{
  view: 'chats' | 'contacts'
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
  /** Администратор: показывает разбор жалоб в меню и «шестерёнку» внизу. */
  isAdmin?: boolean
}>()

const emit = defineEmits<{
  (e: 'to-contacts'): void
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
  /** Открыть админскую панель (приглашения, жалобы) — только администраторы. */
  (e: 'open-admin'): void
}>()

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
      // Слои сжимаются в обратном порядке раскрытия: сначала истории (они
      // раскрываются вторым шагом), потом поле поиска.
      if (storiesExpanded.value) {
        setStoriesExpanded(false)
        return
      }
      if (searchOpen.value) closeSearch()
    }
  })
}

/**
 * Протяжка списка вниз у самого верха раскрывает панели под шапкой — как в
 * Telegram, по шагам: первое движение открывает поле поиска, следующее (уже
 * сильнее) — полосу историй над ним. За одно касание делаем только один шаг,
 * поэтому «второй» требует отдельной протяжки.
 */
const PULL_EXPAND_PX = 48
/** Порог для историй выше: они раскрываются вторым, более сильным движением. */
const PULL_STORIES_PX = 96
let pullStartY = 0
let pullUsed = false
const onListTouchStart = (event: TouchEvent) => {
  pullStartY = event.touches[0]?.clientY ?? 0
  pullUsed = false
}
const onListTouchMove = (event: TouchEvent, el: HTMLElement) => {
  if (pullUsed || el.scrollTop > 0) return
  const y = event.touches[0]?.clientY ?? 0
  const distance = y - pullStartY
  if (!searchOpen.value) {
    if (distance < PULL_EXPAND_PX) return
    pullUsed = true
    revealSearch()
    return
  }
  if (storiesExpanded.value || distance < PULL_STORIES_PX) return
  pullUsed = true
  setStoriesExpanded(true)
}

// Список пересоздаётся при смене раздела и при открытии поиска — отсчёт заново
// (сам элемент списка теперь живёт в ChatList.vue, поэтому о пересоздании
// узнаём по смене раздела/режима поиска). Объявление — ниже, рядом с поиском.
onBeforeUnmount(() => {
  if (storiesRaf) cancelAnimationFrame(storiesRaf)
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
  emit('select-chat', chatId)
}

/** Открытие приватного чата с найденным по поиску пользователем. */
const openChatWithUser = async (user: SearchUserResult) => {
  setSearchError('')
  try {
    const chat = await openPrivateChat(user.id)
    closeSearch()
    emit('chat-opened', chat)
  } catch (error) {
    setSearchError(getErrorMessage(error, 'Не удалось начать переписку'))
  }
}

/** Переход к найденному сообщению в его чате. */
const openMessageResult = (message: Message) => {
  closeSearch()
  emit('open-message', message.chat_id, message.id)
}

/** Открытие приватного чата из вкладки «Контакты». */
const openChatWithContact = async (contact: SearchUserResult) => {
  setSearchError('')
  try {
    const chat = await openPrivateChat(contact.id)
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

// Закрываем глобальный поиск при смене вкладки или выбранного чата извне.
watch([() => props.view, () => props.selectedChatId], () => {
  if (searchOpen.value) closeSearch()
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

/* Админская «шестерёнка»: только значок в левом нижнем углу панели (как
   управление в VS Code). Размер — как у значка профиля в шапке
   (`.self-profile-btn` / `.self-avatar`: круг 40px), чтобы оба значка читались
   парой; левый отступ совпадает с отступом шапки (12px).
   Видна только администратору (v-if в разметке). */
.admin-gear {
  display: flex;
  flex: none;
  align-self: flex-start;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  /* Отступ снизу = безопасная зона: на телефоне с полоской-индикатором кнопка
     в самом низу экрана иначе оказалась бы под системной панелью. */
  margin: 2px 0 calc(8px + env(safe-area-inset-bottom, 0px)) 12px;
  padding: 0;
  font-family: inherit;
  color: var(--ms-icon-2);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.admin-gear:hover {
  color: var(--ms-text);
  background: var(--ms-hover);
}

.admin-gear:active {
  transform: scale(0.94);
}

.admin-gear:focus-visible {
  outline: 2px solid var(--ms-accent);
  outline-offset: -2px;
}

.inline-error {
  color: var(--ms-danger);
  font-size: 12px;
  padding: 6px 14px;
  background: var(--ms-danger-bg);
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

/* Сам чип держим компактным (пять фильтров должны влезать в 390 px), а область
   нажатия расширяем невидимым слоем: зазор между чипами 5 px, поэтому 2 px по
   горизонтали и 4 px по вертикали — соседи не перехватывают нажатие, а
   вертикаль остаётся внутри отступов полосы (8 px сверху, 4 px снизу). */
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

/**
 * Полоса историй раскрывается вторым шагом и живёт выше поля поиска — движение
 * делаем заметнее: содержимое уезжает дальше (с лёгким уменьшением), а время
 * чуть больше, чем у поиска. Длительность согласована с useSlideDown.
 */
.slide-strong-enter-active,
.slide-strong-leave-active {
  overflow: hidden;
  will-change: height, opacity;
  transition:
    height 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease;
}

.slide-strong-enter-active > *,
.slide-strong-leave-active > * {
  transition:
    transform 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.24s ease;
}

.slide-strong-enter-from > *,
.slide-strong-leave-to > * {
  transform: translateY(-160%) scale(0.96);
  opacity: 0;
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
</style>
