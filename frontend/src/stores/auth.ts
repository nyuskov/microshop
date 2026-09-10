import { defineStore } from 'pinia'
import type { Router } from 'vue-router'
import axios from 'axios'

import { getErrorMessage } from '@/services/errors'
import { API_ORIGIN } from '@/config'
import { api, registerAuth } from '@/services/api'

// Origin бэкенда (централизован в config.ts). Экспортируется для совместимости.
export const backendServer = API_ORIGIN

export interface ApiUserProfile {
  bio: string | null
  birth_date: string | null
  language: string | null
  country: string | null
  notifications_enabled: boolean
  privacy_mode: boolean
}

export interface ApiUser {
  id?: number
  username: string
  phone_number: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  // Подтверждён ли адрес кодом из письма (вход без пароля и сброс пароля).
  email_verified?: boolean
  is_superuser?: boolean
  // Состояние безопасности: задан ли пароль и не устарел/ослаб ли он.
  password_set?: boolean
  password_weak?: boolean
  avatar_url?: string | null
  status?: string | null
  last_seen?: string | null
  profile?: ApiUserProfile | null
}

/**
 * Ответ сервера 428 на вход с нового устройства: токенов нет, нужен код из письма.
 *
 * Политика сервера — всегда требовать код при входе с незнакомого устройства
 * (см. `api_v1/auth/device_guard.py`). Если подтвердить нечем (нет подтверждённого
 * e-mail или выключен SMTP), сервер пропускает вход и присылает письмо.
 */
export interface DeviceChallenge {
  detail: string
  code_sent_to: string | null
  challenge_token: string | null
  expires_in: number
}

/** Один активный вход в списке «Безопасность» → устройства. */
export interface AuthSession {
  id: number
  device: string
  ip: string
  created_at: string
  current: boolean
}

/** Достаёт данные 2FA-челленджа из ответа 428 (или null, если это другая ошибка). */
export function deviceChallengeOf(error: unknown): DeviceChallenge | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 428) {
    return null
  }
  const data = error.response.data as { detail?: unknown } | undefined
  const detail = data?.detail
  if (!detail || typeof detail !== 'object') {
    return null
  }
  return detail as DeviceChallenge
}

interface AuthState {
  user: ApiUser | null
  isAuthenticated: boolean
  current_user: ApiUser | null
  accessToken: string | null
  refreshToken: string | null
}

const DEFAULT_STATE: AuthState = {
  user: null,
  isAuthenticated: false,
  current_user: null,
  accessToken: null,
  refreshToken: null
}

