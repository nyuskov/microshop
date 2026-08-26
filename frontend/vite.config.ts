import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import checker from 'vite-plugin-checker'
import mkcert from 'vite-plugin-mkcert'


// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),
    checker({
      // e.g. use TypeScript check
      typescript: true,
    }),
    mkcert(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  // Server configuration options go here if needed
  // Example: port, host, proxy
  // SPA fallback is handled automatically by Vite's serveStatic middleware for the dist directory,
  // or implicitly during development for the index.html entry point.
  server: {
    // Указываем хост 0.0.0.0, чтобы сервер был доступен снаружи контейнера
    host: '0.0.0.0',
    // Указываем порт 5173 (по умолчанию, можно опустить, но для ясности оставим)
    port: 5173,
    // Сертификаты mkcert будут автоматически использованы благодаря плагину
  },
})