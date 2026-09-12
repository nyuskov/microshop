/**
 * Навигация стрелками по меню (`utils/menu.ts`).
 *
 * Арифметика границ проверяется отдельно от разметки: в компоненте остаётся
 * только вызов и перевод фокуса.
 */

import { describe, expect, it } from 'vitest'

import { menuFocusTarget } from '@/utils/menu'

describe('menuFocusTarget', () => {
  it('стрелка вниз идёт к следующему пункту', () => {
    expect(menuFocusTarget('ArrowDown', 0, 5)).toBe(1)
    expect(menuFocusTarget('ArrowDown', 3, 5)).toBe(4)
  })

  it('на последнем пункте вниз уводит на первый', () => {
    expect(menuFocusTarget('ArrowDown', 4, 5)).toBe(0)
  })

  it('стрелка вверх идёт к предыдущему, с первого — на последний', () => {
    expect(menuFocusTarget('ArrowUp', 2, 5)).toBe(1)
    expect(menuFocusTarget('ArrowUp', 0, 5)).toBe(4)
  })

  it('Home и End ведут на края', () => {
    expect(menuFocusTarget('Home', 3, 5)).toBe(0)
    expect(menuFocusTarget('End', 1, 5)).toBe(4)
  })

  it('если фокус вне меню, стрелки ведут к краю, а не в пустоту', () => {
    expect(menuFocusTarget('ArrowDown', -1, 5)).toBe(0)
    expect(menuFocusTarget('ArrowUp', -1, 5)).toBe(4)
  })

  it('в пустом меню двигаться некуда', () => {
    expect(menuFocusTarget('ArrowDown', -1, 0)).toBeNull()
    expect(menuFocusTarget('Home', 0, 0)).toBeNull()
  })

  it('посторонние клавиши не перехватываем', () => {
    expect(menuFocusTarget('Tab', 1, 5)).toBeNull()
    expect(menuFocusTarget('Escape', 1, 5)).toBeNull()
    expect(menuFocusTarget('Enter', 1, 5)).toBeNull()
  })

  it('в меню из одного пункта стрелки остаются на нём', () => {
    expect(menuFocusTarget('ArrowDown', 0, 1)).toBe(0)
    expect(menuFocusTarget('ArrowUp', 0, 1)).toBe(0)
  })
})
