import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  canInstall,
  installedNow,
  promptInstall,
  resetInstallPrompt,
  watchInstallPrompt
} from '@/services/installPrompt'

/**
 * Кнопка «Установить приложение» (владелец: «на Redmi A3 не появляется как
 * приложение установить»).
 *
 * Установку в Chrome можно вызвать только из события `beforeinstallprompt`:
 * оно приходит один раз и только когда Chrome считает сайт готовым к установке.
 * Проверяем три вещи: без события кнопки нет, с событием есть, и что событие
 * «сгорает» после показа окна — иначе кнопка жалась бы впустую.
 */

interface FakePromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Событие браузера: в jsdom такого нет, подделываем как в Chrome. */
const firePrompt = (outcome: 'accepted' | 'dismissed'): FakePromptEvent => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as FakePromptEvent
  event.prompt = vi.fn(() => Promise.resolve())
  event.userChoice = Promise.resolve({ outcome })
  window.dispatchEvent(event)
  return event
}

describe('кнопка установки приложения', () => {
  beforeAll(() => watchInstallPrompt())

  beforeEach(() => resetInstallPrompt())

  it('пока браузер молчит, кнопки нет', async () => {
    expect(canInstall.value).toBe(false)
    expect(await promptInstall()).toBe('unavailable')
  })

  it('браузер сообщил о готовности — кнопка есть', () => {
    firePrompt('accepted')
    expect(canInstall.value).toBe(true)
    expect(installedNow.value).toBe(false)
  })

  it('нажатие открывает системное окно и забирает событие', async () => {
    const event = firePrompt('accepted')
    expect(await promptInstall()).toBe('accepted')
    expect(event.prompt).toHaveBeenCalledTimes(1)
    // Событие одноразовое: второй раз окно не показать.
    expect(canInstall.value).toBe(false)
    expect(await promptInstall()).toBe('unavailable')
  })

  it('отказ тоже сжигает событие, но установкой не считается', async () => {
    firePrompt('dismissed')
    expect(await promptInstall()).toBe('dismissed')
    expect(canInstall.value).toBe(false)
    expect(installedNow.value).toBe(false)
  })

  it('после установки кнопка исчезает', () => {
    firePrompt('accepted')
    window.dispatchEvent(new Event('appinstalled'))
    expect(canInstall.value).toBe(false)
    expect(installedNow.value).toBe(true)
  })
})
