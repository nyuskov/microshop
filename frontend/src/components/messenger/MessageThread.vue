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
          @quote-click="emit('quote-click', row.message)"
          @toggle-emoji-picker="emit('toggle-emoji-picker', row.message)"
          @set-reply="emit('set-reply', row.message)"
          @toggle-reaction="emit('toggle-reaction', row.message, $event)"
          @toggle-pin="emit('toggle-pin', row.message)"
          @copy="emit('copy', row.message)"
          @edit="emit('edit', row.message)"
          @forward="emit('forward', row.message)"
          @delete="emit('delete', row.message)"
        />
      </template>
      <div v-if="!rows.length" class="chat-status">Сообщений пока нет. Напишите первым!</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Message } from '@/types'
import type { MessageRow as ThreadRow } from '@/utils/thread'
import MessageRow from '@/components/messenger/MessageRow.vue'

interface MessageQuote {
  name: string
  mine: boolean
  text: string
}

defineProps<{
  rows: ThreadRow[]
  loading: boolean
  currentUserId: number | null
  highlightedMessageId: number | null
  emojiPickerFor: number | null
  /** Резолвит данные ответа-цитаты для строки (null — цитата не загружена). */
  quoteOf: (message: Message) => MessageQuote | null
}>()

const emit = defineEmits<{
  (e: 'background-click'): void
  (e: 'reach-top'): void
  (e: 'quote-click', message: Message): void
  (e: 'toggle-emoji-picker', message: Message): void
  (e: 'set-reply', message: Message): void
  (e: 'toggle-reaction', message: Message, emoji: string): void
  (e: 'toggle-pin', message: Message): void
  (e: 'copy', message: Message): void
  (e: 'edit', message: Message): void
  (e: 'forward', message: Message): void
  (e: 'delete', message: Message): void
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
</script>

<style scoped>
.messages-scroll {
  flex: 1;
  overflow-y: auto;
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
</style>
