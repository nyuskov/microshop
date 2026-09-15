/**
 * Горизонтальный ряд (чипы фильтров) и мышь.
 *
 * Зачем: ряд листается пальцем (свайп) и трекпадом, а обычной мышью — нет:
 * колесо прокручивает страницу или список чатов, и до правого края (чип
 * «Архив») не добраться. Пользователь сообщил об этом 15.09.2026 («в веб-версии
 * не крутится»). Поэтому вертикальное колесо над рядом переводим в
 * горизонтальную прокрутку, а затухания по краям показываем ТОЛЬКО когда есть
 * что прокручивать в эту сторону — иначе под маской прятался бы текст чипа.
 *
 * Правила описаны отдельно от DOM, чтобы проверяться тестами.
 */

/** Минимальный интерфейс прокручиваемого элемента — без DOM. */
export interface ScrollableX {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

/** Есть ли что прокручивать по горизонтали (допуск 1px на дробные ширины). */
export const canScrollX = (el: ScrollableX): boolean => el.scrollWidth - el.clientWidth > 1

/** Что скрыто за краями: слева / справа — для затуханий-подсказок. */
export const scrollEdges = (el: ScrollableX): { start: boolean; end: boolean } => ({
  start: el.scrollLeft > 1,
  end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1
})

/**
 * Новое значение `scrollLeft` от события колеса.
 *
 * Берём ту ось, где движение больше: мышь даёт `deltaY` (вертикальное колесо),
 * трекпад — `deltaX`. Результат зажат в границы ряда, чтобы «перекрут» не
 * оставлял пустое место.
 */
export const wheelScrollLeft = (el: ScrollableX, deltaX: number, deltaY: number): number => {
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  return Math.min(max, Math.max(0, el.scrollLeft + delta))
}
