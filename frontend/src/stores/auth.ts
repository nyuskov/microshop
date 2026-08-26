import { defineStore } from 'pinia'
import type { Router } from 'vue-router'

// Define backendServer constant, using HTTPS to match frontend protocol
export const backendServer = `https://${window.location.hostname}:8000`;

export const useAuthStore = defineStore('auth', {
  state: () => {
    const storedState = localStorage.getItem('authState')
    return Object.assign(storedState ? JSON.parse(storedState) : { user: null, isAuthenticated: false, current_user: null, })
  },
  actions: {
    async initializeApp() {
      // Вызываем setCsrfToken при инициализации приложения, чтобы получить куки
      await this.setCsrfToken();
    },

    async setCsrfToken() {
      // Используем адрес с фиксированным портом 8000, предполагая, что бэкенд там
      // const backendHost = window.location.hostname; // Получаем текущий хост
      // const backendUrl = `http://${backendHost}:8000/api/set-csrf-token`; // Формируем URL
      const backendUrl = `${backendServer}/api/set-csrf-token`; // Формируем URL
      console.log("Fetching CSRF token from:", backendUrl); // Лог для отладки
      await fetch(backendUrl, {
        method: 'GET',
        credentials: 'include', // Критично: позволяет отправлять/получать куки
      }).catch(error => {
        console.error("Failed to fetch CSRF token:", error);
      });
    },

    async login(username: string, password: string, router: Router | null = null) {
      const csrfToken = getCSRFToken(); // Получаем токен
      const headers: Record<string, string> = { // Определяем заголовки как Record
        'Content-Type': 'application/json',
      };
      if (csrfToken) { // Проверяем, есть ли токен, прежде чем добавлять его в заголовки
        headers['X-CSRFToken'] = csrfToken;
      }

      const response = await fetch(`${backendServer}/api/login`, {
        method: 'POST',
        headers, // Используем подготовленный объект заголовков
        body: JSON.stringify({
          username,
          password
        }),
        credentials: 'include',
      })
      const data = await response.json()
      if (data.success) {
        this.isAuthenticated = true
        this.saveState()
        if (router) {
          await this.fetchUser()
          if (this.current_user !== null) {
            await router.push({
              name: 'home',
            })
          }
        }
      } else {
        this.current_user = null
        this.isAuthenticated = false
        this.saveState()
      }
    },

    async logout(router: Router | null = null) {
      try {
        const csrfToken = getCSRFToken(); // Получаем токен
        const headers: Record<string, string> = {}; // Определяем заголовки как Record
        if (csrfToken) { // Проверяем, есть ли токен, прежде чем добавлять его в заголовки
          headers['X-CSRFToken'] = csrfToken;
        }

        const response = await fetch(`${backendServer}/api/logout`, {
          method: 'POST',
          headers, // Используем подготовленный объект заголовков
          credentials: 'include',
        })
        if (response.ok) {
          this.current_user = null
          this.isAuthenticated = false
          this.user = null
          this.saveState()
          if (router) {
            await router.push({
              name: 'login',
            })
          }
        }
      } catch (error) {
        console.error('Logout failed', error)
        throw error
      }
    },

    async fetchUser() {
      try {
        const csrfToken = getCSRFToken(); // Получаем токен
        const headers: Record<string, string> = { // Определяем заголовки как Record
          'Content-Type': 'application/json',
        };
        if (csrfToken) { // Проверяем, есть ли токен, прежде чем добавлять его в заголовки
          headers['X-CSRFToken'] = csrfToken;
        }

        const response = await fetch(`${backendServer}/api/user`, {
          credentials: 'include',
          headers, // Используем подготовленный объект заголовков
        })
        if (response.ok) {
          const data = await response.json()
          this.user = data
          this.isAuthenticated = true
          this.current_user = data
        } else {
          this.user = null
          this.isAuthenticated = false
          this.current_user = null
        }
      } catch (error) {
        console.error('Failed to fetch user', error)
        this.user = null
        this.isAuthenticated = false
        this.current_user = null
      }
      this.saveState()
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
        }),
      )
    },
  },
})

// Добавляем недостающую функцию getAddress
export function getAddress(): string {
  // Возвращаем хост из URL, можно настроить по необходимости
  return window.location.hostname;
}

export function getCSRFToken(): string | null {
  /*
    We get the CSRF token from the cookie to include in our requests.
    This is necessary for CSRF protection in Django.
     */
  const name = 'csrftoken'
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
    console.warn('CSRF cookie not found. A request to set it may be needed.');
  }
  return cookieValue
}

