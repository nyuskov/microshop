<template>
  <div ref="wrapRef" class="thread-wrap">
    <!-- Полосы подсветки: вспышка перехода к закреплённому/из поиска и
         выделенные сообщения. Рисуются во всю ширину чата и ПОД сообщениями
         (фон пузыря не подсвечиваем). Позицию считает скрипт по координатам
         строки: сама строка уже пузыря (max-width 60%), поэтому растянуть
         полосу по ней нельзя — рисуем уровнем выше. -->
    <div
      v-for="band in bands"
      :key="band.key"
      class="highlight-band"
      :class="{ selected: band.selected }"
      :style="{ top: `${band.top}px`, height: `${band.height}px` }"
      aria-hidden="true"
    ></div>
    <div
      ref="containerRef"
      class="messages-scroll"
      @click="onThreadClick"
      @scroll.passive="onScroll"
    >
      <!-- Скелетоны вместо текста «Загрузка сообщений…»: показываем структуру ленты -->
      <div v-if="loading" class="skeleton-list" aria-busy="true">
        <span class="sr-only">{{ t('Загрузка сообщений…') }}</span>
        <div
          v-for="n in SKELETON_ROWS"
          :key="n"
          class="skeleton-row"
          :class="{ own: SKELETON_OWN.includes(n) }"
        >
          <span class="skeleton-bubble" :style="{ width: SKELETON_WIDTH[n] }"></span>
        </div>
      </div>
      <template v-else>
        <div v-for="group in dayGroups" :key="group.key" class="day-group">
          <div v-if="group.label" class="day-divider">
            <span>{{ group.label }}</span>
          </div>
          <template v-for="item in group.items" :key="item.row.message.id">
            <div
              v-if="ownsUnreadDivider(item.row.message.id)"
              class="unread-divider"
              data-unread-divider
            >
              <span>{{ t('Непрочитанные сообщения') }}</span>
            </div>
            <MessageRow
              :message="item.row.message"
              :is-own="item.row.message.user_id === currentUserId"
              :viewer-id="currentUserId"
              :highlighted="highlightedMessageId === item.row.message.id"
              :search-query="searchQuery"
              :emoji-picker-open="emojiPickerFor === item.row.message.id"
              :quote="quoteOf(item.row.message)"
              :selection-mode="selectionMode"
              :selected="selectedMessageIds.includes(item.row.message.id)"
              :selectable="item.row.message.kind !== 'call'"
              :author-name="authorNameFor(item.row, item.index)"
              :series="seriesFor(item.index)"
              :members="members"
              :reminder-at="reminderAtOf(item.row.message)"
              :channel="Boolean(channelPosts)"
              :album="albumOf(item.row.message)"
              :actions-reset="actionsReset"
              @quote-click="emit('quote-click', item.row.message)"
              @select-start="emit('select-start', item.row.message)"
              @toggle-select="emit('toggle-select', item.row.message)"
              @forwarder-click="emit('forwarder-click', item.row.message)"
              @toggle-emoji-picker="emit('toggle-emoji-picker', item.row.message)"
              @set-reply="emit('set-reply', item.row.message)"
              @toggle-reaction="emit('toggle-reaction', item.row.message, $event)"
              @open-reactions="
                (emoji: string, anchor: HTMLElement | null) =>
                  emit('open-reactions', item.row.message, emoji, anchor)
              "
              @toggle-pin="emit('toggle-pin', item.row.message)"
              @copy="emit('copy', item.row.message)"
              @edit="emit('edit', item.row.message)"
              @forward="emit('forward', item.row.message)"
              @save="emit('save', item.row.message)"
              @make-sticker="emit('make-sticker', item.row.message)"
              @add-set="emit('add-set', item.row.message)"
              @delete="emit('delete', item.row.message)"
              @report="emit('report', item.row.message)"
              @open-image="openImageOf(item.row, $event)"
              @open-sticker="emit('open-sticker', item.row.message)"
              @open-view-once="emit('open-view-once', item.row.message)"
              @remind="emit('remind', item.row.message)"
            />
            <!-- Пост канала: просмотры и переход к комментариям (как в Telegram). -->
            <div
              v-if="channelPosts && item.row.message.kind !== 'call'"
              :key="`meta-${item.row.message.id}`"
              class="post-meta"
              :data-post-id="item.row.message.id"
            >
              <span class="post-views">
                <q-icon :name="icon('visibility')" size="15px" aria-hidden="true" />
                {{ postMetaOf(item.row.message.id).views }}
              </span>
              <button
                class="post-comments"
                type="button"
                @click="emit('open-comments', item.row.message)"
              >
                <q-icon :name="icon('chat_bubble')" size="15px" aria-hidden="true" />
                <template v-if="postMetaOf(item.row.message.id).comments">
                  {{ postMetaOf(item.row.message.id).comments }}
                </template>
                <template v-else>{{ t('Комментировать') }}</template>
              </button>
            </div>
          </template>
        </div>
        <div v-for="p in pending ?? []" :key="p.localId" class="pending-row">
          <div class="pending-bubble" :class="`st-${p.status ?? 'sending'}`">
            <img v-if="p.previewUrl" :src="p.previewUrl" class="pending-preview" alt="" />
            <q-icon
              v-else-if="!isTextRow(p)"
              :name="icon('attach_file')"
              class="pending-file-icon"
              size="16px"
            />
            <span class="pending-meta">
              <span class="pending-label">{{ p.label }}</span>
              <!-- Полоса прогресса загрузки: заполняется по мере отправки -->
              <span
                v-if="(p.status ?? 'sending') === 'sending' && typeof p.progress === 'number'"
                class="pending-bar"
                role="progressbar"
                :aria-valuenow="p.progress"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span class="pending-bar-fill" :style="{ width: `${p.progress}%` }"></span>
              </span>
              <!-- Вложение грузится: виден процент, чтобы не казалось, что встало -->
              <span v-if="(p.status ?? 'sending') === 'sending'" class="pending-status">
                <span class="pending-spinner" aria-hidden="true"></span>
                {{ uploadStatusText(p.progress) }}
              </span>
              <!-- Текста не ушёл: ждём сеть и отправим сами -->
              <span v-else-if="p.status === 'queued'" class="pending-status">
                <q-icon :name="icon('schedule')" size="14px" aria-hidden="true" />
                {{ t('Ждёт сети — отправим, как появится') }}
              </span>
              <!-- Сервер отказал: без ручного повтора сообщение не уйдёт -->
              <span v-else class="pending-status error">
                <q-icon :name="icon('error')" size="14px" aria-hidden="true" />
                {{ p.error || t('Не отправлено') }}
              </span>
            </span>
            <button
              v-if="p.status === 'failed'"
              type="button"
              class="pending-action"
              :title="t('Повторить отправку')"
              @click="emit('retry-pending', p.localId)"
            >
              <q-icon :name="icon('refresh')" size="17px" />
            </button>
            <button
              v-if="p.status && p.status !== 'sending'"
              type="button"
              class="pending-action danger"
              :title="t('Убрать из очереди')"
              @click="emit('drop-pending', p.localId)"
            >
              <q-icon :name="icon('close')" size="17px" />
            </button>
          </div>
        </div>
        <div v-if="!rows.length && (pending ?? []).length === 0" class="chat-status">
          <EmptyState
            icon="forum"
            :title="t('Сообщений пока нет')"
            :hint="t('Напишите первым — сообщение появится здесь')"
          />
        </div>
      </template>
    </div>

    <!-- Кнопка «вниз»: появляется, когда лента прокручена вверх -->
    <button
      v-if="showJumpDown"
      type="button"
      class="jump-down"
      :class="{ 'has-new': hasNewBelow }"
      :title="hasNewBelow ? t('Новые сообщения') : t('Вниз')"
      :aria-label="hasNewBelow ? t('Перейти к новым сообщениям') : t('Прокрутить вниз')"
      @click="onJumpDown"
    >
      <q-icon v-if="!newBelowCount" :name="icon('arrow_downward')" size="20px" aria-hidden="true" />
      <span v-else class="jump-count">{{ newBelowCount > 99 ? '99+' : newBelowCount }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import { uploadStatusText } from '@/utils/upload'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ChatUser, Message } from '@/types'
