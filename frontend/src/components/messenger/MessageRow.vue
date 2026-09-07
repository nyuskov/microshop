<template>
  <div
    class="msg"
    :class="[isOwn ? 'out' : 'in', { 'msg-highlight': highlighted }]"
    :data-message-id="message.id"
  >
    <div class="msg-bubble" :class="{ 'round-video-only': isRoundVideoOnly(message) }">
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
      <template v-if="message.file">
        <a
          v-if="isImageFile(message.file)"
          class="attachment"
          :href="mediaAbsolute(message.file.url)"
          :download="message.file.name"
          target="_blank"
          rel="noopener"
        >
          <img
            :src="mediaAbsolute(message.file.url)"
            :alt="message.file.name"
            class="attachment-image"
            loading="lazy"
          />
        </a>
        <RoundVideoMessage
          v-else-if="isRecordedVideoMessage(message.file)"
          :src="mediaAbsolute(message.file.url)"
          :name="message.file.name"
          :size="message.file.size"
        />
        <video
          v-else-if="isVideoFile(message.file)"
          class="attachment-video"
          :src="mediaAbsolute(message.file.url)"
          controls
          preload="metadata"
          @click.stop
        ></video>
        <AudioMessage
          v-else-if="isAudioFile(message.file)"
          :src="mediaAbsolute(message.file.url)"
          :name="message.file.name"
          :size="message.file.size"
        />
        <a
          v-else
          class="attachment"
          :href="mediaAbsolute(message.file.url)"
          :download="message.file.name"
          target="_blank"
          rel="noopener"
        >
          <span class="attachment-card">
            <i :class="fileIcon(message.file)"></i>
            <span class="attachment-info">
              <span class="attachment-name">{{ message.file.name }}</span>
              <span class="attachment-meta">{{ formatBytes(message.file.size) }}</span>
            </span>
          </span>
        </a>
      </template>

      <span v-if="message.text" class="msg-text">{{ message.text }}</span>

      <span class="msg-meta">
        <span v-if="message.edited_at" class="msg-edited" title="изменено">изменено</span>
        <span class="msg-time">{{ formatMsgTime(message.timestamp) }}</span>
        <span v-if="isOwn" class="msg-ticks" :class="{ read: message.is_read }">✓✓</span>
      </span>
    </div>

    <!-- Реакции -->
    <div v-if="message.reactions.length" class="reactions" @click.stop>
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

    <!-- Действия при наведении -->
    <div class="msg-actions" @click.stop>
      <button class="round-btn" title="Ответить" @click="emit('set-reply')">
        <i class="pi pi-reply"></i>
      </button>
      <button class="round-btn" title="Реакция" @click="emit('toggle-emoji-picker')">
        <i class="pi pi-face-smile"></i>
      </button>
      <button
        v-if="!message.is_pinned"
        class="round-btn"
        title="Закрепить"
        @click="emit('toggle-pin')"
      >
        <i class="pi pi-bookmark"></i>
      </button>
      <button v-else class="round-btn" title="Открепить" @click="emit('toggle-pin')">
        <i class="pi pi-bookmark-fill"></i>
      </button>
      <button class="round-btn" title="Копировать" @click="emit('copy')">
        <i class="pi pi-copy"></i>
      </button>
      <button
        v-if="isOwn && message.text"
        class="round-btn"
        title="Редактировать"
        @click="emit('edit')"
      >
        <i class="pi pi-pencil"></i>
      </button>
      <button class="round-btn" title="Переслать" @click="emit('forward')">
        <i class="pi pi-share-alt"></i>
      </button>
      <button v-if="isOwn" class="round-btn danger" title="Удалить" @click="emit('delete')">
        <i class="pi pi-trash"></i>
      </button>
    </div>

    <!-- Выбор эмодзи-реакции -->
    <div v-if="emojiPickerOpen" class="emoji-picker" @click.stop>
      <button
        v-for="emoji in REACTION_EMOJIS"
        :key="emoji"
        class="emoji-option"
        :class="{ active: hasMyReaction(message, emoji) }"
        @click="emit('toggle-reaction', emoji)"
      >
        {{ emoji }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '@/types'
import { mediaUrl } from '@/config'
import { formatBytes, formatMsgTime } from '@/utils/format'
import {
  fileIcon,
  isAudioFile,
  isImageFile,
  isRecordedVideoMessage,
  isRoundVideoOnly,
  isVideoFile
} from '@/utils/media'
import AudioMessage from '@/components/media/AudioMessage.vue'
import RoundVideoMessage from '@/components/media/RoundVideoMessage.vue'

export interface MessageQuote {
  name: string
  mine: boolean
  text: string
}

defineProps<{
  message: Message
  isOwn: boolean
  /** Подсветка при переходе к сообщению (из закреплённых/поиска). */
  highlighted: boolean
  /** Открыт ли выбор эмодзи-реакций для этой строки. */
  emojiPickerOpen: boolean
  /** Данные ответа-цитаты (null, если цитируемое сообщение не загружено). */
  quote: MessageQuote | null
}>()

const emit = defineEmits<{
  (e: 'quote-click'): void
  (e: 'toggle-emoji-picker'): void
  (e: 'set-reply'): void
  (e: 'toggle-reaction', emoji: string): void
  (e: 'toggle-pin'): void
  (e: 'copy'): void
  (e: 'edit'): void
  (e: 'forward'): void
  (e: 'delete'): void
}>()

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '👏', '🎉']

