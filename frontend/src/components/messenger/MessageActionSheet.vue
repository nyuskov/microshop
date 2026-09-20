<template>
  <!-- Лист действий.
       На телефоне меню по наведению (.msg-actions в MessageRow) недоступно,
       поэтому все действия и реакции живут здесь: удержание УЖЕ ВЫДЕЛЕННОГО
       сообщения открывает лист (первое удержание выделяет, второе — показывает
       действия), с клавиатуры — Shift+F10/клавиша «Меню». Правым кликом мышью и
       сенсорным долгим нажатием лист НЕ открывается (см. openContextFromEvent):
       у мыши те же действия есть в «⋯» при наведении, а на телефоне системное
       contextmenu открывало его случайно. -->
  <Teleport to="body">
    <div v-if="ctxOpen" class="ctx-layer" @click="close">
      <div
        ref="ctxRef"
        class="ctx-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Действия с сообщением"
        tabindex="-1"
        :style="ctxStyle"
        @click.stop
        @contextmenu.prevent
      >
        <!-- Быстрые реакции (пока не раскрыт полный набор) -->
        <div v-if="selectable && !ctxAllEmoji" class="ctx-reactions">
          <button
            v-for="emoji in QUICK_REACTIONS"
            :key="emoji"
            class="ctx-emoji"
            :class="{ active: hasMyReaction(message, emoji) }"
            :title="`Поставить реакцию ${emoji}`"
            @click="pickCtxEmoji(emoji)"
          >
            {{ emoji }}
          </button>
        </div>

        <!-- Полный набор реакций — по запросу, чтобы лист не был громоздким -->
        <div v-if="selectable && ctxAllEmoji" class="ctx-reactions wide">
          <button
            v-for="emoji in REACTION_EMOJIS"
            :key="emoji"
            class="ctx-emoji"
            :class="{ active: hasMyReaction(message, emoji) }"
            :title="`Поставить реакцию ${emoji}`"
            @click="pickCtxEmoji(emoji)"
          >
            {{ emoji }}
          </button>
        </div>

        <button v-if="selectable" class="ctx-item" @click="ctxAction('reply')">
          <q-icon :name="icon('reply')" size="18px" />
          <span>Ответить</span>
        </button>
        <button v-if="!message.view_once" class="ctx-item" @click="ctxAction('forward')">
          <q-icon :name="icon('forward')" size="18px" />
          <span>Переслать</span>
        </button>
        <button v-if="message.text" class="ctx-item" @click="ctxAction('copy')">
          <q-icon :name="icon('content_copy')" size="18px" />
          <span>Копировать</span>
        </button>
        <button class="ctx-item" @click="ctxAllEmoji = !ctxAllEmoji">
          <q-icon :name="icon(ctxAllEmoji ? 'expand_less' : 'add_reaction')" size="18px" />
          <span>{{ ctxAllEmoji ? 'Скрыть лишние' : 'Все реакции' }}</span>
        </button>
        <button class="ctx-item" @click="ctxAction('pin')">
          <q-icon :name="icon('push_pin')" size="18px" />
          <span>{{ message.is_pinned ? 'Открепить' : 'Закрепить' }}</span>
        </button>
        <button v-if="canSave && !message.view_once" class="ctx-item" @click="ctxAction('save')">
          <q-icon :name="icon('bookmark')" size="18px" />
          <span>Сохранить в Сохранённые</span>
        </button>
        <button class="ctx-item" @click="ctxAction('remind')">
          <q-icon :name="icon('notifications')" size="18px" />
          <span>{{ hasReminder ? 'Изменить напоминание' : 'Напомнить' }}</span>
        </button>
        <!-- Перевод — только у текста (переводить вложение нечем) и только там,
             где он возможен: без встроенного переводчика пункта нет вовсе.
             Подпись по состоянию: пусто — «Перевести», идёт — «Перевод…»,
             готово — «Скрыть перевод». -->
        <button
          v-if="message.text && canTranslate"
          class="ctx-item"
          @click="ctxAction('translate')"
        >
          <q-icon :name="icon('translate')" size="18px" />
          <span>{{ translationLabel || 'Перевести' }}</span>
        </button>
        <!-- Стикер тапом открывает набор, поэтому посмотреть саму картинку
             можно только отсюда. -->
        <button v-if="canOpenImage" class="ctx-item" @click="ctxAction('image')">
          <q-icon :name="icon('image')" size="18px" />
          <span>{{ openImageLabel }}</span>
        </button>
        <button
          v-if="canMakeSticker && !message.view_once"
          class="ctx-item"
          @click="ctxAction('sticker')"
        >
          <q-icon :name="icon('add_reaction')" size="18px" />
          <span>В стикеры</span>
        </button>
        <!-- «Добавить весь набор» — как «Добавить стикеры» в Телеграме. -->
        <button v-if="canAddSet" class="ctx-item" @click="ctxAction('add-set')">
          <q-icon :name="icon('add')" size="18px" />
          <span>Добавить набор{{ addSetTitle ? ` «${addSetTitle}»` : '' }}</span>
        </button>
        <button v-if="isOwn && message.text" class="ctx-item" @click="ctxAction('edit')">
          <q-icon :name="icon('edit')" size="18px" />
          <span>Редактировать</span>
        </button>
        <button v-if="!isOwn" class="ctx-item" @click="ctxAction('report')">
          <q-icon :name="icon('flag')" size="18px" />
          <span>Пожаловаться</span>
        </button>
        <!-- Удалить можно и чужое — тогда «у себя» (выбор области в диалоге). -->
        <button class="ctx-item danger" @click="ctxAction('delete')">
          <q-icon :name="icon('delete')" size="18px" />
          <span>{{ isOwn ? 'Удалить' : 'Удалить у себя' }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Лист действий с сообщением (мобильный аналог меню по наведению).
 *
 * Открывается удержанием уже выделенного сообщения (телефон) или с клавиатуры
 * (Shift+F10); держит фокус внутри (модальный слой), подгоняет положение под края
 * экрана и показывает быстрые реакции с возможностью раскрыть полный набор.
 *
 * Лист на ленту должен быть один: после перерисовки соседних строк на экране
 * оставалось два меню — поэтому закрывалка открытого листа хранится на уровне
 * модуля (общая для всех строк).
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Message } from '@/types'
import { icon } from '@/utils/icons'
import { haptic, HAPTIC_HOLD } from '@/utils/haptics'
import { isStickerMessage } from '@/utils/media'
import {
  QUICK_REACTIONS,
  REACTION_EMOJIS,
  hasMyReaction,
  rememberQuickReaction
} from '@/utils/reactions'
import { focusableElements, useFocusTrap } from '@/composables/useFocusTrap'
import { menuFocusTarget } from '@/utils/menu'

