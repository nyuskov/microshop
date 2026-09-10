/**
 * Журнал безопасности аккаунта: разметка событий для профиля.
 *
 * Сервер отдаёт код события и готовый заголовок; фронт решает, выделять ли строку
 * как «важную» (вход с нового устройства, смена пароля, неудачные попытки) — так
 * владелец быстрее замечает чужую активность в списке.
 */
import { describe, expect, it } from 'vitest'

import { deviceLabelOf, formatEventTime, isAlertEvent } from '../services/securityLog'

describe('isAlertEvent', () => {
  it('выделяет события, важные для разбора инцидента', () => {
    expect(isAlertEvent('login_failed')).toBe(true)
    expect(isAlertEvent('password_changed')).toBe(true)
    expect(isAlertEvent('email_changed')).toBe(true)
    expect(isAlertEvent('sessions_revoked')).toBe(true)
    expect(isAlertEvent('device_challenge')).toBe(true)
  })

  it('не выделяет обычные события', () => {
    expect(isAlertEvent('login_success')).toBe(false)
    expect(isAlertEvent('otp_requested')).toBe(false)
    expect(isAlertEvent('email_code_requested')).toBe(false)
  })
})

describe('formatEventTime', () => {
  it('форматирует дату и не падает на мусоре', () => {
    expect(formatEventTime('2026-09-10T15:30:00+00:00')).toMatch(/\d{2}\.\d{2}/)
    expect(formatEventTime('не дата')).toBe('')
  })
})

describe('deviceLabelOf', () => {
  it('сокращает User-Agent до понятного названия', () => {
    expect(deviceLabelOf('Mozilla/5.0 Chrome/120 Safari/537.36')).toBe('Chrome')
    expect(deviceLabelOf('Mozilla/5.0 Firefox/121')).toBe('Firefox')
    expect(deviceLabelOf('Pismo/1.0 (Android)')).toBe('Pismo для Android')
    expect(deviceLabelOf('')).toBe('')
  })
})
