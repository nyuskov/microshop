import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';

import PrimeVue from 'primevue/config';
import Theme from '@primevue/themes/nora';
import { Ripple } from 'primevue';
import 'primeicons/primeicons.css';
import Modals from './plugins/modals';


const app = createApp(App);

app.directive('ripple', Ripple);
app.use(createPinia());
app.use(router);
app.use(Modals);

app.use(PrimeVue, {
    theme: {
        preset: Theme, // Set your theme preset here
        options: {
            prefix: 'p', // Example prefix option
            darkModeSelector: 'system', // Example darkModeSelector option
            cssLayer: false // Example cssLayer option
        }
    },
    ripple: true,
});

app.mount('#app');
