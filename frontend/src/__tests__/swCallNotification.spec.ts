import { readFileSync } from 'node:fs'
import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * Проверки service worker ЗАПУСКОМ его кода (а не чтением исходника).
 *
 * `public/sw.js` не модуль: он ждёт глобальный `self` с API service worker'а.
 * Здесь подставляем минимальную заглушку, ловим зарегистрированные обработчики
 * и вручную шлём `push` и `notificationclick` — так видно, что реально делает
 * каждая кнопка уведомления, а не то, что написано в комментарии.
 *
 * Зачем: кнопки уведомления о звонке («Ответить»/«Отклонить») — единственный
 * способ принять звонок из закрытого приложения, и перепутать их действия очень
 * легко (одна строка в другом месте — и «принять» отклоняет).
 */

interface Captured {
  push?: (event: unknown) => void
  notificationclick?: (event: unknown) => void
  notificationclose?: (event: unknown) => void
  message?: (event: unknown) => void
}

interface Harness {
  sw: Captured
  calls: string[]
  notifications: { title: string; options: Record<string, unknown> }[]
  posted: Record<string, unknown>[]
  opened: string[]
  apiPosts: { path: string; body: unknown }[]
  /** Что сейчас «висит» на экране устройства (как в настоящем браузере). */
  displayed: { tag: string; closed: boolean }[]
  token: string | null
  /** Сделать окно невидимым (приложение свёрнуто). */
  hideClient: () => void
  /** Сделать окно видимым (приложение открыто перед человеком). */
  showClient: () => void
  /** Что отвечает сервер на `GET /calls/pending/` (ждёт ли ещё вызов). */
  callPending: boolean
}

function loadServiceWorker(): Harness {
  const source = readFileSync('public/sw.js', 'utf8')
  const sw: Captured = {}
  const calls: string[] = []
  const notifications: Harness['notifications'] = []
  const posted: Harness['posted'] = []
  const opened: string[] = []
  const apiPosts: Harness['apiPosts'] = []
  const displayed: Harness['displayed'] = []
  // По умолчанию окно скрыто: push о звонке приходит тогда, когда человек в
  // другом приложении. Открытое окно проверяем отдельно (`showClient`).
  const clientState = { visibilityState: 'hidden' }
  const harness: Harness = {
    sw,
    calls,
    notifications,
    posted,
    opened,
    apiPosts,
    displayed,
    token: 'test-token',
    hideClient: () => {
      clientState.visibilityState = 'hidden'
    },
    showClient: () => {
      clientState.visibilityState = 'visible'
    },
    callPending: true
  }

  const client = {
    get visibilityState() {
      return clientState.visibilityState
    },
    focus: () => calls.push('client.focus'),
    postMessage: (data: Record<string, unknown>) => posted.push(data)
  }

  const self = {
    addEventListener: (type: keyof Captured, handler: never) => {
      sw[type] = handler
    },
    skipWaiting: () => calls.push('skipWaiting'),
    clients: {
      claim: () => calls.push('clients.claim'),
      matchAll: async () => [client],
      openWindow: async (url: string) => {
        opened.push(url)
        calls.push('openWindow')
        return client
      }
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        notifications.push({ title, options })
        // Показанное уведомление остаётся на экране, пока его не закроют: так
        // же ведёт себя браузер (см. getNotifications ниже).
        displayed.push({ tag: String(options.tag || ''), closed: false })
        calls.push('showNotification')
      },
      getNotifications: async () =>
        displayed
          .filter((item) => !item.closed)
          .map((item) => ({
            tag: item.tag,
            close: () => {
              item.closed = true
              calls.push('notification.close')
            }
          }))
    },
    location: { origin: 'https://pismo.space' },
    navigator: {}
  }

  const cache = {
    match: async () =>
      harness.token === null ? undefined : { text: async () => harness.token as string },
    put: async () => undefined,
    delete: async () => true,
    keys: async () => [],
    addAll: async () => undefined
  }

  const context = {
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async (path: string, init?: { method?: string; body?: string }) => {
      calls.push(`fetch ${init?.method || 'GET'} ${path}`)
      if ((init?.method || 'GET') === 'POST') {
        apiPosts.push({ path, body: init?.body ? JSON.parse(init.body) : null })
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          String(path).includes('/calls/pending/') ? { pending: harness.callPending } : {},
        clone: () => ({})
      }
    },
    Response: { error: () => ({ ok: false }) },
    URL,
    console,
    navigator: self.navigator
  }

  // Код service worker — от `self`; аргументы даём явно, без eval-магии.
  const run = new Function(
    ...Object.keys(context),
    `${source}\nreturn { push: self.__handlers?.push, notificationclick: self.__handlers?.notificationclick }`
  )
  void run
  // Заглушка выше не нужна: обработчики складывает сам self.addEventListener.
  const factory = new Function(...Object.keys(context), `"use strict";\n${source}`)
  factory(...Object.values(context))
  return harness
}

