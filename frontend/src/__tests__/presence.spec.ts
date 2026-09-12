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
    FakeWebSocket.instances = []
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket
    })
  })

  it('держится на heartbeat: раз в 25 секунд уходит ping', async () => {
    const realtime = useRealtimeStore()
    useAuthStore().$patch({ accessToken: 'test-token' })

    // `connect()` поднимает опрос готовности через таймеры — с фейковыми
    // таймерами его нельзя `await`-ить, поэтому просто двигаем время.
    void realtime.connect()
    await vi.advanceTimersByTimeAsync(200)
    const socket = FakeWebSocket.instances[0]
    expect(socket?.readyState).toBe(FakeWebSocket.OPEN)

    await vi.advanceTimersByTimeAsync(25_000)
    expect(socket.messages).toEqual([{ type: 'ping' }])

    // Дальше — с той же частотой, без дублей.
    await vi.advanceTimersByTimeAsync(25_000)
    expect(socket.messages).toEqual([{ type: 'ping' }, { type: 'ping' }])

    realtime.disconnect()
  })

  it('прощается перед уходом со страницы — собеседник сразу видит «не в сети»', async () => {
    const realtime = useRealtimeStore()
    useAuthStore().$patch({ accessToken: 'test-token' })

    void realtime.connect()
    await vi.advanceTimersByTimeAsync(200)
    const socket = FakeWebSocket.instances[0]

    realtime.sayGoodbye()

    expect(socket.messages).toEqual([{ type: 'bye' }])
    realtime.disconnect()
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
