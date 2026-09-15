import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import FileDropOverlay from '@/components/messenger/FileDropOverlay.vue'

function mountOverlay(props: { active: boolean; canSend: boolean }) {
  return mount(FileDropOverlay, {
    props,
    global: { stubs: { 'q-icon': true } }
  })
}

describe('FileDropOverlay: подсказка при перетаскивании файлов', () => {
  it('пока файл не тянут — слоя нет', () => {
    const wrapper = mountOverlay({ active: false, canSend: true })
    expect(wrapper.find('.drop-overlay').exists()).toBe(false)
    wrapper.unmount()
  })

  it('с открытым чатом предлагает отпустить файл', () => {
    const wrapper = mountOverlay({ active: true, canSend: true })
    expect(wrapper.find('.drop-overlay').text()).toContain('Отпустите файл, чтобы отправить')
    // Про несколько файлов говорим заранее: иначе про это узнают случайно.
    expect(wrapper.find('.drop-note').exists()).toBe(true)
    wrapper.unmount()
  })

  it('без открытого чата объясняет, что сначала нужен чат', () => {
    const wrapper = mountOverlay({ active: true, canSend: false })
    expect(wrapper.find('.drop-overlay').text()).toContain('Откройте чат, чтобы отправить файл')
    expect(wrapper.find('.drop-overlay').classes()).toContain('cannot-send')
    wrapper.unmount()
  })

  it('слой прозрачен для мыши: бросок должен попадать в ленту под ним', () => {
    // Если тут появится перехват мыши, `drop` не дойдёт до цели, и файл
    // откроется в браузере вместо отправки — проверяем исходник, потому что
    // jsdom hit-testing не считает.
    const source = readFileSync('src/components/messenger/FileDropOverlay.vue', 'utf8')
    expect(source).toMatch(/\.drop-overlay\s*\{[^}]*pointer-events:\s*none/)
  })
})
