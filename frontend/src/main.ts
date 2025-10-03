import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';


const app = createApp(App)

app.use(createPinia())
app.use(router)

app.use(PrimeVue, {
    theme: {
        preset: Aura, // Set your theme preset here
        options: {
            prefix: 'p', // Example prefix option
            darkModeSelector: 'system', // Example darkModeSelector option
            cssLayer: false // Example cssLayer option
        }
    }
});

app.mount('#app')
