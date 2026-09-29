import { describe, expect, it } from 'vitest'

import { menuAnchor, SYSTEM_SELECTION_BAR_HEIGHT } from '@/utils/selectionMenu'

/**
 * Постановка панели формата по выделению.
 *
 * Владелец (29.09.2026): «в веб версии меню слетает куда-то в центр, а не рядом с
 * выделением», «его не видно, оно снизу — надо сверху», а потом «при выделении
 * текста системная панель в мобилке мешает нашей панели». Поэтому проверяем: панель
 * идёт к выделению (а не к центру поля), на компьютере встаёт над строкой, а на
 * телефоне — под строку или выше поля, где системной панели нет.
 *
 * Габарит панели для проверок: семь подписей в две-три строки.
 */
const PANEL = { width: 200, height: 60 }

/** Обычная строка ввода: поле у самого низа экрана, лента выше (высота в 1 строку). */
const FIELD_AT_BOTTOM = { width: 900, top: 700, height: 44 }

describe('постановка панели формата по выделению', () => {
  it('идёт за выделением, а не к центру поля', () => {
    // Середина поля: панель ровно над выделенным словом.
    expect(menuAnchor({ left: 420, top: 100, height: 20 }, PANEL, FIELD_AT_BOTTOM).left).toBe(420)
    // Ближе к правому краю — панель сдвигается только на свою половину.
    expect(menuAnchor({ left: 880, top: 100, height: 20 }, PANEL, FIELD_AT_BOTTOM).left).toBe(800)
    expect(menuAnchor({ left: 2, top: 100, height: 20 }, PANEL, FIELD_AT_BOTTOM).left).toBe(100)
  })

  it('на компьютере встаёт над выделением: снизу её закрывала бы клавиатура', () => {
    const anchor = menuAnchor({ left: 40, top: 12, height: 20 }, PANEL, FIELD_AT_BOTTOM)
    expect(anchor.side).toBe('above-selection')
    expect(anchor.top).toBe(12)
  })

  it('опускается под строку, только если сверху нет места в окне', () => {
    // Развёрнутый ввод: поле начинается у верха экрана, выделена первая строка.
    const anchor = menuAnchor({ left: 40, top: 6, height: 20 }, PANEL, {
      width: 360,
      top: 0,
      height: 400
    })
    expect(anchor.side).toBe('below-selection')
    expect(anchor.top).toBe(26)
  })

  it('место сверху считает по окну, а не внутри поля', () => {
    // Выделена первая строка обычной строки ввода: над полем ещё вся лента,
    // поэтому панель встаёт сверху (раньше она падала под поле и её не было видно).
    expect(menuAnchor({ left: 40, top: 2, height: 20 }, PANEL, FIELD_AT_BOTTOM).side).toBe(
      'above-selection'
    )
  })

  it('панель шире поля (узкий телефон) — встаёт по центру поля', () => {
    expect(
      menuAnchor({ left: 3, top: 40, height: 20 }, PANEL, { width: 120, top: 400, height: 44 }).left
    ).toBe(100)
  })
})

describe('телефон: системная панель выделения не закрывает нашу', () => {
  /** Высокое поле (развёрнутый ввод или большой черновик). */
  const TALL_FIELD = { width: 360, top: 100, height: 400 }

  it('уходит ПОД строку выделения — системная панель висит над текстом', () => {
    const anchor = menuAnchor({ left: 40, top: 200, height: 20 }, PANEL, TALL_FIELD, 8, true)
    expect(anchor.side).toBe('below-selection')
    expect(anchor.top).toBe(220)
  })

  it('в коротком поле уходит ВЫШЕ поля — с запасом на системную панель', () => {
    // Ниже выделения в 44-пиксельном поле места нет, а над выделением стоит системная
    // панель браузера: остаётся только над полем.
    const anchor = menuAnchor({ left: 40, top: 7, height: 20 }, PANEL, FIELD_AT_BOTTOM, 8, true)
    expect(anchor.side).toBe('above-field')
    expect(anchor.top).toBe(0)
  })

  it('запас над полем не меньше высоты системной панели', () => {
    // Кнопки «Копировать/Вырезать/Вставить» — ~48 px: меньше запаса делать нельзя,
    // иначе панель снова окажется под ними.
    expect(SYSTEM_SELECTION_BAR_HEIGHT).toBeGreaterThanOrEqual(48)
  })
})
