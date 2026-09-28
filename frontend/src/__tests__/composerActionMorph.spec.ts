import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { readFileSync } from 'node:fs'

import MessageComposer from '@/components/messenger/MessageComposer.vue'

/**
 * Кнопка «микрофон ↔ отправка»: одна ячейка на двоих.
 *
 * Раньше это были два независимых блока (`v-if="!hasText"` и `v-if="newMessage"`)
 * — микрофон исчезал, отправка появлялась, между ними строка ввода перескакивала
 * на ширину кнопки. Теперь их меняет `Transition` в общей ячейке: уходящий кадр
 * вынимается из потока (`position: absolute`), приходящий «выпрыгивает».
 */
const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')

/** Монтирует композер так же, как тесты упоминаний (Pinia нужна пакам стикеров). */
function mountComposer(text: string) {
  const wrapper = mount(MessageComposer, {
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
      newMessage: text,
      'onUpdate:newMessage': (value: string) => wrapper.setProps({ newMessage: value })
    },
    global: {
      plugins: [createPinia()],
      stubs: { 'q-icon': true, VoiceRecorderBar: true, GifPicker: true }
    }
  })
  return wrapper
}

describe('композер: микрофон превращается в отправку', () => {
  it('пустое поле — микрофон, набранный текст — отправка', async () => {
    const wrapper = mountComposer('')
    expect(wrapper.find('.action-slot').exists()).toBe(true)
    expect(wrapper.find('.mic-wrap').exists()).toBe(true)
    expect(wrapper.find('.send-wrap').exists()).toBe(false)

    await wrapper.setProps({ newMessage: 'привет' })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.send-wrap').exists()).toBe(true)

    // Обратно: стёрли текст — снова микрофон (кнопка «перетекает» и туда).
    await wrapper.setProps({ newMessage: '' })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mic-wrap').exists()).toBe(true)
    expect(wrapper.find('.send-wrap').exists()).toBe(false)
    wrapper.unmount()
  })

  it('кнопки живут в одной ячейке и меняются переходом, а не подменой', () => {
    expect(composer).toContain('class="action-slot"')
    expect(composer).toContain('<Transition name="action-morph">')
    expect(composer).toContain('key="mic"')
    expect(composer).toContain('key="send"')
  })

  it('уходящая кнопка не держит место в строке, приходящая «выпрыгивает»', () => {
    expect(composer).toMatch(/\.action-morph-enter-active \{\s*animation: send-pop/)
    expect(composer).toMatch(
      /\.action-morph-leave-active \{[\s\S]{0,140}position: absolute;[\s\S]{0,140}animation: mic-morph-out/
    )
    expect(composer).toContain('@keyframes mic-morph-out {')
    // Анимация переехала в enter-класс перехода: своя же анимация на обёртке
    // играла бы вместе с ним и кнопка «дёргалась» бы дважды.
    expect(composer).not.toMatch(/\.send-wrap \{[\s\S]{0,200}animation: send-pop/)
  })
})
