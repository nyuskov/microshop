/**
 * Логика выпадающего списка (components/common/SelectField.vue) — чистые функции.
 *
 * Зачем свой список, а не родной: окно родного списка рисует браузер, и в WebView
 * (а также при нестандартном масштабе страницы) оно открывается системным окошком
 * далеко от поля — жалоба пользователя 15.09.2026 (сначала «Срок действия» в
 * приглашениях, затем «Страна», «Язык» и выбор устройств в звонке). Свой слой
 * позиционируется нами, поэтому всегда оказывается под полем.
 */

export type SelectValue = string | number

export interface SelectOption {
  value: SelectValue
  label: string
}

/** Индекс варианта с этим значением (-1 — нет такого). */
export const indexOfValue = (options: SelectOption[], value: SelectValue): number =>
  options.findIndex((option) => option.value === value)

/**
 * Следующий подсвеченный вариант по кругу.
 *
 * `current` = -1 («ничего не подсвечено»): вниз — первый, вверх — последний,
 * иначе с клавиатуры человек улетал бы «в никуда».
 */
export const moveHighlight = (current: number, count: number, delta: number): number => {
  if (count <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return (((current + delta) % count) + count) % count
}

/** Фильтр вариантов по запросу (для длинных списков: страны). */
export const filterOptions = (options: SelectOption[], query: string): SelectOption[] => {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter((option) => option.label.toLowerCase().includes(q))
}

export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export interface LayerBox {
  top: number
  left: number
  width: number
  maxHeight: number
}

/** Отступ слоя от поля. */
const GAP = 6
/** Минимальная и максимальная высота списка. */
const MIN_HEIGHT = 120
const MAX_HEIGHT = 320
/** Поля по краям экрана, чтобы слой не прилипал к границе. */
const EDGE = 8

/**
 * Где показать слой: под полем, а если снизу не хватает места — над ним.
 *
 * Ширина — не уже поля (подписи устройств и стран длинные), но и не шире экрана:
 * `left` поджимается к краям, иначе слой вылезал бы за окно.
 */
export const placeLayer = (
  anchor: AnchorRect,
  viewport: { width: number; height: number },
  desiredHeight: number
): LayerBox => {
  const below = viewport.height - (anchor.top + anchor.height) - GAP
  const above = anchor.top - GAP
  const showsBelow = below >= Math.min(desiredHeight, MAX_HEIGHT) || below >= above
  const room = showsBelow ? below : above
  const maxHeight = Math.max(MIN_HEIGHT, Math.min(desiredHeight, room, MAX_HEIGHT))
  const top = showsBelow
    ? anchor.top + anchor.height + GAP
    : Math.max(EDGE, anchor.top - GAP - maxHeight)
  const width = Math.max(Math.min(anchor.width, viewport.width - EDGE * 2), 180)
  const left = Math.min(Math.max(EDGE, anchor.left), Math.max(EDGE, viewport.width - width - EDGE))
  return { top, left, width, maxHeight }
}