const props = defineProps<{
  /** Сообщение, над которым открыт лист. */
  message: Message
  /** Это моё сообщение (полный набор действий). */
  isOwn: boolean
  /** Можно ли сохранить сообщение в «Сохранённые». */
  canSave: boolean
  /** Можно ли сделать из сообщения стикер (только открытая картинка). */
  canMakeSticker?: boolean
  /** У стикера из предустановленного набора, которого у человека ещё нет. */
  canAddSet?: boolean
  /**
   * Есть картинка, которую можно открыть отдельно. Нужно прежде всего СТИКЕРУ:
   * тап по нему открывает набор, а посмотреть саму картинку больше негде.
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
  /** Доступны ли реакции и «ответить» (у служебных сообщений — нет). */
  selectable: boolean
  /** Режим выделения: в нём лист не нужен. */
  selectionMode: boolean
  /** Открыта палитра над сообщением: лист в этом случае закрываем. */
  emojiPickerOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-reaction', emoji: string): void
  (e: 'set-reply'): void
  (e: 'forward'): void
  (e: 'copy'): void
  (e: 'edit'): void
  (e: 'save'): void
  /** «В стикеры»: картинка уходит в свои стикеры. */
  (e: 'make-sticker'): void
  /** «Открыть как картинку»: показать вложение крупно (лайтбокс). */
  (e: 'open-image'): void
  (e: 'add-set'): void
  (e: 'delete'): void
  (e: 'report'): void
  (e: 'toggle-pin'): void
  /** «Напомнить»: выбрать время напоминания о сообщении. */
  (e: 'remind'): void
  /** «Перевести»: перевести текст сообщения (или убрать перевод). */
  (e: 'translate'): void
}>()

