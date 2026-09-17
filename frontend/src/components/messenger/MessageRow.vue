<template>
  <div v-if="message.kind === 'call'" class="msg msg-call" :data-message-id="message.id">
    <div class="call-note">
      <q-icon :name="icon(callIcon)" size="15px" aria-hidden="true" />
      <span>{{ callText }}</span>
    </div>
  </div>
  <div
    v-else
    ref="rowRoot"
    class="msg"
    :class="[
      isOwn ? 'out' : 'in',
      `series-${props.series ?? 'single'}`,
      { 'msg-highlight': highlighted, selection: selectionMode, selected, 'msg-media': !!file }
    ]"
    :data-message-id="message.id"
    :style="swipeStyle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @dblclick.stop="onDoubleTap"
    @contextmenu.prevent="openContextFromEvent($event)"
  >
    <!-- Подсказка свайпа: тянем сообщение вправо — отвечаем на него -->
    <span v-if="swipeX > 0" class="swipe-reply" :class="{ ready: swipeReady }">
      <q-icon :name="icon('reply')" size="18px" aria-hidden="true" />
    </span>
    <!-- Режим выделения: кружок-чек сбоку от пузыря -->
    <span
      v-if="selectionMode && selectable"
      class="row-selector"
      :class="{ on: selected }"
      aria-hidden="true"
    >
      <q-icon v-if="selected" :name="icon('check')" size="15px" />
    </span>
    <!-- Режим выделения: клик по сообщению — отметить/снять -->
    <div
      v-if="selectionMode && selectable"
      class="msg-select-hit"
      @click.stop="onSelectClick"
    ></div>
    <div
      class="msg-bubble"
      :class="{
        'round-video-only': isRoundVideoOnly(message),
        'sticker-only': stickerLayout !== 'text'
      }"
    >
      <!-- Скрыто до проверки модератором: такое сообщение видит только автор,
           поэтому пометка объясняет, куда пропал контент у собеседника -->
      <div v-if="message.hidden" class="moderation-note" role="status">
        <q-icon :name="icon('gavel')" size="15px" />
        <span>
          Скрыто до проверки модератором
          <template v-if="message.hidden_reason"> · {{ message.hidden_reason }} </template>
        </span>
      </div>
      <!-- Имя автора в групповом чате (у входящих, в начале «серии» сообщений) -->
      <span v-if="authorName && !isOwn" class="msg-author">{{ authorName }}</span>
      <!-- Плашка «Переслано от …» (клик — открыть автора) -->
      <div
        v-if="forwardLabel"
        class="forward-banner"
        :class="{ clickable: forwarderClickable }"
        :title="forwarderClickable ? 'Открыть чат с автором' : undefined"
        @click.stop="onForwarderClick"
      >
        <span class="forward-sender-avatar" :style="forwarderAvatarStyle" aria-hidden="true">
          <img
            v-if="forwarderAvatarUrl"
            :src="forwarderAvatarUrl"
            class="forward-sender-avatar-img"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <template v-else>{{ forwarderInitials }}</template>
        </span>
        <span class="forward-label-text">{{ forwardLabel }}</span>
      </div>

      <!-- Ответ-цитата -->
      <div
        v-if="message.reply_to_id && quote"
        class="reply-quote"
        @click.stop="emit('quote-click')"
      >
        <span class="quote-name" :class="{ mine: quote.mine }">{{ quote.name }}</span>
        <span class="quote-text">{{ quote.text }}</span>
      </div>

      <!-- Ответ на историю: снимок медиа истории (живёт и после её удаления). -->
      <div v-if="storyReply" class="story-reply">
        <span class="story-reply-thumb">
          <img
            v-if="storyReplyThumb && !storyReplyIsVideo"
            :src="storyReplyThumb"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <q-icon
            v-else
            :name="icon(storyReplyIsVideo ? 'videocam' : 'image')"
            size="16px"
            aria-hidden="true"
          />
        </span>
        <span class="story-reply-text">Ответ на историю</span>
      </div>

      <!-- Вложение — в MessageAttachment.vue (там же расшифровка E2EE). -->
      <MessageAttachment
        :message="message"
        :row-visible="rowVisible"
        @open-image="emit('open-image')"
      />

      <!-- Очень длинные тексты показываем свёрнутыми: иначе одна «простыня»
           растягивает ленту на несколько экранов. -->
      <!-- Стикер: сообщение из одних эмодзи (1–3) — крупно и без пузыря, как в
           Telegram. Форматирование и ссылки тут не нужны: текста нет. -->
      <span v-if="stickerLayout !== 'text'" class="msg-sticker" :class="stickerLayout">
        {{ message.text.trim() }}
      </span>
      <!-- Упоминания @логин подсвечиваем: видно, к кому обращаются -->
      <span v-else-if="message.text" class="msg-text" :class="{ clamped: isClamped }">
        <template v-for="(part, index) in textParts" :key="index">
          <span v-if="part.type === 'mention'" class="msg-mention">{{ part.value }}</span>
          <a
            v-else-if="part.type === 'link'"
            class="msg-link"
            :href="part.href"
            rel="noopener noreferrer"
            @click.stop.prevent="followMessageLink(part.href)"
            >{{ part.value }}</a
          >
          <!-- Оформление: *жирный*, _курсив_, `код`, ~~зачёркнутый~~ -->
          <strong v-else-if="part.type === 'bold'" class="msg-bold">{{ part.value }}</strong>
          <em v-else-if="part.type === 'italic'" class="msg-italic">{{ part.value }}</em>
          <s v-else-if="part.type === 'strike'" class="msg-strike">{{ part.value }}</s>
          <code v-else-if="part.type === 'code'" class="msg-code">{{ part.value }}</code>
          <!-- Совпадение поиска по сообщениям: видно, ЧТО именно нашлось -->
          <mark v-else-if="part.type === 'search'" class="msg-search-hit">{{ part.value }}</mark>
          <!-- Спойлер скрыт, пока по нему не нажмут -->
          <span
            v-else-if="part.type === 'spoiler'"
            class="msg-spoiler"
            :class="{ on: revealedSpoilers.has(index) }"
            :title="revealedSpoilers.has(index) ? undefined : 'Нажмите, чтобы показать'"
            @click.stop="revealSpoiler(index)"
            >{{ part.value }}</span
          >
          <template v-else>{{ part.value }}</template>
        </template>
      </span>
      <button v-if="canCollapse" type="button" class="msg-more" @click.stop="expanded = !expanded">
        {{ expanded ? 'Свернуть' : 'Показать полностью' }}
      </button>

      <!-- Карточка внешней ссылки (превью сайта, как в Telegram) -->
      <LinkPreviewCard v-if="linkPreview" :preview="linkPreview" />

      <span class="msg-meta">
        <span v-if="message.edited_at" class="msg-edited" title="изменено">изменено</span>
        <span class="msg-time">{{ formatMsgTime(message.timestamp) }}</span>
        <span v-if="isOwn" class="msg-ticks" :class="{ read: message.is_read }">✓✓</span>
      </span>
    </div>

    <!-- Реакции -->
    <TransitionGroup
      v-if="message.reactions.length"
      name="reaction"
      tag="div"
      class="reactions"
      @click.stop
      @pointerdown.stop
    >
      <button
        v-for="reaction in message.reactions"
        :key="reaction.emoji"
        class="reaction-chip"
        :class="{ mine: reaction.reacted_by_me }"
        @click="emit('toggle-reaction', reaction.emoji)"
      >
        {{ reaction.emoji }}<span class="reaction-count">{{ reaction.count }}</span>
      </button>
    </TransitionGroup>

    <!-- Действия при наведении (появляются ПОД сообщением).
         Рисуем только у строк, которые уже доходили до экрана: 4 иконки Quasar
         на КАЖДУЮ строку истории — самая дорогая часть раскладки длинной ленты
         (замер: 86 мс → 29 мс на 2 000 строк, см. docs/feed-performance.md).
         До наведения строка всё равно должна быть на экране, так что панель
         успевает появиться. -->
    <!-- Панель действий при наведении — в MessageActionsBar.vue
         (у неё свои стили и своя логика всплывающих меню). -->
    <MessageActionsBar
      ref="actionsBarRef"
      :message="message"
      :is-own="isOwn"
      :can-save="canSave"
      :emoji-picker-open="emojiPickerOpen"
      :row-visible="rowVisible"
      @toggle-emoji-picker="emit('toggle-emoji-picker')"
      @toggle-reaction="emit('toggle-reaction', $event)"
      @set-reply="emit('set-reply')"
      @forward="emit('forward')"
      @copy="emit('copy')"
      @edit="emit('edit')"
      @save="emit('save')"
      @delete="emit('delete')"
      @report="emit('report')"
      @toggle-pin="emit('toggle-pin')"
    />

    <!-- Лист действий (удержание выделенного сообщения или правый клик) —
         в MessageActionSheet.vue вместе с фокус-ловушкой и позиционированием. -->
    <MessageActionSheet
      ref="sheetRef"
      :message="message"
      :is-own="isOwn"
      :can-save="canSave"
      :selectable="selectable"
      :selection-mode="selectionMode"
      :emoji-picker-open="emojiPickerOpen"
      @toggle-reaction="emit('toggle-reaction', $event)"
      @set-reply="emit('set-reply')"
      @forward="emit('forward')"
      @copy="emit('copy')"
      @edit="emit('edit')"
      @save="emit('save')"
      @delete="emit('delete')"
      @report="emit('report')"
      @toggle-pin="emit('toggle-pin')"
    />
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, ref } from 'vue'
import type { Message } from '@/types'
import { mediaUrl } from '@/config'
import { lastQuickReaction } from '@/utils/reactions'
import { emojiLayout, type EmojiLayout } from '@/utils/emoji'
import { haptic, HAPTIC_HOLD } from '@/utils/haptics'
import { formatMsgTime } from '@/utils/format'
import { avatarStyle, initials } from '@/utils/user'
import { highlightQuery, splitMessageText } from '@/utils/mentions'
import { followLink } from '@/composables/useExternalLinkGuard'
import { useVisibleOnce } from '@/composables/useVisibleOnce'
import { callMessageIcon, callMessageText, effectiveFile, isRoundVideoOnly } from '@/utils/media'
import type { SeriesKind } from '@/utils/thread'
import LinkPreviewCard from '@/components/messenger/LinkPreviewCard.vue'
import MessageActionSheet from '@/components/messenger/MessageActionSheet.vue'
import MessageActionsBar from '@/components/messenger/MessageActionsBar.vue'
import MessageAttachment from '@/components/messenger/MessageAttachment.vue'
import { useLinkPreview } from '@/composables/useLinkPreview'

