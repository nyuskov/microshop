<template>
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
    <!-- Пересылку одноразового вложения не предлагаем: сервер её и так
         запрещает, а кнопка обещала бы недоступное. -->
    <button v-if="!message.view_once" class="round-btn" title="Переслать" @click="onForward">
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
      <button v-if="canMakeSticker" class="more-item" @click="onMakeSticker">
        <q-icon :name="icon('add_reaction')" size="16px" />
        <span>В стикеры</span>
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
</template>

<script setup lang="ts">
/**
 * Панель действий при наведении на сообщение: реакции, ответ, пересылка и меню
 * «Ещё» с остальными действиями.
 *
 * Живёт рядом с листом действий (`MessageActionSheet.vue`) — на телефоне меню по
 * наведению недоступно, поэтому там работает лист. Палитра реакций — состояние
 * представления (`emojiPickerOpen`): её открывают и панель, и лист, и двойной тап.
 */
import { nextTick, ref, watch } from 'vue'
import type { Message } from '@/types'
import { icon } from '@/utils/icons'
import { haptic } from '@/utils/haptics'
import { REACTION_EMOJIS, hasMyReaction, rememberQuickReaction } from '@/utils/reactions'

const props = defineProps<{
  /** Сообщение, к которому относится панель. */
  message: Message
  /** Это моё сообщение (полный набор действий в меню). */
  isOwn: boolean
  /** Можно ли сохранить сообщение в «Сохранённые». */
  canSave: boolean
  /** Можно ли сделать из сообщения стикер (только открытая картинка). */
  canMakeSticker?: boolean
  /** Открыта ли палитра реакций (состояние представления). */
  emojiPickerOpen: boolean
  /** Строка уже доходила до экрана — только тогда рисуем панель. */
  rowVisible: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-emoji-picker'): void
  (e: 'toggle-reaction', emoji: string): void
  (e: 'set-reply'): void
  (e: 'forward'): void
  (e: 'copy'): void
  (e: 'edit'): void
  (e: 'save'): void
  /** «В стикеры»: картинка уходит в свои стикеры. */
  (e: 'make-sticker'): void
  (e: 'delete'): void
  (e: 'report'): void
  (e: 'toggle-pin'): void
}>()

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

const onMakeSticker = () => {
  moreOpen.value = false
  emit('make-sticker')
}

const onDelete = () => {
  moreOpen.value = false
  emit('delete')
}

const onReport = () => {
  moreOpen.value = false
  emit('report')
}

defineExpose({ closeFloating })
</script>

<style scoped>
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
</style>
