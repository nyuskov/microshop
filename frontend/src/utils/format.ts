/** Утилиты форматирования дат, присутствия и размеров. */

import { dateLocale, plural, t } from '@/i18n'

/**
 * Разбирает время, пришедшее с сервера, с учётом его часового пояса.
 *
 * Сервер живёт в UTC, но часть значений уходит БЕЗ смещения
 * (``2026-09-10T18:59:11.428769`` — такие колонки в БД хранятся как
 * ``timestamp without time zone``). По стандарту ISO 8601 браузер считает такую
 * строку ЛОКАЛЬНЫМ временем, поэтому в UTC+3 сообщение показывалось на три часа
 * раньше отправленного.
 *
 * Здесь строка без смещения явно помечается как UTC — дальше всё форматирование
 * (``toLocaleTimeString`` и т. п.) само переводит время в пояс устройства.
 * Значения со смещением (``Z`` / ``+00:00``) не трогаем.
 */
export const parseServerTime = (value: string | Date): Date => {
  if (typeof value !== 'string') return value
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  if (hasZone) return new Date(value)
  // «2026-09-10 18:59:11» → «2026-09-10T18:59:11Z» (пробел тоже допустим).
  return new Date(`${value.replace(' ', 'T')}Z`)
}

export const toDate = (value: string | Date): Date => parseServerTime(value)

const isToday = (date: Date): boolean => date.toDateString() === new Date().toDateString()

const isYesterday = (date: Date): boolean => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return date.toDateString() === yesterday.toDateString()
}

export const formatChatTime = (timestamp: string): string => {
  const date = toDate(timestamp)
  if (isToday(date)) {
    return date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  }
  if (isYesterday(date)) return t('Вчера')
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
}

export const formatMsgTime = (timestamp: string): string =>
  toDate(timestamp).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })

export const dayLabel = (date: Date): string => {
  if (isToday(date)) return t('Сегодня')
  if (isYesterday(date)) return t('Вчера')
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Считаем пользователя «в сети», если last_seen не старше этого времени. */
export const ONLINE_WINDOW_SECONDS = 30

export const pluralRu = (n: number, one: string, few: string, many: string): string => {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few
  return many
}

/** Текст «был(а) … назад» по last_seen.
 *
 * По умолчанию НЕ выдаёт «в сети»: присутствие — это отдельное состояние из
 * WS-канала, а `last_seen` обновляется и когда приложение свёрнуто (heartbeat),
 * поэтому по времени выводить онлайн нельзя — получается ложное «в сети».
 */
export const lastSeenLabel = (value?: string | null, allowOnline = false): string => {
  if (!value) return ''
  const date = parseServerTime(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds <= ONLINE_WINDOW_SECONDS) return allowOnline ? t('в сети') : t('был(а) только что')
  if (seconds < 60) return t('был(а) только что')
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return t('был(а) {count} {noun} назад', {
      count: minutes,
      noun: plural(minutes, ['минуту', 'минуты', 'минут'], ['minute', 'minutes'])
    })
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return t('был(а) {count} {noun} назад', {
      count: hours,
      noun: plural(hours, ['час', 'часа', 'часов'], ['hour', 'hours'])
    })
  }
  const days = Math.floor(seconds / 86400)
  if (days === 1) return t('был(а) вчера')
  if (days < 30) {
    return t('был(а) {count} {noun} назад', {
      count: days,
      noun: plural(days, ['день', 'дня', 'дней'], ['day', 'days'])
    })
  }
  const months = Math.floor(days / 30)
  if (months < 12) {
    return t('был(а) {count} {noun} назад', {
      count: months,
      noun: plural(months, ['месяц', 'месяца', 'месяцев'], ['month', 'months'])
    })
  }
  const years = Math.floor(days / 365)
  return t('был(а) {count} {noun} назад', {
    count: years,
    noun: plural(years, ['год', 'года', 'лет'], ['year', 'years'])
  })
}

export const formatBytes = (size: number | null): string => {
  if (!size) return ''
  if (size < 1024) return t('{size} Б', { size })
  if (size < 1024 * 1024) return t('{size} КБ', { size: Math.round(size / 1024) })
  return t('{size} МБ', { size: (size / (1024 * 1024)).toFixed(1) })
}
