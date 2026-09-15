import { describe, expect, it } from 'vitest'

import {
  caretAfterNDigits,
  formatPhoneForBackend,
  formatPhoneInput,
  isValidPhoneNumber,
  localPhoneDigits,
  maskPhoneLocal,
  prettyPhone
} from '@/utils/phone'

describe('formatPhoneForBackend / isValidPhoneNumber', () => {
  it('нормализует номер в +7XXXXXXXXXX и валидирует 11 цифр с 7', () => {
    expect(formatPhoneForBackend('+7 (910) 974-43-76')).toBe('+79109744376')
    expect(formatPhoneForBackend('  +7 910 974-43-76 ')).toBe('+79109744376')
    expect(formatPhoneForBackend('')).toBe('')
    expect(isValidPhoneNumber('+7 (910) 974-43-76')).toBe(true)
    expect(isValidPhoneNumber('+7 (910) 974-43-7')).toBe(false)
    expect(isValidPhoneNumber('+1 (910) 974-43-76')).toBe(false)
  })
})

describe('prettyPhone / maskPhoneLocal / localPhoneDigits', () => {
  it('prettyPhone красиво форматирует полный номер', () => {
    expect(prettyPhone('+79109744376')).toBe('+7 (910) 974-43-76')
  })

  it('localPhoneDigits понимает локальный ввод, ввод с кодом и E.164', () => {
    expect(localPhoneDigits('9215552233')).toBe('9215552233')
    expect(localPhoneDigits('79109744376')).toBe('9109744376')
    expect(localPhoneDigits('+79109744376')).toBe('9109744376')
    expect(localPhoneDigits('89109744376')).toBe('9109744376')
  })

  it('maskPhoneLocal строит прогрессивную маску +7 (XXX) XXX-XX-XX', () => {
    expect(maskPhoneLocal('')).toBe('+7 (')
    expect(maskPhoneLocal('9')).toBe('+7 (9')
    expect(maskPhoneLocal('921')).toBe('+7 (921')
    expect(maskPhoneLocal('9215')).toBe('+7 (921) 5')
    expect(maskPhoneLocal('9215552233')).toBe('+7 (921) 555-22-33')
    // лишние цифры обрезаются
    expect(maskPhoneLocal('921555223344')).toBe('+7 (921) 555-22-33')
  })
})

describe('caretAfterNDigits', () => {
  it('ставит каретку после локальных цифр, игнорируя страну в «+7 (»', () => {
    expect(caretAfterNDigits('+7 (921) 555-22-33', 0)).toBe(4) // после «(»
    expect(caretAfterNDigits('+7 (921) 555-22-33', 1)).toBe(5) // после «9»
    expect(caretAfterNDigits('+7 (921) 555-22-33', 3)).toBe(7)
    expect(caretAfterNDigits('+7 (921) 555-22-33', 10)).toBe('+7 (921) 555-22-33'.length)
  })
})

describe('formatPhoneInput: ввод в поле телефона', () => {
  /**
   * Главный случай — вставка номера так, как его пишут в телефоне. Раньше поле
   * использовало жёсткую маску Quasar (`+7 (###) ###-##-##`), она не знает про
   * код страны: ввод «+7 900 111-00-01» превращался в «+7 (790) 011-10-00» —
   * цифры сдвигались, последняя терялась. Номер при этом оставался «валидным»
   * (11 цифр, начинается с 7) и уходил на сервер как чужой.
   */
  it('вставку «+7 …» и «8 …» приводит к одному и тому же номеру', () => {
    const expected = '+7 (900) 111-00-01'
    expect(formatPhoneInput('+7 900 111-00-01').value).toBe(expected)
    expect(formatPhoneInput('8 900 111 00 01').value).toBe(expected)
    expect(formatPhoneInput('+79001110001').value).toBe(expected)
    expect(formatPhoneInput('9001110001').value).toBe(expected)
    expect(formatPhoneInput('+7 (900) 111-00-01').value).toBe(expected)
  })

  it('номер из результата нормализуется в тот же +7…', () => {
    const formatted = formatPhoneInput('+7 900 111-00-01').value
    expect(formatPhoneForBackend(formatted)).toBe('+79001110001')
    expect(isValidPhoneNumber(formatted)).toBe(true)
  })

  it('чистит лишнее и не оставляет в поле мусор', () => {
    expect(formatPhoneInput('+7 900 abc 111').value).toBe('+7 (900) 111')
    expect(formatPhoneInput('+7 900 111 00 01 99').value).toBe('+7 (900) 111-00-01')
  })

  it('пустое поле остаётся пустым (а не «+7 (»)', () => {
    expect(formatPhoneInput('').value).toBe('')
    expect(formatPhoneInput('+', 1).value).toBe('')
  })

  it('возвращает каретку на ту же цифру, а не в конец строки', () => {
    // Каретка стоит сразу после дописанной цифры в середине номера — там и
    // должна остаться (reflow-маска иначе уводит её в конец строки).
    const typed = '+7 (900) 111-00-05'
    const caret = typed.indexOf('5') + 1
    const result = formatPhoneInput(typed, caret)
    expect(result.value).toBe('+7 (900) 111-00-05')
    expect(result.caret).toBe(caret)
  })

  it('при вставке каретка уходит в конец', () => {
    const pasted = '+7 900 111-00-01'
    const result = formatPhoneInput(pasted, pasted.length)
    expect(result.caret).toBe(result.value.length)
  })
})
