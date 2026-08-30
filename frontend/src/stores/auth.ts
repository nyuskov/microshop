import { defineStore } from 'pinia'
import type { Router } from 'vue-router'
import axios from 'axios';

// Define backendServer constant as the direct address to the backend service, including port 8000.
// This bypasses the nginx proxy for API calls.
export const backendServer = `${window.location.protocol}//${window.location.hostname}:8000`;

export const useAuthStore = defineStore('auth', {
  // Add accessToken and refreshToken to the state
  state: () => {
    const storedState = localStorage.getItem('authState')
    const parsedState = storedState ? JSON.parse(storedState) : { user: null, isAuthenticated: false, current_user: null, accessToken: null, refreshToken: null };
    // Initialize axios default headers with the stored token if available
    if (parsedState.accessToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${parsedState.accessToken}`;
    }
    return parsedState;
  },
  actions: {
    async initializeApp() {
      // Check if we have a valid token on app start
      if (this.accessToken) {
        await this.fetchUser();
      }
    },

    async login(username: string, password: string, router: Router | null = null) {
      try {
        // Create FormData object to send credentials as form data
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);

        const response = await axios.post(`${backendServer}/api/v1/auth/token/`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        // Проверяем, что в ответе действительно есть токены
        if (!response.data || !response.data.access_token) {
          console.error('Login failed: No access token received from server.');
          throw new Error('Server response did not contain access token.');
        }

        this.accessToken = response.data.access_token;
        // Refresh token может быть не всегда
        if (response.data.refresh_token) {
            this.refreshToken = response.data.refresh_token;
        }

        // Set the Authorization header for subsequent requests
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;

        // Save state to localStorage
        this.isAuthenticated = true;
        this.saveState();

        if (router) {
          await this.fetchUser();
          if (this.current_user !== null) {
            await router.push({ name: 'Home' });
          }
        }
      } catch (error) {
        console.error('Login error:', error);
        // Убедимся, что состояние очищено при любой ошибке входа
        this.current_user = null;
        this.isAuthenticated = false;
        this.user = null;
        this.accessToken = null;
        this.refreshToken = null;
        delete axios.defaults.headers.common['Authorization'];
        this.saveState();
        throw error; // Перебросим ошибку наверх
      }
    },

    async logout(router: Router | null = null) {
      // Clear tokens from state and localStorage
      this.current_user = null;
      this.isAuthenticated = false;
      this.user = null;
      this.accessToken = null;
      this.refreshToken = null;
      delete axios.defaults.headers.common['Authorization'];

      this.saveState();

      if (router) {
        await router.push({ name: 'login' });
      }
    },

    async refreshToken() {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }

      try {
        const response = await axios.post(`${backendServer}/api/v1/jwt/refresh/`, {
          refresh_token: this.refreshToken,
        });

        this.accessToken = response.data.access_token;

        // Update the Authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;

        // Save the new access token
        this.saveState();

        return response.data;
      } catch (error) {
        console.error('Refresh token error:', error);
        // If refresh fails, log out the user
        this.logout();
        throw error;
      }
    },

    async fetchUser() {
      try {
        const response = await axios.get(`${backendServer}/api/v1/jwt/users/me/`);
        this.user = response.data;
        this.isAuthenticated = true;
        this.current_user = response.data;
      } catch (error) {
        console.error('Failed to fetch user:', error);
        // If fetching user fails, it might be due to an invalid token.
        // In this case, we'll attempt to refresh the token.
        // Проверим, есть ли refresh_token перед попыткой обновления
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            // Attempt to refresh the token
            await this.refreshToken();
            // After successful refresh, retry fetching user
            const response = await axios.get(`${backendServer}/api/v1/jwt/users/me/`);
            this.user = response.data;
            this.isAuthenticated = true;
            this.current_user = response.data;
          } catch (refreshError) {
            // If refresh also fails, log out the user
            console.error('Token refresh failed, logging out.', refreshError);
            this.logout();
          }
        } else if (error.response?.status === 401) {
          // Если статус 401 и refresh_token нет, сразу логаут
          console.error('Access token invalid and no refresh token, logging out.');
          this.logout();
        } else {
          // For other errors, just reset user info
          this.user = null;
          this.isAuthenticated = false;
          this.current_user = null;
        }
      }
      this.saveState();
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
          refreshToken: this.refreshToken,
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
    console.warn('CSRF cookie not found. A request to set it may be needed.');
  }
  return cookieValue
}

// Export axios instance for use in other parts of the application
export { axios };