import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import OfflineBanner from '@/components/common/OfflineBanner.vue'
import { RESTORED_VISIBLE_MS } from '@/composables/useOnlineStatus'

/** Прогоняет сценарий «сеть пропала/вернулась» на смонтированном баннере. */
async function mountBanner() {
  // Quasar в тестах не подключается, а баннер использует только иконку —
  // достаточно заглушки, чтобы не было предупреждений о неразрешённом компоненте.
  const wrapper = mount(OfflineBanner, {
    attachTo: document.body,
    global: { stubs: { 'q-icon': true } }
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

const bannerText = (wrapper: Awaited<ReturnType<typeof mountBanner>>) =>
  wrapper.find('.offline-banner').text()

describe('OfflineBanner', () => {
  it('показывает плашку при потере сети и убирает при возврате', async () => {
    const wrapper = await mountBanner()
    expect(wrapper.find('.offline-banner').exists()).toBe(false)

    window.dispatchEvent(new Event('offline'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.offline-banner').exists()).toBe(true)
    expect(bannerText(wrapper)).toContain('Нет подключения к интернету')

    window.dispatchEvent(new Event('online'))
    await wrapper.vm.$nextTick()
    expect(bannerText(wrapper)).toContain('Связь восстановлена')

    wrapper.unmount()
  })

  it('плашка «Связь восстановлена» исчезает через таймаут', async () => {
    const wrapper = await mountBanner()
    window.dispatchEvent(new Event('offline'))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new Event('online'))
    await wrapper.vm.$nextTick()

    await new Promise((resolve) => setTimeout(resolve, RESTORED_VISIBLE_MS + 50))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.offline-banner').exists()).toBe(false)

    wrapper.unmount()
  })

  it('подсказывает, что сообщения отправятся после возврата связи', async () => {
    const wrapper = await mountBanner()
    window.dispatchEvent(new Event('offline'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.offline-hint').text()).toContain('отправятся')

    wrapper.unmount()
  })
})
