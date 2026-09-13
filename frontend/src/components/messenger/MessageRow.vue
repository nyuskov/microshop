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
    <div class="msg-bubble" :class="{ 'round-video-only': isRoundVideoOnly(message) }">
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

      <!-- Вложение -->
      <template v-if="file">
        <button
          v-if="isImageFile(file)"
          class="attachment attachment-image-btn"
          type="button"
          :title="`Открыть изображение «${file.name}»`"
          @click.stop="emit('open-image')"
        >
          <img
            v-if="fileUrl"
            :src="fileUrl"
            :alt="file.name"
            class="attachment-image"
            loading="lazy"
            decoding="async"
          />
          <span v-else class="attachment-locked">
            <q-icon :name="icon('lock')" size="20px" />
            <span>{{ lockedLabel }}</span>
          </span>
        </button>
        <template v-else-if="fileUrl">
          <RoundVideoMessage
            v-if="isRecordedVideoMessage(file)"
            :src="fileUrl"
            :name="file.name"
            :size="file.size"
          />
          <video
            v-else-if="isVideoFile(file)"
            class="attachment-video"
            :src="fileUrl"
            controls
            preload="metadata"
            @click.stop
          ></video>
          <AudioMessage
            v-else-if="isAudioFile(file)"
            :src="fileUrl"
            :name="file.name"
            :size="file.size"
          />
          <a
            v-else
            class="attachment"
            :href="fileUrl"
            :download="file.name"
            target="_blank"
            rel="noopener"
          >
            <span class="attachment-card">
              <q-icon :name="icon(fileIcon(file))" size="26px" />
              <span class="attachment-info">
                <span class="attachment-name">{{ file.name }}</span>
                <span class="attachment-meta">{{ formatBytes(file.size) }}</span>
              </span>
            </span>
          </a>
        </template>
        <!-- Зашифрованный файл: пока не расшифрован, вместо содержимого — замок. -->
        <span v-else class="attachment attachment-locked">
          <q-icon :name="icon('lock')" size="20px" />
          <span>{{ lockedLabel }}</span>
        </span>
      </template>

      <!-- Очень длинные тексты показываем свёрнутыми: иначе одна «простыня»
           растягивает ленту на несколько экранов. -->
      <!-- Упоминания @логин подсвечиваем: видно, к кому обращаются -->
      <span v-if="message.text" class="msg-text" :class="{ clamped: isClamped }">
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
    <div v-if="message.reactions.length" class="reactions" @click.stop @pointerdown.stop>
      <button
        v-for="reaction in message.reactions"
        :key="reaction.emoji"
        class="reaction-chip"
        :class="{ mine: reaction.reacted_by_me }"
        @click="emit('toggle-reaction', reaction.emoji)"
      >
        {{ reaction.emoji }}<span class="reaction-count">{{ reaction.count }}</span>
      </button>
    </div>

    <!-- Действия при наведении (появляются ПОД сообщением).
         Рисуем только у строк, которые уже доходили до экрана: 4 иконки Quasar
         на КАЖДУЮ строку истории — самая дорогая часть раскладки длинной ленты
         (замер: 86 мс → 29 мс на 2 000 строк, см. docs/feed-performance.md).
         До наведения строка всё равно должна быть на экране, так что панель
         успевает появиться. -->
    <div v-if="rowVisible" ref="barRef" class="msg-actions" @click.stop @pointerdown.stop>
      <button
        class="round-btn"
        :class="{ active: emojiPickerOpen }"
        title="Реакция"
        @click="onReaction"
      >
        <q-icon :name="icon('sentiment_satisfied_alt')" size="20px" />
      </button>
      <button class="round-btn" title="Ответить" @click="onReply">
        <q-icon :name="icon('reply')" size="20px" />
      </button>
      <button class="round-btn" title="Переслать" @click="onForward">
        <q-icon :name="icon('forward')" size="20px" />
      </button>
      <button
        class="round-btn"
        :class="{ active: moreOpen }"
        title="Ещё"
        aria-haspopup="true"
        :aria-expanded="moreOpen"
        @click="toggleMore"
      >
        <q-icon :name="icon('more_horiz')" size="20px" />
      </button>

      <!-- Остальные действия — в выпадающем меню -->
      <div v-if="moreOpen" class="more-menu" :class="{ up: popoverUp }" @click.stop>
        <button class="more-item" @click="onPin">
          <q-icon :name="icon('push_pin')" size="16px" />
          <span>{{ message.is_pinned ? 'Открепить' : 'Закрепить' }}</span>
        </button>
        <button class="more-item" @click="onCopy">
          <q-icon :name="icon('content_copy')" size="16px" />
          <span>Копировать</span>
        </button>
        <button v-if="isOwn && message.text" class="more-item" @click="onEdit">
          <q-icon :name="icon('edit')" size="16px" />
          <span>Редактировать</span>
        </button>
        <button v-if="canSave" class="more-item" @click="onSave">
          <q-icon :name="icon('bookmark')" size="16px" />
          <span>Сохранить в Сохранённые</span>
        </button>
        <!-- Жалоба на чужое сообщение — требование RuStore для UGC-приложений. -->
        <button v-if="!isOwn" class="more-item" @click="onReport">
          <q-icon :name="icon('flag')" size="16px" />
          <span>Пожаловаться</span>
        </button>
        <button v-if="isOwn" class="more-item danger" @click="onDelete">
          <q-icon :name="icon('delete')" size="16px" />
          <span>Удалить</span>
        </button>
      </div>

      <!-- Выбор эмодзи-реакции -->
      <div v-if="emojiPickerOpen" class="emoji-picker" :class="{ up: popoverUp }" @click.stop>
        <button
          v-for="emoji in REACTION_EMOJIS"
          :key="emoji"
          class="emoji-option"
          :class="{ active: hasMyReaction(message, emoji) }"
          @click="onPickEmoji(emoji)"
        >
          {{ emoji }}
        </button>
      </div>
    </div>

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
import { computed, nextTick, ref, watch } from 'vue'
import type { Message } from '@/types'
import { mediaUrl } from '@/config'
import {
  REACTION_EMOJIS,
  hasMyReaction,
  lastQuickReaction,
  rememberQuickReaction
} from '@/utils/reactions'
import { haptic, HAPTIC_HOLD } from '@/utils/haptics'
import { avatarStyle, initials } from '@/utils/user'
import { formatBytes, formatMsgTime } from '@/utils/format'
import { splitMessageText } from '@/utils/mentions'
import { followLink } from '@/composables/useExternalLinkGuard'
import { useVisibleOnce } from '@/composables/useVisibleOnce'
import {
  callMessageIcon,
  callMessageText,
  effectiveFile,
  fileIcon,
  isAudioFile,
  isImageFile,
  isRecordedVideoMessage,
  isRoundVideoOnly,
  isVideoFile
} from '@/utils/media'
import { decryptedMediaFor } from '@/composables/useDecryptedMedia'
import AudioMessage from '@/components/media/AudioMessage.vue'
import RoundVideoMessage from '@/components/media/RoundVideoMessage.vue'
import LinkPreviewCard from '@/components/messenger/LinkPreviewCard.vue'
import MessageActionSheet from '@/components/messenger/MessageActionSheet.vue'
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

