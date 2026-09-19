import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ReminderDialog from '@/components/messenger/ReminderDialog.vue'
import type { MessageReminder } from '@/types'
import { reminderPresets, reminderSendAt } from '@/utils/reminders'

/**
 * Напоминания о сообщении («напомнить мне»).
 *
 * Проверяем три вещи, которые легко сделать неправильно:
 *
 * 1. Пресеты времени считаются от текущего момента и только в будущее —
 *    «сегодня в 20:00» после восьми вечера сервер отклонит;
 * 2. диалог умеет и поставить напоминание, и убрать уже стоящее (кнопка «Убрать»
 *    есть только когда напоминание реально есть);
 * 3. тап по push о напоминании ведёт в чат — для этого service worker считает
 *    напоминание «чатным» push'ем наравне с сообщением (см. sandbox ниже).
 */
const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
/** Владелец темы напоминаний: списком и диалогом занимается composable. */
const reminders = readFileSync('src/composables/useMessageReminders.ts', 'utf8')
const service = readFileSync('src/services/chatService.ts', 'utf8')
const bar = readFileSync('src/components/messenger/MessageActionsBar.vue', 'utf8')
const sheet = readFileSync('src/components/messenger/MessageActionSheet.vue', 'utf8')
const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
const thread = readFileSync('src/components/messenger/MessageThread.vue', 'utf8')

const reminder = (extra: Partial<MessageReminder> = {}): MessageReminder => ({
  id: 5,
  chat_id: 3,
  message_id: 42,
  user_id: 1,
  remind_at: '2026-09-19T18:00:00Z',
  created_at: '2026-09-19T12:00:00Z',
  ...extra
})

/** Упрощённые заглушки Quasar: нам важны текст и клик, а не вид. */
const stubFor = { template: '<div><slot /></div>' }

const mountDialog = (existing: MessageReminder | null = null) =>
  mount(ReminderDialog, {
    props: { messageId: 42, preview: 'Не забудь про счёт', chatTitle: 'Мама', reminder: existing },
    global: {
      stubs: {
        'q-icon': true,
        'q-dialog': stubFor,
        'q-card': stubFor,
        'q-card-section': stubFor,
        'q-separator': true,
        'q-space': true,
        'q-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' }
      }
    }
  })

describe('пресеты напоминания', () => {
  it('все варианты — в будущем, от ближайшего к дальнему', () => {
    const now = new Date('2026-09-19T12:00:00')
    const presets = reminderPresets(now)

    expect(presets.map((preset) => preset.label)).toEqual([
      'Через 20 минут',
      'Через час',
      'Сегодня в 20:00',
      'Завтра в 09:00',
      'Через неделю в 12:00'
    ])
    for (const preset of presets) {
      expect(preset.at.getTime()).toBeGreaterThan(now.getTime())
    }
    expect(presets[0]!.at.getTime() - now.getTime()).toBe(20 * 60 * 1000)
  })

  it('вечером не предлагает уже прошедшее «сегодня в 20:00»', () => {
    const evening = new Date('2026-09-19T21:30:00')
    const labels = reminderPresets(evening).map((preset) => preset.label)

    expect(labels).toEqual([
      'Через 20 минут',
      'Через час',
      'Завтра в 09:00',
      'Через неделю в 21:30'
    ])
  })

  it('на сервер уходит UTC-момент (ISO)', () => {
    expect(reminderSendAt(new Date('2026-09-19T21:30:00Z'))).toBe('2026-09-19T21:30:00.000Z')
  })
})

