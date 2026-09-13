/**
 * Звонок человеку, у которого приложение закрыто.
 *
 * Проверяем две вещи:
 *
 * 1. Подсказки зовущему, когда абонент не в сети: вызов паркуется на сервере, и
 *    человек получает его, как только откроет приложение. Если у абонента
 *    выключены уведомления — сервер говорит об этом (`notified: false`), и
 *    подсказка должна это отражать, а не обещать push.
 * 2. Web Push-подписка приводится к актуальному VAPID-ключу: подписка под старый
 *    ключ молча не работает (push-сервис отклоняет запросы), и уведомления о
 *    звонке при закрытом приложении не приходят, хотя сервер считает, что канал
 *    есть.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: {
      get: vi.fn(async () => ({ data: { public_key: 'SERVER_KEY' } })),
      post: vi.fn(async () => ({ data: {} }))
    }
  }
})

import { api } from '@/services/api'
import { useCallStore } from '@/stores/call'
import { enablePushNotifications, showIncomingCallRing } from '@/services/pwa'

describe('абонент не в сети: вызов ждёт его в приложении', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('подсказка отличает отправленное уведомление от выключенных уведомлений', () => {
    const store = useCallStore()
    store.$patch({ status: 'outgoing', callId: 'call-1', peerId: 7 })

    store._handleMessage({ type: 'call-parked', call_id: 'call-1', notified: true })
    expect(store.notice).toContain('уведомление')
    // Звонок при этом продолжает идти — ждём, что человек откроет приложение.
    expect(store.status).toBe('outgoing')

    store._handleMessage({ type: 'call-parked', call_id: 'call-1', notified: false })
    expect(store.notice).toContain('ждёт')
    expect(store.notice).toContain('уведомлени')
  })
})

/** Байты ключа из base64url (как их отдаёт сервер). */
function keyBytes(base64Url: string): ArrayBuffer {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = window.atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

/** Текущий VAPID-ключ сервера и подписка, оставшаяся под прежний (24 байта). */
const SERVER_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const OLD_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8A'

/** Заглушка браузерного Push API с подпиской под указанный ключ. */
function stubPushApi(subscriptionKey: string | null) {
  const unsubscribe = vi.fn(async () => true)
  const subscribe = vi.fn(async () => ({
    toJSON: () => ({
      endpoint: 'https://push.example/new',
      keys: { p256dh: 'p256dh', auth: 'auth' }
    })
  }))
  const subscription = subscriptionKey
    ? {
        options: { applicationServerKey: keyBytes(subscriptionKey) },
        toJSON: () => ({
          endpoint: 'https://push.example/old',
          keys: { p256dh: 'p256dh', auth: 'auth' }
        }),
        unsubscribe
      }
    : null

  const ready = Promise.resolve({
    pushManager: {
      getSubscription: vi.fn(async () => subscription),
      subscribe
    }
  })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready } })
  Object.defineProperty(globalThis, 'PushManager', { configurable: true, value: class {} })
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }
  })
  return { unsubscribe, subscribe }
}

describe('уведомление о звонке из приложения (приложение свёрнуто)', () => {
  /** Заглушка service worker: запоминает показанное уведомление. */
  function stubNotifications() {
    const shown: { title: string; options: Record<string, unknown> }[] = []
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          showNotification: async (title: string, options: Record<string, unknown>) => {
            shown.push({ title, options })
          }
        })
      }
    })
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }
    })
    // Разрешения хватает мало: `getPushPermission` считает браузер неподходящим
    // без Push API, и уведомление тогда просто не показывается.
    Object.defineProperty(globalThis, 'PushManager', { configurable: true, value: class {} })
    return shown
  }

  it('раскладка кнопок совпадает с push-уведомлением (одна — «Открыть»)', async () => {
    const shown = stubNotifications()

    await showIncomingCallRing({
      title: 'Аня',
      body: 'Входящий звонок',
      callId: 'call-1',
      peerId: 5
    })

    expect(shown).toHaveLength(1)
    // Одна кнопка, как в sw.js: разная раскладка в двух местах ломала звонки
    // (отказ выполнялся при нажатии на «Ответить»). Кнопка ничего не решает
    // за человека — только открывает экран звонка, где есть обе кнопки.
    expect(shown[0].options.actions).toEqual([{ action: 'open', title: 'Открыть' }])
    // Уведомление держится на экране и относится к конкретному вызову — по тегу
    // его закрывает service worker, когда звонок перестал звонить.
    expect(shown[0].options.tag).toBe('call-call-1')
    expect(shown[0].options.requireInteraction).toBe(true)
  })
})

