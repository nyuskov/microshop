<template>
  <div class="input-area">
    <div v-if="sendError" class="inline-error">{{ sendError }}</div>

    <!-- Редактирование сообщения -->
    <div v-if="editingMessage" class="reply-bar mode-bar">
      <div class="reply-bar-info">
        <span class="reply-bar-name">Редактирование</span>
        <span class="reply-bar-text">{{ editingMessage.text }}</span>
      </div>
      <button class="icon-btn" title="Отмена" @click="emit('cancel-edit')">
        <q-icon name="close" size="20px" />
      </button>
    </div>

    <!-- Цитата ответа -->
    <div v-if="replyTarget" class="reply-bar">
      <div class="reply-bar-info">
        <span class="reply-bar-name">{{ replyBarName }}</span>
        <span class="reply-bar-text">{{ messageSnippet(replyTarget) }}</span>
      </div>
      <button class="icon-btn" title="Отменить ответ" @click="emit('clear-reply')">
        <q-icon name="close" size="20px" />
      </button>
    </div>

    <VoiceRecorderBar
      v-if="voiceRecOpen"
      @cancel="emit('voice-cancel')"
      @send="(payload) => emit('voice-send', payload)"
    />
    <div v-else class="input-row">
      <button class="round-btn" title="Прикрепить файл" @click="attachInput?.click()">
        <q-icon name="attach_file" size="20px" />
      </button>
      <input
        ref="attachInput"
        class="hidden-file"
        type="file"
        aria-label="Прикрепить файл"
        @change="onFileSelected"
      />
      <textarea
        ref="textInputRef"
        v-model="newMessage"
        class="text-input"
        rows="1"
        placeholder="Сообщение"
        aria-label="Сообщение"
        @keydown.enter.exact.prevent="emit('send-text')"
        @input="autoGrow"
      ></textarea>
      <button class="round-btn" title="Эмодзи" @click="emit('toggle-emoji-menu')">
        <q-icon name="sentiment_satisfied_alt" size="20px" />
      </button>
      <button
        class="round-btn gif-btn"
        :class="{ active: gifPanelOpen }"
        title="GIF"
        @click="emit('toggle-gif')"
      >
        GIF
      </button>
      <span class="mic-wrap">
        <button
          class="round-btn mic-hold-btn"
          :class="{
            holding: micHolding,
            'mode-video': recordMode === 'video'
          }"
          :title="
            recordMode === 'video'
              ? 'Видеосообщение (нажмите). Удерживайте 2 секунды — голосовое'
              : 'Голосовое сообщение (нажмите). Удерживайте 2 секунды — видеосообщение'
          "
          :aria-label="
            recordMode === 'video'
              ? 'Записать видеосообщение. Удерживайте 2 секунды для голосового'
              : 'Записать голосовое сообщение. Удерживайте 2 секунды для видеосообщения'
          "
          @click="emit('mic-click')"
          @pointerdown="emit('mic-down')"
          @pointerup="emit('mic-up')"
          @pointerleave="emit('mic-up')"
          @pointercancel="emit('mic-cancel')"
          @contextmenu.prevent
        >
          <q-icon :name="recordMode === 'video' ? 'videocam' : 'mic'" size="20px" />
        </button>
        <span v-if="recordModeHint" class="record-mode-hint">{{ recordModeHint }}</span>
      </span>
      <button
        v-if="newMessage.trim()"
        class="send-btn"
        title="Отправить"
        :disabled="sending"
        @click="emit('send-text')"
      >
        <q-icon name="send" size="18px" />
      </button>

      <template v-if="gifPanelOpen && chatId !== null">
        <GifPicker
          :chat-id="chatId"
          :reply-to-id="replyTarget?.id ?? null"
          @sent="emit('gif-sent')"
        />
      </template>

      <div v-if="emojiMenuOpen" class="emoji-picker bottom">
        <button
          v-for="emoji in INPUT_EMOJIS"
          :key="emoji"
          class="emoji-option"
          @click="emit('append-emoji', emoji)"
        >
          {{ emoji }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Message } from '@/types'
import { messageSnippet } from '@/utils/media'
import VoiceRecorderBar from '@/components/media/VoiceRecorderBar.vue'
import GifPicker from '@/components/media/GifPicker.vue'
import type { RecordedMedia } from '@/services/recorder'

