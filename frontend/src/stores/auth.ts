import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => {
    const storedState = localStorage.getItem('authState')
    return Object.assign(storedState ? JSON.parse(storedState) : { user: null, isAuthenticated: false, current_user: null, })
  },
  actions: {
    async setCsrfToken() {
      await fetch('http://' + getAddress() + '/api/set-csrf-token', {
        method: 'GET',
        credentials: 'include',
      })
    },

    async login(username, password, router = null) {

      const response = await fetch('http://' + getAddress() + '/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCSRFToken(),
        },
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

    async logout(router = null) {
      try {
        const response = await fetch('http://' + getAddress() + '/api/logout', {
          method: 'POST',
          headers: {
            'X-CSRFToken': getCSRFToken(),
          },
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
        const response = await fetch('http://' + getAddress() + '/api/user', {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRFToken(),
          },
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
    throw 'Missing CSRF cookie.'
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
