import { describe, expect, it } from 'vitest'
import { canScrollX, scrollEdges, wheelScrollLeft } from '@/utils/hScroll'

/**
 * Прокрутка горизонтального ряда (чипы фильтров) мышью.
 *
 * Повод: пользователь сообщил 15.09.2026, что до чипа «Архив» в веб-версии
 * «не добраться» — ряд из шести чипов шире панели, палец его листает, а обычное
 * колесо мыши нет (прокручивается список чатов). Плюс затухание у правого края
 * рисовалось всегда и в конце прокрутки прятало текст чипа.
 */
const row = (partial: { scrollLeft?: number; scrollWidth?: number; clientWidth?: number }) => ({
  scrollLeft: 0,
  scrollWidth: 433,
  clientWidth: 378,
  ...partial
})

describe('canScrollX', () => {
  it('видит переполнение и его отсутствие', () => {
    expect(canScrollX(row({}))).toBe(true)
    expect(canScrollX(row({ scrollWidth: 378 }))).toBe(false)
  })

  it('не считает переполнением дробный пиксель', () => {
    // Разные шрифты дают 378.4 вместо 378 — иначе маска мигала бы на ровном ряду.
    expect(canScrollX(row({ scrollWidth: 379 }))).toBe(false)
    expect(canScrollX(row({ scrollWidth: 385 }))).toBe(true)
  })
})

describe('scrollEdges', () => {
  it('в начале прокрутки скрыто только справа', () => {
    expect(scrollEdges(row({}))).toEqual({ start: false, end: true })
  })

  it('в конце скрыто только слева', () => {
    expect(scrollEdges(row({ scrollLeft: 55 }))).toEqual({ start: true, end: false })
  })

  it('в середине скрыто с двух сторон', () => {
    expect(scrollEdges(row({ scrollLeft: 30 }))).toEqual({ start: true, end: true })
  })

  it('влезающий ряд не даёт ни одного затухания', () => {
    expect(scrollEdges(row({ scrollWidth: 378 }))).toEqual({ start: false, end: false })
  })
})

describe('wheelScrollLeft', () => {
  it('вертикальное колесо мыши сдвигает ряд вбок', () => {
    expect(wheelScrollLeft(row({}), 0, 40)).toBe(40)
  })

  it('горизонтальный жест трекпада (deltaX) имеет приоритет', () => {
    expect(wheelScrollLeft(row({}), 30, 5)).toBe(30)
  })

  it('не выкручивает ряд за границы', () => {
    expect(wheelScrollLeft(row({ scrollLeft: 50 }), 0, 100)).toBe(55)
    expect(wheelScrollLeft(row({ scrollLeft: 5 }), 0, -100)).toBe(0)
  })

  it('на влезающем ряду прокрутка остаётся нулевой', () => {
    expect(wheelScrollLeft(row({ scrollWidth: 378 }), 0, 60)).toBe(0)
  })
})
