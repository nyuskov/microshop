/**
 * Кто поставил реакцию (удержание/правый клик по чипу).
 *
 * Зачем тест: сервер отдаёт только id (`user_ids` в агрегате), а имена клиент
 * берёт из участников чата. Значит цепочка «агрегат → диалог → участники →
 * имя» состоит из трёх файлов, и разорвать её можно незаметно: чип без
 * удержания (список никогда не открыть), диалог без `user_ids` (пустой список)
 * или неленивый импорт (тяжёлый чанк в основной сборке).
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import MessageRow from '@/components/messenger/MessageRow.vue'
import ReactionUsersDialog from '@/components/messenger/ReactionUsersDialog.vue'
import type { ChatUser, Message, ReactionSummary } from '@/types'

const messageRow = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
const thread = readFileSync('src/components/messenger/MessageThread.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')

const member = (id: number, first: string, last: string | null = null): ChatUser => ({
  id,
  username: `u${id}`,
  first_name: first,
  last_name: last,
  phone_number: null,
  avatar_url: null
})

const members = [member(1, 'Я'), member(2, 'Аня', 'Кузнецова'), member(3, 'Борис')]

/** Упрощённые заглушки Quasar: важен текст и клик, а не вид. */
const stubFor = { template: '<div><slot /></div>' }

const mountDialog = (
  reactions: ReactionSummary[],
  initialEmoji: string,
  myUserId: number | null = 1
) =>
  mount(ReactionUsersDialog, {
    props: { reactions, members, myUserId, initialEmoji, anchor: null },
    global: {
      stubs: {
        'q-menu': stubFor,
        'q-separator': true,
        'q-space': true,
        'q-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' }
      }
    }
  })

describe('ReactionUsersDialog', () => {
  it('показывает имена по id и ставит меня первым', () => {
    const wrapper = mountDialog(
      [{ emoji: '👍', count: 3, reacted_by_me: true, user_ids: [3, 1, 2] }],
      '👍'
    )

    const rows = wrapper.findAll('.ru-row')
    expect(rows.length).toBe(3)
    expect(rows.map((row) => row.find('.ru-name').text())).toEqual(['Вы', 'Борис', 'Аня Кузнецова'])
    // «Вы» помечены и словом, а не только порядком.
    expect(rows[0].find('.ru-me').exists()).toBe(true)
    expect(rows[1].find('.ru-me').exists()).toBe(false)
  })

  it('открывается на той реакции, по которой удержали чип', () => {
    const reactions: ReactionSummary[] = [
      { emoji: '👍', count: 1, reacted_by_me: false, user_ids: [2] },
      { emoji: '❤️', count: 1, reacted_by_me: true, user_ids: [1] }
    ]
    const wrapper = mountDialog(reactions, '❤️')

    expect(wrapper.findAll('.ru-tab').map((tab) => tab.text())).toEqual(['👍1', '❤️1'])
    expect(wrapper.findAll('.ru-tab')[1].classes()).toContain('active')
    expect(wrapper.find('.ru-name').text()).toBe('Вы')
  })

  it('переключение вкладки меняет список', async () => {
    const reactions: ReactionSummary[] = [
      { emoji: '👍', count: 1, reacted_by_me: false, user_ids: [2] },
      { emoji: '❤️', count: 1, reacted_by_me: true, user_ids: [1] }
    ]
    const wrapper = mountDialog(reactions, '👍')

    expect(wrapper.find('.ru-name').text()).toBe('Аня Кузнецова')

    await wrapper.findAll('.ru-tab')[0].trigger('click')
    await wrapper.findAll('.ru-tab')[1].trigger('click')

    expect(wrapper.find('.ru-name').text()).toBe('Вы')
  })

  it('одна реакция — без вкладок, чужой id показывается нейтрально', () => {
    const wrapper = mountDialog(
      [{ emoji: '👍', count: 2, reacted_by_me: false, user_ids: [42, 2] }],
      '👍'
    )

    expect(wrapper.find('.ru-tabs').exists()).toBe(false)
    expect(wrapper.findAll('.ru-name').map((node) => node.text())).toEqual([
      'Участник',
      'Аня Кузнецова'
    ])
  })

  it('в окне эмодзи крупнее, чем в чипе у сообщения', () => {
    const wrapper = mountDialog(
      [
        { emoji: '👍', count: 1, reacted_by_me: false, user_ids: [2] },
        { emoji: '❤️', count: 1, reacted_by_me: true, user_ids: [1] }
      ],
      '👍'
    )

    // Крупная метка в шапке и крупные эмодзи на вкладках
    expect(wrapper.find('.ru-emoji').text()).toBe('👍')
    expect(wrapper.findAll('.ru-tab-emoji').map((node) => node.text())).toEqual(['👍', '❤️'])
    const dialog = readFileSync('src/components/messenger/ReactionUsersDialog.vue', 'utf8')
    expect(dialog).toContain('.ru-emoji {\n  font-size: 24px;')
    // А в сообщении эмодзи остался мелким (var(--ms-fs-md))
    expect(messageRow).toContain('.reaction-emoji {\n  font-size: var(--ms-fs-md);')
  })

  it('пустой user_ids объясняет, что никого нет (а не молчит)', () => {
    const wrapper = mountDialog([{ emoji: '👍', count: 1, reacted_by_me: false }], '👍')

    expect(wrapper.find('.ru-list').exists()).toBe(false)
    expect(wrapper.find('.ru-empty').text()).toContain('Никого')
  })

  it('закрывается крестиком', async () => {
    const wrapper = mountDialog(
      [{ emoji: '👍', count: 1, reacted_by_me: false, user_ids: [2] }],
      '👍'
    )

    await wrapper.find('button[aria-label="Закрыть"]').trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })
})