export interface MessageQuote {
  name: string
  mine: boolean
  text: string
}

/* ---------- Свайп вправо = ответ на сообщение ---------- */
const SWIPE_REPLY_DISTANCE = 84
const SWIPE_REPLY_THRESHOLD = 56

const swipeX = ref(0)
const swipeReady = computed(() => swipeX.value >= SWIPE_REPLY_THRESHOLD)
const swipeStyle = computed<Record<string, string> | undefined>(() =>
  swipeX.value ? { transform: `translateX(${swipeX.value}px)` } : undefined
)
let swipeStartX = 0
let swipeStartY = 0
let swipeAxis: 'none' | 'x' | 'y' = 'none'
/** Отклик на достижение порога ответа — один раз за жест. */
let swipeFeedback = false

/** С какого размера текст сворачиваем (примерно 12 строк). */
const LONG_TEXT_LIMIT = 600

const textParts = computed(() =>
  highlightQuery(splitMessageText(props.message.text ?? ''), props.searchQuery ?? '')
)

/** Спойлеры, которые пользователь уже раскрыл нажатием (по индексу фрагмента). */
const revealedSpoilers = ref<Set<number>>(new Set())

function revealSpoiler(index: number) {
  if (revealedSpoilers.value.has(index)) return
  revealedSpoilers.value = new Set(revealedSpoilers.value).add(index)
}

