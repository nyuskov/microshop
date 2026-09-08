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
  is_superuser?: boolean
  avatar_url?: string | null
  status?: string | null
  last_seen?: string | null
  profile?: ApiUserProfile | null
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

    /** Статус пароля для номера: зарегистрирован ли и задан ли пароль. */
    async passwordStatus(
      phoneNumber: string
    ): Promise<{ registered: boolean; has_password: boolean }> {
      const response = await api.post('/auth/password/status/', {
        phone_number: phoneNumber
      })
      return response.data as { registered: boolean; has_password: boolean }
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
