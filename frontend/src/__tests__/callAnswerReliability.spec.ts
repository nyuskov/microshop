/**
 * Приём звонка не должен «зависать» на стороне зовущего.
 *
 * Баг: собеседник нажимает «Ответить», а у зовущего звонок продолжает звонить.
 * Причины, которые здесь закрыты:
 *
 * 1. сигнальный канал у отвечающего был закрыт (телефон в фоне, смена сети) —
 *    `sendMessage` молча терял ответ;
 * 2. ответить не удалось (нет доступа к камере/микрофону) — собеседник уходил в
 *    «idle» без единого сообщения, а зовущий звонил до таймаута;
 * 3. ответ потерялся по дороге — повторная отправка не должна ломать звонящего.
 *
 * WebRTC и WebSocket в jsdom отсутствуют, поэтому подменяем их заглушками:
 * проверяем логику стора и то, что реально уходит в сигнальный канал.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/iceServers', () => ({
  fetchIceServers: vi.fn(async () => [])
}))

import { useAuthStore } from '@/stores/auth'
import { useCallStore } from '@/stores/call'

/** Заглушка WebSocket: помним отправленное и открываемся на следующей задаче. */
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

  /** Разбор отправленных сигнальных сообщений. */
  get messages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
  }

  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    if (!socket) throw new Error('сигнальный канал не открывался')
    return socket
  }
}

/** Заглушка RTCPeerConnection: помним, сколько раз приняли удалённый SDP. */
class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  iceConnectionState = 'new'
  connectionState = 'new'
  remoteDescriptions = 0
  onicecandidate: ((event: unknown) => void) | null = null
  ontrack: ((event: unknown) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  addTrack = vi.fn()
  close = vi.fn()
  getSenders = () => []
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' }))
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }))
  setLocalDescription = vi.fn(async () => undefined)
  restartIce = vi.fn()

  setRemoteDescription = vi.fn(async (description: { sdp?: string }) => {
    this.remoteDescriptions += 1
    // Браузер отвергает неприменимый ответ («wrong state»/битый SDP) — это не
    // должно ломать обработку: обещание обязано быть пойманным.
    if (description?.sdp === 'bad') throw new Error('Called in wrong state')
  })

  constructor() {
    FakePeerConnection.instances.push(this)
  }
}

const fakeStream = () => ({
  getTracks: () => [] as MediaStreamTrack[],
  getAudioTracks: () => [],
  getVideoTracks: () => [],
  addTrack: vi.fn(),
  removeTrack: vi.fn()
})

const stubMedia = (getUserMedia: ReturnType<typeof vi.fn>) => {
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
      getUserMedia,
      enumerateDevices: vi.fn(async () => [])
    }
  })
}

const incomingOffer = (callId = 'call-1', from = 7) => ({
  type: 'call-offer' as const,
  from_user_id: from,
  call_id: callId,
  kind: 'audio' as const,
  sdp: 'v=0'
})

describe('приём звонка: ответ должен дойти до зовущего', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    FakeWebSocket.instances = []
    FakePeerConnection.instances = []
    window.sessionStorage.clear()
    const auth = useAuthStore()
    auth.isAuthenticated = true
    auth.accessToken = 'test-token'
  })

  afterEach(() => {
    const store = useCallStore()
    store.disconnect()
    store._cleanup()
  })

  it('ответ отправляется, даже если сигнальный канал был закрыт', async () => {
    stubMedia(vi.fn(async () => fakeStream()))
    const store = useCallStore()
    // Offer пришёл, пока канал был жив, но затем связь отвалилась.
    store._handleMessage(incomingOffer())
    expect(store.status).toBe('incoming')

    await store.acceptCall()

    const socket = FakeWebSocket.last()
    const answer = socket.messages.find((message) => message.type === 'call-answer')
    expect(answer).toMatchObject({ call_id: 'call-1', to_user_id: 7, sdp: 'answer-sdp' })
    expect(store.status).toBe('active')
  })

  it('если ответить не удалось — собеседнику уходит отказ, а не тишина', async () => {
    stubMedia(vi.fn(async () => Promise.reject(new Error('NotAllowedError'))))
    const store = useCallStore()
    store._handleMessage(incomingOffer('call-2'))

    await store.acceptCall()

    const socket = FakeWebSocket.last()
    const decline = socket.messages.find((message) => message.type === 'call-decline')
    expect(decline).toMatchObject({ call_id: 'call-2', to_user_id: 7, reason: 'failed' })
    // Локально звонка уже нет — зовущий получает внятный отказ вместо таймаута.
    expect(store.status).toBe('idle')
  })

  it('повторный/неприменимый ответ не ломает звонящего: он становится активным', async () => {
    stubMedia(vi.fn(async () => fakeStream()))
    const store = useCallStore()
    await store.startCall({ id: 9, name: '@9' }, 'audio')
    expect(store.status).toBe('outgoing')

    const callId = store.callId ?? ''
    const answer = (sdp: string) => ({
      type: 'call-answer' as const,
      from_user_id: 9,
      call_id: callId,
      sdp
    })
    store._handleMessage(answer('bad'))
    expect(store.status).toBe('active')

    // Второй (продублированный) ответ уже не применяется — состояние не «дёргается».
    store._handleMessage(answer('answer-sdp'))
    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1]
    expect(pc?.remoteDescriptions).toBe(1)
    expect(store.status).toBe('active')
  })
})
