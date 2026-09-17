import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  chatSoundKey,
  isMessageSoundEnabled,
  MESSAGE_SOUND_KEY,
  MESSAGE_SOUND_MIN_GAP_MS,
  MESSAGE_SOUNDS,
  messageSoundPreset,
  playIncomingMessageSound,
  resetMessageSoundState,
  setChatSoundKey,
  setMessageSoundEnabled
} from '@/utils/sounds'

/**
 * Звук входящего сообщения.
 *
 * Проверяем не «красоту звука», а правила, из-за которых он обычно молчит или,
 * наоборот, раздражает: настройка устройства, свёрнутое приложение (там звучит
 * системный push) и пачка сообщений (трель вместо одного «блипа»).
 */

interface FakeOscillator {
  type: string
  frequency: { value: number }
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 0
  destination = {}
  oscillators: FakeOscillator[] = []
  resume = vi.fn(async () => undefined)

  createOscillator(): FakeOscillator {
    const oscillator: FakeOscillator = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    }
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain(): unknown {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn()
    }
  }
}

const windowWithAudio = window as unknown as { AudioContext?: unknown }

let contexts: FakeAudioContext[] = []

function installAudioContext(): void {
  contexts = []
  windowWithAudio.AudioContext = function AudioContextMock() {
    const ctx = new FakeAudioContext()
    contexts.push(ctx)
    return ctx
  }
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true
  })
}

beforeEach(() => {
  localStorage.clear()
  resetMessageSoundState()
  installAudioContext()
  setVisibility('visible')
})

afterEach(() => {
  delete windowWithAudio.AudioContext
  localStorage.clear()
  resetMessageSoundState()
})

describe('настройка звука', () => {
  it('по умолчанию включён, выключается на устройстве', () => {
    expect(isMessageSoundEnabled()).toBe(true)
    setMessageSoundEnabled(false)
    expect(isMessageSoundEnabled()).toBe(false)
    expect(localStorage.getItem(MESSAGE_SOUND_KEY)).toBe('off')
    setMessageSoundEnabled(true)
    expect(isMessageSoundEnabled()).toBe(true)
  })

  it('выключенный звук даже не трогает WebAudio', () => {
    setMessageSoundEnabled(false)
    expect(playIncomingMessageSound('default', 10_000)).toBe(false)
    expect(contexts).toHaveLength(0)
  })
})

describe('когда звучать', () => {
  it('играет все ноты пресета и переиспользует один контекст', () => {
    expect(playIncomingMessageSound('default', 10_000)).toBe(true)
    expect(contexts).toHaveLength(1)
    expect(contexts[0].oscillators).toHaveLength(2)
    expect(contexts[0].oscillators[0].start).toHaveBeenCalledTimes(1)

    // «Яркий» — три ноты, тот же контекст.
    expect(playIncomingMessageSound('bright', 10_000 + MESSAGE_SOUND_MIN_GAP_MS + 1)).toBe(true)
    expect(contexts).toHaveLength(1)
    expect(contexts[0].oscillators).toHaveLength(5)
  })

  it('пачка сообщений звучит один раз', () => {
    expect(playIncomingMessageSound('default', 5000)).toBe(true)
    expect(playIncomingMessageSound('default', 5100)).toBe(false)
    expect(playIncomingMessageSound('default', 5900)).toBe(false)
    expect(playIncomingMessageSound('default', 5000 + MESSAGE_SOUND_MIN_GAP_MS)).toBe(true)
  })

  it('в свёрнутом приложении звука нет — там звучит системный push', () => {
    setVisibility('hidden')
    expect(playIncomingMessageSound('default', 10_000)).toBe(false)
    expect(contexts).toHaveLength(0)
  })

  it('спящий контекст будим перед игрой', () => {
    installAudioContext()
    const original = windowWithAudio.AudioContext as new () => FakeAudioContext
    windowWithAudio.AudioContext = function SuspendedAudioContext() {
      const ctx = new original()
      ctx.state = 'suspended'
      return ctx
    }
    expect(playIncomingMessageSound('default', 10_000)).toBe(true)
    expect(contexts[0].resume).toHaveBeenCalledTimes(1)
  })

  it('без WebAudio молчит и не падает', () => {
    delete windowWithAudio.AudioContext
    expect(() => playIncomingMessageSound('default', 10_000)).not.toThrow()
    expect(playIncomingMessageSound('default', 10_000)).toBe(false)
  })
})

describe('звуки по чатам', () => {
  it('пресеты: у «Без звука» нет нот, остальные звучат', () => {
    expect(MESSAGE_SOUNDS.map((item) => item.key)).toContain('none')
    expect(messageSoundPreset('none').notes).toEqual([])
    expect(messageSoundPreset('bright').notes.length).toBe(3)
    // Незнакомый ключ (старая запись) — «Классика», а не тишина.
    expect(messageSoundPreset('нет такого').key).toBe('default')
    for (const preset of MESSAGE_SOUNDS) {
      if (preset.key === 'none') continue
      expect(preset.notes.length).toBeGreaterThan(0)
    }
  })

  it('«Без звука» у чата — тишина, но контекст не создаётся', () => {
    setChatSoundKey(42, 'none')
    expect(playIncomingMessageSound(chatSoundKey(42) ?? 'default', 10_000)).toBe(false)
    expect(contexts).toHaveLength(0)
  })

  it('выбранный звук чата хранится и сбрасывается', () => {
    expect(chatSoundKey(42)).toBeNull()
    setChatSoundKey(42, 'drop')
    expect(chatSoundKey(42)).toBe('drop')
    // Соседний чат не затронут — настройка не общая.
    expect(chatSoundKey(43)).toBeNull()
    setChatSoundKey(42, null)
    expect(chatSoundKey(42)).toBeNull()
  })

  it('битая или устаревшая запись не ломает звук', () => {
    localStorage.setItem('pismo_chat_sounds', '{не json')
    expect(chatSoundKey(42)).toBeNull()
    localStorage.setItem('pismo_chat_sounds', JSON.stringify({ 42: 'старый-пресет', 43: 'soft' }))
    // Известный ключ читается, неизвестный — как «по умолчанию».
    expect(chatSoundKey(42)).toBeNull()
    expect(chatSoundKey(43)).toBe('soft')
  })
})
