import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'text'],
        include: ['src/**/*.{ts,vue}'],
        // Сгенерированные типы и сами тесты покрытие не считают.
        exclude: ['src/types/**', 'src/__tests__/**'],
        // Порог-храповик. Замер 03.10.2026: строки 68.58%, функции 66.49%,
        // ветви 81.53%. Значения чуть ниже факта, чтобы колебания не роняли CI;
        // поднимать по мере роста покрытия (docs/checks.md).
        thresholds: {
          lines: 66,
          statements: 66,
          functions: 64,
          branches: 79
        }
      }
    }
  })
)