/**
 * Переход по ссылке из текста.
 *
 * Сами не открываем: свой адрес откроет приложение, а чужой — только после
 * подтверждения «Переходите на внешний сайт» (см. useExternalLinkGuard).
 */
const followMessageLink = (url?: string) => {
  if (url) void followLink(url)
}

const expanded = ref(false)
/** Корень строки сообщения — нужен для замеров (свайп, лист действий). */
const rowRoot = ref<HTMLElement | null>(null)
/**
 * Строка дошла до экрана (один раз и навсегда).
 *
 * По этому флагу запускаются дорогие вещи: запрос карточки ссылки и расшифровка
 * вложения. Сначала так делали для всей загруженной истории сразу — на открытие
 * чата уходили десятки запросов и расшифровок.
 */
const { visible: rowVisible } = useVisibleOnce(rowRoot)
const canCollapse = computed(() => (props.message.text?.length ?? 0) > LONG_TEXT_LIMIT)
const isClamped = computed(() => canCollapse.value && !expanded.value)

/**
 * Насколько крупно рисовать сообщение из эмодзи (`text` — обычный пузырь).
 *
 * Стикером считаем только «чистое» сообщение: без вложений, ответов,
 * пересылок и звонков — иначе крупные эмодзи ломали бы разметку плашек.
 */
