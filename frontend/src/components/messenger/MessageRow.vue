<template>
  <div v-if="message.kind === 'call'" class="msg msg-call" :data-message-id="message.id">
    <div class="call-note">
      <q-icon :name="callIcon" size="15px" aria-hidden="true" />
      <span>{{ callText }}</span>
    </div>
  </div>
  <div
    v-else
    class="msg"
    :class="[
      isOwn ? 'out' : 'in',
      { 'msg-highlight': highlighted, selection: selectionMode, selected }
    ]"
    :data-message-id="message.id"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <!-- Режим выделения: кружок-чек сбоку от пузыря -->
    <span
      v-if="selectionMode && selectable"
      class="row-selector"
      :class="{ on: selected }"
      aria-hidden="true"
    >
      <q-icon v-if="selected" name="check" size="15px" />
    </span>
    <!-- Режим выделения: клик по сообщению — отметить/снять -->
    <div
      v-if="selectionMode && selectable"
      class="msg-select-hit"
      @click.stop="onSelectClick"
    ></div>
    <div class="msg-bubble" :class="{ 'round-video-only': isRoundVideoOnly(message) }">
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
      <template v-if="message.file">
        <button
          v-if="isImageFile(message.file)"
          class="attachment attachment-image-btn"
          type="button"
          :title="`Открыть изображение «${message.file.name}»`"
          @click.stop="emit('open-image')"
        >
          <img
            :src="mediaAbsolute(message.file.url)"
            :alt="message.file.name"
            class="attachment-image"
            loading="lazy"
          />
        </button>
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
            <q-icon :name="fileIcon(message.file)" size="26px" />
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

    <!-- Действия при наведении (появляются ПОД сообщением) -->
    <div ref="barRef" class="msg-actions" @click.stop @pointerdown.stop>
      <button
        class="round-btn"
        :class="{ active: emojiPickerOpen }"
        title="Реакция"
        @click="onReaction"
      >
        <q-icon name="sentiment_satisfied_alt" size="20px" />
      </button>
      <button class="round-btn" title="Ответить" @click="onReply">
        <q-icon name="reply" size="20px" />
      </button>
      <button class="round-btn" title="Переслать" @click="onForward">
        <q-icon name="forward" size="20px" />
      </button>
      <button
        class="round-btn"
        :class="{ active: moreOpen }"
        title="Ещё"
        aria-haspopup="true"
        :aria-expanded="moreOpen"
        @click="toggleMore"
      >
        <q-icon name="more_horiz" size="20px" />
      </button>

      <!-- Остальные действия — в выпадающем меню -->
      <div v-if="moreOpen" class="more-menu" :class="{ up: popoverUp }" @click.stop>
        <button class="more-item" @click="onPin">
          <q-icon name="push_pin" size="16px" />
          <span>{{ message.is_pinned ? 'Открепить' : 'Закрепить' }}</span>
        </button>
        <button class="more-item" @click="onCopy">
          <q-icon name="content_copy" size="16px" />
          <span>Копировать</span>
        </button>
        <button v-if="isOwn && message.text" class="more-item" @click="onEdit">
          <q-icon name="edit" size="16px" />
          <span>Редактировать</span>
        </button>
        <button v-if="canSave" class="more-item" @click="onSave">
          <q-icon name="bookmark" size="16px" />
          <span>Сохранить в Сохранённые</span>
        </button>
        <button v-if="isOwn" class="more-item danger" @click="onDelete">
          <q-icon name="delete" size="16px" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Message } from '@/types'
import { mediaUrl } from '@/config'
import { avatarStyle, initials } from '@/utils/user'
import { formatBytes, formatMsgTime } from '@/utils/format'
import {
  callMessageIcon,
  callMessageText,
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
  (e: 'open-image'): void
}>()

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

const REACTION_EMOJIS = [
  '👍',
  '❤️',
  '🔥',
  '😂',
  '🤣',
  '😮',
  '😢',
  '😭',
  '😡',
  '🎉',
  '👏',
  '🙏',
  '🤔',
  '🤯',
  '🥰',
  '😍',
  '😎',
  '😴',
  '🤝',
  '💯',
  '👎',
  '❤️‍🔥'
]

const mediaAbsolute = (path: string): string => mediaUrl(path)

const hasMyReaction = (message: Message, emoji: string): boolean =>
  message.reactions.some((reaction) => reaction.reacted_by_me && reaction.emoji === emoji)

/** Текст и иконка системной отметки о звонке. */
const callText = computed<string>(() => callMessageText(props.message) ?? 'Звонок')
const callIcon = computed<string>(() => callMessageIcon(props.message))

/** «Сохранить» доступно для обычных сообщений (не для отметок о звонках). */
const canSave = computed<boolean>(() => props.message.kind !== 'call')

// ---------- Режим выделения сообщений (long-press; как в чатах) ----------
let holdTimer: number | null = null
let suppressNextSelect = false

const cancelHold = () => {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer)
    holdTimer = null
  }
}

const onPointerDown = (event: PointerEvent) => {
  if (props.selectionMode || !props.selectable) return
  if (event.button !== 0) return
  cancelHold()
  suppressNextSelect = false
  holdTimer = window.setTimeout(() => {
    holdTimer = null
    suppressNextSelect = true
    emit('select-start')
  }, 480)
}

const onPointerUp = () => {
  cancelHold()
}

const onPointerCancel = () => {
  cancelHold()
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
  color: #fff;
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

.attachment-image-btn {
  padding: 0;
  border: none;
  background: transparent;
  cursor: zoom-in;
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

/* Общие круглые кнопки (геометрия — в assets/appearance.css) */
.round-btn.danger:hover {
  color: #d64545;
}

/* Действия при наведении — панель прижата к НИЖНЕМУ краю сообщения.
   Зазора НЕТ (top:100%), иначе при опускании мыши панель пропадала бы.
   Визуальный отступ и «мост» для курсора даёт прозрачная верхняя кромка. */
.msg-actions {
  position: absolute;
  top: 100%;
  border-top: 5px solid transparent;
  background: #ffffff;
  background-clip: padding-box;
  border-radius: 18px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
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
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22);
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
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.24);
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
  color: #2f3b44;
  font-size: 13.5px;
  font-family: inherit;
  text-align: left;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
}

.more-item:hover {
  background: #f0f2f4;
}

.more-item.danger {
  color: #d64545;
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
  background: #f0f2f4;
  transform: scale(1.18);
}

.emoji-option.active {
  background: #e3f2e5;
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
  color: #ffffff;
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
