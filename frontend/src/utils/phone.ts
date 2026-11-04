/**
 * Работа с телефонными номерами (формат РФ, +7).
 *
 * Модель везде хранит «нормализованный» вид (+79991234567), а маски
 * используются только для ввода/отображения в полях.
 */

/** Только цифры из произвольной строки. */
export const phoneDigits = (value: string): string => value.replace(/\D/g, '')

/** Валиден ли номер: ровно 11 цифр, начинающихся с 7. */
export const isValidPhoneNumber = (phone: string): boolean => {
  const digits = phoneDigits(phone)
  return digits.startsWith('7') && digits.length === 11
}

/** Нормализованный вид для бэкенда: +79991234567 ('' — если цифр нет). */
export const formatPhoneForBackend = (phone: string): string => {
  const digits = phoneDigits(phone)
  return digits ? `+${digits}` : ''
}

/** Красивый формат +7 (XXX) XXX-XX-XX (для отображения номера). */
export const prettyPhone = (phone: string): string => {
  const digits = phoneDigits(phone).replace(/^7/, '')
  if (digits.length < 10) return phone || '+7'
  const d = digits.slice(0, 10)
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`
}

/**
 * «Локальные» цифры (без кода страны) из произвольного ввода/значения поля.
 * Понимает полный E.164 (+7/8 + 10 цифр), ввод «с кодом» и ввод локального номера.
 */
export const localPhoneDigits = (value: string): string => {
  const digits = phoneDigits(value)
  // 11 и больше цифр, начинающихся с 7/8 — «код страны + локальный номер».
  // Больше 11 бывает при вставке номера с мусором («+7 900 111 00 01 99») —
  // лишние цифры справа отбрасываем, иначе код страны уезжал в номер.
  if (digits.length >= 11 && (digits[0] === '7' || digits[0] === '8')) {
    return digits.slice(1, 11)
  }
  // Меньше 11 цифр, начинающихся с 7 — вероятно, только начали вводить код страны.
  if (digits.length <= 10 && digits[0] === '7') {
    return digits.slice(1)
  }
  return digits.slice(0, 10)
}

/** Маска +7 (XXX) XXX-XX-XX из «локальных» цифр (до 10). */
export const maskPhoneLocal = (local: string): string => {
  const d = local.replace(/\D/g, '').slice(0, 10)
  let out = '+7 ('
  out += d.slice(0, 3)
  if (d.length >= 4) {
    out += ') '
    out += d.slice(3, 6)
  }
  if (d.length >= 7) out += `-${d.slice(6, 8)}`
  if (d.length >= 9) out += `-${d.slice(8, 10)}`
  return out
}

/**
 * Ввод в поле телефона: любое написание → маска +7 (XXX) XXX-XX-XX и позиция
 * каретки по числу введённых цифр.
 *
 * Зачем не хватило одной `mask` из Quasar: маска ждёт РОВНО 10 локальных цифр и
 * не понимает код страны. Стоило вставить номер как его пишут в телефоне
 * («+7 900 111-00-01» или «8 900 111 00 01») — лишние цифры сдвигали ввод, а
 * последняя отбрасывалась: на экране оказывался ДРУГОЙ, но «валидный» номер.
 *
 * Пустой ввод остаётся пустым: иначе в поле залипает «+7 (», и человеку,
 * стёршему номер, эта строка мешает.
 */
export const formatPhoneInput = (
  value: string,
  caret?: number | null
): { value: string; caret: number | null } => {
  const local = localPhoneDigits(value)
  const formatted = local ? maskPhoneLocal(local) : ''
  if (caret === undefined || caret === null) {
    return { value: formatted, caret: null }
  }
  const left = localPhoneDigits(value.slice(0, caret)).length
  return { value: formatted, caret: formatted ? caretAfterNDigits(formatted, left) : 0 }
}

/**
 * Позиция каретки после n-й «локальной» цифры в отформатированной строке.
 * Страна в префиксе («+7 (») — литерал и не редактируется, поэтому считаем
 * только цифры, идущие после открывающей скобки.
 */
export const caretAfterNDigits = (formatted: string, n: number): number => {
  const start = formatted.indexOf('(')
  const from = start >= 0 ? start : 0
  let seen = 0
  for (let i = from; i < formatted.length; i += 1) {
    if (/\d/.test(formatted[i])) seen += 1
    if (seen >= n) return i + 1
  }
  return formatted.length
}
