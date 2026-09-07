import { describe, expect, it } from 'vitest'

import {
  caretAfterNDigits,
  formatPhoneForBackend,
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
