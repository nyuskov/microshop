<template>
  <div class="select-field" :class="[`v-${variant}`, { 'is-open': open, 'is-disabled': disabled }]">
    <!-- Кнопка-«поле»: показывает выбранное значение и открывает список. Родной
         `<select>` тут не годится — его окно рисует браузер, и в WebView оно
         открывается системным окошком далеко от поля (жалоба 15.09.2026). -->
    <button
      :id="id"
      ref="triggerRef"
      class="sf-trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-activedescendant="open && highlight >= 0 ? optionId(highlight) : undefined"
      :aria-label="ariaLabel"
      :disabled="disabled"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="sf-value" :class="{ 'is-empty': !current }">
        {{ current ? current.label : placeholder }}
      </span>
      <q-icon :name="icon('expand_more')" size="18px" aria-hidden="true" />
    </button>

    <!-- Слой списка. По умолчанию — в body: внутри прокручиваемой карточки
         (профиль, панель звонка) его обрезал бы её `overflow`, а так координаты
         считаем сами. НО если поле лежит внутри диалога Quasar, слой остаётся
         внутри этого диалога: у `q-dialog` включён фокус-трап, и при фокусе
         снаружи он возвращает его себе — поле поиска из-за этого выглядело
         «только для чтения» (жалоба владельца 22.09.2026). -->
    <Teleport :to="teleportTarget">
      <div
        v-if="open"
        ref="layerRef"
        class="sf-layer"
        :class="`v-${variant}`"
        :style="layerStyle"
        @pointerdown.stop
      >
        <input
          v-if="searchable"
          ref="searchRef"
          v-model="query"
          class="sf-search"
          type="text"
          :placeholder="t('Поиск')"
          :aria-label="t('Поиск по списку')"
          @keydown="onKeydown"
        />
        <ul :id="listId" class="sf-list" role="listbox" :aria-label="ariaLabel">
          <li v-for="(option, index) in visibleOptions" :key="option.value">
            <button
              :id="optionId(index)"
              type="button"
              class="sf-option"
              :class="{
                'is-active': index === highlight,
                'is-selected': option.value === modelValue
              }"
              role="option"
              :aria-selected="option.value === modelValue"
              @click="pick(option)"
              @mousemove="highlight = index"
            >
              <span class="sf-option-label">{{ option.label }}</span>
              <q-icon
                v-if="option.value === modelValue"
                :name="icon('check')"
                size="16px"
                aria-hidden="true"
              />
            </button>
          </li>
        </ul>
        <p v-if="!visibleOptions.length" class="sf-empty">{{ t('Ничего не найдено') }}</p>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { icon } from '@/utils/icons'
import { t } from '@/i18n'
import {
  filterOptions,
  indexOfValue,
  moveHighlight,
  placeLayer,
  type SelectOption,
  type SelectValue
} from '@/utils/select'

/**
 * Выпадающий список на своих кнопках — замена родному `<select>` и `<datalist>`.
 *
 * Список — не «модалка»: он открывается под полем (см. utils/select.ts), а
 * подписи/варианты приходят пропом, поэтому компонент общий: профиль (язык,
 * страна), панель звонка (камера, микрофон, динамик).
 *
 * Доступность — паттерн combobox: фокус остаётся на кнопке, подсвеченный вариант
 * объявлен через `aria-activedescendant`, стрелки/Home/End/Enter/Escape работают
 * с клавиатуры. Вариант выбирается кликом или Enter.
 *
 * Значение — строка или число (тихие часы передают минуты от полуночи): тип
 * значения обязан совпадать с тем, что в модели, иначе подсветка выбранного
 * варианта не сработает.
 */
const props = withDefaults(
  defineProps<{
    modelValue: SelectValue
    options: SelectOption[]
    /** Пусто — «Ничего не выбрано» (значение ''). */
    placeholder?: string
    /** Подпись для скринридеров (если рядом нет видимого label). */
    ariaLabel?: string
    /** Показывать поле поиска (длинные списки: страны). */
    searchable?: boolean
    disabled?: boolean
    /** Оформление: поле формы или стеклянная панель звонка. */
    variant?: 'field' | 'call'
    /** id кнопки — чтобы работал `<label for="…">`. */
    id?: string
  }>(),
  { placeholder: t('Не выбрано'), variant: 'field' }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: SelectValue): void }>()

const triggerRef = ref<HTMLButtonElement | null>(null)
const layerRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)

/** Куда телепортировать слой: `body` или контейнер диалога (см. шаблон). */
const teleportTarget = ref<string | HTMLElement>('body')

const open = ref(false)
const query = ref('')
const highlight = ref(-1)
const box = ref({ top: 0, left: 0, width: 0, maxHeight: 240 })

const uid = useId()
const listId = `sf-list-${uid}`
const optionId = (index: number): string => `sf-opt-${uid}-${index}`

const current = computed(() => props.options.find((option) => option.value === props.modelValue))
const visibleOptions = computed(() => filterOptions(props.options, query.value))

const layerStyle = computed(() => ({
  top: `${box.value.top}px`,
  left: `${box.value.left}px`,
  width: `${box.value.width}px`,
  maxHeight: `${box.value.maxHeight}px`
}))

/** Сколько места просим у списка: по варианту на строку + поиск. */
const desiredHeight = computed(() => props.options.length * 38 + (props.searchable ? 44 : 10))

