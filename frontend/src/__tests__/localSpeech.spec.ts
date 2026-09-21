import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_SPEECH_MODELS,
  defaultLocalSpeechModel,
  describeLocalSpeechError,
  ensureLocalSpeech,
  forgetLocalSpeech,
  localSpeechCached,
  localSpeechModel,
  localSpeechModelInfo,
  localSpeechSupported,
  setLocalSpeechEngine,
  setLocalSpeechModel,
  transcribeWithLocalSpeech,
  type LocalSpeechEngine,
  type LocalSpeechPipeline
} from '@/utils/localSpeech'

/**
 * Распознавание речи моделью НА УСТРОЙСТВЕ (телефон, Safari, Firefox).
 *
 * Настоящий движок (десятки мегабайт ONNX) в юнит-тестах не поднимается, поэтому
 * он подменяется через `setLocalSpeechEngine` — там же проверяем то, что ломается
 * незаметно: склейку прогресса по файлам модели, выбор модели по устройству,
 * повторы после неудачи и понятные тексты ошибок.
 */

/** Что наш последний «движок» получил от нас. */
const calls: { model: string; options: Record<string, unknown> }[] = []
const optionsSeen: Record<string, unknown>[] = []
const audioSeen: Float32Array[] = []
let answer = 'привет с устройства'
let failure: unknown = null

const pipeline: LocalSpeechPipeline = async (audio, options) => {
  audioSeen.push(audio)
  optionsSeen.push(options)
  return { text: answer }
}

const engine: LocalSpeechEngine = {
  env: { allowLocalModels: false, useBrowserCache: true },
  async pipeline(_task, model, options) {
    if (failure) throw failure
    calls.push({ model, options: options ?? {} })
    return pipeline
  }
}

/** Заглушка кэша браузера: модель считается скачанной, если имя файла в списке. */
const installCache = (urls: string[]) => {
  const list = urls.slice()
  const cache = { keys: async () => list.map((url) => ({ url })), match: async () => null }
  vi.stubGlobal('caches', {
    open: async () => cache,
    delete: async () => {
      list.length = 0
      return true
    },
    keys: async () => ['transformers-cache']
  })
}

beforeEach(() => {
  calls.length = 0
  optionsSeen.length = 0
  audioSeen.length = 0
  answer = 'привет с устройства'
  failure = null
  setLocalSpeechEngine(async () => engine)
  localStorage.clear()
})