const stickerLayout = computed<EmojiLayout>(() => {
  const message = props.message
  if (!message.text) return 'text'
  if (message.file || message.e2ee_file || message.forwarded_from || message.call_kind) {
    return 'text'
  }
  if (props.quote || props.message.reply_to_story) return 'text'
  if (props.selectionMode && props.selected) return 'text'
  return emojiLayout(message.text)
})

const props = defineProps<{
  message: Message
  isOwn: boolean
  /** Id текущего зрителя — чтобы плашка была «Переслано от вас». */
  viewerId: number | null
  /** Подсветка при переходе к сообщению (из закреплённых/поиска). */
  highlighted: boolean
  /** Открыт ли выбор эмодзи-реакций для этой строки. */
  emojiPickerOpen: boolean
  /** Данные ответа-цитаты (null, если цитируемое сообщение не загружено). */
  quote: MessageQuote | null
  /** Режим мультивыделения сообщений (как в чатах, вход по удержанию). */
  selectionMode: boolean
  /** Выбрано ли сообщение в режиме выделения. */
  selected: boolean
  /** Можно ли выбрать (обычные сообщения, не отметки о звонках). */
  selectable: boolean
  /** Имя автора (для групповых чатов; пусто — не показывать). */
  authorName?: string
  /**
   * Место сообщения в серии подряд идущих сообщений одного автора
   * (utils/thread.ts::seriesKindFor): от него зависит форма пузыря.
   */
  series?: SeriesKind
  /**
   * Запрос поиска по сообщениям: совпадения подсвечиваются в тексте.
   * Пусто — обычный показ (поиск закрыт).
   */
  searchQuery?: string
}>()

/** Текст плашки «Переслано от …» (null, если сообщение не переслано). */
const forwardLabel = computed<string | null>(() => {
  const forwarded = props.message.forwarded_from
  if (!forwarded) return null
  if (props.viewerId !== null && forwarded.sender_id === props.viewerId) {
    return 'Переслано от вас'
  }
  const name = forwarded.sender_name?.trim()
  return name ? `Переслано от ${name}` : 'Переслано'
})

/** Плашка «Ответ на историю» (null, если это обычное сообщение). */
const storyReply = computed(() => props.message.reply_to_story ?? null)

/** Миниатюра истории: путь к нашему файлу, поэтому через `mediaUrl`. */
const storyReplyThumb = computed<string>(() => {
  const url = storyReply.value?.media_url
  return url ? mediaUrl(url) : ''
})

const storyReplyIsVideo = computed<boolean>(() =>
  Boolean(storyReply.value?.mime_type?.startsWith('video/'))
)

const emit = defineEmits<{
  (e: 'quote-click'): void
  (e: 'forwarder-click'): void
  (e: 'select-start'): void
  (e: 'toggle-select'): void
  (e: 'toggle-emoji-picker'): void
  (e: 'set-reply'): void
  (e: 'toggle-reaction', emoji: string): void
  (e: 'toggle-pin'): void
  (e: 'copy'): void
  (e: 'edit'): void
  (e: 'forward'): void
  (e: 'save'): void
  (e: 'delete'): void
  /** Жалоба на сообщение (модерация UGC, требование RuStore). */
  (e: 'report'): void
  (e: 'open-image'): void
}>()

// Превью ссылки из текста: только у обычных текстовых сообщений — у
// зашифрованных текст на сервере не читается, у отметок о звонках текста нет.
const linkPreviewText = computed<string | null>(() =>
  props.message.encrypted || props.message.kind === 'call' ? null : (props.message.text ?? null)
)
const { preview: linkPreview } = useLinkPreview(() => linkPreviewText.value, {
  // Карточку ссылки просим только когда строка дошла до экрана: иначе на
  // открытие чата уходили бы десятки запросов сразу (см. useVisibleOnce).
  enabled: () => rowVisible.value
})

// ---------- «Переслано от …»: аватар автора и переход к нему ----------
const forwarderName = computed<string>(
  () => props.message.forwarded_from?.sender_name?.trim() || ''
)
const forwarderAvatarUrl = computed<string | null>(() => {
  const url = props.message.forwarded_from?.sender_avatar_url
  return url ? mediaAbsolute(url) : null
})
const forwarderClickable = computed<boolean>(() => {
  const senderId = props.message.forwarded_from?.sender_id
  return senderId !== null && senderId !== undefined && senderId !== props.viewerId
})
const forwarderInitials = computed<string>(() => initials(forwarderName.value || '?'))
const forwarderAvatarStyle = computed(() => avatarStyle(forwarderName.value || '?'))
const onForwarderClick = () => {
  if (forwarderClickable.value) emit('forwarder-click')
}

