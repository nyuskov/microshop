import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RING_INCOMING_LOOP_MS,
  RING_OUTGOING_LOOP_MS,
  RING_VOICES,
  startRingtone,
  stopRingtone
} from '@/stores/call/ringtone'

/**
 * Рингтон звонка.
 *
 * Проверяем не «красоту мелодии» (её слышно только ушами), а то, что ломается
 * тихо и обнаруживается на живом звонке: фраза должна быть МНОГОГОЛОСНОЙ (пять
 * инструментов вместо одного голоса), повторяться через паузу, не наслаиваться
 * при повторном запуске и гарантированно умолкать при остановке.
 */

interface FakeOscillator {
  type: string
  frequency: { value: number }
  detune: { value: number }
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface FakeParam {
  value: number
  setValueAtTime: ReturnType<typeof vi.fn>
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  cancelScheduledValues: ReturnType<typeof vi.fn>
}

interface FakeNode {
  connect: ReturnType<typeof vi.fn>
}

function fakeNode(): FakeNode {
  return { connect: vi.fn() }
}

function fakeParam(): FakeParam {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn()
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  destination = fakeNode()
  oscillators: FakeOscillator[] = []
  panners = 0
  closed = false
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => {
    this.closed = true
  })

  createOscillator(): FakeOscillator {
    const oscillator: FakeOscillator = {
      type: 'sine',
      frequency: { value: 0 },
      detune: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    }
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain(): FakeNode & { gain: FakeParam } {
    return { ...fakeNode(), gain: fakeParam() }
  }

  createDynamicsCompressor(): FakeNode & { [key: string]: unknown } {
    return {
      ...fakeNode(),
      threshold: fakeParam(),
      knee: fakeParam(),
      ratio: fakeParam(),
      attack: fakeParam(),
      release: fakeParam()
    }
  }

  createDelay(): FakeNode & { delayTime: FakeParam } {
    return { ...fakeNode(), delayTime: fakeParam() }
  }

  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam } {
    return { ...fakeNode(), type: 'lowpass', frequency: fakeParam() }
  }

  createStereoPanner: (() => FakeNode & { pan: FakeParam }) | undefined = () => {
    this.panners += 1
    return { ...fakeNode(), pan: fakeParam() }
  }
}

/** Контекст без панорамы: в старых браузерах `createStereoPanner` нет вовсе. */
class FakeAudioContextWithoutPan extends FakeAudioContext {
  override createStereoPanner = undefined
}

const windowWithAudio = window as unknown as { AudioContext?: unknown }

let contexts: FakeAudioContext[] = []
let vibrate: ReturnType<typeof vi.fn> = vi.fn()
/** Аргумент последнего вызова вибрации: пишем явно, чтобы не тащить any в тест. */
let vibratePattern: unknown = null

function installAudioContext(Ctor: typeof FakeAudioContext = FakeAudioContext): void {
  contexts = []
  windowWithAudio.AudioContext = function AudioContextMock() {
    const ctx = new Ctor()
    contexts.push(ctx)
    return ctx
  }
}

function toneTypes(ctx: FakeAudioContext): Set<string> {
  return new Set(ctx.oscillators.map((osc) => osc.type))
}

beforeEach(() => {
  vi.useFakeTimers()
  installAudioContext()
  vibratePattern = null
  vibrate = vi.fn((pattern: unknown) => {
    vibratePattern = pattern
    return true
  })
  Object.defineProperty(navigator, 'vibrate', {
    value: vibrate,
    configurable: true,
    writable: true
  })
})

afterEach(() => {
  stopRingtone()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  delete windowWithAudio.AudioContext
})

describe('фраза входящего звонка', () => {
  it('многоголосая: играют разные инструменты, а не один голос', async () => {
    startRingtone('incoming')
    await vi.advanceTimersByTimeAsync(200)

    const ctx = contexts[0]
    expect(ctx.oscillators.length).toBeGreaterThan(30)
    // Тембры разные: синус (колокольчик, бас), треугольник (подкладка, маримба),
    // пила (второй тон маримбы). Один инструмент дал бы всего один тип.
    expect(toneTypes(ctx).size).toBeGreaterThanOrEqual(3)
    expect(toneTypes(ctx)).toContain('triangle')
    expect(toneTypes(ctx)).toContain('sawtooth')
    expect(RING_VOICES.length).toBeGreaterThanOrEqual(5)
  })

  it('ноты разведены по панораме (звук объёмный, а не в одной точке)', async () => {
    startRingtone('incoming')
    await vi.advanceTimersByTimeAsync(200)

    expect(contexts[0].panners).toBeGreaterThan(0)
  })

  it('повторяется через паузу и не молчит после первой фразы', async () => {
    startRingtone('incoming')
    await vi.advanceTimersByTimeAsync(200)
    const first = contexts[0].oscillators.length

    await vi.advanceTimersByTimeAsync(RING_INCOMING_LOOP_MS + 200)

    expect(contexts[0].oscillators.length).toBeGreaterThan(first)
  })

  it('вибрирует один раз при запуске (входящий)', async () => {
    startRingtone('incoming')
    await vi.advanceTimersByTimeAsync(200)

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(Array.isArray(vibratePattern)).toBe(true)
  })
})

describe('гудки исходящего', () => {
  it('спокойнее входящего: короче повтор и нет вибрации', async () => {
    startRingtone('outgoing')
    await vi.advanceTimersByTimeAsync(200)

    expect(contexts[0].oscillators.length).toBeGreaterThan(10)
    expect(vibrate).not.toHaveBeenCalled()
    expect(RING_OUTGOING_LOOP_MS).toBeLessThan(RING_INCOMING_LOOP_MS)
  })
})

describe('остановка и повторный запуск', () => {
  it('остановка умолкает: новых нот нет, контекст закрыт', async () => {
    startRingtone('incoming')
    await vi.advanceTimersByTimeAsync(200)
    const played = contexts[0].oscillators.length

    stopRingtone()
    await vi.advanceTimersByTimeAsync(RING_INCOMING_LOOP_MS * 2)

    expect(contexts[0].oscillators.length).toBe(played)
    expect(contexts[0].closed).toBe(true)
  })

  it('повторный запуск не наслаивает гудки', async () => {
    startRingtone('incoming')
    await vi.advanceTimersByTimeAsync(200)
    startRingtone('outgoing')
    await vi.advanceTimersByTimeAsync(RING_INCOMING_LOOP_MS * 2)

    // Первый контекст закрыт (затухание), ноты идут только во второй.
    expect(contexts.length).toBe(2)
    expect(contexts[0].closed).toBe(true)
    const afterRestart = contexts[0].oscillators.length
    await vi.advanceTimersByTimeAsync(RING_OUTGOING_LOOP_MS + 200)
    expect(contexts[0].oscillators.length).toBe(afterRestart)
    expect(contexts[1].oscillators.length).toBeGreaterThan(0)
  })

  it('без панорамирования тоже играет (старые браузеры)', async () => {
    installAudioContext(FakeAudioContextWithoutPan)
    startRingtone('incoming')
    await vi.advanceTimersByTimeAsync(200)

    expect(contexts[0].oscillators.length).toBeGreaterThan(30)
    expect(contexts[0].panners).toBe(0)
  })

  it('без WebAudio не падает (звонок идёт без гудков)', async () => {
    delete windowWithAudio.AudioContext

    expect(() => startRingtone('incoming')).not.toThrow()
    await vi.advanceTimersByTimeAsync(200)
    expect(contexts.length).toBe(0)
  })
})
