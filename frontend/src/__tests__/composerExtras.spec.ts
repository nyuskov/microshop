import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import MessageComposer from '@/components/messenger/MessageComposer.vue'

/**
 * Панель доп. контента (эмодзи / стикеры / GIF): как её закрывают.
 *
 * Проверено в живом приложении 20.09.2026: панель (345 px) оставалась открытой
 * после отправки, а закрыть её случайным тапом было нельзя — только той же
 * кнопкой «смайлы». Здесь — жесты и клавиши, которых не хватало.
 */
function mountComposer(extrasPanel: 'none' | 'emoji' = 'emoji') {
  const wrapper = mount(MessageComposer, {
    attachTo: document.body,
    props: {
      chatId: 7,
      sending: false,
      sendError: '',
      replyTarget: null,
      replyBarName: '',
      editingMessage: null,
      extrasPanel,
      voiceRecOpen: false,
      recordMode: 'audio' as const,
      micHolding: false,
      recordModeHint: '',
      newMessage: ''
    },
    global: {
      // Композер держит паки стикеров в сторе, поэтому Pinia обязательна.
      plugins: [createPinia()],
      stubs: { 'q-icon': true, 'q-menu': true, VoiceRecorderBar: true, GifPicker: true }
    }
  })
  return wrapper
}

/** Синтетическое касание: в jsdom нет ни Touch, ни TouchEvent. */
const touch = (type: string, clientY: number): Event => {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientY }]
  })
  return event
}

const swipe = async (wrapper: ReturnType<typeof mountComposer>, fromY: number, toY: number) => {
  const panel = wrapper.get('.extras-menu').element
  panel.dispatchEvent(touch('touchstart', fromY))
  panel.dispatchEvent(touch('touchmove', toY))
  await wrapper.vm.$nextTick()
  panel.dispatchEvent(touch('touchend', toY))
  await wrapper.vm.$nextTick()
}

describe('панель доп. контента', () => {
  it('закрывается кликом мимо неё', async () => {
    const wrapper = mountComposer()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close-extras')).toHaveLength(1)
    wrapper.unmount()
  })

  it('клик по самой панели и по кнопке «смайлы» её не закрывает', async () => {
    const wrapper = mountComposer()
    wrapper.get('.extras-menu').element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close-extras')).toBeUndefined()
    wrapper.get('.extras-toggle').element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close-extras')).toBeUndefined()
    wrapper.unmount()
  })

  it('Escape закрывает панель', async () => {
    const wrapper = mountComposer()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close-extras')).toHaveLength(1)
    wrapper.unmount()
  })

  it('закрытая панель не слушает документ', async () => {
    const wrapper = mountComposer('none')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close-extras')).toBeUndefined()
    wrapper.unmount()
  })

  it('свайп вниз по панели её закрывает (телефон)', async () => {
    const wrapper = mountComposer()
    await swipe(wrapper, 100, 190)
    expect(wrapper.emitted('close-extras')).toHaveLength(1)
    wrapper.unmount()
  })

  it('короткий свайп и жест вверх панель не закрывают', async () => {
    const wrapper = mountComposer()
    await swipe(wrapper, 100, 130)
    await swipe(wrapper, 200, 120)
    expect(wrapper.emitted('close-extras')).toBeUndefined()
    wrapper.unmount()
  })

  it('пока панель открыта, доносим её высоту до родителя', async () => {
    const wrapper = mountComposer()
    await wrapper.vm.$nextTick()
    const heights = wrapper.emitted('extras-height')
    expect(heights).toBeTruthy()
    expect(heights?.at(-1)).toEqual([expect.any(Number)])
    wrapper.unmount()
  })

  it('плашка ошибки просит повторить только когда есть что', async () => {
    const wrapper = mountComposer('none')
    await wrapper.setProps({ sendError: 'Не удалось отправить стикер' })
    expect(wrapper.find('.error-notice-retry').exists()).toBe(false)
    await wrapper.setProps({ canRetrySend: true })
    expect(wrapper.find('.error-notice-retry').exists()).toBe(true)
    await wrapper.get('.error-notice-retry').trigger('click')
    expect(wrapper.emitted('retry-error')).toHaveLength(1)
    wrapper.unmount()
  })
})