const mediaAbsolute = (path: string): string => mediaUrl(path)

const hasMyReaction = (message: Message, emoji: string): boolean =>
  message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)
</script>

<style scoped>
.msg {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 3px 0;
  max-width: 60%;
}

.msg.out {
  align-self: flex-end;
  align-items: flex-end;
}

.msg.in {
  align-self: flex-start;
  align-items: flex-start;
}

.msg-bubble {
  position: relative;
  padding: 7px 11px 6px;
  border-radius: 12px;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
  min-width: 70px;
}

.msg.out .msg-bubble {
  background: #dcf8c6;
  border-top-right-radius: 3px;
}

.msg.in .msg-bubble {
  background: #ffffff;
  border-top-left-radius: 3px;
}

/* Пузырь, где лежит только «кружок»-видеосообщение, — без фона и отступов */
.msg-bubble.round-video-only {
  background: transparent;
  box-shadow: none;
  padding: 2px;
}

.msg-text {
  display: block;
  color: #111;
  font-size: 14.5px;
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
  color: #8a98a3;
}

.msg-ticks {
  font-size: 12px;
  color: #99a7b1;
  letter-spacing: -4px; /* галки стоят плотнее друг к другу */
}

.msg-ticks.read {
  color: #3aa6e0;
}

.msg-edited {
  font-size: 11px;
  font-style: italic;
  opacity: 0.75;
  margin-right: 6px;
}

/* Ответ-цитата */
.reply-quote {
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.06);
  border-left: 3px solid #3aa6e0;
  border-radius: 6px;
  padding: 5px 9px;
  margin-bottom: 5px;
  cursor: pointer;
  min-width: 120px;
}

.msg.out .reply-quote {
  border-left-color: #3f9d56;
}

.quote-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #3aa6e0;
}

.quote-name.mine {
  color: #3f9d56;
}

.quote-text {
  font-size: 13px;
  color: #5c6a75;
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

.attachment-image {
  max-width: 300px;
  max-height: 260px;
  border-radius: 8px;
  display: block;
}

.attachment-video {
  max-width: 320px;
  max-height: 300px;
  border-radius: 8px;
  display: block;
  margin-bottom: 4px;
}

.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f4f6f8;
  border-radius: 8px;
  padding: 8px 12px;
  color: #2f3b44;
}

.attachment-card i {
  font-size: 1.6rem;
  color: #d4585e;
}

.attachment-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #141d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.attachment-meta {
  font-size: 12px;
  color: #8a98a3;
}

/* Общие круглые кнопки */
.round-btn {
  background: none;
  border: none;
  color: #5b6b79;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
}

.round-btn:hover {
  background: rgba(0, 0, 0, 0.07);
  color: #1d2731;
}

.round-btn.danger:hover {
  color: #d64545;
}

/* Действия при наведении */
.msg-actions {
  position: absolute;
  top: -14px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
  display: flex;
  gap: 2px;
  padding: 2px 4px;
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
  width: 28px;
  height: 28px;
  font-size: 0.9rem;
}

/* Реакции */
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.reaction-chip {
  border: 1px solid #e0e4e8;
  background: #ffffff;
  color: #43525d;
  font-size: 13px;
  border-radius: 14px;
  padding: 2px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.reaction-chip.mine {
  background: #d8efdd;
  border-color: #7cc48c;
}

.reaction-count {
  font-size: 11.5px;
  font-weight: 600;
}

/* Палитра эмодзи */
.emoji-picker {
  position: absolute;
  top: -46px;
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  z-index: 10;
}

.msg.in .emoji-picker {
  left: 4px;
}

.msg.out .emoji-picker {
  right: 4px;
}

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
  background: #f0f2f4;
  transform: scale(1.18);
}

.emoji-option.active {
  background: #e3f2e5;
}

/* Подсветка сообщения при переходе из закреплённых/поиска */
.msg-highlight .msg-bubble {
  animation: msg-highlight-pulse 2.4s ease 1;
}

@keyframes msg-highlight-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(46, 162, 94, 0);
  }
  15% {
    box-shadow: 0 0 0 3px var(--ms-accent, #2ea25e);
  }
  55% {
    box-shadow: 0 0 0 3px var(--ms-accent, #2ea25e);
  }
}
</style>
