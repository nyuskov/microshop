import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'

import { useThemeStore } from '@/stores/theme'
import {
  crossesMidnight,
  formatScheduleTime,
  isDarkBySchedule,
  msUntilScheduleChange,
  scheduleSummary,
  scheduleTimeOptions,
  SCHEDULE_DEFAULT_END,
  SCHEDULE_DEFAULT_START,
  SCHEDULE_STEP_MINUTES
} from '@/utils/themeSchedule'

/**
 * Расписание тёмной темы: «тёмная с 22:00 до 07:00».
 *
 * Зачем: «Системная» тема следует настройке телефона, а она не всегда совпадает
 * с режимом дня — многие вечером хотят тёмный мессенджер при светлой системе.
 *
 * Проверяем главное для такой настройки: окно через полночь считается верно, на
 * границах нет «мёртвых» минут, а будильник не срабатывает в цикле.
 */
const at = (hours: number, minutes = 0): Date => new Date(2026, 8, 17, hours, minutes, 0, 0)

describe('isDarkBySchedule', () => {
  it('вечером — тёмная, днём — светлая (окно через полночь)', () => {
    const from = 22 * 60
    const to = 7 * 60
    expect(isDarkBySchedule(at(23, 30), from, to)).toBe(true)
    expect(isDarkBySchedule(at(2), from, to)).toBe(true)
    expect(isDarkBySchedule(at(12), from, to)).toBe(false)
    expect(isDarkBySchedule(at(18, 59), from, to)).toBe(false)
  })

  it('границы: начало включено, конец — уже светлая', () => {
    const from = 22 * 60
    const to = 7 * 60
    expect(isDarkBySchedule(at(22), from, to)).toBe(true)
    expect(isDarkBySchedule(at(21, 59), from, to)).toBe(false)
    expect(isDarkBySchedule(at(6, 59), from, to)).toBe(true)
    expect(isDarkBySchedule(at(7), from, to)).toBe(false)
  })

  it('окно внутри дня (09:00–18:00) работает без перехода через полночь', () => {
    expect(isDarkBySchedule(at(12), 9 * 60, 18 * 60)).toBe(true)
    expect(isDarkBySchedule(at(8), 9 * 60, 18 * 60)).toBe(false)
    expect(isDarkBySchedule(at(20), 9 * 60, 18 * 60)).toBe(false)
  })

  it('совпавшие границы означают «расписание выключено»', () => {
    // Иначе «с 00:00 до 00:00» запирало бы человека в тёмной теме на сутки.
    expect(isDarkBySchedule(at(3), 0, 0)).toBe(false)
    expect(isDarkBySchedule(at(15), 20 * 60, 20 * 60)).toBe(false)
  })

  it('по умолчанию окно вечернее (22:00–07:00)', () => {
    expect(SCHEDULE_DEFAULT_START).toBe(22 * 60)
    expect(SCHEDULE_DEFAULT_END).toBe(7 * 60)
    expect(isDarkBySchedule(at(23), SCHEDULE_DEFAULT_START, SCHEDULE_DEFAULT_END)).toBe(true)
  })
})

describe('msUntilScheduleChange', () => {
  it('до ближайшей границы окна', () => {
    // В 21:00 ближайшая граница — начало в 22:00.
    expect(msUntilScheduleChange(at(21), 22 * 60, 7 * 60)).toBe(60 * 60 * 1000)
    // В 23:00 — уже конец окна в 07:00 следующего дня.
    expect(msUntilScheduleChange(at(23), 22 * 60, 7 * 60)).toBe(8 * 60 * 60 * 1000)
  })

  it('точно на границе ждёт почти полные сутки, а не ноль', () => {
    // Секунда ожидания — защита от цикла: на самой границе «до смены» 24 часа.
    expect(msUntilScheduleChange(at(22), 22 * 60, 7 * 60)).toBe(9 * 60 * 60 * 1000)
  })

  it('никогда не возвращает меньше секунды', () => {
    const wait = msUntilScheduleChange(at(22, 0), 22 * 60, 7 * 60)
    expect(wait).toBeGreaterThanOrEqual(1000)
  })

  it('при совпавших границах не планирует ничего', () => {
    expect(msUntilScheduleChange(at(12), 8 * 60, 8 * 60)).toBe(0)
  })
})

describe('подписи и списки', () => {
  it('подпись говорит, что действует сейчас', () => {
    expect(scheduleSummary(22 * 60, 7 * 60, at(23))).toContain('сейчас тёмная')
    expect(scheduleSummary(22 * 60, 7 * 60, at(12))).toContain('сейчас светлая')
  })

  it('подпись помечает переход через ночь', () => {
    expect(scheduleSummary(22 * 60, 7 * 60, at(12))).toContain('через ночь')
    expect(scheduleSummary(9 * 60, 18 * 60, at(12))).not.toContain('через ночь')
  })

  it('подпись предупреждает, когда границы совпали', () => {
    expect(scheduleSummary(8 * 60, 8 * 60, at(12))).toContain('Границы совпали')
  })

  it('список времени — час шагом, 24 варианта, от 00:00', () => {
    const options = scheduleTimeOptions()
    expect(SCHEDULE_STEP_MINUTES).toBe(60)
    expect(options).toHaveLength(24)
    expect(options[0]).toEqual({ value: 0, label: '00:00' })
    expect(options[23]).toEqual({ value: 23 * 60, label: '23:00' })
  })

  it('формат времени досыпает нули и переживает выход за сутки', () => {
    expect(formatScheduleTime(7 * 60)).toBe('07:00')
    expect(formatScheduleTime(22 * 60 + 30)).toBe('22:30')
    expect(formatScheduleTime(25 * 60)).toBe('01:00')
  })

  it('crossesMidnight отличается на окнах внутри дня', () => {
    expect(crossesMidnight(22 * 60, 7 * 60)).toBe(true)
    expect(crossesMidnight(9 * 60, 18 * 60)).toBe(false)
  })
})

