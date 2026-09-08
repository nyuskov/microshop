import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth' // Import the auth store

// Quasar (UI framework) + Material icons (outlined) — импортируем до наших
// стилей, чтобы переопределения из style.css/appearance.css имели приоритет.
import { Quasar, Dialog, Notify } from 'quasar'
import quasarRuLang from 'quasar/lang/ru'
import '@quasar/extras/material-icons-outlined/material-icons-outlined.css'
import 'quasar/dist/quasar.css'

// Import global styles
import './assets/style.css'
import './assets/appearance.css'
import './assets/quasar.css'
import './assets/a11y.css'
// Import the new theme store
import { useThemeStore } from './stores/theme'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.use(Quasar, {
  lang: quasarRuLang,
  plugins: {
    Dialog,
    Notify
  },
  config: {
    brand: {
      primary: '#2ea25e',
      secondary: '#6d7c8c',
      accent: '#2f7fd1',
      dark: '#171e26',
      positive: '#2ea25e',
      negative: '#d64545',
      info: '#3aa6e0',
      warning: '#ee7f1d'
    },
    notify: {
      position: 'top',
      timeout: 2500
    },
    ripple: true
  }
})

// Quasar 2.30 (полный бандл) НЕ регистрирует компоненты/директивы через app.use —
// регистрируем их глобально вручную из экспортов библиотеки (без @quasar/vite-plugin).
import * as QuasarExports from 'quasar'
for (const [, mod] of Object.entries(QuasarExports)) {
  const value = mod as { name?: unknown; install?: unknown } | null | undefined
  if (value === null || typeof value !== 'object' || typeof value.name !== 'string') continue
  const compName = value.name
  // Q* — компонент (q-btn, q-dialog...), иначе — директива (close-popup, ripple...).
  if (compName.startsWith('Q')) {
    app.component(compName, value as never)
  } else {
    app.directive(compName, value as never)
  }
}

// Initialize the theme and sidebar state after app creation
const themeStore = useThemeStore()
themeStore.initializeTheme()
themeStore.initializeSidebarState() // Initialize sidebar state

// Initialize the auth store to check for existing tokens
const authStore = useAuthStore()
authStore.initializeApp() // Call initializeApp to check token validity

app.mount('#app')
