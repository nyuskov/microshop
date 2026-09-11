/**
 * «Звонок установлен, а звука и видео нет» — чиним сами.
 *
 * Симптом: соединение считается установленным, но собеседника не слышно (или
 * чёрный экран), и помогает только ручное переключение 4G↔Wi-Fi — то есть
 * перезапуск ICE. Здесь проверяем, что стор делает это без человека: смотрит
 * принятые RTP-байты и, если их нет, пересогласует соединение.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/iceServers', () => ({
  fetchIceServers: vi.fn(async () => [])
}))

import { useAuthStore } from '@/stores/auth'
import { useCallStore } from '@/stores/call'

/** Заглушка WebSocket: открывается по таймеру, запоминает отправленное. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
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
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  get messages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
  }
}

/** Статистика соединения: пакеты «от собеседника» (или их отсутствие). */
const statsWith = (bytesReceived: number) =>
  new Map<string, { type: string; bytesReceived: number }>([
    ['inbound-rtp-audio', { type: 'inbound-rtp', bytesReceived }]
  ])

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  iceConnectionState = 'connected'
  connectionState = 'connected'
  onicecandidate: ((event: unknown) => void) | null = null
  ontrack: ((event: unknown) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  addTrack = vi.fn()
  close = vi.fn()
  getSenders = () => []
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }))
  setLocalDescription = vi.fn(async () => undefined)
  setRemoteDescription = vi.fn(async () => undefined)
  restartIce = vi.fn()
  /** Вариант звонящего: он первым отвечает на offer собеседника. */
  createOffer = vi.fn(async (options?: { iceRestart?: boolean }) => ({
    type: 'offer',
    sdp: options?.iceRestart ? 'restart-sdp' : 'offer-sdp'
  }))
  getStats = vi.fn(async () => statsWith(0))

  constructor() {
    FakePeerConnection.instances.push(this)
  }
}

const fakeStream = () => ({ getTracks: () => [] as MediaStreamTrack[] })

const stubMedia = () => {
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: FakePeerConnection
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => fakeStream()),
      enumerateDevices: vi.fn(async () => [])
    }
  })
}

/** Заводит исходящий звонок и «получает ответ» — звонок становится активным. */
const startActiveCall = async () => {
  const store = useCallStore()
  const started = store.startCall({ id: 9, name: '@9' }, 'audio')
  await vi.advanceTimersByTimeAsync(200)
  await started
  store._handleMessage({
    type: 'call-answer',
    from_user_id: 9,
    call_id: store.callId ?? '',
    sdp: 'answer-sdp'
  })
  expect(store.status).toBe('active')
  return store
}

const peer = () => FakePeerConnection.instances[FakePeerConnection.instances.length - 1]

describe('медиа не пошло — перезапускаем ICE сами', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    FakeWebSocket.instances = []
    FakePeerConnection.instances = []
    const auth = useAuthStore()
    auth.isAuthenticated = true
    auth.accessToken = 'test-token'
    stubMedia()
  })

  afterEach(() => {
    useCallStore()._cleanup()
    vi.useRealTimers()
  })

  it('звука/видео нет — соединение пересогласуется автоматически', async () => {
    const store = await startActiveCall()
    const pc = peer()
    expect(pc?.getStats).toBeDefined()

    // Первые проверки: медиа нет (байтов не пришло).
    await vi.advanceTimersByTimeAsync(7000)

    expect(pc?.restartIce).toHaveBeenCalled()
    expect(pc?.createOffer).toHaveBeenCalledWith({ iceRestart: true })
    const renegotiate = FakeWebSocket.instances[0].messages.find(
      (message) => message.type === 'call-renegotiate'
    )
    expect(renegotiate).toMatchObject({ call_id: store.callId, sdp: 'restart-sdp' })
  })

  it('медиа идёт — ничего не трогаем', async () => {
    await startActiveCall()
    const pc = peer()
    pc?.getStats.mockImplementation(async () => statsWith(4096))

    await vi.advanceTimersByTimeAsync(12_000)

    expect(pc?.createOffer).not.toHaveBeenCalledWith({ iceRestart: true })
  })

  it('без статистики соединение не трогаем (старый браузер)', async () => {
    await startActiveCall()
    const pc = peer()
    if (pc) Object.defineProperty(pc, 'getStats', { configurable: true, value: undefined })

    await vi.advanceTimersByTimeAsync(12_000)

    expect(pc?.createOffer).not.toHaveBeenCalledWith({ iceRestart: true })
  })

  it('не помогло — предупреждаем, но звонок не рвём', async () => {
    const store = await startActiveCall()
    const pc = peer()

    // Три попытки починиться (порог 2 проверки у зовущего) — и предупреждение.
    await vi.advanceTimersByTimeAsync(30_000)

    expect(store.status).toBe('active')
    expect(store.notice).toContain('переключить сеть')
    expect(pc?.createOffer).toHaveBeenCalledWith({ iceRestart: true })
  })
})
