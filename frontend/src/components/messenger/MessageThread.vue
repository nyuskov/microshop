<template>
  <div class="thread-wrap">
    <div
      ref="containerRef"
      class="messages-scroll"
      @click="emit('background-click')"
      @scroll.passive="onScroll"
    >
      <!-- Скелетоны вместо текста «Загрузка сообщений…»: показываем структуру ленты -->
      <div v-if="loading" class="skeleton-list" aria-busy="true">
        <span class="sr-only">Загрузка сообщений…</span>
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
        <template
          v-for="(row, index) in rows"
          :key="row.kind === 'day' ? 'd' + index : row.message.id"
        >
          <div v-if="row.kind === 'day'" class="day-divider">
            <span>{{ row.label }}</span>
          </div>
          <template v-else>
            <div
              v-if="unreadDividerId === row.message.id"
              class="unread-divider"
              data-unread-divider
            >
              <span>Непрочитанные сообщения</span>
            </div>
            <MessageRow
              :message="row.message"
              :is-own="row.message.user_id === currentUserId"
              :viewer-id="currentUserId"
              :highlighted="highlightedMessageId === row.message.id"
              :emoji-picker-open="emojiPickerFor === row.message.id"
              :quote="quoteOf(row.message)"
              :selection-mode="selectionMode"
              :selected="selectedMessageIds.includes(row.message.id)"
              :selectable="row.message.kind !== 'call'"
              :author-name="authorNameFor(row, index)"
              @quote-click="emit('quote-click', row.message)"
              @select-start="emit('select-start', row.message)"
              @toggle-select="emit('toggle-select', row.message)"
              @forwarder-click="emit('forwarder-click', row.message)"
              @toggle-emoji-picker="emit('toggle-emoji-picker', row.message)"
              @set-reply="emit('set-reply', row.message)"
              @toggle-reaction="emit('toggle-reaction', row.message, $event)"
              @toggle-pin="emit('toggle-pin', row.message)"
              @copy="emit('copy', row.message)"
              @edit="emit('edit', row.message)"
              @forward="emit('forward', row.message)"
              @save="emit('save', row.message)"
              @delete="emit('delete', row.message)"
              @report="emit('report', row.message)"
              @open-image="emit('open-image', row.message)"
            />
          </template>
        </template>
        <div v-for="p in pending ?? []" :key="p.localId" class="pending-row">
          <div class="pending-bubble">
            <img v-if="p.previewUrl" :src="p.previewUrl" class="pending-preview" alt="" />
            <q-icon v-else name="attach_file" class="pending-file-icon" size="16px" />
            <span class="pending-meta">
              <span class="pending-label">{{ p.label }}</span>
              <span class="pending-status">
                <span class="pending-spinner" aria-hidden="true"></span>
                Отправка…
              </span>
            </span>
          </div>
        </div>
        <div v-if="!rows.length && (pending ?? []).length === 0" class="chat-status">
          <EmptyState compact title="Сообщений пока нет. Напишите первым!" />
        </div>
      </template>
    </div>

    <!-- Кнопка «вниз»: появляется, когда лента прокручена вверх -->
    <button
      v-if="showJumpDown"
      type="button"
      class="jump-down"
      :class="{ 'has-new': hasNewBelow }"
      :title="hasNewBelow ? 'Новые сообщения' : 'Вниз'"
      :aria-label="hasNewBelow ? 'Перейти к новым сообщениям' : 'Прокрутить вниз'"
      @click="onJumpDown"
    >
      <q-icon name="arrow_downward" size="20px" aria-hidden="true" />
      <span v-if="hasNewBelow" class="jump-new" aria-hidden="true"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ChatUser, Message } from '@/types'
import type { MessageRow as ThreadRow } from '@/utils/thread'
import { displayName } from '@/utils/user'
import MessageRow from '@/components/messenger/MessageRow.vue'
import EmptyState from '@/components/common/EmptyState.vue'

interface MessageQuote {
  name: string
  mine: boolean
  text: string
}

/** Временный пузырь «Отправка…» (вложение ещё грузится на сервер). */
interface PendingUpload {
  localId: number
  label: string
  previewUrl?: string | null
}

