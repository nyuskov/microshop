/**
 * Звонок не должен «слетать» при обновлении страницы.
 *
 * Перезагрузка (в том числе случайный жест «потянуть вниз» на телефоне) убивает
 * WebRTC: камера, микрофон и SDP живут в странице. Поэтому об идущем звонке
 * помним в sessionStorage, а после возврата поднимаем его заново: свежее
 * соединение + `call-rejoin` собеседнику, чтобы он пересогласовался.
 *
 * Здесь проверяем контракт памяти (что и когда запоминается/забывается), а не
 * сам WebRTC — его в jsdom нет.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/iceServers', () => ({
  fetchIceServers: vi.fn(async () => [])
}))

import { useAuthStore } from '@/stores/auth'
import { useCallStore } from '@/stores/call'
import { runtime } from '@/stores/call/signaling'

/** Исходник стора — для стражей, которые проверяют порядок действий. */
const store = readFileSync('src/stores/call.ts', 'utf8')

const STORAGE_KEY = 'pismo_call_session'

/** Заглушка RTCPeerConnection: в jsdom его нет, а нам важна логика стора. */
class FakePeerConnection {
  iceConnectionState = 'new'
  connectionState = 'new'
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
  setRemoteDescription = vi.fn(async () => undefined)
  restartIce = vi.fn()
}

/** Заглушка микрофона/камеры: дорожек нет, но поток «получен». */
const fakeStream = () => ({ getTracks: () => [], id: 'local-stream' })

const stubMedia = () => {
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: FakePeerConnection
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => fakeStream()),
      enumerateDevices: vi.fn(async () => [])
    }
  })
}

const storedCall = () => {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

describe('память об идущем звонке', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it('активный звонок запоминается с собеседником и режимом', () => {
    const store = useCallStore()
    store.$patch({
      status: 'active',
      callId: 'call-1',
      peerId: 7,
      kind: 'video',
      seconds: 42
    })
    store.rememberCall()

    const saved = storedCall()
    expect(saved.callId).toBe('call-1')
    expect(saved.peerId).toBe(7)
    expect(saved.kind).toBe('video')
    // Время разговора сохраняется: после перезагрузки счётчик продолжается.
    expect(Date.now() - saved.startedAt).toBeGreaterThan(41_000)
    // И звонок помечен «живым» — именно по этому времени решаем, поднимать ли его.
    expect(Date.now() - saved.touchedAt).toBeLessThan(2000)
  })

  it('без звонка ничего не записывается', () => {
    const store = useCallStore()
    store.rememberCall()
    expect(storedCall()).toBeNull()
  })

  it('завершённый звонок забывается — поднимать его после перезагрузки нельзя', () => {
    const store = useCallStore()
    store.$patch({ status: 'active', callId: 'call-2', peerId: 9, kind: 'audio' })
    store.rememberCall()
    expect(storedCall()).not.toBeNull()

    store._cleanup()
    expect(store.status).toBe('idle')
    expect(storedCall()).toBeNull()
  })

  it('без записи восстанавливать нечего', async () => {
    const store = useCallStore()
    store.connected = true
    expect(await store.recoverCallAfterReload()).toBe(false)
  })

  it('старую запись не поднимаем: звонок давно закончился', async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        callId: 'old',
        peerId: 3,
        kind: 'audio',
        startedAt: Date.now() - 10 * 60 * 1000,
        touchedAt: Date.now() - 10 * 60 * 1000
      })
    )
    const store = useCallStore()
    store.connected = true
    expect(await store.recoverCallAfterReload()).toBe(false)
  })

  it('долгий разговор поднимаем, если перезагрузились во время него', async () => {
    stubMedia()
    // Разговор идёт 25 минут, а последняя отметка «жив» — 5 секунд назад.
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        callId: 'call-long',
        peerId: 4,
        kind: 'audio',
        startedAt: Date.now() - 25 * 60 * 1000,
        touchedAt: Date.now() - 5_000
      })
    )
    const store = useCallStore()
    store.connected = true

    expect(await store.recoverCallAfterReload()).toBe(true)
    expect(store.status).toBe('active')
    // Счётчик продолжается с 25 минут, а не с нуля.
    expect(store.seconds).toBeGreaterThanOrEqual(25 * 60)

    store._cleanup()
  })

  it('восстанавливает звонок и продолжает счётчик времени', async () => {
    stubMedia()
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        callId: 'call-9',
        peerId: 5,
        kind: 'audio',
        startedAt: Date.now() - 20_000,
        touchedAt: Date.now() - 3_000
      })
    )
    const store = useCallStore()
    store.connected = true

    const recovered = await store.recoverCallAfterReload()
    expect({ recovered, notice: store.notice }).toEqual({ recovered: true, notice: '' })

    expect(store.status).toBe('active')
    expect(store.callId).toBe('call-9')
    expect(store.peerId).toBe(5)
    expect(store.kind).toBe('audio')
    // Разговор идёт дальше: время считается от исходного начала, а не с нуля.
    expect(store.seconds).toBeGreaterThanOrEqual(19)
    expect(store.reconnecting).toBe(true)
    // Запись снова на месте: ещё одна перезагрузка тоже не потеряет звонок.
    expect(storedCall()?.callId).toBe('call-9')

    store._cleanup()
    expect(storedCall()).toBeNull()
  })
})

