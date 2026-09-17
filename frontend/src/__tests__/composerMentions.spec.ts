import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import MessageComposer from '@/components/messenger/MessageComposer.vue'
import MessageRow from '@/components/messenger/MessageRow.vue'
import type { ChatUser, Message } from '@/types'

const IVAN: ChatUser = {
  id: 1,
  username: 'ivan',
  first_name: 'Иван',
  last_name: 'Петров',
  phone_number: null,
  avatar_url: null
}
const ANNA: ChatUser = {
  id: 2,
  username: 'anna',
  first_name: 'Анна',
  last_name: null,
  phone_number: null,
  avatar_url: null
}

/** Монтирует композер с участниками группы и стартовым текстом. */
function mountComposer(text: string, members: ChatUser[] = [IVAN, ANNA]) {
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
      mentionMembers: members,
      newMessage: text,
      'onUpdate:newMessage': (value: string) => wrapper.setProps({ newMessage: value })
    },
    global: {
      // Композер держит паки стикеров в сторе, поэтому Pinia обязательна.
      plugins: [createPinia()],
      stubs: { 'q-icon': true, VoiceRecorderBar: true, GifPicker: true }
    }
  })
  return wrapper
}

/** Печатает текст в поле и ставит курсор в конец — как это делает пользователь. */
async function typeText(
  wrapper: ReturnType<typeof mountComposer>,
  text: string
): Promise<HTMLTextAreaElement> {
  const input = wrapper.find('.text-input').element as HTMLTextAreaElement
  await wrapper.setProps({ newMessage: text })
  input.focus()
  input.setSelectionRange(text.length, text.length)
  await wrapper.find('.text-input').trigger('input')
  await wrapper.vm.$nextTick()
  return input
}

describe('MessageComposer: упоминания', () => {
  it('показывает подсказку участников после @ и вставляет логин', async () => {
    const wrapper = mountComposer('')
    await typeText(wrapper, 'привет @iv')

    const panel = wrapper.find('.mention-panel')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('@ivan')
    expect(panel.text()).not.toContain('@anna')

    await panel.find('.mention-item').trigger('mousedown')
    await wrapper.vm.$nextTick()

    expect(wrapper.props('newMessage')).toBe('привет @ivan ')
    expect(wrapper.find('.mention-panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('без участников (личный чат) подсказка не появляется', async () => {
    const wrapper = mountComposer('', [])
    await typeText(wrapper, '@iv')
    expect(wrapper.find('.mention-panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Enter выбирает участника, а не отправляет сообщение', async () => {
    const wrapper = mountComposer('')
    await typeText(wrapper, '@ann')
    expect(wrapper.find('.mention-panel').text()).toContain('@anna')

    await wrapper.find('.text-input').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(wrapper.props('newMessage')).toBe('@anna ')
    expect(wrapper.emitted('send-text')).toBeUndefined()
    wrapper.unmount()
  })

  it('Escape закрывает подсказку и не мешает отправке', async () => {
    const wrapper = mountComposer('')
    await typeText(wrapper, '@iv')
    await wrapper.find('.text-input').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mention-panel').exists()).toBe(false)

    await wrapper.find('.text-input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send-text')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('MessageRow: разметка и подсветка текста', () => {
  function mountRow(text: string) {
    return mount(MessageRow, {
      props: {
        message: {
          id: 1,
          chat_id: 7,
          user_id: 2,
          text,
          timestamp: '2026-09-11T00:00:00Z',
          reply_to_id: null,
          is_read: true,
          is_pinned: false,
          edited_at: null,
          file: null,
          reactions: [],
          forwarded_from: null
        } as unknown as Message,
        isOwn: false,
        viewerId: 1,
        highlighted: false,
        emojiPickerOpen: false,
        quote: null,
        selectionMode: false,
        selected: false,
        selectable: true
      },
      global: { stubs: { 'q-icon': true } }
    })
  }

  it('оборачивает @логин в отдельный элемент, остальной текст не меняется', async () => {
    const wrapper = mountRow('привет @ivan, посмотри')
    await wrapper.vm.$nextTick()

    const mention = wrapper.find('.msg-mention')
    expect(mention.exists()).toBe(true)
    expect(mention.text()).toBe('@ivan')
    expect(wrapper.find('.msg-text').text()).toBe('привет @ivan, посмотри')
    wrapper.unmount()
  })

  it('оформление отрисовывается своими тегами, обрамление не показывается', async () => {
    const wrapper = mountRow('это *жирный* и `код`')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('strong.msg-bold').text()).toBe('жирный')
    expect(wrapper.find('code.msg-code').text()).toBe('код')
    // Обрамление ушло в разметку, а не в текст
    expect(wrapper.find('.msg-text').text()).toBe('это жирный и код')
    wrapper.unmount()
  })

  it('спойлер скрыт до нажатия', async () => {
    const wrapper = mountRow('там ||секрет|| внутри')
    await wrapper.vm.$nextTick()

    const spoiler = wrapper.find('.msg-spoiler')
    expect(spoiler.exists()).toBe(true)
    expect(spoiler.classes()).not.toContain('on')

    await spoiler.trigger('click')
    expect(wrapper.find('.msg-spoiler').classes()).toContain('on')
    expect(wrapper.find('.msg-spoiler').text()).toBe('секрет')
    wrapper.unmount()
  })
})