import { seriesKindFor, unreadSeenAtBottom } from '@/utils/thread'
import type { MessageRow as ThreadRow, SeriesKind } from '@/utils/thread'
import { displayName } from '@/utils/user'
import { albumLayout } from '@/utils/albums'
import MessageRow from '@/components/messenger/MessageRow.vue'
import type { MessageQuote } from '@/components/messenger/ReplyQuote.vue'
import EmptyState from '@/components/common/EmptyState.vue'

/**
 * Временный пузырь внизу ленты.
 *
 * `sending` — вложение грузится на сервер; `queued` — текст не ушёл из-за сети и
 * отправится сам; `failed` — сервер отказал, нужен ручной повтор.
 */
export interface PendingRow {
  localId: number
  label: string
  previewUrl?: string | null
  status?: 'sending' | 'queued' | 'failed'
  /** Сколько процентов вложения уже ушло на сервер (null — неизвестно). */
  progress?: number | null
  /** Текст ошибки для состояния `failed`. */
  error?: string | null
}

const props = defineProps<{
  rows: ThreadRow[]
  loading: boolean
  currentUserId: number | null
  highlightedMessageId: number | null
  /**
   * Запрос поиска по сообщениям: совпадения подсвечиваются прямо в тексте
   * (см. `highlightQuery`), пустая строка — обычный показ ленты.
   */
  searchQuery?: string
  emojiPickerFor: number | null
  /** Резолвит данные ответа-цитаты для строки (null — цитата не загружена). */
  quoteOf: (message: Message) => MessageQuote | null
  /** Режим мультивыделения сообщений (long-press). */
  selectionMode: boolean
  /** Id выбранных сообщений. */
  selectedMessageIds: number[]
  /** Вложения/сообщения, которые ещё не отправлены (показываются внизу ленты). */
  pending?: PendingRow[]
  /** Групповой ли открытый чат (показываем имена авторов). */
  isGroupChat?: boolean
  /** Участники группы (для имён авторов сообщений). */
  members?: ChatUser[]
  /** Сколько сообщений было непрочитано в момент открытия чата (для разделителя). */
  unreadCount?: number
  /** Открыт канал: под постами показываем просмотры и комментарии. */
  channelPosts?: boolean
  /** Счётчики постов канала по id сообщения. */
  postMeta?: Record<number, ChannelPostCounters>
  /**
   * Время напоминания об этом сообщении (ISO) либо null — подставляется в строку,
   * чтобы та знала про стоящий «будильник» (значок у времени и подпись в меню).
   */
  reminderAt?: (message: Message) => string | null
  /**
   * Счётчик «погасить панель действий»: лента передаёт его строкам, а меняет
   * родитель — при прокрутке и нажатии по пустому месту (см. `MessageRow`).
   */
  actionsReset?: number
}>()