/**
 * Перезагрузка во время ВЫЗОВА (ещё не ответили).
 *
 * Владелец, 24.09.2026: «а при созванивании проверь» — до этого памятка писалась
 * только для идущего разговора, и перезагрузка на фазе «звоним…/входящий» теряла
 * вызов целиком: собеседник продолжал звонить в тишину, а у перезагрузившегося не
 * оставалось ни экрана, ни следа. Проверено живьём на dev: обе стороны (и
 * звонящий, и принимающий) возвращаются, и разговор поднимается по ответу.
 */
describe('перезагрузка во время вызова (ещё звонит)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it('свой вызов запоминается, поднимается и шлёт собеседнику новое предложение', async () => {
    stubMedia()
    const first = useCallStore()
    first.$patch({ status: 'outgoing', callId: 'call-ring', peerId: 7, kind: 'audio' })
    first.rememberCall()
    expect(storedCall()?.ringing).toBe('outgoing')

    // Перезагрузка: то же хранилище, но чистый стор.
    setActivePinia(createPinia())
    const store = useCallStore()
    store.connected = true

    expect(await store.recoverCallAfterReload()).toBe(true)
    expect(store.status).toBe('outgoing')
    expect(store.callId).toBe('call-ring')
    // Прежний SDP мёртв вместе со страницей: собеседник ответит по НОВОМУ.
    const link = store._linkFor(7)
    expect(link?.pc.setLocalDescription).toHaveBeenCalled()
    // Свой вызов не показываем разговором, пока не ответят.
    expect(store.seconds).toBe(0)

    store._cleanup()
  })

  it('входящий возвращается экраном звонка — и медиа до ответа не берём', async () => {
    stubMedia()
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        callId: 'call-in',
        peerId: 9,
        kind: 'audio',
        startedAt: Date.now() - 4_000,
        touchedAt: Date.now() - 1_000,
        ringing: 'incoming',
        offerSdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n'
      })
    )
    const store = useCallStore()
    store.connected = true

    expect(await store.recoverCallAfterReload()).toBe(true)
    expect(store.status).toBe('incoming')
    expect(store.peerId).toBe(9)
    // Предложение собеседника лежит в памятке — по нему и ответим.
    expect(runtime.pendingOffer?.sdp).toContain('v=0')
    // Камеру и микрофон до ответа не включаем: человек ещё не согласился.
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()

    store._cleanup()
  })

  it('входящий без предложения поднимать нечем — говорим, что звонок завершён', async () => {
    stubMedia()
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        callId: 'call-in2',
        peerId: 9,
        kind: 'audio',
        startedAt: Date.now() - 4_000,
        touchedAt: Date.now() - 1_000,
        ringing: 'incoming'
      })
    )
    const store = useCallStore()
    store.connected = true

    expect(await store.recoverCallAfterReload()).toBe(false)
    expect(store.status).toBe('idle')
  })

  it('собеседник вернулся во время нашего вызова — переотдаём предложение', async () => {
    stubMedia()
    const store = useCallStore()
    store.$patch({ status: 'outgoing', callId: 'call-ring2', peerId: 7 })
    const link = store._newLink(7, {})

    store._handleMessage({ type: 'call-rejoin', from_user_id: 7, call_id: 'call-ring2' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.status).toBe('outgoing')
    expect(link.pc.setLocalDescription).toHaveBeenCalled()
    store._cleanup()
  })
})

/**
 * Пересогласование после перезагрузки ведёт ОДНА сторона.
 *
 * Два одновременных предложения («glare») не применяются ни одно — звонок рвётся
 * уже безвозвратно. Поэтому инициатива у младшего по id (то же правило, что при
 * сборке группового «mesh»), а второй только отвечает и выжидает.
 */
describe('пересогласование после перезагрузки: один инициатор', () => {
  it('младший по id ведёт, старший ждёт', () => {
    setActivePinia(createPinia())
    const store = useCallStore()
    useAuthStore().$patch({ current_user: { id: 5 } as never })

    expect(store._rejoinOfferer(9)).toBe(true)
    expect(store._rejoinOfferer(3)).toBe(false)
  })

  it('второй участник не шлёт своё предложение, а его попытки не «сгорают»', () => {
    const restart = store.slice(store.indexOf('async _restartIce'))
    expect(restart).toContain(
      'if (runtime.rejoinPending && !this._rejoinOfferer(link.peerId)) return'
    )
    expect(restart).toContain('if (runtime.rejoinPending) link.iceRestartAttempts = 0')
  })

  it('наблюдатель медиа молчит, пока идёт пересогласование', () => {
    const watchdog = store.slice(store.indexOf('async _checkMediaFlow'))
    expect(watchdog).toContain('if (runtime.rejoinPending) return')
  })

  it('«Переподключаемся…» снимается, даже если ICE не сменил состояние', () => {
    // Разговор уже идёт, а плашка оставалась висеть до конца звонка (нашли живьём).
    expect(store).toContain('this._endRejoin()')
    const renegotiate = store.slice(store.indexOf("case 'call-renegotiate-answer'"))
    expect(renegotiate).toContain('this._resetIceRecovery()')
    const answer = store.slice(store.indexOf('async _answerRenegotiate'))
    expect(answer).toContain('this._resetIceRecovery()')
  })
})
