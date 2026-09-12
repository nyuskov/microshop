import { readFileSync } from 'node:fs'
import { describe, expect, it, beforeEach } from 'vitest'

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
  message?: (event: unknown) => void
}

interface Harness {
  sw: Captured
  calls: string[]
  notifications: { title: string; options: Record<string, unknown> }[]
  posted: Record<string, unknown>[]
  opened: string[]
  apiPosts: { path: string; body: unknown }[]
  token: string | null
}

function loadServiceWorker(): Harness {
  const source = readFileSync('public/sw.js', 'utf8')
  const sw: Captured = {}
  const calls: string[] = []
  const notifications: Harness['notifications'] = []
  const posted: Harness['posted'] = []
  const opened: string[] = []
  const apiPosts: Harness['apiPosts'] = []
  const harness: Harness = {
    sw,
    calls,
    notifications,
    posted,
    opened,
    apiPosts,
    token: 'test-token'
  }

  const client = {
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
        calls.push('showNotification')
      },
      getNotifications: async () => []
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
      return { ok: true, status: 200, json: async () => ({}), clone: () => ({}) }
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
    notification: { data, close: () => undefined },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    waits,
    openWindows
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
  })

  it('«Ответить» не отклоняет звонок, а отдаёт действие странице', async () => {
    const event = clickEvent('answer', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(event)
    await Promise.all(event.waits)

    // Главное: серверный отказ не вызывается.
    expect(harness.apiPosts.map((post) => post.path)).not.toContain('/api/v1/calls/decline/')
    expect(harness.posted).toEqual([
      { type: 'call-notification', action: 'answer', call_id: 'call-1', peer_id: 5 }
    ])
    expect(harness.opened).toEqual([])
  })

  it('«Отклонить» отклоняет звонок и на сервере, и в приложении', async () => {
    const event = clickEvent('decline', { type: 'call', call_id: 'call-1', peer_id: 5 })
    harness.sw.notificationclick?.(event)
    await Promise.all(event.waits)

    expect(harness.apiPosts).toEqual([
      { path: '/api/v1/calls/decline/', body: { call_id: 'call-1', to_user_id: 5 } }
    ])
    expect(harness.posted).toEqual([
      { type: 'call-notification', action: 'decline', call_id: 'call-1', peer_id: 5 }
    ])
    expect(harness.opened).toEqual([])
  })
})
