import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import AudioMessage from '@/components/media/AudioMessage.vue'
import TranscriptionBlock from '@/components/media/TranscriptionBlock.vue'
import { setLocalSpeechEngine, type LocalSpeechEngine } from '@/utils/localSpeech'
import {
  clearTranscript,
  recognizeVoice,
  setSpeechLanguage,
  speechLanguage,
  speechLanguageInUse,
  speechRecognitionSupported,
  stopAllRecognitions,
  transcriptActionFor,
  transcriptOf
} from '@/utils/voiceRecognition'

/**
 * Окно согласия на скачивание модели (мобильный браузер) — заглушка.
 *
 * Поднимать в тестах настоящий Quasar-диалог незачем: проверяем не его, а то, что
 * без согласия человека модель не скачивается.
 */
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn(async () => true) }))
vi.mock('@/utils/appDialogs', () => ({ confirmDialog: confirmMock }))

/**
 * Расшифровка голосовых в текст (F4).
 *
 * Распознаёт устройство: звук файла идёт через `AudioContext` в
 * `MediaStreamDestination`, оттуда треком в `SpeechRecognition` (расширение
 * Chrome — в других браузерах кнопки не будет вовсе). Поэтому тест подменяет и
 * распознаватель, и аудио-граф, и проверяет то, что легко сломать: сборку
 * фрагментов речи, понятные ошибки, остановку при уходе из чата и то, что текст
 * живёт только в памяти вкладки.
 */

const button = readFileSync('src/components/media/TranscribeButton.vue', 'utf8')
const block = readFileSync('src/components/media/TranscriptionBlock.vue', 'utf8')
const attachmentSource = readFileSync('src/components/messenger/MessageAttachment.vue', 'utf8')

/** Заглушка распознавателя: события шлём руками. */
class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  started = false
  aborted = false
  private handlers: Record<string, ((event: unknown) => void)[]> = {}

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.handlers[type] = [...(this.handlers[type] ?? []), handler]
  }

  start(_track?: MediaStreamTrack) {
    this.started = true
  }

  stop() {
    this.started = false
    // Chrome после `stop()` доводит последний фрагмент и закрывает распознавание
    // сам — заглушка обязана это повторять, иначе тест проверяет не то поведение.
    this.emit('end')
  }

  abort() {
    this.aborted = true
    this.started = false
  }

  /** Событие распознавателя (тест играет роль браузера). */
  emit(type: string, event: unknown = {}) {
    for (const handler of this.handlers[type] ?? []) handler(event)
  }

  /**
   * Кусок речи: `final` — уже подтверждённый текст, `alternatives` — варианты,
   * из которых util обязан выбрать самый уверенный.
   */
  emitResult(transcript: string, final: boolean, alternatives?: { text: string; conf: number }[]) {
    const list = alternatives ?? [{ text: transcript, conf: 1 }]
    // Альтернативы лежат внутри ОДНОГО результата (так устроен настоящий API),
    // а не отдельными результатами — иначе мы бы «склеили» все варианты подряд.
    const result: Record<string | number, unknown> = { isFinal: final, length: list.length }
    list.forEach((item, index) => {
      result[index] = { transcript: item.text, confidence: item.conf }
    })
    this.emit('result', { resultIndex: 0, results: Object.assign([result], { length: 1 }) })
  }
}

let recognition: FakeRecognition
let ended: (() => void) | null
/** Сколько секунд длится «записанный файл» (куски по 15 с). */
let audioSeconds = 4
/** Сэмплы «записи» — по ним видно нормализацию тихого звука. */
let samples: Float32Array
/** Запущенные куски: смещение и длительность (проверяем нарезку). */
let chunks: { offset: number; duration: number }[]

