import { defineStore } from 'pinia'
import type { Router } from 'vue-router'
import axios from 'axios'

// Define backendServer constant as the direct address to the backend service, including port 8000.
// This bypasses the nginx proxy for API calls.
export const backendServer = `${window.location.protocol}//${window.location.hostname}:8000`

export const useAuthStore = defineStore('auth', {
  // Add accessToken and refreshToken to the state
  state: () => {
    const storedState = localStorage.getItem('authState')
    const parsedState = storedState
      ? JSON.parse(storedState)
      : {
          user: null,
          isAuthenticated: false,
          current_user: null,
          accessToken: null,
          refreshToken: null
        }
    // Initialize axios default headers with the stored token if available
    if (parsedState.accessToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${parsedState.accessToken}`
    }
    return parsedState
  },
  getters: {
    // Вычисляемое свойство для проверки, является ли пользователь администратором
    isAdmin: (state) => {
      return state.user && state.user.is_superuser === true
    }
  },
  actions: {
    async initializeApp() {
      // Check if we have a valid token on app start
      if (this.accessToken) {
        await this.fetchUser()
      }
    },

    // Старый метод, переименованный и закомментированный как резервный
    // async login(username: string, password: string, router: Router | null = null) {
    //   try {
    //     // Send credentials as JSON data. The backend should handle phone numbers as usernames.
    //     const requestData = {
    //       username: username, // This can now be a phone number
    //       password: password
    //     }

    //     const response = await axios.post(`${backendServer}/api/v1/auth/token/`, requestData, {
    //       headers: {
    //         'Content-Type': 'application/json' // Changed from multipart/form-data to application/json
    //       }
    //     })

    //     // Проверяем, что в ответе действительно есть токены
    //     if (!response.data || !response.data.access_token) {
    //       console.error('Login failed: No access token received from server.')
    //       throw new Error('Server response did not contain access token.')
    //     }

    //     this.accessToken = response.data.access_token
    //     // Refresh token может быть не всегда
    //     if (response.data.refresh_token) {
    //       this.refreshToken = response.data.refresh_token
    //     }

    //     // Set the Authorization header for subsequent requests
    //     axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`

    //     // Save state to localStorage
    //     this.isAuthenticated = true
    //     this.saveState()

    //     // Обязательно обновляем информацию о пользователе после входа
    //     await this.fetchUser()

    //     if (router && this.current_user !== null) {
    //       await router.push({ name: 'Messenger' })
    //     }
    //   } catch (error) {
    //     console.error('Login error:', error)
    //     // Убедимся, что состояние очищено при любой ошибке входа
    //     this.current_user = null
    //     this.isAuthenticated = false
    //     this.user = null
    //     this.accessToken = null
    //     this.refreshToken = null
    //     delete axios.defaults.headers.common['Authorization']
    //     this.saveState()
    //     throw error // Перебросим ошибку наверх
    //   }
    // },

    // Новый метод для запроса OTP
    async requestOtp(phoneNumber: string): Promise<void> {
      try {
        const response = await axios.post(
          `${backendServer}/api/v1/auth/request-otp/`,
          {
            phone_number: phoneNumber
          },
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )

        console.log('OTP sent successfully:', response.data)
        // Бэкенд может вернуть что-то полезное, например, срок действия кода
        // или подтверждение успешной отправки.
        // Для простоты, просто логгируем успех.
      } catch (error) {
        console.error('Request OTP error:', error)
        // Пробрасываем ошибку, чтобы компонент мог её обработать
        throw error
      }
    },

    // Новый метод для входа с использованием OTP
    async loginWithOtp(phoneNumber: string, otpCode: string, router: Router | null = null) {
      try {
        // Отправляем номер телефона и код OTP на бэкенд для верификации
        const response = await axios.post(
          `${backendServer}/api/v1/auth/verify-otp/`,
          {
            phone_number: phoneNumber,
            otp: otpCode
          },
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )

        // Проверяем, что в ответе действительно есть токены
        if (!response.data || !response.data.access_token) {
          console.error('Login with OTP failed: No access token received from server.')
          throw new Error('Server response did not contain access token.')
        }

        this.accessToken = response.data.access_token
        // Refresh token может быть не всегда
        if (response.data.refresh_token) {
          this.refreshToken = response.data.refresh_token
        }

        // Set the Authorization header for subsequent requests
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`

        // Save state to localStorage
        this.isAuthenticated = true
        this.saveState()

        // Обязательно обновляем информацию о пользователе после входа
        // Обернем fetchUser в try...catch, чтобы обработать ошибки получения данных
        try {
          console.log("DEBUG: Inside loginWithOtp, before fetchUser, isAuthenticated =", this.isAuthenticated);
          await this.fetchUser()
          console.log("DEBUG: Inside loginWithOtp, after fetchUser, isAuthenticated =", this.isAuthenticated);
        } catch (fetchError) {
          console.error('Failed to fetch user data after loginWithOtp:', fetchError);
          // Если fetchUser не удался, считаем весь вход неуспешным.
          // Очищаем состояние аутентификации.
          this.current_user = null
          this.isAuthenticated = false
          this.user = null
          this.accessToken = null
          this.refreshToken = null
          delete axios.defaults.headers.common['Authorization']
          this.saveState()
          // Пробрасываем ошибку дальше, чтобы компоненты могли её обработать
          throw fetchError;
        }

        if (router && this.current_user !== null) {
          await router.push({ name: 'Messenger' })
        }
      } catch (error) {
        console.error('Login with OTP error:', error)
        // Убедимся, что состояние очищено при любой ошибке входа
        this.current_user = null
        this.isAuthenticated = false
        this.user = null
        this.accessToken = null
        this.refreshToken = null
        delete axios.defaults.headers.common['Authorization']
        this.saveState()
        throw error // Перебросим ошибку наверх
      }
    },

    async logout(router: Router | null = null) {
      // Clear tokens from state and localStorage
      this.current_user = null
      this.isAuthenticated = false
      this.user = null
      this.accessToken = null
      this.refreshToken = null
      delete axios.defaults.headers.common['Authorization']

      this.saveState()

      if (router) {
        await router.push({ name: 'Login' })
      }
    },

    async refreshToken() {
      if (!this.refreshToken) {
        throw new Error('No refresh token available')
      }

      try {
        const response = await axios.post(`${backendServer}/api/v1/jwt/refresh/`, {
          refresh_token: this.refreshToken
        })

        this.accessToken = response.data.access_token

        // Update the Authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`

        // Save the new access token
        this.saveState()

        return response.data
      } catch (error) {
        console.error('Refresh token error:', error)
        // If refresh fails, log out the user
        this.logout()
        throw error
      }
    },

    async fetchUser() {
      try {
        const response = await axios.get(`${backendServer}/api/v1/jwt/users/me/`)
        this.user = response.data
        this.isAuthenticated = true
        console.log("DEBUG: Inside fetchUser try block, after setting isAuthenticated = true, current value =", this.isAuthenticated);
        this.current_user = response.data
      } catch (error) {
        console.error('Failed to fetch user:', error)
        console.log("DEBUG: Inside fetchUser catch block, before any changes, isAuthenticated =", this.isAuthenticated);
        // If fetching user fails, it might be due to an invalid token.
        // In this case, we'll attempt to refresh the token.
        // Проверим, есть ли refresh_token перед попыткой обновления
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            // Attempt to refresh the token
            await this.refreshToken()
            // After successful refresh, retry fetching user
            const response = await axios.get(`${backendServer}/api/v1/jwt/users/me/`)
            this.user = response.data
            this.isAuthenticated = true
            this.current_user = response.data
          } catch (refreshError) {
            // If refresh also fails, log out the user
            console.error('Token refresh failed, logging out.', refreshError)
            this.logout()
          }
        } else if (error.response?.status === 401) {
          // Если статус 401 и refresh_token нет, сразу логаут
          console.error('Access token invalid and no refresh token, logging out.')
          this.logout()
        } else {
          // For other errors, just reset user info
          // ВАЖНО: теперь этот блок также бросает ошибку
          this.user = null
          this.isAuthenticated = false
          console.log("DEBUG: Inside fetchUser catch block, after setting isAuthenticated = false, current value =", this.isAuthenticated);
          this.current_user = null
          this.saveState() // Сохраняем состояние после сброса
          // Бросаем ошибку, чтобы loginWithOtp мог её перехватить
          throw error;
        }
        console.log("DEBUG: Inside fetchUser catch block (after 401 checks), isAuthenticated =", this.isAuthenticated);
      }
      // saveState вызывается всегда после завершения try или catch
      console.log("DEBUG: End of fetchUser, calling saveState, isAuthenticated =", this.isAuthenticated);
      this.saveState()
    },

    // Новый метод для обновления данных текущего пользователя
    async updateCurrentUser(userData: Partial<typeof this.current_user>) {
      try {
        // Убедимся, что у нас есть токен
        if (!this.accessToken) {
          throw new Error('No access token available for update request.')
        }

        // Уберем служебные поля, которые не должны отправляться на сервер
        const {
          user: _user,
          isAuthenticated: _isAuthenticated,
          accessToken: _accessToken,
          refreshToken: _refreshToken,
          ...updatableData
        } = userData

        const response = await axios.patch(`${backendServer}/api/v1/jwt/users/me/`, updatableData, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`
          }
        })

        // Обновим данные пользователя в store после успешного запроса
        this.current_user = { ...this.current_user, ...response.data }
        this.user = { ...this.user, ...response.data } // Также обновим в user, если используется

        this.saveState() // Сохраняем обновленное состояние

        console.log('User profile updated successfully:', response.data)
        return response.data
      } catch (error) {
        console.error('Failed to update user profile:', error)
        if (error.response) {
          console.error('Server responded with error:', error.response.status, error.response.data)
        } else if (error.request) {
          console.error('No response received:', error.request)
        } else {
          console.error('Request setup error:', error.message)
        }
        throw error // Перебросим ошибку наверх для обработки в компоненте
      }
    },

    saveState() {
      /*
            We save state to local storage to keep the
            state when the user reloads the page.

            This is a simple way to persist state. For a more robust solution,
            use pinia-persistent-state.
             */
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
    }
  }
})

// Добавляем недостающую функцию getAddress
export function getAddress(): string {
  // Возвращаем хост из URL, можно настроить по необходимости
  return window.location.hostname
}

// Restore the getCSRFToken function for other parts of the app that might need it
export function getCSRFToken(): string | null {
  /*
    We get the CSRF token from the cookie to include in our requests.
    This is necessary for CSRF protection in Django.
     */
  // FIXED: Change the cookie name to match what the backend sets
  const name = 'csrf_token'
  let cookieValue = null
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';')
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim()
      if (cookie.substring(0, name.length + 1) === name + '=') {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1))
        break
      }
    }
  }
  if (cookieValue === null) {
    console.warn('CSRF cookie not found. A request to set it may be needed.')
  }
  return cookieValue
}

// Export axios instance for use in other parts of the application
export { axios }