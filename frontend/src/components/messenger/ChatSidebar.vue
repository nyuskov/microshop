<template>
  <!-- Жесты (протяжка вниз — раскрыть панели, смах вверх — убрать) слушаем на
       всей панели: свайп по шапке, поиску или полосе фильтров тоже должен
       работать (см. onPanelTouchMove). -->
  <aside
    ref="panelRoot"
    class="side-panel ms-rows"
    :class="{ pulling }"
    :style="pullStyle"
    @touchstart.passive="onPanelTouchStart"
    @touchmove.passive="onPanelTouchMove"
    @touchend.passive="onPanelTouchEnd"
    @touchcancel.passive="onPanelTouchEnd"
  >
    <!--
    Отклик на протяжку вниз (22.04?): панель едет за пальцем по «резинке», а на
    пороге раскрытие продолжается ровно с той высоты, где её держал палец
    (`pullHandoff` + `startFrom` в `useSlideDown`). Полосы прогресса сверху нет:
    на телефоне она выглядела чужой цветной чертой над шапкой.
  -->
    <!-- Шапка панели (обычный режим и режим выделения чатов — в SidebarHeader.vue) -->
    <SidebarHeader
      :selection-mode="selectionMode"
      :selected-count="selectedIds.length"
      :selection-all-muted="selectionAllMuted"
      :selection-all-pinned="selectionAllPinned"
      :selection-all-archived="selectionAllArchived"
      :all-visible-selected="allVisibleSelected"
      :view="view"
      :expanded="storiesExpanded"
      :search-open="searchOpen"
      :self-name="selfName"
      :self-avatar-url="selfAvatarUrl"
      @exit-selection="exitSelection"
      @bulk-mute="onBulkMute"
      @bulk-pin="onBulkPin"
      @bulk-archive="onBulkArchive"
      @bulk-folders="emit('bulk-folders', [...selectedIds])"
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
      @open-calls="emit('open-calls')"
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
            :placeholder="t('Поиск: люди, сообщения, каналы')"
            :aria-label="t('Глобальный поиск')"
            @keydown.esc="closeSearch"
          />
          <button
            v-if="searchQuery.trim()"
            class="icon-btn search-clear"
            :title="t('Очистить')"
            :aria-label="t('Очистить')"
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
          <ErrorNotice v-if="searchError" :message="searchError" @dismiss="setSearchError('')" />

          <!-- Результаты поиска: люди / сообщения (в SearchResults.vue) -->
          <SearchResults
            v-if="searchActive"
            :query="searchQuery"
            :mode="searchMode"
            :users="userResults"
            :messages="messageResults"
            :local-messages="localMessages"
            :channels="channelResults"
            :loading="searching"
            :chats="chats"
            :current-user-id="currentUserId"
            @set-mode="setSearchMode"
            @pick-user="openChatWithUser"
            @pick-message="openMessageResult"
            @pick-channel="openChannelResult"
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
              :filters="visibleFilters"
              :unread-count="unreadChatCount"
              :archived-count="archivedCount"
              :archived-unread-count="archivedUnreadCount"
              :drafts="drafts"
              :chat-activities="chatActivities"
              :muted-chat-ids="mutedChatIds"
              :pinned-chat-ids="pinnedChatIds"
              :archived-chat-ids="archivedChatIds"
              :online-user-ids="onlineUserIds"
              :handle-scroll="onChatsScroll"
              @update:filter="chatFilter = $event as ChatFilterValue"
              @create-folder="emit('create-folder')"
              @manage-folder="emit('manage-folder', $event)"
              @row-click="onRowClick"
              @row-pointer-down="onRowPointerDown"
              @row-pointer-up="onRowPointerUp"
              @row-pointer-cancel="onRowPointerCancel"
              @swipe-pin="onSwipePin"
              @swipe-archive="onSwipeArchive"
              @swipe-mute="onSwipeMute"
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
import { t } from '@/i18n'
import StoriesStrip from '@/components/stories/StoriesStrip.vue'
import SidebarHeader from '@/components/messenger/SidebarHeader.vue'
import ContactNameDialog from '@/components/messenger/ContactNameDialog.vue'
import PhoneImportDialog from '@/components/messenger/PhoneImportDialog.vue'
import ChatList from '@/components/messenger/ChatList.vue'
import ErrorNotice from '@/components/common/ErrorNotice.vue'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getErrorMessage } from '@/services/errors'
import { openPrivateChat, type SearchUserResult } from '@/services/chatService'
import type { ChannelCard, Chat, ChatUser, Message } from '@/types'
import type { PeerActivityKind } from '@/utils/peerActivity'
import { useChatSelection } from '@/composables/useChatSelection'
import {
  CHAT_FILTERS,
  chatMatchesFilter,
  isChatArchived,
  type ChatFilterValue
} from '@/utils/chatFilters'
import {
  folderById,
  folderChats,
  folderFilter,
  FOLDER_FILTER_PREFIX,
  type ChatFolder
} from '@/utils/chatFolders'
import { usePhoneImport } from '@/composables/usePhoneImport'
import { haptic } from '@/utils/haptics'
import { useSlideDown } from '@/composables/useSlideDown'
import { useGlobalSearch } from '@/composables/useGlobalSearch'
import { useMobileLayer } from '@/composables/useMobileOverlay'
import { useStoriesStore } from '@/stores/stories'
import { firstStoryToOpen } from '@/utils/stories'
import { orderChats } from '@/utils/chatOrder'

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
const slideDown = useSlideDown({ startFrom: () => pullHandoff.value })
const slideDownStories = useSlideDown({ startFrom: () => pullHandoff.value })