const mediaAbsolute = (path: string): string => mediaUrl(path)

/** Вложение с настоящим именем/типом (у E2EE — из расшифрованного конверта). */
const file = computed(() => effectiveFile(props.message))

/** Расшифрованное вложение (blob-ссылка) — только для зашифрованных файлов. */
/** Текст и иконка системной отметки о звонке. */
const callText = computed<string>(() => callMessageText(props.message) ?? 'Звонок')
const callIcon = computed<string>(() => callMessageIcon(props.message))

/** «Сохранить» доступно для обычных сообщений (не для отметок о звонках). */
const canSave = computed<boolean>(() => props.message.kind !== 'call')

// ---------- Режим выделения сообщений (долгое нажатие; как в чатах) ----------
let holdTimer: number | null = null
let suppressNextSelect = false

const cancelHold = () => {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer)
    holdTimer = null
  }
}

const onPointerDown = (event: PointerEvent) => {
  if (!props.selectable) return
  if (event.button !== 0) return
  // Готовим свайп-ответ: решение по оси принимаем на первом движении.
  swipeStartX = event.clientX
  swipeStartY = event.clientY
  swipeAxis = 'none'
  swipeX.value = 0
  cancelHold()
  suppressNextSelect = false
  holdTimer = window.setTimeout(() => {
    holdTimer = null
    suppressNextSelect = true
    // Удержание сразу выделяет сообщение (без промежуточного меню). Если режим
    // выделения уже включён — удержание ДОБАВЛЯЕТ сообщение к выбору: так удобно
    // набрать несколько, не попадая в мелкий кружок выбора. Повторное удержание
    // УЖЕ выделенного сообщения открывает его действия (реакции, ответить,
    // закрепить, пожаловаться): в панели выделения такой кнопки больше нет.
    if (props.selectionMode) {
      if (props.selected) {
        openActions()
        return
      }
      emit('toggle-select')
      return
    }
    haptic(HAPTIC_HOLD)
    emit('select-start')
  }, 480)
}

const onPointerMove = (event: PointerEvent) => {
  if (props.selectionMode || !props.selectable) return
  if (swipeStartX === 0 && swipeStartY === 0) return
  const dx = event.clientX - swipeStartX
  const dy = event.clientY - swipeStartY
  if (swipeAxis === 'none') {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    // Вертикаль — это прокрутка ленты, свайп не наш: жест не перехватываем.
    if (swipeAxis === 'y') {
      swipeStartX = 0
      swipeStartY = 0
      return
    }
    cancelHold()
  }
  if (swipeAxis !== 'x') return
  swipeX.value = Math.max(0, Math.min(SWIPE_REPLY_DISTANCE, dx))
  // Дошли до порога ответа — короткий отклик, чтобы это чувствовалось без взгляда
  // на экран (дальше в этом жесте больше не повторяем).
  if (swipeReady.value && !swipeFeedback) {
    swipeFeedback = true
    haptic()
  }
}

const resetSwipe = () => {
  swipeStartX = 0
  swipeStartY = 0
  swipeAxis = 'none'
  swipeFeedback = false
  swipeX.value = 0
}

const onPointerUp = () => {
  // Таймер удержания снимаем всегда: в режиме выделения он тоже ставится
  // (удержание добавляет сообщение к выбору).
  cancelHold()
  if (props.selectionMode || !props.selectable) {
    resetSwipe()
    return
  }
  // Дотянули до порога — отвечаем на сообщение (жест вместо меню действий).
  if (swipeReady.value) emit('set-reply')
  resetSwipe()
}

const onPointerCancel = () => {
  cancelHold()
  resetSwipe()
  suppressNextSelect = false
}

/** Клик в режиме выделения: отметить/снять. Клик после удержания глотаем. */
const onSelectClick = () => {
  if (suppressNextSelect) {
    suppressNextSelect = false
    return
  }
  emit('toggle-select')
}

/**
 * Лист действий открыт/закрыт: нужно при повторном удержании выделенного
 * сообщения (первое выделяет, второе — открывает лист, третье закрывает).
 */
const sheetRef = ref<InstanceType<typeof MessageActionSheet> | null>(null)
/** Панель действий при наведении: нужна, чтобы закрыть её меню и палитру. */
const actionsBarRef = ref<InstanceType<typeof MessageActionsBar> | null>(null)

