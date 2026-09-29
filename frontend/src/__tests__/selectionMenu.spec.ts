import { describe, expect, it } from 'vitest'

import { menuAnchor } from '@/utils/selectionMenu'

/**
 * Постановка панели формата по выделению.
 *
 * Владелец (29.09.2026): «в веб версии меню слетает куда-то в центр, а не рядом с
 * выделением», а потом «его не видно, оно снизу — надо сверху». Поэтому проверяем
 * три вещи: панель идёт к выделению (а не к центру поля), встаёт НАД строкой и не
 * уезжает за верх окна.
 *
 * Габарит панели для проверок: шесть-семь подписей в две строки.
 */
const PANEL = { width: 200, height: 60 }

/** Обычная строка ввода: поле у самого низа экрана, лента выше. */
const FIELD_AT_BOTTOM = { width: 900, top: 700 }

describe('постановка панели формата по выделению', () => {
  it('идёт за выделением, а не к центру поля', () => {
    // Середина поля: панель ровно над выделенным словом.
    expect(menuAnchor({ left: 420, top: 100, height: 20 }, PANEL, FIELD_AT_BOTTOM).left).toBe(420)
    // Ближе к правому краю — панель сдвигается только на свою половину.
    expect(menuAnchor({ left: 880, top: 100, height: 20 }, PANEL, FIELD_AT_BOTTOM).left).toBe(800)
    expect(menuAnchor({ left: 2, top: 100, height: 20 }, PANEL, FIELD_AT_BOTTOM).left).toBe(100)
  })

  it('встаёт над выделением: снизу её закрывала бы клавиатура', () => {
    const anchor = menuAnchor({ left: 40, top: 12, height: 20 }, PANEL, FIELD_AT_BOTTOM)
    expect(anchor.above).toBe(true)
    expect(anchor.top).toBe(12)
  })

  it('опускается под строку, только если сверху нет места в окне', () => {
    // Развёрнутый ввод: поле начинается у верха экрана, выделена первая строка.
    const anchor = menuAnchor({ left: 40, top: 6, height: 20 }, PANEL, { width: 360, top: 0 })
    expect(anchor.above).toBe(false)
    expect(anchor.top).toBe(26)
  })

  it('место сверху считает по окну, а не внутри поля', () => {
    // Выделена первая строка обычной строки ввода: над полем ещё вся лента,
    // поэтому панель встаёт сверху (раньше она падала под поле и её не было видно).
    expect(menuAnchor({ left: 40, top: 2, height: 20 }, PANEL, FIELD_AT_BOTTOM).above).toBe(true)
  })

  it('панель шире поля (узкий телефон) — встаёт по центру поля', () => {
    expect(menuAnchor({ left: 3, top: 40, height: 20 }, PANEL, { width: 120, top: 400 }).left).toBe(
      100
    )
  })
})