/** Счётчики поста канала (просмотры и комментарии). */
export interface ChannelPostCounters {
  views: number
  comments: number
}

const EMPTY_COUNTERS: ChannelPostCounters = { views: 0, comments: 0 }

/** Счётчики поста: без данных считаем нулями, чтобы шаблон был простым. */
const postMetaOf = (messageId: number): ChannelPostCounters =>
  props.postMeta?.[messageId] ?? EMPTY_COUNTERS

/** Время напоминания для строки: нет функции — считаем, что напоминаний нет. */
const reminderAtOf = (message: Message): string | null => props.reminderAt?.(message) ?? null

// ---------- Альбомы (несколько картинок одной отправки) ----------
// У вложений альбома одна метка `album_id`, но это отдельные сообщения: в ленте
// сетку рисует ПЕРВОЕ из них, остальные не выводятся (см. utils/albums.ts).

const albums = computed(() => albumLayout(props.rows))

/** Вложения альбома для строки (undefined — обычное одиночное вложение). */
const albumOf = (message: Message): Message[] | undefined => albums.value.members.get(message.id)

/**
 * Открыть картинку в лайтбоксе.
 *
 * У альбома тап приходит с КОНКРЕТНОЙ плиткой (их несколько в одном сообщении),
 * поэтому берём её, а не сообщение строки.
 */
const openImageOf = (row: ThreadRow, message?: Message): void => {
  if (row.kind === 'message') emit('open-image', message ?? row.message)
}

/**
 * Кому показать разделитель «Непрочитанные сообщения».
 *
 * Разделитель может попасть на продолжение альбома, а такие строки не рисуются:
 * тогда его показывает головное сообщение пачки.
 */
const ownsUnreadDivider = (messageId: number): boolean => {
  const divider = unreadDividerId.value
  if (divider === null) return false
  return (albums.value.headOf.get(divider) ?? divider) === messageId
}

const emit = defineEmits<{
  (e: 'background-click'): void
  /**
   * Клик пришёлся на САМО сообщение (не на его панель действий).
   *
   * Отделено от «клика мимо»: панель действий (реакции, ответ, пересылка) живёт
   * ПОД сообщением, и на телефоне открыть её можно только нажатием. Пока клик по
   * сообщению считался «кликом мимо», один и тот же тап успевал открыть панель
   * (`pointerdown` строки) и сразу погасить её (`click` до `.messages-scroll`) —
   * «на мобилке невозможно работать с меню быстрых реакций». Комментарий в
   * `onThreadClick`.
   */
  (e: 'message-click'): void
  /** Лента прокрутилась: плавающие панели (реакции, действия) нужно убрать. */
  (e: 'scrolled'): void
  (e: 'reach-top'): void
  /** Лента дочитана до конца — непрочитанных больше нет. */
  (e: 'unread-seen'): void
  (e: 'quote-click', message: Message): void
  (e: 'select-start', message: Message): void
  (e: 'toggle-select', message: Message): void
  (e: 'forwarder-click', message: Message): void
  (e: 'toggle-emoji-picker', message: Message): void
  (e: 'set-reply', message: Message): void
  (e: 'toggle-reaction', message: Message, emoji: string): void
  /** Кто поставил реакцию: открыть список на этом сообщении и эмодзи. */
  (e: 'open-reactions', message: Message, emoji: string, anchor: HTMLElement | null): void
  (e: 'toggle-pin', message: Message): void
  (e: 'copy', message: Message): void
  (e: 'edit', message: Message): void
  (e: 'forward', message: Message): void
  (e: 'save', message: Message): void
  /** «В стикеры»: картинку сообщения копируем в свои стикеры. */
  (e: 'make-sticker', message: Message): void
  (e: 'add-set', message: Message): void
  (e: 'delete', message: Message): void
  /** Повторить отправку стоящего в очереди сообщения. */
  (e: 'retry-pending', localId: number): void
  /** Убрать из очереди неотправленное сообщение. */
  (e: 'drop-pending', localId: number): void
  (e: 'report', message: Message): void
  (e: 'open-image', message: Message): void
  /** Тап по стикеру: окно его набора (как в Телеграме). */
  (e: 'open-sticker', message: Message): void
  /** Просмотр одноразового вложения (файл сервер отдаст ровно один раз). */
  (e: 'open-view-once', message: Message): void
  /** «Напомнить»: выбрать время напоминания об этом сообщении. */
  (e: 'remind', message: Message): void
  /** Пост канала просмотрен (счётчик просмотров растёт один раз). */
  (e: 'post-viewed', message: Message): void
  /** Открыть комментарии к посту канала. */
  (e: 'open-comments', message: Message): void
}>()

