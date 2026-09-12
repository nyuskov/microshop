import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCallStore } from '@/stores/call'

/** Предложение звонка, как оно приходит по сигнальному каналу. */
const callOffer = (callId: string, from: number) => ({
  type: 'call-offer' as const,
  from_user_id: from,
  call_id: callId,
  kind: 'audio' as const,
  sdp: 'v=0'
})

describe('повторная доставка вызова', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('во время разговора не начинает звонок заново', () => {
    const call = useCallStore()
    call.$patch({ status: 'active', callId: 'call-1', peerId: 7 })

    call._handleMessage(callOffer('call-1', 7))

    expect(call.status).toBe('active')
    // Интерфейс по этому счётчику гасит задержавшееся уведомление о звонке.
    expect(call.ignoredCallOffers).toBe(1)
  })

  it('во время входящего не сбрасывает ожидание ответа', () => {
    const call = useCallStore()
    call.$patch({ status: 'incoming', callId: 'call-2', peerId: 7 })

    call._handleMessage(callOffer('call-2', 7))

    expect(call.status).toBe('incoming')
    expect(call.ignoredCallOffers).toBe(1)
  })

  it('чужой вызов считает повтором только свой звонок', () => {
    const call = useCallStore()
    call.$patch({ status: 'active', callId: 'call-3', peerId: 7 })

    call._handleMessage(callOffer('call-4', 9))

    expect(call.status).toBe('active')
    expect(call.ignoredCallOffers).toBe(0)
  })
})

describe('входящий звонок, о завершении которого не сообщили', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.useRealTimers())

  it('сам перестаёт «звонить», чтобы следующий вызов не отклонился как «занят»', () => {
    const call = useCallStore()
    call._handleMessage(callOffer('call-1', 7))
    expect(call.status).toBe('incoming')

    // Через полторы минуты вызов уже точно не звонит: зовущий ждёт ответа 75 с
    // (`RING_OUT_TIMEOUT_MS`), сторож абонента — 95 с
    // (`INCOMING_STALE_TIMEOUT_MS`). Сообщение о завершении до нас не дошло:
    // приложение было закрыто, а звонок приняли на другом устройстве.
    vi.advanceTimersByTime(96_000)

    expect(call.status).toBe('idle')
    expect(call.notice).toBe('Звонок завершён')
    expect(call.ringTimer).toBeUndefined()
  })

  it('при возврате на экран гасит звонок, который звонит слишком долго', () => {
    const call = useCallStore()
    call._handleMessage(callOffer('call-1', 7))
    expect(call.status).toBe('incoming')

    // В свёрнутой вкладке таймеры душатся: время прошло, а сторож не сработал.
    // Тогда проверка при возврате на экран должна погасить залипший вызов —
    // иначе окно звонка со звуком висит бесконечно.
    vi.setSystemTime(Date.now() + 120_000)

    expect(call.dropStaleRinging()).toBe(true)
    expect(call.status).toBe('idle')
    expect(call.notice).toBe('Звонок завершён')
  })

  it('свежий звонок при возврате на экран не трогает', () => {
    const call = useCallStore()
    call._handleMessage(callOffer('call-1', 7))

    expect(call.dropStaleRinging()).toBe(false)
    expect(call.status).toBe('incoming')
  })

  it('отвеченный звонок сторож не трогает', () => {
    const call = useCallStore()
    call._handleMessage(callOffer('call-1', 7))
    call._cleanup()
    call.$patch({ status: 'active', callId: 'call-1' })

    vi.advanceTimersByTime(120_000)

    expect(call.status).toBe('active')
    expect(call.notice).toBe('')
  })

  it('отклонённый звонок сторож не трогает', () => {
    const call = useCallStore()
    call._handleMessage(callOffer('call-1', 7))
    call.$patch({ status: 'idle', callId: null, peerId: null })

    vi.advanceTimersByTime(120_000)

    expect(call.status).toBe('idle')
    expect(call.notice).toBe('')
  })
})

