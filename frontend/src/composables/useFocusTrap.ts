/**
 * Удержание фокуса внутри модального слоя (фокус-трап).
 *
 * Зачем: у диалогов Quasar (`q-dialog`) удержание фокуса есть из коробки, а у
 * самодельных оверлеев (пересылка, «Отправить в Pismo», лайтбокс, запрос перехода
 * на внешний сайт, просмотр историй) его не было. С клавиатуры Tab уводил фокус
 * на страницу под оверлеем: человек «проваливался» в переписку, а выйти обратно
 * без мыши уже не мог.
 *
 * Что делает:
 *   1) при открытии запоминает текущий фокус и переносит его внутрь слоя;
 *   2) на Tab/Shift+Tab держит фокус внутри (по кругу);
 *   3) при закрытии возвращает фокус туда, откуда пришли.
 *
 * Использование:
 *
 * ```ts
 * const { container } = useFocusTrap(() => Boolean(current.value))
 * ```
 * ```html
 * <div ref="container" tabindex="-1"> … </div>
 * ```
 *
 * `tabindex="-1"` нужен на случай, если внутри нет ни одного фокусируемого
 * элемента — тогда фокус ставится на сам слой.
 */

import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** Что считаем фокусируемым внутри слоя. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/**
 * Видим ли элемент.
 *
 * Специально не используем `offsetParent`/`getClientRects()`: в jsdom (юнит-тесты)
 * они всегда пусты, и тогда трап «не находил» ни одного элемента. Проверка через
 * атрибуты работает и в браузере, и в тестах: скрытые через `v-show`/`display:none`
 * элементы внутри модалок у нас не встречаются.
 */
function isVisible(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden')) return false
  if (element.getAttribute('aria-hidden') === 'true') return false
  return element.closest('[hidden]') === null
}

function focusableInside(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
}

/**
 * Фокусируемые элементы внутри слоя — по порядку обхода.
 *
 * Открыто наружу: тем же списком пользуется навигация стрелками в меню
 * (`MessageRow.vue`), чтобы не дублировать селектор и проверку видимости.
 */
export function focusableElements(container: HTMLElement): HTMLElement[] {
  return focusableInside(container)
}

/**
 * @param isActive когда слой открыт. Если не передавать — слой считается открытым
 *   на всё время жизни компонента (так устроены оверлеи, которые монтирует родитель).
 * @returns `container` — ссылка, которую нужно повесить на элемент слоя.
 */
export function useFocusTrap(isActive?: () => boolean) {
  const container: Ref<HTMLElement | null> = ref(null)
  /** Куда вернуть фокус при закрытии. */
  let previouslyFocused: HTMLElement | null = null

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const root = container.value
    if (!root) return

    const items = focusableInside(root)
    if (items.length === 0) {
      // Внутри нечего фокусировать — держим фокус на самом слое.
      event.preventDefault()
      root.focus()
      return
    }

    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement as HTMLElement | null

    // Фокус вне слоя (например, после клика по фону) — возвращаем внутрь.
    if (!active || !root.contains(active)) {
      event.preventDefault()
      first.focus()
      return
    }
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activate = async (): Promise<void> => {
    previouslyFocused = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKeydown, true)
    await nextTick()
    const root = container.value
    if (!root) return
    const [first] = focusableInside(root)
    ;(first ?? root).focus()
  }

  const deactivate = (): void => {
    document.removeEventListener('keydown', onKeydown, true)
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus()
    }
    previouslyFocused = null
  }

  /*
   * Наблюдатель регистрируем в `onMounted`, а не в setup: `watch` вычисляет
   * источник СРАЗУ, а `isActive` обычно читает ref'ы, объявленные в
   * `<script setup>` НИЖЕ вызова `useFocusTrap` — тогда setup падал с
   * «Cannot access 'x' before initialization» (TDZ), и приложение показывало
   * фатальный экран. Для уже открытого слоя порядок не меняется: `activate()`
   * и сам ждёт `nextTick` перед переносом фокуса.
   */
  let stop: (() => void) | null = null

  onMounted(() => {
    stop = watch(
      () => (isActive ? isActive() : true),
      (open) => {
        if (open) void activate()
        else deactivate()
      },
      { immediate: true }
    )
  })

  onBeforeUnmount(() => {
    stop?.()
    deactivate()
  })

  return { container }
}