describe('Web Push-подписка под старый ключ', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: { public_key: SERVER_KEY } } as never)
    vi.mocked(api.post).mockClear()
  })

  it('пересоздаётся и заново регистрируется на сервере', async () => {
    const { unsubscribe, subscribe } = stubPushApi(OLD_KEY)

    expect(await enablePushNotifications()).toBe('granted')

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(api.post).toHaveBeenCalledWith('/push/subscribe/', {
      endpoint: 'https://push.example/new',
      p256dh: 'p256dh',
      auth: 'auth'
    })
  })

  it('при совпадении ключа подписка не пересоздаётся, но остаётся на сервере', async () => {
    const { unsubscribe, subscribe } = stubPushApi(SERVER_KEY)

    expect(await enablePushNotifications()).toBe('granted')

    expect(unsubscribe).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(api.post).toHaveBeenCalledWith('/push/subscribe/', {
      endpoint: 'https://push.example/old',
      p256dh: 'p256dh',
      auth: 'auth'
    })
  })

  it('без подписки создаётся новая под текущий ключ', async () => {
    const { subscribe } = stubPushApi(null)

    expect(await enablePushNotifications()).toBe('granted')
    expect(subscribe).toHaveBeenCalledTimes(1)
  })
})

/**
 * Запуск по уведомлению разбирается в SFC, поэтому проверяем контракт по
 * исходнику: если эти связки пропадут, звонок при закрытом приложении снова
 * начнёт «не отвечаться».
 */
describe('запуск звонка из уведомления (приложение закрыто)', () => {
  const messenger = readFileSync('src/views/Messenger.vue', 'utf8')
  // Логика запуска (экран ожидания, флаги «Ответить»/«Отклонить») живёт в
  // отдельном composable — проверяем её там, а разметку и разбор адреса — в SFC.
  const callSession = readFileSync('src/composables/useCallSession.ts', 'utf8')
  const nativePush = readFileSync('src/services/nativePush.ts', 'utf8')

  it('действие «Ответить» применяется и при холодном старте', () => {
    // Сессия восстанавливается из localStorage сразу, поэтому watcher готовности
    // (immediate) отрабатывает ДО разбора адреса: одного его мало — запуск
    // применяется ещё раз сразу после разбора `?call=…`.
    expect(callSession).toContain('const applyCallLaunch = ()')
    expect(messenger).toContain('beginCallLaunch(callIdParam, Number(peerIdParam), launchAction)')
    expect(messenger).toContain('applyCallLaunch()')
  })

  it('тап по уведомлению о звонке в Android открывает экран звонка', () => {
    // Раньше обрабатывался только chat_id, и звонок приходилось принимать вручную.
    expect(messenger).toContain("data.type === 'call'")
    expect(messenger).toContain('beginCallLaunch(callId, callPeerId, action)')
  })

  it('«Ответить» из системного уведомления работает, даже если offer ещё не пришёл', () => {
    // Канал мог отвалиться (телефон в фоне) — тогда ждём offer и отвечаем.
    expect(messenger).toContain("beginCallLaunch(callId, peerId, 'answer')")
  })

  it('цель перехода можно забрать запросом — событие может обогнать подписку', () => {
    expect(nativePush).toContain('openTargetInfo')
    expect(nativePush).toContain('readPendingOpenTarget')
  })

  it('на экране ожидания есть кнопка «Ответить», а не только «Отклонить»', () => {
    // Раньше единственной кнопкой была красная «Отклонить»: человек, открывший
    // приложение кнопкой «Ответить» в уведомлении, видел один «сброс» — и
    // принятие звонка выглядело как отказ.
    const screen = messenger.slice(messenger.indexOf('call-launch-wait'))
    expect(screen).toContain('clw-answer')
    expect(screen).toContain('clw-decline')
    expect(screen).toContain('@click="answerCallLaunch"')
    // «Ответить» до прихода offer = ждать его и ответить самому.
    expect(callSession).toContain('const answerCallLaunch = ()')
    expect(callSession).toContain('autoAnswerPending = true')
  })

  it('действие из уведомления не теряется, если offer уже пришёл', () => {
    // Экрана ожидания в этом случае нет, но и «выбросить» действие нельзя:
    // иначе «Ответить» из push ничего не делал бы, а звонок у зовущего доходил
    // до таймаута и записывался пропущенным.
    const launch = callSession.slice(callSession.indexOf('const beginCallLaunch = ('))
    const body = launch.slice(0, launch.indexOf('\n}'))
    expect(body).toContain("callStore.status === 'incoming'")
    expect(body).toContain('void callStore.acceptCall()')
    expect(body).toContain('callStore.declineCall()')
  })
})
