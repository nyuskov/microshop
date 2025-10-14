import { defineStore } from 'pinia';
import type { Router } from 'vue-router';

const routes: Record<string, string> = {
  "login": "/api/v1/auth/login",
  "logout": "/api/v1/auth/logout",
  "user": "/api/v1/users/me",
}

export const useAuthStore = defineStore('auth', {
  state: () => {
    const storedState = localStorage.getItem('authState');
    return Object.assign(
      storedState ? JSON.parse(storedState) : {
        user: null, isAuthenticated: false, currentUser: null,
        token: null, result: null,
      })
  },
  actions: {
    async login(username: string, password: string) {
      await fetch('https://' + getAddress() + routes['login'], {
        method: 'POST',
        body: new URLSearchParams({
          'username': username,
          'password': password,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': backendServer.csrfToken,
        },
        credentials: 'include',
      }).then(async (response) => {
        this.token = await response.json();

        if (this.token["access_token"]) {
          this.result = { "message": "OK", "status": true };
          this.isAuthenticated = true;
          this.saveState();

          await this.fetchUser();
        } else {
          this.result = { "message": "Ошибка: Неверные данные", "status": false };
          this.currentUser = null;
          this.isAuthenticated = false;
          this.saveState();
        }
      }).catch((error) => {
        this.result = { "message": error, "status": false };
        this.currentUser = null;
        this.isAuthenticated = false;
        this.saveState();
      });
    },

    async logout(router: Router | null = null) {
      await fetch('https://' + getAddress() + routes['logout'], {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCSRFToken(),
          'Authorization': this.token['token_type'] + ' ' + this.token['access_token'],
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      }).then((response) => {
        this.currentUser = null;
        this.isAuthenticated = false;
        this.user = null;
        this.saveState();
      }).catch((error) => {
        console.error('Ошибка: ', error)
      });
    },

    async fetchUser() {
      await fetch('https://' + getAddress() + routes["user"], {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token['token_type'] + ' ' + this.token['access_token'],
          'X-CSRFToken': getCSRFToken(),
        },
      }).then(async (response) => {
        this.user = await response.json();
        this.isAuthenticated = true
        this.currentUser = this.user;
      }).catch((error) => {
        console.error('Ошибка: ', error)
        this.user = null
        this.isAuthenticated = false
        this.currentUser = null
      });

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
          currentUser: this.currentUser,
          token: this.token, result: this.result,
        }),
      )
    },
  },
})

export function getCSRFToken() {
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
    throw 'Отсутствует CSRF cookie.'
  }
  return cookieValue
}

export function getAddress() {
  let hostValue: string | null = null;
  if (window.location.host && window.location.host !== '') {
    hostValue = window.location.host.split(':')[0] + ":8000";
  }
  return hostValue
}

type BackendServer = {
  address: string | null,
  csrfToken: string,
}
export const backendServer: BackendServer = {
  address: getAddress(),
  csrfToken: getCSRFToken(),
}