describe('звонок завершился на другом устройстве', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('про отказ и «ответить не удалось» говорит разное', () => {
    const call = useCallStore()

    call.$patch({ status: 'incoming', callId: 'call-1', peerId: 7 })
    call._handleMessage({
      type: 'call-ended-elsewhere',
      call_id: 'call-1',
      from_user_id: 7,
      reason: 'declined'
    })
    expect(call.notice).toBe('Звонок отклонён на другом устройстве')

    call.$patch({ status: 'incoming', callId: 'call-2', peerId: 7 })
    call._handleMessage({
      type: 'call-ended-elsewhere',
      call_id: 'call-2',
      from_user_id: 7,
      reason: 'failed'
    })
    // Это не отказ: человек как раз пытался ответить, но не вышло.
    expect(call.notice).toBe('На другом устройстве не удалось ответить')

    call.$patch({ status: 'outgoing', callId: 'call-3', peerId: 7 })
    call._handleMessage({
      type: 'call-ended-elsewhere',
      call_id: 'call-3',
      from_user_id: 7,
      reason: 'busy'
    })
    expect(call.notice).toBe('На другом устройстве уже идёт звонок')
  })

  it('принятый на другом устройстве звонок на этом не оставляет «звонит»', () => {
    const call = useCallStore()
    call.$patch({ status: 'incoming', callId: 'call-1', peerId: 7 })

    call._handleMessage({
      type: 'call-ended-elsewhere',
      call_id: 'call-1',
      from_user_id: 7,
      reason: 'answered'
    })

    expect(call.status).toBe('idle')
    expect(call.notice).toBe('Звонок принят на другом устройстве')
  })
})

describe('звонок завершился, пока мы его не видели', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('гасит «звонит» по тихому push (канал отвалился — сигналинг не дошёл)', () => {
    const call = useCallStore()
    call.$patch({ status: 'incoming', callId: 'call-1', peerId: 7 })

    call.finishIfRinging('call-1')

    expect(call.status).toBe('idle')
    expect(call.notice).toBe('Звонок завершён')
  })

  it('идущий разговор не трогает: это наш вызов, гасить нельзя', () => {
    const call = useCallStore()
    call.$patch({ status: 'active', callId: 'call-1', peerId: 7 })

    call.finishIfRinging('call-1')

    expect(call.status).toBe('active')
    expect(call.notice).toBe('')
  })

  it('чужой (уже не актуальный) вызов не трогает', () => {
    const call = useCallStore()
    call.$patch({ status: 'incoming', callId: 'call-2', peerId: 7 })

    call.finishIfRinging('call-1')

    expect(call.status).toBe('incoming')
  })
})

describe('service worker', () => {
  const sw = readFileSync('public/sw.js', 'utf8')
  it('при открытом приложении не показывает системный «будильник» для звонка', () => {
    // Иначе во время уже идущего разговора телефон «звонит» второй раз.
    expect(sw).toContain('async function hasVisibleClient()')
    const callBranch = sw.slice(sw.indexOf("if (data.type === 'call') {"))
    expect(callBranch).toContain('await hasVisibleClient()')
    expect(callBranch.indexOf('hasVisibleClient()')).toBeLessThan(
      callBranch.indexOf('showNotification')
    )
  })

  it('обработчик push дожидается асинхронной проверки окна', () => {
    expect(sw).toContain('event.waitUntil(handlePush(event))')
    expect(sw).toContain('async function handlePush(event)')
  })

  it('возврат в приложение гасит залипший звонок', () => {
    const view = readFileSync('src/views/Messenger.vue', 'utf8')
    const handler = view.slice(view.indexOf('const handleCallVisibility = () => {'))
    expect(handler).toContain('callStore.dropStaleRinging()')
  })

  it('тап по телу уведомления показывает экран звонка', () => {
    // Приложение могло висеть в фоне так долго, что сигнальный канал отвалился:
    // offer ждёт в парковке, и без экрана ожидания человек видел просто список
    // чатов — звонок пропадал.
    const view = readFileSync('src/views/Messenger.vue', 'utf8')
    const handler = view.slice(view.indexOf("if (data.type === 'call-notification')"))
    expect(handler).toContain("beginCallLaunch(callId, peerId, 'focus')")
  })
})
