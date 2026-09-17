/**
 * Расписание тёмной темы: «тёмная с 22:00 до 07:00, днём светлая».
 *
 * Зачем: тема «Системная» следует настройке телефона, но она не всегда совпадает
 * с режимом дня — многие держат систему светлой, а вечером хотят тёмный
 * мессенджер (и наоборот). Расписание даёт это без ручного переключения.
 *
 * Время хранится в МИНУТАХ от полуночи (как тихие часы): не нужно разбирать
 * строки «23:30», а окно может идти через полночь. Здесь только чистые функции —
 * таймер и перерисовка живут в `stores/theme.ts`.
 */
import { formatMinutes, timeOptions } from '@/utils/quietHours'

/** Шаг выбора: час. Тему не нужно настраивать точнее, а список короче. */
export const SCHEDULE_STEP_MINUTES = 60

/** Значения по умолчанию: тёмная с 22:00 до 07:00 — привычный вечерний режим. */
export const SCHEDULE_DEFAULT_START = 22 * 60
export const SCHEDULE_DEFAULT_END = 7 * 60

/** Варианты времени для списка (00:00, 01:00, … 23:00). */
export const scheduleTimeOptions = (step = SCHEDULE_STEP_MINUTES) => timeOptions(step)

/** ЧЧ:ММ из минут от полуночи (для подписи настройки). */
export const formatScheduleTime = formatMinutes

/** Окно идёт через полночь (22:00 → 07:00). */
export const crossesMidnight = (start: number, end: number): boolean => start > end

/** Локальные минуты от полуночи у конкретного момента. */
const localMinutes = (now: Date): number => now.getHours() * 60 + now.getMinutes()

/**
 * Должна ли сейчас действовать тёмная тема.
 *
 * Совпавшие границы считаем выключенным расписанием (а не «тёмной сутки»):
 * иначе случайное «с 00:00 до 00:00» запирало бы пользователя в тёмной теме, а
 * настройку с одинаковыми значениями он видит как «ничего не выбрано».
 */
export const isDarkBySchedule = (now: Date, start: number, end: number): boolean => {
  if (start === end) return false
  const minutes = localMinutes(now)
  return crossesMidnight(start, end)
    ? minutes >= start || minutes < end
    : minutes >= start && minutes < end
}

/** Ближайший момент, когда окно переключится (начало или конец). */
const nextBoundary = (now: Date, minutes: number): Date => {
  const boundary = new Date(now)
  boundary.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  if (boundary.getTime() <= now.getTime()) boundary.setDate(boundary.getDate() + 1)
  return boundary
}

/**
 * Сколько миллисекунд ждать до смены темы.
 *
 * Нужно, чтобы не будить приложение каждую минуту: будильник ставится ровно на
 * границу окна. Минимум 1 секунда — иначе на самой границе (или при переводе
 * часов) таймер срабатывал бы бесконечно в цикле.
 */
export const msUntilScheduleChange = (now: Date, start: number, end: number): number => {
  if (start === end) return 0
  const startAt = nextBoundary(now, start).getTime()
  const endAt = nextBoundary(now, end).getTime()
  return Math.max(1000, Math.min(startAt, endAt) - now.getTime())
}

/**
 * Подпись настройки: видно, что именно выбрано, не открывая списки.
 *
 * Отдаём и текущее состояние («сейчас тёмная»), потому что расписание означает
 * разное в разное время суток, и без этой подсказки непонятно, действует ли оно
 * прямо сейчас.
 */
export const scheduleSummary = (start: number, end: number, now = new Date()): string => {
  if (start === end) {
    return 'Границы совпали — тема меняться не будет'
  }
  const window = `с ${formatScheduleTime(start)} до ${formatScheduleTime(end)}`
  const night = crossesMidnight(start, end) ? ' (через ночь)' : ''
  const current = isDarkBySchedule(now, start, end) ? 'сейчас тёмная' : 'сейчас светлая'
  return `Тёмная ${window}${night}; ${current}`
}