describe('жесты на чипе реакции (живая разметка)', () => {
  const rowWith = (reactions: ReactionSummary[], membersList: ChatUser[] = []) =>
    mount(MessageRow, {
      props: {
        message: {
          id: 1,
          chat_id: 7,
          user_id: 2,
          text: 'привет',
          timestamp: '2026-09-18T00:00:00Z',
          reply_to_id: null,
          is_read: true,
          is_pinned: false,
          edited_at: null,
          file: null,
          reactions,
          forwarded_from: null
        } as unknown as Message,
        isOwn: false,
        viewerId: 1,
        highlighted: false,
        emojiPickerOpen: false,
        quote: null,
        selectionMode: false,
        selected: false,
        selectable: true,
        members: membersList
      },
      global: { stubs: { 'q-icon': true } }
    })

  /** jsdom не знает PointerEvent — подставляем координаты вручную. */
  const pointerEvent = (type: string, x: number, y: number): Event => {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { clientX: x, clientY: y })
    return event
  }

  /** Нажатие на чип с удержанием: таймер двигаем руками, ждать 450 мс незачем. */
  const press = (
    wrapper: ReturnType<typeof rowWith>,
    ms: number
  ): { chip: ReturnType<ReturnType<typeof rowWith>['find']> } => {
    const chip = wrapper.find('.reaction-chip')
    chip.element.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    vi.advanceTimersByTime(ms)
    return { chip }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('удержание открывает список, а отпускание не ставит реакцию', async () => {
    vi.useFakeTimers()
    const wrapper = rowWith([{ emoji: '🔥', count: 1, reacted_by_me: false, user_ids: [2] }])

    const { chip } = press(wrapper, 500)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('open-reactions')?.[0]?.[0]).toBe('🔥')
    await chip.trigger('pointerup')
    await chip.trigger('click')
    expect(wrapper.emitted('toggle-reaction')).toBeUndefined()
    wrapper.unmount()
  })

  it('быстрый тап ставит реакцию и списка не открывает', async () => {
    vi.useFakeTimers()
    const wrapper = rowWith([{ emoji: '🔥', count: 1, reacted_by_me: false, user_ids: [2] }])

    const { chip } = press(wrapper, 100)
    await chip.trigger('pointerup')
    await chip.trigger('click')

    expect(wrapper.emitted('toggle-reaction')).toEqual([['🔥']])
    expect(wrapper.emitted('open-reactions')).toBeUndefined()
    wrapper.unmount()
  })

  it('клик после удержания не «залипает»: следующий тап снова ставит реакцию', async () => {
    vi.useFakeTimers()
    const wrapper = rowWith([{ emoji: '🔥', count: 1, reacted_by_me: false, user_ids: [2] }])

    // Удержание открыло список, а клик, закончивший нажатие, ушёл на подложку
    // диалога — в браузере он до чипа не доходит вовсе.
    press(wrapper, 500)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('open-reactions')).toHaveLength(1)

    const { chip } = press(wrapper, 80)
    await chip.trigger('pointerup')
    await chip.trigger('click')

    expect(wrapper.emitted('toggle-reaction')).toEqual([['🔥']])
    wrapper.unmount()
  })

  it('сдвиг указателя отменяет удержание (это жест прокрутки)', async () => {
    vi.useFakeTimers()
    const wrapper = rowWith([{ emoji: '🔥', count: 1, reacted_by_me: false, user_ids: [2] }])

    const chip = wrapper.find('.reaction-chip')
    chip.element.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    chip.element.dispatchEvent(pointerEvent('pointermove', 60, 10))
    vi.advanceTimersByTime(600)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('open-reactions')).toBeUndefined()
    wrapper.unmount()
  })

  it('удержание отдаёт наружу сам чип — окно открывается рядом с ним', async () => {
    vi.useFakeTimers()
    const wrapper = rowWith([{ emoji: '🔥', count: 1, reacted_by_me: false, user_ids: [2] }])

    press(wrapper, 500)
    await wrapper.vm.$nextTick()

    const payload = wrapper.emitted('open-reactions')?.[0]
    expect(payload?.[0]).toBe('🔥')
    expect(payload?.[1]).toBe(wrapper.find('.reaction-chip').element)
    wrapper.unmount()
  })

  it('пока отметивших мало — в чипе их аватарки вместо числа', () => {
    const wrapper = rowWith(
      [{ emoji: '🔥', count: 2, reacted_by_me: false, user_ids: [2, 3] }],
      members
    )

    expect(wrapper.findAll('.reaction-face')).toHaveLength(2)
    expect(wrapper.find('.reaction-count').exists()).toBe(false)
    wrapper.unmount()
  })

  it('когда отметивших много — возвращается счётчик', () => {
    const wrapper = rowWith(
      [{ emoji: '🔥', count: 4, reacted_by_me: false, user_ids: [2, 3, 4, 5] }],
      members
    )

    expect(wrapper.findAll('.reaction-face')).toHaveLength(0)
    expect(wrapper.find('.reaction-count').text()).toBe('4')
    wrapper.unmount()
  })

  it('новая реакция проигрывает анимацию, и класс снимается сам', async () => {
    vi.useFakeTimers()
    const wrapper = rowWith([{ emoji: '🔥', count: 1, reacted_by_me: false, user_ids: [2] }])

    // Открытие чата реакции не анимирует: анимация — про НОВОЕ нажатие.
    expect(wrapper.find('.reaction-chip').classes()).not.toContain('fresh')

    await wrapper.setProps({
      message: {
        ...(wrapper.props('message') as Message),
        reactions: [{ emoji: '🔥', count: 2, reacted_by_me: true, user_ids: [2, 1] }]
      } as Message
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.reaction-chip').classes()).toContain('fresh')

    vi.advanceTimersByTime(600)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.reaction-chip').classes()).not.toContain('fresh')
    wrapper.unmount()
  })

  it('снятие реакции (счётчик упал) анимацию не запускает', async () => {
    const wrapper = rowWith([{ emoji: '🔥', count: 2, reacted_by_me: true, user_ids: [2, 1] }])

    await wrapper.setProps({
      message: {
        ...(wrapper.props('message') as Message),
        reactions: [{ emoji: '🔥', count: 1, reacted_by_me: false, user_ids: [2] }]
      } as Message
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.reaction-chip').classes()).not.toContain('fresh')
    wrapper.unmount()
  })
})

describe('жесты на чипе реакции (стражи разметки)', () => {
  it('тап ставит свою реакцию, а удержание открывает список', () => {
    expect(messageRow).toContain('@click="onReactionClick(reaction.emoji)"')
    expect(messageRow).toContain('@pointerdown="startReactionHold(reaction.emoji, $event)"')
    expect(messageRow).toContain(
      '@contextmenu.stop.prevent="onReactionContext(reaction.emoji, $event)"'
    )
    expect(messageRow).toContain(
      "(e: 'open-reactions', emoji: string, anchor: HTMLElement | null): void"
    )
    expect(messageRow).toContain('cancelReactionHold')

    // Клик, которым закончилось удержание, не должен ещё и менять реакцию.
    const click = messageRow.slice(messageRow.indexOf('const onReactionClick'))
    expect(click).toContain('if (reactionHoldHandled)')
    expect(click).toContain("emit('toggle-reaction', emoji)")

    // Грабли: список открылся, клик после отпускания ушёл на подложку диалога,
    // и флаг остался взведённым — съедал следующий тап по реакции.
    const start = messageRow.slice(messageRow.indexOf('const startReactionHold'))
    expect(start).toContain('reactionHoldHandled = false')
  })

  it('на мобильном удержание не открывает ещё и меню сообщения', () => {
    // У строки свой `contextmenu` (лист действий). На телефоне удержание даёт
    // и наш таймер, и системный contextmenu: без гашения всплытия на чипе
    // открывались два окна сразу.
    expect(messageRow).toContain('@contextmenu.stop.prevent="onReactionContext')
    const context = messageRow.slice(messageRow.indexOf('const onReactionContext'))
    expect(context).toContain('if (reactionHoldHandled) return')
  })

  it('удержание отменяется сдвигом указателя, а не выходом за чип', () => {
    // Грабли: при наведении появляется панель действий, строка сдвигается —
    // удержание гасилось по pointerleave при неподвижном курсоре.
    expect(messageRow).not.toContain('@pointerleave="cancelReactionHold"')
    expect(messageRow).toContain('@pointermove="onReactionHoldMove"')
    expect(messageRow).toContain('@pointercancel="cancelReactionHold"')
    const move = messageRow.slice(messageRow.indexOf('const onReactionHoldMove'))
    expect(move).toContain('Math.hypot(')
    expect(move).toContain('REACTION_HOLD_SLOP')
  })

  it('чип реакции передаёт удержание кнопке, а не выделению сообщения', () => {
    // Контейнер реакций гасит pointerdown: иначе удержание на чипе запускало
    // бы выделение сообщения (и список бы не открывался).
    expect(messageRow).toContain('@pointerdown.stop')
    expect(messageRow).toContain('@click.stop')
  })

  it('лента сообщений пробрасывает событие наружу вместе с сообщением', () => {
    expect(thread).toContain('(emoji: string, anchor: HTMLElement | null) =>')
    expect(thread).toContain("emit('open-reactions', item.row.message, emoji, anchor)")
    expect(thread).toContain(
      "(e: 'open-reactions', message: Message, emoji: string, anchor: HTMLElement | null): void"
    )
    // Лица в чипах берутся из участников чата — их надо довести до строки.
    expect(thread).toContain(':members="members"')
  })

  it('Messenger подключает окно лениво и сбрасывает его при смене чата', () => {
    expect(messenger).toContain("import('@/components/messenger/ReactionUsersDialog.vue')")
    expect(messenger).toContain('@open-reactions="openReactionUsers"')
    expect(messenger).toContain('anchor: HTMLElement | null')
    expect(messenger).toContain(':anchor="reactionUsersFor.anchor"')
    expect(messenger).toContain(':my-user-id="currentUserId"')
    expect(messenger).toContain('@close="reactionUsersFor = null"')
    // Иначе список от прошлого чата остался бы открытым поверх нового.
    expect(messenger).toContain('reactionUsersFor.value = null')
  })

  it('окно открывается у чипа снизу, а не по центру экрана', () => {
    const dialog = readFileSync('src/components/messenger/ReactionUsersDialog.vue', 'utf8')
    expect(dialog).toContain('<q-menu')
    expect(dialog).toContain(':target="anchor ?? undefined"')
    // anchor = нижний край чипа, self = верх окна → окно растёт вниз от реакции.
    expect(dialog).toContain('anchor="bottom middle"')
    expect(dialog).toContain('self="top middle"')
    // Свои клики по чипу не должны мигать окном: открываем только удержанием.
    expect(dialog).toContain('no-parent-event')
  })

  it('реакции живут внутри пузыря, одной строкой с временем', () => {
    // «В фоне сообщения», как в Telegram: отдельной строки под пузырём нет.
    const footer = messageRow.indexOf('class="msg-footer"')
    expect(footer).toBeGreaterThan(-1)
    expect(messageRow.indexOf('class="reactions"')).toBeGreaterThan(footer)
    expect(messageRow.indexOf('class="msg-meta"')).toBeGreaterThan(footer)
  })

  it('чип реакции выделяется тоном, без рамок', () => {
    const css = messageRow.slice(messageRow.indexOf('.reaction-chip {'))
    const chip = css.slice(0, css.indexOf('}'))
    expect(chip).toContain('background: color-mix(')
    expect(chip).toContain('border: none')
    expect(chip).not.toContain('border: 1px solid')

    // «Моя» реакция — полупрозрачный тон вместо своей краски и рамки.
    const mine = css.slice(css.indexOf('.reaction-chip.mine'))
    const mineRule = mine.slice(0, mine.indexOf('}'))
    expect(mineRule).toContain('color-mix(')
    expect(mineRule).toContain('transparent')
    expect(mineRule).not.toContain('border')
  })

  it('QMenu зарегистрирован: иначе меню молча не отрисуется', () => {
    const quasar = readFileSync('src/quasar.ts', 'utf8')
    expect(quasar).toContain('QMenu,')
  })
})