defineProps<{
  chatId: number | null
  sending: boolean
  sendError: string
  replyTarget: Message | null
  /** Название в шапке цитаты ответа (вычисляется родителем). */
  replyBarName: string
  editingMessage: Message | null
  emojiMenuOpen: boolean
  gifPanelOpen: boolean
  voiceRecOpen: boolean
  recordMode: 'audio' | 'video'
  micHolding: boolean
  recordModeHint: string
}>()

// Текст в поле ввода (v-model) изменяется в композере.
const newMessage = defineModel<string>('newMessage', { required: true })

const emit = defineEmits<{
  (e: 'send-text'): void
  (e: 'file-selected', file: File): void
  (e: 'cancel-edit'): void
  (e: 'clear-reply'): void
  (e: 'voice-cancel'): void
  (e: 'voice-send', payload: RecordedMedia): void
  (e: 'mic-down'): void
  (e: 'mic-up'): void
  (e: 'mic-cancel'): void
  (e: 'mic-click'): void
  (e: 'toggle-emoji-menu'): void
  (e: 'toggle-gif'): void
  (e: 'gif-sent'): void
  (e: 'append-emoji', emoji: string): void
}>()

const INPUT_EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '😎', '🤔', '👍', '👎', '❤️', '🔥']

const attachInput = ref<HTMLInputElement | null>(null)

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('file-selected', file)
}

// ---------- Авто-рост многострочного поля ----------
const textInputRef = ref<HTMLTextAreaElement | null>(null)
/** Максимальная высота поля ввода (пикселей) — примерно 6 строк. */
const TEXTAREA_MAX_HEIGHT = 140

const autoGrow = () => {
  const el = textInputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
}

// Сброс высоты при очистке/подстановке текста (например, после отправки).
watch(newMessage, () => {
  void nextTick(autoGrow)
})
</script>

<style scoped>
.input-area {
  padding: 10px 14px;
  background: #f0f2f5;
  border-top: 1px solid #e2e6ea;
  position: relative;
}

.round-btn.muted {
  color: #9aa7b2;
}

.inline-error {
  color: #d64545;
  font-size: 12px;
  padding: 6px 14px;
  background: #fdecec;
  margin-bottom: 6px;
}

/* Кнопка открытия панели GIF */
.gif-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.3px;
  color: var(--ms-accent, #2ea25e);
}

.gif-btn.active {
  background: #e3f2e5;
  color: #1e9b51;
}

/* Кнопка записи голосового/видеосообщения (удержание 2 c — переключение режима) */
.mic-wrap {
  position: relative;
  display: inline-flex;
}

.mic-hold-btn {
  position: relative;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.mic-hold-btn.holding,
.mic-hold-btn.mode-video {
  color: #2ea25e;
}

.mic-hold-btn.holding::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid #2ea25e;
  opacity: 0;
  animation: mic-hold-ring 2s ease-out forwards;
  pointer-events: none;
}

/* Подсказка о смене режима */
.record-mode-hint {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 26, 32, 0.85);
  color: #fff;
  padding: 4px 10px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  z-index: 12;
  animation: record-hint-pop 0.15s ease-out;
}

@keyframes record-hint-pop {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes mic-hold-ring {
  0% {
    opacity: 0.9;
    transform: scale(0.92);
  }
  100% {
    opacity: 0;
    transform: scale(1.6);
  }
}

.reply-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border-left: 3px solid #3aa6e0;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
}

.reply-bar-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.reply-bar-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #3aa6e0;
}

.reply-bar-text {
  font-size: 13px;
  color: #5c6a75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #ffffff;
  border-radius: 12px;
  padding: 5px 10px;
  position: relative;
}

.text-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  line-height: 1.35;
  background: transparent;
  padding: 7px 4px;
  color: #141d26;
  resize: none;
  overflow-y: auto;
  min-height: 24px;
  max-height: 140px;
  font-family: inherit;
}

.send-btn {
  background: #2ea25e;
  color: #fff;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
}

.send-btn:hover {
  background: #288e52;
}

.hidden-file {
  display: none;
}

/* Палитра эмодзи в поле ввода (расположена над строкой ввода) */
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

.emoji-picker.bottom {
  position: absolute;
  top: auto;
  bottom: 56px;
  right: 14px;
  left: auto;
}

/* ---------- Мобильная адаптация ---------- */
.input-area {
  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
}

@media (max-width: 420px) {
  .input-row {
    gap: 4px;
    padding: 4px 6px;
  }
  .round-btn {
    width: 30px;
    height: 30px;
  }
}
</style>
