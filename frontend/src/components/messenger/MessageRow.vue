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
      shownOwn ? 'out' : 'in',
      `series-${props.series ?? 'single'}`,
      {
        'msg-highlight': highlighted,
        selection: selectionMode,
        selected,
        'msg-media': !!file,
        channel: props.channel
      }
    ]"
    :data-message-id="message.id"
    :style="swipeStyle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @dblclick.stop="onDoubleTap"
    @mousemove="onHoverMove"
    @focusout="onFocusOut"
    @contextmenu.prevent
  >
    <!-- Подсказки свайпа (по одной на сторону): тянем сообщение вправо —
         отвечаем, влево — пересылаем. Значок едет вместе с сообщением и
         «загорается», когда порог пройден: видно, что отпускание сработает. -->
    <span v-if="swipeX > 0" class="swipe-reply" :class="{ ready: swipeReplyReady }">
      <q-icon :name="icon('reply')" size="18px" aria-hidden="true" />
    </span>
    <span v-else-if="swipeX < 0" class="swipe-forward" :class="{ ready: swipeForwardReady }">
      <q-icon :name="icon('forward')" size="18px" aria-hidden="true" />
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
        'sticker-only': stickerLayout !== 'text',
        'sticker-image': isStickerMessage(message)
      }"
    >
      <!-- Скрыто до проверки модератором: такое сообщение видит только автор,
           поэтому пометка объясняет, куда пропал контент у собеседника -->
      <div v-if="message.hidden" class="moderation-note" role="status">
        <q-icon :name="icon('gavel')" size="15px" />
        <span>
          {{ t('Скрыто до проверки модератором') }}
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
        :title="forwarderClickable ? t('Открыть чат с автором') : undefined"
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
        <span class="story-reply-text">{{ t('Ответ на историю') }}</span>
      </div>

      <!-- Вложение — в MessageAttachment.vue (там же расшифровка E2EE). -->
      <MessageAttachment
        :message="message"
        :row-visible="rowVisible"
        :sticker="isStickerMessage(message)"
        :album="album"
        :wide="props.channel"
        @open-image="emit('open-image', $event)"
        @open-sticker="emit('open-sticker')"
        @open-view-once="emit('open-view-once')"
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
            :title="revealedSpoilers.has(index) ? undefined : t('Нажмите, чтобы показать')"
            @click.stop="revealSpoiler(index)"
            >{{ part.value }}</span
          >
          <template v-else>{{ part.value }}</template>
        </template>
      </span>
      <button v-if="canCollapse" type="button" class="msg-more" @click.stop="expanded = !expanded">
        {{ expanded ? t('Свернуть') : t('Показать полностью') }}
      </button>

      <!-- Перевод текста: встроенный переводчик браузера, текст никуда не уходит.
           Блок появляется только когда перевод запросили через меню. В E2EE-чате
           текст уже расшифрован на устройстве, поэтому переводится так же. -->
      <MessageTranslation
        v-if="message.text && translationVisible"
        :message-id="message.id"
        :text="message.text"
      />

      <!-- Карточка внешней ссылки (превью сайта, как в Telegram) -->
      <LinkPreviewCard v-if="linkPreview" :preview="linkPreview" />

      <!-- Реакции — внутри пузыря, на его фоне (как в Telegram): чипы стоят в
           нижнем ряду рядом со временем, а не отдельной строкой под пузырём. -->
      <div class="msg-footer">
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
            :class="{ mine: reaction.reacted_by_me, fresh: isFresh(reaction.emoji) }"
            :title="
              t('{emoji} {count} · нажмите, чтобы поставить, удержите — кто поставил', {
                emoji: reaction.emoji,
                count: reaction.count
              })
            "
            :aria-label="
              t('{emoji} {count}. Кто поставил', { emoji: reaction.emoji, count: reaction.count })
            "
            @click="onReactionClick(reaction.emoji)"
            @pointerdown="startReactionHold(reaction.emoji, $event)"
            @pointermove="onReactionHoldMove"
            @pointerup="cancelReactionHold"
            @pointercancel="cancelReactionHold"
            @contextmenu.stop.prevent="onReactionContext(reaction.emoji, $event)"
          >
            <span class="reaction-emoji" aria-hidden="true">{{ reaction.emoji }}</span>
            <!-- Пока отметивших мало — лица вместо числа (как в Telegram). -->
            <span v-if="facesOf(reaction.emoji).length" class="reaction-faces" aria-hidden="true">
              <span v-for="face in facesOf(reaction.emoji)" :key="face.id" class="reaction-face">
                <img v-if="face.url" :src="face.url" alt="" loading="lazy" decoding="async" />
                <template v-else>{{ face.initials.charAt(0) }}</template>
              </span>
            </span>
            <span v-else class="reaction-count">{{ reaction.count }}</span>
          </button>
        </TransitionGroup>

        <span class="msg-meta">
          <span v-if="message.edited_at" class="msg-edited" :title="t('изменено')">
            {{ t('изменено') }}
          </span>
          <!-- Напоминание человека о своём сообщении: видно, что «будильник» уже
               стоит (точное время — в подсказке и в диалоге напоминания). -->
          <span
            v-if="reminderAt"
            class="msg-reminder"
            :title="t('Напоминание {label}', { label: reminderLabel })"
            :aria-label="t('Напоминание {label}', { label: reminderLabel })"
          >
            <q-icon :name="icon('notifications')" size="12px" aria-hidden="true" />
          </span>
          <span class="msg-time">{{ formatMsgTime(message.timestamp) }}</span>
          <span v-if="shownOwn" class="msg-ticks" :class="{ read: message.is_read }">✓✓</span>
        </span>
      </div>
    </div>

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
      :can-make-sticker="canMakeSticker"
      :has-reminder="Boolean(reminderAt)"
      :translation-label="translationLabel"
      :can-translate="canTranslate"
      :emoji-picker-open="emojiPickerOpen"
      :row-visible="rowVisible"
      :can-add-set="canAddSet"
      :add-set-title="addSetTitle"
      :can-open-image="canOpenImage"
      @toggle-emoji-picker="emit('toggle-emoji-picker')"
      @toggle-reaction="emit('toggle-reaction', $event)"
      @set-reply="emit('set-reply')"
      @forward="emit('forward')"
      @copy="emit('copy')"
      @edit="emit('edit')"
      @save="emit('save')"
      @make-sticker="emit('make-sticker')"
      @add-set="emit('add-set')"
      @open-image="emit('open-image')"
      @delete="emit('delete')"
      @report="emit('report')"
      @toggle-pin="emit('toggle-pin')"
      @remind="emit('remind')"
      @translate="onTranslate"
    />
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatUser, Message } from '@/types'
import { mediaUrl } from '@/config'
import { lastQuickReaction } from '@/utils/reactions'
import { emojiLayout, type EmojiLayout } from '@/utils/emoji'
import { haptic, HAPTIC_HOLD } from '@/utils/haptics'
import { formatMsgTime } from '@/utils/format'
import { formatScheduledAt } from '@/utils/scheduledSend'
import {
  canOfferTranslation,
  toggleTranslation,
  translationActionFor,
  translationOf
} from '@/utils/translation'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { highlightQuery, splitMessageText } from '@/utils/mentions'
import { followLink } from '@/composables/useExternalLinkGuard'
import { useVisibleOnce } from '@/composables/useVisibleOnce'
import {
  callMessageIcon,
  callMessageText,
  canBecomeSticker,
  effectiveFile,
  isImageFile,
  isRoundVideoOnly,
  isStickerMessage
} from '@/utils/media'
import { presetSetOfFileName } from '@/utils/presetStickers'
import { importedSetPackId } from '@/utils/stickerSetImports'
import type { SeriesKind } from '@/utils/thread'
import LinkPreviewCard from '@/components/messenger/LinkPreviewCard.vue'
import MessageActionsBar from '@/components/messenger/MessageActionsBar.vue'
import MessageAttachment from '@/components/messenger/MessageAttachment.vue'
import MessageTranslation from '@/components/common/MessageTranslation.vue'
import { useLinkPreview } from '@/composables/useLinkPreview'