describe('диалог напоминания', () => {
  it('выбор времени уходит наверх моментом ISO', async () => {
    const wrapper = mountDialog()

    await wrapper.findAll('.reminder-row')[0]!.trigger('click')

    const emitted = wrapper.emitted('save')
    expect(emitted).toHaveLength(1)
    // Момент в будущем и разбирается как дата (сервер ждёт ISO).
    expect(Number.isNaN(new Date(String(emitted![0]![0])).getTime())).toBe(false)
  })

  it('без напоминания кнопки «Убрать» нет — обещать нечего', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('.reminder-row.danger').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Убрать напоминание')
  })

  it('с напоминанием показывает срок и умеет его снять', async () => {
    const wrapper = mountDialog(reminder())

    expect(wrapper.find('.reminder-current').text()).toContain('Напоминание уже стоит')
    const remove = wrapper.find('.reminder-row.danger')
    expect(remove.exists()).toBe(true)

    await remove.trigger('click')

    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})

describe('подключение напоминаний', () => {
  it('сервис умеет поставить, прочитать и снять напоминание', () => {
    expect(service).toContain('api.post<MessageReminder>(`/messages/${messageId}/reminder/`')
    expect(service).toContain("api.get<MessageReminder[]>('/messages/reminders/'")
    expect(service).toContain('api.delete(`/messages/reminders/${reminderId}/`)')
  })

  it('пункт «Напомнить» есть и в меню по наведению, и в листе действий', () => {
    expect(bar).toContain("emit('remind')")
    expect(sheet).toContain("ctxAction('remind')")
    // У сообщения с напоминанием подпись меняется: человек видит, что «будильник» стоит.
    expect(bar).toContain("hasReminder ? 'Изменить напоминание' : 'Напомнить'")
    expect(sheet).toContain("hasReminder ? 'Изменить напоминание' : 'Напомнить'")
  })

  it('время сообщения помечается значком, если напоминание стоит', () => {
    expect(row).toContain('msg-reminder')
    expect(row).toContain(':has-reminder="Boolean(reminderAt)"')
    // Лента сама раздаёт строке время напоминания (функция, как `quoteOf`).
    expect(thread).toContain(':reminder-at="reminderAtOf(item.row.message)"')
    expect(thread).toContain("(e: 'remind', message: Message): void")
  })

  it('чат подтягивает напоминания и сбрасывает их при переходе', () => {
    // Сама тема живёт в composable (мессенджер только связывает её с лентой и
    // плашкой ошибки), поэтому обращения к сервису ищем у владельца.
    expect(reminders).toContain('createMessageReminder(message.id, remindAt)')
    expect(reminders).toContain('cancelMessageReminder(existing.id)')
    expect(messenger).toContain('useMessageReminders(')
    expect(messenger).toContain('loadReminders(chatId)')
    expect(messenger).toContain('resetReminders()')
    expect(messenger).toContain('@remind="openReminderDialog"')
  })
})

/* ---------- Service worker: push о напоминании ---------- */

interface Captured {
  push?: (event: unknown) => void
  notificationclick?: (event: unknown) => void
}

interface Harness {
  sw: Captured
  notifications: { title: string; options: Record<string, unknown> }[]
  posted: Record<string, unknown>[]
  opened: string[]
  apiPosts: string[]
}

/**
 * Запускаем НАСТОЯЩИЙ код `public/sw.js` в песочнице (как в
 * `swCallNotification.spec.ts`): важно проверить поведение напоминания, а не
 * строки в файле.
 */
function loadServiceWorker(): Harness {
  const source = readFileSync('public/sw.js', 'utf8')
  const sw: Captured = {}
  const notifications: Harness['notifications'] = []
  const posted: Harness['posted'] = []
  const opened: string[] = []
  const apiPosts: string[] = []
  const client = {
    visibilityState: 'hidden',
    focus: () => undefined,
    postMessage: (data: Record<string, unknown>) => posted.push(data)
  }
  const self = {
    addEventListener: (type: keyof Captured, handler: never) => {
      sw[type] = handler
    },
    skipWaiting: () => undefined,
    clients: {
      claim: () => undefined,
      matchAll: async () => [client],
      openWindow: async (url: string) => {
        opened.push(url)
        return client
      }
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        notifications.push({ title, options })
      },
      getNotifications: async () => []
    },
    location: { origin: 'https://pismo.space' },
    navigator: {}
  }
  const cache = {
    match: async () => undefined,
    put: async () => undefined,
    delete: async () => true,
    keys: async () => [],
    addAll: async () => undefined
  }
  const context = {
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async (path: string, init?: { method?: string }) => {
      if ((init?.method || 'GET') === 'POST') apiPosts.push(String(path))
      return { ok: true, status: 200, json: async () => ({}), clone: () => ({}) }
    },
    Response: { error: () => ({ ok: false }) },
    URL,
    console,
    navigator: self.navigator
  }
  const factory = new Function(...Object.keys(context), `"use strict";\n${source}`)
  factory(...Object.values(context))
  return { sw, notifications, posted, opened, apiPosts }
}

function pushEvent(data: Record<string, unknown>) {
  const waits: Promise<unknown>[] = []
  return {
    data: { json: () => ({ title: 'Напоминание', body: 'Чат «Мама»: счёт', data }) },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    waits
  }
}

function clickEvent(action: string, data: Record<string, unknown>) {
  const waits: Promise<unknown>[] = []
  return {
    action,
    notification: { tag: '', data, close: () => undefined },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    waits
  }
}

describe('service worker: напоминание о сообщении', () => {
  let harness: Harness

  beforeEach(() => {
    harness = loadServiceWorker()
  })

  it('показывает уведомление со своим тегом и без кнопок', async () => {
    const event = pushEvent({
      type: 'reminder',
      reminder_id: 5,
      chat_id: 3,
      message_id: 42
    })
    harness.sw.push?.(event)
    await Promise.all(event.waits)

    expect(harness.notifications).toHaveLength(1)
    const options = harness.notifications[0]!.options
    // Кнопки «Ответить»/«Отметить прочитанным» здесь не нужны: новых сообщений нет.
    expect(options.actions).toBeUndefined()
    // Своё напоминание — своё уведомление: тег по id, иначе два напоминания
    // об одном чате затирали бы друг друга.
    expect(options.tag).toBe('reminder-5')
  })

  it('тап открывает приложение в этом чате', async () => {
    const event = clickEvent('focus', {
      type: 'reminder',
      reminder_id: 5,
      chat_id: 3,
      message_id: 42
    })
    harness.sw.notificationclick?.(event)
    await Promise.all(event.waits)

    expect(harness.posted).toEqual([
      { type: 'open-chat', chat_id: 3, message_id: 42, reply: false }
    ])
    // «Отметить прочитанным» напоминание не трогает — это не новое сообщение.
    expect(harness.apiPosts).toEqual([])
  })
})
