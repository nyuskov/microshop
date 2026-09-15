import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import { useFileDrop } from '@/composables/useFileDrop'

const PHOTO = new File(['x'], 'photo.png', { type: 'image/png' })
const DOC = new File(['y'], 'doc.pdf', { type: 'application/pdf' })

/**
 * Событие перетаскивания. В jsdom нет `DataTransfer`, поэтому подставляем
 * минимальный слепок того, что читает composable. Ждём перерисовку: состояние
 * проверяем по разметке, а Vue обновляет её асинхронно.
 */
async function drag(type: string, data: { types?: string[]; files?: File[] } = {}): Promise<Event> {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: data.types ?? [], files: data.files ?? [] }
  })
  window.dispatchEvent(event)
  await nextTick()
  return event
}

/** Хост-компонент: composable живёт в setup, наружу отдаём только признак. */
function mountHost() {
  const onFiles = vi.fn()
  const Host = defineComponent({
    setup() {
      const { active } = useFileDrop({ onFiles })
      return { active }
    },
    template: '<div class="host">{{ active ? "active" : "idle" }}</div>'
  })
  const wrapper = mount(Host, { attachTo: document.body })
  const isActive = () => wrapper.find('.host').text() === 'active'
  return { wrapper, onFiles, isActive }
}

describe('useFileDrop: перетаскивание файлов в окно', () => {
  it('подсвечивает при перетаскивании файла и снимает подсветку, когда курсор ушёл', async () => {
    const { wrapper, isActive } = mountHost()
    expect(isActive()).toBe(false)

    await drag('dragenter', { types: ['Files'], files: [PHOTO] })
    expect(isActive()).toBe(true)

    await drag('dragleave', {})
    expect(isActive()).toBe(false)
    wrapper.unmount()
  })

  it('гасит поведение браузера: иначе бросок файла откроет файл вместо чата', async () => {
    const { wrapper } = mountHost()

    const over = await drag('dragover', { types: ['Files'], files: [PHOTO] })
    const drop = await drag('drop', { types: ['Files'], files: [PHOTO] })

    expect(over.defaultPrevented).toBe(true)
    expect(drop.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('перетаскивание текста не подсвечивает окно и не перехватывается', async () => {
    const { wrapper, isActive, onFiles } = mountHost()

    // Бросок выделенного текста в поле ввода обязан работать как обычно,
    // поэтому событие не гасим и файлов не ждём.
    const over = await drag('dragover', { types: ['text/plain'] })
    await drag('dragenter', { types: ['text/plain'] })
    await drag('drop', { types: ['text/plain'] })

    expect(over.defaultPrevented).toBe(false)
    expect(isActive()).toBe(false)
    expect(onFiles).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('подсветка не мигает при переходе курсора между дочерними элементами', async () => {
    const { wrapper, isActive } = mountHost()

    // Курсор вошёл в окно, затем перешёл на дочерний элемент: браузер шлёт
    // dragenter ребёнка и dragleave родителя — подсветка должна остаться.
    await drag('dragenter', { types: ['Files'], files: [PHOTO] })
    await drag('dragenter', { types: ['Files'], files: [PHOTO] })
    await drag('dragleave', {})

    expect(isActive()).toBe(true)
    wrapper.unmount()
  })

  it('повторные dragover не мешают снять подсветку одним dragleave', async () => {
    const { wrapper, isActive } = mountHost()

    await drag('dragenter', { types: ['Files'], files: [PHOTO] })
    for (let i = 0; i < 5; i += 1) await drag('dragover', { types: ['Files'], files: [PHOTO] })
    await drag('dragleave', {})

    expect(isActive()).toBe(false)
    wrapper.unmount()
  })

  it('бросок отдаёт все файлы сразу и снимает подсветку', async () => {
    const { wrapper, isActive, onFiles } = mountHost()

    await drag('dragenter', { types: ['Files'], files: [PHOTO, DOC] })
    await drag('drop', { types: ['Files'], files: [PHOTO, DOC] })

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0]).toEqual([PHOTO, DOC])
    expect(isActive()).toBe(false)

    // После броска счётчик обнулён: «лишний» dragleave не уводит его в минус.
    await drag('dragleave', {})
    expect(isActive()).toBe(false)
    wrapper.unmount()
  })

  it('бросок без файлов ничего не отправляет', async () => {
    const { wrapper, onFiles } = mountHost()

    await drag('drop', { types: [], files: [] })

    expect(onFiles).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('снимает слушатели вместе с компонентом', async () => {
    const { wrapper, onFiles, isActive } = mountHost()
    wrapper.unmount()

    await drag('dragenter', { types: ['Files'], files: [PHOTO] })
    await drag('drop', { types: ['Files'], files: [PHOTO] })

    expect(isActive()).toBe(false)
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('в приложении подключён именно этот обработчик (страховка)', () => {
    // Разметку Messenger.vue в тестах не монтируют (слишком тяжёлая), поэтому
    // проверяем, что подсказка и composable на месте: без них перетаскивание
    // снова начнёт открывать файл вместо чата.
    const source = readFileSync('src/views/Messenger.vue', 'utf8')
    expect(source).toContain('useFileDrop({ onFiles: handleDroppedFiles })')
    expect(source).toContain('<FileDropOverlay :active="fileDropActive"')
  })
})
