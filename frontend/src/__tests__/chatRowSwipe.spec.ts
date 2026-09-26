import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'

import ChatList from '@/components/messenger/ChatList.vue'
import {
  CHAT_SWIPE_KEY,
  CHAT_SWIPE_OPTIONS,
  readChatSwipeAction,
  writeChatSwipeAction,
  chatSwipeAction
} from '@/utils/chatSwipe'
import type { Chat } from '@/types'

/**
 * Свайпы по строке чата (телефон): вправо — закрепить/открепить, влево — в архив.
 *
 * Жест повторяет то, что уже есть в меню чата и в панели выделения, но без
 * долгого тапа и двух нажатий. Левый свайп настраивается: архив, уведомления или
 * «отметить прочитанным». Проверяем главное: порог, направление, что
 * вертикальное листание списка наш жест НЕ запускает и что подсказка называет
 * именно то действие, которое сработает.
 */
const chat = (id: number, title: string): Chat =>
  ({
    id,
    is_self: false,
    is_channel: false,
    is_group: false,
    unread_count: 0,
    last_message: null,
    users: [
      {
        id: 100 + id,
        username: `u${id}`,
        first_name: title,
        last_name: null,
        phone_number: null,
        avatar_url: null
      }
    ]
  }) as unknown as Chat

const CHATS = [chat(1, 'Анна'), chat(2, 'Иван')]

function mountList(
  props: Partial<InstanceType<typeof ChatList>['$props']> = {}
): ReturnType<typeof mount> {
  return mount(ChatList, {
    props: {
      chats: CHATS,
      loading: false,
      currentUserId: 999,
      selectedChatId: null,
      selectionMode: false,
      selectedIds: [],
      filter: 'all',
      filters: [{ key: 'all', title: 'Все' }],
      unreadCount: 0,
      handleScroll: () => undefined,
      pinnedChatIds: [],
      archivedChatIds: [],
      ...props
    },
    global: { stubs: { 'q-icon': true } }
  })
}

/** Синтетическое касание: в jsdom нет ни Touch, ни TouchEvent. */
const touch = (type: string, x: number, y: number): Event => {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }]
  })
  return event
}

/** Свайп по строке: сначала уверенное движение, потом отпускание. */
const swipeRow = (
  wrapper: ReturnType<typeof mount>,
  dx: number,
  dy = 0,
  hold = false
): { row: Element; hint: () => string | null } => {
  const row = wrapper.findAll('.row-item')[0]!.element
  row.dispatchEvent(touch('touchstart', 200, 400))
  row.dispatchEvent(touch('touchmove', 200 + dx / 2, 400 + dy / 2))
  row.dispatchEvent(touch('touchmove', 200 + dx, 400 + dy))
  if (!hold) row.dispatchEvent(touch('touchend', 200 + dx, 400 + dy))
  return {
    row,
    hint: () =>
      wrapper.find('.row-swipe').exists() ? wrapper.find('.row-swipe').text().trim() : null
  }
}

describe('свайп по строке чата', () => {
  it('вправо — закрепить', async () => {
    const wrapper = mountList()
    swipeRow(wrapper, 80)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('swipe-pin')).toEqual([[CHATS[0]!.id]])
    expect(wrapper.emitted('swipe-archive')).toBeUndefined()
  })

  it('влево — в архив', async () => {
    const wrapper = mountList()
    swipeRow(wrapper, -80)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('swipe-archive')).toEqual([[CHATS[0]!.id]])
    expect(wrapper.emitted('swipe-pin')).toBeUndefined()
  })

  it('влево — уведомления, если так выбрано в настройках', async () => {
    writeChatSwipeAction('mute')
    const wrapper = mountList({ mutedChatIds: [] })
    swipeRow(wrapper, -80, 0, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.row-swipe').text()).toContain('Выключить уведомления')
    wrapper.find('.row-item').element.dispatchEvent(touch('touchend', 120, 400))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('swipe-mute')).toEqual([[CHATS[0]!.id]])
    expect(wrapper.emitted('swipe-archive')).toBeUndefined()
    writeChatSwipeAction('archive')
  })

  it('влево — отметить прочитанным, если так выбрано в настройках', async () => {
    writeChatSwipeAction('read')
    const wrapper = mountList({ unreadChatCount: 3 })
    swipeRow(wrapper, -80, 0, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.row-swipe').text()).toContain('Отметить прочитанным')
    wrapper.find('.row-item').element.dispatchEvent(touch('touchend', 120, 400))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('swipe-read')).toEqual([[CHATS[0]!.id]])
    expect(wrapper.emitted('swipe-archive')).toBeUndefined()
    writeChatSwipeAction('archive')
  })

  it('подсказка называет действие, которое сработает', async () => {
    const wrapper = mountList({ pinnedChatIds: [CHATS[0]!.id], archivedChatIds: [CHATS[1]!.id] })
    swipeRow(wrapper, 80, 0, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.row-swipe').text()).toContain('Открепить')
    expect(wrapper.find('.row-swipe').classes()).toContain('pin')
    wrapper.unmount()

    const other = mountList({ pinnedChatIds: [], archivedChatIds: [CHATS[0]!.id] })
    swipeRow(other, -80, 0, true)
    await other.vm.$nextTick()
    expect(other.find('.row-swipe').text()).toContain('Из архива')
    expect(other.find('.row-swipe').classes()).toContain('archive')
  })

  it('короткий свайп ничего не делает', async () => {
    const wrapper = mountList()
    swipeRow(wrapper, 40)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('swipe-pin')).toBeUndefined()
    expect(wrapper.find('.row-swipe').exists()).toBe(false)
  })

  it('листание списка пальцем вниз — не свайп', async () => {
    const wrapper = mountList()
    swipeRow(wrapper, 20, 90)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('swipe-pin')).toBeUndefined()
    expect(wrapper.emitted('swipe-archive')).toBeUndefined()
    expect(wrapper.find('.row-swipe').exists()).toBe(false)
  })

  it('во время свайпа удержание строки отменяется', async () => {
    // Иначе медленный свайп успевал открыть режим выделения (он стартует
    // через 480 мс) и строка уезжала под панель выделения.
    const wrapper = mountList()
    swipeRow(wrapper, 80, 0, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('row-pointer-cancel')).toBeTruthy()
  })

  it('медленная протяжка вниз тоже отменяет удержание строки', async () => {
    // Владелец: «протяжка работает только справа». Причина — удержание строки:
    // при вертикальном движении оно НЕ отменялось, через 480 мс включался режим
    // выделения и протяжка вниз обрывалась на середине.
    const wrapper = mountList()
    swipeRow(wrapper, 20, 90, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('row-pointer-cancel')).toBeTruthy()
    expect(wrapper.emitted('swipe-pin')).toBeUndefined()
  })

  it('в режиме выделения строки не сдвигаются', async () => {
    const wrapper = mountList({ selectionMode: true, selectedIds: [CHATS[0]!.id] })
    swipeRow(wrapper, 80)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('swipe-pin')).toBeUndefined()
    expect(wrapper.find('.row-swipe').exists()).toBe(false)
  })
})