const containerRef = ref<HTMLElement | null>(null)
/** Обёртка ленты: в ней рисуется полоса подсветки перехода к сообщению. */
const wrapRef = ref<HTMLElement | null>(null)

/** Сколько горит вспышка перехода к закреплённому/из поиска. */
const HIGHLIGHT_BAND_MS = 2400

/**
 * Полоса подсветки в ленте.
 *
 * Одна механика на две задачи: вспышка перехода к сообщению (гаснет сама) и
 * подсветка выбранных сообщений (горит, пока выбраны) — как в Telegram,
 * градиентом во всю ширину чата.
 */
interface ThreadBand {
  key: string
  top: number
  height: number
  selected: boolean
}

const bands = ref<ThreadBand[]>([])
/** Сообщение, к которому только что перешли (вспышка) — иначе null. */
const flashMessageId = ref<number | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Пересчитывает полосы по живым координатам строк.
 *
 * Обёртка ленты без отступов, поэтому `left/right: 0` у полосы — это ровно
 * ширина панели чата. Позицию и высоту берём у строки: так полоса остаётся на
 * сообщении и после догрузки истории.
 *
 * Полоса идёт ровно по строке сообщения: плашку даты она просто уходит ПОД
 * (плашка рисуется поверх, `z-index: 1` у `.day-divider`). Дата — прозрачная
 * пилюля с размытием (`--ms-date-pill` + `backdrop-filter`), поэтому подсветка
 * под ней размывается, а не вырезается: раньше полоса обрезалась по нижней
 * границе плашки, и при висящей дате верхняя часть строки оставалась без
 * подсветки — визуально полоса была «перекрыта» (жалоба владельца).
 */
const measureBands = (): void => {
  const wrap = wrapRef.value
  const container = containerRef.value
  if (!wrap || !container) {
    bands.value = []
    return
  }
  const wrapBox = wrap.getBoundingClientRect()
  const collect = (ids: number[], selected: boolean): ThreadBand[] =>
    ids.flatMap((id) => {
      // Продолжения альбома в ленте не нарисованы — полосу ставим на головное
      // сообщение пачки, иначе подсветка просто пропала бы.
      const target = albums.value.headOf.get(id) ?? id
      const row = container.querySelector<HTMLElement>(`[data-message-id="${target}"]`)
      if (!row) return []
      const box = row.getBoundingClientRect()
      return [
        {
          key: `${selected ? 'sel' : 'flash'}-${id}`,
          top: box.top - wrapBox.top,
          height: box.height,
          selected
        }
      ]
    })
  const flash = flashMessageId.value === null ? [] : [flashMessageId.value]
  bands.value = [...collect(flash, false), ...collect(props.selectedMessageIds, true)]
}

const startFlashBand = (messageId: number): void => {
  flashMessageId.value = messageId
  measureBands()
  // Лента может доехать до строки уже после этой записи — пересчитываем на кадре.
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(measureBands)
  }
  if (flashTimer !== undefined) globalThis.clearTimeout(flashTimer)
  flashTimer = globalThis.setTimeout(() => {
    flashTimer = undefined
    flashMessageId.value = null
    measureBands()
  }, HIGHLIGHT_BAND_MS)
}

watch(
  () => props.highlightedMessageId,
  (id) => {
    if (id === null) {
      flashMessageId.value = null
      measureBands()
      return
    }
    startFlashBand(id)
  }
)

// Выбор сообщений меняется на каждом клике — полосы пересобираем сразу.
watch(() => props.selectedMessageIds, measureBands)