export interface MessageQuote {
  name: string
  mine: boolean
  text: string
}

/* ---------- Свайпы по сообщению: вправо — ответ, влево — пересылка ----------
 * Стороны симметричны: одно расстояние и один порог, значок появляется с той
 * стороны, куда тянем. Жест работает только у сообщений (`selectable`) и только
 * вне режима выделения. */
const SWIPE_DISTANCE = 84
const SWIPE_THRESHOLD = 56

const swipeX = ref(0)
const swipeReplyReady = computed(() => swipeX.value >= SWIPE_THRESHOLD)
const swipeForwardReady = computed(() => swipeX.value <= -SWIPE_THRESHOLD)
/** Порог пройден в любую сторону: по этому даём отклик один раз за жест. */
const swipeReady = computed(() => swipeReplyReady.value || swipeForwardReady.value)
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
  /**
   * Это моё сообщение (полный набор действий в меню).
   *
   * Для прав и меню, а НЕ для стороны пузыря: в канале свои посты рисуются как
   * содержимое канала (слева) — см. `channel`.
   */
  isOwn: boolean
  /**
   * Пост канала. Второй стороны в канале нет, поэтому строка занимает ВСЮ
   * ширину ленты (в чатах предел 60%), свои посты идут как содержимое канала —
   * слева и без галочек прочтения (читать пост может много людей, а под постом
   * уже стоит счётчик просмотров и комментариев — `post-meta` в MessageThread).
   */
  channel?: boolean
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
  /**
   * Участники чата: по ним в чипах реакций рисуются аватарки отметивших.
   * Нет списка — показываем число, как раньше.
   */
  members?: ChatUser[]
  /**
   * Время напоминания об этом сообщении (ISO) либо null, если его нет.
   * Так строка узнаёт, что «будильник» уже стоит: в меню меняется подпись, а у
   * времени появляется значок.
   */
  reminderAt?: string | null
  /**
   * Все вложения альбома, если эта строка — головное сообщение пачки картинок
   * (см. `utils/albums.ts`). Пусто — обычное одиночное вложение.
   */
  album?: Message[]
  /**
   * Счётчик «погасить панель действий» (см. `Messenger.vue`).
   *
   * Меняется при прокрутке ленты и при нажатии по пустому месту: на телефоне
   * `:hover` от тапа остаётся на сообщении, и панель без внешнего сигнала висела
   * бы поверх соседних сообщений (владелец: «фокус чтобы когда уходил — тоже
   * закрывалось»).
   */
  actionsReset?: number
}>()