const ctxOpen = ref(false)
const ctxAllEmoji = ref(false)
const ctxReady = ref(false)
/**
 * Лист действий — модальный слой: фокус переносим внутрь, держим там и
 * возвращаем на место при закрытии. Ждём `ctxReady`: пока лист скрыт
 * (`visibility: hidden`), фокус в него не поставить.
 */
const { container: ctxRef } = useFocusTrap(() => ctxOpen.value && ctxReady.value)
/** Точка нажатия — от неё считаем положение листа. */
const ctxAnchor = ref({ x: 0, y: 0 })
/** Текущее (подогнанное под экран) положение листа. */
const ctxPos = ref({ x: 0, y: 0 })

const ctxStyle = computed<Record<string, string>>(() => ({
  left: `${ctxPos.value.x}px`,
  top: `${ctxPos.value.y}px`,
  // Пока не подогнали под границы экрана — не показываем, чтобы не «прыгало».
  visibility: ctxReady.value ? 'visible' : 'hidden'
}))

/**
 * Подогнать лист действий под границы экрана.
 *
 * Вызывается и при открытии, и после раскрытия полного набора реакций (лист
 * становится выше и иначе ушёл бы за нижний край).
 */
const placeContext = async (): Promise<void> => {
  await nextTick()
  const el = ctxRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const { x, y } = ctxAnchor.value
  ctxPos.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
  }
  ctxReady.value = true
}

/**
 * Закрывалка уже открытого листа действий.
 *
 * Состояние модульное (общее для всех строк): лист на ленту должен быть один,
 * иначе после перерисовки соседних сообщений на экране остаются два меню.
 */
let currentCtxCloser: (() => void) | null = null

/** Открыть лист действий в точке нажатия. */
const openAt = async (x: number, y: number): Promise<void> => {
  if (!props.selectable) return
  currentCtxCloser?.()
  currentCtxCloser = close
  haptic(HAPTIC_HOLD)
  ctxAllEmoji.value = false
  ctxReady.value = false
  ctxAnchor.value = { x, y }
  ctxPos.value = { x, y }
  ctxOpen.value = true
  await placeContext()
}

const close = (): void => {
  if (currentCtxCloser === close) currentCtxCloser = null
  ctxOpen.value = false
}

/** Открыт ли лист (нужно представлению: повторное удержание его закрывает). */
const isOpen = (): boolean => ctxOpen.value

/** Реакция из листа действий. */
const pickCtxEmoji = (emoji: string): void => {
  rememberQuickReaction(emoji)
  emit('toggle-reaction', emoji)
  close()
}

/**
 * «Открыть как картинку» для стикера: стикер в ленте — картинка, но тап по нему
 * открывает набор, поэтому просмотр живёт в меню.
 */
const openImageLabel = computed<string>(() =>
  isStickerMessage(props.message) ? 'Открыть как картинку' : 'Открыть изображение'
)