const textParts = computed(() => splitMessageText(props.message.text ?? ''))

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
const decrypted = computed(() =>
  // Расшифровку начинаем, когда строка дошла до экрана: иначе на открытие чата
  // скачивались бы вложения всей истории.
  decryptedMediaFor(props.message, { enabled: () => rowVisible.value })
)

/**
 * URL вложения: у зашифрованного файла — расшифрованная blob-ссылка (пока её
 * нет, показываем «замок», а не шифротекст), у обычного — прямая ссылка.
 */
const fileUrl = computed<string>(() => {
  const attachment = file.value
  if (!attachment) return ''
  const local = decrypted.value
  if (local) return local.status === 'ready' ? local.url : ''
  return mediaAbsolute(attachment.url)
})

const lockedLabel = computed<string>(() =>
  decrypted.value?.status === 'failed' ? '🔒 Не удалось расшифровать' : '🔒 Расшифровываем…'
)

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

/** Открыто ли меню «Ещё» (остальные действия). */
const moreOpen = ref(false)

/** Поповер (меню/палитра) раскрыт ПОД панелью действий, а не над ней. */
const popoverUp = ref(false)
/** Корень панели действий — для замера места под/над ней. */
const barRef = ref<HTMLElement | null>(null)

/** Выбрать направление поповера: вниз, если хватает места, иначе вверх. */
const measurePopover = async () => {
  await nextTick()
  const bar = barRef.value
  if (!bar) return
  const pop = bar.querySelector<HTMLElement>('.more-menu, .emoji-picker')
  if (!pop) return
  const container = bar.closest<HTMLElement>('.messages-scroll')
  const height = pop.offsetHeight
  if (!container) {
    popoverUp.value = false
    return
  }
  const cr = container.getBoundingClientRect()
  const br = bar.getBoundingClientRect()
  const spaceBelow = cr.bottom - br.bottom
  const spaceAbove = br.top - cr.top
  popoverUp.value = spaceBelow < height + 8 && spaceAbove >= height + 8
}

