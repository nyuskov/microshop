import { readFileSync } from 'node:fs'

import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageRow from '@/components/messenger/MessageRow.vue'
import type { Message } from '@/types'

/**
 * Реакция выбрана — панель действий закрывается; уход человека из строки,
 * прокрутка ленты и тап по пустому месту тоже её гасят.
 *
 * На телефоне браузер оставляет `:hover` на сообщении после тапа, поэтому панель
 * продолжала висеть и перекрывала соседние сообщения. Владелец: «надо, когда
 * быструю реакцию нажал, чтобы меню закрывалось», «фокус чтобы когда уходил —
 * тоже закрывалось». Закрываем принудительно (класс `dismissed`), а возвращает
 * панель следующее нажатие по сообщению.
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

/**
 * Строка, готовая к проверкам.
 *
 * Панель действий рисуется по флагу «строка доходила до экрана» (`useVisibleOnce`),
 * который поднимается в `onMounted` — то есть появляется лишь со следующим
 * обновлением. Без `IntersectionObserver` (окружение тестов) флаг поднимается
 * сразу, но обновление всё равно нужно.
 */
const mountRowReady = async (props: Record<string, unknown> = {}) => {
  const wrapper = mountRow(props)
  await nextTick()
  return wrapper
}

/** Касание пальцем: событие мыши плюс поля указателя (в jsdom нет PointerEvent). */
function pointerDownEvent(x: number, y: number): Event {
  const event = new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  Object.defineProperty(event, 'isPrimary', { value: true })
  return event
}

const barClasses = (wrapper: Awaited<ReturnType<typeof mountRowReady>>): string[] =>
  wrapper.find('.msg-actions').classes()

