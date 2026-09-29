import { expect, test } from '@playwright/test'

import { firstChatRow, login, requireCredentials } from './helpers/session'

/**
 * Смоук «Очистить историю»: пункт есть в меню «⋯», окно открывается и
 * закрывается. Историю НЕ чистим — нажимаем «Отмена», чтобы тестовый аккаунт
 * остался прежним.
 */

test('меню «⋯» содержит очистку истории, окно закрывается отменой', async ({ page }) => {
  requireCredentials()
  await login(page)

  const rows = page.locator('.chat-row')
  test.skip((await rows.count()) === 0, 'в тестовом аккаунте нет чатов')

  await firstChatRow(page).click()
  const header = page.locator('.chat-header')
  await expect(header.locator('.chat-title')).toBeVisible()

  // Кнопка «Ещё» есть и в шапке профиля, поэтому ищем внутри шапки чата.
  await header.getByRole('button', { name: 'Ещё' }).click()
  const clearItem = header.getByRole('button', { name: 'Очистить историю' })
  await expect(clearItem).toBeVisible()
  await clearItem.click()

  // Окно предупреждает, что переписка исчезнет только у меня.
  await expect(page.getByText('Очистить историю чата?')).toBeVisible()
  await expect(
    page.getByText('Вся переписка исчезнет только у вас. У собеседника она останется.')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByText('Очистить историю чата?')).toBeHidden()
  // Чат остался открытым — вышли отменой, а не удалением.
  await expect(header.locator('.chat-title')).toBeVisible()
})
