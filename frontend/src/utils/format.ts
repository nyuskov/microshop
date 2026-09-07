/** Утилиты форматирования дат, присутствия и размеров. */

export const toDate = (value: string | Date): Date =>
  typeof value === 'string' ? new Date(value) : value

const isToday = (date: Date): boolean => date.toDateString() === new Date().toDateString()

const isYesterday = (date: Date): boolean => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return date.toDateString() === yesterday.toDateString()
}

export const formatChatTime = (timestamp: string): string => {
  const date = toDate(timestamp)
  if (isToday(date)) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  if (isYesterday(date)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export const formatMsgTime = (timestamp: string): string =>
  toDate(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

export const dayLabel = (date: Date): string => {
  if (isToday(date)) return 'Сегодня'
  if (isYesterday(date)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
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

/** Текст «был(а) … назад» / «в сети» по last_seen. */
export const lastSeenLabel = (value?: string | null, allowOnline = true): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds <= ONLINE_WINDOW_SECONDS) return allowOnline ? 'в сети' : 'был(а) только что'
  if (seconds < 60) return 'был(а) только что'
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    return `был(а) ${minutes} ${pluralRu(minutes, 'минуту', 'минуты', 'минут')} назад`
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return `был(а) ${hours} ${pluralRu(hours, 'час', 'часа', 'часов')} назад`
  }
  const days = Math.floor(seconds / 86400)
  if (days === 1) return 'был(а) вчера'
  if (days < 30) {
    return `был(а) ${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`
  }
  const months = Math.floor(days / 30)
  if (months < 12) {
    return `был(а) ${months} ${pluralRu(months, 'месяц', 'месяца', 'месяцев')} назад`
  }
  const years = Math.floor(days / 365)
  return `был(а) ${years} ${pluralRu(years, 'год', 'года', 'лет')} назад`
}

export const formatBytes = (size: number | null): string => {
  if (!size) return ''
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}
