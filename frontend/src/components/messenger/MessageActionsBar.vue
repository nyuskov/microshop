<template>
  <div
    v-if="rowVisible"
    ref="barRef"
    class="msg-actions"
    :class="{ dismissed }"
    @click.stop
    @pointerdown.stop
  >
    <!-- Быстрые реакции — первой строкой панели, как в Телеграме: самый частый
         жест без открывания палитры. Полный набор — за кнопкой «Реакция». -->
    <div class="quick-row" role="group" aria-label="Быстрые реакции">
      <button
        v-for="emoji in QUICK_REACTIONS"
        :key="emoji"
        class="quick-emoji"
        :class="{ active: hasMyReaction(message, emoji) }"
        :title="`Реакция ${emoji}`"
        @click="onQuickReaction(emoji)"
      >
        {{ emoji }}
      </button>
    </div>
    <div class="bar-row">
      <button
        class="round-btn"
        :class="{ active: emojiPickerOpen }"
        title="Все реакции"
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
    </div>

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
      <button v-if="canOpenImage" class="more-item" @click="onOpenImage">
        <q-icon :name="icon('image')" size="16px" />
        <span>{{ openImageLabel }}</span>
      </button>
      <button v-if="isOwn && message.text" class="more-item" @click="onEdit">
        <q-icon :name="icon('edit')" size="16px" />
        <span>Редактировать</span>
      </button>
      <!-- Одноразовое вложение не сохраняем и не превращаем в стикер: это
           копия содержимого, а оно живёт до первого просмотра. -->
      <button v-if="canSave && !message.view_once" class="more-item" @click="onSave">
        <q-icon :name="icon('bookmark')" size="16px" />
        <span>Сохранить в Сохранённые</span>
      </button>
      <button class="more-item" @click="onRemind">
        <q-icon :name="icon('notifications')" size="16px" />
        <span>{{ hasReminder ? 'Изменить напоминание' : 'Напомнить' }}</span>
      </button>
      <!-- Перевод — только у текста (переводить вложение нечем) и только там,
           где он вообще возможен: без встроенного переводчика браузера пункта
           нет вовсе (см. `canOfferTranslation`). Подпись меняется по состоянию
           (переводим — можно отменить, готово — скрыть). -->
      <button v-if="message.text && canTranslate" class="more-item" @click="onTranslate">
        <q-icon :name="icon('translate')" size="16px" />
        <span>{{ translationLabel || 'Перевести' }}</span>
      </button>
      <button v-if="canMakeSticker && !message.view_once" class="more-item" @click="onMakeSticker">
        <q-icon :name="icon('add_reaction')" size="16px" />
        <span>В стикеры</span>
      </button>
      <!-- «Добавить весь набор» — как «Добавить стикеры» в Телеграме: у стикера
           из предустановленного набора, которого у человека ещё нет. -->
      <button v-if="canAddSet" class="more-item" @click="emit('add-set')">
        <q-icon :name="icon('add')" size="16px" />
        <span>Добавить набор{{ addSetTitle ? ` «${addSetTitle}»` : '' }}</span>
      </button>
      <!-- Жалоба на чужое сообщение — требование RuStore для UGC-приложений. -->
      <button v-if="!isOwn" class="more-item" @click="onReport">
        <q-icon :name="icon('flag')" size="16px" />
        <span>Пожаловаться</span>
      </button>
      <!-- Удалить можно и чужое — тогда «у себя» (выбор области в диалоге). -->
      <button class="more-item danger" @click="onDelete">
        <q-icon :name="icon('delete')" size="16px" />
        <span>{{ isOwn ? 'Удалить' : 'Удалить у себя' }}</span>
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
 * Панель действий с сообщением: тап по сообщению (и наведение мышью на
 * компьютере) показывает её под пузырём. Внутри — быстрые реакции, «Все
 * реакции», ответ, пересылка и «Ещё» с остальными действиями.
 *
 * Раньше на телефоне эти действия жили в отдельном листе по удержанию, а
 * удержание занималось выделением. Владелец: «это меню по долгому тапу не
 * нужно» — лист убран, панель осталась единственным путём к действиям, поэтому
 * она открывается и нажатием (браузер сам применяет `:hover` к элементу после
 * тапа). Палитра реакций — состояние представления (`emojiPickerOpen`): её
 * открывают и панель, и двойной тап.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { Message } from '@/types'
