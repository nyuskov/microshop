import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelNativeRecognition,
  nativeSpeechSupported,
  recognizeWithNative
} from '@/services/nativeSpeech'
import { audioLevel, loadAudioBuffer, pcmChunks, toMono16k, toPcm16Mono16k } from '@/utils/audioPcm'

/**
 * Расшифровка голосовых силами УСТРОЙСТВА (Android-обёртка).
 *
 * В WebView Web Speech нет вовсе, поэтому запись отдаётся системному
 * распознавателю файлом: страница готовит «сырой» PCM 16 бит, моно, 16 кГц и
 * отправляет его в нативную часть кусками, а результат получает событием
 * `pismo:speech`. Тест подменяет мост и проверяет то, что ломается тихо: формат
 * звука, нарезку на куски, подписку ДО отправки и отмену.
 */

const UA = 'Mozilla/5.0 (Linux; Android 14) PismoAndroid/1.0'

/** Мост нативного слоя: пишем то, что от нас пришло. */
interface BridgeCalls {
  begin: { id: string; language: string }[]
  chunks: { bytes: number; last: boolean }[]
  cancels: number
  supported: boolean
}

let calls: BridgeCalls

const installBridge = (supported = true) => {
  calls = { begin: [], chunks: [], cancels: 0, supported }
  Object.defineProperty(navigator, 'userAgent', { value: UA, configurable: true })
  ;(globalThis as unknown as { window: Window }).window.PismoNative = {
    speechSupported: () => supported,
    speechBegin: (id: string, language: string) => {
      calls.begin.push({ id, language })
      return true
    },
    speechChunk: (base64: string, last: boolean) => {
      calls.chunks.push({ bytes: base64.length, last })
    },
    speechCancel: () => {
      calls.cancels += 1
    }
  }
}

/** Отвечает странице так, как это сделала бы нативная часть. */
const nativeAnswer = (id: string, status: string, text: string, error?: string) => {
  window.dispatchEvent(new CustomEvent('pismo:speech', { detail: { id, status, text, error } }))
}

/** Аудио-граф: запись «длительностью» 2 секунды и 48 кГц. */
class FakeAudioContext {
  state = 'running'
  resume = async () => undefined
  close = async () => undefined
  decodeAudioData = async () => makeBuffer(2, 48000)
  createGain() {
    return { gain: { value: 1 }, connect: () => undefined }
  }
  createBufferSource() {
    return { connect: () => undefined, start: () => undefined }
  }
  createMediaStreamDestination() {
    return { stream: { getAudioTracks: () => [{} as MediaStreamTrack] } }
  }
}

/** Буфер с ровным сигналом (по умолчанию — полная шкала). */
const makeBuffer = (seconds: number, sampleRate: number, value = 1) => {
  const samples = new Float32Array(Math.round(seconds * sampleRate)).fill(value)
  return {
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
    duration: seconds,
    getChannelData: () => samples
  } as unknown as AudioBuffer
}

/**
 * Сигнал «как речь»: синус — у него пик выше среднего уровня (крест-фактор ~√2).
 *
 * Ровным сигналом уровень речи не проверить: у него среднее равно пику.
 */
const makeToneBuffer = (seconds: number, sampleRate: number, peak: number, hz = 300) => {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = peak * Math.sin((2 * Math.PI * hz * index) / sampleRate)
  }
  return {
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
    duration: seconds,
    getChannelData: () => samples
  } as unknown as AudioBuffer
}

beforeEach(() => {
  delete (window as { PismoNative?: unknown }).PismoNative
  globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
  )
})

afterEach(() => {
  cancelNativeRecognition(1)
  delete (window as { PismoNative?: unknown }).PismoNative
  vi.unstubAllGlobals()
})