// ---------- Скелетоны загрузки ----------
/** Сколько «пустых» пузырей рисуем, пока грузятся сообщения. */
const SKELETON_ROWS = 8
/** Какие из них «свои» (справа) — чередуем, чтобы скелетон был похож на переписку. */
const SKELETON_OWN = [3, 4, 8]
/** Ширина пузыря-скелетона: разная, как у настоящих сообщений. */
const SKELETON_WIDTH: Record<number, string> = {
  1: '56%',
  2: '40%',
  3: '64%',
  4: '34%',
  5: '50%',
  6: '30%',
  7: '60%',
  8: '44%'
}

// ---------- Разделитель «Непрочитанные сообщения» ----------
// Серверного last_read_message_id в API чата нет, поэтому считаем «от хвоста»:
// количество непрочитанных известно в момент открытия чата, а последние
// сообщения в ленте — это и есть непрочитанное.
const unreadDividerId = computed<number | null>(() => {
  const count = props.unreadCount ?? 0
  if (count <= 0) return null
  const ids: number[] = []
  for (const row of props.rows) {
    if (row.kind === 'message') ids.push(row.message.id)
  }
  const index = ids.length - count
  // Разделитель имеет смысл только если часть истории уже прочитана.
  if (index <= 0 || index >= ids.length) return null
  return ids[index]
})

// ---------- Кнопка «вниз» и новые сообщения ниже ----------
const showJumpDown = ref(false)
const hasNewBelow = ref(false)
/** Сколько новых сообщений пришло, пока лента прокручена вверх. */
const newBelowCount = ref(0)

const updateScrollState = () => {
  const container = containerRef.value
  if (!container) return
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight
  showJumpDown.value = distance > 320 || hasNewBelow.value
  if (distance < 60) {
    hasNewBelow.value = false
    newBelowCount.value = 0
    // Дочитали до конца — сообщаем родителю, что непрочитанных больше нет:
    // разделитель «Непрочитанные сообщения» и любые отметки должны уйти сразу,
    // а не после перезагрузки страницы.
    if (unreadSeenAtBottom(distance, props.unreadCount ?? 0)) emit('unread-seen')
  }
}

const onJumpDown = () => {
  hasNewBelow.value = false
  newBelowCount.value = 0
  const container = containerRef.value
  if (container) {
    // Плавно только по явному клику: программная прокрутка в остальных местах
    // (восстановление позиции при догрузке) должна оставаться мгновенной.
    const reduceMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({
      top: container.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth'
    })
  }
  updateScrollState()
}

/** Последнее сообщение ленты (по нему понимаем, что пришло новое внизу). */
const tailMessageId = computed<number | null>(() => {
  for (let i = props.rows.length - 1; i >= 0; i -= 1) {
    const row = props.rows[i]
    if (row.kind === 'message') return row.message.id
  }
  return null
})

watch(tailMessageId, (id, prev) => {
  if (id === null || prev === null || id === prev) return
  // Догрузка старых сообщений хвост не меняет — считаем только появление новых.
  if (!isNearBottom()) {
    hasNewBelow.value = true
    newBelowCount.value += 1
  }
})

// Новый чат — сбрасываем подсказки прокрутки.
watch(
  () => props.unreadCount,
  () => {
    hasNewBelow.value = false
    newBelowCount.value = 0
    showJumpDown.value = false
  }
)

// ---------- Группировка по дням (для «липкой» даты) ----------
/** Строка ленты с её позицией в общем списке (нужна для имён авторов). */
type DayGroupItem = { row: Extract<ThreadRow, { kind: 'message' }>; index: number }

/**
 * Строки ленты, сгруппированные по дням.
 *
 * Разделитель дня «липнет» к верху ленты, но только в границах своего дня:
 * «липкий» элемент не выходит за пределы родителя, поэтому каждый день обёрнут
 * в свой блок (`.day-group`). Без группировки два разделителя («12 сентября» и
 * «Вчера») висели бы друг на друге при прокрутке.
 */
const dayGroups = computed(() => {
  const groups: { key: string; label: string; items: DayGroupItem[] }[] = []
  props.rows.forEach((row, index) => {
    if (row.kind === 'day') {
      groups.push({ key: `day-${index}`, label: row.label, items: [] })
      return
    }
    // Продолжения альбома отдельными строками не рисуем: их показывает сетка
    // головного сообщения пачки (см. utils/albums.ts).
    if (albums.value.continuations.has(row.message.id)) return
    if (groups.length === 0) groups.push({ key: 'day-start', label: '', items: [] })
    groups[groups.length - 1].items.push({ row, index })
  })
  return groups
})

// ---------- Серии сообщений (имя автора и форма пузыря) ----------
// Границы серии считает utils/thread.ts::seriesKindFor — там же порог паузы.
// Здесь их только применяем: имя автора в группе — в начале серии, форма
// пузыря (скругления) — по месту в серии, см. MessageRow.vue.