/** Действие из листа: закрываем лист и повторяем обычный emit. */
const ctxAction = (
  action:
    | 'reply'
    | 'forward'
    | 'copy'
    | 'pin'
    | 'save'
    | 'sticker'
    | 'add-set'
    | 'image'
    | 'remind'
    | 'translate'
    | 'edit'
    | 'report'
    | 'delete'
): void => {
  close()
  if (action === 'reply') emit('set-reply')
  else if (action === 'forward') emit('forward')
  else if (action === 'copy') emit('copy')
  else if (action === 'pin') emit('toggle-pin')
  else if (action === 'save') emit('save')
  else if (action === 'sticker') emit('make-sticker')
  else if (action === 'add-set') emit('add-set')
  else if (action === 'image') emit('open-image')
  else if (action === 'remind') emit('remind')
  else if (action === 'translate') emit('translate')
  else if (action === 'edit') emit('edit')
  else if (action === 'report') emit('report')
  else emit('delete')
}

/** Esc закрывает лист действий, стрелки — переход по пунктам и реакциям. */
const onCtxKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    close()
    return
  }
  const root = ctxRef.value
  if (!root) return
  const items = focusableElements(root)
  const target = menuFocusTarget(
    event.key,
    items.indexOf(document.activeElement as HTMLElement),
    items.length
  )
  if (target === null) return
  event.preventDefault()
  items[target].focus()
}

watch(ctxOpen, (open) => {
  if (open) window.addEventListener('keydown', onCtxKeydown)
  else {
    window.removeEventListener('keydown', onCtxKeydown)
    ctxAllEmoji.value = false
    ctxReady.value = false
  }
})

// Раскрыли полный набор реакций — лист стал выше, пересчитываем положение.
watch(ctxAllEmoji, () => {
  if (ctxOpen.value) void placeContext()
})

// Перешли в режим выделения (например, из другого сообщения) — лист не нужен.
watch(
  () => props.selectionMode,
  (on) => {
    if (on) close()
  }
)

// Открыли меню по наведению — лист действий закрываем, чтобы не было двух меню.
watch(
  () => props.emojiPickerOpen,
  (open) => {
    if (open) close()
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onCtxKeydown))

defineExpose({ openAt, close, isOpen })
</script>

<style scoped>
.ctx-layer {
  position: fixed;
  inset: 0;
  z-index: 4200;
  background: var(--ms-scrim-soft);
}

.ctx-menu {
  position: fixed;
  min-width: 232px;
  max-width: min(300px, calc(100vw - 16px));
  padding: 6px;
  border-radius: 14px;
  background: var(--ms-surface, #fff);
  border: 1px solid var(--ms-border, #e2e6ea);
  box-shadow: var(--ms-shadow-float, 0 6px 20px -8px rgba(15, 23, 42, 0.3));
  color: var(--ms-text, #1c2733);
}

.ctx-reactions {
  display: grid;
  /* `minmax(0, 1fr)`, а не `1fr`: у `1fr` минимум = min-content самой эмодзи,
     поэтому ряд шире карточки и последняя реакция уезжает за край экрана
     (проверено на 390/360/320 px). Ноль в минимуме разрешает колонкам сжиматься. */
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 2px;
  padding: 2px 2px 6px;
  border-bottom: 1px solid var(--ms-hairline, rgba(15, 23, 42, 0.08));
  margin-bottom: 4px;
}

/* Полный набор реакций — 6 в ряд, чтобы лист не растягивался по высоте */
.ctx-reactions.wide {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.ctx-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  min-width: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease;
}

/* Телефон: реакции — самые частые тапы в листе, 32 px по высоте для пальца
   мало (у пунктов списка ниже высота ≈ 40 px). */
@media (max-width: 600px) {
  .ctx-emoji {
    height: 40px;
  }
}

.ctx-emoji:hover,
.ctx-emoji:focus-visible {
  background: var(--ms-surface-2, #eef1f4);
}

.ctx-emoji.active {
  background: var(--ms-accent-soft, rgba(46, 162, 94, 0.16));
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}

.ctx-item:hover,
.ctx-item:focus-visible {
  background: var(--ms-surface-2, #eef1f4);
}

.ctx-item.danger {
  color: var(--ms-danger);
}
</style>
