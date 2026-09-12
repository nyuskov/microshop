/**
 * Разбор текста сообщения: оформление, упоминания `@логин` и ссылки.
 *
 * В групповом чате важно понимать, к кому обращаются: имя упомянутого подсвечиваем
 * (см. MessageRow), а в поле ввода подсказываем участников, как только набрали `@`.
 * Ссылки выделяем отдельно — их можно нажать и перейти (с предупреждением
 * о переходе на чужой сайт, см. `useExternalLinkGuard`).
 *
 * Каждый фрагмент отрисовывается своим тегом, а не строкой HTML: разметку строит
 * шаблон, поэтому текст сообщения в браузер как HTML не попадает.
 */

import { findLinks } from './linkPreview'

/** Вид фрагмента: обычный текст, упоминание, ссылка или оформление. */
export type MessageTextPartType =
  'text' | 'mention' | 'link' | 'bold' | 'italic' | 'code' | 'strike' | 'spoiler'

/** Что нашли в тексте: сам фрагмент и, для ссылок, адрес перехода. */
export interface MessageTextPart {
  type: MessageTextPartType
  value: string
  /** Адрес для перехода (только у ссылок). */
  href?: string
}

/** Регулярка упоминания: `@логин` (буквы, цифры, подчёркивание, точка, дефис). */
const MENTION_RE = /@[a-zA-Z0-9_.-]{2,64}/g

/** Один найденный фрагмент: где начинается и что это. */
interface Mark {
  index: number
  length: number
  part: MessageTextPart
}

/**
 * Оформление — как в Telegram: `**жирный**`/`*жирный*`, `_курсив_`, `` `код` ``,
 * `~~зачёркнутый~~`, `||спойлер||`.
 *
 * `pad` — длина обрамления (его отрезаем: в разметке остаётся только текст).
 * Двойные варианты идут первыми: при совпадении позиции побеждает первый
 * (сортировка стабильная), иначе `**a**` распалось бы на `*` + `a` + `*`.
 *
 * Пробел сразу после открывающего обрамления запрещён — поэтому `2 * 3 * 4`
 * остаётся арифметикой, а не жирным текстом.
 */
const FORMAT_RULES: { type: MessageTextPartType; re: RegExp; pad: number }[] = [
  { type: 'strike', re: /~~\S(?:[^~\n]*\S)?~~/g, pad: 2 },
  { type: 'spoiler', re: /\|\|\S(?:[^|\n]*\S)?\|\|/g, pad: 2 },
  { type: 'bold', re: /\*\*\S(?:[^*\n]*\S)?\*\*/g, pad: 2 },
  { type: 'bold', re: /\*\S(?:[^*\n]*\S)?\*/g, pad: 1 },
  { type: 'italic', re: /__\S(?:[^_\n]*\S)?__/g, pad: 2 },
  { type: 'italic', re: /_\S(?:[^_\n]*\S)?_/g, pad: 1 },
  { type: 'code', re: /`[^`\n]+`/g, pad: 1 }
]

const WORD_CHAR = /[\p{L}\p{N}_]/u

/**
 * `_` встречается в обычной речи (`snake_case`, `max_length`), поэтому курсивом
 * считаем только обрамление на границе слова.
 */
function italicOnWordBoundary(text: string, index: number, length: number): boolean {
  const before = index > 0 ? text[index - 1] : ''
  const after = index + length < text.length ? text[index + length] : ''
  return !WORD_CHAR.test(before) && !WORD_CHAR.test(after)
}

/** Собирает фрагменты из найденных мест: текст между ними остаётся текстом. */
function buildParts(text: string, marks: Mark[]): MessageTextPart[] {
  const parts: MessageTextPart[] = []
  let cursor = 0
  for (const mark of marks) {
    // Пересечения пропускаем: внутри ссылки оформления не ищем.
    if (mark.index < cursor) continue
    if (mark.index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, mark.index) })
    }
    parts.push(mark.part)
    cursor = mark.index + mark.length
  }
  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) })
  return parts
}

/**
 * Разбирает оформление внутри обычного текста.
 *
 * Вложенность не поддерживаем: `*жирный _курсив_*` покажет подчёркивания как есть
 * — так проще и предсказуемее, чем дерево разметки.
 */
export function splitFormatting(text: string): MessageTextPart[] {
  if (!text) return []
  const marks: Mark[] = []
  for (const rule of FORMAT_RULES) {
    for (const match of text.matchAll(rule.re)) {
      const index = match.index ?? 0
      const raw = match[0]
      if (rule.type === 'italic' && !italicOnWordBoundary(text, index, raw.length)) continue
      const value = raw.slice(rule.pad, raw.length - rule.pad)
      if (!value) continue
      marks.push({ index, length: raw.length, part: { type: rule.type, value } })
    }
  }
  marks.sort((left, right) => left.index - right.index)
  return buildParts(text, marks)
}

/** Разбирает текст сообщения на обычные фрагменты, оформление, упоминания и ссылки. */
export function splitMessageText(text: string): MessageTextPart[] {
  const marks: Mark[] = []

  for (const match of text.matchAll(MENTION_RE)) {
    marks.push({
      index: match.index ?? 0,
      length: match[0].length,
      part: { type: 'mention', value: match[0] }
    })
  }
  for (const link of findLinks(text)) {
    marks.push({
      index: link.index,
      length: link.value.length,
      part: { type: 'link', value: link.value, href: link.href }
    })
  }

  marks.sort((left, right) => left.index - right.index)

  const parts: MessageTextPart[] = []
  let cursor = 0
  for (const mark of marks) {
    // Пересечения пропускаем: внутри ссылки упоминаний не ищем.
    if (mark.index < cursor) continue
    parts.push(...splitFormatting(text.slice(cursor, mark.index)))
    parts.push(mark.part)
    cursor = mark.index + mark.length
  }
  parts.push(...splitFormatting(text.slice(cursor)))
  return parts
}

/**
 * Текст без служебных символов разметки: нужен там, где оформление показать
 * нельзя (превью в списке чатов, цитата ответа), а звёздочки в тексте лишние.
 */
export function plainMessageText(text: string): string {
  return splitMessageText(text)
    .map((part) => part.value)
    .join('')
}

/**
 * Незаконченное упоминание перед курсором (то, по чему подбираем участников).
 *
 * Возвращает `{ query, start }` — текст после `@` и позицию самого `@`, либо null.
 * Упоминание считаем начатым только в начале строки или после пробела: иначе
 * `почта@пример.ру` открывало бы подсказку.
 */
export function mentionBeforeCaret(
  text: string,
  caret: number
): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const previous = at === 0 ? ' ' : before[at - 1]
  if (!/\s/.test(previous)) return null
  const query = before.slice(at + 1)
  // Пробел после `@` означает, что упоминание уже закончили.
  if (/\s/.test(query)) return null
  return { query, start: at }
}

/** Подставляет выбранный логин вместо набранного `@...` (курсор — в конец). */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  username: string
): { text: string; caret: number } {
  const before = text.slice(0, start)
  const after = text.slice(caret)
  const inserted = `@${username} `
  return { text: before + inserted + after, caret: before.length + inserted.length }
}