const place = () => {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  box.value = placeLayer(
    { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    { width: window.innerWidth, height: window.innerHeight },
    desiredHeight.value
  )
}

const closeMenu = (focusTrigger = false) => {
  if (!open.value) return
  open.value = false
  query.value = ''
  if (focusTrigger) triggerRef.value?.focus()
}

const openMenu = async () => {
  if (props.disabled || open.value) return
  // Куда рисовать слой — решаем ДО его появления: внутри диалога Quasar иначе
  // фокус-трап диалога забирает фокус у поля поиска (см. шаблон).
  const dialog = triggerRef.value?.closest<HTMLElement>('[aria-modal="true"], .q-dialog')
  teleportTarget.value = dialog ?? 'body'
  query.value = ''
  highlight.value = Math.max(0, indexOfValue(props.options, props.modelValue))
  place()
  open.value = true
  if (props.searchable) {
    await nextTick()
    searchRef.value?.focus()
  }
}

const toggle = () => (open.value ? closeMenu() : void openMenu())

const pick = (option: SelectOption) => {
  emit('update:modelValue', option.value)
  closeMenu(true)
}

/** Прокрутка к подсвеченному варианту (стрелками можно уйти ниже видимой части). */
const revealHighlight = async () => {
  await nextTick()
  const el = document.getElementById(optionId(highlight.value))
  el?.scrollIntoView({ block: 'nearest' })
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (open.value) {
      event.stopPropagation()
      closeMenu(true)
    }
    return
  }
  if (event.key === 'Tab') {
    closeMenu()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) {
      void openMenu()
      return
    }
    highlight.value = moveHighlight(
      highlight.value,
      visibleOptions.value.length,
      event.key === 'ArrowDown' ? 1 : -1
    )
    void revealHighlight()
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    if (!open.value) return
    event.preventDefault()
    highlight.value = event.key === 'Home' ? 0 : visibleOptions.value.length - 1
    void revealHighlight()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    // В поиске пробел — часть запроса, а не выбор варианта.
    if (props.searchable && event.key === ' ') return
    event.preventDefault()
    if (!open.value) {
      void openMenu()
      return
    }
    const option = visibleOptions.value[highlight.value]
    if (option) pick(option)
  }
}

// Фильтр меняет список — подсветку возвращаем на первый вариант.
watch(query, () => {
  highlight.value = visibleOptions.value.length ? 0 : -1
})

/**
 * Пока список открыт, следим за страницей: клик мимо закрывает его, а прокрутка
 * или изменение размера окна — тоже (иначе слой «отклеивался» бы от поля).
 * Прокрутка самого списка не считается: событие приходит с элемента внутри слоя.
 *
 * Отдельный случай — фокус в поле поиска: клик по нему браузер сопровождает
 * прокруткой контейнера к полю (и, на телефоне, показом экранной клавиатуры с
 * `resize`). Раньше список в этот момент закрывался, и поиск выглядел «некликабельным»
 * (жалоба владельца 22.09.2026). Если фокус уже внутри слоя — не закрываем.
 */
const focusIsInsideLayer = (): boolean => {
  const active = document.activeElement
  return Boolean(active && layerRef.value?.contains(active))
}

const onPointerDownOutside = (event: PointerEvent) => {
  const target = event.target as Node | null
  if (!target) return
  if (triggerRef.value?.contains(target) || layerRef.value?.contains(target)) return
  closeMenu()
}

const onViewportChange = (event?: Event) => {
  if (!open.value) return
  if (event?.target instanceof Node && layerRef.value?.contains(event.target)) return
  if (focusIsInsideLayer()) {
    // Клавиатура/фокус сдвинули экран — список не закрываем, но слой должен
    // остаться под полем, поэтому координаты пересчитываем.
    place()
    return
  }
  closeMenu()
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onPointerDownOutside, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
  } else {
    document.removeEventListener('pointerdown', onPointerDownOutside, true)
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('scroll', onViewportChange, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDownOutside, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<style scoped>
.select-field {
  width: 100%;
  min-width: 0;
}

/* Вид кнопки-поля — как у полей форм в приложении (.field input в профиле и
   поля приглашений): та же высота, рамка и радиус, чтобы список не выбивался
   из формы. */
.sf-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14.5px;
  text-align: left;
  color: var(--ms-text-strong);
  background: var(--ms-surface);
  border: 1.5px solid var(--ms-border);
  border-radius: var(--ms-radius-md);
  cursor: pointer;
}

.sf-trigger:focus-visible {
  outline: 2px solid var(--ms-accent);
  outline-offset: 1px;
}

.sf-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-value.is-empty {
  color: var(--ms-muted-2);
}

/* Слой списка: позицию и ширину задаёт utils/select.ts::placeLayer. */
.sf-layer {
  position: fixed;
  z-index: 6100; /* выше диалогов Quasar (6000) */
  /*
   * Если слой лежит внутри q-dialog (нужно, чтобы focus-trap диалога не
   * выдёргивал фокус из поиска), он наследует pointer-events: none от
   * .q-dialog.no-pointer-events — и тогда по списку нельзя кликнуть.
   */
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  padding: 6px;
  background: var(--ms-surface);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-lg);
  box-shadow: var(--ms-shadow-pop);
}

.sf-search {
  width: 100%;
  margin-bottom: 4px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--ms-text);
  background: var(--ms-surface-2);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius-sm);
}

.sf-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  min-height: 0;
}

.sf-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  font-family: inherit;
  font-size: 13.5px;
  text-align: left;
  color: var(--ms-text);
  background: transparent;
  border: 0;
  border-radius: var(--ms-radius-sm);
  cursor: pointer;
}

.sf-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-option.is-active {
  background: var(--ms-hover);
}

.sf-option.is-selected {
  color: var(--ms-accent);
  font-weight: 600;
}

.sf-empty {
  margin: 0;
  padding: 10px;
  font-size: 12.5px;
  color: var(--ms-muted-2);
}
</style>
