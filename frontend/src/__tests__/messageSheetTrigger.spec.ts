import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageRow from '@/components/messenger/MessageRow.vue'
import type { Message } from '@/types'

/**
 * Чем открывается лист действий с сообщением (`MessageActionSheet`).
 *
 * Раньше он открывался и правым кликом, и сенсорным долгим нажатием — причём на
 * телефоне системное `contextmenu` от долгого нажатия срабатывало ВМЕСТЕ с нашим
 * выделением и лист перекрывал сообщение («иногда мешает»). Теперь правый клик и
 * сенсорное меню его не открывают: у мыши те же действия есть в панели «⋯» при
 * наведении, а на телефоне путь один — удержание уже выделенного сообщения.
 * С клавиатуры (`Shift+F10`, координаты 0,0) лист по-прежнему открывается: это
 * доступность, а не дублирование.
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

describe('лист действий с сообщением: чем открывается', () => {
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
