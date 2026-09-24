/**
 * Плавное раскрытие «слайдом вниз» для <Transition> (глобальный поиск и полоса
 * историй в шапке списка чатов).
 *
 * Почему не `max-height` из CSS: конечная высота задаётся «на глаз» (64px у
 * поиска, 360px у историй), а переход идёт не по реальной высоте содержимого —
 * сначала движение по пустому запасу, потом рывок в конце. Здесь высота
 * измеряется в пикселях ДО старта анимации и анимируется как есть, а кривая с
 * медленным хвостом (easeOutQuint) даёт мягкое торможение.
 *
 * ГРАБЛИ (обе ловились замером в браузере):
 * 1) Хуки объявлены ровно с ОДНИМ параметром. Vue считает переход «JS-переходом
 *    с ручным завершением», если у хука больше одного параметра, и в этом случае
 *    ждёт вызов `done` — а мы его не делаем. Для `leave` это означало бы, что
 *    панель так и не удалится из DOM. С одним параметром Vue сам завершает
 *    переход по `transitionend` (длительность берёт из CSS-класса `*-active`),
 *    поэтому время в CSS держим согласованным: 0.28s.
 * 2) В `beforeEnter` элемента ЕЩЁ НЕТ в DOM (Vue вставляет его после вызова
 *    хука), поэтому `getBoundingClientRect()` там возвращает нули. Мерить высоту
 *    нужно в `enter` — он идёт уже после вставки. Иначе панель запоминает высоту
 *    0 и «раскрывается» прыжком в конце.
 */

import type { TransitionProps } from 'vue'

type SlideHooks = Pick<
  TransitionProps,
  'onBeforeEnter' | 'onEnter' | 'onAfterEnter' | 'onLeave' | 'onAfterLeave'
>

/** Настройки раскрытия. */
export interface SlideDownOptions {
  /**
   * С какой высоты начинать раскрытие (px).
   *
   * Нужно для протяжки вниз: панель обязана появиться РОВНО той высоты, на
   * которую её уже вытянул палец. Без этого в момент порога содержимое прыгает:
   * панель начинается с нуля, а смещение панели уже снято — сумма меняется
   * скачком, и глаз видит «натяжку».
   */
  startFrom?: () => number
}

/** Реальная высота: в jsdom layout пуст, поэтому есть запасные варианты. */
const heightOf = (el: HTMLElement): number => {
  const measured = el.getBoundingClientRect().height
  if (measured > 0) return measured
  return el.scrollHeight || el.offsetHeight || 0
}

/** Заставляет браузер зафиксировать состояние до следующей правки стиля. */
const reflow = (el: HTMLElement): void => {
  void el.offsetHeight
}

/** Убираем инлайновые стили: дальше высоту снова считает вёрстка. */
const clearInline = (el: HTMLElement): void => {
  el.style.height = ''
  el.style.opacity = ''
}

/**
 * Хуки для `<Transition name="slide-down" v-bind="slideDown">`.
 * Классы `*-active` объявлены в стилях компонента (там же transition и клип).
 */
export function useSlideDown(options: SlideDownOptions = {}): SlideHooks {
  /** Высота старта: из протяжки — уже вытянутая пальцем, иначе ноль. */
  const startHeight = (): number => Math.max(0, Math.round(options.startFrom?.() ?? 0))
  return {
    onBeforeEnter(el) {
      const node = el as HTMLElement
      const start = startHeight()
      node.style.height = `${start}px`
      // Панель, которую уже вытянул палец, гасить в ноль не надо: она видна глазом.
      node.style.opacity = start > 0 ? '1' : '0'
    },
    onEnter(el) {
      const node = el as HTMLElement
      const start = startHeight()
      // Элемент уже вставлен: считаем высоту, которую он занял бы сам.
      node.style.height = 'auto'
      const expanded = heightOf(node)
      node.style.height = `${start}px`
      // Фиксируем «нулевую» высоту вместе с transition из класса *-active —
      // без этого браузер может разом прыгнуть в конечное значение.
      reflow(node)
      node.style.height = `${expanded}px`
      node.style.opacity = '1'
    },
    onAfterEnter(el) {
      clearInline(el as HTMLElement)
    },
    onLeave(el) {
      const node = el as HTMLElement
      // Уходить может и недорисованная панель (быстрое закрытие) — тогда
      // стартуем с той высоты, что видно сейчас.
      const expanded = heightOf(node)
      node.style.height = `${expanded}px`
      node.style.opacity = '1'
      reflow(node)
      node.style.height = '0px'
      node.style.opacity = '0'
    },
    onAfterLeave(el) {
      clearInline(el as HTMLElement)
    }
  }
}