/**
 * Истории нужны не только полосе, но и жесту: третья ступень протяжки открывает
 * воспроизведение (см. `openStoriesPlayback`).
 */
const storiesStore = useStoriesStore()

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
  /** Виды активности по чатам («печатает…», «записывает голосовое…»). */
  chatActivities?: Record<number, PeerActivityKind>
  /** id закреплённых чатов (показываются вверху списка). */
  pinnedChatIds?: number[]
  /** id замьюченных чатов (без всплывающих уведомлений). */
  mutedChatIds?: number[]
  /** id чатов в архиве (архив хранится локально, как пины). */
  archivedChatIds?: number[]
  /** Папки чатов пользователя: свои списки с ручным порядком (локально). */
  chatFolders?: ChatFolder[]
  /** Сохранённые черновики по id чата (показываются в превью). */
  drafts?: Record<number, string>
  /** Имя и аватар текущего пользователя (кнопка «Настройки профиля»). */
  selfName: string
  selfAvatarUrl: string | undefined
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
  (e: 'bulk-archive', chatIds: number[], archived: boolean): void
  /** Добавить выбранные чаты в папку (открывает выбор папок). */
  (e: 'bulk-folders', chatIds: number[]): void
  (e: 'bulk-delete', chatIds: number[]): void
  /** Создать папку чатов (кнопка «+» в ряду фильтров). */
  (e: 'create-folder'): void
  /** Управление папкой (долгий тап по её чипу). */
  (e: 'manage-folder', id: string): void
  /** Открыть диалог «Новая группа». */
  (e: 'create-group'): void
  /** Открыть диалог «Новый канал». */
  (e: 'create-channel'): void
  /** Выбран канал в поиске: открыть карточку подписки по адресу. */
  (e: 'open-channel', username: string): void
  /** Открыть список заблокированных пользователей. */
  (e: 'open-blocked'): void
  /** История звонков (пункт меню «⋯» в шапке панели). */
  (e: 'open-calls'): void
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

/**
 * Открывает воспроизведение историй — третья ступень протяжки вниз.
 *
 * Какую историю играть первой, решает `utils/stories.firstStoryToOpen`: то же
 * правило выбирает историю при тапе по кружку в шапке, поэтому «первая» не может
 * означать разное в двух местах.
 */
const openStoriesPlayback = () => {
  const storyId = firstStoryToOpen(storiesStore.others, storiesStore.mine)
  // Играть нечего (у друзей нет историй) — полоса остаётся раскрытой: человек
  // видит, что открывать нечего, и жест не выглядит сломанным.
  if (storyId === null) return
  emit('open-story', storyId)
}

/**
 * Сжимает верхние панели на один шаг — в порядке, обратном раскрытию: сначала
 * истории (они раскрываются вторым шагом), потом поле поиска.
 *
 * Возвращает `true`, если что-то сжалось: по этому признаку прокрутка списка
 * расходует движение целиком, а не сжимает обе панели одним движением.
 */
const collapseTopPanels = (): boolean => {
  if (storiesExpanded.value) {
    setStoriesExpanded(false)
    return true
  }
  if (searchOpen.value) {
    closeSearch()
    return true
  }
  return false
}

/** Копим движение в пределах шага: без этого микро-дрожание скролла мигало бы полосой. */
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
      collapseTopPanels()
    }
  })
}