/** Текст плашки «Переслано от …» (null, если сообщение не переслано). */
const forwardLabel = computed<string | null>(() => {
  const forwarded = props.message.forwarded_from
  if (!forwarded) return null
  if (props.viewerId !== null && forwarded.sender_id === props.viewerId) {
    return t('Переслано от вас')
  }
  const name = forwarded.sender_name?.trim()
  return name ? t('Переслано от {name}', { name }) : t('Переслано')
})

/** Плашка «Ответ на историю» (null, если это обычное сообщение). */
const storyReply = computed(() => props.message.reply_to_story ?? null)

/**
 * Человеческая подпись к напоминанию («через час», «завтра в 9:00») — та же, что
 * у отложенных сообщений: обе показывают будущее время, и разные подписи для
 * одного и того же в интерфейсе выглядели бы случайными.
 */
const reminderLabel = computed<string>(() =>
  props.reminderAt ? formatScheduledAt(props.reminderAt) : ''
)

// ---------- Перевод сообщения (F5) ----------

/** Есть ли перевод этого сообщения (или идёт перевод). */
const translationVisible = computed<boolean>(() => Boolean(translationOf(props.message.id)))

/** Подпись пункта «Перевести» по состоянию перевода. */
const translationLabel = computed<string>(() => {
  const action = translationActionFor(translationOf(props.message.id))
  if (action === 'cancel') return t('Перевод…')
  if (action === 'hide') return t('Скрыть перевод')
  return t('Перевести')
})

/**
 * Предлагать ли перевод НА ЭТОМ устройстве.
 *
 * Без встроенного переводчика браузера (телефон, WebView приложения, Safari)
 * пункта меню нет вовсе: раньше он был, а нажатие упиралось в «этот браузер не
 * умеет переводить на устройстве» — тупик вместо функции.
 */
const canTranslate = canOfferTranslation()

/**
 * Меню сообщения → пункт «Перевести»: переводим текст, отменяем идущий перевод
 * или убираем готовый — что именно, решает `toggleTranslation` (та же функция у
 * кнопки под расшифровкой голосового).
 */
const onTranslate = () => {
  if (!canTranslate) return
  toggleTranslation(props.message.id, props.message.text)
}

/**
 * «Моё» для РИСУНКА (сторона пузыря и галочки): пост канала — всегда содержимое
 * канала, даже если его написал я. Права и меню остаются по `isOwn`.
 */
