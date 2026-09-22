/**
 * Раскладка «Статистики чата»: столбики по дням и доли участников.
 *
 * Логика чистая (числа приходят с сервера, время — аргументом), потому что от
 * неё зависит то, что человек видит на графике: пропущенный день не должен
 * сдвигать столбики, а «0» и «мало» должны отличаться визуально.
 */

import { plural } from '@/i18n'
import type { ChatStatsDay, ChatStatsSender } from '@/services/chatService'
import { parseServerTime } from '@/utils/format'

/** Сколько дней показывает график (столько же считает сервер). */
export const STATS_DAYS = 30

/** Минимальная высота столбика для ненулевого дня: иначе «1» выглядело бы как «0». */
const MIN_VISIBLE_PERCENT = 6

export interface StatsBar {
  /** Локальная дата дня в формате ISO (`2026-09-17`). */
  date: string
  count: number
  /** Высота столбика в процентах от максимума (0 — сообщений не было). */
  heightPercent: number
  /** Подпись для подсказки: «17 сентября, 12 сообщений». */
  title: string
}

/** Локальная дата (ISO) для момента времени: пояс устройства, не UTC. */
const localIsoDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dayTitle = (date: Date, count: number): string => {
  const label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  if (count === 0) return `${label}: сообщений не было`
  return `${label}: ${count} ${plural(count, ['сообщение', 'сообщения', 'сообщений'], ['message', 'messages'])}`
}

/**
 * Строит столбики за последние `days` дней, включая дни без сообщений.
 *
 * Сервер присылает только дни с активностью (это дешевле), поэтому дыры
 * заполняем нулями: иначе график «сжимался» бы и врал о давности переписки.
 * Дни сервер считает в поясе устройства (см. `offset_minutes` в запросе), и
 * сравнение идёт по локальной дате — так столбики совпадают с календарём
 * человека, а не с UTC.
 */
export function statsBars(
  days: ChatStatsDay[],
  { now = new Date(), count = STATS_DAYS }: { now?: Date; count?: number } = {}
): StatsBar[] {
  const counts = new Map<string, number>()
  for (const day of days) counts.set(day.date, day.count)

  const bars: StatsBar[] = []
  for (let shift = count - 1; shift >= 0; shift -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - shift)
    const key = localIsoDate(date)
    const value = counts.get(key) ?? 0
    bars.push({
      date: key,
      count: value,
      heightPercent: 0,
      title: dayTitle(date, value)
    })
  }

  const max = bars.reduce((top, bar) => Math.max(top, bar.count), 0)
  for (const bar of bars) {
    if (bar.count <= 0 || max <= 0) continue
    bar.heightPercent = Math.max(MIN_VISIBLE_PERCENT, Math.round((bar.count / max) * 100))
  }
  return bars
}

/** Доля участника от самого активного (в процентах) — для полоски в «топе». */
export function senderShare(count: number, senders: ChatStatsSender[]): number {
  const max = senders.reduce((top, row) => Math.max(top, row.count), 0)
  if (max <= 0 || count <= 0) return 0
  return Math.max(MIN_VISIBLE_PERCENT, Math.round((count / max) * 100))
}

/** Сколько сообщений в среднем за день с активностью (для подписи под графиком). */
export function dailyAverage(days: ChatStatsDay[]): number {
  const active = days.filter((day) => day.count > 0)
  if (!active.length) return 0
  const total = active.reduce((sum, day) => sum + day.count, 0)
  return Math.round(total / active.length)
}

/** Подпись периода «первое — последнее сообщение» (пусто, если сообщений нет). */
export function statsPeriod(first: string | null, last: string | null): string {
  if (!first || !last) return ''
  const start = parseServerTime(first)
  const end = parseServerTime(last)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
  const format = (date: Date): string =>
    date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const startLabel = format(start)
  const endLabel = format(end)
  return startLabel === endLabel ? startLabel : `${startLabel} — ${endLabel}`
}