/** Правый клик на компьютере открывает тот же лист действий. */
const openContextFromEvent = (event: MouseEvent): void => {
  if (props.selectionMode) return
  // Клавиатура (Shift+F10 или клавиша «Меню») присылает событие без координат —
  // открываем лист у самого сообщения, а не в левом верхнем углу экрана.
  if (event.clientX === 0 && event.clientY === 0) {
    openActions()
    return
  }
  actionsBarRef.value?.closeFloating()
  void sheetRef.value?.openAt(event.clientX, event.clientY)
}

/**
 * Открыть лист действий у самого сообщения.
 *
 * Вызывается удержанием уже выделенного сообщения: на телефоне это
 * единственный путь к действиям (реакции, ответить, удалить, пожаловаться),
 * потому что первое удержание занято выделением.
 */
const openActions = (): void => {
  const sheet = sheetRef.value
  if (!sheet) return
  if (sheet.isOpen()) {
    sheet.close()
    return
  }
  const bubble = rowRoot.value?.querySelector<HTMLElement>('.msg-bubble')
  const rect = bubble?.getBoundingClientRect()
  const x = rect ? rect.left + Math.min(rect.width / 2, 120) : 40
  const y = rect ? rect.top + rect.height / 2 : 120
  actionsBarRef.value?.closeFloating()
  void sheet.openAt(x, y)
}

/**
 * Двойной тап на телефоне — быстрая реакция (последняя использованная).
 * На компьютере двойной клик оставляем выделению текста.
 */
const onDoubleTap = (): void => {
  if (props.selectionMode || !props.selectable) return
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  if (!coarse) return
  haptic()
  emit('toggle-reaction', lastQuickReaction())
}
</script>

<style scoped>
.msg {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 3px 0;
  max-width: 60%;
}

.msg-call {
  max-width: 100%;
  align-self: center;
  margin: 6px 0;
}

.call-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--ms-surface-2, #eef1f4);
  color: var(--ms-muted, #71808d);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: 12.5px;
}

.msg.out {
  align-self: flex-end;
  align-items: flex-end;
}

.msg.in {
  align-self: flex-start;
  align-items: flex-start;
}

/* Строка с вложением: картинка/видео шире текстового пузыря (до 300–320px), а
   у текстовых строк предел 60% — вложение выходило за строку и край ленты. */
.msg-media {
  max-width: 100%;
}

.msg-bubble {
  position: relative;
  padding: 7px 11px 6px;
  border-radius: 12px;
  box-shadow: var(--ms-shadow-sm);
  min-width: 70px;
  /* Длинная лента: содержимое пузыря за экраном браузер не раскладывает и не
     рисует. DOM и логика не меняются, поэтому позиция скролла и разделители целы.

     Важно: сдерживание стоит ИМЕННО на пузыре, а не на строке `.msg`.
     content-visibility добавляет `contain: paint`, а за границы строки выходят
     вложение (картинка до 300px при строке max-width: 60%) и всплывающие панели
     строки (пикер реакций, меню «⋯») — на строке они обрезались. Пузырь растит
     размер под своё содержимое, поэтому ничего своего он не режет. */
  content-visibility: auto;
  /* `auto` запоминает реальный размер уже показанных пузырей, а числа — оценка
     для тех, что ещё не попадали в кадр. Ширина тоже нужна: без неё браузер
     считает пузырь 60px шириной и запоминает высоту узкой колонки. */
  contain-intrinsic-size: auto 260px auto 60px;
}

.msg.out .msg-bubble {
  background: var(--ms-bubble-out);
}

.msg.in .msg-bubble {
  background: var(--ms-surface);
}

/* «Серия» — несколько сообщений одного автора подряд.
   Срезанный угол остаётся только у ПЕРВОГО пузыря серии: он отмечает начало
   блока. Если оставить срез на каждом (как было), подряд идущие сообщения
   дают частокол одинаковых срезов, и граница серии не читается. */
.msg.out.series-first .msg-bubble,
.msg.out.series-single .msg-bubble {
  border-top-right-radius: 3px;
}

.msg.in.series-first .msg-bubble,
.msg.in.series-single .msg-bubble {
  border-top-left-radius: 3px;
}

/* Продолжение серии прижимается к предыдущему пузырю (базовый отступ строки —
   3px): вместе с общими скруглениями серия читается как один блок. */
.msg.series-middle,
.msg.series-last {
  margin-top: 1px;
}

/* Имя автора в групповом чате (в начале «серии» сообщений собеседника) */
.msg.in .msg-author {
  display: block;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ms-accent, #2ea25e);
  margin-bottom: 3px;
  user-select: none;
}