const shownOwn = computed<boolean>(() => props.isOwn && !props.channel)

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
  /**
   * Удержание (или правый клик) по реакции: показать, кто её поставил.
   *
   * `anchor` — сам чип: список открывается рядом с ним, а не по центру экрана.
   */
  (e: 'open-reactions', emoji: string, anchor: HTMLElement | null): void
  (e: 'toggle-pin'): void
  (e: 'copy'): void
  (e: 'edit'): void
  (e: 'forward'): void
  (e: 'save'): void
  /** «В стикеры»: скопировать картинку сообщения в свои стикеры. */
  (e: 'make-sticker'): void
  (e: 'add-set'): void
  (e: 'delete'): void
  /** Жалоба на сообщение (модерация UGC, требование RuStore). */
  (e: 'report'): void
  /**
   * Картинка открывается в лайтбоксе. Для альбома приходит КОНКРЕТНОЕ вложение
   * (нажали на плитку, а не на головное сообщение), пусто — вложение строки.
   */
  (e: 'open-image', message?: Message): void
  /** Тап по стикеру: открыть его набор (в наборе видно весь пак и «Добавить»). */
  (e: 'open-sticker'): void
  /** Одноразовое вложение: открыть на просмотр (сервер отдаст файл один раз). */
  (e: 'open-view-once'): void
  /** «Напомнить»: выбрать время напоминания об этом сообщении. */
  (e: 'remind'): void
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
const callText = computed<string>(() => callMessageText(props.message) ?? t('Звонок'))
const callIcon = computed<string>(() => callMessageIcon(props.message))

/** «Сохранить» доступно для обычных сообщений (не для отметок о звонках). */
const canSave = computed<boolean>(() => props.message.kind !== 'call')

/** «В стикеры» — только для открытых картинок (см. `canBecomeSticker`). */
const canMakeSticker = computed<boolean>(() => canBecomeSticker(props.message))

/**
 * Есть что посмотреть отдельно: картинка-вложение, не одноразовая и не звонок.
 *
 * Нужно прежде всего СТИКЕРУ: тап по нему открывает НАБОР, поэтому сама картинка
 * осталась бы недоступной — её и показывает этот пункт.
 */
const canOpenImage = computed<boolean>(() => {
  const attachment = effectiveFile(props.message)
  return !!attachment && isImageFile(attachment) && !props.message.view_once
})

/**
 * Стикер из предустановленного набора, которого у человека ещё нет: в меню
 * появляется «Добавить набор» — как «Добавить стикеры» в Телеграме. Набор узнаём
 * по метке в имени файла (`utils/presetStickers.ts`), потому что у сервера
 * предустановленных наборов нет — он видит только картинку.
 */
const presetSet = computed(() => presetSetOfFileName(file.value?.name ?? null))
/**
 * Набор ещё не добавлен себе.
 *
 * Смотрим только отметку в localStorage (`utils/stickerSetImports.ts`), а не стор
 * стикеров: строке сообщения не нужны ни список паков, ни запрос в сеть — зато
 * `MessageRow` можно монтировать в тестах без Pinia. Отметку стор снимает сам,
 * когда пак удаляют, поэтому «уже добавлен» не залипает навсегда.
 */