const authorNameFor = (row: ThreadRow, index: number): string => {
  if (!props.isGroupChat || row.kind !== 'message') return ''
  const message = row.message
  if (message.kind === 'call' || message.user_id === props.currentUserId) return ''
  const kind = seriesKindFor(props.rows, index)
  // Имя пишем только там, где серия начинается: дальше и так понятно, кто автор.
  if (kind !== 'first' && kind !== 'single') return ''
  const member = props.members?.find((user) => user.id === message.user_id)
  return member ? displayName(member) : ''
}

/** Место сообщения в серии — форма пузыря (MessageRow). */
const seriesFor = (index: number): SeriesKind => seriesKindFor(props.rows, index)

/**
 * Клик в ленте: по пустому месту («мимо») или по самому сообщению.
 *
 * Тап по сообщению — это НЕ «клик мимо»: иначе на телефоне панель действий не
 * открыть вовсе. Открывает её `pointerdown` строки, а следом за ним приходит
 * `click` того же тапа: пока он считался кликом по фону, панель гасилась в том
 * же жесте и мелькала вместо работы (замер: `pointerdown` → класс `dismissed`
 * снят, `click` → снова надет). Клик по панели сюда не доходит — в ней
 * `@click.stop`.
 */
const onThreadClick = (event: MouseEvent) => {
  const target = event.target as Element | null
  if (target?.closest('.msg')) {
    emit('message-click')
    return
  }
  emit('background-click')
}

const onScroll = () => {
  const container = containerRef.value
  if (container && container.scrollTop < 80) emit('reach-top')
  // Лента едет вместе с сообщениями — полосы подсветки едут с ней.
  if (bands.value.length) measureBands()
  updateScrollState()
  // Прокрутка убирает плавающие панели: иначе панель действий «залипала»
  // поверх соседних сообщений (жалоба владельца), а палитра реакций оставалась
  // открытой при уехавшем из-под неё сообщении.
  emit('scrolled')
}

const scrollToBottom = () => {
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight
  }
  updateScrollState()
}

const isNearBottom = (): boolean => {
  const container = containerRef.value
  if (!container) return true
  return container.scrollHeight - container.scrollTop - container.clientHeight < 120
}

/** Захват позиции прокрутки (для восстановления при догрузке старых сообщений). */
const capture = (): { top: number; height: number } | null => {
  const container = containerRef.value
  if (!container) return null
  return { top: container.scrollTop, height: container.scrollHeight }
}

/** Восстанавливает прокрутку после вставки более старых сообщений сверху. */
const restoreScroll = (top: number, height: number) => {
  const container = containerRef.value
  if (container) {
    container.scrollTop = top + (container.scrollHeight - height)
  }
}

/** Центрирует сообщение по id в ленте. Возвращает false, если его нет в DOM. */
const reveal = (messageId: number): boolean => {
  const container = containerRef.value
  if (!container) return false
  // Продолжение альбома отдельной строкой не нарисовано — показываем пачку.
  const target = albums.value.headOf.get(messageId) ?? messageId
  const el = container.querySelector(`[data-message-id="${target}"]`) as HTMLElement | null
  if (!el) return false
  const containerRect = container.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  container.scrollTop +=
    elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2
  return true
}

/** Строка очереди — текст (без превью и без иконки вложения). */
const isTextRow = (p: PendingRow): boolean => p.status === 'queued' || p.status === 'failed'

// Родитель управляет прокруткой (отправка/догрузка/переход к закреплённому).
defineExpose({ scrollToBottom, isNearBottom, capture, restoreScroll, reveal })

// ---------- Первичная прокрутка в самый низ ----------
// При первом открытии чата (лента была пустой → появились сообщения) после
// отрисовки и двух кадров уходим в самый низ, чтобы были видны свежие
// сообщения, а не середина истории.
let autoScrolledToBottom = false

const waitTwoFrames = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const scrollInitialToBottom = async () => {
  if (autoScrolledToBottom) return
  autoScrolledToBottom = true
  await nextTick()
  await waitTwoFrames()
  const container = containerRef.value
  if (!container) return
  // Если в чате есть непрочитанные — открываем на разделителе, чтобы было видно,
  // откуда читать, а не прыгаем сразу в самый низ (как в почте/мессенджерах).
  if (unreadDividerId.value !== null) {
    const divider = container.querySelector('[data-unread-divider]') as HTMLElement | null
    if (divider) {
      const containerRect = container.getBoundingClientRect()
      const dividerRect = divider.getBoundingClientRect()
      container.scrollTop += dividerRect.top - containerRect.top - 10
      hasNewBelow.value = true
      updateScrollState()
      return
    }
  }
  container.scrollTop = container.scrollHeight
  updateScrollState()
}

watch(
  () => props.rows.length,
  (length) => {
    if (length === 0) {
      autoScrolledToBottom = false
      return
    }
    void scrollInitialToBottom()
  },
  { flush: 'post' }
)

