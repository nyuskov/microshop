/**
 * Журнал безопасности аккаунта: что происходило с аккаунтом.
 *
 * Сервер пишет события аутентификации в `security_events` (входы успешные и
 * неудачные, запросы кодов, подтверждение нового устройства, смена/сброс пароля,
 * смена e-mail, отзыв сессий, удаление аккаунта). Профиль показывает последние
 * из них: это ответ на вопросы «кто-то заходил в мой аккаунт?» и «когда сменили
 * пароль?» — раньше такой информации не было нигде.
 *
 * Хранится 180 дней, доступно только владельцу аккаунта.
 */
import { api } from './api'
import { parseServerTime } from '@/utils/format'
import { dateLocale, t } from '@/i18n'

export interface SecurityLogEntry {
  id: number
  /** Код события (login_success, password_changed, …). */
  event: string
  /** Человекочитаемый заголовок, сформированный сервером. */
  title: string
  detail: string
  ip: string
  device: string
  created_at: string
}

export async function fetchSecurityLog(limit = 20): Promise<SecurityLogEntry[]> {
  const response = await api.get<{ items: SecurityLogEntry[] }>('/auth/security-log/', {
    params: { limit }
  })
  return response.data?.items ?? []
}

/** События, о которых стоит предупредить владельца явно (потенциальный взлом). */
const ALERT_EVENTS = new Set([
  'login_failed',
  'login_locked',
  'device_challenge',
  'device_unverified',
  'password_changed',
  'password_reset',
  'email_changed',
  'sessions_revoked'
])

export function isAlertEvent(event: string): boolean {
  return ALERT_EVENTS.has(event)
}

/** Короткая метка времени события (дд.мм чч:мм). */
export function formatEventTime(iso: string): string {
  const date = parseServerTime(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Подпись устройства: браузер/ОС вместо полной строки User-Agent. */
export function deviceLabelOf(agent: string): string {
  if (!agent) return ''
  if (/pismo/i.test(agent) && /android/i.test(agent)) return t('Pismo для Android')
  if (/edg\//i.test(agent)) return 'Edge'
  if (/opr\//i.test(agent)) return 'Opera'
  if (/chrome\//i.test(agent) && !/chromium/i.test(agent)) return 'Chrome'
  if (/firefox\//i.test(agent)) return 'Firefox'
  if (/safari\//i.test(agent)) return 'Safari'
  return agent.slice(0, 40)
}
