/**
 * Отметки «этот встроенный набор человек уже добавил себе».
 *
 * Хранятся локально (`pismo_sticker_imports`: ключ набора → id пака): наборы
 * разные у разных устройств, и серверу это знание не нужно. Утилита отдельная и
 * без Pinia — её читает и строка сообщения (`MessageRow`), которой не нужен весь
 * стор стикеров с библиотекой: ей достаточно знать, добавляли ли набор.
 */

const STORAGE_KEY = 'pismo_sticker_imports'

/** Читает отметки (неиспорченный JSON и только числовые значения). */
export const readImportedSets = (): Record<string, number> => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
      )
    )
  } catch {
    return {}
  }
}

/** Сохраняет отметки (в приватном режиме просто не переживут перезапуск). */
export const writeImportedSets = (sets: Record<string, number>): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(sets))
  } catch {
    /* переполнение/приватный режим — набор можно добавить ещё раз */
  }
}

/** id пака, в который человек добавил набор, или null (не добавлял). */
export const importedSetPackId = (setKey: string): number | null =>
  readImportedSets()[setKey] ?? null