import { icon } from '@/utils/icons'
import { haptic } from '@/utils/haptics'
import { isStickerMessage } from '@/utils/media'
import {
  REACTION_EMOJIS,
  QUICK_REACTIONS,
  hasMyReaction,
  rememberQuickReaction
} from '@/utils/reactions'

const props = defineProps<{
  /** Сообщение, к которому относится панель. */
  message: Message
  /** Это моё сообщение (полный набор действий в меню). */
  isOwn: boolean
  /** Можно ли сохранить сообщение в «Сохранённые». */
  canSave: boolean
  /** Можно ли сделать из сообщения стикер (только открытая картинка). */
  canMakeSticker?: boolean
  /** У стикера из предустановленного набора, которого у человека ещё нет. */
  canAddSet?: boolean
  /**
   * Есть картинка, которую можно открыть отдельно. Нужно прежде всего СТИКЕРУ:
   * тап по нему теперь открывает набор, а посмотреть саму картинку больше негде.
   */
  canOpenImage?: boolean
  /** Название этого набора — попадает в подпись пункта меню. */
  addSetTitle?: string
  /** Стоит ли напоминание об этом сообщении (меняет подпись пункта меню). */
  hasReminder?: boolean
  /**
   * Подпись пункта «Перевести» по состоянию перевода: пусто — «Перевести»,
   * «Перевод…» — идёт, «Скрыть перевод» — готовый перевод или ошибка.
   */
  translationLabel?: string
  /**
   * Предлагать ли перевод: в браузерах без встроенного переводчика (телефон,
   * WebView приложения, Safari) пункта нет — см. `canOfferTranslation`.
   */
  canTranslate: boolean
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
  (e: 'add-set'): void
  /** «Открыть как картинку»: показать вложение крупно (лайтбокс). */
  (e: 'open-image'): void
  (e: 'delete'): void
  (e: 'report'): void
  (e: 'toggle-pin'): void
  /** «Напомнить»: выбрать время напоминания о сообщении. */
  (e: 'remind'): void
  /** «Перевести»: перевести текст сообщения (или убрать перевод). */
  (e: 'translate'): void
}>()

/** Открыто ли меню «Ещё» (остальные действия). */
const moreOpen = ref(false)

/**
 * Панель погашена после действия (реакция выбрана) или после ухода человека.
 *
 * На телефоне браузер оставляет `:hover` на сообщении после нажатия, поэтому
 * панель продолжала бы висеть поверх соседних сообщений. Владелец: «надо,
 * когда быструю реакцию нажал, чтобы меню закрывалось», «нажал реакцию — панель
 * не скрывается».
 *
 * Правило `dismissed` сильнее `.msg:hover .msg-actions`, поэтому на компьютере
 * гашение снимается, как только курсор вышел из области панели — иначе панель
 * переставала показываться при наведении и открывалась только нажатием
 * («теперь кликать надо на сообщение, чтобы заработало меню?»). Снимает его
 * `MessageRow::onHoverMove`.
 */
const dismissed = ref(false)

/**
 * Погасить панель: после реакции, прокрутки или ухода фокуса она не нужна.
 *
 * Кроме класса снимаем фокус с кнопки панели: `.msg:focus-within .msg-actions`
 * держало панель открытой и после того, как человек ушёл (мышь в поле ввода,
 * другое сообщение, шапка). Замер: клик по реакции → фокус на кнопке-эмодзи,
 * мышь ушла в поле ввода → `hovered: false`, а `opacity: 1.00` — панель висела
 * («увод фокуса не закрывает панель»). Чужой фокус (поле ввода) не трогаем.
 */
