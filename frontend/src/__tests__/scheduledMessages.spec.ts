import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ScheduledBar from '@/components/messenger/ScheduledBar.vue'
import type { ScheduledMessage } from '@/types'
import { formatScheduledAt, schedulePresets, scheduledSendAt } from '@/utils/scheduledSend'

/**
 * Отложенные сообщения: «отправить позже» (F6).
 *
 * Смысл функции — сообщение уходит, даже когда приложение закрыто, поэтому
 * очередь живёт на сервере, а клиент только показывает список и ставит запись.
 * Здесь проверяем клиентскую часть: пресеты времени считаются от текущего
 * момента (иначе вечером предлагалось бы уже прошедшее «сегодня в 9:00»),
 * подписи времени понятные, а шторка отложенных умеет отменять отправку и не
 * показывает шифротекст в E2EE-чате.
 */
const composer = readFileSync('src/components/messenger/MessageComposer.vue', 'utf8')
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
const service = readFileSync('src/services/chatService.ts', 'utf8')

const scheduled = (extra: Partial<ScheduledMessage> = {}): ScheduledMessage =>
  ({
    id: 7,
    chat_id: 3,
    user_id: 1,
    text: 'Утреннее приветствие',
    encrypted: false,
    reply_to_id: null,
    send_at: '2026-09-19T06:00:00Z',
    created_at: '2026-09-18T18:00:00Z',
    ...extra
  }) as ScheduledMessage

const mountBar = (rows: ScheduledMessage[], decrypted?: Record<number, string>) =>
  mount(ScheduledBar, {
    props: { rows, decrypted },
    global: { stubs: { 'q-icon': true } }
  })

describe('пресеты «отправить позже»', () => {
  it('вечером не предлагает уже прошедшее «сегодня в 9:00»', () => {
    const evening = new Date('2026-09-18T20:30:00')
    const labels = schedulePresets(evening).map((preset) => preset.label)

    expect(labels).toEqual(['Через час', 'Завтра в 09:00'])
  })

  it('утром предлагает и сегодняшнее время, и завтрашнее', () => {
    const morning = new Date('2026-09-18T07:00:00')
    const presets = schedulePresets(morning)

    expect(presets.map((preset) => preset.label)).toEqual([
      'Через час',
      'Сегодня в 09:00',
      'Завтра в 09:00'
    ])
    // «Через час» — ровно час от текущего момента, а не какая-то другая минута.
    expect(presets[0]!.at.getTime() - morning.getTime()).toBe(60 * 60 * 1000)
  })

  it('на сервер уходит UTC-момент (ISO)', () => {
    const at = new Date('2026-09-18T20:30:00Z')

    expect(scheduledSendAt(at)).toBe('2026-09-18T20:30:00.000Z')
  })

  it('подпись времени: минуты, часы, сегодня, завтра, другая дата', () => {
    const now = new Date('2026-09-18T12:00:00')

    expect(formatScheduledAt(new Date('2026-09-18T12:25:00'), now)).toBe('через 25 мин')
    expect(formatScheduledAt(new Date('2026-09-18T14:00:00'), now)).toBe('через 2 ч')
    expect(formatScheduledAt(new Date('2026-09-18T21:00:00'), now)).toBe('сегодня в 21:00')
    expect(formatScheduledAt(new Date('2026-09-19T09:00:00'), now)).toBe('завтра в 09:00')
    expect(formatScheduledAt(new Date('2026-09-22T09:00:00'), now)).toContain('22')
  })
})

describe('шторка отложенных сообщений', () => {
  it('без отложенных ничего не рисует', () => {
    const wrapper = mountBar([])

    expect(wrapper.find('.scheduled-bar').exists()).toBe(false)
  })

  it('показывает счётчик и ближайшее время, список раскрывается', async () => {
    const wrapper = mountBar([
      scheduled(),
      scheduled({ id: 8, text: 'Второе', send_at: '2026-09-19T09:00:00Z' })
    ])

    expect(wrapper.find('.scheduled-count').text()).toBe('2')
    expect(wrapper.find('.scheduled-list').exists()).toBe(false)

    await wrapper.find('.scheduled-toggle').trigger('click')

    expect(wrapper.findAll('.scheduled-item')).toHaveLength(2)
    expect(wrapper.text()).toContain('Утреннее приветствие')
  })

  it('отмена уходит наверх с id записи', async () => {
    const wrapper = mountBar([scheduled()])
    await wrapper.find('.scheduled-toggle').trigger('click')

    await wrapper.find('.scheduled-cancel').trigger('click')

    expect(wrapper.emitted('cancel')).toEqual([[7]])
  })

  it('в зашифрованном чате не показывает шифротекст', async () => {
    const wrapper = mountBar([scheduled({ encrypted: true, text: 'BASE64ШИФРОТЕКСТ-МУСОР' })])
    await wrapper.find('.scheduled-toggle').trigger('click')

    expect(wrapper.text()).not.toContain('МУСОР')
    expect(wrapper.find('.scheduled-preview').text()).toBe('Зашифрованное сообщение')
  })

  it('расшифрованный текст показывает вместо подписи', async () => {
    const wrapper = mountBar([scheduled({ encrypted: true, text: 'ШИФР' })], {
      7: 'Поздравление с утра'
    })
    await wrapper.find('.scheduled-toggle').trigger('click')

    expect(wrapper.find('.scheduled-preview').text()).toBe('Поздравление с утра')
  })
})

describe('подключение отложенной отправки', () => {
  it('сервис умеет создать, прочитать и отменить отправку', () => {
    expect(service).toContain("api.post<ScheduledMessage>('/messages/scheduled/'")
    expect(service).toContain("api.get<ScheduledMessage[]>('/messages/scheduled/'")
    expect(service).toContain('api.delete(`/messages/scheduled/${scheduledId}/`)')
  })

  it('меню времени живёт на кнопке отправки, а не отдельной кнопкой', () => {
    // Обычный клик отправляет, удержание/правая кнопка — предлагают время.
    expect(composer).toContain('startScheduleHold')
    expect(composer).toContain('@contextmenu.prevent="openScheduleMenu"')
    expect(composer).toContain("emit('send-scheduled', scheduledSendAt(preset.at))")
  })

  it('чат подтягивает отложенные и сбрасывает их при переходе', () => {
    expect(messenger).toContain('loadScheduled(chatId)')
    expect(messenger).toContain('@send-scheduled="scheduleSend"')
    // При открытии другого чата список прошлого чата не остаётся.
    expect(messenger).toContain('scheduledMessages.value = []')
  })
})