describe('панель действий закрывается после реакции', () => {
  // Панель рисуется только у строк, которые доходили до экрана (`useVisibleOnce`),
  // а без `IntersectionObserver` (окружение тестов, старый браузер) строка
  // считается видимой сразу — см. `useVisibleOnce`.
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', undefined)
    // Играем за телефон: гашение панели касается только грубого указателя
    // (на компьютере панель живёт по наведению — см. `isCoarsePointer`).
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('на компьютере панель по реакции не гаснет — она живёт по наведению', async () => {
    // Мышь: после гашения наведение перестало бы показывать панель, и открыть
    // её можно было бы только нажатием — «теперь кликать надо на сообщение?».
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const wrapper = await mountRowReady()

    await wrapper.find('.msg-actions .quick-emoji').trigger('click')

    expect(wrapper.emitted('toggle-reaction')).toHaveLength(1)
    expect(barClasses(wrapper)).not.toContain('dismissed')
    wrapper.unmount()
  })

  it('быстрая реакция ставится, а панель гаснет', async () => {
    const wrapper = await mountRowReady()
    const bar = wrapper.find('.msg-actions')
    expect(bar.exists()).toBe(true)

    await bar.find('.quick-emoji').trigger('click')

    expect(wrapper.emitted('toggle-reaction')).toHaveLength(1)
    expect(barClasses(wrapper)).toContain('dismissed')
    wrapper.unmount()
  })

  it('выбор из палитры гасит панель', async () => {
    const wrapper = await mountRowReady({ emojiPickerOpen: true })
    expect(wrapper.find('.emoji-picker').exists()).toBe(true)

    await wrapper.find('.emoji-picker .emoji-option').trigger('click')

    expect(wrapper.emitted('toggle-reaction')).toHaveLength(1)
    // Палитру закрывает родитель по успешной реакции (`emojiPickerFor` → null).
    expect(barClasses(wrapper)).toContain('dismissed')
    wrapper.unmount()
  })

  it('новое нажатие по сообщению возвращает панель', async () => {
    const wrapper = await mountRowReady()
    await wrapper.find('.msg-actions .quick-emoji').trigger('click')
    expect(barClasses(wrapper)).toContain('dismissed')

    wrapper.find('.msg').element.dispatchEvent(pointerDownEvent(120, 300))
    await nextTick()

    expect(barClasses(wrapper)).not.toContain('dismissed')
    wrapper.unmount()
  })

  it('прокрутка ленты и тап по пустому месту гасят панель', async () => {
    // Родитель меняет счётчик — каждая строка сама гасит свою панель.
    const wrapper = mountRow({ actionsReset: 0 })
    await nextTick()
    await wrapper.find('.msg-actions .quick-emoji').trigger('click')
    expect(barClasses(wrapper)).toContain('dismissed')

    // Счётчик изменился → панель погашена (она и так погашена) — проверяем
    // именно путь через проп: выводим панель обратно и сбрасываем счётчиком.
    wrapper.find('.msg').element.dispatchEvent(pointerDownEvent(120, 300))
    await nextTick()
    expect(barClasses(wrapper)).not.toContain('dismissed')

    await wrapper.setProps({ actionsReset: 1 })
    await nextTick()
    expect(barClasses(wrapper)).toContain('dismissed')
    wrapper.unmount()
  })

  it('фокус ушёл из строки — панель гаснет, а внутри строки — нет', async () => {
    const wrapper = await mountRowReady()
    const button = wrapper.find('.msg-actions .round-btn').element

    // Уход фокуса ВНУТРЬ строки (с сообщения на кнопку панели) панель не гасит.
    button.dispatchEvent(
      new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: wrapper.find('.msg-bubble').element
      })
    )
    await nextTick()
    expect(barClasses(wrapper)).not.toContain('dismissed')

    // Уход из строки на ДРУГОЙ элемент, доступный с клавиатуры (клик по полю
    // ввода, Tab) — гасит.
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))
    await nextTick()
    expect(barClasses(wrapper)).toContain('dismissed')

    outside.remove()
    wrapper.unmount()
  })

  it('служебная смена фокуса (на контейнер ленты) панель не гасит', async () => {
    // Замер в приложении (390×844): тап по сообщению со скрытой панелью —
    // `pointerdown` (панель открывается) → `pointerup` → `mousedown` →
    // `focusout` на `.messenger-shell` (`tabindex="-1"`) → `click`. Панель
    // гасла сразу после открытия: «на мобилке невозможно работать с меню».
    const wrapper = await mountRowReady()
    const row = wrapper.find('.msg').element

    await wrapper.find('.msg-actions .quick-emoji').trigger('click')
    expect(barClasses(wrapper)).toContain('dismissed')

    row.dispatchEvent(pointerDownEvent(120, 300))
    await nextTick()
    expect(barClasses(wrapper)).not.toContain('dismissed')

    const layout = document.createElement('div')
    layout.tabIndex = -1
    document.body.appendChild(layout)
    row.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: layout }))
    await nextTick()
    expect(barClasses(wrapper)).not.toContain('dismissed')

    // А вот уход на КЛАВИАТУРНЫЙ элемент (поле ввода) — настоящий уход.
    const input = document.createElement('input')
    document.body.appendChild(input)
    row.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: input }))
    await nextTick()
    expect(barClasses(wrapper)).toContain('dismissed')

    layout.remove()
    input.remove()
    wrapper.unmount()
  })

  it('клик по сообщению не считается «кликом мимо» (лента различает их)', () => {
    // Один и тот же тап открывал панель (`pointerdown` строки) и гасил её же
    // (`click` до `.messages-scroll`). Поэтому лента различает два случая.
    const thread = readFileSync('src/components/messenger/MessageThread.vue', 'utf8')
    expect(thread).toContain('@click="onThreadClick"')
    const handler = thread.slice(thread.indexOf('const onThreadClick'))
    const body = handler.slice(0, handler.indexOf('\n}'))
    expect(body).toContain("closest('.msg')")
    expect(body).toContain("emit('message-click')")
    expect(body).toContain("emit('background-click')")

    const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
    expect(messenger).toContain('@message-click="onMessageClick"')
    const onMessageClick = messenger.slice(messenger.indexOf('const onMessageClick'))
    const fn = onMessageClick.slice(0, onMessageClick.indexOf('\n}'))
    expect(fn).toContain('emojiPickerFor.value = null')
    // Панель действий здесь НЕ гасим — её открывает тот же тап.
    expect(fn).not.toContain('hideMessageActions')
  })

  it('погашенная панель не перехватывает нажатия (правило в стилях)', () => {
    // «Залипший» `:hover` на телефоне перебивает обычное правило показа панели,
    // поэтому гашение обязано быть отдельным правилом с большей специфичностью.
    const source = readFileSync('src/components/messenger/MessageActionsBar.vue', 'utf8')
    const fromRule = source.slice(source.indexOf('.msg .msg-actions.dismissed'))
    const block = fromRule.slice(fromRule.indexOf('{'), fromRule.indexOf('}'))

    expect(block).toContain('opacity: 0')
    expect(block).toContain('pointer-events: none')
  })
})