watch(
  () => props.emojiPickerOpen,
  (open) => {
    if (open) void measurePopover()
  }
)

/** Закрыть «плавающие» элементы (меню «Ещё» и палитру реакций), если открыты. */
const closeFloating = () => {
  moreOpen.value = false
  if (props.emojiPickerOpen) emit('toggle-emoji-picker')
}

const onReaction = () => {
  moreOpen.value = false
  emit('toggle-emoji-picker')
}

const toggleMore = () => {
  if (props.emojiPickerOpen) emit('toggle-emoji-picker')
  moreOpen.value = !moreOpen.value
  if (moreOpen.value) void measurePopover()
}

const onReply = () => {
  closeFloating()
  emit('set-reply')
}

const onForward = () => {
  closeFloating()
  emit('forward')
}

const onPickEmoji = (emoji: string) => {
  moreOpen.value = false
  rememberQuickReaction(emoji)
  haptic()
  emit('toggle-reaction', emoji)
}

const onPin = () => {
  moreOpen.value = false
  emit('toggle-pin')
}

const onCopy = () => {
  moreOpen.value = false
  emit('copy')
}

const onEdit = () => {
  moreOpen.value = false
  emit('edit')
}

const onSave = () => {
  moreOpen.value = false
  emit('save')
}

const onDelete = () => {
  moreOpen.value = false
  emit('delete')
}

const onReport = () => {
  moreOpen.value = false
  emit('report')
}

/**
 * Лист действий открыт/закрыт: нужно при повторном удержании выделенного
 * сообщения (первое выделяет, второе — открывает лист, третье закрывает).
 */
const sheetRef = ref<InstanceType<typeof MessageActionSheet> | null>(null)

/** Правый клик на компьютере открывает тот же лист действий. */
const openContextFromEvent = (event: MouseEvent): void => {
  if (props.selectionMode) return
  // Клавиатура (Shift+F10 или клавиша «Меню») присылает событие без координат —
  // открываем лист у самого сообщения, а не в левом верхнем углу экрана.
  if (event.clientX === 0 && event.clientY === 0) {
    openActions()
    return
  }
  closeFloating()
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
  closeFloating()
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
  border-top-right-radius: 3px;
}

.msg.in .msg-bubble {
  background: var(--ms-surface);
  border-top-left-radius: 3px;
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

/* Пузырь, где лежит только «кружок»-видеосообщение, — без фона и отступов */
.msg-bubble.round-video-only {
  background: transparent;
  box-shadow: none;
  padding: 2px;
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
  /* Размер текста сообщений подчиняется настройке «Размер текста». */
  font-size: calc(14.5px * var(--ms-text-scale, 1));
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
  font-size: 11px;
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
  font-size: 11px;
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
  font-size: 11.5px;
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
  font-size: 8.5px;
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

/* Вложения */
.attachment {
  display: block;
  margin-bottom: 4px;
  text-decoration: none;
}

.attachment-image-btn {
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
}

.attachment-image {
  /* На узком экране (320–360px) запасной предел 300px всё ещё больше ленты —
     берём минимум из него и ширины окна, иначе лента обрежет картинку. */
  max-width: min(300px, calc(100vw - 60px));
  max-height: 260px;
  border-radius: 8px;
  display: block;
}

.attachment-video {
  max-width: min(320px, calc(100vw - 60px));
  max-height: 300px;
  border-radius: 8px;
  display: block;
  margin-bottom: 4px;
}

.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--ms-surface-2);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--ms-text-strong);
}

