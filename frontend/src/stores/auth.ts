import { defineStore } from 'pinia'
import type { Router } from 'vue-router'
import axios from 'axios'

import { getErrorMessage } from '@/services/errors'

// Прямой адрес бэкенда (минуя nginx-прокси для API-запросов)
export const backendServer = `${window.location.protocol}//${window.location.hostname}:8000`

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
  state: (): AuthState => {
    const state = loadState()
    // Восстанавливаем Authorization header из сохранённого токена
    if (state.accessToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`
    }
    return state
  },

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
        const response = await axios.post(
          `${backendServer}/api/v1/auth/request-otp/`,
          { phone_number: phoneNumber },
          { headers: { 'Content-Type': 'application/json' } }
        )
        console.log('OTP sent successfully:', response.data)
      } catch (error) {
        console.error('Request OTP error:', error)
        throw error
      }
    },

    async loginWithOtp(phoneNumber: string, otpCode: string, router: Router | null = null) {
      try {
        const response = await axios.post(
          `${backendServer}/api/v1/auth/verify-otp/`,
          { phone_number: phoneNumber, otp: otpCode },
          { headers: { 'Content-Type': 'application/json' } }
        )

        if (!response.data?.access_token) {
          throw new Error('Server response did not contain access token.')
        }

        this.accessToken = response.data.access_token
        this.refreshToken = response.data.refresh_token ?? null
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`

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

    async logout(router: Router | null = null) {
      this.resetAuth()
      if (router) {
        await router.push({ name: 'Login' })
      }
    },

    async setCsrfToken() {
      await axios.get(`${backendServer}/api/v1/set-csrf-token`)
    },

    async refreshTokens() {
      if (!this.refreshToken) {
        throw new Error('No refresh token available')
      }

      try {
        const response = await axios.post(
          `${backendServer}/api/v1/jwt/auth/refresh`,
          {},
          { headers: { Authorization: `Bearer ${this.refreshToken}` } }
        )

        this.accessToken = response.data.access_token
        this.refreshToken = response.data.refresh_token ?? this.refreshToken
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`
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
        const response = await axios.get<ApiUser>(`${backendServer}/api/v1/jwt/users/me/`)
        this.user = response.data
        this.current_user = response.data
        this.isAuthenticated = true
      } catch (error) {
        // Пробуем обновить токен при ошибке 401
        if (axios.isAxiosError(error) && error.response?.status === 401 && this.refreshToken) {
          try {
            await this.refreshTokens()
            const response = await axios.get<ApiUser>(`${backendServer}/api/v1/jwt/users/me/`)
            this.user = response.data
            this.current_user = response.data
            this.isAuthenticated = true
          } catch (refreshError) {
            console.error('Token refresh failed, logging out.', refreshError)
            await this.logout()
          }
        } else if (axios.isAxiosError(error) && error.response?.status === 401) {
          console.error('Access token invalid and no refresh token, logging out.')
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

        const response = await axios.patch(`${backendServer}/api/v1/jwt/users/me/`, userData, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`
          }
        })

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
      delete axios.defaults.headers.common['Authorization']
      this.saveState()
    }
  }
})

export function getAddress(): string {
  return window.location.hostname
}

// Получение CSRF-токена из cookie (используется другими частями приложения)
export function getCSRFToken(): string | null {
  const name = 'csrf_token'
  const cookies = document.cookie.split(';')
  for (const cookie of cookies) {
    const trimmed = cookie.trim()
    if (trimmed.substring(0, name.length + 1) === `${name}=`) {
      return decodeURIComponent(trimmed.substring(name.length + 1))
    }
  }
  console.warn('CSRF cookie not found. A request to set it may be needed.')
  return null
}

export { axios }