/**
 * Проверки по исходникам: расписание должно быть подключено и к стору, и к
 * настройкам. Самая вероятная регрессия — «окно выбирается, но тема не
 * меняется» (забыли пересчитать) или «настройка есть, а будильника нет».
 */
describe('связка со стором и настройками', () => {
  const source = (path: string) => readFileSync(path, 'utf8')
  const store = source('src/stores/theme.ts')
  const settings = source('src/views/AppearanceSettings.vue')

  it('стор считает тему по расписанию только в режиме schedule', () => {
    expect(store).toContain("this.mode === 'schedule'")
    expect(store).toContain('isDarkBySchedule(new Date()')
    expect(store).toContain('darkFrom')
    expect(store).toContain('darkTo')
  })

  it('стор ставит будильник на границу окна и пересчитывает при возврате в приложение', () => {
    expect(store).toContain('msUntilScheduleChange')
    expect(store).toContain('planScheduleCheck')
    expect(store).toContain('visibilitychange')
  })

  it('границы сохраняются рядом с остальными настройками оформления', () => {
    expect(store).toMatch(/darkFrom: this\.darkFrom/)
    expect(store).toMatch(/darkTo: this\.darkTo/)
  })

  it('в настройках есть выбор «По расписанию» и два списка времени', () => {
    expect(settings).toContain('По расписанию')
    expect(settings).toContain('SCHEDULE_TIME_OPTIONS')
    expect(settings).toContain('setDarkWindow')
    expect(settings).toContain('scheduleSummary')
  })
})

/**
 * Поведение самого стора: тема меняется от времени суток, будильник переключает
 * её на границе, а границы сохраняются. Часы подменяем фейковые — иначе такой
 * тест зависел бы от того, когда его запустили.
 */
describe('theme store: режим «По расписанию»', () => {
  const themeAttr = () => document.documentElement.getAttribute('data-theme')
  const storedAppearance = () => JSON.parse(localStorage.getItem('appearance') ?? '{}')

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => vi.useRealTimers())

  it('вечером включает тёмную, а днём — светлую', () => {
    vi.setSystemTime(new Date(2026, 8, 17, 23, 0))
    const store = useThemeStore()
    store.setThemeMode('schedule')
    expect(store.currentTheme).toBe('dark')
    expect(themeAttr()).toBe('dark')

    vi.setSystemTime(new Date(2026, 8, 18, 12, 0))
    store.applyAppearance()
    expect(store.currentTheme).toBe('light')
    expect(themeAttr()).toBe('light')
  })

  it('сам переключается на границе окна, без действий пользователя', () => {
    vi.setSystemTime(new Date(2026, 8, 17, 21, 59))
    const store = useThemeStore()
    store.setThemeMode('schedule')
    expect(themeAttr()).toBe('light')

    // Проходит минута с небольшим — наступает 22:00.
    vi.advanceTimersByTime(61_000)
    expect(themeAttr()).toBe('dark')
  })

  it('смена окна применяется сразу, а не со следующего запуска', () => {
    vi.setSystemTime(new Date(2026, 8, 17, 12, 0))
    const store = useThemeStore()
    store.setThemeMode('schedule')
    expect(themeAttr()).toBe('light')

    // Дневное окно: сейчас 12:00 — значит, тёмная.
    store.setDarkWindow(9 * 60, 18 * 60)
    expect(themeAttr()).toBe('dark')
  })

  it('границы сохраняются и поднимаются из localStorage', () => {
    vi.setSystemTime(new Date(2026, 8, 17, 12, 0))
    const store = useThemeStore()
    store.setDarkWindow(20 * 60, 6 * 60)
    expect(storedAppearance().darkFrom).toBe(20 * 60)
    expect(storedAppearance().darkTo).toBe(6 * 60)

    // Новая сессия (перезапуск приложения) читает те же границы.
    setActivePinia(createPinia())
    expect(useThemeStore().darkFrom).toBe(20 * 60)
    expect(useThemeStore().darkTo).toBe(6 * 60)
  })

  it('чёрный фон (AMOLED) работает и в расписании: вечером — amoled, днём — светлая', () => {
    vi.setSystemTime(new Date(2026, 8, 17, 23, 0))
    const store = useThemeStore()
    store.setThemeMode('schedule')
    store.setAmoled(true)
    expect(themeAttr()).toBe('amoled')

    vi.setSystemTime(new Date(2026, 8, 18, 12, 0))
    store.applyAppearance()
    // В светлой чёрный фон не действует — атрибут остаётся светлым.
    expect(themeAttr()).toBe('light')
  })
})
