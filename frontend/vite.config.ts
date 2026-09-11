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
  // Информация о сборке для раздела «О приложении» (в CI есть GITHUB_SHA).
  define: {
    __BUILD_INFO__: JSON.stringify({
      commit: (process.env.GITHUB_SHA ?? '').slice(0, 7),
      date: new Date().toISOString().slice(0, 10)
    })
  },
  plugins: [
    vue(),
    vueJsx(),
    // Проверки типов в dev НЕ должны закрывать сайт: страница остаётся рабочей,
    // а ошибки/предупреждения показываются бейджем внизу справа (панель
    // раскрывается по клику) и пишутся в терминал vite.
    checker({
      typescript: true,
      // overlay: true (по умолчанию) — на весь экран и прячет приложение:
      // не даём ошибке типов блокировать работу в dev.
      overlay: { initialIsOpen: false, position: 'br' },
      terminal: true,
      // В сборке (CI/релиз) проверки по-прежнему ломают билд.
      enableBuild: true
    }),
    // eslint в dev только сообщает о проблемах: ошибки линта печатаются в
    // терминал (failOnError: false → console.log вместо ошибки модуля).
    // Так одна опечатка в стилях не оставляет вместо приложения белый экран.
    eslint({
      emitError: true,
      emitWarning: true,
      failOnError: false,
      failOnWarning: false,
      lintOnStart: false
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Не стираем лог терминала на каждой пересборке: предупреждения/ошибки
    // проверок остаются видимыми «внизу», их не нужно искать заново.
    clearScreen: false,
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
