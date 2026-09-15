import { describe, expect, it } from 'vitest'

import { filterOptions, indexOfValue, moveHighlight, placeLayer } from '@/utils/select'

/**
 * Логика выпадающего списка (SelectField.vue).
 *
 * Свой список нужен вместо родного `<select>`: окно родного списка рисует
 * браузер, и в WebView оно открывается системным окошком далеко от поля
 * (жалоба 15.09.2026). Поэтому позиционирование считаем сами — и проверяем его
 * без DOM: jsdom размеров не считает.
 */
const OPTIONS = [
  { value: '', label: 'Не выбран' },
  { value: 'ru', label: 'Русский' },
  { value: 'de', label: 'Deutsch' }
]

describe('indexOfValue', () => {
  it('находит вариант по значению', () => {
    expect(indexOfValue(OPTIONS, 'de')).toBe(2)
    expect(indexOfValue(OPTIONS, '')).toBe(0)
  })

  it('возвращает -1, если значения нет (тогда показываем подсказку поля)', () => {
    expect(indexOfValue(OPTIONS, 'kz')).toBe(-1)
  })
})

describe('moveHighlight', () => {
  it('идёт по кругу в обе стороны', () => {
    expect(moveHighlight(0, 3, 1)).toBe(1)
    expect(moveHighlight(2, 3, 1)).toBe(0)
    expect(moveHighlight(0, 3, -1)).toBe(2)
  })

  it('без подсветки стартует с края — с клавиатуры человек не улетает «в никуда»', () => {
    expect(moveHighlight(-1, 3, 1)).toBe(0)
    expect(moveHighlight(-1, 3, -1)).toBe(2)
  })

  it('пустой список — подсвечивать нечего', () => {
    expect(moveHighlight(0, 0, 1)).toBe(-1)
  })
})

describe('filterOptions', () => {
  it('без запроса отдаёт все варианты', () => {
    expect(filterOptions(OPTIONS, '   ')).toHaveLength(3)
  })

  it('ищет по подстроке без учёта регистра', () => {
    expect(filterOptions(OPTIONS, 'deu').map((option) => option.value)).toEqual(['de'])
    expect(filterOptions(OPTIONS, 'РУС').map((option) => option.value)).toEqual(['ru'])
  })
})

describe('placeLayer: где открыть список', () => {
  const viewport = { width: 1000, height: 800 }

  it('под полем, если снизу хватает места', () => {
    const box = placeLayer({ top: 100, left: 40, width: 300, height: 40 }, viewport, 200)
    expect(box.top).toBe(146) // 100 + 40 + зазор 6
    expect(box.left).toBe(40)
    expect(box.width).toBe(300)
    expect(box.maxHeight).toBe(200)
  })

  it('над полем, если снизу места почти нет (низ экрана)', () => {
    const box = placeLayer({ top: 760, left: 40, width: 300, height: 40 }, viewport, 200)
    expect(box.top).toBeLessThan(760)
    expect(box.top + box.maxHeight).toBeLessThanOrEqual(754)
  })

  it('не вылезает за правый и левый край', () => {
    const right = placeLayer({ top: 100, left: 900, width: 300, height: 40 }, viewport, 120)
    expect(right.left + right.width).toBeLessThanOrEqual(viewport.width - 8)
    const left = placeLayer({ top: 100, left: -20, width: 300, height: 40 }, viewport, 120)
    expect(left.left).toBe(8)
  })

  it('очень длинный список ограничен по высоте', () => {
    const box = placeLayer({ top: 100, left: 40, width: 300, height: 40 }, viewport, 4000)
    expect(box.maxHeight).toBeLessThanOrEqual(320)
  })
})
