import { fileURLToPath, URL } from 'node:url'
import { readFileSync, existsSync } from 'fs' // Добавили existsSync для проверки файлов

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import checker from 'vite-plugin-checker'
// @ts-expect-error - модуль без типов
import eslint from 'vite-plugin-eslint'

// БЕЗОПАСНАЯ ПРОВЕРКА СЕРТИФИКАТОВ ДЛЯ CI/CD ТЕСТОВ
// Проверяем, существуют ли файлы. Если их нет (как в GitHub Actions), конфигурация не упадет.
const hasCerts =
  existsSync('/app/certs_from_backend/server.key') &&
  existsSync('/app/certs_from_backend/server.crt')

const httpsConfig = hasCerts
  ? {
      key: readFileSync('/app/certs_from_backend/server.key'),
      cert: readFileSync('/app/certs_from_backend/server.crt')
    }
  : undefined // Если файлов нет (в CI), отключаем HTTPS, чтобы тесты прошли

export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    checker({
      typescript: true
    }),
    eslint()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Подставляем нашу безопасную конфигурацию вместо жесткого readFileSync
    https: httpsConfig,
    proxy: {
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
      overlay: false
    }
  },
  build: {
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
