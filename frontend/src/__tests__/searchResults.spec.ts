import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import SearchResults from '@/components/messenger/SearchResults.vue'
import type { SearchUserResult } from '@/services/chatService'
import { splitByQuery } from '@/utils/search'
import type { Chat, Message } from '@/types'

/**
 * Панель результатов глобального поиска: переключатель «Люди/Сообщения», строки
 * найденных людей и сообщений, статусы «Поиск…/Никого не найдено».
 *
 * Разметка вынесена из ChatSidebar, поэтому проверяем именно её: важно, чтобы
 * заголовок чата, префикс «Вы: » и сниппет считались помощниками
 * `utils/messageSearch`, а клики уходили наверх событиями.
 */

const chat = (patch: Partial<Chat> = {}): Chat =>
  ({
    id: 7,
    name: 'Работа',
    is_group: false,
    is_channel: false,
    users: [
      { id: 1, username: 'me', first_name: 'Я', last_name: '' },
      { id: 2, username: 'peer', first_name: 'Пётр', last_name: 'Сидоров' }
    ],
    ...patch
  }) as unknown as Chat

const message = (patch: Partial<Message> = {}): Message =>
  ({
    id: 100,
    chat_id: 7,
    user_id: 2,
    text: 'проверка связи',
    timestamp: '2026-09-13T11:13:25.584403Z',
    hidden: false,
    encrypted: false,
    file: null,
    ...patch
  }) as unknown as Message

const user = (patch: Partial<SearchUserResult> = {}): SearchUserResult =>
  ({
    id: 24,
    username: 'petya',
    first_name: 'Пётр',
    last_name: 'Сидоров',
    phone_number: '+79001110001',
    ...patch
  }) as unknown as SearchUserResult

const mountResults = (props: Record<string, unknown> = {}) =>
  mount(SearchResults, {
    props: {
      query: 'пров',
      mode: 'people' as const,
      users: [] as SearchUserResult[],
      messages: [] as Message[],
      loading: false,
      chats: [chat()],
      currentUserId: 1,
      ...props
    },
    global: { stubs: { 'q-icon': true } }
  })

describe('SearchResults: режим «Люди»', () => {
  it('показывает найденных людей с логином и телефоном', () => {
    const wrapper = mountResults({ users: [user()] })

    expect(wrapper.find('.section-label').text()).toBe('Найти людей')
    expect(wrapper.find('.row-item').text()).toContain('Пётр Сидоров')
    expect(wrapper.find('.row-sub').text()).toContain('@petya')
    expect(wrapper.find('.row-sub').text()).toContain('+79001110001')
    wrapper.unmount()
  })

  it('подсвечивает совпадение с запросом', () => {
    const wrapper = mountResults({ users: [user()], query: 'Пётр' })
    const hits = wrapper.findAll('mark.search-hit')

    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text()).toBe(splitByQuery('Пётр Сидоров', 'Пётр')[0].text)
    wrapper.unmount()
  })

  it('сообщает, что никого не нашли', () => {
    const wrapper = mountResults({ users: [] })

    expect(wrapper.find('.search-status').text()).toBe('Никого не найдено')
    expect(wrapper.find('.row-item').exists()).toBe(false)
    wrapper.unmount()
  })

  it('во время поиска показывает статус', () => {
    const wrapper = mountResults({ users: [user()], loading: true })

    expect(wrapper.find('.search-status').text()).toBe('Поиск…')
    expect(wrapper.find('.row-item').exists()).toBe(false)
    wrapper.unmount()
  })

  it('клик по строке отдаёт выбранного человека наверх', async () => {
    const wrapper = mountResults({ users: [user()] })
    await wrapper.find('.row-item').trigger('click')

    expect(wrapper.emitted('pick-user')?.[0]?.[0]).toMatchObject({ id: 24 })
    wrapper.unmount()
  })
})

describe('SearchResults: режим «Сообщения»', () => {
  it('подписывает найденное сообщение чатом, временем и текстом', () => {
    const wrapper = mountResults({ mode: 'messages', messages: [message()] })

    expect(wrapper.find('.section-label').text()).toBe('Найдено в чатах')
    expect(wrapper.find('.msg-result-chat').text()).toBe('Пётр Сидоров')
    expect(wrapper.find('.row-time').text()).not.toBe('')
    expect(wrapper.find('.msg-result-snippet').text()).toBe('проверка связи')
    wrapper.unmount()
  })

  it('свои сообщения помечает префиксом «Вы: »', () => {
    const wrapper = mountResults({
      mode: 'messages',
      messages: [message({ user_id: 1 })]
    })

    expect(wrapper.find('.msg-result-snippet').text()).toBe('Вы: проверка связи')
    wrapper.unmount()
  })

  it('скрытое модератором сообщение не раскрывает', () => {
    const wrapper = mountResults({
      mode: 'messages',
      messages: [message({ text: 'секрет', hidden: true })]
    })

    expect(wrapper.find('.msg-result-snippet').text()).toBe('Скрыто до проверки модератором')
    wrapper.unmount()
  })

  it('сообщает, что ничего не нашли', () => {
    const wrapper = mountResults({ mode: 'messages', messages: [] })

    expect(wrapper.find('.search-status').text()).toBe('Ничего не найдено')
    wrapper.unmount()
  })

  it('клик по строке отдаёт найденное сообщение наверх', async () => {
    const wrapper = mountResults({ mode: 'messages', messages: [message()] })
    await wrapper.find('.row-item').trigger('click')

    expect(wrapper.emitted('pick-message')?.[0]?.[0]).toMatchObject({ id: 100 })
    wrapper.unmount()
  })
})

describe('SearchResults: переключатель режима', () => {
  it('переключатель показывает активный режим и сообщает о смене', async () => {
    const wrapper = mountResults({ mode: 'people' })
    const tabs = wrapper.findAll('.search-mode-tab')

    expect(tabs.map((tab) => tab.text())).toEqual(['Люди', 'Сообщения'])
    expect(tabs[0].classes()).toContain('active')

    await tabs[1].trigger('click')
    expect(wrapper.emitted('set-mode')?.[0]).toEqual(['messages'])
    wrapper.unmount()
  })
})
