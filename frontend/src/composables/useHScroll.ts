/**
 * Горизонтальная лента, которой можно управлять мышью и пальцем.
 *
 * Зачем общий composable: лент в приложении много (чипы фильтров, категории
 * эмодзи и стикеров, полоса историй, категории GIF, вкладки галереи), и в каждой
 * повторялась одна и та же беда — «элементы куда-то уходят, их не видно».
 * Свайп пальцем работал, а на веб-версии обычное колесо крутило список, а не
 * ленту; до правого края мышью было не добраться.
 *
 * Здесь собраны три способа: колесо (вертикальное переводим в горизонталь),
 * перетаскивание мышью и свайп (его браузер делает сам). Плюс края-затухания как
 * подсказка, что лента продолжается, и `reveal` — подкрутить активный элемент в
 * видимую часть.
 *
 * Чистая математика живёт в `utils/hScroll.ts` и покрыта тестами; здесь — DOM.
 */

import { onBeforeUnmount, onMounted, nextTick, ref, watch, type Ref } from 'vue'

import {
  canScrollX,
  DRAG_THRESHOLD_PX,
  dragScrollLeft,
  scrollEdges,
  wheelScrollLeft
} from '@/utils/hScroll'

export interface HScrollApi {
  /** Вешать на саму ленту: `<div ref="el" ...>`. */
  el: Ref<HTMLElement | null>
  /** Что скрыто за левым/правым краем (для затуханий). */
  edges: Ref<{ start: boolean; end: boolean }>
  /** Обработчики для разметки ленты. */
  onWheel: (event: WheelEvent) => void
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerUp: () => void
  /**
   * Был ли только что жест перетаскивания: по этому признаку вызывающий гасит
   * клик по элементу — «прокрутил» не должно значить «выбрал».
   */
  wasDragged: () => boolean
  /** Показывает элемент ленты (по селектору) в видимой части. */
  reveal: (selector: string) => void
  /** Пересчитать края (когда содержимое изменилось без прокрутки). */
  refresh: () => void
}

export function useHScroll(
  /** Следим за этим значением: длина списка изменилась — края пересчитываем. */
  itemsSource?: () => unknown
): HScrollApi {
  const el = ref<HTMLElement | null>(null)
  const edges = ref<{ start: boolean; end: boolean }>({ start: false, end: false })

  let dragStartX = 0
  let dragStartLeft = 0
  let dragging = false
  let suppressClick = false

  const refresh = () => {
    const node = el.value
    if (!node) return
    edges.value = scrollEdges(node)
  }

  const onWheel = (event: WheelEvent) => {
    const node = event.currentTarget as HTMLElement
    if (!canScrollX(node)) return
    node.scrollLeft = wheelScrollLeft(node, event.deltaX, event.deltaY)
  }

  const onPointerDown = (event: PointerEvent) => {
    // Перетаскивание — только мышью: на телефоне лента листается пальцем.
    if (event.pointerType !== 'mouse') return
    const node = el.value
    if (!node || !canScrollX(node)) return
    dragStartX = event.clientX
    dragStartLeft = node.scrollLeft
    dragging = false
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const node = el.value
    if (!node || event.buttons === 0) return
    const dx = event.clientX - dragStartX
    if (!dragging && Math.abs(dx) < DRAG_THRESHOLD_PX) return
    dragging = true
    suppressClick = true
    node.scrollLeft = dragScrollLeft(node, dragStartLeft, dx)
  }

  const onPointerUp = () => {
    dragging = false
    // Клик приходит сразу после pointerup: гасим его и снимаем флаг к следующему.
    if (suppressClick) window.setTimeout(() => (suppressClick = false), 0)
  }

  const wasDragged = (): boolean => suppressClick

  const reveal = (selector: string) => {
    const node = el.value
    if (!node) return
    node.querySelector<HTMLElement>(selector)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    })
  }

  onMounted(() => void nextTick(refresh))
  if (itemsSource) {
    // Наблюдатель ставим ВНУТРИ `onMounted`, а не в setup: `watch` вычисляет
    // источник сразу же, а источник обычно читает ref'ы, которые в
    // `<script setup>` объявлены НИЖЕ вызова `useHScroll` — тогда setup падает
    // с `Cannot access 'x' before initialization` (TDZ) и приложение показывает
    // фатальный экран. К моменту `onMounted` все объявления инициализированы.
    onMounted(() => {
      watch(itemsSource, () => void nextTick(refresh))
    })
  }
  onBeforeUnmount(() => {
    dragging = false
    suppressClick = false
  })

  return {
    el,
    edges,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    wasDragged,
    reveal,
    refresh
  }
}