describe('связки в интерфейсе', () => {
  const sidebar = readFileSync('src/components/messenger/ChatSidebar.vue', 'utf8')

  it('жест идёт тем же путём, что и меню чата', () => {
    expect(sidebar).toContain('@swipe-pin="onSwipePin"')
    expect(sidebar).toContain('@swipe-archive="onSwipeArchive"')
    expect(sidebar).toContain("const onSwipePin = (chatId: number) => emit('toggle-pin', chatId)")
    expect(sidebar).toContain("emit('bulk-archive', [chatId], !isArchivedOf(chatId))")
    // Вариант «Уведомления» идёт тем же путём, что мьют из меню чата.
    expect(sidebar).toContain('@swipe-mute="onSwipeMute"')
    expect(sidebar).toContain("const onSwipeMute = (chatId: number) => emit('toggle-mute', chatId)")
    // Списку нужны оба состояния: по ним подпись подложки («Закрепить»/«В архив»).
    expect(sidebar).toContain(':pinned-chat-ids="pinnedChatIds"')
    expect(sidebar).toContain(':archived-chat-ids="archivedChatIds"')
  })

  it('«отметить прочитанным» уходит отдельным событием, а не как мьют', () => {
    // Снять счётчик — не то же самое, что заглушить чат: решение принимает
    // Messenger, поэтому у события своё имя.
    expect(sidebar).toContain('@swipe-read="onSwipeRead"')
    expect(sidebar).toContain("const onSwipeRead = (chatId: number) => emit('mark-read', chatId)")
    const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
    expect(messenger).toContain('@mark-read="markChatReadQuietly"')
  })
})

describe('настройка «что делает левый свайп»', () => {
  const storage = (value: string | null): Storage =>
    ({
      getItem: (key: string) => (key === CHAT_SWIPE_KEY ? value : null),
      setItem: () => undefined
    }) as unknown as Storage

  it('по умолчанию — в архив', () => {
    expect(readChatSwipeAction(storage(null))).toBe('archive')
  })

  it('мусор в хранилище не ломает жест', () => {
    expect(readChatSwipeAction(storage('что-то'))).toBe('archive')
    expect(readChatSwipeAction(undefined)).toBe('archive')
  })

  it('сохранённый выбор применяется сразу', () => {
    writeChatSwipeAction('read')
    expect(chatSwipeAction.value).toBe('read')
    writeChatSwipeAction('mute')
    expect(chatSwipeAction.value).toBe('mute')
    writeChatSwipeAction('archive')
    expect(chatSwipeAction.value).toBe('archive')
  })

  it('в настройках три варианта, и подписи переводятся', () => {
    expect(CHAT_SWIPE_OPTIONS.map((option) => option.key)).toEqual(['archive', 'mute', 'read'])
    // Подписи — ключи перевода: константа объявлена при загрузке модуля, и
    // готовые строки застыли бы на языке, который был тогда.
    expect(CHAT_SWIPE_OPTIONS.every((option) => option.label && option.hint)).toBe(true)
    const settings = readFileSync('src/views/AppearanceSettings.vue', 'utf8')
    expect(settings).toContain('{{ t(opt.label) }}')
    expect(settings).toContain(':title="t(opt.hint)"')
  })
})
