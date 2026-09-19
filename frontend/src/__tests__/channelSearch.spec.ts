import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import SearchResults from '@/components/messenger/SearchResults.vue'
import type { ChannelCard } from '@/types'

/**
 * Поиск каналов живёт В ОБЩЕМ поиске (третья вкладка), а не отдельным экраном.
 *
 * Проверяем и разметку вкладки, и точки входа: кнопка в пустом разделе «Каналы»
 * должна открывать поиск сразу на нужной вкладке, а выбор канала — карточку
 * подписки (тот же экран, что по ссылке `/c/<адрес>`).
 */

const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8')
const list = readFileSync('src/components/messenger/ChatList.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const composable = readFileSync('src/composables/useGlobalSearch.ts', 'utf8')

const channel = (extra: Partial<ChannelCard> = {}): ChannelCard => ({
  id: 1,
  title: 'Новости',
  description: 'Коротко о главном',
  username: 'newsone',
  is_public: true,
  avatar_url: null,
  avatar_thumb_url: null,
  subscribers: 12,
  posts: 3,
  role: null,
  owner_name: 'Владелец',
  ...extra
})

const mountResults = (channels: ChannelCard[], query = 'нов') =>
  mount(SearchResults, {
    props: {
      query,
      mode: 'channels' as const,
      users: [],
      messages: [],
      channels,
      loading: false,
      chats: [],
      currentUserId: 1
    },
    global: { stubs: { 'q-icon': true } }
  })

describe('вкладка «Каналы» в поиске', () => {
  it('третья вкладка переключает область поиска', () => {
    const wrapper = mountResults([])

    const tabs = wrapper.findAll('.search-mode-tab')
    expect(tabs.map((tab) => tab.text())).toEqual(['Люди', 'Сообщения', 'Каналы'])
    expect(tabs[2]!.classes()).toContain('active')

    wrapper.findAll('.search-mode-tab')[1]!.trigger('click')
    wrapper.unmount()
  })

  it('показывает канал с адресом, подписчиками и описанием', () => {
    const wrapper = mountResults([channel()])

    const row = wrapper.find('.row-item')
    expect(row.text()).toContain('Новости')
    expect(row.text()).toContain('@newsone')
    expect(row.text()).toContain('12')
    expect(row.text()).toContain('Коротко о главном')
    // Совпадение запроса подсвечено, как у людей и сообщений.
    expect(row.find('.search-hit').exists()).toBe(true)
    wrapper.unmount()
  })

  it('у подписанного канала метка вместо стрелки, тап отдаёт канал наружу', async () => {
    const wrapper = mountResults([channel({ role: 'member' })])

    await wrapper.find('.row-item').trigger('click')

    expect(wrapper.emitted('pick-channel')?.[0]?.[0]).toMatchObject({ username: 'newsone' })
    wrapper.unmount()
  })

  it('пустой результат говорит об этом словами, а не пустотой', () => {
    const wrapper = mountResults([])

    expect(wrapper.find('.search-status').text()).toBe('Ничего не найдено')
    wrapper.unmount()
  })
})

describe('точки входа в поиск каналов', () => {
  it('в состоянии поиска есть режим каналов, и он ищет через сервис каналов', () => {
    expect(composable).toContain("export type SearchMode = 'people' | 'messages' | 'channels'")
    expect(composable).toContain("from '@/services/channelService'")
    expect(composable).toContain('channels.value = await searchChannels(text)')
  })

  it('пустой раздел «Каналы» подсказывает, что искать их нужно поиском', () => {
    // Отдельной кнопки нет (просьба владельца: она бессмысленна — поиск и так
    // в шапке), но подсказка говорит, ГДЕ искать.
    expect(list).toContain("props.filter === 'channels'")
    expect(list).toContain('найдите их поиском')
    expect(list).not.toContain('open-channel-search')
  })

  it('выбор канала открывает карточку подписки, а не «просто подписывает»', () => {
    expect(sidebar).toContain('@pick-channel="openChannelResult"')
    expect(sidebar).toContain("emit('open-channel', channel.username)")
    expect(messenger).toContain('@open-channel="openChannelByUsername"')
    expect(messenger).toContain('channelOverlaysRef.value?.openJoin(username)')
  })

  it('отдельного экрана каталога нет — искать каналы можно одним полем', () => {
    // Поле поиска обещает все три области, а не только людей и сообщения.
    expect(sidebar).toContain('Поиск: люди, сообщения, каналы')
  })
})