/* Пузырь, где лежит только «кружок»-видеосообщение, — без фона и отступов.
   Селекторы с .msg.in/.msg.out обязательны: у правил цвета пузыря выше
   специфичность выше (три класса + scope-атрибут), поэтому без них «кружок»
   получал прямоугольную подложку под видео. */
.msg-bubble.round-video-only,
.msg.in .msg-bubble.round-video-only,
.msg.out .msg-bubble.round-video-only {
  background: transparent;
  box-shadow: none;
  padding: 2px;
}

/* ---------- Стикер: сообщение из одних эмодзи ---------- */
/* Пузырь прозрачный (как у «кружка»-видео), а сами эмодзи крупные. Время и
   галочки остаются под ними мелким текстом — по ним видно, что сообщение ушло. */
.msg-bubble.sticker-only,
.msg.in .msg-bubble.sticker-only,
.msg.out .msg-bubble.sticker-only {
  background: transparent;
  box-shadow: none;
  padding: 0 2px;
  max-width: min(70%, 320px);
}

.msg-sticker {
  display: block;
  line-height: 1.05;
  /* Эмодзи — картинки шрифта, поэтому цвет текста на них не влияет. */
  font-size: calc(44px * var(--ms-text-scale, 1));
  word-break: break-word;
}

/* Три эмодзи — помельче: в ряд они должны влезать на телефоне. */
.msg-sticker.large {
  font-size: calc(32px * var(--ms-text-scale, 1));
}

.msg-bubble.sticker-only .msg-meta {
  color: var(--ms-muted-2);
}

/* ---------- Свайп вправо = ответ ---------- */
.msg {
  /* Горизонталь обрабатываем сами (свайп-ответ), вертикаль оставляем ленте. */
  touch-action: pan-y;
  transition: transform 0.16s ease;
}

.swipe-reply {
  position: absolute;
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  pointer-events: none;
}

.swipe-reply.ready {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
}

/* Свёрнутый длинный текст: 12 строк и кнопка «Показать полностью». */
.msg-text.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 12;
  overflow: hidden;
}

.msg-more {
  display: block;
  margin: 2px 0 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--ms-accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

/* Упоминание в тексте: акцентный цвет и полужирное начертание */
.msg-mention {
  color: var(--ms-accent, #2ea25e);
  font-weight: 600;
}

/* Оформление текста (*жирный*, _курсив_, `код`, ~~зачёркнутый~~, ||спойлер||).
   Цвет берём от пузыря: он бывает и своим (зелёным), и чужим (белым). */
.msg-bold {
  font-weight: 700;
}

.msg-italic {
  font-style: italic;
}

.msg-strike {
  text-decoration: line-through;
}

.msg-code {
  font-family: var(--ms-font-mono);
  font-size: 0.92em;
  background: var(--ms-mark-bg);
  border-radius: 5px;
  padding: 0 4px;
}

/* Совпадение поиска по сообщениям. Фон — предупреждающая подложка (пара
   «текст на --ms-warn-bg» уже проверена по контрасту), цвет текста наследуем:
   пузыри бывают разных цветов, и свой цвет здесь выглядел бы чужеродно. */
.msg-search-hit {
  background: var(--ms-warn-bg);
  color: inherit;
  border-radius: 4px;
  padding: 0 2px;
}

.msg-spoiler {
  background: var(--ms-mark-bg);
  border-radius: 5px;
  padding: 0 3px;
  /* Размытие скрывает текст, но не ломает высоту строки, как display: none. */
  filter: blur(3.5px);
  cursor: pointer;
  user-select: none;
}

.msg-spoiler.on {
  background: transparent;
  padding: 0;
  filter: none;
  user-select: text;
}

/* Ссылка в тексте: подчёркнутая, цвет — как у текста (читается в любом пузыре) */
.msg-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  cursor: pointer;
  word-break: break-all;
}

.msg-link:hover {
  opacity: 0.85;
}

.msg-more:hover {
  text-decoration: underline;
}

.msg-text {
  display: block;
  color: var(--ms-bubble-text);
  /* Размер текста сообщений — токен шкалы: он же несёт множитель настройки
     «Размер текста» из оформления. */
  font-size: var(--ms-fs-base);
  line-height: 1.35;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.msg-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 2px;
  line-height: 1;
}

.msg-time {
  font-size: var(--ms-fs-xs);
  color: var(--ms-bubble-time);
}

.msg-ticks {
  font-size: 12px;
  color: var(--ms-bubble-time);
  letter-spacing: -4px; /* галки стоят плотнее друг к другу */
}

.msg-ticks.read {
  color: var(--ms-tick);
}

.msg-edited {
  font-size: var(--ms-fs-xs);
  font-style: italic;
  opacity: 0.75;
  margin-right: 6px;
}

/* Пометка «скрыто до проверки модератором» (видит только автор) */
.moderation-note {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: -1px 0 4px;
  padding: 3px 7px;
  border-radius: 7px;
  background: var(--ms-warn-bg);
  color: var(--ms-warn);
  font-size: var(--ms-fs-xs);
  font-weight: 600;
  line-height: 1.3;
}

/* Плашка «Переслано от …» (как в Telegram: мелко, над содержимым) */
.forward-banner {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: -1px 0 3px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ms-info, #3aa6e0);
  letter-spacing: 0.1px;
  user-select: none;
}

.forward-banner.clickable {
  cursor: pointer;
}

.forward-sender-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ms-on-accent);
  /* Кружок пересылки всего 18 px: текст мельче нечитаем, но и 11.5 px в него
     не влезет — держим 10 px, зато с множителем настройки «Размер текста». */
  font-size: calc(10px * var(--ms-text-scale, 1));
  font-weight: 700;
  overflow: hidden;
}

