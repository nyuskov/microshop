/**
 * Разметка текста сообщения: обрамление выделенного куска знаками.
 *
 * Знаки давно понимает рендер (`MessageText.vue` разбирает их через
 * `utils/mentions.ts`): `*жирный*`, `_курсив_`, `__подчёркнутый__`,
 * `~~зачёркнутый~~`, `` `код` ``, `||спойлер||`, а с 29.09.2026 — и цитата
 * (`> ` в начале строки). Но набирать их приходилось руками — панель формата в
 * композере (кнопка «Aa» и панель по выделению) оборачивает ими выделение.
 *
 * ГЛАВНОЕ правило — общее с разбором: сразу после открывающего знака и перед
 * закрывающим не должно быть пробела, иначе разметка не распознаётся. Поэтому
 * пробелы по краям выделения остаются СНАРУЖИ обрамления: `* текст *` не
 * жирный, а `*текст*` — жирный. У цитаты правило своё: знак стоит в НАЧАЛЕ
 * каждой строки, а не вокруг текста.
 */

/** Виды разметки, которые умеет панель формата. */
export type MarkupKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'spoiler'
  /** Цитата — построчная: `> ` в начале строки (не обрамление). */
  | 'quote'

/** Знаки обрамления — те же, что разбирает `utils/mentions.ts`. */
export const MARKUP_MARKS: Record<Exclude<MarkupKind, 'quote'>, string> = {
  bold: '*',
  italic: '_',
  underline: '__',
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
 * второй раз». Так же и при курсоре между парой знаков: «набрал и передумал»
 * не требует удалять звёздочки вручную.
 */
export function applyMarkup(
  text: string,
  start: number,
  end: number,
  kind: MarkupKind
): MarkupEdit {
  // Цитата — не обрамление: у неё свой знак в начале КАЖДОЙ строки.
  if (kind === 'quote') return applyQuote(text, start, end)
  const mark = MARKUP_MARKS[kind]
  const from = clamp(Math.min(start, end), text.length)
  const to = clamp(Math.max(start, end), text.length)

  // Выделения нет — ставим пустую пару знаков и курсор между ними.
  if (from === to) {
    // Курсор уже стоит между тех же знаков (`**|**`): повторное нажатие снимает
    // пару, а не ставит вторую — иначе «включил и передумал» чинится руками.
    if (
      from >= mark.length &&
      text.slice(from - mark.length, from) === mark &&
      text.slice(from, from + mark.length) === mark
    ) {
      return {
        text: text.slice(0, from - mark.length) + text.slice(from + mark.length),
        start: from - mark.length,
        end: from - mark.length
      }
    }
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

/** Знак цитаты — как в Telegram: `> ` в начале строки. */
export const QUOTE_MARK = '> '

/** Строка начинается знаком цитаты (`>` с пробелом или без). */
const QUOTE_LINE_RE = /^>[ \t]?/

/**
 * Включить или снять цитату у строк, попавших в выделение.
 *
 * Цитата — построчная разметка, а не обрамление: знак `> ` встаёт в начало
 * каждой строки (так её понимает и рендер, `utils/mentions.ts`). Выделение
 * расширяем до границ строк: цитируется строка целиком. Повторное нажатие
 * снимает знак со всех строк — как «выключить» у остальных видов. Пустые строки
 * знака не получают: так пустая строка разрывает цитату, и две цитаты подряд не
 * склеиваются в одну (как в Telegram).
 */
export function applyQuote(text: string, start: number, end: number): MarkupEdit {
  const from = clamp(Math.min(start, end), text.length)
  const to = clamp(Math.max(start, end), text.length)
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  // Выделение кончается ровно на переносе — следующая строка в цитату не входит.
  const edge = to > from && text[to - 1] === '\n' ? to - 1 : to
  const breakAt = text.indexOf('\n', edge)
  const lineEnd = breakAt === -1 ? text.length : breakAt

  const lines = text.slice(lineStart, lineEnd).split('\n')
  const quoted = lines.every((line) => line === '' || QUOTE_LINE_RE.test(line))
  const next = lines
    .map((line) => {
      if (quoted) return line.replace(QUOTE_LINE_RE, '')
      return line === '' ? line : QUOTE_MARK + line
    })
    .join('\n')

  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + next.length
  }
}
