import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import MessageComposer from '@/components/messenger/MessageComposer.vue'

/** Монтирует композер в обычном (не редактирующем) состоянии. */
function mountComposer() {
  return mount(MessageComposer, {
    attachTo: document.body,
    props: {
      chatId: 7,
      sending: false,
      sendError: '',
      replyTarget: null,
      replyBarName: '',
      editingMessage: null,
      extrasPanel: 'none' as const,
      voiceRecOpen: false,
      recordMode: 'audio' as const,
      micHolding: false,
      recordModeHint: '',
      mentionMembers: [],
      newMessage: ''
    },
    global: {
      // Композер держит паки стикеров в сторе, поэтому Pinia обязательна.
      plugins: [createPinia()],
      stubs: { 'q-icon': true, VoiceRecorderBar: true, GifPicker: true }
    }
  })
}

const IMAGE = new File(['x'], 'photo.png', { type: 'image/png' })

// Перетаскивание файлов в композере больше не живёт: файл можно бросить в любое
// место окна, обработчик общий (`composables/useFileDrop.ts`). Здесь остаётся
// только вставка из буфера — она привязана к полю ввода.
describe('MessageComposer: вставка картинки из буфера', () => {
  it('вставленный из буфера файл уходит как вложение', async () => {
    const wrapper = mountComposer()
    await wrapper.find('.text-input').trigger('paste', {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => IMAGE }]
      }
    })

    const emitted = wrapper.emitted('file-selected')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0][0]).toBe(IMAGE)
    wrapper.unmount()
  })

  it('обычный текст из буфера вставляется как текст, без отправки файла', async () => {
    const wrapper = mountComposer()
    await wrapper.find('.text-input').trigger('paste', {
      clipboardData: {
        items: [{ kind: 'string', getAsFile: () => null }]
      }
    })

    expect(wrapper.emitted('file-selected')).toBeUndefined()
    wrapper.unmount()
  })

  it('буфер без данных не ломает ввод', async () => {
    const wrapper = mountComposer()
    await wrapper.find('.text-input').trigger('paste', {})
    expect(wrapper.emitted('file-selected')).toBeUndefined()
    wrapper.unmount()
  })
})
