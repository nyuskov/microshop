import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'

import { API_BASE_URL } from '@/config'

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

/** Регистрирует источник access-токена и обработчик 401 (вызывается один раз). */
export function registerAuth(tokenProvider: AccessTokenProvider, onRefresh: RefreshHandler): void {
  getAccessToken = tokenProvider
  refreshHandler = onRefresh
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true // Важно для передачи cookies с токеном
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
export const uploadAvatar = async (file: File): Promise<string | null> => {
  const extMatch = file.name.split('.').pop()
  const ext = (extMatch || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const response = await api.put('/users/me/avatar/', file, {
    params: { ext },
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })
  return response.data?.avatar_url ?? null
}

export const removeAvatar = async (): Promise<void> => {
  await api.delete('/users/me/avatar/')
}
// --- Конец функций для аватара ---

export { api }