/**
 * Жесты по панели: протяжка вниз у самого верха списка раскрывает панели под
 * шапкой — как в Telegram, по шагам (первое движение открывает поле поиска,
 * следующее, уже сильнее, — полосу историй над ним, а третье, самое сильное,
 * сразу открывает воспроизведение историй); обратное движение
 * (смахнуть вверх) так же по шагам их сжимает.
 *
 * Слушаем ВСЮ панель (`@touchstart`/`@touchmove` на `.side-panel`), а не только
 * список чатов: свайп по шапке, полю поиска, полосе фильтров или полосе историй
 * до списка не доходил, и жест «смахнуть вверх, чтобы убрать поиск» на телефоне
 * просто ничего не делал. Раскрытие протяжкой вниз при этом по-прежнему только
 * по списку: тянуть вниз по шапке не должно открывать панели случайно.
 */
const PULL_EXPAND_PX = 48
/** Порог для историй выше: они раскрываются вторым, более сильным движением. */
const PULL_STORIES_PX = 96
/**
 * Третий шаг — воспроизведение историй: полоса уже раскрыта, человек тянет
 * дальше. Порог выше порога раскрытия: шаги должны читаться по силе, иначе
 * плеер открывался бы тем же движением, что и сама полоса.
 */
const PULL_PLAY_PX = 150
/**
 * Порог обратного движения — «смахнуть вверх, чтобы убрать панели». Он ниже,
 * чем у протяжки вниз: это жест «убрать с дороги», он должен срабатывать легко.
 */
const SWIPE_COLLAPSE_PX = 32
let pullStartY = 0
let pullUsed = false
/** Касание началось на самом списке — только там работает протяжка вниз. */
let pullFromList = false

/**
 * Отклик на протяжку: панель едет за пальцем по «резинке».
 *
 * Ход был линейным с жёстким пределом (0.55 × расстояние, максимум 68px): панель
 * упиралась в стену, и это читалось как сильная натяжка — ровно то, что видно
 * глазом. Теперь ход асимптотический: чем дальше тянешь, тем меньше двигается,
 * стены нет; максимум меньше порога раскрытия поиска, поэтому «упора» не видно.
 */
const PULL_SOFT_PX = 90

/** Максимум хода: меньше порога раскрытия поиска (48px). */
const PULL_MAX_PX = 40

const pullOffset = ref(0)
const pulling = ref(false)
/**
 * С какой высоты панель продолжит раскрытие на пороге.
 *
 * Смещение панели в этот же момент снимается, а панель вырастает на ту же
 * высоту — содержимое остаётся на месте (без скачка), и переход читает это
 * значение своим `startFrom`.
 */
const pullHandoff = ref(0)
let pullHandoffTimer: ReturnType<typeof setTimeout> | undefined
const pullStyle = computed<Record<string, string>>(() => ({
  '--ms-pull-y': `${pullOffset.value}px`
}))

/** Ход панели за пальцем: резинка (асимптота), а не линейная привязка. */
const pullOffsetFor = (distance: number): number =>
  Math.round(PULL_MAX_PX * (1 - Math.exp(-distance / PULL_SOFT_PX)))

const resetPull = () => {
  pulling.value = false
  pullOffset.value = 0
}

/** Запомнить высоту, с которой панель начнёт раскрываться (см. `pullHandoff`). */
const handOffPull = () => {
  pullHandoff.value = pullOffset.value
  if (pullHandoffTimer !== undefined) window.clearTimeout(pullHandoffTimer)
  // Переход читает значение в следующем кадре — после него обнуляем, иначе
  // следующее раскрытие (значком в шапке) началось бы с чужой высоты.
  pullHandoffTimer = window.setTimeout(() => {
    pullHandoffTimer = undefined
    pullHandoff.value = 0
  }, 600)
}

const onPanelTouchEnd = () => {
  resetPull()
}

/** Панель целиком: на ней и слушаем жесты. */
const panelRoot = ref<HTMLElement | null>(null)

/** Список чатов внутри панели (может отсутствовать: загрузка, пустой список). */
const listScrollEl = (): HTMLElement | null =>
  panelRoot.value?.querySelector<HTMLElement>('.chat-scroll') ?? null

/** Список уже прокручен — это обычное листание чатов, а не жест по шапке. */
const listIsScrolled = (el: HTMLElement | null): boolean => (el?.scrollTop ?? 0) > 0

