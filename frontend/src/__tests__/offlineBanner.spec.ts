import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

/**
 * Плашка «нет подключения» и проверка связи.
 *
 * Главная беда старой версии: плашка жила только на событиях браузера, поэтому
 * могла висеть уже после восстановления сети (событие `online` приходит не
 * всегда), а данные не догружались. Здесь проверяем, что связь определяется
 * ответом сервера, что пока связи нет — спрашиваем чаще, и что после обрыва
 * приложение получает сигнал «добери пропущенное».
 */

const { pingServerMock } = vi.hoisted(() => ({
  pingServerMock: vi.fn<() => Promise<boolean>>()
}))

vi.mock('@/services/system', () => ({
  PING_TIMEOUT_MS: 4000,
  pingServer: (...args: unknown[]) => pingServerMock(...(args as []))
}))

import OfflineBanner from '@/components/common/OfflineBanner.vue'
import {
  OFFLINE_POLL_MS,
  ONLINE_RESTORED_EVENT,
  RESTORED_VISIBLE_MS,
  resetOnlineStatus,
  setConnectionSyncing
} from '@/composables/useOnlineStatus'

/** Монтирует плашку: Quasar в тестах не подключён, хватает заглушки иконки. */
async function mountBanner() {
  const wrapper = mount(OfflineBanner, {
    attachTo: document.body,
    global: { stubs: { 'q-icon': true } }
  })
  await flushPromises()
  return wrapper
}

const bannerText = (wrapper: ReturnType<typeof mountBanner> extends Promise<infer T> ? T : never) =>
  wrapper.find('.offline-banner').text()

describe('OfflineBanner', () => {
  beforeEach(() => {
    pingServerMock.mockReset()
    pingServerMock.mockResolvedValue(true)
    resetOnlineStatus()
  })

  afterEach(() => {
    resetOnlineStatus()
    vi.useRealTimers()
  })

  it('показывает плашку при потере сети и убирает, когда сервер ответил', async () => {
    const wrapper = await mountBanner()
    expect(wrapper.find('.offline-banner').exists()).toBe(false)

    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(wrapper.find('.offline-banner').exists()).toBe(true)
    expect(bannerText(wrapper)).toContain('Нет подключения к интернету')

    window.dispatchEvent(new Event('online'))
    await flushPromises()
    // Связь подтверждает сервер, а не браузер: восстановление = успешный маяк.
    expect(pingServerMock).toHaveBeenCalled()
    // Пока добираем пропущенные данные — «Соединение…», как в Telegram.
    expect(bannerText(wrapper)).toContain('Соединение')
    setConnectionSyncing(false)
    await flushPromises()
    expect(bannerText(wrapper)).toContain('Связь восстановлена')

    wrapper.unmount()
  })

  it('пока связи нет — проверяет её чаще', async () => {
    vi.useFakeTimers()
    pingServerMock.mockResolvedValue(false)
    const wrapper = await mountBanner()
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('.offline-banner').exists()).toBe(true)

    const before = pingServerMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(OFFLINE_POLL_MS)
    expect(pingServerMock.mock.calls.length).toBeGreaterThan(before)

    // Сервер ответил — плашка уходит сама, без действий человека.
    pingServerMock.mockResolvedValue(true)
    await vi.advanceTimersByTimeAsync(OFFLINE_POLL_MS)
    expect(bannerText(wrapper)).toContain('Соединение')
    setConnectionSyncing(false)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(RESTORED_VISIBLE_MS + 50)
    expect(wrapper.find('.offline-banner').exists()).toBe(false)

    wrapper.unmount()
  })

  it('сообщает приложению, что пора добрать пропущенное', async () => {
    const restored = vi.fn()
    window.addEventListener(ONLINE_RESTORED_EVENT, restored)
    const wrapper = await mountBanner()

    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(restored).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(restored).toHaveBeenCalledTimes(1)

    window.removeEventListener(ONLINE_RESTORED_EVENT, restored)
    wrapper.unmount()
  })

  it('плашка «Связь восстановлена» исчезает через таймаут', async () => {
    const wrapper = await mountBanner()
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    // Данные добраны — флаг догрузки снимает обработчик мессенджера.
    setConnectionSyncing(false)
    await flushPromises()

    await new Promise((resolve) => setTimeout(resolve, RESTORED_VISIBLE_MS + 50))
    await flushPromises()
    expect(wrapper.find('.offline-banner').exists()).toBe(false)

    wrapper.unmount()
  })

  it('подсказывает, что сообщения отправятся после возврата связи', async () => {
    const wrapper = await mountBanner()
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(wrapper.find('.offline-hint').text()).toContain('отправятся')

    wrapper.unmount()
  })
})