const dismiss = () => {
  moreOpen.value = false
  dismissed.value = true
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.closest('.msg-actions')) focused.blur()
}

/** Вернуть панель: человек снова нажал на сообщение или повёл по нему мышью. */
const reveal = () => {
  dismissed.value = false
}

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

/**
 * Выбор эмодзи: запомнить, отдать реакцию и погасить панель.
 *
 * Палитру реакций закрывает родитель: при успешной реакции он сам сбрасывает
 * `emojiPickerFor` (см. `toggleReaction` в Messenger).
 */
const onPickEmoji = (emoji: string) => {
  moreOpen.value = false
  rememberQuickReaction(emoji)
  haptic()
  emit('toggle-reaction', emoji)
  dismiss()
}

/** Быстрая реакция прямо из панели: палитру не открываем. */
const onQuickReaction = (emoji: string) => {
  onPickEmoji(emoji)
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

const onRemind = () => {
  moreOpen.value = false
  emit('remind')
}

const onTranslate = () => {
  moreOpen.value = false
  emit('translate')
}

/**
 * «Открыть как картинку» для стикера: стикер в ленте — это картинка, но тап по
 * нему открывает набор.
 */
const openImageLabel = computed<string>(() =>
  isStickerMessage(props.message) ? 'Открыть как картинку' : 'Открыть изображение'
)

const onOpenImage = () => {
  moreOpen.value = false
  emit('open-image')
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

defineExpose({ closeFloating, reveal, dismiss })
</script>

<style scoped>
/* Действия при наведении (и по тапу на телефоне) — панель прижата к НИЖНЕМУ
   краю сообщения. Зазора НЕТ (top:100%), иначе при опускании мыши панель
   пропадала бы. Визуальный отступ и «мост» для курсора даёт прозрачная
   верхняя кромка.

   Панель — два ряда: сверху быстрые реакции, снизу кнопки. В один ряд с
   восемью эмодзи она не влезала в 390px и вылезала за край пузыря. */
.msg-actions {
  position: absolute;
  top: 100%;
  background: var(--ms-surface);
  background-clip: padding-box;
  border-radius: 18px;
  box-shadow: var(--ms-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  z-index: 5;
}

.bar-row {
  display: flex;
  gap: 2px;
}

/* Быстрые реакции: компактнее кнопок, без подложки — эмодзи сами читаются */
.quick-row {
  display: flex;
  gap: 1px;
}

.quick-emoji {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.quick-emoji:hover {
  background: var(--ms-hover);
}

.quick-emoji.active {
  background: var(--ms-accent-soft);
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

/* Панель погашена после выбранной реакции.
 *
 * На телефоне `:hover` от тапа остаётся на сообщении — без этого правила панель
 * висела бы и дальше, перекрывая соседние сообщения. Специфичность выше, чем у
 * `.msg:hover .msg-actions`, поэтому правило надёжно побеждает. */
.msg .msg-actions.dismissed {
  opacity: 0;
  pointer-events: none;
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

/* Телефон: панель показывается по наведению — как на компьютере, — но с
 * задержкой.
 *
 * На тач-устройстве `:hover` появляется в самом начале касания, и жест прокрутки
 * успевал показать панель и тут же её погасить (прокрутка гасит панель,
 * см. `hideMessageActions`) — владелец: «мелькает, просто на миллисекунды
 * появляется». Задержка на появление это убирает: прокрутка гасит панель раньше,
 * чем она успевает проявиться, а касание с задержкой на сообщении показывает её
 * как обычно. Само гашение остаётся мгновенным — иначе панель успевала бы
 * мигнуть уже ПОСЛЕ прокрутки. */
@media (pointer: coarse) {
  .msg:hover .msg-actions,
  .msg:focus-within .msg-actions {
    transition: opacity 0.12s ease 0.1s;
  }

  .msg .msg-actions.dismissed {
    transition: none;
  }
}
</style>