const onPanelTouchStart = (event: TouchEvent) => {
  pullStartY = event.touches[0]?.clientY ?? 0
  pullUsed = false
  resetPull()
  const target = event.target
  pullFromList = target instanceof Element && target.closest('.chat-scroll') !== null
}

const onPanelTouchMove = (event: TouchEvent) => {
  if (pullUsed) return
  const list = listScrollEl()
  const y = event.touches[0]?.clientY ?? 0
  const distance = y - pullStartY
  // Смахнуть вверх — убрать одну панель (по шагам, в порядке, обратном
  // раскрытию).
  //
  // Закрываем панель, где бы палец ни начал движение: и по шапке, и по полю
  // поиска, и по самой полосе историй, и ПО САМОМУ СПИСКУ — прокручен он или
  // нет. Раньше жест требовал списка в самом верху, поэтому на телефоне с
  // обычным (прокрученным) списком чатов закрыть истории и поиск было нечем,
  // кроме маленького значка в шапке. Если панелей нет, жест ничего не делает —
  // список просто листается, как обычно.
  if (distance <= -SWIPE_COLLAPSE_PX && collapseTopPanels()) {
    pullUsed = true
    // Браузер уже начал прокрутку списка (слушатель passive — отменить её мы не
    // можем), и её события не должны сжать вторую панель тем же движением:
    // следующее событие скролла только задаст новый отсчёт.
    storiesResetPending = true
    return
  }
  // Дальше — только протяжка вниз по самому списку, с его верха.
  if (!pullFromList || listIsScrolled(list)) return
  // Панель едет за пальцем: отклик виден с первого пикселя, без «упора».
  pulling.value = true
  pullOffset.value = pullOffsetFor(distance)
  if (!searchOpen.value) {
    if (distance < PULL_EXPAND_PX) return
    pullUsed = true
    handOffPull()
    resetPull()
    haptic()
    revealSearch()
    return
  }
  if (storiesExpanded.value) {
    // Полоса уже раскрыта — третьим, самым сильным движением открываем
    // воспроизведение: с этого места истории смотрят, а не разглядывают кружки.
    if (distance < PULL_PLAY_PX) return
    pullUsed = true
    handOffPull()
    resetPull()
    haptic()
    openStoriesPlayback()
    return
  }
  if (distance < PULL_STORIES_PX) return
  pullUsed = true
  handOffPull()
  resetPull()
  haptic()
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
  localMessages,
  channels: channelResults,
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

/** В архиве ли чат. */
const isArchivedOf = (chatId: number): boolean => isChatArchived(chatId, props.archivedChatIds)

// ---------- Свайпы по строке (телефон) ----------
// Жест только выбирает действие — выполняет его тот же путь, что и в меню чата:
// закрепление уходит в Messenger одним чатом, архив — общей пачкой (архив живёт
// на клиенте, `useChatSelection` уже умеет её переключать).
/** Свайп вправо: закрепить/открепить. */
const onSwipePin = (chatId: number) => emit('toggle-pin', chatId)

/** Свайп влево: в архив или обратно. */
const onSwipeArchive = (chatId: number) => emit('bulk-archive', [chatId], !isArchivedOf(chatId))

/** Свайп влево, когда в настройках выбраны «Уведомления» (выкл/вкл по чату). */
const onSwipeMute = (chatId: number) => emit('toggle-mute', chatId)

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
  selectionAllArchived,
  toggleSelectAll,
  onBulkMute,
  onBulkPin,
  onBulkArchive,
  onBulkDelete,
  onRowPointerDown,
  onRowPointerUp,
  onRowPointerCancel,
  onRowClick
} = useChatSelection({
  visibleChatIds: () => orderedChats.value.map((chat) => chat.id),
  isMuted: (chatId) => isMutedOf(chatId),
  isPinned: (chatId) => isPinnedOf(chatId),
  isArchived: (chatId) => isArchivedOf(chatId),
  openChat: (chatId) => selectChat(chatId),
  onBulkMute: (ids, muted) => emit('bulk-mute', ids, muted),
  onBulkPin: (ids, pinned) => emit('bulk-pin', ids, pinned),
  onBulkArchive: (ids, archived) => emit('bulk-archive', ids, archived),
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

/** Фильтры списка чатов — в utils/chatFilters.ts (там же правило про архив). */
const chatFilter = ref<ChatFilterValue>('all')

/** Активная папка (null — выбран не папка). */
const activeFolder = computed<ChatFolder | null>(() => {
  const id = chatFilter.value.startsWith(FOLDER_FILTER_PREFIX)
    ? chatFilter.value.slice(FOLDER_FILTER_PREFIX.length)
    : null
  return id === null ? null : folderById(props.chatFolders ?? [], id)
})

/** Сколько чатов с непрочитанными — счётчик на фильтре. */
const unreadChatCount = computed(
  () => props.chats.filter((chat) => (chat.unread_count ?? 0) > 0).length
)

/** Сколько чатов в архиве — от этого зависит, показывать ли чип «Архив». */
const archivedCount = computed(
  () => props.chats.filter((chat) => isChatArchived(chat.id, props.archivedChatIds)).length
)

/** Сколько архивных чатов ждут прочтения — счётчик на чипе «Архив». */
const archivedUnreadCount = computed(
  () =>
    props.chats.filter(
      (chat) => isChatArchived(chat.id, props.archivedChatIds) && (chat.unread_count ?? 0) > 0
    ).length
)

/**
 * Чипы фильтров на экране.
 *
 * «Архив» показываем только когда там что-то есть (как в Telegram): пустой чип
 * лишь занимает место в ряду. Пять остальных видим всегда. Папки пользователя
 * идут в том порядке, в каком их создали — это его собственный порядок.
 */
const visibleFilters = computed(() => [
  // Подпись фильтра переводим здесь, а не в списке: язык меняется на лету.
  ...CHAT_FILTERS.filter((filter) => filter.key !== 'archived' || archivedCount.value > 0).map(
    (filter) => ({ ...filter, title: t(filter.title) })
  ),
  ...(props.chatFolders ?? []).map((folder) => ({
    key: folderFilter(folder.id),
    title: folder.name
  }))
])

/** Чаты после фильтра по чипам («Все», «Непрочитанные», папки и т. д.). */
const filteredChats = computed<Chat[]>(() =>
  props.chats.filter((chat) =>
    chatMatchesFilter(chat, chatFilter.value, props.archivedChatIds, props.chatFolders)
  )
)

// Чип «Архив» исчез (последний чат вынули), а папку удалили — возвращаемся к
// «Все»: иначе список остался бы пустым без единого видимого фильтра.
watch(archivedCount, (count) => {
  if (count === 0 && chatFilter.value === 'archived') chatFilter.value = 'all'
})

watch(visibleFilters, (filters) => {
  if (!filters.some((filter) => filter.key === chatFilter.value)) chatFilter.value = 'all'
})

/**
 * Чаты для показа: «Сохранённые сообщения», затем закреплённые, затем остальные.
 *
 * В папке порядок ручной (`folder.chatIds`), а «Сохранённые сообщения» в папки не
 * добавляются — человек задал этот список сам, и переставлять его пинами нельзя.
 */
const orderedChats = computed<Chat[]>(() => {
  const folder = activeFolder.value
  if (folder !== null) {
    return folderChats(folder, filteredChats.value)
  }
  // Порядок и пины — общее правило в `utils/chatOrder` (там же и почему): своё
  // правило здесь уже разъезжалось с сервером, и чаты с новыми сообщениями
  // «стояли на месте» до следующего опроса списка.
  return orderChats(filteredChats.value, props.pinnedChatIds ?? [])
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

/** Выбран канал из результатов: карточку подписки показывает представление. */
const openChannelResult = (channel: ChannelCard) => {
  if (channel.username) emit('open-channel', channel.username)
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
    setSearchError(getErrorMessage(error, t('Не удалось начать переписку')))
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
    setSearchError(getErrorMessage(error, t('Не удалось начать переписку')))
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

// Модалки сайдбара (личное имя контакта, импорт из телефонной книги) — слои:
// «назад» на телефоне закрывает их, а не выходит из приложения и не уводит в
// другой раздел (см. `useMobileOverlay`).
useMobileLayer(
  () => contactDialogOpen.value,
  () => {
    contactDialogOpen.value = false
  }
)
useMobileLayer(() => phoneImportOpen.value, closePhoneImport)
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
  /* Плавающие элементы панели (кнопки у краёв) позиционируются от неё. */
  position: relative;
  /* Протяжка вниз: панель едет за пальцем. Возврат на место — переходом, а во
     время движения он выключен (`.pulling`), иначе панель отставала бы. */
  transform: translateY(var(--ms-pull-y, 0));
  transition: transform 0.2s var(--ms-ease);
}

.side-panel.pulling {
  transition: none;
}

.icon-btn.open {
  color: var(--ms-accent, #1e9b51);
}

/* Плашка ошибки — общий компонент ErrorNotice: у него свой вид и крестик. */

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
