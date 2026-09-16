import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  MINUTES_IN_DAY,
  QUIET_DEFAULT_END,
  QUIET_DEFAULT_START,
  crossesMidnight,
  formatMinutes,
  formatOffset,
  isEmptyWindow,
  localUtcOffsetMinutes,
  quietHoursSummary,
  timeOptions
} from '@/utils/quietHours'

/**
 * Тихие часы в профиле.
 *
 * Смысл проверок: время хранится в минутах от полуночи (как на сервере), окно
 * почти всегда идёт через полночь (23:00–08:00), а настройка сохраняется сразу —
 * значит, ошибка в границах или подписи тихо исказит то, что человек выбрал.
 * Отдельно следим, что время выбирается своим списком, а не родным
 * `<input type="time">`: системное окно браузера в WebView открывается далеко от
 * поля (та же причина, по которой в проекте появились SelectField и маска даты).
 */
describe('formatMinutes', () => {
  it('показывает время в формате ЧЧ:ММ', () => {
    expect(formatMinutes(0)).toBe('00:00')
    expect(formatMinutes(480)).toBe('08:00')
    expect(formatMinutes(23 * 60)).toBe('23:00')
    expect(formatMinutes(23 * 60 + 30)).toBe('23:30')
    expect(formatMinutes(5 * 60 + 7)).toBe('05:07')
  })

  it('приводит значения вне суток к кругу', () => {
    expect(formatMinutes(MINUTES_IN_DAY)).toBe('00:00')
    expect(formatMinutes(-30)).toBe('23:30')
    expect(formatMinutes(Number.NaN)).toBe('00:00')
  })
})

describe('timeOptions', () => {
  it('даёт шаг полчаса по всем суткам', () => {
    const options = timeOptions()
    expect(options).toHaveLength(48)
    expect(options[0]).toEqual({ value: 0, label: '00:00' })
    expect(options[options.length - 1]).toEqual({ value: 23 * 60 + 30, label: '23:30' })
  })

  it('поддерживает другой шаг, если он делит сутки', () => {
    expect(timeOptions(60)).toHaveLength(24)
    expect(timeOptions(15)).toHaveLength(96)
    expect(timeOptions(45)).toHaveLength(32)
  })

  it('на неделимом шаге возвращается к получасу', () => {
    // Иначе список получил бы «дырку» в конце суток (23:45 → 00:00).
    expect(timeOptions(50)).toHaveLength(48)
    expect(timeOptions(7)).toHaveLength(48)
    expect(timeOptions(0)).toHaveLength(48)
  })

  it('значения идут по возрастанию — так список читается', () => {
    const values = timeOptions().map((option) => option.value)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })
})

describe('границы окна', () => {
  it('видит переход через полночь', () => {
    expect(crossesMidnight(QUIET_DEFAULT_START, QUIET_DEFAULT_END)).toBe(true)
    expect(crossesMidnight(13 * 60, 17 * 60)).toBe(false)
  })

  it('совпавшие границы — окна нет (сервер считает так же)', () => {
    expect(isEmptyWindow(0, 0)).toBe(true)
    expect(isEmptyWindow(23 * 60, 8 * 60)).toBe(false)
  })
})

describe('quietHoursSummary', () => {
  it('у выключенной настройки прямо говорит, что тишины нет', () => {
    expect(quietHoursSummary({ enabled: false, start: 0, end: 0, allowCalls: true })).toContain(
      'Выключено'
    )
  })

  it('описывает ночное окно и разрешённые звонки', () => {
    const text = quietHoursSummary({
      enabled: true,
      start: QUIET_DEFAULT_START,
      end: QUIET_DEFAULT_END,
      allowCalls: true
    })
    expect(text).toContain('с 23:00 до 08:00')
    expect(text).toContain('через ночь')
    expect(text).toContain('звонки разрешены')
  })

  it('предупреждает, что звонки тоже не придут', () => {
    const text = quietHoursSummary({ enabled: true, start: 60, end: 420, allowCalls: false })
    expect(text).toContain('звонки тоже не приходят')
    // Окно внутри одних суток — про полночь не пишем.
    expect(text).not.toContain('через ночь')
  })

  it('про совпавшие границы говорит отдельно, а не «с 00:00 до 00:00»', () => {
    const text = quietHoursSummary({ enabled: true, start: 0, end: 0, allowCalls: true })
    expect(text).toContain('Границы совпали')
  })
})

describe('часовой пояс', () => {
  it('переворачивает знак getTimezoneOffset (Москва → +180)', () => {
    const fake = { getTimezoneOffset: () => -180 } as Date
    expect(localUtcOffsetMinutes(fake)).toBe(180)
    const west = { getTimezoneOffset: () => 240 } as Date
    expect(localUtcOffsetMinutes(west)).toBe(-240)
  })

  it('подпись пояса — с явным знаком и минутами', () => {
    expect(formatOffset(180)).toBe('UTC+03:00')
    expect(formatOffset(-240)).toBe('UTC−04:00')
    expect(formatOffset(330)).toBe('UTC+05:30')
    expect(formatOffset(0)).toBe('UTC+00:00')
  })
})

describe('в интерфейсе нет родного выбора времени', () => {
  const SRC = path.resolve(import.meta.dirname, '..')
  const profile = readFileSync(path.join(SRC, 'views/UserProfile.vue'), 'utf8')

  it('время тихих часов выбирается списком SelectField', () => {
    expect(profile).toContain('id="pf-quiet-from"')
    expect(profile).toContain('id="pf-quiet-to"')
    expect(profile).toContain(':options="TIME_OPTIONS"')
  })

  it('родного <input type="time"> в разделе нет', () => {
    // Родное окно времени рисует браузер: в WebView оно открывается системным
    // окошком далеко от поля — ровно на это жаловался пользователь.
    expect(profile).not.toMatch(/<input[^>]*type="time"/)
  })

  it('сдвиг часового пояса уходит на сервер при сохранении', () => {
    expect(profile).toContain('quiet_hours_offset: localUtcOffsetMinutes()')
  })
})
