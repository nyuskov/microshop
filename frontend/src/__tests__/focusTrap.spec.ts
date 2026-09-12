/**
 * Фокус-трап для самодельных модальных слоёв (`composables/useFocusTrap.ts`).
 *
 * Проверяем то, ради чего он написан: с клавиатуры нельзя выйти за пределы
 * модалки, а при закрытии фокус возвращается на место.
 */

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'

import { useFocusTrap } from '@/composables/useFocusTrap'

/** Мини-слой: три кнопки и ловушка фокуса. */
const Harness = defineComponent({
  props: { open: { type: Boolean, default: true } },
  setup(props) {
    const { container } = useFocusTrap(() => props.open)
    return { container }
  },
  template: `
    <div v-if="open" ref="container" tabindex="-1" class="trap">
      <button class="first">Первый</button>
      <button class="second">Второй</button>
      <button class="last">Последний</button>
    </div>
  `
})

/** Слой без фокусируемых элементов: фокус должен остаться на самом слое. */
const EmptyHarness = defineComponent({
  setup() {
    const { container } = useFocusTrap()
    return { container }
  },
  template: `<div ref="container" tabindex="-1" class="trap-empty">Только текст</div>`
})

const pressTab = async (shift = false) => {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
  )
  await nextTick()
}

const active = () => document.activeElement as HTMLElement | null

/**
 * Монтируем именно в документ: у откреплённого от `document` дерева браузер
 * не переводит фокус, и тест проверял бы не то.
 */
const mountInBody = (component: Parameters<typeof mount>[0]) =>
  mount(component, { attachTo: document.body })

afterEach(() => {
  // Компоненты размонтируем в тестах; здесь убираем добавленные вручную узлы.
  document.querySelectorAll('button.opener').forEach((node) => node.remove())
  document.body.innerHTML = ''
})

describe('useFocusTrap', () => {
  it('переносит фокус внутрь слоя при открытии', async () => {
    const wrapper = mountInBody(Harness)
    await nextTick()
    await nextTick()
    expect(active()?.className).toContain('first')
    wrapper.unmount()
  })

  it('на Tab с последнего элемента возвращает фокус на первый', async () => {
    const wrapper = mountInBody(Harness)
    await nextTick()
    await nextTick()

    wrapper.find('button.last').element.focus()
    await pressTab()
    expect(active()?.className).toContain('first')

    wrapper.unmount()
  })

  it('на Shift+Tab с первого элемента уводит фокус на последний', async () => {
    const wrapper = mountInBody(Harness)
    await nextTick()
    await nextTick()

    wrapper.find('button.first').element.focus()
    await pressTab(true)
    expect(active()?.className).toContain('last')

    wrapper.unmount()
  })

  it('возвращает фокус внутрь, если он оказался вне слоя', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    const wrapper = mountInBody(Harness)
    await nextTick()
    await nextTick()

    outside.focus()
    expect(active()).toBe(outside)
    await pressTab()
    expect(active()?.className).toContain('first')

    wrapper.unmount()
  })

  it('держит фокус на слое, если внутри нечего фокусировать', async () => {
    const wrapper = mountInBody(EmptyHarness)
    await nextTick()
    await nextTick()
    expect(active()?.className).toContain('trap-empty')

    await pressTab()
    expect(active()?.className).toContain('trap-empty')

    wrapper.unmount()
  })

  it('возвращает фокус туда, откуда пришли, когда слой закрывается', async () => {
    const opener = document.createElement('button')
    opener.className = 'opener'
    document.body.append(opener)
    opener.focus()

    const open = ref(true)
    const wrapper = mountInBody(
      defineComponent({
        setup() {
          const { container } = useFocusTrap(() => open.value)
          return { container, open }
        },
        template: `<div v-if="open" ref="container" tabindex="-1" class="trap"><button>Внутри</button></div>`
      })
    )
    await nextTick()
    await nextTick()
    // Фокус уже внутри слоя — закрываем и ждём возврата на кнопку-открывашку.
    open.value = false
    await nextTick()
    expect(active()).toBe(opener)

    wrapper.unmount()
  })

  it('перестаёт перехватывать Tab после закрытия', async () => {
    const open = ref(true)
    const wrapper = mountInBody(
      defineComponent({
        setup() {
          const { container } = useFocusTrap(() => open.value)
          return { container, open }
        },
        template: `<div v-if="open" ref="container" tabindex="-1" class="trap"><button class="only">Внутри</button></div>`
      })
    )
    await nextTick()
    await nextTick()
    open.value = false
    await nextTick()

    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    await pressTab()
    // Обычное поведение браузера: обработчик больше не мешает.
    expect(active()).toBe(outside)

    wrapper.unmount()
  })
})
