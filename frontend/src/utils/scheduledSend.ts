/**
 * Отложенная отправка: готовые варианты времени и подписи к ним.
 *
 * Отдельный модуль, потому что тут две вещи, которые легко сделать неправильно:
 *
 * 1. Пресеты считаются от **текущего** момента, а не от полуночи: «сегодня в
 *    21:00» в 22:00 уже не вариант — такой пункт просто не показываем.
 * 2. Время на сервер уходит в UTC (`send_at`), а человеку показываем местное —
 *    поэтому подписи строим из `Date`, пояс устройства применяет браузер.
 *
 * Сервер принимает отправку не раньше чем через 10 секунд и не позже 30 дней
 * (см. `api_v1/messages/crud.py`), поэтому здесь нет пунктов «через минуту» или
 * «через год».
 */

/** Готовый вариант «отправить позже»: подпись в меню и момент отправки. */
export interface SchedulePreset {
  label: string
  at: Date
}

/** Час утренней отправки для пресетов «в 9:00» (как в мессенджерах). */
const MORNING_HOUR = 9

const atTime = (day: Date, hour: number, minute = 0): Date => {
  const moment = new Date(day)
  moment.setHours(hour, minute, 0, 0)
  return moment
}

const timeLabel = (date: Date): string =>
  date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

const isSameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString()

/**
 * Варианты «отправить позже» для меню на кнопке отправки.
 *
 * Порядок — от ближайшего к дальней: «через час» нужен чаще всего. Если
 * назначенное время уже прошло (вечером «сегодня в 9:00»), пункт пропускаем, а
 * не показываем недостижимое время: сервер такой запрос отклонит.
 */
export const schedulePresets = (now: Date = new Date()): SchedulePreset[] => {
  const presets: SchedulePreset[] = [
    { label: 'Через час', at: new Date(now.getTime() + 60 * 60 * 1000) }
  ]

  const todayAtMorning = atTime(now, MORNING_HOUR)
  if (todayAtMorning.getTime() > now.getTime()) {
    presets.push({ label: `Сегодня в ${timeLabel(todayAtMorning)}`, at: todayAtMorning })
  }

  const tomorrowAtMorning = atTime(new Date(now.getTime() + 24 * 60 * 60 * 1000), MORNING_HOUR)
  presets.push({ label: `Завтра в ${timeLabel(tomorrowAtMorning)}`, at: tomorrowAtMorning })

  return presets
}

/** Момент отправки в том виде, в каком его ждёт сервер (UTC, ISO). */
export const scheduledSendAt = (at: Date): string => at.toISOString()

/**
 * Человеческая подпись к отложенному сообщению: «через 2 ч», «сегодня в 21:30»,
 * «завтра в 9:00», «12 сен в 9:00».
 */
export const formatScheduledAt = (value: string | Date, now: Date = new Date()): string => {
  const at = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(at.getTime())) return ''
  const minutes = Math.round((at.getTime() - now.getTime()) / 60000)

  if (minutes <= 0) return 'сейчас'
  if (minutes < 60) return `через ${minutes} мин`

  const hours = Math.round(minutes / 60)
  if (isSameDay(at, now)) {
    // Меньше трёх часов — понятнее в часах; ближе к вечеру точное время важнее.
    return hours <= 3 ? `через ${hours} ч` : `сегодня в ${timeLabel(at)}`
  }

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  if (isSameDay(at, tomorrow)) return `завтра в ${timeLabel(at)}`
  return `${at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${timeLabel(at)}`
}
