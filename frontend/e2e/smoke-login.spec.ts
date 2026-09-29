import { expect, test } from '@playwright/test'

/**
 * Смоук экрана входа: сайт вообще отвечает, форма на месте, ошибки видно.
 *
 * Вход здесь НЕ выполняется — сценарий описывает то, что видит человек без
 * аккаунта. Сервер трогаем минимально: проверка «неверный номер» срабатывает
 * ещё в браузере, до запроса.
 */

test('неавторизованного уводит на экран входа', async ({ page }) => {
  await page.goto('/')
  // Охрана роутера переводит всех, кто не вошёл, на адрес входа.
  await expect(page).toHaveURL(/\/auth\/login\/?/)
  await expect(page.locator('#phone-input input')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible()
})

test('неверный номер — понятная ошибка, а не белый экран', async ({ page }) => {
  await page.goto('/auth/login/')
  await page.locator('#phone-input input').fill('123')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.locator('[role="alert"]').first()).toContainText('номер телефона')
})

test('есть вход по коду на e-mail', async ({ page }) => {
  await page.goto('/auth/login/')
  // Канал e-mail включается настройкой сервера: если его нет, ссылки тоже нет.
  const byEmail = page.getByRole('button', { name: 'Войти по коду на e-mail' })
  test.skip((await byEmail.count()) === 0, 'вход по e-mail на этом стенде выключен')
  await byEmail.click()
  await expect(page.getByLabel('E-mail')).toBeVisible()
})
