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
        <q-icon :name="icon('close')" size="20px" />
      </button>
    </div>

    <!-- Цитата ответа -->
    <div v-if="replyTarget" class="reply-bar">
      <div class="reply-bar-info">
        <span class="reply-bar-name">{{ replyBarName }}</span>
        <span class="reply-bar-text">{{ messageSnippet(replyTarget) }}</span>
      </div>
      <button class="icon-btn" title="Отменить ответ" @click="emit('clear-reply')">
        <q-icon :name="icon('close')" size="20px" />
      </button>
    </div>

    <VoiceRecorderBar
      v-if="voiceRecOpen"
      @cancel="emit('voice-cancel')"
      @send="(payload) => emit('voice-send', payload)"
    />
    <div v-else class="input-row">
      <button
        v-if="!hasText"
        class="round-btn"
        title="Прикрепить файл"
        @click="attachInput?.click()"
      >
        <q-icon :name="icon('attach_file')" size="20px" />
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
        @keydown="onTextKeydown"
        @input="onTextInput"
        @click="updateMentions"
      ></textarea>
      <button
        class="round-btn"
        :class="{ active: extrasPanel !== 'none' }"
        title="Эмодзи и GIF"
        @click="emit('toggle-extras')"
      >
        <q-icon :name="icon('sentiment_satisfied_alt')" size="20px" />
      </button>
      <span v-if="!hasText" class="mic-wrap">
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
          <q-icon :name="icon(recordMode === 'video' ? 'videocam' : 'mic')" size="20px" />
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
        <q-icon :name="icon('send')" size="18px" />
      </button>

      <!-- Подсказка упоминаний: набрали @ — выбираем участника группы -->
      <div v-if="mentionOpen && mentionMatches.length" class="mention-panel" role="listbox">
        <button
          v-for="(member, index) in mentionMatches"
          :key="member.id"
          type="button"
          role="option"
          :aria-selected="index === mentionIndex"
          class="mention-item"
          :class="{ active: index === mentionIndex }"
          @mousedown.prevent="pickMention(member)"
        >
          <span class="mention-avatar" :style="avatarStyle(displayName(member))">
            <img
              v-if="avatarUrlOf(member)"
              :src="avatarUrlOf(member)"
              class="mention-avatar-img"
              alt=""
            />
            <template v-else>{{ initials(displayName(member)) }}</template>
          </span>
          <span class="mention-text">
            <span class="mention-name">{{ displayName(member) }}</span>
            <span class="mention-username">@{{ member.username }}</span>
          </span>
        </button>
      </div>

      <div v-if="extrasPanel !== 'none'" class="extras-menu">
        <div class="extras-tabs">
          <button
            type="button"
            class="extras-tab"
            :class="{ active: extrasPanel === 'emoji' }"
            @click="emit('set-extras-tab', 'emoji')"
          >
            Эмодзи
          </button>
          <button
            type="button"
            class="extras-tab"
            :class="{ active: extrasPanel === 'gif' }"
            @click="emit('set-extras-tab', 'gif')"
          >
            GIF
          </button>
        </div>
        <div v-if="extrasPanel === 'emoji'" class="emoji-panel">
          <!-- Категории: недавние + группы по смыслу -->
          <div class="emoji-cats" role="tablist" aria-label="Категории эмодзи">
            <button
              v-for="tab in emojiTabs"
              :key="tab.key"
              type="button"
              class="emoji-cat"
              :class="{ active: emojiTab === tab.key }"
              role="tab"
              :aria-selected="emojiTab === tab.key"
              @click="emojiTab = tab.key"
            >
              {{ tab.title }}
            </button>
          </div>
          <p v-if="!emojiItems.length" class="emoji-hint">
            Здесь появятся те, что вы выбирали последними.
          </p>
          <div v-else class="extras-grid">
            <button
              v-for="emoji in emojiItems"
              :key="emoji"
              class="emoji-option"
              @click="pickEmoji(emoji)"
            >
              {{ emoji }}
            </button>
          </div>
        </div>
        <div v-else-if="extrasPanel === 'gif' && chatId !== null" class="extras-gif">
          <GifPicker
            :chat-id="chatId"
            :reply-to-id="replyTarget?.id ?? null"
            @sent="emit('gif-sent')"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { icon } from '@/utils/icons'