afterEach(() => {
  setLocalSpeechEngine(null)
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('модель распознавания на устройстве', () => {
  it('есть там, где браузер умеет WebAssembly', () => {
    expect(localSpeechSupported()).toBe(true)
  })

  it('модель по умолчанию — по устройству, а выбранная помнится', () => {
    // «Точнее» по умолчанию, но на слабом устройстве (мало ядер или памяти) —
    // «быстрая»: большая модель там не успеет отработать.
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 })
    expect(defaultLocalSpeechModel()).toBe('base')

    vi.stubGlobal('navigator', { hardwareConcurrency: 2, deviceMemory: 2 })
    expect(defaultLocalSpeechModel()).toBe('tiny')

    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 })
    setLocalSpeechModel('tiny')
    expect(localSpeechModel()).toBe('tiny')

    setLocalSpeechModel('base')
    expect(localSpeechModel()).toBe('base')
  })

  it('размер модели известен заранее — его показываем до скачивания', () => {
    expect(localSpeechModelInfo('tiny').sizeMb).toBe(LOCAL_SPEECH_MODELS.tiny.sizeMb)
    expect(localSpeechModelInfo('base').sizeMb).toBeGreaterThan(localSpeechModelInfo('tiny').sizeMb)
  })

  it('прогресс скачивания не показывает 100% на первом файле модели', async () => {
    // Файлов несколько (энкодер, декодер, словарь), и движок сообщает прогресс по
    // каждому отдельно: если брать последний файл или сумму уже начатых, человек
    // увидел бы «100%» в самом начале и не понял бы, чего ждёт.
    const declared = LOCAL_SPEECH_MODELS.base.sizeMb * 1024 * 1024
    const encoder = Math.round(declared * 0.45)
    const decoder = Math.round(declared * 0.35)
    const events: Array<{ status: string; file?: string; loaded?: number; total?: number }> = [
      // Энкодер скачался целиком — но это ещё не вся модель.
      { status: 'progress', file: 'encoder.onnx', loaded: encoder, total: encoder },
      { status: 'progress', file: 'decoder.onnx', loaded: Math.round(decoder / 2), total: decoder },
      { status: 'progress', file: 'decoder.onnx', loaded: decoder, total: decoder }
    ]
    const seen: number[] = []
    let created = 0
    const progressEngine: LocalSpeechEngine = {
      env: { allowLocalModels: false, useBrowserCache: true },
      async pipeline(_task, _model, options) {
        const callback = (options as { progress_callback?: (event: unknown) => void })
          ?.progress_callback
        for (const event of events) callback?.(event)
        created += 1
        return pipeline
      }
    }
    setLocalSpeechEngine(async () => progressEngine)

    await ensureLocalSpeech('base', (share) => seen.push(share))

    expect(created).toBe(1)
    expect(seen[0]).toBeCloseTo(0.45, 2)
    expect(seen[1]).toBeCloseTo(0.625, 2)
    expect(seen[2]).toBeCloseTo(0.8, 2)
    // Последнее значение ставит сам модуль: скачивание закончилось.
    expect(seen.at(-1)).toBe(1)
  })

  it('модель грузится один раз на вкладку, а после сбоя пробуем снова', async () => {
    await ensureLocalSpeech('base')
    await ensureLocalSpeech('base')
    expect(calls).toHaveLength(1)

    // Неудачу не запоминаем: следующая попытка должна качать заново, а не
    // возвращать ту же ошибку до перезагрузки страницы.
    failure = new Error('Failed to fetch')
    setLocalSpeechEngine(async () => engine)
    await expect(ensureLocalSpeech('base')).rejects.toThrow('Failed to fetch')

    failure = null
    await expect(ensureLocalSpeech('base')).resolves.toBeTypeOf('function')
    expect(calls).toHaveLength(2)
  })

  it('язык уходит в модель коротким кодом, пустой — «определи сам»', async () => {
    const pipe = await ensureLocalSpeech('base')
    await transcribeWithLocalSpeech(pipe, new Float32Array(16000), 'ru-RU')
    await transcribeWithLocalSpeech(pipe, new Float32Array(16000), '')

    expect(optionsSeen[0]).toMatchObject({ language: 'ru', task: 'transcribe' })
    expect(optionsSeen[1]).not.toHaveProperty('language')
    expect(audioSeen[0]).toHaveLength(16000)
  })

  it('текст отдаётся без лишних пробелов', async () => {
    answer = '  привет, это проверка  '
    const pipe = await ensureLocalSpeech('base')
    expect(await transcribeWithLocalSpeech(pipe, new Float32Array(16000), 'ru-RU')).toBe(
      'привет, это проверка'
    )
  })

  it('скачана ли модель — видно по кэшу браузера', async () => {
    // Иначе согласие на скачивание спрашивалось бы каждый раз.
    installCache([`https://example.test/${LOCAL_SPEECH_MODELS.base.id}/encoder.onnx`])
    expect(await localSpeechCached('base')).toBe(true)
    expect(await localSpeechCached('tiny')).toBe(false)
  })

  it('без кэша браузера модель считается нескачанной, а не падает', async () => {
    vi.stubGlobal('caches', undefined)
    expect(await localSpeechCached('base')).toBe(false)
    await expect(forgetLocalSpeech()).resolves.toBeUndefined()
  })

  it('«забыть модель» освобождает кэш и пересоздаст распознаватель', async () => {
    installCache([`x/${LOCAL_SPEECH_MODELS.base.id}/y.onnx`])
    await ensureLocalSpeech('base')
    expect(calls).toHaveLength(1)

    await forgetLocalSpeech()

    expect(await localSpeechCached('base')).toBe(false)
    await ensureLocalSpeech('base')
    expect(calls).toHaveLength(2)
  })

  it('ошибки объясняются словами: сеть, место, память', () => {
    expect(describeLocalSpeechError(new Error('Failed to fetch'))).toContain('интернет')
    expect(describeLocalSpeechError(new Error('QuotaExceededError'))).toContain('места')
    expect(describeLocalSpeechError(new Error('RuntimeError: out of memory'))).toContain('память')
    expect(describeLocalSpeechError(new Error('странное'))).toBe('странное')
    expect(describeLocalSpeechError(undefined)).toBe('Не удалось распознать запись на устройстве')
  })
})
