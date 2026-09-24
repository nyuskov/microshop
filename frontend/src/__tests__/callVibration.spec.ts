import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CALL_RING_VIBRATION } from '@/services/pwa'
import {
  CALL_VIBRATION_KEY,
  CALL_VIBRATION_PATTERN,
  CALL_VIBRATION_REPEAT_MS,
  isCallVibrationEnabled,
  setCallVibrationEnabled,
  startCallVibration,
  stopCallVibration
} from '@/utils/callVibration'

/**
 * Вибрация при входящем звонке.
 *
 * Проверяем то, что ломается тихо и выясняется на живом звонке: вибрация должна
 * ПОВТОРЯТЬСЯ, пока звонок звонит (одного толчка в начале вызова легко не
 * заметить), совпадать по ритму с уведомлением о звонке и выключаться
 * настройкой устройства.
 */

let vibrate: ReturnType<typeof vi.fn>
let vibratePatterns: unknown[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vibratePatterns = []
  vibrate = vi.fn((pattern: unknown) => {
    vibratePatterns.push(pattern)
    return true
  })
  Object.defineProperty(navigator, 'vibrate', {
    value: vibrate,
    configurable: true,
    writable: true
  })
})

afterEach(() => {
  stopCallVibration()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  localStorage.clear()
})

describe('настройка вибрации', () => {
  it('по умолчанию включена и выключается на устройстве', () => {
    expect(isCallVibrationEnabled()).toBe(true)
    setCallVibrationEnabled(false)
    expect(isCallVibrationEnabled()).toBe(false)
    expect(localStorage.getItem(CALL_VIBRATION_KEY)).toBe('off')
    setCallVibrationEnabled(true)
    expect(isCallVibrationEnabled()).toBe(true)
  })

  it('выключенная настройка — вибрации нет вовсе', () => {
    setCallVibrationEnabled(false)

    startCallVibration()
    vi.advanceTimersByTime(CALL_VIBRATION_REPEAT_MS * 3)

    expect(vibrate).not.toHaveBeenCalled()
  })

  it('выключение настройки гасит уже идущую вибрацию', () => {
    startCallVibration()
    vibrate.mockClear()

    setCallVibrationEnabled(false)

    expect(vibrate).toHaveBeenCalledWith(0)
    vibrate.mockClear()
    vi.advanceTimersByTime(CALL_VIBRATION_REPEAT_MS * 3)
    expect(vibrate).not.toHaveBeenCalled()
  })
})

describe('ритм вибрации', () => {
  it('толкает сразу и повторяет, пока звонок звонит', () => {
    startCallVibration()

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibratePatterns[0]).toEqual(CALL_VIBRATION_PATTERN)

    // Пауза между повторами — свойство ритма: телефон не должен дрожать
    // непрерывно, но и молчать после первого толчка нельзя.
    vi.advanceTimersByTime(CALL_VIBRATION_REPEAT_MS - 1)
    expect(vibrate).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(vibrate).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(CALL_VIBRATION_REPEAT_MS)
    expect(vibrate).toHaveBeenCalledTimes(3)
  })

  it('повторный запуск не наслаивает второй ритм', () => {
    startCallVibration()
    startCallVibration()
    vibrate.mockClear()

    vi.advanceTimersByTime(CALL_VIBRATION_REPEAT_MS + 1)

    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('остановка обрывает уже начатый ритм', () => {
    startCallVibration()
    vibrate.mockClear()

    stopCallVibration()
    expect(vibrate).toHaveBeenCalledWith(0)

    vibrate.mockClear()
    vi.advanceTimersByTime(CALL_VIBRATION_REPEAT_MS * 3)
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('ритм — тот же, что у уведомления о звонке', () => {
    // Раскладка вибрации уже разъезжалась между приложением и sw.js: человек не
    // должен чувствовать разный звонок в зависимости от того, свёрнуто
    // приложение или открыто.
    expect(CALL_VIBRATION_PATTERN).toEqual(CALL_RING_VIBRATION)
  })
})

describe('браузер без Vibration API', () => {
  it('молча ничего не делает (iOS/Safari, десктоп)', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
    // @ts-expect-error — проверяем именно отсутствие API, как в Safari.
    delete navigator.vibrate

    expect(() => startCallVibration()).not.toThrow()
    expect(() => stopCallVibration()).not.toThrow()
    vi.advanceTimersByTime(CALL_VIBRATION_REPEAT_MS * 2)
    expect(vibrate).not.toHaveBeenCalled()

    if (original) Object.defineProperty(navigator, 'vibrate', original)
  })
})