describe('нативное распознавание записей', () => {
  it('доступно только внутри оболочки и только с мостом', () => {
    delete (window as { PismoNative?: unknown }).PismoNative
    expect(nativeSpeechSupported()).toBe(false)

    installBridge()
    expect(nativeSpeechSupported()).toBe(true)
  })

  it('честно говорит, когда устройство не умеет распознавать файл', () => {
    installBridge(false)
    expect(nativeSpeechSupported()).toBe(false)
  })

  it('отдаёт звук кусками и последним помечает конец', async () => {
    installBridge()
    const running = recognizeWithNative(1, 'blob:voice', 'ru-RU', () => undefined)
    await vi.waitFor(() => {
      expect(calls.chunks.length).toBeGreaterThan(0)
    })
    nativeAnswer('1', 'ready', 'привет')
    await expect(running).resolves.toEqual({ status: 'ready', text: 'привет' })

    expect(calls.begin).toEqual([{ id: '1', language: 'ru-RU' }])
    expect(calls.chunks.at(-1)?.last).toBe(true)
    // Кусок не больше заявленного предела — иначе вызов не пролезет в нативную
    // часть.
    for (const chunk of calls.chunks) {
      expect(chunk.bytes).toBeLessThanOrEqual(192 * 1024 * 2)
    }
  })

  it('промежуточный текст показывается по мере чтения', async () => {
    installBridge()
    const partials: string[] = []
    const running = recognizeWithNative(2, 'blob:voice', 'ru-RU', (text) => partials.push(text))
    await vi.waitFor(() => {
      expect(calls.chunks.length).toBeGreaterThan(0)
    })
    nativeAnswer('2', 'partial', 'нача')
    nativeAnswer('2', 'partial', 'начало фразы')
    nativeAnswer('2', 'ready', 'начало фразы целиком')

    await expect(running).resolves.toMatchObject({ status: 'ready' })
    expect(partials).toEqual(['нача', 'начало фразы'])
  })

  it('чужие расшифровки не подмешиваются', async () => {
    installBridge()
    const running = recognizeWithNative(3, 'blob:voice', 'ru-RU', () => undefined)
    await vi.waitFor(() => {
      expect(calls.chunks.length).toBeGreaterThan(0)
    })

    nativeAnswer('999', 'ready', 'чужой текст')
    nativeAnswer('3', 'ready', 'наш текст')

    await expect(running).resolves.toEqual({ status: 'ready', text: 'наш текст' })
  })

  it('ошибку устройства возвращает текстом', async () => {
    installBridge()
    const running = recognizeWithNative(4, 'blob:voice', 'ru-RU', () => undefined)
    await vi.waitFor(() => {
      expect(calls.chunks.length).toBeGreaterThan(0)
    })

    nativeAnswer('4', 'failed', '', 'no-speech')

    await expect(running).resolves.toMatchObject({ status: 'failed', error: 'no-speech' })
  })

  it('отмена просит нативную часть остановиться', async () => {
    installBridge()
    const running = recognizeWithNative(5, 'blob:voice', 'ru-RU', () => undefined)
    await vi.waitFor(() => {
      expect(calls.chunks.length).toBeGreaterThan(0)
    })

    cancelNativeRecognition(5)

    await expect(running).resolves.toMatchObject({ status: 'failed', error: 'aborted' })
    expect(calls.cancels).toBeGreaterThan(0)
  })
})