.forward-sender-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Ответ-цитата */
.reply-quote {
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--ms-icon) 8%, transparent);
  border-left: 3px solid var(--ms-info);
  border-radius: 6px;
  padding: 5px 9px;
  margin-bottom: 5px;
  cursor: pointer;
  min-width: 120px;
}

.msg.out .reply-quote {
  border-left-color: var(--ms-accent);
}

.quote-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ms-info);
}

.quote-name.mine {
  color: var(--ms-accent);
}

.quote-text {
  font-size: 13px;
  color: var(--ms-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Плашка «Ответ на историю»: миниатюра + подпись, вид как у цитаты. */
.story-reply {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: color-mix(in srgb, var(--ms-icon) 8%, transparent);
  border-left: 3px solid var(--ms-accent);
  border-radius: 6px;
  padding: 4px 9px 4px 6px;
  margin-bottom: 5px;
  min-width: 120px;
}

.story-reply-thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--ms-surface-2);
  color: var(--ms-muted-2);
  flex: none;
}

.story-reply-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.story-reply-text {
  font-size: 12.5px;
  color: var(--ms-muted);
}

/* Вложения переехали в MessageAttachment.vue вместе с разметкой и стилями. */

/* Общие круглые кнопки (геометрия — в assets/appearance.css) */
.round-btn.danger:hover {
  color: var(--ms-danger);
}

/* Реакции */
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

/* Появление и исчезновение чипа: реакция «выпрыгивает» на месте, без прыжка
   соседей. Первичная отрисовка ленты не анимируется — TransitionGroup без
   `appear` трогает только те чипы, что появились/исчезли после монтирования. */
.reaction-enter-active {
  animation: reaction-pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.reaction-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.reaction-leave-to {
  opacity: 0;
  transform: scale(0.6);
}

@keyframes reaction-pop {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.reaction-chip {
  border: 1px solid var(--ms-border);
  background: var(--ms-surface);
  color: var(--ms-text);
  font-size: 13px;
  border-radius: 14px;
  padding: 2px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.reaction-chip.mine {
  background: var(--ms-accent-soft);
  border-color: var(--ms-accent-border);
}

.reaction-count {
  font-size: var(--ms-fs-xs);
  font-weight: 600;
}

.row-selector {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--ms-border, #9aa7b2);
  background: var(--ms-surface, #ffffff);
  color: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 6;
  pointer-events: none;
  flex: none;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}

.msg.out .row-selector {
  left: -32px;
}

.msg.in .row-selector {
  right: -32px;
}

.row-selector.on {
  background: var(--ms-accent, #2ea25e);
  border-color: var(--ms-accent, #2ea25e);
  color: var(--ms-on-accent);
}

.msg-select-hit {
  position: absolute;
  inset: 0;
  z-index: 4;
  cursor: pointer;
  border-radius: 14px;
}

.msg.selected .msg-bubble {
  box-shadow: 0 0 0 2px var(--ms-accent, #2ea25e);
}

/* Подсветка сообщения при переходе из закреплённых/поиска */
.msg-highlight .msg-bubble {
  animation: msg-highlight-pulse 2.4s ease 1;
}

@keyframes msg-highlight-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
  15% {
    box-shadow: 0 0 0 3px var(--ms-accent, #2ea25e);
  }
  55% {
    box-shadow: 0 0 0 3px var(--ms-accent, #2ea25e);
  }
}
</style>