/** Аудио-граф: декодирование «файла» и «докрутили до конца». */
class FakeAudioContext {
  createMediaStreamDestination() {
    return { stream: { getAudioTracks: () => [{} as MediaStreamTrack] } }
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: () => undefined,
      // `start(when, offset, duration)` — как у настоящего узла звука.
      start: (_when = 0, offset = 0, duration = 0) => {
        chunks.push({ offset, duration })
      },
      stop: () => undefined,
      addEventListener: (type: string, handler: () => void) => {
        if (type === 'ended') ended = handler
      }
    }
  }

  /** Граф обязан иметь путь к `ctx.destination` (тишина через gain 0). */
  createGain() {
    return { gain: { value: 1 }, connect: () => undefined }
  }

  state = 'running'
  resume = async () => undefined
  decodeAudioData = async () => ({
    duration: audioSeconds,
    numberOfChannels: 1,
    length: samples.length,
    sampleRate: 48000,
    getChannelData: () => samples
  })
  close = async () => undefined
}

const globals = globalThis as unknown as {
  window: Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
}

/**
 * Chrome на КОМПЬЮТЕРЕ — единственный браузер, который умеет распознавать запись
 * (см. `fileSpeechCapable` в `utils/voiceRecognition.ts`). Остальные играем отдельно.
 */
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/** Chrome на телефоне: расширения `start(track)` нет — распознаватель слушает микрофон. */
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

/** Safari: распознаватель есть, но файл он не умеет — только микрофон. */
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

/** Заглушка движка модели на устройстве: тексты и сбои задаёт тест. */
const localEngines: string[] = []
let localAnswer = 'привет с устройства'
let localFailure: unknown = null

const fakeLocalEngine: LocalSpeechEngine = {
  env: { allowLocalModels: false, useBrowserCache: true },
  async pipeline(_task, model) {
    if (localFailure) throw localFailure
    localEngines.push(model)
    return async () => ({ text: localAnswer })
  }
}

