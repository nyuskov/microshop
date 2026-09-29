import { expect, test } from '@playwright/test'

import { firstChatRow, login, requireCredentials } from './helpers/session'

/**
 * Смоук списка чатов: после входа видно список, переписка открывается, шапка
 * показывает собеседника. Сообщения НЕ отправляются — проверка только читает.
 */

test('список чатов и переписка открываются', async ({ page }) => {
  requireCredentials()
  await login(page)

  const rows = page.locator('.chat-row')
  test.skip((await rows.count()) === 0, 'в тестовом аккаунте нет чатов')
  await expect(rows.first()).toBeVisible()

  await firstChatRow(page).click()
  await expect(page.locator('.chat-header .chat-title')).toBeVisible()
  // Поле ввода сообщения на месте — переписка действительно открыта.
  await expect(page.locator('.input-area textarea').first()).toBeVisible()
})

test('поиск по чатам отвечает на запрос', async ({ page }) => {
  requireCredentials()
  await login(page)

  const search = page.getByPlaceholder(/Поиск/).first()
  await search.fill('zzz-смоук-ничего-не-найдёт')
  // Список при этом остаётся на месте: панель не пропала и не упала.
  await expect(search).toHaveValue('zzz-смоук-ничего-не-найдёт')
  await expect(page.locator('.side-panel')).toBeVisible()
})
