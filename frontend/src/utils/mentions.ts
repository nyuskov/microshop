/**
 * Упоминания в сообщениях: `@логин`.
 *
 * В групповом чате важно понимать, к кому обращаются: имя упомянутого подсвечиваем
 * (см. MessageRow), а в поле ввода подсказываем участников, как только набрали `@`.
 */

/** Что нашли в тексте: обычный фрагмент или упоминание. */
export interface MentionPart {
  type: 'text' | 'mention'
  value: string
}

/** Регулярка упоминания: `@логин` (буквы, цифры, подчёркивание, точка, дефис). */
const MENTION_RE = /@[a-zA-Z0-9_.-]{2,64}/g

/** Разбирает текст сообщения на обычные фрагменты и упоминания. */
export function splitMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = []
  let lastIndex = 0
  for (const match of text.matchAll(MENTION_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, index) })
    parts.push({ type: 'mention', value: match[0] })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) })
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
