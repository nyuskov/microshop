import { fileURLToPath, URL } from 'node:url'
import { readFileSync, existsSync } from 'fs' // Добавили existsSync для проверки файлов

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import checker from 'vite-plugin-checker'

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

/**
 * Линт в dev: печатаем замечания в терминал, но НИКОГДА не ломаем приложение.
 *
 * Почему не готовыми плагинами:
 * - `vite-plugin-eslint@1.8.1` с Vite 7 молча ничего не проверяет (хуки уехали),
 *   но при `emitError: true` замечание приходит ошибкой трансформации и Vite
 *   накрывает страницу оверлеем — одно замечание в стилях «выключало» всё;
 * - ESLint-часть `vite-plugin-checker@0.10.3` на ESLint 10 падает
 *   (`ESLint_INVALID_OPTIONS`: убраны extensions/resolvePluginsRelativeTo/…) и
 *   роняет вместе с собой весь dev-сервер.
 *
 * Здесь обычный API ESLint 10: ошибки линта выводятся предупреждениями, код
 * продолжает собираться — страница работает с любыми замечаниями.
 */
function devLint(): Plugin {
  return {
    name: 'pismo:dev-lint',
    apply: 'serve',
    configureServer(server) {
      let busy = false
      const run = async (targets: string[]) => {
        if (busy) return
        busy = true
        try {
          const { ESLint } = await import('eslint')
          const eslint = new ESLint({ cwd: server.config.root })
          const formatter = await eslint.loadFormatter('stylish')
          const report = formatter.format(await eslint.lintFiles(targets))
          if (report.trim() !== '') server.config.logger.warn(report)
        } catch (error) {
          // Линт — вспомогательный: его поломка не должна мешать разработке.
          server.config.logger.warn(`[eslint] проверка не выполнена: ${String(error)}`)
        } finally {
          busy = false
        }
      }

      const isLinted = (file: string): boolean => /[\\/]src[\\/].*\.(vue|ts|tsx|js|mjs)$/.test(file)

      const initial = setTimeout(() => void run(['src']), 1500)
      server.httpServer?.once('close', () => clearTimeout(initial))

      let debounce: ReturnType<typeof setTimeout> | undefined
      server.watcher.on('change', (file) => {
        if (!isLinted(file)) return
        clearTimeout(debounce)
        debounce = setTimeout(() => void run([file]), 400)
      })
    }
  }
}

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
    // Линт — отдельным неблокирующим плагином (см. devLint выше).
    devLint()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  css: {
    preprocessorOptions: {
      // Quasar собирается из своих sass-файлов, а в них старый `@import`.
      // Предупреждения об этом сыпятся сотнями на каждую пересборку и прячут
      // полезные сообщения — глушим именно их (остальные deprecations важны).
      sass: { silenceDeprecations: ['import'] }
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
          if (id.includes('/axios/')) return 'http-vendor'
          return undefined
        }
      }
    }
  }
})
