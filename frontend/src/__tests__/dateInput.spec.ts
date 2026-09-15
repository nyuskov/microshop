import { describe, expect, it } from 'vitest'

import {
  caretAfterDateDigits,
  dateToIso,
  isoToDateMask,
  maskDate,
  validateBirthDate
} from '@/utils/dateInput'

/**
 * Дата рождения в профиле: маска ДД.ММ.ГГГГ вместо родного `<input type="date">`
 * (его календарь в WebView открывается системным окном далеко от поля —
 * жалоба 15.09.2026).
 *
 * Модель на сервере — ISO `YYYY-MM-DD`, в поле — маска. Эти переходы и проверяем.
 */
describe('maskDate', () => {
  it('ставит точки по мере ввода', () => {
    expect(maskDate('1')).toBe('1')
    expect(maskDate('12')).toBe('12')
    expect(maskDate('123')).toBe('12.3')
    expect(maskDate('1234')).toBe('12.34')
    expect(maskDate('12345')).toBe('12.34.5')
    expect(maskDate('31122000')).toBe('31.12.2000')
  })

  it('игнорирует всё, кроме цифр, и не берёт лишние', () => {
    expect(maskDate('31.12.2000')).toBe('31.12.2000')
    expect(maskDate('31/12/2000abc')).toBe('31.12.2000')
    expect(maskDate('311220001234')).toBe('31.12.2000')
  })
})

describe('caretAfterDateDigits', () => {
  it('идёт за цифрами (точки ставит маска)', () => {
    expect(caretAfterDateDigits(0)).toBe(0)
    expect(caretAfterDateDigits(2)).toBe(2)
    expect(caretAfterDateDigits(3)).toBe(4) // «12.3»
    expect(caretAfterDateDigits(4)).toBe(5) // «12.34»
    expect(caretAfterDateDigits(5)).toBe(7) // «12.34.5»
    expect(caretAfterDateDigits(8)).toBe(10) // «12.34.5678»
  })

  it('не выходит за длину маски', () => {
    expect(caretAfterDateDigits(20)).toBe(10)
    expect(caretAfterDateDigits(-3)).toBe(0)
  })
})

describe('dateToIso / isoToDateMask', () => {
  it('маска → ISO для сервера', () => {
    expect(dateToIso('31.12.2000')).toBe('2000-12-31')
  })

  it('неполная дата не превращается в ISO', () => {
    expect(dateToIso('31.12')).toBe('')
    expect(dateToIso('')).toBe('')
  })

  it('ISO → маска для поля', () => {
    expect(isoToDateMask('2000-12-31')).toBe('31.12.2000')
    expect(isoToDateMask('2000-12-31T00:00:00')).toBe('31.12.2000')
    expect(isoToDateMask(null)).toBe('')
    expect(isoToDateMask('мусор')).toBe('')
  })
})

describe('validateBirthDate', () => {
  const today = new Date(2026, 8, 15) // 15 сентября 2026

  it('пустое значение допустимо — поле необязательное', () => {
    expect(validateBirthDate('', today)).toBeNull()
    expect(validateBirthDate('  ', today)).toBeNull()
  })

  it('неполную дату просит добить', () => {
    expect(validateBirthDate('31.12', today)).toBe('Введите дату целиком: ДД.ММ.ГГГГ')
  })

  it('существующую дату в прошлом принимает', () => {
    expect(validateBirthDate('31.12.2000', today)).toBeNull()
    expect(validateBirthDate('29.02.2000', today)).toBeNull() // високосный
  })

  it('несуществующую дату отклоняет (в т.ч. 29 февраля невисокосного года)', () => {
    expect(validateBirthDate('31.02.2000', today)).toBe('Такой даты не существует')
    expect(validateBirthDate('29.02.2001', today)).toBe('Такой даты не существует')
    expect(validateBirthDate('00.01.2000', today)).toBe('День — от 01 до 31')
    expect(validateBirthDate('01.13.2000', today)).toBe('Месяц — от 01 до 12')
  })

  it('дату из будущего не пропускает', () => {
    expect(validateBirthDate('01.01.2027', today)).toBe('Дата рождения не может быть в будущем')
  })

  it('слишком далёкий год не пропускает', () => {
    expect(validateBirthDate('01.01.1899', today)).toBe('Год не раньше 1900')
  })
})