beforeEach(() => {
  ended = null
  audioSeconds = 4
  // Пик 1.0 — «нормальная» громкость: нормализация тут ничего не меняет.
  samples = new Float32Array(48000 * 4).fill(1)
  chunks = []
  recognition = new FakeRecognition()
  globals.window.SpeechRecognition = function () {
    return recognition
  }
  globals.window.AudioContext = FakeAudioContext as unknown as typeof AudioContext
  vi.stubGlobal('navigator', { userAgent: DESKTOP_CHROME_UA, userAgentData: { mobile: false } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
  )
  // Модель на устройстве: по умолчанию отвечаем «скачать можно», текст задаёт тест.
  confirmMock.mockResolvedValue(true)
  confirmMock.mockClear()
  localEngines.length = 0
  localAnswer = 'привет с устройства'
  localFailure = null
  setLocalSpeechEngine(async () => fakeLocalEngine)
  setSpeechLanguage('')
})

afterEach(() => {
  stopAllRecognitions()
  setLocalSpeechEngine(null)
  delete (globals.window as { SpeechRecognition?: unknown }).SpeechRecognition
  delete (globalThis as { Translator?: unknown }).Translator
  vi.unstubAllGlobals()
})

/**
 * Заглушка встроенного переводчика браузера.
 *
 * Кнопка «Перевести» у расшифровки есть только там, где перевод возможен: без
 * `Translator` (телефон, WebView приложения, Safari) её нет вовсе — иначе нажатие
 * упиралось бы в «браузер не умеет переводить» (см. `canOfferTranslation`).
 */
const installTranslator = () => {
  ;(globalThis as { Translator?: unknown }).Translator = function () {
    /* конструктор не нужен: проверяется только наличие API */
  }
}

/**
 * Ждём, пока соберётся «граф»: загрузка и декодирование аудио — это промисы, а
 * обработчик конца записи регистрируется уже после них. Без этого тест шлёт
 * события в пустоту и проверяет промежуточное состояние.
 */
const settle = async () => {
  await vi.waitFor(() => {
    expect(ended).not.toBeNull()
  })
}

/** Ждём следующий кусок: обработчик прошлого ещё лежит в `ended`. */
const settleNextChunk = async () => {
  ended = null
  await settle()
}

describe('расшифровка голосового', () => {
  it('поддерживается там, где есть распознаватель и аудио-граф', () => {
    expect(speechRecognitionSupported()).toBe(true)
  })

  it('собирает фрагменты речи в один текст', async () => {
    const running = recognizeVoice(7, 'blob:voice')
    await settle()

    // Пока идёт распознавание — показываем накопленный текст.
    recognition.emitResult('привет ', true)
    recognition.emitResult('это ', false)
    expect(transcriptOf(7)).toMatchObject({ status: 'running', text: 'привет это' })

    recognition.emitResult('тест', true)
    ended?.()
    await running

    expect(transcriptOf(7)).toEqual({ status: 'ready', text: 'привет тест', via: 'browser' })
  })

  it('ошибка браузера объясняется человеческим языком', async () => {
    const running = recognizeVoice(8, 'blob:voice')
    await settle()

    recognition.emit('error', { error: 'network' })
    await running

    expect(transcriptOf(8)).toEqual({
      status: 'failed',
      text: '',
      via: 'browser',
      error: 'Браузер не смог обратиться к своему сервису распознавания'
    })
  })

  it('тишина в записи — тоже понятная причина, а не пустая плашка', async () => {
    const running = recognizeVoice(9, 'blob:voice')
    await settle()

    // Ни одного звука распознаватель не услышал — это ДРУГАЯ причина, чем
    // «слышал, но не разобрал», и формулировка должна быть честной.
    ended?.()
    await running

    expect(transcriptOf(9)?.status).toBe('failed')
    expect(transcriptOf(9)?.error).toContain('не получило звук')
  })

  it('слышал звук, но слов не разобрал — говорим именно это', async () => {
    const running = recognizeVoice(13, 'blob:voice')
    await settle()

    recognition.emit('soundstart')
    ended?.()
    await running

    expect(transcriptOf(13)?.error).toContain('Речь не разобрана')
  })

  it('промежуточный текст не теряется, если финальный фрагмент не пришёл', async () => {
    // Симптом владельца: «речь всё время не распознана, хотя голос есть» —
    // распознаватель присылал только промежуточный результат, а он при
    // завершении выбрасывался.
    const running = recognizeVoice(14, 'blob:voice')
    await settle()

    recognition.emitResult('это текст', false)
    ended?.()
    await running

    expect(transcriptOf(14)).toEqual({ status: 'ready', text: 'это текст', via: 'browser' })
  })

  it('ошибка после полученного текста не отменяет текст', async () => {
    const running = recognizeVoice(15, 'blob:voice')
    await settle()

    recognition.emitResult('часть речи', false)
    recognition.emit('error', { error: 'no-speech' })
    await running

    expect(transcriptOf(15)).toEqual({ status: 'ready', text: 'часть речи', via: 'browser' })
  })

  it('браузер сам закрыл распознавание — отдаём то, что успели собрать', async () => {
    const running = recognizeVoice(16, 'blob:voice')
    await settle()

    recognition.emitResult('начало фразы', true)
    recognition.emit('end')
    await running

    expect(transcriptOf(16)).toEqual({ status: 'ready', text: 'начало фразы', via: 'browser' })
  })

  it('уход из чата останавливает распознавание', async () => {
    const running = recognizeVoice(10, 'blob:voice')
    await settle()

    stopAllRecognitions()

    // Распознаватель гасим сразу: ждать конца куска человеку не за чем.
    expect(recognition.aborted).toBe(true)
    await vi.waitFor(() => {
      expect(transcriptOf(10)?.status).toBe('failed')
    })
    await running
  })

  it('«Скрыть» убирает текст из памяти вкладки', async () => {
    const running = recognizeVoice(11, 'blob:voice')
    await settle()
    recognition.emitResult('секрет', true)
    ended?.()
    await running
    expect(transcriptOf(11)?.text).toBe('секрет')

    clearTranscript(11)

    expect(transcriptOf(11)).toBeUndefined()
  })

  it('нечитаемую запись объясняет по-русски, а не кодом браузера', async () => {
    // Живьём: Chrome отвечал английским `EncodingError: Unable to decode audio
    // data`, и человек видел ровно это вместо причины.
    class BrokenContext extends FakeAudioContext {
      decodeAudioData = async () => {
        const error = new Error('Unable to decode audio data')
        error.name = 'EncodingError'
        throw error
      }
    }
    globals.window.AudioContext = BrokenContext as unknown as typeof AudioContext

    const running = recognizeVoice(17, 'blob:voice')
    await running

    expect(transcriptOf(17)).toEqual({
      status: 'failed',
      text: '',
      via: 'browser',
      error: 'Запись не удалось прочитать — файл повреждён или формат не поддерживается устройством'
    })
    clearTranscript(17)
  })

  it('без распознавателя и без WebAssembly честно говорит, что браузер не умеет', async () => {
    // Мобильный браузер: Web Speech есть, но запись он не умеет; WebAssembly нет —
    // значит и модель не запустить. Распознать запись нечем вовсе.
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME_UA, userAgentData: { mobile: true } })
    delete (globals.window as { SpeechRecognition?: unknown }).SpeechRecognition
    delete (globals.window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    vi.stubGlobal('WebAssembly', undefined)
    expect(speechRecognitionSupported()).toBe(false)

    await recognizeVoice(12, 'blob:voice')

    expect(transcriptOf(12)?.error).toContain('не умеет распознавать готовые записи')
  })

  it('в мобильном браузере распознаём моделью на устройстве — микрофон не трогаем', async () => {
    // Две жалобы владельца подряд, из-за которых появился этот путь: сначала
    // Chrome на Android отвечал «Распознавание не получило звук» (он слушает
    // микрофон, а переданный трек игнорирует), потом кнопку за это убрали — и
    // владелец её не нашёл: «в мобилке теперь вообще пропала кнопка в текст».
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME_UA, userAgentData: { mobile: true } })
    expect(speechRecognitionSupported()).toBe(true)

    await recognizeVoice(30, 'blob:voice')

    expect(transcriptOf(30)).toMatchObject({
      status: 'ready',
      text: 'привет с устройства',
      via: 'device'
    })
    expect(localEngines[0]).toContain('whisper')
    // Микрофонный распознаватель даже не запускали — доступа к микрофону не просим.
    expect(recognition.started).toBe(false)
    clearTranscript(30)
  })

  it('перед скачиванием модели спрашиваем согласие и говорим размер', async () => {
    // Десятки мегабайт — это трафик человека, поэтому только с его согласия.
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME_UA, userAgentData: { mobile: true } })

    await recognizeVoice(31, 'blob:voice')

    expect(confirmMock).toHaveBeenCalledTimes(1)
    const options = confirmMock.mock.calls[0][0] as { title?: string; message?: string }
    expect(options.title).toContain('на устройстве')
    expect(options.message).toContain('МБ')
    expect(options.message).toContain('один раз')
    clearTranscript(31)
  })

  it('отказался скачивать модель — расшифровки не будет, и причина названа', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME_UA, userAgentData: { mobile: true } })
    confirmMock.mockResolvedValueOnce(false)

    await recognizeVoice(32, 'blob:voice')

    expect(transcriptOf(32)?.error).toContain('модель не скачана')
    expect(localEngines).toHaveLength(0)
    clearTranscript(32)
  })

  it('этапы видны по ходу: скачивание с процентом, потом распознавание', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME_UA, userAgentData: { mobile: true } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const heldEngine: LocalSpeechEngine = {
      env: { allowLocalModels: false, useBrowserCache: true },
      async pipeline(_task, _model, options) {
        const callback = (options as { progress_callback?: (event: unknown) => void })
          ?.progress_callback
        callback?.({
          status: 'progress',
          file: 'encoder.onnx',
          loaded: 20_000_000,
          total: 20_000_000
        })
        await gate
        return async () => ({ text: 'готово' })
      }
    }
    setLocalSpeechEngine(async () => heldEngine)

    const running = recognizeVoice(33, 'blob:voice')
    await vi.waitFor(() => expect(transcriptOf(33)?.stage).toBe('download'))
    const state = transcriptOf(33)
    expect(state?.progress).toBeGreaterThan(0)
    expect(state?.progress).toBeLessThan(1)

    const wrapper = mount(TranscriptionBlock, {
      props: { messageId: 33, src: 'blob:voice' },
      global: { stubs: { 'q-icon': true } }
    })
    expect(wrapper.text()).toContain('Скачиваем модель распознавания')
    expect(wrapper.text()).toContain('%')

    release()
    await running
    await nextTick()

    expect(transcriptOf(33)).toMatchObject({ status: 'ready', text: 'готово', via: 'device' })
    // Подпись под текстом честная: звук считался на устройстве, а не у браузера.
    expect(wrapper.text()).toContain('Распознано на устройстве моделью в браузере')
    wrapper.unmount()
    clearTranscript(33)
  })

  it('сбой модели объясняется словами: нет сети, мало места, мало памяти', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME_UA, userAgentData: { mobile: true } })
    localFailure = new Error('Failed to fetch')
    await recognizeVoice(34, 'blob:voice')
    expect(transcriptOf(34)?.error).toContain('интернет')

    localFailure = new Error('QuotaExceededError')
    await recognizeVoice(35, 'blob:voice')
    expect(transcriptOf(35)?.error).toContain('места')

    localFailure = null
    clearTranscript(34)
    clearTranscript(35)
  })

  it('Safari тоже считает моделью на устройстве (файл он не умеет)', async () => {
    // У Safari распознаватель есть, поэтому одной проверки наличия API мало: он
    // слушает только микрофон — идём тем же путём, что и на телефоне.
    vi.stubGlobal('navigator', { userAgent: SAFARI_UA })

    await recognizeVoice(36, 'blob:voice')

    expect(transcriptOf(36)).toMatchObject({ status: 'ready', via: 'device' })
    expect(recognition.started).toBe(false)
    clearTranscript(36)
  })

  it('без WebAssembly распознать запись нечем — говорим причину и выход', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_CHROME_UA, userAgentData: { mobile: true } })
    vi.stubGlobal('WebAssembly', undefined)

    await recognizeVoice(37, 'blob:voice')

    expect(transcriptOf(37)?.error).toContain('только микрофон')
    expect(transcriptOf(37)?.error).toContain('приложении Pismo')
    clearTranscript(37)
  })
})