describe('звук для распознавателя', () => {
  it('пересчитывает запись в 16 кГц и моно', async () => {
    const buffer = makeBuffer(2, 48000)
    const pcm = await toPcm16Mono16k(buffer)

    // 2 секунды при 16 кГц — это 32000 отсчётов, независимо от частоты записи.
    expect(pcm.length).toBe(32000)
    expect(Math.abs(pcm[0])).toBeGreaterThan(0)
  })

  it('не выходит за пределы 16 бит на громкой записи', async () => {
    const pcm = await toPcm16Mono16k(makeBuffer(0.5, 16000, 2))
    expect(Math.max(...pcm)).toBeLessThanOrEqual(32767)
    expect(Math.min(...pcm)).toBeGreaterThanOrEqual(-32767)
  })

  it('выравнивает громкость записи по уровню речи', async () => {
    // Тихую поднимаем до одного уровня, громкую приглушаем — распознавателю нужна
    // одна и та же громкость, иначе он выдаёт похожие по звучанию слова.
    const quiet = makeToneBuffer(1, 16000, 0.05)
    const ctx = new FakeAudioContext()
    ctx.decodeAudioData = async () => quiet
    await loadAudioBuffer(ctx as unknown as AudioContext, 'blob:voice')

    const samples = quiet.getChannelData(0)
    const level = audioLevel(samples)
    expect(level.rms).toBeCloseTo(0.1, 2)
    expect(level.peak).toBeLessThanOrEqual(0.95)
  })

  it('громкую запись не выводит за шкалу', async () => {
    const loud = makeToneBuffer(1, 16000, 1)
    const ctx = new FakeAudioContext()
    ctx.decodeAudioData = async () => loud
    await loadAudioBuffer(ctx as unknown as AudioContext, 'blob:voice')

    const level = audioLevel(loud.getChannelData(0))
    expect(level.peak).toBeLessThanOrEqual(0.95)
    expect(level.rms).toBeCloseTo(0.1, 2)
  })

  it('тишину не трогает и не усиливает шум', async () => {
    const silence = makeBuffer(1, 16000, 0)
    const ctx = new FakeAudioContext()
    ctx.decodeAudioData = async () => silence
    await loadAudioBuffer(ctx as unknown as AudioContext, 'blob:voice')

    expect(audioLevel(silence.getChannelData(0)).peak).toBe(0)
  })

  it('срезает низкие частоты, а голос не трогает', async () => {
    // Гул и ветер живут ниже 80 Гц; распознавателю нужен голос, а не мусор.
    const rumble = makeToneBuffer(1, 16000, 0.5, 40)
    const mono = await toMono16k(rumble)
    const level = audioLevel(mono.slice(4000))

    expect(level.rms).toBeLessThan(0.1)
  })

  it('если офлайн-пересчёт отдал тишину — считаем сами', async () => {
    // ГРАБЛЯ: на части мобильных сборок Chrome офлайн-рендер возвращает тишину,
    // хотя в записи звук есть. Тишина в распознавателе превращается в «фразы» и
    // повторы, поэтому такой результат отбрасываем.
    class SilentOffline {
      createBufferSource() {
        return { buffer: null, connect: () => undefined, start: () => undefined }
      }
      get destination() {
        return {}
      }
      startRendering = async () => ({ getChannelData: () => new Float32Array(16000) })
    }
    vi.stubGlobal('OfflineAudioContext', SilentOffline)

    const mono = await toMono16k(makeToneBuffer(1, 16000, 0.5))

    expect(mono.length).toBe(16000)
    expect(audioLevel(mono).peak).toBeGreaterThan(0)
  })

  it('base64 режется на куски, которые складываются в исходный звук', () => {
    const pcm = new Int16Array(200 * 1024)
    pcm[0] = 32767
    pcm[pcm.length - 1] = -32768
    const chunks = pcmChunks(pcm, 64 * 1024)

    // Куски нарезаются по байтам, а base64 кодирует тройками — поэтому проверяем
    // не сами строки, а то, что из них собирается: нативная часть декодирует каждый
    // кусок отдельно и складывает байты подряд. 200 Ки отсчётов = 400 КиБ, по
    // 64 КиБ в куске это 7 вызовов.
    expect(chunks.length).toBe(7)
    const collected: number[] = []
    for (const chunk of chunks) {
      const binary = atob(chunk)
      for (let index = 0; index < binary.length; index += 1) {
        collected.push(binary.charCodeAt(index))
      }
    }
    expect(collected.length).toBe(pcm.byteLength)
    expect(collected.slice(0, 2)).toEqual([255, 127])
    expect(collected.slice(-2)).toEqual([0, 128])
  })
})

describe('кнопка «В текст» в нативной оболочке', () => {
  it('распознавание голосового подключается к нативному пути', () => {
    // Проверяем контракт по исходнику: в Android-обёртке браузерного API нет,
    // поэтому кнопка должна вести на нативное распознавание.
    const util = readFileSync('src/utils/voiceRecognition.ts', 'utf8')
    expect(util).toContain('nativeSpeechSupported()')
    expect(util).toContain('recognizeWithNative(')
    expect(util).toContain('cancelNativeRecognition(')
  })
})
