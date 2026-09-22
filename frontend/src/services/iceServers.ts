import { api } from '@/services/api'
import { t } from '@/i18n'
import { ICE_SERVERS as FALLBACK_ICE_SERVERS } from '@/config'

/**
 * ICE-серверы для звонка.
 *
 * TURN-креды теперь выдаёт бэкенд (`GET /calls/ice-servers/`) — временные, под
 * конкретного пользователя, по общему секрету. Статический пароль в бандле
 * означал бы, что его можно вытащить и гонять через наш релей чужой трафик.
 * Значения из `VITE_ICE_SERVERS` остаются только фолбэком: если сервер недоступен
 * (или TURN не настроен), звонок всё равно должен состояться через STUN.
 */

interface IceServersResponse {
  ice_servers: RTCIceServer[]
  ttl: number
}

/** Фолбэк держим в памяти, если API не ответил: не дёргаем его на каждый звонок. */
let fallbackUntil = 0
const FALLBACK_COOLDOWN_MS = 60_000

/** Кэш выданных серверов: TURN-креды живут `ttl` секунд, берём с запасом. */
let cached: { servers: RTCIceServer[]; expiresAt: number } | null = null

//: Запас, чтобы креды не истекли посреди установления соединения.
const EXPIRY_SAFETY_MS = 30_000

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.servers
  if (fallbackUntil > now) return FALLBACK_ICE_SERVERS

  try {
    const { data } = await api.get<IceServersResponse>('/calls/ice-servers/')
    const servers = Array.isArray(data?.ice_servers) ? data.ice_servers : []
    if (!servers.length) throw new Error(t('Пустой список ICE-серверов'))
    const ttlMs = (data.ttl > 0 ? data.ttl : 600) * 1000
    cached = { servers, expiresAt: now + Math.max(ttlMs - EXPIRY_SAFETY_MS, 60_000) }
    return servers
  } catch {
    // Сервер не ответил — не тормозим звонок повторами, идём на фолбэке.
    fallbackUntil = now + FALLBACK_COOLDOWN_MS
    return FALLBACK_ICE_SERVERS
  }
}

/** Сбрасывает кэш (например, при выходе из аккаунта). */
export function resetIceServersCache(): void {
  cached = null
  fallbackUntil = 0
}