function loadState(): AuthState {
  const storedState = localStorage.getItem('authState')
  if (!storedState) {
    return { ...DEFAULT_STATE }
  }
  return { ...DEFAULT_STATE, ...(JSON.parse(storedState) as Partial<AuthState>) }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => loadState(),

  getters: {
    // Проверка, является ли пользователь администратором
    isAdmin: (state): boolean => state.user?.is_superuser === true
  },

  actions: {
    async initializeApp() {
      // Проверяем наличие валидного токена при старте приложения
      if (this.accessToken) {
        await this.fetchUser()
      }
    },

    async requestOtp(phoneNumber: string): Promise<void> {
      try {
        await api.post('/auth/request-otp/', { phone_number: phoneNumber })
        console.log('OTP sent successfully')
      } catch (error) {
        console.error('Request OTP error:', error)
        throw error
      }
    },

    async loginWithOtp(phoneNumber: string, otpCode: string, router: Router | null = null) {
      try {
        const response = await api.post('/auth/verify-otp/', {
          phone_number: phoneNumber,
          otp: otpCode
        })

        if (!response.data?.access_token) {
          throw new Error('Server response did not contain access token.')
        }

        this.accessToken = response.data.access_token
        this.refreshToken = response.data.refresh_token ?? null

        this.isAuthenticated = true
        this.saveState()

        try {
          await this.fetchUser()
        } catch (fetchError) {
          // Если не удалось получить пользователя — отменяем вход
          this.resetAuth()
          throw fetchError
        }

        if (router && this.current_user !== null) {
          await router.push({ name: 'Messenger' })
        }
      } catch (error) {
        console.error('Login with OTP error:', error)
        this.resetAuth()
        throw error
      }
    },

    /** Применяет ответ с токенами и завершает вход (общий для способов входа). */
    async applyTokenResponse(
      data: { access_token?: string; refresh_token?: string | null },
      router: Router | null = null
    ) {
      if (!data?.access_token) {
        throw new Error('Server response did not contain access token.')
      }
      this.accessToken = data.access_token
      this.refreshToken = data.refresh_token ?? null
      this.isAuthenticated = true
      this.saveState()

      try {
        await this.fetchUser()
      } catch (fetchError) {
        this.resetAuth()
        throw fetchError
      }

      if (router && this.current_user !== null) {
        await router.push({ name: 'Messenger' })
      }
    },

    /**
     * Статус номера до входа: есть ли аккаунт, задан ли пароль и можно ли
     * доставить код подтверждения (``otp_available``). Если канала нет —
     * фронт сразу предлагает создать пароль, а не зовёт ждать SMS.
     */
    async passwordStatus(phoneNumber: string): Promise<{
      registered: boolean
      has_password: boolean
      otp_available: boolean
      email_otp_available: boolean
      email_login_available: boolean
    }> {
      const response = await api.post('/auth/password/status/', {
        phone_number: phoneNumber
      })
      return response.data as {
        registered: boolean
        has_password: boolean
        otp_available: boolean
        email_otp_available: boolean
        email_login_available: boolean
      }
    },

    /** Какие каналы доставки кодов включены на сервере (публично). */
    async fetchAuthChannels(): Promise<{
      otp_available: boolean
      email_otp_available: boolean
    }> {
      const response = await api.get('/auth/channels/')
      return response.data as { otp_available: boolean; email_otp_available: boolean }
    },

    /** Письмо с кодом на адрес — чтобы подтвердить его в текущем аккаунте. */
    async requestEmailVerification(email: string): Promise<string> {
      const response = await api.post('/auth/email/request-verification/', { email })
      return response.data?.detail ?? ''
    },

    /** Подтверждение адреса кодом из письма. */
    async confirmEmailVerification(email: string, code: string): Promise<void> {
      await api.post('/auth/email/confirm-verification/', { email, code })
      await this.fetchUser()
    },

    /** Вход без пароля: письмо с кодом на подтверждённый адрес. */
    async requestEmailLogin(email: string): Promise<string> {
      const response = await api.post('/auth/email/login/request/', { email })
      return response.data?.detail ?? ''
    },

    /** Вход по коду из письма. */
    async confirmEmailLogin(
      email: string,
      code: string,
      router: Router | null = null
    ): Promise<void> {
      const response = await api.post('/auth/email/login/confirm/', { email, code })
      await this.applyTokenResponse(response.data, router)
    },

    /** Запрос кода для восстановления пароля. */
    async requestPasswordReset(email: string): Promise<string> {
      const response = await api.post('/auth/password/reset/request/', { email })
      return response.data?.detail ?? ''
    },

    /** Сброс пароля кодом из письма (старые сессии на сервере отзываются). */
    async confirmPasswordReset(
      email: string,
      code: string,
      password: string,
      router: Router | null = null
    ): Promise<void> {
      const response = await api.post('/auth/password/reset/confirm/', {
        email,
        code,
        password
      })
      await this.applyTokenResponse(response.data, router)
    },

    /**
     * Задаёт (или меняет) пароль текущего пользователя.
     *
     * Первый сценарий — после входа по коду: текущего пароля ещё нет.
     * Если пароль уже задан, сервер требует ``currentPassword``.
     *
     * Сервер при смене пароля отзывает все прочие сессии и возвращает новую
     * пару токенов — её нужно сохранить, иначе текущее устройство вылетит.
     */
    async setPassword(password: string, currentPassword?: string): Promise<void> {
      const response = await api.post('/auth/password/set/', {
        password,
        current_password: currentPassword ?? null
      })
      if (response.data?.access_token) {
        this.accessToken = response.data.access_token
        this.refreshToken = response.data.refresh_token ?? this.refreshToken
        this.saveState()
      }
    },

    /** Выходит из аккаунта на всех устройствах (кроме текущего). */
    async revokeAllSessions(): Promise<void> {
      await api.post('/auth/sessions/revoke-all/', {})
    },

    /** Второй шаг входа с нового устройства: код из письма → токены. */
    async verifyDeviceLogin(
      challengeToken: string,
      code: string,
      router: Router | null = null
    ): Promise<void> {
      const response = await api.post('/auth/login/verify-device/', {
        challenge_token: challengeToken,
        code
      })
      await this.applyTokenResponse(response.data, router)
    },

    /** Активные входы аккаунта (устройства) — для раздела «Безопасность». */
    async fetchSessions(): Promise<AuthSession[]> {
      const response = await api.get('/auth/sessions/')
      return (response.data?.sessions ?? []) as AuthSession[]
    },

    /** Отзывает один вход (устройство) по id сессии. */
    async revokeSession(sessionId: number): Promise<void> {
      await api.delete(`/auth/sessions/${sessionId}/`)
    },

    /** Вход по номеру телефона и паролю. */
    async loginWithPassword(phoneNumber: string, password: string, router: Router | null = null) {
      try {
        const response = await api.post('/auth/password/login/', {
          phone_number: phoneNumber,
          password
        })
        await this.applyTokenResponse(response.data, router)
      } catch (error) {
        console.error('Login with password error:', error)
        this.resetAuth()
        throw error
      }
    },

    /** Создаёт пароль для номера (аккаунт при необходимости) и входит. */
    async registerWithPassword(
      phoneNumber: string,
      password: string,
      router: Router | null = null
    ) {
      try {
        const response = await api.post('/auth/password/register/', {
          phone_number: phoneNumber,
          password
        })
        await this.applyTokenResponse(response.data, router)
      } catch (error) {
        console.error('Register with password error:', error)
        this.resetAuth()
        throw error
      }
    },

    async logout(router: Router | null = null) {
      this.resetAuth()
      if (router) {
        await router.push({ name: 'Login' })
      }
    },

    async refreshTokens() {
      if (!this.refreshToken) {
        throw new Error('No refresh token available')
      }

      try {
        const response = await api.post(
          '/jwt/auth/refresh',
          {},
          { headers: { Authorization: `Bearer ${this.refreshToken}` } }
        )

        this.accessToken = response.data.access_token
        this.refreshToken = response.data.refresh_token ?? this.refreshToken
        this.saveState()
        return response.data
      } catch (error) {
        console.error('Refresh token error:', error)
        await this.logout()
        throw error
      }
    },

    async fetchUser() {
      try {
        const response = await api.get<ApiUser>('/jwt/users/me/')
        this.user = response.data
        this.current_user = response.data
        this.isAuthenticated = true
      } catch (error) {
        // Если interceptor не смог обновить токен (401) — выходим.
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          console.error('Access token invalid, logging out.')
          await this.logout()
        } else {
          console.error('Failed to fetch user:', getErrorMessage(error))
          this.user = null
          this.current_user = null
          this.isAuthenticated = false
          this.saveState()
          throw error
        }
      }
      this.saveState()
    },

    async updateCurrentUser(userData: Partial<ApiUser> & Record<string, unknown>) {
      try {
        if (!this.accessToken) {
          throw new Error('No access token available for update request.')
        }

        const response = await api.patch('/jwt/users/me/', userData)

        this.current_user = { ...this.current_user, ...response.data }
        this.user = { ...this.user, ...response.data }
        this.saveState()
        return response.data
      } catch (error) {
        console.error('Failed to update user profile:', getErrorMessage(error))
        throw error
      }
    },

    saveState() {
      localStorage.setItem(
        'authState',
        JSON.stringify({
          user: this.user,
          isAuthenticated: this.isAuthenticated,
          current_user: this.current_user,
          accessToken: this.accessToken,
          refreshToken: this.refreshToken
        })
      )
      // Дублируем токен в кэш, читаемый service worker (кнопки уведомлений).
      void import('@/services/swToken').then((m) => m.saveSwToken(this.accessToken))
    },

    resetAuth() {
      this.user = null
      this.current_user = null
      this.isAuthenticated = false
      this.accessToken = null
      this.refreshToken = null
      this.saveState()
    }
  }
})

// Единый HTTP-клиент: регистрируем источник access-токена и обработчик 401.
// Вызывается один раз при импорте модуля; useAuthStore() дёргается лениво.
registerAuth(
  () => useAuthStore().accessToken,
  async () => {
    const store = useAuthStore()
    if (!store.refreshToken) return false
    try {
      await store.refreshTokens()
      return store.isAuthenticated
    } catch {
      return false
    }
  }
)
