import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageRow from '@/components/messenger/MessageRow.vue'
import type { Message } from '@/types'

/**
 * Чем открывается лист действий с сообщением (`MessageActionSheet`).
 *
 * Путь на телефоне один и как в Телеграме — удержание сообщения (реакции сверху,
 * действия ниже). Режим выделения входит пунктом «Выбрать» из этого же меню.
 *
 * Отдельно проверяем, что `contextmenu` его НЕ открывает: правый клик мышью и
 * сенсорное системное меню раньше открывали лист вместе с выделением, и он
 * перекрывал сообщение («иногда мешает»). С клавиатуры (`Shift+F10`, координаты
 * 0,0) лист по-прежнему открывается: это доступность, а не дублирование.
 */

const message = {
  id: 1,
  chat_id: 7,
  user_id: 2,
  text: 'привет',
  timestamp: '2026-09-19T00:00:00Z',
  reply_to_id: null,
  is_read: true,
  is_pinned: false,
  edited_at: null,
  file: null,
  reactions: [],
  forwarded_from: null
} as unknown as Message

function mountRow() {
  return mount(MessageRow, {
    props: {
      message,
      isOwn: false,
      viewerId: 1,
      highlighted: false,
      emojiPickerOpen: false,
      quote: null,
      selectionMode: false,
      selected: false,
      selectable: true
    },
    global: { stubs: { 'q-icon': true } },
    attachTo: document.body
  })
}

/** Событие `contextmenu`: у мыши и сенсора есть координаты, у клавиатуры — нет. */
function contextMenuEvent(x: number, y: number): MouseEvent {
  return new MouseEvent('contextmenu', {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true
  })
}

/** Касание пальцем: событие мыши плюс поля указателя (в jsdom нет PointerEvent). */
function pointerDownEvent(x: number, y: number): Event {
  const event = new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  Object.defineProperty(event, 'isPrimary', { value: true })
  return event
}

describe('лист действий с сообщением: чем открывается', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('удержание открывает лист рядом с сообщением — как в Телеграме', async () => {
    vi.useFakeTimers()
    const wrapper = mountRow()

    wrapper.find('.msg').element.dispatchEvent(pointerDownEvent(120, 300))
    vi.advanceTimersByTime(500)
    await nextTick()
    await nextTick()

    expect(document.querySelector('.ctx-menu')).not.toBeNull()
    // Выделение удержанием больше не включается: оно живёт пунктом «Выбрать»
    // в этом же меню (раньше меню открывалось ВТОРЫМ удержанием).
    expect(wrapper.emitted('select-start')).toBeUndefined()
    wrapper.unmount()
  })

  it('«Выбрать» в листе включает режим выделения этого сообщения', async () => {
    vi.useFakeTimers()
    const wrapper = mountRow()

    wrapper.find('.msg').element.dispatchEvent(pointerDownEvent(120, 300))
    vi.advanceTimersByTime(500)
    await nextTick()
    await nextTick()

    const select = Array.from(document.querySelectorAll<HTMLElement>('.ctx-item')).find(
      (item) => item.textContent?.trim() === 'Выбрать'
    )
    expect(select).toBeTruthy()
    select?.click()
    await nextTick()

    expect(wrapper.emitted('select-start')).toHaveLength(1)
    wrapper.unmount()
  })

  it('правый клик мышью не открывает лист и гасит меню браузера', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.msg').element

    const event = contextMenuEvent(120, 80)
    row.dispatchEvent(event)
    await nextTick()
    await nextTick()

    expect(document.querySelector('.ctx-menu')).toBeNull()
    // Своё меню браузера здесь тоже не нужно: действия живут в интерфейсе.
    expect(event.defaultPrevented).toBe(true)

    wrapper.unmount()
  })

  it('сенсорное долгое нажатие (contextmenu с координатами) тоже не открывает', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.msg').element

    // На Android системное меню приходит так же, как правый клик — с координатами.
    row.dispatchEvent(contextMenuEvent(40, 300))
    await nextTick()
    await nextTick()

    expect(document.querySelector('.ctx-menu')).toBeNull()
    wrapper.unmount()
  })

  it('событие с признаком касания не открывает лист даже без координат', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.msg').element

    // Chrome помечает сенсорные события `sourceCapabilities.firesTouchEvents`;
    // координаты у них могут быть нулевыми — по одному этому признаку лист
    // открывался бы на телефоне «сам по себе».
    const event = contextMenuEvent(0, 0)
    Object.defineProperty(event, 'sourceCapabilities', {
      value: { firesTouchEvents: true }
    })
    row.dispatchEvent(event)
    await nextTick()
    await nextTick()

    expect(document.querySelector('.ctx-menu')).toBeNull()
    wrapper.unmount()
  })

  it('с клавиатуры (Shift+F10, координаты 0,0) лист открывается', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.msg').element

    row.dispatchEvent(contextMenuEvent(0, 0))
    await nextTick()
    await nextTick()

    expect(document.querySelector('.ctx-menu')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    wrapper.unmount()
  })
})
