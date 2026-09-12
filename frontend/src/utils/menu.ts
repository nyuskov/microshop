/**
 * Навигация по меню с клавиатуры.
 *
 * Вынесено из компонента, чтобы проверить арифметику границ отдельно от
 * разметки — как навигация по историям в `utils/stories.ts`.
 */

/**
 * Индекс элемента, на который перевести фокус, или `null`, если клавиша не про
 * навигацию.
 *
 * Стрелки идут по кругу (с последнего — на первый и наоборот), `Home`/`End` —
 * на края. Если фокус сейчас вне списка (`currentIndex < 0`), стрелки ведут на
 * первый/последний элемент, а не в пустоту.
 */
export function menuFocusTarget(key: string, currentIndex: number, length: number): number | null {
  if (length <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % length
  if (key === 'ArrowUp') {
    return currentIndex < 0 ? length - 1 : (currentIndex - 1 + length) % length
  }
  return null
}