describe('точность распознавания', () => {
  it('длинную запись режет на куски и склеивает текст', async () => {
    // Длинный `continuous` у Chrome разбирает слова хуже и теряет хвост записи,
    // поэтому звук идёт кусками по 15 секунд, а результаты собираются вместе.
    audioSeconds = 25
    samples = new Float32Array(48000 * 25).fill(1)
    const running = recognizeVoice(20, 'blob:voice')
    await settle()
    expect(recognition.continuous).toBe(false)

    recognition.emitResult('первая часть', true)
    ended?.()
    await settleNextChunk()

    recognition.emitResult('вторая часть', true)
    ended?.()

    await running
    expect(transcriptOf(20)).toEqual({
      status: 'ready',
      text: 'первая часть вторая часть',
      via: 'browser'
    })
    // Кусок 2 начинается там, где кончился первый, и не длиннее 15 секунд.
    expect(chunks).toEqual([
      { offset: 0, duration: 15 },
      { offset: 15, duration: 10 }
    ])
  })

  it('не рвёт распознавание `abort()` на нормальном конце куска', async () => {
    // `abort()` выбрасывает незавершённый фрагмент — им терялись последние слова.
    const running = recognizeVoice(21, 'blob:voice')
    await settle()

    recognition.emitResult('слова', true)
    ended?.()
    await running

    expect(transcriptOf(21)?.text).toBe('слова')
  })

  it('из альтернатив берёт самую уверенную', async () => {
    const running = recognizeVoice(22, 'blob:voice')
    await settle()

    recognition.emitResult('', true, [
      { text: 'привед медветь', conf: 0.4 },
      { text: 'привет медведь', conf: 0.9 }
    ])
    ended?.()
    await running

    expect(transcriptOf(22)?.text).toBe('привет медведь')
  })

  it('фрагменты склеивает с пробелом, а не «приветмир»', async () => {
    const running = recognizeVoice(25, 'blob:voice')
    await settle()

    recognition.emitResult('привет', true)
    recognition.emitResult('мир', true)
    ended?.()
    await running

    expect(transcriptOf(25)?.text).toBe('привет мир')
  })

  it('тихую запись усиливает перед распознаванием', async () => {
    // Симптом: «записал тихо — слов не разобрал».
    samples = new Float32Array(48000).fill(0.05)
    const running = recognizeVoice(23, 'blob:voice')
    await settle()
    ended?.()
    await running

    // Пик поднят до 0.4 (×8 — предел, чтобы не поднимать шум вместе с речью).
    expect(samples[0]).toBeCloseTo(0.4, 5)
  })

  it('язык по умолчанию русский — иначе «привет» превращается в «private»', async () => {
    const running = recognizeVoice(24, 'blob:voice')
    await settle()
    ended?.()
    await running

    expect(recognition.lang).toBe('ru-RU')
  })

  it('выбранный язык запоминается и уходит в распознаватель', async () => {
    setSpeechLanguage('en-US')
    expect(speechLanguage.value).toBe('en-US')

    const running = recognizeVoice(26, 'blob:voice')
    await settle()
    ended?.()
    await running

    expect(recognition.lang).toBe('en-US')
  })

  it('выбор языка можно сбросить на «как в приложении»', () => {
    setSpeechLanguage('tr-TR')
    setSpeechLanguage('')

    expect(speechLanguage.value).toBe('')
    expect(localStorage.getItem('pismo_stt_lang')).toBeNull()
  })

  it('язык, которым слушают, виден в интерфейсе', () => {
    // Если текст вышел чужими словами, человек должен видеть причину: «private»
    // вместо «привет» — это английская модель, а не «распознавание сломалось».
    expect(speechLanguageInUse.value).toBe('ru-RU')
    setSpeechLanguage('en-US')
    expect(speechLanguageInUse.value).toBe('en-US')
    setSpeechLanguage('')
    expect(speechLanguageInUse.value).toBe('ru-RU')
  })
})

