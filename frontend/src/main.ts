import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// Import global styles first
import './assets/style.css'

import PrimeVue from 'primevue/config'
import Theme from '@primeuix/themes/aura'
import { Ripple } from 'primevue'
import 'primeicons/primeicons.css'
// Import the new theme store
import { useThemeStore } from './stores/theme'

const app = createApp(App)

app.directive('ripple', Ripple)
app.use(createPinia())
app.use(router)

app.use(PrimeVue, {
  theme: {
    preset: Theme, // Set your theme preset here
    options: {
      prefix: 'p', // Example prefix option
      darkModeSelector: 'data-theme=dark', // Tell PrimeVue to use our custom dark mode selector
      cssLayer: false // Example cssLayer option
    }
  },
  ripple: true
})

// Initialize the theme and sidebar state after app creation
const themeStore = useThemeStore()
themeStore.initializeTheme()
themeStore.initializeSidebarState() // Initialize sidebar state

app.mount('#app')