import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageRow from '@/components/messenger/MessageRow.vue'
import type { Message } from '@/types'

/**
 * Удержание сообщения включает режим выделения — как было и как в чатах.
 *
 * Листа действий по удержанию больше нет: действия с сообщением живут в
 * мини-панели под ним (`MessageActionsBar.vue`) — тап по сообщению показывает
 * её (на телефоне браузер сам применяет `:hover` к элементу после тапа), а
 * удержание занимается выделением. Владелец: «это меню по долгому тапу не
 * нужно», «было до твоих правок правильно».
 *
 * Дополнительно проверяем, что `contextmenu` ничего не открывает: своё меню
 * браузера гасим (`prevent`), но и своих окон по нему больше нет.
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

function mountRow(props: Record<string, unknown> = {}) {
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
      selectable: true,
      ...props
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

describe('удержание сообщения включает выделение', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('удержание выделяет сообщение, а не открывает меню', async () => {
    vi.useFakeTimers()
    const wrapper = mountRow()

    wrapper.find('.msg').element.dispatchEvent(pointerDownEvent(120, 300))
    vi.advanceTimersByTime(500)
    await nextTick()
    await nextTick()

    expect(wrapper.emitted('select-start')).toHaveLength(1)
    // Никаких окон по удержанию больше нет.
    expect(document.querySelector('.ctx-menu')).toBeNull()
    wrapper.unmount()
  })

  it('в режиме выделения удержание добавляет сообщение к выбору', async () => {
    vi.useFakeTimers()
    const wrapper = mountRow({ selectionMode: true, selected: false })

    wrapper.find('.msg').element.dispatchEvent(pointerDownEvent(120, 300))
    vi.advanceTimersByTime(500)
    await nextTick()

    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
    expect(wrapper.emitted('select-start')).toBeUndefined()
    wrapper.unmount()
  })

  it('тап по выделенному сообщению снимает выделение — с любого места строки', async () => {
    const wrapper = mountRow({ selectionMode: true, selected: true })

    // Область отметки лежит поверх содержимого строки: тап по тексту, по
    // вложению или по пустому месту пузыря попадает именно в неё.
    const hit = wrapper.find('.msg-select-hit')
    expect(hit.exists()).toBe(true)
    await hit.trigger('click')

    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
    wrapper.unmount()
  })

  it('тап сразу после удержания не переключает выбор дважды', async () => {
    vi.useFakeTimers()
    const wrapper = mountRow()

    const row = wrapper.find('.msg').element
    row.dispatchEvent(pointerDownEvent(120, 300))
    vi.advanceTimersByTime(500)
    await nextTick()
    // Родитель по `select-start` включает режим выделения и отмечает сообщение.
    await wrapper.setProps({ selectionMode: true, selected: true })
    // Браузер после удержания присылает ещё и click — он не должен снимать
    // выделение, которое только что поставили.
    await wrapper.find('.msg-select-hit').trigger('click')

    expect(wrapper.emitted('toggle-select')).toBeUndefined()
    wrapper.unmount()
  })

  it('область отметки выходит за пределы строки', () => {
    // Строка сообщения ограничена 60% ширины ленты, а кружок-чек вынесен ещё
    // дальше вбок. Если область отметки равна строке, тап по пустому месту
    // строки и по кружку уходит в ленту — выделение не переключается
    // (владелец: «нет, не развыделяет, если на строку тыкать и на галку»).
    const source = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
    const rule = source.slice(source.indexOf('.msg-select-hit {'))
    const block = rule.slice(rule.indexOf('{'), rule.indexOf('}'))

    expect(block).toContain('inset: 0 -50vw')
  })

  it('правый клик мышью ничего не открывает и гасит меню браузера', async () => {
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

  it('сенсорное долгое нажатие (contextmenu с координатами) тоже ничего не открывает', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.msg').element

    // На Android системное меню приходит так же, как правый клик — с координатами.
    row.dispatchEvent(contextMenuEvent(40, 300))
    await nextTick()
    await nextTick()

    expect(document.querySelector('.ctx-menu')).toBeNull()
    wrapper.unmount()
  })

  it('с клавиатуры (Shift+F10, координаты 0,0) окон тоже нет', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.msg').element

    row.dispatchEvent(contextMenuEvent(0, 0))
    await nextTick()
    await nextTick()

    expect(document.querySelector('.ctx-menu')).toBeNull()
    wrapper.unmount()
  })
})
