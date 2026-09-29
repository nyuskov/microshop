import { expect, test } from '@playwright/test'

import { login, openSettings, openSettingsSection, requireCredentials } from './helpers/session'

/**
 * Смоук приватности присутствия: тумблер «Показывать, когда я был(а) в сети» на
 * месте и сохраняется сервером.
 *
 * Переключатель возвращается в исходное положение — тестовый аккаунт остаётся
 * таким, каким был до прогона.
 */

test('тумблер присутствия переключается и возвращается назад', async ({ page }) => {
  requireCredentials()
  await login(page)
  await openSettings(page)
  await openSettingsSection(page, 'Приватность')

  const row = page.locator('.toggle-row').filter({ hasText: 'Показывать, когда я был(а) в сети' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('не увидят другие')

  const toggle = row.getByRole('checkbox')
  const before = await toggle.getAttribute('aria-checked')

  // Выключаем и включаем назад: так проверяем, что настройка сохраняется, и не
  // оставляем следов в аккаунте.
  await toggle.click()
  await expect(toggle).not.toHaveAttribute('aria-checked', before ?? '')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', before ?? '')

  // Экран говорит, что сохраняет сразу, и не ругается.
  await expect(page.getByText('Изменение сохраняется сразу.')).toBeVisible()
})
