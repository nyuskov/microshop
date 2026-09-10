import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageThread from '@/components/messenger/MessageThread.vue'
import type { PendingRow } from '@/components/messenger/MessageThread.vue'

/** Монтирует ленту с временной строкой вложения. */
function mountThread(pending: PendingRow[]) {
  return mount(MessageThread, {
    attachTo: document.body,
    props: {
      rows: [],
      loading: false,
      currentUserId: 1,
      highlightedMessageId: null,
      emojiPickerFor: null,
      quoteOf: () => null,
      selectionMode: false,
      selectedMessageIds: [],
      pending
    },
    global: { stubs: { 'q-icon': true, MessageRow: true } }
  })
}

describe('MessageThread: прогресс загрузки вложения', () => {
  it('показывает процент и заполняет полосу прогресса', async () => {
    const wrapper = mountThread([
      { localId: -1, label: 'photo.png', progress: 42, status: 'sending' }
    ])
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.pending-label').text()).toBe('photo.png')
    expect(wrapper.find('.pending-status').text()).toContain('Отправка… 42%')
    expect(wrapper.find('.pending-bar').attributes('aria-valuenow')).toBe('42')
    expect(wrapper.find('.pending-bar-fill').attributes('style')).toContain('width: 42%')
    wrapper.unmount()
  })

  it('без процента пишет просто «Отправка…» и полосу не рисует', async () => {
    const wrapper = mountThread([{ localId: -2, label: 'video.mp4', status: 'sending' }])
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.pending-status').text()).toBe('Отправка…')
    expect(wrapper.find('.pending-bar').exists()).toBe(false)
    wrapper.unmount()
  })

  it('в очереди (текст не ушёл из-за сети) процент не показываем', async () => {
    const wrapper = mountThread([{ localId: -3, label: 'текст', status: 'queued', progress: 10 }])
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.pending-status').text()).toContain('Ждёт сети')
    expect(wrapper.find('.pending-bar').exists()).toBe(false)
    wrapper.unmount()
  })
})
