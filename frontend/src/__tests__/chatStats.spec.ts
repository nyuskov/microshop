import { describe, expect, it } from 'vitest'

import type { ChatStatsDay, ChatStatsSender } from '@/services/chatService'
import { dailyAverage, senderShare, STATS_DAYS, statsBars, statsPeriod } from '@/utils/chatStats'

/**
 * Раскладка «Статистики чата».
 *
 * Сервер отдаёт только дни с активностью — недостающие заполняет клиент, иначе
 * график сжимался бы и врал о давности переписки. Плюс «1 сообщение» и «0»
 * должны отличаться на вид, поэтому у ненулевого дня есть минимальная высота.
 */

const day = (date: string, count: number): ChatStatsDay => ({ date, count })

const localIso = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${dayOfMonth}`
}

describe('statsBars', () => {
  const now = new Date(2026, 8, 17, 12, 0, 0) // 17 сентября 2026, локально

  it('рисует ровно 30 столбиков и заполняет пустые дни нулями', () => {
    const bars = statsBars([], { now })
    expect(bars).toHaveLength(STATS_DAYS)
    expect(bars.every((bar) => bar.count === 0)).toBe(true)
    expect(bars[0].date).toBe(localIso(new Date(2026, 7, 19)))
    expect(bars[bars.length - 1].date).toBe(localIso(now))
  })

  it('пропущенный день не сдвигает остальные: даты идут подряд', () => {
    const bars = statsBars([day(localIso(now), 4), day(localIso(new Date(2026, 8, 15)), 2)], {
      now
    })
    const counts = bars.map((bar) => bar.count)
    expect(counts[counts.length - 1]).toBe(4)
    // 15 сентября — на два дня раньше последнего.
    expect(counts[counts.length - 3]).toBe(2)
    for (let index = 1; index < bars.length; index += 1) {
      const previous = new Date(`${bars[index - 1].date}T12:00:00`)
      const current = new Date(`${bars[index].date}T12:00:00`)
      const diff = (current.getTime() - previous.getTime()) / 86_400_000
      expect(Math.round(diff)).toBe(1)
    }
  })

  it('высота — доля от максимума, у ненулевого дня есть минимум', () => {
    const bars = statsBars([day(localIso(now), 10), day(localIso(new Date(2026, 8, 16)), 1)], {
      now
    })
    const last = bars[bars.length - 1]
    const before = bars[bars.length - 2]
    expect(last.heightPercent).toBe(100)
    // «1» не должно сливаться с нулём — есть минимальная высота.
    expect(before.heightPercent).toBeGreaterThan(0)
    expect(before.heightPercent).toBeLessThan(20)
  })

  it('в подписи дня человеческое число сообщений', () => {
    const bars = statsBars([day(localIso(now), 1)], { now })
    expect(bars[bars.length - 1].title).toContain('1 сообщение')
    const empty = bars[0]
    expect(empty.title).toContain('сообщений не было')
  })

  it('дни вне окна (старше 30 дней) не показываем', () => {
    const bars = statsBars([day(localIso(new Date(2026, 6, 1)), 99)], { now })
    expect(bars.reduce((sum, bar) => sum + bar.count, 0)).toBe(0)
  })
})

describe('senderShare', () => {
  const senders: ChatStatsSender[] = [
    { user_id: 1, name: 'Аня', count: 10 },
    { user_id: 2, name: 'Боря', count: 5 }
  ]

  it('доля считается от самого активного участника', () => {
    expect(senderShare(10, senders)).toBe(100)
    expect(senderShare(5, senders)).toBe(50)
  })

  it('у нуля нет полоски, а у слабого участника — заметная', () => {
    expect(senderShare(0, senders)).toBe(0)
    expect(senderShare(1, senders)).toBeGreaterThan(0)
  })
})

describe('dailyAverage', () => {
  it('считает среднее по дням с сообщениями', () => {
    expect(dailyAverage([day('2026-09-16', 4), day('2026-09-17', 6), day('2026-09-15', 0)])).toBe(5)
  })

  it('без сообщений — ноль', () => {
    expect(dailyAverage([])).toBe(0)
  })
})

describe('statsPeriod', () => {
  it('один день — одна дата, разные — диапазон', () => {
    expect(statsPeriod('2026-09-17T10:00:00Z', '2026-09-17T18:00:00Z')).not.toContain('—')
    expect(statsPeriod('2026-09-10T10:00:00Z', '2026-09-17T18:00:00Z')).toContain('—')
  })

  it('без сообщений подписи нет', () => {
    expect(statsPeriod(null, null)).toBe('')
    expect(statsPeriod('2026-09-10T10:00:00Z', null)).toBe('')
  })
})
