<template>
  <div
    ref="containerRef"
    class="messages-scroll"
    @click="emit('background-click')"
    @scroll.passive="onScroll"
  >
    <div v-if="loading" class="chat-status">Загрузка сообщений…</div>
    <template v-else>
      <template
        v-for="(row, index) in rows"
        :key="row.kind === 'day' ? 'd' + index : row.message.id"
      >
        <div v-if="row.kind === 'day'" class="day-divider">
          <span>{{ row.label }}</span>
        </div>
        <MessageRow
          v-else
          :message="row.message"
          :is-own="row.message.user_id === currentUserId"
          :viewer-id="currentUserId"
          :highlighted="highlightedMessageId === row.message.id"
          :emoji-picker-open="emojiPickerFor === row.message.id"
          :quote="quoteOf(row.message)"
          :selection-mode="selectionMode"
          :selected="selectedMessageIds.includes(row.message.id)"
          :selectable="row.message.kind !== 'call'"
          @quote-click="emit('quote-click', row.message)"
          @select-start="emit('select-start', row.message)"
          @toggle-select="emit('toggle-select', row.message)"
          @toggle-emoji-picker="emit('toggle-emoji-picker', row.message)"
          @set-reply="emit('set-reply', row.message)"
          @toggle-reaction="emit('toggle-reaction', row.message, $event)"
          @toggle-pin="emit('toggle-pin', row.message)"
          @copy="emit('copy', row.message)"
          @edit="emit('edit', row.message)"
          @forward="emit('forward', row.message)"
          @save="emit('save', row.message)"
          @delete="emit('delete', row.message)"
          @open-image="emit('open-image', row.message)"
        />
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
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { Message } from '@/types'
import type { MessageRow as ThreadRow } from '@/utils/thread'
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
}>()

const emit = defineEmits<{
  (e: 'background-click'): void
  (e: 'reach-top'): void
  (e: 'quote-click', message: Message): void
  (e: 'select-start', message: Message): void
  (e: 'toggle-select', message: Message): void
  (e: 'toggle-emoji-picker', message: Message): void
  (e: 'set-reply', message: Message): void
  (e: 'toggle-reaction', message: Message, emoji: string): void
  (e: 'toggle-pin', message: Message): void
  (e: 'copy', message: Message): void
  (e: 'edit', message: Message): void
  (e: 'forward', message: Message): void
  (e: 'save', message: Message): void
  (e: 'delete', message: Message): void
  (e: 'open-image', message: Message): void
}>()

const containerRef = ref<HTMLElement | null>(null)

const onScroll = () => {
  const container = containerRef.value
  if (container && container.scrollTop < 80) emit('reach-top')
}

const scrollToBottom = () => {
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight
  }
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
  if (containerRef.value) {
    containerRef.value.scrollTop = containerRef.value.scrollHeight
  }
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
.messages-scroll {
  flex: 1;
  min-height: 0; /* чтобы лента скроллилась внутри, а не растягивала панель */
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
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
