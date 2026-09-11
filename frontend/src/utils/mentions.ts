/**
 * Разбор текста сообщения: упоминания `@логин` и ссылки.
 *
 * В групповом чате важно понимать, к кому обращаются: имя упомянутого подсвечиваем
 * (см. MessageRow), а в поле ввода подсказываем участников, как только набрали `@`.
 * Ссылки выделяем отдельно — их можно нажать и перейти (с предупреждением
 * о переходе на чужой сайт, см. `useExternalLinkGuard`).
 */

import { findLinks } from './linkPreview'

/** Что нашли в тексте: обычный фрагмент, упоминание или ссылка. */
export interface MessageTextPart {
  type: 'text' | 'mention' | 'link'
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

/** Разбирает текст сообщения на обычные фрагменты, упоминания и ссылки. */
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