const props = defineProps<{
  rows: ThreadRow[]
  loading: boolean
  currentUserId: number | null
  highlightedMessageId: number | null
  emojiPickerFor: number | null
  /** Резолвит данные ответа-цитаты для строки (null — цитата не загружена). */
  quoteOf: (message: Message) => MessageQuote | null
  /** Режим мультивыделения сообщений (long-press). */
  selectionMode: boolean
  /** Id выбранных сообщений. */
  selectedMessageIds: number[]
  /** Вложения, которые сейчас отправляются (показываются внизу ленты). */
  pending?: PendingUpload[]
  /** Групповой ли открытый чат (показываем имена авторов). */
  isGroupChat?: boolean
  /** Участники группы (для имён авторов сообщений). */
  members?: ChatUser[]
  /** Сколько сообщений было непрочитано в момент открытия чата (для разделителя). */
  unreadCount?: number
}>()

const emit = defineEmits<{
  (e: 'background-click'): void
  (e: 'reach-top'): void
  (e: 'quote-click', message: Message): void
  (e: 'select-start', message: Message): void
  (e: 'toggle-select', message: Message): void
  (e: 'forwarder-click', message: Message): void
  (e: 'toggle-emoji-picker', message: Message): void
  (e: 'set-reply', message: Message): void
  (e: 'toggle-reaction', message: Message, emoji: string): void
  (e: 'toggle-pin', message: Message): void
  (e: 'copy', message: Message): void
  (e: 'edit', message: Message): void
  (e: 'forward', message: Message): void
  (e: 'save', message: Message): void
  (e: 'delete', message: Message): void
  (e: 'report', message: Message): void
  (e: 'open-image', message: Message): void
}>()

const containerRef = ref<HTMLElement | null>(null)

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

const updateScrollState = () => {
  const container = containerRef.value
  if (!container) return
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight
  showJumpDown.value = distance > 320 || hasNewBelow.value
  if (distance < 60) hasNewBelow.value = false
}

const onJumpDown = () => {
  hasNewBelow.value = false
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
  if (!isNearBottom()) hasNewBelow.value = true
})

// Новый чат — сбрасываем подсказки прокрутки.
watch(
  () => props.unreadCount,
  () => {
    hasNewBelow.value = false
    showJumpDown.value = false
  }
)

// ---------- Имена авторов в групповых чатах ----------
// Показываем имя в начале «серии» сообщений собеседника: предыдущее сообщение
// от другого автора, разделитель дня или пауза > 5 минут.
const GROUP_BURST_MS = 5 * 60 * 1000

const authorNameFor = (row: ThreadRow, index: number): string => {
  if (!props.isGroupChat || row.kind !== 'message') return ''
  const message = row.message
  if (message.kind === 'call' || message.user_id === props.currentUserId) return ''
  const prev = index > 0 ? props.rows[index - 1] : null
  if (prev && prev.kind === 'message' && prev.message.user_id === message.user_id) {
    const gap = new Date(message.timestamp).getTime() - new Date(prev.message.timestamp).getTime()
    if (!Number.isNaN(gap) && gap < GROUP_BURST_MS) return ''
  }
  const member = props.members?.find((user) => user.id === message.user_id)
  return member ? displayName(member) : ''
}

const onScroll = () => {
  const container = containerRef.value
  if (container && container.scrollTop < 80) emit('reach-top')
  updateScrollState()
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
  const el = container.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null
  if (!el) return false
  const containerRect = container.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  container.scrollTop +=
    elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2
  return true
}

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

onMounted(() => {
  if (props.rows.length > 0) void scrollInitialToBottom()
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
  flex: 1;
  min-height: 0; /* чтобы лента скроллилась внутри, а не растягивала панель */
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
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
  border-radius: 12px;
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
  border-radius: 12px;
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

.jump-new {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ms-info, #3aa6e0);
  border: 2px solid var(--ms-surface, #fff);
}

.jump-down.has-new .jump-new {
  background: #fff;
  border-color: var(--ms-accent, #2ea25e);
}

.day-divider {
  display: flex;
  justify-content: center;
  margin: 10px 0;
}

.day-divider span {
  background: #ffffff;
  color: #60707c;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.chat-status {
  padding: 12px;
  text-align: center;
  color: #8a98a3;
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
  border-radius: 10px;
  flex-shrink: 0;
}

.pending-file-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(46, 162, 94, 0.12);
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
  font-size: 11.5px;
  color: var(--ms-muted, #7b8a96);
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