// ---------- Просмотры постов канала ----------
// Просмотр отмечаем, когда строка счётчиков реально попала на экран (как в
// Telegram): повторно об одном и том же посте не сообщаем.
const viewedPostIds = new Set<number>()
let postObserver: IntersectionObserver | null = null
/** Посты текущей ленты по id — чтобы по элементу счётчиков найти сообщение. */
const postMessageById = computed(() => {
  const map = new Map<number, Message>()
  for (const row of props.rows) {
    if (row.kind === 'message') map.set(row.message.id, row.message)
  }
  return map
})

/** Появившиеся в ленте строки счётчиков отдаём наблюдателю. */
const observePosts = () => {
  if (!props.channelPosts || typeof IntersectionObserver === 'undefined') return
  postObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const id = Number((entry.target as HTMLElement).dataset.postId)
        if (!id || viewedPostIds.has(id)) continue
        const post = postMessageById.value.get(id)
        if (!post) continue
        viewedPostIds.add(id)
        emit('post-viewed', post)
      }
    },
    { root: containerRef.value, threshold: 0.6 }
  )
  const nodes = containerRef.value?.querySelectorAll<HTMLElement>('[data-post-id]')
  nodes?.forEach((node) => postObserver?.observe(node))
}

watch(
  () => [props.channelPosts, props.rows.length] as const,
  () => {
    viewedPostIds.clear()
    postObserver?.disconnect()
    postObserver = null
    void nextTick(observePosts)
  },
  { flush: 'post' }
)

onMounted(() => {
  if (props.rows.length > 0) void scrollInitialToBottom()
  void nextTick(observePosts)
})

onBeforeUnmount(() => {
  postObserver?.disconnect()
  postObserver = null
  if (flashTimer !== undefined) globalThis.clearTimeout(flashTimer)
})
</script>

<style scoped>
/* Обёртка нужна для позиционирования кнопки «вниз» поверх ленты
   (сама лента — скролл-контейнер, absolute внутри неё уехал бы с контентом). */
.thread-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Полоса подсветки перехода к закреплённому/из поиска и выбранных сообщений.
   Рисуется в обёртке ленты (у неё нет отступов), поэтому left/right: 0 — это
   ровно ширина панели чата, а не узкая строка сообщения. Заливка ровная и
   полупрозрачная — без градиента и без направленной «стороны». */
.highlight-band {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 0;
  pointer-events: none;
  background: color-mix(in srgb, var(--ms-accent) 14%, transparent);
  animation: highlight-band-flash 2.4s ease 1;
}

/* Выбранное сообщение: тот же тон, только горит постоянно, пока выбрано.
   Рамки вокруг пузыря больше нет — выделение читается фоном. */
.highlight-band.selected {
  animation: none;
  opacity: 1;
}

@keyframes highlight-band-flash {
  0%,
  100% {
    opacity: 0;
  }
  12%,
  60% {
    opacity: 1;
  }
}

/* Пользователю, который выключил анимации, полоса нужна сразу и целиком. */
@media (prefers-reduced-motion: reduce) {
  .highlight-band {
    animation: none;
    opacity: 1;
  }
}

/* Визуально скрытый текст для скринридеров. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.messages-scroll {
  position: relative;
  /* Выше полосы подсветки: подсвечиваем строку, а не фон сообщений. */
  z-index: 1;
  flex: 1;
  min-height: 0; /* чтобы лента скроллилась внутри, а не растягивала панель */
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 16px;
  /* Запас снизу под открытую панель эмодзи/стикеров: она оверлей поверх ленты,
     и без него последнее сообщение оказывается под ней. Высоту панели пишет
     родитель в `--ms-extras-h` (см. MessageComposer/Messenger). */
  padding-bottom: calc(12px + var(--ms-extras-h, 0px));
  display: flex;
  flex-direction: column;
}

/* Пустой чат: карточку держим по центру ленты, а не у верхнего края (сверху
   сообщение выглядело «прилипшим» к шапке и вокруг была пустота на экран). */
/* Пустая лента: подсказка держится по центру области, а не под шапкой.
   `margin: auto` работает на обёртке (`.chat-status`), а не на самом
   `.empty-state`: пустое состояние вложено в неё. */
.messages-scroll > .chat-status {
  margin: auto;
}

/* ---------- Счётчики поста канала (просмотры · комментарии) ---------- */
.post-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 2px 4px 6px;
  color: var(--ms-muted, #71808d);
  font-size: 12.5px;
}

