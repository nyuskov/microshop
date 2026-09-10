/**
 * Однократный перенос ключей localStorage прежнего названия приложения
 * (`microshop_*`) на текущее (`pismo_*`).
 *
 * Зачем: в localStorage лежат пользовательские данные — настройки оформления,
 * черновики, закреплённые чаты, тип звонка и (самое важное) приватные ключи
 * E2EE. Просто переименовать константы нельзя: без переноса все эти данные
 * «сбросятся» (а старая зашифрованная переписка станет нечитаемой).
 *
 * Вызывается один раз при старте приложения (см. `main.ts`) до первого
 * обращения к настройкам/черновикам.
 */

/** Префикс ключей прежнего названия приложения. */
const LEGACY_PREFIX = 'microshop_'
/** Текущий префикс ключей этого приложения. */
const PREFIX = 'pismo_'

/** Переносит все ключи `microshop_*` в `pismo_*` (значения сохраняются). */
export function migrateLegacyStorage(): void {
  try {
    const pending: Array<[string, string]> = []
    // Сначала собираем список ключей: удалять прямо во время перебора нельзя.
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || !key.startsWith(LEGACY_PREFIX)) continue
      pending.push([key, PREFIX + key.slice(LEGACY_PREFIX.length)])
    }
    for (const [legacyKey, newKey] of pending) {
      const value = localStorage.getItem(legacyKey)
      // Новое значение не затираем: если пользователь уже работал в новых
      // версиях приложения, приоритет у него.
      if (value !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value)
      }
      localStorage.removeItem(legacyKey)
    }
  } catch {
    /* localStorage недоступен (приватный режим) — переносить нечего */
  }
}