import { computed, nextTick, ref, watch } from 'vue'
import type { ChatUser, Message } from '@/types'
import { messageSnippet } from '@/utils/media'
import { applyMention, mentionBeforeCaret } from '@/utils/mentions'
import { avatarStyle, avatarUrlOf, displayName, initials } from '@/utils/user'
import { EMOJI_GROUPS, EMOJI_RECENT_KEY, readRecentEmoji, rememberEmoji } from '@/utils/emoji'
import VoiceRecorderBar from '@/components/media/VoiceRecorderBar.vue'
import GifPicker from '@/components/media/GifPicker.vue'
import type { RecordedMedia } from '@/services/recorder'

const props = defineProps<{
  chatId: number | null
  sending: boolean
  sendError: string
  replyTarget: Message | null
  /** Название в шапке цитаты ответа (вычисляется родителем). */
  replyBarName: string
  editingMessage: Message | null
  /** Единое меню доп.контента: 'emoji' | 'gif' (открыто) либо 'none'. */
  extrasPanel: 'none' | 'emoji' | 'gif'
  voiceRecOpen: boolean
  recordMode: 'audio' | 'video'
  micHolding: boolean
  recordModeHint: string
  /**
   * Участники группового чата для подсказки упоминаний (пусто — подсказки нет:
   * в личном чате упоминать некого).
   */
  mentionMembers?: ChatUser[]
}>()

// Текст в поле ввода (v-model) изменяется в композере.
const newMessage = defineModel<string>('newMessage', { required: true })

/** Есть ли текст в поле (для скрытия кнопок файла/микрофона при наборе). */
const hasText = computed(() => newMessage.value.trim().length > 0)

// ---------- Эмодзи: недавние + категории ----------
const emojiRecent = ref<string[]>(readRecentEmoji(globalThis.localStorage))
const emojiTab = ref<string>(emojiRecent.value.length ? 'recent' : EMOJI_GROUPS[0].key)
const emojiTabs = computed(() => [
  { key: 'recent', title: 'Недавние', items: emojiRecent.value },
  ...EMOJI_GROUPS
])
const emojiItems = computed(
  () => emojiTabs.value.find((tab) => tab.key === emojiTab.value)?.items ?? []
)

/** Вставляет эмодзи и запоминает его для раздела «Недавние». */
const pickEmoji = (emoji: string) => {
  emojiRecent.value = rememberEmoji(emojiRecent.value, emoji)
  try {
    globalThis.localStorage?.setItem(EMOJI_RECENT_KEY, JSON.stringify(emojiRecent.value))
  } catch {
    // Приватный режим/переполнение — не мешаем отправке сообщения.
  }
  emit('append-emoji', emoji)
}

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
  (e: 'toggle-extras'): void
  (e: 'set-extras-tab', tab: 'emoji' | 'gif'): void
  (e: 'gif-sent'): void
  (e: 'append-emoji', emoji: string): void
}>()

const attachInput = ref<HTMLInputElement | null>(null)

const onFileSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('file-selected', file)
}

// ---------- Ввод с клавиатуры ----------
// Десктоп: Enter — отправка, Shift+Enter — новая строка.
// Мобильный (тач): Enter виртуальной клавиатуры вставляет перевод строки,
// отправить можно кнопкой «Отправить» (как в Telegram/WhatsApp).
const isTouchPrimary = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(pointer: coarse)').matches

const onTextKeydown = (event: KeyboardEvent) => {
  // Подсказка упоминаний перехватывает навигацию и выбор участника.
  if (mentionOpen.value && mentionMatches.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const count = mentionMatches.value.length
      mentionIndex.value = (mentionIndex.value + delta + count) % count
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      pickMention(mentionMatches.value[mentionIndex.value])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      mentionOpen.value = false
      return
    }
  }
  if (event.key !== 'Enter') return
  // Shift+Enter — перенос строки (браузер делает сам), не перехватываем.
  if (event.shiftKey) return
  // Тач-устройства: Enter = перевод строки (не отправка).
  if (isTouchPrimary()) return
  event.preventDefault()
  emit('send-text')
}

// ---------- Упоминания участников (@логин) ----------
/** Сколько подсказок показываем разом. */
const MENTION_LIMIT = 6

const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionStart = ref(0)
const mentionIndex = ref(0)

/** Подходящие участники: ищем по логину и имени, себя не предлагаем. */
const mentionMatches = computed<ChatUser[]>(() => {
  const members = props.mentionMembers ?? []
  if (members.length === 0) return []
  const query = mentionQuery.value.toLowerCase()
  const matches = members.filter((member) => {
    if (!member.username) return false
    if (!query) return true
    return (
      member.username.toLowerCase().includes(query) ||
      displayName(member).toLowerCase().includes(query)
    )
  })
  return matches.slice(0, MENTION_LIMIT)
})

