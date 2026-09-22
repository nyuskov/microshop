/**
 * Страны для профиля: полный список и поиск по нему.
 *
 * Проверяем то, на чём легко ошибиться: список должен быть полным (раньше было
 * семь стран), названия — не пустыми, а поиск обязан находить страну и по коду, и
 * по английскому названию, иначе список из 249 строк выглядит сломанным.
 */
import { describe, expect, it } from 'vitest'

import { COUNTRY_CODES, countryName, countryOptions } from '@/utils/countries'
import { filterOptions } from '@/utils/select'

describe('список стран', () => {
  it('содержит все страны ISO 3166-1 alpha-2', () => {
    expect(COUNTRY_CODES.length).toBe(249)
    // Коды уникальны и записаны в верхнем регистре — в этом виде их ждёт сервер.
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length)
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/)
    // Страны, которые раньше были единственными в списке, остались на месте.
    for (const code of ['RU', 'BY', 'KZ', 'US', 'DE', 'ES', 'FR']) {
      expect(COUNTRY_CODES).toContain(code)
    }
  })

  it('называет страны на языке интерфейса', () => {
    expect(countryName('KZ', 'ru-RU')).toBe('Казахстан')
    expect(countryName('KZ', 'en-GB')).toBe('Kazakhstan')
    expect(countryName('US', 'ru-RU')).toBe('США')
    expect(countryName('JP', 'en-GB')).toBe('Japan')
  })

  it('не ломается на неизвестном коде', () => {
    // На сервере могло остаться значение из прежней версии списка.
    expect(countryName('ZZ', 'ru-RU')).toBeTruthy()
  })

  it('сортирует варианты по названию на текущем языке', () => {
    const ru = countryOptions('ru-RU')
    const en = countryOptions('en-GB')
    expect(ru.length).toBe(COUNTRY_CODES.length)
    const sortedRu = [...ru].sort((left, right) => left.label.localeCompare(right.label, 'ru-RU'))
    expect(ru.map((option) => option.label)).toEqual(sortedRu.map((option) => option.label))
    expect(en[0]!.label < en[en.length - 1]!.label).toBe(true)
  })
})

describe('поиск по списку стран', () => {
  const options = countryOptions('ru-RU')

  it('находит страну по русскому названию', () => {
    expect(filterOptions(options, 'казах').map((option) => option.value)).toContain('KZ')
    expect(filterOptions(options, 'казах').map((option) => option.value)).toContain('KZ')
  })

  it('находит страну по коду', () => {
    expect(filterOptions(options, 'kz').map((option) => option.value)).toContain('KZ')
    expect(filterOptions(options, 'DE').map((option) => option.value)).toContain('DE')
  })

  it('находит страну по английскому названию', () => {
    expect(filterOptions(options, 'kazakhstan').map((option) => option.value)).toContain('KZ')
    expect(filterOptions(options, 'germany').map((option) => option.value)).toContain('DE')
  })
})
