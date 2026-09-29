import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Общие шаги для смоук-сценариев: вход и открытие настроек.
 *
 * Секретов в файле нет: номер и пароль берутся из окружения (`E2E_PHONE`,
 * `E2E_PASSWORD`). Если их не передали, сценарии, которым нужен вход,
 * пропускаются — так прогон без переменных остаётся зелёным, а не «падает
 * непонятно почему».
 */

const PHONE = process.env.E2E_PHONE ?? ''
const PASSWORD = process.env.E2E_PASSWORD ?? ''

/** Есть ли чем входить. */
export function hasCredentials(): boolean {
  return PHONE.length > 0 && PASSWORD.length > 0
}

/** Пропустить сценарий, если в окружении нет данных тестового аккаунта. */
export function requireCredentials(): void {
  test.skip(!hasCredentials(), 'нет E2E_PHONE / E2E_PASSWORD — сценарию нужен вход')
}

/** Поле ввода Quasar по id: настоящий `<input>` лежит внутри обёртки. */
export function field(page: Page, id: string): Locator {
  return page.locator(`#${id} input`)
}

/** Строка списка чатов (первая — самая свежая). */
export function firstChatRow(page: Page): Locator {
  return page.locator('.chat-row button.row-item').first()
}

/**
 * Вход по номеру и паролю. Вход двухшаговый: сначала номер («Продолжить»),
 * потом пароль («Войти»). Признак успеха — появилось поле поиска в списке чатов
 * (оно есть всегда, даже в пустом аккаунте).
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/auth/login/')
  await field(page, 'phone-input').fill(PHONE)
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await field(page, 'password-input').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByPlaceholder(/Поиск/).first()).toBeVisible({ timeout: 30_000 })
}

/** Открыть «Настройки» из шапки списка чатов (кнопка с аватаром). */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Настройки профиля' }).first().click()
  await expect(page.getByRole('navigation', { name: 'Разделы настроек' })).toBeVisible()
}

/** Перейти в раздел настроек по названию (через поиск по настройкам). */
export async function openSettingsSection(page: Page, title: string): Promise<void> {
  await page.getByLabel('Поиск по настройкам').fill(title)
  await page
    .getByRole('button', { name: new RegExp(title) })
    .first()
    .click()
}
