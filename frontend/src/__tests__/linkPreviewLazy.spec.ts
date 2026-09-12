/**
 * Ленивое превью ссылок: карточка запрашивается не для всей загруженной
 * истории, а когда строка дошла до экрана.
 *
 * Проверяем связку `useVisibleOnce` + `useLinkPreview(enabled)`: до появления на
 * экране запросов нет, после — есть, а без IntersectionObserver (старый браузер)
 * поведение остаётся прежним.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'

const fetchLinkPreview = vi.fn()

vi.mock('@/services/linkPreview', () => ({
  fetchLinkPreview: (url: string) => fetchLinkPreview(url)
}))

import { useLinkPreview } from '@/composables/useLinkPreview'
import { useVisibleOnce } from '@/composables/useVisibleOnce'

const LINK = 'https://example.com/статья'

/** Подменный IntersectionObserver: запоминаем наблюдателей и умеем «показать» элемент. */
class FakeObserver {
  static instances: FakeObserver[] = []
  static options: IntersectionObserverInit[] = []
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    FakeObserver.instances.push(this)
    FakeObserver.options.push(options ?? {})
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  /** Сообщаем, что элемент попал (или перестал попадать) в область видимости. */
  intersect(isIntersecting = true): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
}

const Harness = defineComponent({
  props: { text: { type: String, default: `смотри ${LINK}` } },
  setup(props) {
    const root = ref<HTMLElement | null>(null)
    const { visible } = useVisibleOnce(root)
    const { preview } = useLinkPreview(() => props.text, { enabled: () => visible.value })
    return { root, visible, preview }
  },
  template: `<div ref="root" class="row">{{ preview ? 'карточка' : 'пусто' }}</div>`
})

beforeEach(() => {
  fetchLinkPreview.mockReset()
  fetchLinkPreview.mockResolvedValue({ ok: true, title: 'Заголовок' })
  FakeObserver.instances = []
  FakeObserver.options = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('ленивое превью ссылок', () => {
  it('до появления строки на экране запрос не уходит', async () => {
    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    await flushPromises()
    expect(fetchLinkPreview).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('после появления строки карточка загружается', async () => {
    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    FakeObserver.instances[0].intersect()
    await flushPromises()
    expect(fetchLinkPreview).toHaveBeenCalledWith(LINK)
    expect(wrapper.text()).toContain('карточка')
    wrapper.unmount()
  })

  it('пересечение проверяем с запасом, чтобы карточка успела загрузиться', async () => {
    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    expect(FakeObserver.options[0].rootMargin).toBeTruthy()
    wrapper.unmount()
  })

  it('офскрин-сообщение не грузит превью, а после прокрутки — грузит', async () => {
    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    // Прокрутили мимо: элемент в зоне видимости не был.
    FakeObserver.instances[0].intersect(false)
    await flushPromises()
    expect(fetchLinkPreview).not.toHaveBeenCalled()

    FakeObserver.instances[0].intersect(true)
    await flushPromises()
    expect(fetchLinkPreview).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('после показа правка текста обновляет карточку', async () => {
    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    FakeObserver.instances[0].intersect()
    await flushPromises()

    await wrapper.setProps({ text: 'теперь другая ссылка https://example.org/x' })
    await flushPromises()
    expect(fetchLinkPreview).toHaveBeenLastCalledWith('https://example.org/x')
    wrapper.unmount()
  })

  it('без IntersectionObserver ведём себя как раньше — грузим сразу', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    await flushPromises()
    expect(fetchLinkPreview).toHaveBeenCalledWith(LINK)
    wrapper.unmount()
  })

  it('сообщение без ссылки не грузит ничего', async () => {
    const wrapper = mount(Harness, { attachTo: document.body, props: { text: 'просто текст' } })
    await nextTick()
    FakeObserver.instances[0]?.intersect()
    await flushPromises()
    expect(fetchLinkPreview).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
