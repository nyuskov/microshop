import { backend_server } from '@/utils/network';
import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import { type Router } from 'vue-router';

const routes: Record<string, string> = {
  "login": "/api/v1/auth/login",
  "logout": "/api/v1/auth/logout",
  "user": "/api/v1/users/me",
}

export const useAuthStore = defineStore('auth', {
  state: () => {
    const $stored_state = localStorage.getItem('authState');
    return Object.assign(
      $stored_state ? JSON.parse($stored_state) : {
        user: null, is_authenticated: false, current_user: null,
        token: null,
      })
  },
  actions: {
    async login(
      username: string,
      password: string,
      result: Ref<string, string> = ref(""),
      severity: Ref<string, string> = ref(""),
      router: Router,
    ) {
      await fetch(`https://${backend_server.address}${routes["login"]}`, {
        method: 'POST',
        body: new URLSearchParams({
          'username': username,
          'password': password,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': backend_server.csrf_token,
        },
        credentials: 'include',
      }).then(async (response) => {
        this.token = await response.json();

        if (this.token["access_token"]) {
          result.value = "OK";
          severity.value = "success";
          this.is_authenticated = true;
          this.saveState();

          await this.fetchUser();
          router.push("/");
        } else {
          result.value = "Ошибка: Неверные данные";
          severity.value = "success";
          this.current_user = null;
          this.is_authenticated = false;
          this.saveState();
        }
      }).catch((error) => {
        result.value = `Ошибка: ${error}`;
        this.current_user = null;
        this.is_authenticated = false;
        this.saveState();
      });
    },

    async logout() {
      await fetch(`https://${backend_server.address}${routes["logout"]}`, {
        method: 'POST',
        headers: {
          'X-CSRFToken': backend_server.csrf_token,
          'Authorization': `${this.token['token_type']} ${this.token['access_token']}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      }).then((response) => {
        this.current_user = null;
        this.is_authenticated = false;
        this.user = null;
        this.saveState();
      }).catch((error) => {
        console.error('Ошибка: ', error)
      });
    },

    async fetchUser() {
      await fetch(`https://${backend_server.address}${routes["user"]}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `${this.token['token_type']} ${this.token['access_token']}`,
          'X-CSRFToken': backend_server.csrf_token,
        },
      }).then(async (response) => {
        this.user = await response.json();
        this.is_authenticated = true;
        this.current_user = this.user;
      }).catch((error) => {
        console.error('Ошибка: ', error);
        this.user = null;
        this.is_authenticated = false;
        this.current_user = null;
      });

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
          is_authenticated: this.is_authenticated,
          current_user: this.current_user,
          token: this.token,
        }),
      )
    },
  },
})