describe('кнопка «В текст»: что она делает', () => {
  it('без расшифровки — распознаёт, с текстом — скрывает', () => {
    expect(transcriptActionFor(undefined)).toBe('recognize')
    expect(transcriptActionFor({ status: 'ready', text: 'привет' })).toBe('hide')
    expect(transcriptActionFor({ status: 'running', text: '' })).toBe('cancel')
  })

  it('скрытие везде сверху, а повтор — в блоке с ошибкой', () => {
    // Владелец: «сделай унифицированно» — кнопка в шапке всегда «Скрыть текст»,
    // а повтор живёт рядом с причиной ошибки.
    expect(transcriptActionFor({ status: 'failed', text: '', error: 'нет сети' })).toBe('hide')
  })
})

describe('кнопка «В текст» в голосовом', () => {
  const mountVoice = () =>
    mount(AudioMessage, {
      props: { messageId: 5, src: 'blob:voice', name: 'Голосовое', size: 1024 },
      global: { stubs: { 'q-icon': true } }
    })

  it('есть, когда браузер умеет распознавать', () => {
    const wrapper = mountVoice()

    expect(wrapper.find('.am-transcribe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('кнопка есть и когда запись не воспроизводится', async () => {
    // Владелец-сценарий: браузер не смог декодировать файл («Не удалось
    // воспроизвести аудио»), и кнопки расшифровки не было вовсе — ровно там, где
    // она нужнее всего (человек не может ни послушать, ни прочитать).
    const wrapper = mountVoice()
    await wrapper.find('audio').trigger('error')

    expect(wrapper.find('.mms-error').exists()).toBe(true)
    expect(wrapper.find('.am-transcribe').exists()).toBe(true)
    // Причина — своей строкой, а не в одной строке с кнопкой: длинный текст
    // ломал строку с расшифровкой (владелец: «сообщение об ошибке — отдельной
    // строкой»).
    expect(wrapper.find('.mms-sub .mms-error').exists()).toBe(false)
    wrapper.unmount()
  })

  it('говорит причину по коду ошибки, а не «не удалось» обо всём подряд', async () => {
    // Разные коды `MediaError` — разные действия человека: связь (повторить),
    // битый файл (расшифровка в текст), формат (то же самое). Обещать «не удалось
    // воспроизвести» на все случаи — терять эту разницу.
    const cases: Array<[number, string]> = [
      [2, 'Запись не загрузилась — проверьте связь'],
      [3, 'Запись повреждена — файл не читается'],
      [4, 'Устройство не умеет играть этот формат']
    ]
    for (const [code, text] of cases) {
      const wrapper = mountVoice()
      Object.defineProperty(wrapper.find('audio').element, 'error', {
        value: { code },
        configurable: true
      })
      await wrapper.find('audio').trigger('error')

      expect(wrapper.find('.mms-error').text()).toBe(text)
      wrapper.unmount()
    }
  })

  it('расшифровки в разметке нет, пока её не запросили', () => {
    const wrapper = mountVoice()

    expect(wrapper.find('.am-transcript').exists()).toBe(false)
    wrapper.unmount()
  })

  it('«Перевести» появляется только после готового текста (G1)', async () => {
    // Переводить нечего, пока текста нет: кнопка обязана ждать расшифровку, иначе
    // человек нажмёт её и получит перевод пустой строки.
    installTranslator()
    const wrapper = mount(TranscriptionBlock, {
      props: { messageId: 90, src: 'blob:voice' },
      global: { stubs: { 'q-icon': true } }
    })
    expect(wrapper.text()).not.toContain('Перевести')

    const running = recognizeVoice(90, 'blob:voice')
    await settle()
    recognition.emitResult('Hello there', true)
    ended?.()
    await running

    expect(wrapper.text()).toContain('Перевести')
    clearTranscript(90)
    wrapper.unmount()
  })

  it('на устройстве без встроенного переводчика кнопки нет и после текста', async () => {
    // Симптом владельца: «в мобилках перевод пишет, что не может» — кнопка вела
    // в тупик. Теперь её просто нет (перевод идёт только на устройстве).
    const wrapper = mount(TranscriptionBlock, {
      props: { messageId: 91, src: 'blob:voice' },
      global: { stubs: { 'q-icon': true } }
    })

    const running = recognizeVoice(91, 'blob:voice')
    await settle()
    recognition.emitResult('Hello there', true)
    ended?.()
    await running

    expect(wrapper.text()).toContain('Скопировать')
    expect(wrapper.text()).not.toContain('Перевести')
    clearTranscript(91)
    wrapper.unmount()
  })

  it('кнопка ведёт на расшифровку и сообщает, что текст не уходит на сервер', () => {
    // Состояние живёт в памяти вкладки, а сама кнопка и блок вынесены в общие
    // компоненты (их же использует кружок), поэтому проверяем контракт по
    // исходникам: запуск, проверку поддержки и честную подпись.
    expect(button).toContain('recognizeVoice(props.messageId, props.src)')
    expect(button).toContain('speechRecognitionSupported()')
    expect(block).toContain('Распознаёт браузер устройства')
  })

  it('перевод расшифровки идёт тем же путём, что и пункт меню (G1)', () => {
    // Одна функция на оба входа: у текста — пункт меню, у голосового и кружка —
    // кнопка под расшифровкой. Иначе кнопки разошлись бы в подписях и действиях.
    expect(block).toContain('toggleTranslation(props.messageId, text)')
    expect(block).toContain('<MessageTranslation')
    const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
    expect(row).toContain('toggleTranslation(props.message.id, props.message.text)')
  })

  it('у голосового и кружка ОДНА оболочка сообщения', () => {
    // Владелец: «сделай, чтобы общим было сообщение целиком, как аудио» —
    // поэтому строка с кнопкой и блок расшифровки живут в MediaMessageShell, а
    // отличается только «плеер» (слот).
    const audio = readFileSync('src/components/media/AudioMessage.vue', 'utf8')
    const round = readFileSync('src/components/media/RoundVideoMessage.vue', 'utf8')
    const shell = readFileSync('src/components/media/MediaMessageShell.vue', 'utf8')
    expect(audio).toContain('<MediaMessageShell')
    expect(round).toContain('<MediaMessageShell')
    expect(shell).toContain('<TranscribeButton')
    expect(shell).toContain('<TranscriptionBlock')
    // Кнопка — по правому краю, и у кружка тоже (владелец: «скорее справа и
    // должен быть»), и живая подпись «Слушаем запись… ru-RU» — тоже справа, причём
    // у голосового ровно так же.
    expect(shell).toContain('margin-left: auto')
    expect(block).toContain('text-align: right')
    // У кружка оболочка шириной с сам круг, иначе текст расшифровки растягивал
    // строку на всю ленту («текст слишком длинный и далеко уходит влево»).
    expect(round).toContain('.rvm-shell')
    expect(round).toContain('max-width: min(300px, 66vw)')
    // Кружок получает id сообщения от вложения, иначе расшифровка не запомнится.
    expect(attachmentSource).toContain(':message-id="message.id"')
  })

  it('готовый текст можно и скопировать, и распознать заново', async () => {
    // Раньше готовый текст умел только копироваться: старую расшифровку нельзя
    // было переиграть, и человек видел вчерашний результат.
    installTranslator()
    const wrapper = mountVoice()
    await wrapper.find('.am-transcribe').trigger('click')
    await settle()
    recognition.emitResult('прежний текст', true)
    ended?.()
    await vi.waitFor(() => {
      expect(wrapper.find('.am-transcript-text').exists()).toBe(true)
    })

    const labels = wrapper.findAll('.am-transcript-btn').map((item) => item.text())
    // «Перевести» — рядом с копированием: расшифровка и перевод в один шаг (G1).
    expect(labels).toEqual(['Скопировать', 'Перевести', 'Ещё раз'])

    clearTranscript(5)
    wrapper.unmount()
  })

  it('после ошибки блок можно убрать, а повторить — кнопкой «Ещё раз»', async () => {
    // Симптом владельца: «кнопка ещё раз есть, а скрыть нету» — теперь роли
    // разведены, как в остальных состояниях: скрытие сверху, повтор в блоке.
    const wrapper = mountVoice()
    await wrapper.find('.am-transcribe').trigger('click')
    await settle()
    recognition.emit('error', { error: 'network' })
    await vi.waitFor(() => {
      expect(wrapper.find('.am-transcript-error').exists()).toBe(true)
    })
    // Кнопка — значок: подпись живёт в `aria-label` (по ней её читает скринридер),
    // а состояние — классом.
    expect(wrapper.find('.am-transcribe').attributes('aria-label')).toContain('Скрыть')
    expect(wrapper.find('.am-transcribe').classes()).toContain('active')

    const retry = wrapper.findAll('.am-transcript-btn').find((item) => item.text() === 'Ещё раз')
    expect(retry).toBeTruthy()

    // «Ещё раз» именно запускает распознавание заново (второй прогон — второй
    // зарегистрированный кусок записи).
    await retry?.trigger('click')
    await vi.waitFor(() => {
      expect(transcriptOf(5)?.status).toBe('running')
    })
    expect(chunks.length).toBeGreaterThan(1)

    // Отмена (та же верхняя кнопка в состоянии «Распознаём…») снова даёт ошибку…
    await wrapper.find('.am-transcribe').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('.am-transcript-error').exists()).toBe(true)
    })

    // …а в спокойном состоянии верхняя кнопка убирает расшифровку.
    expect(wrapper.find('.am-transcribe').classes()).toContain('active')
    await wrapper.find('.am-transcribe').trigger('click')
    expect(wrapper.find('.am-transcript').exists()).toBe(false)

    clearTranscript(5)
    wrapper.unmount()
  })
})
