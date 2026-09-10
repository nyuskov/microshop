/**
 * Подсветка совпадений в результатах поиска.
 *
 * Раньше результат показывался как есть — по нему не было видно, почему
 * сообщение вообще нашлось, особенно когда совпадение в середине длинной строки.
 */
export interface TextPart {
  text: string
  /** Часть совпала с запросом — рисуем её акцентом. */
  hit: boolean
}

/** Делит текст на части, помечая совпадения с запросом (без учёта регистра). */
export function splitByQuery(text: string, query: string): TextPart[] {
  const needle = query.trim()
  if (!needle) return [{ text, hit: false }]

  const haystack = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const parts: TextPart[] = []
  let index = 0

  for (;;) {
    const found = haystack.indexOf(lowerNeedle, index)
    if (found === -1) break
    if (found > index) parts.push({ text: text.slice(index, found), hit: false })
    parts.push({ text: text.slice(found, found + needle.length), hit: true })
    index = found + needle.length
  }

  if (index < text.length) parts.push({ text: text.slice(index), hit: false })
  return parts.length ? parts : [{ text, hit: false }]
}
