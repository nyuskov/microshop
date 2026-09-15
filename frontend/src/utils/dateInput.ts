/**
 * Дата рождения в профиле: ввод и показ в виде ДД.ММ.ГГГГ.
 *
 * Почему не `<input type="date">`: календарь рисует сам браузер, и в WebView (а
 * также при нестандартном масштабе страницы) он открывается системным окном
 * далеко от поля — жалоба пользователя 15.09.2026, та же, что у родного списка
 * «Срок действия» в приглашениях. Маскированный ввод ничего не открывает:
 * календаря в приложении нет вовсе, дата набирается цифрами.
 *
 * Модель (то, что уходит на сервер) — ISO `YYYY-MM-DD` (поле `birth_date`),
 * а в поле ввода показывается и набирается `ДД.ММ.ГГГГ`.
 */

/** Только цифры даты, максимум 8 (ДДММГГГГ). */
export const dateDigits = (value: string): string => value.replace(/\D/g, '').slice(0, 8)

/** Маска ДД.ММ.ГГГГ по цифрам (частичная — пока дату набирают). */
export const maskDate = (digits: string): string => {
  const d = dateDigits(digits)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`
}

/**
 * Позиция каретки, если слева от неё ровно `digits` цифр.
 * Точки ставит маска, поэтому они прибавляются к позиции (после 2 и 4 цифр).
 */
export const caretAfterDateDigits = (digits: number): number => {
  const d = Math.max(0, Math.min(digits, 8))
  return d + (d >= 3 ? 1 : 0) + (d >= 5 ? 1 : 0)
}

/** ISO `YYYY-MM-DD` из маски ('' — дата не набрана). */
export const dateToIso = (value: string): string => {
  const d = dateDigits(value)
  if (d.length < 8) return ''
  return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`
}

/** Маска ДД.ММ.ГГГГ из ISO-значения (для показа в поле). */
export const isoToDateMask = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : ''
}

/** Самая ранняя допустимая дата рождения. */
const MIN_YEAR = 1900

/**
 * Проверка даты рождения. `null` — всё в порядке; иначе текст для подсказки
 * под полем. Пустое значение допустимо (поле необязательное).
 */
export const validateBirthDate = (value: string, today: Date = new Date()): string | null => {
  const digits = dateDigits(value)
  if (!digits) return null
  if (digits.length < 8) return 'Введите дату целиком: ДД.ММ.ГГГГ'

  const day = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))
  const year = Number(digits.slice(4, 8))
  if (month < 1 || month > 12) return 'Месяц — от 01 до 12'
  if (day < 1 || day > 31) return 'День — от 01 до 31'
  if (year < MIN_YEAR) return `Год не раньше ${MIN_YEAR}`

  // «Реальность» даты проверяем по календарю: 31.02 превратился бы в 2–3 марта,
  // поэтому сверяем все три части.
  const date = new Date(year, month - 1, day)
  const real =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  if (!real) return 'Такой даты не существует'
  if (date.getTime() > today.getTime()) return 'Дата рождения не может быть в будущем'
  return null
}
