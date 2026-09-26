/**
 * Разметка текста сообщения: обрамление выделенного куска знаками.
 *
 * Знаки давно понимает рендер (`MessageText.vue` разбирает их через
 * `utils/mentions.ts`): `*жирный*`, `_курсив_`, `~~зачёркнутый~~`, `` `код` ``,
 * `||спойлер||`. Но набирать их приходилось руками — панель формата в композере
 * (кнопка «Aa») оборачивает ими выделение.
 *
 * ГЛАВНОЕ правило — общее с разбором: сразу после открывающего знака и перед
 * закрывающим не должно быть пробела, иначе разметка не распознаётся. Поэтому
 * пробелы по краям выделения остаются СНАРУЖИ обрамления: `* текст *` не
 * жирный, а `*текст*` — жирный.
 */

/** Виды разметки, которые умеет панель формата. */
export type MarkupKind = 'bold' | 'italic' | 'strike' | 'code' | 'spoiler'

/** Знаки обрамления — те же, что разбирает `utils/mentions.ts`. */
export const MARKUP_MARKS: Record<MarkupKind, string> = {
  bold: '*',
  italic: '_',
  strike: '~~',
  code: '`',
  spoiler: '||'
}

/** Результат: новый текст и каким должен стать выделенный кусок. */
export interface MarkupEdit {
  text: string
  /** Начало выделения после правки (курсор — когда выделения нет). */
  start: number
  /** Конец выделения после правки. */
  end: number
}

/** Индексы вне текста (курсор уехал после перерисовки) приводим к границам. */
const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max))

/**
 * Обернуть выделение знаками разметки — или снять их, если они уже стоят.
 *
 * Повторное нажатие той же кнопки снимает разметку: человек выделяет готовый
 * жирный кусок (или сам текст внутри него) и ждёт «выключить», а не «обернуть
 * второй раз».
 */
export function applyMarkup(
  text: string,
  start: number,
  end: number,
  kind: MarkupKind
): MarkupEdit {
  const mark = MARKUP_MARKS[kind]
  const from = clamp(Math.min(start, end), text.length)
  const to = clamp(Math.max(start, end), text.length)

  // Выделения нет — ставим пустую пару знаков и курсор между ними.
  if (from === to) {
    const caret = from + mark.length
    return { text: text.slice(0, from) + mark + mark + text.slice(from), start: caret, end: caret }
  }

  // Пробелы по краям остаются снаружи — иначе разметка не распознается.
  const lead = text.slice(from, to).length - text.slice(from, to).trimStart().length
  const tail = text.slice(from, to).length - text.slice(from, to).trimEnd().length
  const left = from + lead
  const right = Math.max(left, to - tail)
  const inner = text.slice(left, right)

  // Выделены одни пробелы: ставим пустую пару знаков там же.
  if (!inner) {
    const caret = left + mark.length
    return { text: text.slice(0, left) + mark + mark + text.slice(left), start: caret, end: caret }
  }

  // Знаки стоят сразу за краями выделения — это готовая разметка, снимаем её.
  if (
    text.slice(left - mark.length, left) === mark &&
    text.slice(right, right + mark.length) === mark
  ) {
    return {
      text: text.slice(0, left - mark.length) + inner + text.slice(right + mark.length),
      start: left - mark.length,
      end: right - mark.length
    }
  }

  // Выделение вместе со знаками: снимаем знаки у него самого.
  if (inner.startsWith(mark) && inner.endsWith(mark) && inner.length > mark.length * 2) {
    const bare = inner.slice(mark.length, inner.length - mark.length)
    return {
      text: text.slice(0, left) + bare + text.slice(right),
      start: left,
      end: left + bare.length
    }
  }

  return {
    text: text.slice(0, left) + mark + inner + mark + text.slice(right),
    start: left + mark.length,
    end: right + mark.length
  }
}
