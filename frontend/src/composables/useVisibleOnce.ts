/**
 * «Стало видно» — один раз на элемент.
 *
 * Зачем: дорогие вещи (запрос карточки ссылки, расшифровка медиа) не должны
 * запускаться сразу для всей загруженной истории — только когда строка реально
 * попала на экран. У нас в чате держится история страницами по 80 сообщений, и
 * раньше карточку ссылки просили все они разом: десятки запросов на открытие
 * чата, причём сервер по каждому ходит в интернет (и упирается в лимит
 * 30 запросов в минуту на пользователя — часть карточек просто терялась).
 *
 * Флаг поднимается один раз и обратно не опускается: после первого показа
 * карточка уже загружена, и «мигать» ею при прокрутке не нужно.
 */

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** Заранее считаем элемент видимым, чтобы карточка успела загрузиться. */
const PRELOAD_MARGIN = '200px'

export interface UseVisibleOnceResult {
  /** Элемент хотя бы раз попал в область видимости. */
  visible: Ref<boolean>
}

/**
 * @param target ссылка на элемент, за которым следим. Если элемента нет
 *   (например, строка отрисована другим шаблоном), ничего не происходит.
 */
export function useVisibleOnce(target: Ref<HTMLElement | null>): UseVisibleOnceResult {
  const visible = ref(false)
  let observer: IntersectionObserver | null = null

  const stop = (): void => {
    observer?.disconnect()
    observer = null
  }

  const start = (): void => {
    if (visible.value || observer) return
    const element = target.value
    if (!element) return
    // Без IntersectionObserver (старый браузер, окружение тестов) не рискуем:
    // считаем элемент видимым, то есть ведём себя как раньше.
    if (typeof IntersectionObserver === 'undefined') {
      visible.value = true
      return
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        visible.value = true
        stop()
      },
      { rootMargin: PRELOAD_MARGIN }
    )
    observer.observe(element)
  }

  onMounted(start)
  // Элемент может появиться позже: строка меняет тип (системное сообщение ↔
  // обычное) — тогда `ref` приходит уже после монтирования.
  watch(target, (element) => {
    if (element) start()
  })
  onBeforeUnmount(stop)

  return { visible }
}