/** Событие push с данными уведомления. */
function pushEvent(data: Record<string, unknown>, payload: Record<string, unknown> = {}) {
  const waits: Promise<unknown>[] = []
  return {
    data: { json: () => ({ ...payload, data }) },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    waits
  }
}

/** Событие клика по уведомлению с указанным действием. */
function clickEvent(action: string, data: Record<string, unknown>, openWindows = true) {
  const waits: Promise<unknown>[] = []
  return {
    action,
    notification: { tag: data.tag || '', data, close: () => undefined },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    waits,
    openWindows
  }
}

/** Событие закрытия уведомления (в том числе смахивание человеком). */
function closeEvent(tag: string, data: Record<string, unknown>) {
  const waits: Promise<unknown>[] = []
  return {
    notification: { tag, data, close: () => undefined },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    waits
  }
}

describe('service worker: кнопки уведомления о звонке', () => {
  let harness: Harness

  beforeEach(() => {
    harness = loadServiceWorker()
  })

  it('в уведомлении о звонке две кнопки: «Ответить» и «Отклонить»', async () => {
    const event = pushEvent({
      type: 'call',
      call_id: 'call-1',
      peer_id: 5,
      expires_at: Date.now() + 60_000
    })
    harness.sw.push?.(event)
    await Promise.all(event.waits)

    expect(harness.notifications).toHaveLength(1)
    expect(harness.notifications[0].options.actions).toEqual([
      { action: 'answer', title: 'Ответить' },
      { action: 'decline', title: 'Отклонить' }
    ])
    expect(harness.notifications[0].options.requireInteraction).toBe(true)
  })

  it('«Ответить» из старого уведомления отдаёт действие странице, а не отказ', async () => {
    harness.showClient()
    const event = clickEvent('answer', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(event)
    await Promise.all(event.waits)

    // Главное: серверный отказ не вызывается НИКОГДА.
    expect(harness.apiPosts.map((post) => post.path)).not.toContain('/api/v1/calls/decline/')
    expect(harness.posted).toEqual([
      { type: 'call-notification', action: 'answer', call_id: 'call-1', peer_id: 5 }
    ])
    expect(harness.opened).toEqual([])
  })

  it('«Отклонить»: показывает экран звонка и отклоняет вызов, если не ответили', async () => {
    vi.useFakeTimers()
    harness.showClient()
    const event = clickEvent('decline', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(event)
    await vi.advanceTimersByTimeAsync(100)

    // Сначала человек видит звонок: на Android «Отклонить» может прийти от нажатия
    // на «Ответить», и молчаливый отказ убил бы звонок, который хотели принять.
    expect(harness.posted).toEqual([
      { type: 'call-notification', action: 'focus', call_id: 'call-1', peer_id: 5 }
    ])
    expect(harness.apiPosts).toEqual([])

    await vi.advanceTimersByTimeAsync(7000)
    await Promise.all(event.waits)

    expect(harness.apiPosts).toEqual([
      { path: '/api/v1/calls/decline/', body: { call_id: 'call-1', to_user_id: 5 } }
    ])
    vi.useRealTimers()
  })

  it('«Отклонить» не отклоняет звонок, если человек успел ответить', async () => {
    vi.useFakeTimers()
    harness.showClient()
    const event = clickEvent('decline', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(event)
    await vi.advanceTimersByTimeAsync(100)

    // Кнопку «Ответить» система отдала как «Отклонить», человек ответил на
    // открывшемся экране — сервер больше этот вызов не ждёт.
    harness.callPending = false
    await vi.advanceTimersByTimeAsync(7000)
    await Promise.all(event.waits)

    expect(harness.apiPosts).toEqual([])
    vi.useRealTimers()
  })

  it('«Отклонить» по уже завершённому звонку ничего не делает', async () => {
    harness.callPending = false
    const event = clickEvent('decline', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(event)
    await Promise.all(event.waits)

    expect(harness.apiPosts).toEqual([])
    expect(harness.opened).toEqual([])
  })

  it('свёрнутое приложение открывается по адресу звонка (сообщение в фон теряется)', async () => {
    harness.hideClient()
    const event = clickEvent('answer', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(event)
    await Promise.all(event.waits)

    // Замороженной странице postMessage может не дойти — вместо этого открываем
    // (или фокусируем) окно с адресом звонка: экран появится после загрузки.
    expect(harness.opened).toEqual(['/?call=call-1&peer=5&action=answer'])
    expect(harness.apiPosts.map((post) => post.path)).not.toContain('/api/v1/calls/decline/')
  })

  it('смахивание уведомления отклоняет звонок', async () => {
    vi.useFakeTimers()
    const event = closeEvent('call-call-1', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclose?.(event)
    // Смахивание закрывает уведомление без клика: другого способа отказать, не
    // открывая приложение, у человека нет.
    await vi.advanceTimersByTimeAsync(4000)
    await Promise.all(event.waits)

    expect(harness.apiPosts).toEqual([
      { path: '/api/v1/calls/decline/', body: { call_id: 'call-1', to_user_id: 5 } }
    ])
    // И окнам — тихий сигнал, иначе рингтон продолжит играть.
    expect(harness.posted).toEqual([
      { type: 'call-cancelled', call_id: 'call-1', reason: 'declined' }
    ])
    vi.useRealTimers()
  })

  it('смахивание уведомления уже принятого звонка ничего не отклоняет', async () => {
    harness.callPending = false
    const event = closeEvent('call-call-1', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclose?.(event)
    await Promise.all(event.waits)

    // Сервер уже не ждёт этот вызов (приняли в приложении, отменили, ответили на
    // другом устройстве) — отказ отправлять нечего.
    expect(harness.apiPosts).toEqual([])
    expect(harness.posted).toEqual([])
  })

  it('тап по уведомлению (и по кнопке «Ответить») не считается отказом', async () => {
    // Система сама убирает уведомление после тапа — закрытие не значит отказ.
    harness.showClient()
    const click = clickEvent('answer', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(click)
    const close = closeEvent('call-call-1', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclose?.(close)
    await Promise.all([...click.waits, ...close.waits])

    expect(harness.apiPosts.map((post) => post.path)).not.toContain('/api/v1/calls/decline/')
    expect(harness.posted).toEqual([
      { type: 'call-notification', action: 'answer', call_id: 'call-1', peer_id: 5 }
    ])
  })
})

describe('service worker: звонок больше не звонит', () => {
  let harness: Harness

  beforeEach(() => {
    harness = loadServiceWorker()
  })

  /** Показывает уведомление о входящем звонке (приложение закрыто). */
  async function ring(callId: string) {
    const event = pushEvent({
      type: 'call',
      call_id: callId,
      peer_id: 5,
      expires_at: Date.now() + 60_000
    })
    harness.sw.push?.(event)
    await Promise.all(event.waits)
  }

  it('уведомление вызова закрывается по тихому push и новое не показывается', async () => {
    await ring('call-1')
    expect(harness.displayed).toEqual([{ tag: 'call-call-1', closed: false }])

    // Звонок приняли на другом устройстве / отклонили / отменили: приходит
    // push без заголовка и текста.
    const cancel = pushEvent({ type: 'call-cancelled', call_id: 'call-1' })
    harness.sw.push?.(cancel)
    await Promise.all(cancel.waits)

    expect(harness.displayed[0].closed).toBe(true)
    // И никакого «Pismo» без текста на экране не появилось.
    expect(harness.notifications).toHaveLength(1)
    expect(harness.notifications[0].title).toBe('Pismo')
  })

  it('сообщает открытым окнам, что звонок завершился (экран не должен звонить вечно)', async () => {
    const cancel = pushEvent({ type: 'call-cancelled', call_id: 'call-1', reason: 'cancelled' })
    harness.sw.push?.(cancel)
    await Promise.all(cancel.waits)
    // Сообщение тихое: уведомления не показываем...
    expect(harness.notifications).toHaveLength(0)
    // ...но окно получает причину и само решает, гасить ли звонок.
    expect(harness.posted).toEqual([
      { type: 'call-cancelled', call_id: 'call-1', reason: 'cancelled' }
    ])
  })

  it('закрывает чужой вызов, но не трогает уведомления переписки', async () => {
    await ring('call-1')
    // Уведомление чата: его закрывать нельзя — сообщение никто не отменял.
    const message = pushEvent({ type: 'message', chat_id: 3 }, { title: 'Аня', body: 'привет' })
    harness.sw.push?.(message)
    await Promise.all(message.waits)
    expect(harness.displayed.map((item) => item.tag)).toEqual(['call-call-1', 'chat-3'])

    const cancel = pushEvent({ type: 'call-cancelled', call_id: 'call-9' })
    harness.sw.push?.(cancel)
    await Promise.all(cancel.waits)
    // call_id не совпал — ничего не закрыто.
    expect(harness.displayed.every((item) => !item.closed)).toBe(true)

    const cancelOwn = pushEvent({ type: 'call-cancelled', call_id: 'call-1' })
    harness.sw.push?.(cancelOwn)
    await Promise.all(cancelOwn.waits)
    expect(harness.displayed.find((item) => item.tag === 'call-call-1')?.closed).toBe(true)
    expect(harness.displayed.find((item) => item.tag === 'chat-3')?.closed).toBe(false)
  })

  it('без call_id снимает все уведомления о звонках', async () => {
    await ring('call-1')
    await ring('call-2')

    const cancel = pushEvent({ type: 'call-cancelled' })
    harness.sw.push?.(cancel)
    await Promise.all(cancel.waits)

    expect(harness.displayed.every((item) => item.closed)).toBe(true)
    expect(harness.notifications).toHaveLength(2)
  })
})
