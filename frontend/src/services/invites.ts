/**
 * Приглашения на регистрацию — со стороны владельца сервиса.
 *
 * Публичной регистрации нет: новый аккаунт заводится только по одноразовой
 * ссылке `/invite/<token>`, которую владелец передаёт лично. Раньше это умел
 * только CLI-скрипт (`scripts/create_invite.py`), требующий ssh на сервер;
 * эндпоинты ниже — та же логика, но из приложения (см. раздел «Приглашения»
 * в настройках, доступен аккаунту с флагом `is_superuser`).
 *
 * Пароль приглашённый придумывает сам, владелец его не пересылает.
 */
import { api } from './api'

export interface RegistrationInvite {
  id: number
  /** Секрет ссылки (`/invite/<token>`). Показывается только владельцу. */
  token: string
  /** Приглашение закреплено за номером (NULL — номер вводит приглашённый). */
  phone_number: string | null
  /** Заметка для себя, приглашённому не видна. */
  note: string | null
  created_at: string
  expires_at: string | null
  used_at: string | null
  revoked_at: string | null
}

export interface RegistrationInviteList {
  items: RegistrationInvite[]
  /** Сколько ссылок ещё действует. */
  active: number
}

export interface CreateInvitePayload {
  /** Закрепить за номером (необязательно). */
  phone_number?: string | null
  note?: string | null
  /** Срок действия в днях; NULL/undefined — бессрочно. */
  expires_days?: number | null
}

export async function fetchRegistrationInvites(): Promise<RegistrationInviteList> {
  const response = await api.get<RegistrationInviteList>('/auth/invites/')
  return {
    items: response.data?.items ?? [],
    active: response.data?.active ?? 0
  }
}

export async function createRegistrationInvite(
  payload: CreateInvitePayload
): Promise<RegistrationInvite> {
  const response = await api.post<RegistrationInvite>('/auth/invites/', payload)
  return response.data
}

export async function revokeRegistrationInvite(inviteId: number): Promise<void> {
  await api.delete(`/auth/invites/${inviteId}/`)
}

/** Состояние приглашения — «почему ссылка не работает». */
export type InviteState = 'active' | 'used' | 'revoked' | 'expired'

/**
 * Состояние приглашения для интерфейса.
 *
 * Порядок проверок = порядок событий: «по ссылке зарегистрировались» и «ссылку
 * погасили» важнее срока годности (иначе отозванная ссылка выглядела бы просто
 * истёкшей). `now` можно подставить в тесте.
 */
export function inviteState(invite: RegistrationInvite, now: number = Date.now()): InviteState {
  if (invite.used_at) return 'used'
  if (invite.revoked_at) return 'revoked'
  if (invite.expires_at) {
    const expires = new Date(invite.expires_at).getTime()
    if (!Number.isNaN(expires) && expires <= now) return 'expired'
  }
  return 'active'
}

/** Готовая ссылка для передачи приглашённому. */
export function inviteLinkFor(token: string, origin: string = window.location.origin): string {
  return `${origin}/invite/${token}`
}