.post-views,
.post-comments {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.post-comments {
  border: none;
  padding: 2px 4px;
  border-radius: var(--ms-radius-xs);
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

.post-comments:hover {
  background: var(--ms-hover, #eef2f6);
  color: var(--ms-accent, #2ea25e);
}

/* ---------- Скелетоны загрузки ---------- */
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
}

.skeleton-row {
  display: flex;
  align-items: flex-start;
}

.skeleton-row.own {
  justify-content: flex-end;
}

.skeleton-bubble {
  display: block;
  height: 38px;
  max-width: 70%;
  border-radius: var(--ms-radius-md);
  background: linear-gradient(
    100deg,
    var(--ms-surface-2, #eef1f4) 30%,
    var(--ms-hover, #f2f4f6) 50%,
    var(--ms-surface-2, #eef1f4) 70%
  );
  background-size: 220% 100%;
  animation: skeleton-shimmer 1.3s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-bubble {
    animation: none;
  }
}

/* ---------- Разделитель «Непрочитанные сообщения» ---------- */
.unread-divider {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}

.unread-divider span {
  background: var(--ms-accent-soft, #e3f2e5);
  color: var(--ms-accent, #2ea25e);
  border: 1px solid var(--ms-accent-border, rgba(46, 162, 94, 0.35));
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: var(--ms-radius-pill);
}

/* ---------- Кнопка «вниз» ---------- */
.jump-down {
  position: absolute;
  right: 16px;
  bottom: 12px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--ms-border, #e2e6ea);
  background: var(--ms-surface, #fff);
  color: var(--ms-icon, #52626f);
  box-shadow: var(--ms-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.16));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
  transition:
    transform 0.12s,
    background 0.12s;
}

.jump-down:hover {
  background: var(--ms-hover, #f2f4f6);
}

.jump-down.has-new {
  color: var(--ms-on-accent, #fff);
  background: var(--ms-accent, #2ea25e);
  border-color: transparent;
}

/* Группа одного дня: разделитель «липнет» только в её пределах, поэтому даты
   соседних дней не накладываются друг на друга. Flex обязателен: пузыри
   выравниваются через `align-self` (свои — вправо, чужие — влево). */
.day-group {
  display: flex;
  flex-direction: column;
}

/* Дата дня «прилипает» к верху ленты, пока прокручиваешь её день.
   z-index: 1 — НИЖЕ шапки чата (`.chat-header` — z-index: 2). Иначе плашка
   оказывалась в одном слое с шапкой и, идя позже в DOM, выигрывала у
   выпадающего меню «⋯»: меню рисовалось под ней и выглядело закрытым.
   Единицы достаточно: у `.msg` только `position: relative` (z-index: auto),
   а всплывающие элементы строки (панель действий — 5, меню «⋯» и палитра
   реакций — 12–13) — с бо́льшим z-index, то есть плашку не перекрывают.
   У содержимого строки своего слоя быть НЕ должно: кружок-чек выделения
   (`.row-selector` в MessageRow) раньше стоял на `z-index: 6` и, когда строка
   проезжала под прилипшей датой, галка рисовалась поверх неё — владелец:
   «перекрывают галки плавающее время». */
.day-divider {
  position: sticky;
  top: 6px;
  z-index: 1;
  display: flex;
  justify-content: center;
  margin: 10px 0;
  pointer-events: none;
}

/* Плашка полупрозрачная, а фон под ней размывается — как плавающая дата в
   Telegram: сообщение за плашкой не «исчезает», а мягко уходит в размытие.
   Тени нет: размытие уже отделяет плашку от ленты. */
/* Плашка даты — как в Telegram: прозрачный фон + размытие того, что за ней.
   Полоса выделения проходит ПОД плашкой целой, а размытие делает её мягкой
   под датой (поэтому резкой зелёной полосы «вместе с датой» не видно). */
.day-divider span {
  background: var(--ms-date-pill);
  color: var(--ms-muted);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: var(--ms-radius-pill);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
}

.chat-status {
  padding: 12px;
  text-align: center;
  color: var(--ms-muted-2);
  font-size: 13.5px;
}

/* Временный пузырь «Отправка…» для загружаемого вложения (справа, как своё) */
.pending-row {
  display: flex;
  justify-content: flex-end;
  padding: 2px 0;
}

.pending-bubble {
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: min(70%, 320px);
  background: var(--ms-accent-soft, #e3f2e5);
  border: 1px solid var(--ms-accent-border, rgba(46, 162, 94, 0.3));
  border-radius: 16px 6px 16px 16px;
  padding: 6px 10px;
  min-width: 0;
}

.pending-preview {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: var(--ms-radius-sm);
  flex-shrink: 0;
}

.pending-file-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--ms-radius-sm);
  background: color-mix(in srgb, var(--ms-accent) 12%, transparent);
  color: var(--ms-accent, #2ea25e);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.pending-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.pending-label {
  font-size: 12.5px;
  color: var(--ms-text, #1c2733);
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pending-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--ms-fs-xs);
  color: var(--ms-muted, #7b8a96);
}

/* Тонкая полоса прогресса загрузки вложения */
.pending-bar {
  display: block;
  width: 100%;
  min-width: 96px;
  height: 3px;
  margin-top: 1px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ms-accent) 18%, transparent);
  overflow: hidden;
}

.pending-bar-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--ms-accent, #2ea25e);
  transition: width 0.2s linear;
}

.pending-spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--ms-accent, #2ea25e);
  border-top-color: transparent;
  animation: pending-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes pending-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