.attachment-card i {
  font-size: 1.6rem;
  color: var(--ms-danger);
}

/* Зашифрованное вложение, которое ещё не расшифровано (или не читается) */
.attachment-locked {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--ms-surface-2);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--ms-muted);
  font-size: 13.5px;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ms-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.attachment-meta {
  font-size: 12px;
  color: var(--ms-muted-2);
}

/* Общие круглые кнопки (геометрия — в assets/appearance.css) */
.round-btn.danger:hover {
  color: var(--ms-danger);
}

/* Действия при наведении — панель прижата к НИЖНЕМУ краю сообщения.
   Зазора НЕТ (top:100%), иначе при опускании мыши панель пропадала бы.
   Визуальный отступ и «мост» для курсора даёт прозрачная верхняя кромка. */
.msg-actions {
  position: absolute;
  top: 100%;
  background: var(--ms-surface);
  background-clip: padding-box;
  border-radius: 18px;
  box-shadow: var(--ms-shadow-md);
  display: flex;
  gap: 2px;
  padding: 0 4px 1px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  z-index: 5;
}

.msg.in .msg-actions {
  left: 4px;
}

.msg.out .msg-actions {
  right: 4px;
}

.msg:hover .msg-actions,
.msg:focus-within .msg-actions {
  opacity: 1;
  pointer-events: auto;
}

.msg-actions .round-btn {
  width: 32px;
  height: 32px;
  font-size: 1.05rem;
}

/* Палитра эмодзи — по умолчанию ПОД панелью действий; у нижнего края — над ней */
.emoji-picker {
  position: absolute;
  top: calc(100% + 6px);
  background: var(--ms-surface);
  border-radius: 14px;
  box-shadow: var(--ms-shadow-pop);
  display: grid;
  grid-template-columns: repeat(8, 32px);
  gap: 2px;
  padding: 6px;
  z-index: 12;
}

.emoji-picker.up {
  top: auto;
  bottom: calc(100% + 6px);
}

.msg.in .msg-actions .emoji-picker {
  left: 0;
  right: auto;
}

.msg.out .msg-actions .emoji-picker {
  right: 0;
  left: auto;
}

/* Меню «Ещё» — по умолчанию ПОД панелью действий; у нижнего края — над ней */
.more-menu {
  position: absolute;
  top: calc(100% + 6px);
  background: var(--ms-surface);
  border-radius: 12px;
  box-shadow: var(--ms-shadow-pop);
  display: flex;
  flex-direction: column;
  padding: 4px;
  min-width: 216px;
  z-index: 13;
}

.more-menu.up {
  top: auto;
  bottom: calc(100% + 6px);
}

.msg.in .msg-actions .more-menu {
  left: 0;
  right: auto;
}

.msg.out .msg-actions .more-menu {
  right: 0;
  left: auto;
}

.more-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--ms-text);
  font-size: 13.5px;
  font-family: inherit;
  text-align: left;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}

.more-item:hover {
  background: var(--ms-hover);
}

.more-item.danger {
  color: var(--ms-danger);
}

/* Реакции */
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
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
  font-size: 11.5px;
  font-weight: 600;
}

/* Эмодзи внутри палитры */
.emoji-option {
  background: transparent;
  border: none;
  font-size: 19px;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.emoji-option:hover {
  background: var(--ms-hover);
  transform: scale(1.18);
}

.emoji-option.active {
  background: var(--ms-accent-soft);
}

/* Режим выделения сообщений (long-press) */
.msg.selection {
  cursor: pointer;
}

.msg.selection .msg-actions,
.msg.selection .emoji-picker,
.msg.selection .more-menu {
  display: none;
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