/** Пересчитать подсказку по текущему тексту и позиции курсора. */
const updateMentions = () => {
  if ((props.mentionMembers ?? []).length === 0) {
    mentionOpen.value = false
    return
  }
  const input = textInputRef.value
  if (!input) return
  const found = mentionBeforeCaret(newMessage.value, input.selectionStart ?? 0)
  if (!found) {
    mentionOpen.value = false
    return
  }
  mentionQuery.value = found.query
  mentionStart.value = found.start
  mentionIndex.value = 0
  mentionOpen.value = true
}

/** Вставить выбранный логин вместо набранного `@...` и вернуть курсор в конец. */
const pickMention = (member: ChatUser) => {
  const input = textInputRef.value
  const caret = input?.selectionStart ?? newMessage.value.length
  const next = applyMention(newMessage.value, mentionStart.value, caret, member.username)
  newMessage.value = next.text
  mentionOpen.value = false
  void nextTick(() => {
    input?.focus()
    input?.setSelectionRange(next.caret, next.caret)
    autoGrow()
  })
}

const onTextInput = () => {
  autoGrow()
  updateMentions()
}

// Закрываем подсказку при выходе из режима ввода/смене чата.
watch(
  () => [props.chatId, props.editingMessage?.id] as const,
  () => {
    mentionOpen.value = false
  }
)

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
  font-size: calc(15px * var(--ms-text-scale, 1));
  line-height: 1.35;
  background: transparent;
  padding: 7px 4px;
  color: #141d26;
  resize: none;
  overflow-y: auto;
  min-height: 24px;
  max-height: 140px;
  font-family: inherit;
  /* Прячем скроллбар поля: иначе после набора рядом со смайлом остаётся
     серая вертикальная полоса (прокрутка при этом сохраняется). */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.text-input::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
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

/* Единое меню «Эмодзи / GIF» (над строкой ввода) */
/* Подсказка упоминаний: список участников над полем ввода */
.mention-panel {
  position: absolute;
  bottom: 58px;
  left: 10px;
  right: 10px;
  max-width: min(420px, calc(100vw - 28px));
  max-height: 46vh;
  overflow-y: auto;
  z-index: 30;
  padding: 6px;
  border-radius: 14px;
  background: var(--ms-surface, #fff);
  border: 1px solid var(--ms-border, #e2e6ea);
  box-shadow: var(--ms-shadow-float, 0 6px 20px -8px rgba(15, 23, 42, 0.3));
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ms-text, #1c2733);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mention-item.active,
.mention-item:hover {
  background: var(--ms-surface-2, #eef1f4);
}

.mention-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.mention-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mention-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mention-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mention-username {
  font-size: 12px;
  color: var(--ms-muted, #71808d);
}

.extras-menu {
  position: absolute;
  bottom: 58px;
  right: 14px;
  width: min(360px, calc(100vw - 28px));
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  padding: 8px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.extras-tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  border-bottom: 1px solid #eef0f2;
  padding-bottom: 6px;
}

.extras-tab {
  flex: 1;
  border: none;
  background: transparent;
  border-radius: 9px;
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #5b6b79;
  cursor: pointer;
}

.extras-tab.active {
  background: #e3f2e5;
  color: #1e9b51;
}

/* Категории эмодзи: «Недавние» + группы по смыслу. */
.emoji-cats {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: none;
}

.emoji-cats::-webkit-scrollbar {
  display: none;
}

.emoji-cat {
  flex: 0 0 auto;
  padding: 3px 9px;
  border: none;
  border-radius: 10px;
  background: var(--ms-surface-2);
  color: var(--ms-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.emoji-cat.active {
  background: var(--ms-accent-soft);
  color: var(--ms-accent);
  font-weight: 600;
}

.emoji-hint {
  margin: 6px 2px;
  font-size: 12px;
  color: var(--ms-muted);
}

.extras-grid {
  display: grid;
  grid-template-columns: repeat(8, 32px);
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}

/* GIF внутри единого меню: выключаем собственное абсолютное позиционирование */
.extras-menu :deep(.gif-picker) {
  position: static;
  bottom: auto;
  right: auto;
  width: 100%;
  max-width: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
  z-index: auto;
  max-height: 260px;
  overflow-y: auto;
}

.extras-menu :deep(.gif-picker-inner) {
  max-height: none;
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
