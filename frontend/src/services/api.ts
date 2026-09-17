import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'

import { API_BASE_URL } from '@/config'
import { maintenanceMessageOf, showMaintenance } from '@/utils/maintenance'

/**
 * Единый axios-клиент для API мессенджера.
 *
 * Все запросы к бэкенду идут через один инстанс ``api``:
 *  - request-interceptor добавляет ``Authorization`` из зарегистрированного
 *    источника токена (auth-store), если заголовок не задан явно;
 *  - response-interceptor при 401 один раз обновляет access-токен и повторяет
 *    исходный запрос (кроме публичных auth-эндпоинтов).
 *
 * Источник токена и обработчик refresh регистрирует auth-store через
 * ``registerAuth`` — так удаётся избежать циклической зависимости.
 */

export type AccessTokenProvider = () => string | null
export type RefreshHandler = () => Promise<boolean>

let getAccessToken: AccessTokenProvider = () => null
let refreshHandler: RefreshHandler | null = null
let refreshInFlight: Promise<boolean> | null = null

/**
 * Причина потери сессии, о которой сообщает сервер:
 * - `session_revoked` — «вышел на всех», сменился пароль, сессия отозвана;
 * - `account_frozen` — аккаунт заморожен (стоп-кран на случай угона).
 * Обновлять токен в этих случаях бессмысленно: сессия больше не существует.
 */
export type AuthLostReason = 'session_revoked' | 'account_frozen'
export type AuthLostHandler = (reason: AuthLostReason, message: string) => void

let authLostHandler: AuthLostHandler | null = null

/** Регистрирует источник access-токена, обработчик 401 и потерю сессии. */
export function registerAuth(
  tokenProvider: AccessTokenProvider,
  onRefresh: RefreshHandler,
  onAuthLost?: AuthLostHandler
): void {
  getAccessToken = tokenProvider
  refreshHandler = onRefresh
  authLostHandler = onAuthLost ?? null
}

/** Код причины из ответа сервера (`detail.code`), если он есть. */
function authLostReasonOf(error: AxiosError): { reason: AuthLostReason; message: string } | null {
  const status = error.response?.status
  if (status !== 401 && status !== 403) return null
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
  if (!detail || typeof detail !== 'object') return null
  const code = (detail as { code?: string }).code
  if (code !== 'session_revoked' && code !== 'account_frozen') return null
  return {
    reason: code,
    message: (detail as { message?: string }).message ?? ''
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Важно для передачи cookies с токеном
  // Без таймаута запрос к «чёрной дыре» (VPN/фаервол глотает пакеты без ответа)
  // висел бы вечно — весь мессенджер «замерзал» бы на «Загрузка…».
  timeout: 15000
})

// --- Единый источник Authorization ---
api.interceptors.request.use(
  (config) => {
    // Не перетираем явно заданный заголовок (например, refresh-токен).
    if (!config.headers.Authorization) {
      const token = getAccessToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Публичные auth-эндпоинты: 401 здесь НЕ запускает авто-refresh (иначе зацикливание).
const NO_AUTO_REFRESH_PATHS = [
  '/auth/request-otp/',
  '/auth/verify-otp/',
  '/auth/token/',
  '/auth/password/',
  '/jwt/auth/refresh'
]

function shouldAutoRefresh(url: string | undefined): boolean {
  if (!url) return true
  return !NO_AUTO_REFRESH_PATHS.some((path) => url.includes(path))
}

// --- Авто-refresh access-токена при 401 и повтор исходного запроса ---
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
    const status = error.response?.status
    // Режим технических работ: сервер отвечает 503 с кодом `maintenance` на любой
    // запрос. Показываем полноэкранную заглушку и молчим: «повторить» тут
    // нечего — режим снимает администратор, а приложение само проверяет статус
    // (см. useMaintenanceWatch).
    const maintenanceText = maintenanceMessageOf(error)
    if (maintenanceText) {
      showMaintenance(maintenanceText)
      return Promise.reject(error)
    }
    // Сессия отозвана сервером или аккаунт заморожен: refresh не поможет —
    // сообщаем стору (он почистит токены и покажет экран входа/разморозки).
    const lost = authLostReasonOf(error)
    if (lost) {
      authLostHandler?.(lost.reason, lost.message)
      return Promise.reject(error)
    }
    if (
      status === 401 &&
      config &&
      !config._retried &&
      shouldAutoRefresh(config.url) &&
      refreshHandler
    ) {
      config._retried = true
      // Единый refresh: параллельные 401 ждут один и тот же запрос.
      if (!refreshInFlight) {
        refreshInFlight = Promise.resolve()
          .then(refreshHandler)
          .catch(() => false)
          .finally(() => {
            refreshInFlight = null
          })
      }
      const ok = await refreshInFlight
      if (ok) {
        const token = getAccessToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return api.request(config)
      }
    }
    return Promise.reject(error)
  }
)
// --- Конец interceptor'ов ---

// --- Функции для аватара текущего пользователя ---
/** Ссылки на аватар после загрузки: оригинал и миниатюра 128px. */
export interface AvatarUrls {
  avatar_url: string | null
  avatar_thumb_url: string | null
}

export const uploadAvatar = async (file: File): Promise<AvatarUrls> => {
  const extMatch = file.name.split('.').pop()
  const ext = (extMatch || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const response = await api.put('/users/me/avatar/', file, {
    params: { ext },
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })
  return {
    avatar_url: response.data?.avatar_url ?? null,
    avatar_thumb_url: response.data?.avatar_thumb_url ?? null
  }
}

export const removeAvatar = async (): Promise<void> => {
  await api.delete('/users/me/avatar/')
}
// --- Конец функций для аватара ---

export { api }
