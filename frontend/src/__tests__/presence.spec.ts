/**
 * Присутствие: «в сети» не должно залипать.
 *
 * Симптом из жизни: собеседник закрыл приложение, а у нас он ещё «в сети» —
 * сервер узнавал об уходе только по таймауту прокси (минуты), потому что сокет
 * при убийстве приложения/уходе в сон не закрывается чисто.
 *
 * Поэтому клиент шлёт `ping` (сервер закрывает молчащий канал сам) и `bye`
 * при выгрузке страницы. Плюс проверка «экран ожидания звонка»: если звонка на
 * сервере уже нет, ждать его 25 секунд нельзя.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    api: { get: vi.fn(async () => ({ data: { pending: true } })) }
  }
})

import { api } from '@/services/api'
import { isCallStillPending } from '@/services/pendingCall'
import { useAuthStore } from '@/stores/auth'
import { useRealtimeStore } from '@/stores/realtime'
import { usePeerActivity } from '@/composables/usePeerActivity'
import { lastSeenLabel } from '@/utils/format'

/** Заглушка WebSocket: открывается на следующей задаче и помнит отправленное. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
    window.setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN
      this.onopen?.()
    }, 0)
  }

  send(data: string) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('socket is not open')
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  get messages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
  }
}

describe('событийный канал сообщает о том, что мы живы', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    // Сокет и таймеры живут в модуле стора и переживают тесты: закрываем старый
    // канал, иначе `connect()` переиспользует его и нового сокета не появится.
    useRealtimeStore().disconnect()
    FakeWebSocket.instances = []
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket
    })
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  /** Подключается и отдаёт сокет: `connect()` ждёт готовности таймерами. */
  async function open(): Promise<{
    realtime: ReturnType<typeof useRealtimeStore>
    socket: FakeWebSocket
  }> {
    const realtime = useRealtimeStore()
    useAuthStore().$patch({ accessToken: 'test-token' })
    void realtime.connect()
    await vi.advanceTimersByTimeAsync(200)
    const socket = FakeWebSocket.instances[0]
    expect(socket?.readyState).toBe(FakeWebSocket.OPEN)
    return { realtime, socket }
  }

  it('сразу говорит, что человек у экрана, и держится на heartbeat', async () => {
    const { realtime, socket } = await open()

    // Подключение само по себе не значит «в сети»: сообщаем состояние экрана.
    expect(socket.messages).toEqual([{ type: 'activity', active: true }])

    await vi.advanceTimersByTimeAsync(25_000)
    expect(socket.messages).toEqual([{ type: 'activity', active: true }, { type: 'ping' }])

    await vi.advanceTimersByTimeAsync(25_000)
    expect(socket.messages).toEqual([
      { type: 'activity', active: true },
      { type: 'ping' },
      { type: 'ping' }
    ])

    realtime.disconnect()
  })

  it('свёрнутое приложение сообщает «не в сети», развёрнутое — «в сети»', async () => {
    const { realtime, socket } = await open()

    // Свернули: не сразу, чтобы статус не мигал на быстрых переключениях окна.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    realtime.scheduleAway()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(socket.messages).toEqual([{ type: 'activity', active: true }])

    await vi.advanceTimersByTimeAsync(16_000)
    expect(socket.messages.at(-1)).toEqual({ type: 'activity', active: false })

    // Вернулись — сразу «в сети» и без отложенного «не в сети».
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    realtime.reportPresence()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(socket.messages.at(-1)).not.toEqual({ type: 'activity', active: false })
    expect(socket.messages.filter((m) => m.type === 'activity')).toEqual([
      { type: 'activity', active: true },
      { type: 'activity', active: false },
      { type: 'activity', active: true }
    ])

    realtime.disconnect()
  })

  it('переподключение в свёрнутом приложении не «включает» онлайн', async () => {
    const realtime = useRealtimeStore()
    useAuthStore().$patch({ accessToken: 'test-token' })
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })

    void realtime.connect()
    await vi.advanceTimersByTimeAsync(200)
    const socket = FakeWebSocket.instances[0]

    // Главное: сервер не должен увидеть «в сети» — иначе у собеседника статус
    // перекидывается с «был(а) только что» обратно на «в сети».
    expect(socket.messages).toEqual([{ type: 'activity', active: false }])

    realtime.disconnect()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('прощается перед уходом со страницы — собеседник сразу видит «не в сети»', async () => {
    const { realtime, socket } = await open()

    realtime.sayGoodbye()

    expect(socket.messages).toEqual([{ type: 'activity', active: true }, { type: 'bye' }])
    realtime.disconnect()
  })
})

describe('присутствие на клиенте: «в сети» приходит только по WS', () => {
  /** Изолированный scope: composable снимает таймеры при размонтировании. */
  const make = () => {
    const scope = effectScope()
    const activity = scope.run(() => usePeerActivity({ isMe: (id) => id === 1 }))!
    return { scope, activity }
  }

  it('затравка из /chats не включает «в сети», даже если активность секунду назад', () => {
    const { scope, activity } = make()
    // Симптом: собеседник свёрнул приложение, а у нас зелёная точка — потому что
    // `last_seen` освежался heartbeat-ом каждую минуту.
    activity.seedPresence(2, new Date().toISOString())

    expect(activity.peerPresence[2].online).toBe(false)
    expect(activity.peerPresence[2].last_seen).not.toBeNull()
    scope.stop()
  })

  it('снимок с сервера заменяет состояние целиком и не трогает мой статус', () => {
    const { scope, activity } = make()
    activity.applyPresence(2, true, null)
    activity.applyPresenceSnapshot([
      { user_id: 1, online: true, last_seen: null },
      { user_id: 2, online: false, last_seen: '2026-01-01T00:00:00+00:00' },
      { user_id: 3, online: true, last_seen: null }
    ])

    expect(activity.peerPresence[1]).toBeUndefined()
    expect(activity.peerPresence[2]).toEqual({
      online: false,
      last_seen: '2026-01-01T00:00:00+00:00'
    })
    expect(activity.peerPresence[3].online).toBe(true)
    scope.stop()
  })

  it('подпись времени никогда не превращается в «в сети» без разрешения', () => {
    const now = new Date().toISOString()
    expect(lastSeenLabel(now)).toBe('был(а) только что')
    expect(lastSeenLabel(now, false)).toBe('был(а) только что')
  })
})

describe('экран ожидания звонка спрашивает сервер, ждёт ли вызов', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('парковка есть — ждём звонок дальше', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { pending: true } } as never)
    expect(await isCallStillPending('call-1')).toBe(true)
    expect(api.get).toHaveBeenCalledWith('/calls/pending/', {
      params: { call_id: 'call-1' }
    })
  })

  it('звонок уже решён — экран закрывается сразу', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { pending: false } } as never)
    expect(await isCallStillPending('call-1')).toBe(false)
  })

  it('нет сети — не мешаем человеку обычным ожиданием', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network'))
    expect(await isCallStillPending('call-1')).toBe(null)
  })

  it('без номера вызова спрашивать нечего', async () => {
    vi.mocked(api.get).mockClear()
    expect(await isCallStillPending('')).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
  })
})