const canAddSet = computed(
  () => presetSet.value !== null && importedSetPackId(presetSet.value.key) === null
)
const addSetTitle = computed(() => presetSet.value?.title ?? '')

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
  // Новое нажатие по сообщению возвращает панель действий, если её погасили
  // выбранной реакцией (на телефоне `:hover` от тапа не сбрасывается сам).
  actionsBarRef.value?.reveal()
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
    // Удержание включает режим выделения сообщений — как было и как в чатах.
    // Действия с сообщением живут в мини-панели под ним (реакции, ответить,
    // переслать, «Ещё»), отдельного листа по удержанию больше нет: владелец
    // «долгий тап с меню не нужен».
    if (props.selectionMode && !props.selected) {
      // Уже в выделении: удержание ДОБАВЛЯЕТ сообщение к выбору — так удобно
      // набрать несколько, не попадая в мелкий кружок выбора.
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
  // Влево — пересылка; вправо — ответ. У одноразового вложения пересылки нет
  // (сервер её запрещает, и кнопки такой в панели действий нет), поэтому в эту
  // сторону строку не тянем вовсе: жест не должен обещать недоступное.
  const minX = props.message.view_once ? 0 : -SWIPE_DISTANCE
  swipeX.value = Math.max(minX, Math.min(SWIPE_DISTANCE, dx))
  // Дошли до порога — короткий отклик, чтобы это чувствовалось без взгляда
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
  // Дотянули до порога — отвечаем или пересылаем (жест вместо меню действий).
  if (swipeReplyReady.value) emit('set-reply')
  else if (swipeForwardReady.value) emit('forward')
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

/** Что считаем доступным с клавиатуры (Tab): на такое уход фокуса — настоящий. */
const TAB_STOP = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Мышь идёт по строке — панель снова живёт по наведению.
 *
 * Гашение (класс `dismissed`) сильнее `.msg:hover .msg-actions`, поэтому после
 * клика по реакции панель на компьютере не возвращалась наведением — открыть её
 * можно было только нажатием («теперь кликать надо на сообщение?»). Снимаем
 * гашение, как только курсор вышел из области панели: клик по реакции её и
 * правда гасит (курсор в этот момент на панели), а вернуться достаточно
 * навести мышь на сообщение.
 */
const onHoverMove = (event: MouseEvent) => {
  // Палец «мышью» не водит: на тач-устройствах панель возвращает нажатие.
  if (window.matchMedia?.('(pointer: coarse)').matches) return
  const bar = rowRoot.value?.querySelector<HTMLElement>('.msg-actions')
  if (bar) {
    const rect = bar.getBoundingClientRect()
    const onBar =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    if (onBar) return
  }
  actionsBarRef.value?.reveal()
}

/**
 * Фокус ушёл из строки (Tab, нажатие в пустое место) — панель больше не нужна.
 *
 * Уход ВНУТРЬ строки (с сообщения на кнопку панели) панель не гасит. И служебная
 * смена фокуса тоже: тап по неинтерактивному месту переводит фокус на ближайший
 * контейнер (`tabindex="-1"` — `.messenger-shell`), и это НЕ «человек ушёл».
 * Замер в приложении (390×844, тап по сообщению со скрытой панелью):
 * `pointerdown` (панель открылась) → `pointerup` → `mousedown` → `focusout` на
 * `.messenger-shell` → `click`; `focusout` приходил уже ПОСЛЕ `pointerup`, из-за
 * чего панель гасла сразу после открытия — «на мобилке невозможно работать с
 * меню быстрых реакций».
 */
const onFocusOut = (event: FocusEvent) => {
  const next = event.relatedTarget as Element | null
  if (next && rowRoot.value?.contains(next)) return
  if (next && !next.matches(TAB_STOP)) return
  actionsBarRef.value?.dismiss()
}

/** Панель действий при наведении (и по тапу): закрыть её меню и палитру. */
const actionsBarRef = ref<InstanceType<typeof MessageActionsBar> | null>(null)

// Прокрутка ленты или нажатие по пустому месту — панель убираем принудительно.
watch(
  () => props.actionsReset,
  () => actionsBarRef.value?.dismiss()
)

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

// ---------------------------------------------------------------------------
// Реакции: тап ставит/снимает свою, удержание (или правый клик) — «кто поставил».
// ---------------------------------------------------------------------------

/** Сколько держать, чтобы открылся список поставивших (как долгое нажатие в чатах). */
const REACTION_HOLD_MS = 450

/**
 * Сдвиг указателя, после которого удержание считаем не удержанием, а жестом
 * прокрутки: у чипа есть горизонтальный скролл строки реакций.
 */
const REACTION_HOLD_SLOP = 12

/** Длительность анимации появления реакции (совпадает с CSS-кешфреймами). */
const REACTION_SHOT_MS = 520

/** Аватарок в чипе не больше трёх: дальше уже каша из лиц. */
const CHIP_FACES_MAX = 3

interface ReactionFace {
  id: number
  url?: string
  initials: string
}

/**
 * Лица отметивших для чипов реакции.
 *
 * Пока людей мало, аватарки полезнее числа: «👍 2» читается как счётчик, а лица
 * сразу отвечают на вопрос «кто». Как только их больше трёх, разглядеть лица
 * всё равно нельзя — возвращаем счётчик.
 */
const reactionFaces = computed<Record<string, ReactionFace[]>>(() => {
  const map: Record<string, ReactionFace[]> = {}
  for (const reaction of props.message.reactions ?? []) {
    const ids = reaction.user_ids ?? []
    if (!ids.length || ids.length > CHIP_FACES_MAX) continue
    map[reaction.emoji] = ids.map((id) => {
      const member = props.members?.find((item) => item.id === id)
      if (!member) return { id, initials: '?' }
      return { id, url: avatarUrlOf(member), initials: initials(displayName(member)) }
    })
  }
  return map
})

const facesOf = (emoji: string): ReactionFace[] => reactionFaces.value[emoji] ?? []

/**
 * Реакции, которым сейчас играет «выстрел» — по росту счётчика.
 *
 * Считаем именно рост, а не появление чипа: своё действие видно, и когда
 * реакцию поставил собеседник.
 */
const freshReactions = ref<string[]>([])
let freshTimer: ReturnType<typeof setTimeout> | undefined
let knownReactionCounts = new Map<string, number>(
  (props.message.reactions ?? []).map((item) => [item.emoji, item.count])
)

watch(
  () => props.message.reactions,
  (list) => {
    const next = new Map<string, number>()
    const grown: string[] = []
    for (const item of list ?? []) {
      next.set(item.emoji, item.count)
      if (item.count > (knownReactionCounts.get(item.emoji) ?? 0)) grown.push(item.emoji)
    }
    knownReactionCounts = next
    if (!grown.length) return
    freshReactions.value = grown
    if (freshTimer !== undefined) globalThis.clearTimeout(freshTimer)
    freshTimer = globalThis.setTimeout(() => {
      freshTimer = undefined
      freshReactions.value = []
    }, REACTION_SHOT_MS)
  }
)

const isFresh = (emoji: string): boolean => freshReactions.value.includes(emoji)

let reactionHoldTimer: ReturnType<typeof setTimeout> | undefined
let reactionHoldHandled = false
let reactionHoldOrigin: { x: number; y: number } | undefined
/** Чип, к которому привязываем список «кто поставил». */
let reactionAnchor: HTMLElement | null = null

const cancelReactionHold = (): void => {
  reactionHoldOrigin = undefined
  if (reactionHoldTimer === undefined) return
  globalThis.clearTimeout(reactionHoldTimer)
  reactionHoldTimer = undefined
}

/** Правый клик (мышь) по чипу — тот же список, что по удержанию. */
const openReactionUsers = (emoji: string, event: Event): void => {
  if (event.currentTarget instanceof HTMLElement) reactionAnchor = event.currentTarget
  emit('open-reactions', emoji, reactionAnchor)
}

/**
 * Контекстное меню на чипе реакции.
 *
 * На телефоне удержание приходит ДВУМЯ событиями: нашим таймером и системным
 * `contextmenu` — список открываем один раз (по таймеру). Всплытие гасим на
 * уровне чипа: у строки свой `contextmenu` для листа действий, и без этого на
 * удержании открывались два окна сразу.
 */
const onReactionContext = (emoji: string, event: Event): void => {
  if (reactionHoldHandled) return
  openReactionUsers(emoji, event)
}

const startReactionHold = (emoji: string, event: PointerEvent): void => {
  cancelReactionHold()
  // Флаг — про клик ЭТОГО нажатия. Прошлое удержание могло открыть список, и
  // заканчивающий его клик ушёл на подложку диалога, а не в чип: тогда флаг
  // остался бы висеть и съел следующий тап по реакции.
  reactionHoldHandled = false
  if (event.currentTarget instanceof HTMLElement) reactionAnchor = event.currentTarget
  // Точку запоминаем сразу: отменять удержание по «вышли за элемент» нельзя —
  // от ховера появляется панель действий, строка сдвигается, и курсор
  // оказывается вне чипа при неподвижном пальце.
  reactionHoldOrigin = { x: event.clientX, y: event.clientY }
  reactionHoldTimer = globalThis.setTimeout(() => {
    reactionHoldTimer = undefined
    reactionHoldOrigin = undefined
    // Клик, которым закончится это же нажатие, не должен ещё и снимать реакцию.
    reactionHoldHandled = true
    haptic(HAPTIC_HOLD)
    emit('open-reactions', emoji, reactionAnchor)
  }, REACTION_HOLD_MS)
}

const onReactionHoldMove = (event: PointerEvent): void => {
  if (reactionHoldTimer === undefined || reactionHoldOrigin === undefined) return
  const shift = Math.hypot(
    event.clientX - reactionHoldOrigin.x,
    event.clientY - reactionHoldOrigin.y
  )
  if (shift > REACTION_HOLD_SLOP) cancelReactionHold()
}

const onReactionClick = (emoji: string): void => {
  if (reactionHoldHandled) {
    reactionHoldHandled = false
    return
  }
  emit('toggle-reaction', emoji)
}

onBeforeUnmount(() => {
  cancelReactionHold()
  if (freshTimer !== undefined) globalThis.clearTimeout(freshTimer)
})
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
  border-radius: var(--ms-radius-pill);
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

/* ---------- Канал: пост во всю ширину ----------
 * Второй стороны в канале нет, поэтому делить ширину с собеседником не с кем и
 * лента идёт ровной колонкой постов во всю ширину. Пузырь растёт вместе со
 * строкой: короткий пост в канале — такая же широкая плашка, как длинный, иначе
 * колонка выглядит рваной. Исключение — «прозрачные» пузыри (стикер-эмодзи,
 * картинка-стикер, кружок): у них нет фона, и во всю ширину подпись времени
 * уехала бы от картинки в другой край экрана. */
.msg.channel {
  max-width: 100%;
  width: 100%;
}

.msg.channel .msg-bubble:not(.sticker-only):not(.sticker-image):not(.round-video-only) {
  width: 100%;
}

.msg-bubble {
  position: relative;
  padding: 7px 11px 6px;
  border-radius: var(--ms-radius-md);
  /* Тени нет намеренно: в Телеграме и WhatsApp пузыри плоские — объём даёт фон
     чата, а тень превращала ленту в «веб-карточки». Тени остались у меню,
     плашек и диалогов, где они и нужны. */
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

/* Картинка-стикер: пузырь тоже прозрачный — в ленте это не «сообщение с
   картинкой», а сам стикер (в Telegram у стикеров подложки нет). Без этого
   прозрачная картинка лежала на тёмной подложке пузыря и читалась как «тёмное
   окно», особенно когда файл не загрузился. Селекторы с .msg.in/.msg.out нужны
   по той же причине, что и у «кружка»: у правил цвета пузыря выше
   специфичность выше.

   Предел ширины здесь ТОЛЬКО в пикселях. Процент у картинки-стикера задавать
   нельзя: ширина строки со вложением считается по содержимому, то есть по самому
   пузырю, и `70%` разрешалось в его же ширину — пузырь сжимался (у эмодзи-стикера
   это безобидно: текст переносится), а картинка не влезала и обрезалась справа на
   47px (проверено на живом приложении: пузырь 115px при картинке 160px). Размер
   картинки уже ограничен в `MessageAttachment.vue` (160px). */
.msg-bubble.sticker-image,
.msg.in .msg-bubble.sticker-image,
.msg.out .msg-bubble.sticker-image {
  background: transparent;
  box-shadow: none;
  padding: 0 2px;
  max-width: 320px;
}

/* У «прозрачных» пузырей (стикер-эмодзи, картинка-стикер, «кружок»-видео)
   внутри нет подложки, и время с галочками висело голой строкой под сообщением —
   читалось как случайная подпись. Даём им плашку как у разделителя даты.
   Правило стоит ПОСЛЕ правил стикеров: `__tests__/emojiStickers.spec.ts` читает
   первое правило с `.msg-bubble.sticker-image` и проверяет в нём предел ширины. */
.msg-bubble.sticker-only .msg-meta,
.msg-bubble.sticker-image .msg-meta,
.msg-bubble.round-video-only .msg-meta {
  padding: 2px 7px;
  border-radius: var(--ms-radius-pill);
  background: var(--ms-date-pill);
  backdrop-filter: blur(6px);
}

/* ---------- Свайпы: вправо — ответ, влево — пересылка ---------- */
.msg {
  /* Горизонталь обрабатываем сами (свайпы), вертикаль оставляем ленте. */
  touch-action: pan-y;
  transition: transform 0.16s ease;
}

/* Значок жеста: у ответа он слева от строки, у пересылки — справа (значит,
 * показываем ровно тот, в какую сторону тянут). */
.swipe-reply,
.swipe-forward {
  position: absolute;
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

.swipe-reply {
  left: -4px;
}

.swipe-forward {
  right: -4px;
}

/* Порог пройден: значок «загорается» — отпускание сработает. Цвета разные,
 * чтобы ответ и пересылку не путать на бегу. */
.swipe-reply.ready {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
}

.swipe-forward.ready {
  background: var(--ms-info-bg);
  color: var(--ms-info);
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
  border-radius: var(--ms-radius-xs);
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
  border-radius: var(--ms-radius-xs);
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

/* Значок «об этом сообщении стоит напоминание» (точное время — в подсказке). */
.msg-reminder {
  display: inline-flex;
  align-items: center;
  margin-right: 2px;
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
  border-radius: var(--ms-radius-xs);
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
  border-radius: var(--ms-radius-xs);
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
  border-radius: var(--ms-radius-xs);
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

/* Нижний ряд пузыря: реакции слева, время справа — одной строкой, как в
   Telegram. Когда реакций нет, время прижимается вправо и вид не меняется. */
.msg-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 2px var(--ms-space-2);
  margin-top: 2px;
}

.msg-footer .msg-meta {
  margin-top: 0;
  margin-left: auto;
}

/* Реакции */
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ms-space-1);
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

/* Эмодзи в сообщении — прежнего размера (в окне «кто отметил» те же эмодзи
   крупнее: там они и есть содержание). */
.reaction-emoji {
  font-size: var(--ms-fs-md);
  line-height: 1;
}

.reaction-chip {
  position: relative;
  /* Подложка из поверхности пузыря, а не своя краска: чип лежит НА пузыре, и
     своя заливка на своей же (синей у исходящих) выглядела бы заплаткой. */
  background: color-mix(in srgb, var(--ms-surface) 82%, transparent);
  color: var(--ms-text);
  border: none;
  border-radius: var(--ms-radius-sm);
  padding: 4px 9px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

/* «Моя» реакция выделяется полупрозрачным тоном, без рамки: рамка вокруг чипа
   читалась как вторая граница пузыря, а градиент — как чужой элемент. */
.reaction-chip.mine {
  background: color-mix(in srgb, var(--ms-accent) 20%, transparent);
  color: var(--ms-text-strong);
}

.reaction-count {
  font-size: var(--ms-fs-xs);
  font-weight: 600;
}

/* Лица отметивших в чипе: чуть внахлёст, как стопка аватарок в Telegram. */
.reaction-faces {
  display: inline-flex;
  align-items: center;
}

.reaction-face {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-grid;
  place-items: center;
  font-size: var(--ms-fs-sm);
  font-weight: 700;
  color: var(--ms-on-accent);
  background: var(--ms-accent);
  border: 1px solid var(--ms-surface);
}

.reaction-face + .reaction-face {
  margin-left: -6px;
}

.reaction-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Только что поставленная реакция: эмодзи «выстреливает» из чипа, вокруг
   расходится ореол полупрозрачным тоном (рамки нет — выделяем цветом, не
   границей). Класс снимается таймером (REACTION_SHOT_MS), поэтому анимация
   играет один раз на каждое новое нажатие. */
.reaction-chip.fresh .reaction-emoji {
  display: inline-block;
  animation: reaction-shot 0.5s cubic-bezier(0.2, 1.1, 0.3, 1.2);
}

.reaction-chip.fresh::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ms-accent) 26%, transparent);
  pointer-events: none;
  animation: reaction-glow 0.5s ease-out;
}

@keyframes reaction-shot {
  0% {
    transform: scale(0.3) rotate(-18deg);
  }
  45% {
    transform: scale(1.6) rotate(10deg);
  }
  70% {
    transform: scale(0.92) rotate(-4deg);
  }
  100% {
    transform: scale(1) rotate(0);
  }
}

@keyframes reaction-glow {
  from {
    opacity: 0.9;
    transform: scale(0.9);
  }
  to {
    opacity: 0;
    transform: scale(1.4);
  }
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
  /* Своего z-index у кружка НЕТ нарочно: прилипшая плашка даты в ленте —
     `z-index: 1` (`.day-divider` в MessageThread) и обязана оставаться поверх
     содержимого строки. С `z-index: 6` галка перекрывала дату, когда строка
     проезжала под ней (владелец: «перекрывают галки плавающее время»). */
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

/* Область отметки в режиме выделения.
 *
 * Выходит далеко за пределы строки (`.msg` ограничен 60% ширины ленты, а
 * кружок-чек вынесен ещё дальше вбок): тап по пустому месту строки, по кружку
 * или по краю ленты на высоте сообщения тоже переключает выбор. Владелец: «в
 * любое место выделенного сообщения тыкнуть — его развыделяет». Вылезшее за
 * ленту обрезается её `overflow-x: hidden`, поэтому соседние строки не задеваем:
 * по вертикали область ограничена самой строкой.
 *
 * Кружок `.row-selector` лежит выше по z-index, но у него `pointer-events: none`,
 * поэтому тап по нему достаётся этой области. */
.msg-select-hit {
  position: absolute;
  inset: 0 -50vw;
  z-index: 4;
  cursor: pointer;
  border-radius: var(--ms-radius-lg);
}
</style>
