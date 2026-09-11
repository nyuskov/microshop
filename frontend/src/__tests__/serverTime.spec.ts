/**
 * Часовой пояс в отображении времени.
 *
 * Сервер живёт в UTC, но часть значений (время сообщения) приходит БЕЗ смещения:
 * такие колонки в БД — `timestamp without time zone`. Браузер по стандарту
 * трактует строку без смещения как локальное время — в UTC+3 сообщение
 * показывалось на три часа раньше отправленного. Проверяем, что `parseServerTime`
 * помечает «наивные» значения UTC, а значения со смещением не трогает.
 */
import { describe, expect, it } from 'vitest'

import { formatMsgTime, parseServerTime } from '@/utils/format'

const NAIVE = '2026-09-10T18:59:11.428769'
const AWARE = '2026-09-10T18:59:11.428769Z'

describe('parseServerTime', () => {
  it('считает строку без смещения временем UTC', () => {
    expect(parseServerTime(NAIVE).getTime()).toBe(Date.parse(AWARE))
  })

  it('не меняет строку со смещением', () => {
    expect(parseServerTime(AWARE).getTime()).toBe(Date.parse(AWARE))
    expect(parseServerTime('2026-09-10T21:59:11.428769+03:00').getTime()).toBe(
      Date.parse('2026-09-10T18:59:11.428769Z')
    )
  })

  it('понимает и формат с пробелом вместо «T»', () => {
    expect(parseServerTime('2026-09-10 18:59:11').getTime()).toBe(
      Date.parse('2026-09-10T18:59:11Z')
    )
  })

  it('не меняет Date как есть', () => {
    const date = new Date('2026-09-10T18:59:11.428Z')
    expect(parseServerTime(date)).toBe(date)
  })
})

describe('время сообщения', () => {
  it('naive-строка показывается так же, как та же строка со «Z»', () => {
    // Сравниваем два отображения между собой: так тест не зависит от пояса
    // машины, где он запущен.
    expect(formatMsgTime(NAIVE)).toBe(formatMsgTime(AWARE))
  })
})
