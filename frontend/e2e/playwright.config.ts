import { defineConfig, devices } from '@playwright/test'

/**
 * Настройки смоук-сценариев (`frontend/e2e`).
 *
 * Отдельный файл, потому что эти проверки ходят по НАСТОЯЩЕМУ развёрнутому
 * приложению (по умолчанию — прод), а юнит-тесты живут в jsdom под
 * `vitest.config.ts`; папка `e2e/**` там исключена, так что в обычный прогон
 * тестов эти сценарии не попадают.
 *
 * Куда ходить и чем входить — только через окружение:
 *   E2E_BASE_URL   адрес приложения (по умолчанию https://pismo.space)
 *   E2E_PHONE      номер тестового аккаунта
 *   E2E_PASSWORD   пароль тестового аккаунта
 */

const baseURL = process.env.E2E_BASE_URL ?? 'https://pismo.space'

export default defineConfig({
  // Сценарии лежат рядом с этим файлом.
  testDir: '.',
  // Ходим по живому серверу: в один поток, чтобы не устраивать ему нагрузку.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // Сеть и медленный сервер — не повод считать выкат сломанным: одна повторная
  // попытка. Настоящая поломка упадёт и на второй.
  retries: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    // Самоподписанный сертификат локального стенда — не повод падать.
    ignoreHTTPSErrors: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
