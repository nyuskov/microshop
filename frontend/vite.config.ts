import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
// import vueDevTools from 'vite-plugin-vue-devtools' // Comment out vueDevTools
import checker from 'vite-plugin-checker'
// vite-plugin-eslint не поставляет типы
// @ts-expect-error - модуль без типов
import eslint from 'vite-plugin-eslint'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    // vueDevTools(), // Disabled to potentially remove vite-plugin-vue-inspector
    checker({
      // e.g. use TypeScript check
      typescript: true
    }),
    eslint()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
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
    // Настраиваем HTTPS вручную, используя готовые сертификаты
    https: {
      // Предполагаем, что сертификаты будут смонтированы в /app/certs_from_backend в контейнере
      key: readFileSync('/app/certs_from_backend/server.key'),
      cert: readFileSync('/app/certs_from_backend/server.crt')
    },
    proxy: {
      // Проксируем API/WebSocket и медиа на бэкенд, чтобы фронт ходил на
      // тот же origin (без CORS и без жёсткой привязки к localhost —
      // работает и при открытии с LAN-адреса, например с телефона).
      '/api': {
        target: 'https://web:8000',
        changeOrigin: true,
        secure: false,
        ws: true
      },
      '/media': {
        target: 'https://web:8000',
        changeOrigin: true,
        secure: false
      }
    },
    hmr: {
      overlay: false // Disable the HMR error overlay
    }
  },
  // Разбивка бандла: стабильные vendor-чанки (quasar отдельно, vue-стек отдельно),
  // чтобы не грузить один 800+кБ файл и лучше кэшировать неизменяемые библиотеки.
  build: {
    // quasar — единый большой фреймворк-чанк, поэтому порог чуть выше типового.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('quasar')) return 'quasar'
          if (
            id.includes('/vue/') ||
            id.includes('@vue') ||
            id.includes('vue-router') ||
            id.includes('pinia')
          ) {
            return 'vue-vendor'
          }
          if (id.includes('/axios/') || id.includes('/zod/')) return 'http-vendor'
          return undefined
        }
      }
    }
  }
})
