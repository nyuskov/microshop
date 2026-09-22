import { t } from '@/i18n'
/**
 * Тихие часы в профиле: варианты времени, подпись и сдвиг часового пояса.
 *
 * Время хранится и передаётся в МИНУТАХ от полуночи (как на сервере): так не
 * нужно разбирать строки «23:30» и легко сравнивать границы окна. Здесь же
 * живёт человеческая подпись настройки и получение сдвига пояса с устройства.
 */

/** Шаг выбора времени: полчаса — этого хватает, а список остаётся коротким. */
export const QUIET_STEP_MINUTES = 30

/** Минут в сутках — столько же, сколько допускает сервер. */
export const MINUTES_IN_DAY = 24 * 60

/** Значения по умолчанию (совпадают с серверными): окно 23:00–08:00. */
export const QUIET_DEFAULT_START = 23 * 60
export const QUIET_DEFAULT_END = 8 * 60

/** Время «ЧЧ:ММ» из минут от полуночи (значение вне суток приводим к 00:00). */
export const formatMinutes = (minutes: number): string => {
  const safe = Number.isFinite(minutes) ? Math.trunc(minutes) : 0
  const normalized = ((safe % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY
  const hours = Math.floor(normalized / 60)
  const mins = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

/**
 * Варианты для списка времени: 00:00, 00:30, … 23:30.
 *
 * Список собирается кодом, а не родным `<input type="time">`: системное окно
 * браузера в WebView открывается далеко от поля (та же причина, по которой в
 * проекте появились SelectField и маска даты).
 */
export const timeOptions = (step = QUIET_STEP_MINUTES): { value: number; label: string }[] => {
  const safeStep = step > 0 && MINUTES_IN_DAY % step === 0 ? step : QUIET_STEP_MINUTES
  const options: { value: number; label: string }[] = []
  for (let minutes = 0; minutes < MINUTES_IN_DAY; minutes += safeStep) {
    options.push({ value: minutes, label: formatMinutes(minutes) })
  }
  return options
}

/** Границы окна в одном дне: `start < end` — без перехода через полночь. */
export const crossesMidnight = (start: number, end: number): boolean => start > end

/** Окно пустое (одинаковые границы) — сервер такое окно считает выключенным. */
export const isEmptyWindow = (start: number, end: number): boolean => start === end

/**
 * Подпись настройки: показывается под тумблером, чтобы не открывать список,
 * чтобы понять, что выбрано.
 */
export const quietHoursSummary = (options: {
  enabled: boolean
  start: number
  end: number
  allowCalls: boolean
}): string => {
  if (!options.enabled) return t('Выключено: уведомления приходят круглосуточно')
  if (isEmptyWindow(options.start, options.end)) {
    return t('Границы совпали — тишины не будет, уведомления приходят круглосуточно')
  }
  const night = crossesMidnight(options.start, options.end) ? t(' (через ночь)') : ''
  const calls = options.allowCalls ? t('звонки разрешены') : t('звонки тоже не приходят')
  return t('Не беспокоить с {start} до {end}{night}; {calls}', {
    start: formatMinutes(options.start),
    end: formatMinutes(options.end),
    night,
    calls
  })
}

/**
 * Сдвиг местного времени от UTC в минутах (то, что ждёт сервер).
 *
 * `getTimezoneOffset()` отдаёт обратную величину (в минутах «назад» от UTC),
 * поэтому знак переворачиваем: для Москвы функция вернёт 180.
 */
export const localUtcOffsetMinutes = (date = new Date()): number => -date.getTimezoneOffset()

/**
 * Настройки тихих часов, которых достаточно для решения «сейчас тихо».
 * Сервер хранит те же поля в профиле (см. `core/quiet_hours.py`).
 */
export interface QuietHoursSettings {
  quiet_hours_enabled?: boolean
  quiet_hours_start?: number
  quiet_hours_end?: number
  quiet_hours_offset?: number
}

/**
 * Попадает ли текущий момент в окно тишины у этого человека.
 *
 * Нужно для звука в приложении: push глушит сервер, а «блип» внутри страницы
 * решает клиент — и он обязан считать то же самое, иначе в тихие часы телефон
 * всё равно звенит, пока приложение открыто.
 *
 * Логика та же, что на сервере: окно может идти через полночь, а совпавшие
 * границы означают «окна нет» (иначе получилось бы 24 часа тишины).
 */
export const isQuietHoursNow = (
  settings: QuietHoursSettings | null | undefined,
  now = new Date()
): boolean => {
  if (!settings?.quiet_hours_enabled) return false
  const start = settings.quiet_hours_start ?? QUIET_DEFAULT_START
  const end = settings.quiet_hours_end ?? QUIET_DEFAULT_END
  if (start === end) return false
  const offset = settings.quiet_hours_offset ?? localUtcOffsetMinutes(now)
  // Местное время получателя в минутах от полуночи (та же арифметика, что на сервере).
  const local = now.getUTCHours() * 60 + now.getUTCMinutes() + offset
  const minutes = ((local % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY
  return crossesMidnight(start, end)
    ? minutes >= start || minutes < end
    : minutes >= start && minutes < end
}

/** Подпись часового пояса для подсказки: «UTC+03:00». */
export const formatOffset = (offsetMinutes: number): string => {
  const sign = offsetMinutes < 0 ? '−' : '+'
  const abs = Math.abs(Math.trunc(offsetMinutes))
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const mins = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${hours}:${mins}`
}
