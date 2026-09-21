/**
 * Расшифровка голосовых в текст — распознавание речи браузером.
 *
 * Почему так, а не сервер: текст голосового в E2EE-чате серверу неизвестен (там
 * только шифротекст), а отправлять аудио на наш сервер ради расшифровки означало
 * бы сломать обещание «сервер не читает переписку». Поэтому расшифровывает
 * устройство: звук идёт в `SpeechRecognition` напрямую, наш сервер в этом не
 * участвует.
 *
 * ЧЕСТНО ПРО ОГРАНИЧЕНИЯ (это важно для ожиданий, а не для кода):
 *
 * 1. `SpeechRecognition` по умолчанию слушает МИКРОФОН. Чтобы расшифровать файл,
 *    используется расширение Chrome — `start(MediaStreamTrack)`: звук файла идёт
 *    через `AudioContext` в `MediaStreamDestination`, а оттуда треком в
 *    распознаватель. Расширение есть только в Chrome на КОМПЬЮТЕРЕ: в Safari и
 *    Firefox его нет вовсе, а мобильный Chrome слушает микрофон и переданный
 *    трек игнорирует (человек видел «Распознавание не получило звук», хотя звук
 *    в записи есть). Там, где так распознать нельзя, считаем МОДЕЛЬЮ НА
 *    УСТРОЙСТВЕ — она скачивается в браузер один раз (`utils/localSpeech.ts`),
 *    работает офлайн и звук никуда не отправляет. Так расшифровка есть и в PWA
 *    на телефоне — без сервера, то есть без нарушения обещания E2EE.
 * 2. У Chrome распознавание НЕ полностью локальное: звук уходит на его сервис
 *    (в расшифровке это видно как ошибку `network`, когда сервис недоступен). Наш
 *    сервер аудио не получает, но браузер — получает. Об этом напоминает подпись
 *    в интерфейсе.
 * 3. Язык распознавания по умолчанию — русский (интерфейс тоже русский), и его
 *    можно выбрать вручную. Системный язык тут не годится: русская речь на
 *    английской модели звучит как «привет» → «private» — человек с русским
 *    языком и английским браузером получал бы чужой текст.
 *
 * ЧТО ДЕЛАЕТ ТОЧНОСТЬ ЛУЧШЕ (проверяемые рычаги, а не надежда):
 *
 * - запись идёт ЧАНКАМИ по ~15 секунд в режиме `continuous: false`: у Chrome
 *   длительный continuous-режим и хуже разбирает слова, и теряет хвост;
 * - после чанка ждём его финальный результат (`stop()` + короткое ожидание),
 *   а не рвём `abort()` — рвать означало терять последние слова;
 * - просим несколько альтернатив (`maxAlternatives`) и берём самую уверенную;
 * - тихую запись усиливаем по пику (нормализация до ~0.5 от шкалы, не больше ×8):
 *   «тихо записал» — частая причина пропущенных слов.
 *
 * Расшифровка живёт в памяти вкладки (модульная карта по id сообщения): она нужна
 * только чтобы текст не пропадал при перерисовке ленты, сохранять её на сервере
 * мы не имеем права.
 */

import { computed, reactive, ref } from 'vue'

import {
  cancelNativeRecognition,
  nativeSpeechSupported,
  recognizeWithNative
} from '@/services/nativeSpeech'
import { isNativeApp } from '@/services/nativePush'
import {
  describeLocalSpeechError,
  ensureLocalSpeech,
  localSpeechCached,
  localSpeechModel,
  localSpeechModelInfo,
  localSpeechSupported,
  transcribeWithLocalSpeech
} from '@/utils/localSpeech'
import { toMono16k, describeAudioError, loadAudioBuffer } from '@/utils/audioPcm'
import { confirmDialog } from '@/utils/appDialogs'

/** Состояние расшифровки одного голосового. */
export type VoiceTranscriptStatus = 'running' | 'ready' | 'failed'

/**
 * Что происходит прямо сейчас — для подписи под записью.
 *
 * Нужно на пути «модель на устройстве»: скачивание модели — это десятки мегабайт,
 * и общее «Слушаем запись…» здесь было бы враньём (человек ждёт и не понимает,
 * почему долго).
 */
export type VoiceTranscriptStage = 'audio' | 'download' | 'recognize'

export interface VoiceTranscript {
  status: VoiceTranscriptStatus
  text: string
  /** Текст ошибки для интерфейса (человеческим языком). */
  error?: string
  /** Этап работы (пусто — обычное распознавание браузером). */
  stage?: VoiceTranscriptStage
  /** Доля выполненного этапа (0–1) — показываем процент скачивания модели. */
  progress?: number
  /**
   * Кто распознавал — от этого зависит честная подпись под текстом:
   * `browser` — сервис браузера, `device` — модель в браузере (звук не уходит),
   * `system` — распознаватель самого устройства в приложении.
   */
  via?: 'browser' | 'device' | 'system'
}

/** Расшифровки по id сообщения (в памяти вкладки, на сервер не уходит). */
const transcripts = reactive<Record<number, VoiceTranscript>>({})

/** Идущие распознавания — чтобы остановить их при закрытии чата. */
const running = new Map<number, () => void>()

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  addEventListener: (type: string, handler: (event: never) => void) => void
  start: (track?: MediaStreamTrack) => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** Конструктор распознавателя в этом браузере (в Chrome — с префиксом). */
const recognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null
  const holder = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null
}

/**
 * Какой это браузер: мобильный ли он и на движке ли Chromium.
 *
 * Нужно, чтобы отличить Chrome на КОМПЬЮТЕРЕ (он умеет распознавать запись) от
 * Chrome на телефоне (он умеет только микрофон). Точный ответ даёт
 * `navigator.userAgentData.mobile`, но он есть только в Chromium — остальным
 * смотрим на строку User-Agent.
 */
const browserKind = (): { mobile: boolean; chromium: boolean } => {
  if (typeof navigator === 'undefined') return { mobile: false, chromium: false }
  const ua = navigator.userAgent ?? ''
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  const known = typeof data?.mobile === 'boolean'
  return {
    mobile: known ? Boolean(data?.mobile) : /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua),
    chromium: known || /Chrome\/|Chromium\//.test(ua)
  }
}

/**
 * Есть ли в этом браузере путь «звук ЗАПИСИ в распознаватель».
 *
 * Расширение `start(MediaStreamTrack)` есть только в Chrome на КОМПЬЮТЕРЕ. В
 * мобильном браузере (Chrome на Android, Safari) распознаватель слушает
 * МИКРОФОН, а переданный трек молча игнорирует — человек получал «Распознавание
 * не получило звук», хотя звук в записи есть (жалоба владельца, 21.09.2026).
 * Узнать это вызовом нельзя (ошибки нет), поэтому смотрим на платформу, а само
 * распознавание в таком браузере не запускаем: иначе вылез бы запрос доступа к
 * микрофону, а затем тот же отказ (см. `recognizeVoice`).
 */
const fileSpeechCapable = (): boolean => {
  const kind = browserKind()
  return kind.chromium && !kind.mobile
}

/**
 * Готов ли путь «браузер» на самом деле: платформа И наличие распознавателя.
 *
 * Одной платформы мало: во встроенных браузерах (Electron, редактор) строка
 * User-Agent тоже хромовая, а сервиса распознавания нет — там падаем на модель
 * на устройстве, которая работает везде (проверено в этой же среде).
 */
const browserFileSpeech = (): boolean => fileSpeechCapable() && recognitionCtor() !== null

/**
 * Каким путём на этом устройстве распознаётся ГОТОВАЯ запись.
 *
 * `system` — распознаватель самого устройства (приложение Pismo, Android 13+);
 * `browser` — Web Speech с передачей звука записи (Chrome на КОМПЬЮТЕРЕ);
 * `device` — модель, скачанная в браузер (`utils/localSpeech.ts`) — путь для
 * телефона и Safari; `null` — распознать нечем.
 *
 * Нужна и интерфейсу (раздел «Устройство»), и самому распознаванию: это
 * единственное место, где решается, какой из трёх путей взять.
 */
export type SpeechEngineKind = 'system' | 'browser' | 'device'

export const speechEngineKind = (): SpeechEngineKind | null => {
  if (nativeSpeechSupported()) return 'system'
  if (browserFileSpeech()) return 'browser'
  if (localSpeechSupported()) return 'device'
  return null
}

/**
 * Можно ли показать кнопку «В текст».
 *
 * Путей три (см. `speechEngineKind`), и здесь проверяется только наличие хоть
 * какого-нибудь: кнопку показываем, а какой путь выбрать — решает
 * `recognizeVoice`. Прятать её оказалось плохо — владелец: «в мобилке теперь
 * вообще пропала кнопка в текст».
 */
export const speechRecognitionSupported = (): boolean => {
  if (speechEngineKind() !== null) return true
  // Последний случай: WebAssembly нет (очень старый браузер), но Web Speech с
  // аудио-графом есть. Распознать запись он всё равно не сможет — кнопку
  // оставляем, чтобы человек прочитал причину, а не искал пропавшую функцию.
  if (recognitionCtor() === null) return false
  if (typeof AudioContext === 'undefined') return false
  return 'createMediaStreamDestination' in AudioContext.prototype
}

/**
 * Почему расшифровки нет — текст для человека, если её всё-таки запустили.
 *
 * Кнопки в таких браузерах нет (см. `speechRecognitionSupported`), но ошибка
 * обязана называть причину и выход, а не «не поддерживается».
 */
const unsupportedReason = (): string => {
  if (isNativeApp()) return 'Распознавание недоступно на этом устройстве'
  return 'Этот браузер не умеет распознавать готовые записи'
}

/**
 * Почему запись не распознать даже моделью — нет WebAssembly (старый браузер).
 *
 * Так у мобильных браузеров без WASM и у встроенных браузеров редакторов: Web
 * Speech есть, но слушает он микрофон, а не запись.
 */
const microphoneOnlyReason = (): string =>
  browserKind().mobile
    ? 'В мобильном браузере распознаётся только микрофон, а не запись — расшифровка есть в приложении Pismo'
    : 'Этот браузер распознаёт только микрофон, а не запись — нужен Chrome на компьютере'

/**
 * Язык распознавания по умолчанию.
 *
 * Берём не системный язык браузера, а русский: интерфейс приложения русский, и
 * большинство голосовых — русские. Системный язык давал «привет» → «private»:
 * русская речь, разобранная английской моделью, превращается в ЧУЖИЕ слова, и
 * человек думает, что распознавание сломано. Свой язык можно выбрать (см.
 * `setSpeechLanguage`), в том числе вернуть системный.
 */
const DEFAULT_LANGUAGE = 'ru-RU'

/** Язык распознавания — русский или выбранный человеком. */
const recognitionLang = (): string => DEFAULT_LANGUAGE

/** Куда помним выбранный язык (настройка устройства, не аккаунта). */
const LANG_KEY = 'pismo_stt_lang'

/**
 * Языки, которые можно выбрать вручную.
 *
 * Зачем выбор вообще: язык ГОЛОСА не связан с языком интерфейса — человек с
 * русским телефоном получает голосовое на английском и наоборот. По опыту это
 * главная причина «распознаёт не то, что говорят». Без выбора остаётся один
 * системный язык, и исправить это человек не может.
 */
export interface SpeechLanguage {
  code: string
  label: string
}

export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = [
  { code: 'ru-RU', label: 'Русский' },
  { code: 'en-US', label: 'English' },
  { code: 'uk-UA', label: 'Українська' },
  { code: 'kk-KZ', label: 'Қазақша' },
  { code: 'tr-TR', label: 'Türkçe' }
]

/** Выбранный язык распознавания (пустая строка — «как в системе»). */
export const speechLanguage = ref<string>('')

/** Читает сохранённый язык (вызывается один раз при старте модуля). */
const readStoredLanguage = (): void => {
  if (typeof localStorage === 'undefined') return
  const stored = localStorage.getItem(LANG_KEY)
  if (stored !== null) speechLanguage.value = stored
}
readStoredLanguage()

/** Меняет язык распознавания и запоминает выбор на устройстве. */
export const setSpeechLanguage = (code: string): void => {
  speechLanguage.value = code
  try {
    if (code) localStorage.setItem(LANG_KEY, code)
    else localStorage.removeItem(LANG_KEY)
  } catch {
    /* приватный режим — просто не помним выбор */
  }
}

/** Язык для распознавателя: выбранный человеком или русский по умолчанию. */
const effectiveLanguage = (): string => speechLanguage.value || recognitionLang()

/**
 * Язык, которым реально идёт распознавание — показывается в интерфейсе.
 *
 * Нужен не для красоты: если текст вышел чужими словами, человек должен видеть,
 * на каком языке его слушали, а не догадываться («привет» → «private» — это
 * английская модель, а не «сломалось распознавание»).
 */
export const speechLanguageInUse = computed<string>(() => effectiveLanguage())

/** Текущее состояние расшифровки сообщения (undefined — не расшифровывали). */
export const transcriptOf = (messageId: number): VoiceTranscript | undefined =>
  transcripts[messageId]

/** Что делает значок расшифровки при текущем состоянии. */
export type TranscriptAction = 'recognize' | 'hide' | 'cancel'

/**
 * Действие кнопки по состоянию расшифровки.
 *
 * Кнопка в шапке голосового — единый значок-переключатель: распознать → «Распознаём…»
 * → «Скрыть текст». Ошибка — не исключение: скрытие везде на одном месте, и
 * человек не ищет глазами, что кнопка делает СЕЙЧАС. А повтор живёт в самом
 * блоке расшифровки («Ещё раз»), рядом с причиной ошибки — там он по делу.
 */
export const transcriptActionFor = (current?: VoiceTranscript): TranscriptAction => {
  if (!current) return 'recognize'
  if (current.status === 'running') return 'cancel'
  return 'hide'
}

/** Убирает расшифровку (кнопка «Скрыть») — чтобы текст не оставался на экране. */
export const clearTranscript = (messageId: number): void => {
  stopRecognition(messageId)
  delete transcripts[messageId]
}

/** Останавливает идущее распознавание (уход из чата, повторный запуск). */
export const stopRecognition = (messageId: number): void => {
  running.get(messageId)?.()
}

/** Останавливает все распознавания (сменился чат — старые не нужны). */
export const stopAllRecognitions = (): void => {
  for (const stop of Array.from(running.values())) stop()
}

/** Сколько секунд записи отдаём распознавателю за один проход. */
const CHUNK_SECONDS = 15
/** Сколько ждём финальный результат чанка после его конца (мс). */
const CHUNK_FLUSH_MS = 1500
/** Сколько секунд слушаем один чанк вместе с запасом (мс). */
const CHUNK_LIMIT_MS = (CHUNK_SECONDS + 12) * 1000

/**
 * Приводит ошибку нативного слоя к тексту для человека.
 *
 * Нативная часть присылает либо КОД (как у браузера: `no-speech`, `network`,
 * `not-allowed`, `aborted`), либо готовую фразу («Запись слишком длинная для
 * расшифровки»). Коды переводим знакомыми словами, фразы оставляем как есть.
 */
const nativeErrorText = (error?: string): string => {
  const value = (error ?? '').trim()
  if (!value || value === 'other') return 'Не удалось распознать голосовое'
  if (value === 'aborted') return errorMessage('aborted', false)
  if (value === 'network' || value === 'not-allowed' || value === 'service-not-allowed') {
    return errorMessage(value, false)
  }
  if (value === 'no-speech') {
    // Системный распознаватель читал запись: «не разобрал», а не «не слышал».
    return errorMessage('no-speech', true)
  }
  return value
}

/** Ошибка распознавания → понятный текст (коды у браузеров общие). */
const errorMessage = (code: string, heard: boolean): string => {
  if (code === 'network') return 'Браузер не смог обратиться к своему сервису распознавания'
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Браузер запретил распознавание речи'
  }
  if (code === 'aborted') return 'Распознавание отменено'
  // «Слышал, но не разобрал» и «вообще не получил звук» — разные проблемы, и
  // человеку важно знать, какую из них чинить (браузер/поток или сама запись).
  if (code === 'no-speech' && !heard) {
    return 'Распознавание не получило звук — попробуйте ещё раз'
  }
  if (code === 'no-speech') return 'Речь не разобрана — возможно, в записи тихо или шумно'
  return 'Не удалось распознать голосовое'
}

/** Состояние одного прогона распознавания (отмена по кнопке и при уходе из чата). */
interface RunState {
  cancelled: boolean
  cancelChunk: (() => void) | null
}

/** Итог распознавания одного куска записи. */
interface ChunkResult {
  text: string
  heard: boolean
  error: string | null
}

/** Альтернативы одного результата: у каждой свой текст и уверенность. */
interface SpeechAlternative {
  transcript: string
  confidence?: number
}

/**
 * Дописывает фрагмент речи, сохраняя границу между словами.
 *
 * Chrome не обязан добавлять пробел в конце фрагмента, и без этого склейка
 * давала «приветмир».
 */
const appendPart = (base: string, part: string): string => {
  if (!part) return base
  if (!base) return part
  return /\s$/.test(base) || /^\s/.test(part) ? `${base}${part}` : `${base} ${part}`
}

/**
 * Текст самой уверенной альтернативы.
 *
 * Уверенность ставит только Chrome и только у финальных фрагментов; альтернатива
 * обычно одна, поэтому выбор — страховка, а не основа. Свойство
 * `maxAlternatives` не трогаем: Chrome его фактически не поддерживает, а лишний
 * параметр может увести распознавание на другую ветку (и тогда язык перестаёт
 * учитываться).
 */
const bestAlternative = (result: {
  length: number
  [index: number]: SpeechAlternative
}): string => {
  let best = result[0]
  for (let index = 1; index < result.length; index += 1) {
    const candidate = result[index]
    if ((candidate.confidence ?? 0) > (best.confidence ?? 0)) best = candidate
  }
  return best ? best.transcript : ''
}

/**
 * Распознаёт ОДИН кусок записи: отдаёт его звуком и ждёт фрагменты.
 *
 * Отдельный проход на кусок — потому что Chrome в длительном `continuous`-режиме
 * разбирает слова хуже и не отдаёт нормальный финальный результат. Кусок
 * заканчивается — просим `stop()` (он доводит фрагмент до финального) и ждём
 * короткое окно; `abort()` здесь был бы ошибкой: он выбрасывает незавершённый
 * фрагмент, из-за чего терялись последние слова.
 */
async function recognizeChunk(
  Ctor: SpeechRecognitionCtor,
  ctx: AudioContext,
  buffer: AudioBuffer,
  offset: number,
  duration: number,
  run: RunState,
  onProgress: (text: string) => void
): Promise<ChunkResult> {
  const destination = ctx.createMediaStreamDestination()
  const source = ctx.createBufferSource()
  source.buffer = buffer
  // Путь к `ctx.destination` через приглушённый усилитель: без него Chrome
  // не рендерит граф, и в поток уходит тишина.
  const silent = ctx.createGain()
  silent.gain.value = 0
  source.connect(destination)
  source.connect(silent)
  silent.connect(ctx.destination)
  const track = destination.stream.getAudioTracks()[0]
  if (!track) return { text: '', heard: false, error: 'Не удалось подготовить звук' }

  const recognition = new Ctor()
  recognition.lang = effectiveLanguage()
  recognition.continuous = false
  recognition.interimResults = true

  let finalText = ''
  let interimText = ''
  let heard = false
  let error: string | null = null
  let done = false
  let flushTimer: number | null = null

  const collected = (): string => {
    const base = finalText.trim()
    if (!interimText) return base
    return base ? `${base} ${interimText}` : interimText
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      if (done) return
      done = true
      if (flushTimer !== null) window.clearTimeout(flushTimer)
      run.cancelChunk = null
      resolve()
    }
    /** Гасим кусок сразу при отмене — ждать его конца человеку не за чем. */
    const teardown = () => {
      try {
        recognition.abort()
      } catch {
        /* уже остановлено */
      }
      try {
        source.stop()
      } catch {
        /* уже остановлен */
      }
    }
    run.cancelChunk = () => {
      teardown()
      finish()
    }

    const limit = window.setTimeout(finish, CHUNK_LIMIT_MS)

    recognition.addEventListener('soundstart', () => {
      heard = true
    })
    recognition.addEventListener('speechstart', () => {
      heard = true
    })
    recognition.addEventListener('result', (event: never) => {
      const payload = event as unknown as {
        resultIndex: number
        results: {
          length: number
          [index: number]: { isFinal: boolean; length: number; [alt: number]: SpeechAlternative }
        }
      }
      heard = true
      let interim = ''
      for (let index = payload.resultIndex; index < payload.results.length; index += 1) {
        const result = payload.results[index]
        const text = bestAlternative(result)
        if (result.isFinal) finalText = appendPart(finalText, text)
        else interim = appendPart(interim, text)
      }
      interimText = interim.trim()
      onProgress(collected())
    })
    recognition.addEventListener('error', (event: never) => {
      const code = String((event as unknown as { error?: string }).error ?? '')
      // Текст уже есть — ошибку не показываем: для человека важен текст.
      if (!collected()) error = errorMessage(code, heard)
      window.clearTimeout(limit)
      finish()
    })
    recognition.addEventListener('end', () => {
      window.clearTimeout(limit)
      finish()
    })
    source.addEventListener('ended', () => {
      // Запись куска кончилась: доводим распознавание до финального результата.
      try {
        recognition.stop()
      } catch {
        /* уже остановлено */
      }
      flushTimer = window.setTimeout(finish, CHUNK_FLUSH_MS)
    })

    source.start(0, offset, duration)
    try {
      recognition.start(track)
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : 'Не удалось запустить распознавание'
      window.clearTimeout(limit)
      finish()
    }
  })

  // Освобождаем всё, что осталось от куска (при отмене это уже сделано —
  // повторный вызов безвреден).
  try {
    recognition.abort()
  } catch {
    /* уже остановлено */
  }
  try {
    source.stop()
  } catch {
    /* уже остановлен */
  }
  return { text: collected(), heard, error }
}

/**
 * Расшифровывает голосовое сообщение.
 *
 * Текст никуда не отправляется: результат кладётся в память вкладки и
 * показывается под сообщением. Путь выбирается по возможностям устройства:
 * в Android-обёртке распознаёт САМО устройство (в WebView Web Speech нет),
 * в Chrome на компьютере — Web Speech API кусками по `CHUNK_SECONDS` (так точнее,
 * см. `recognizeChunk`), в остальных браузерах (телефон, Safari) — модель,
 * скачанная в браузер (`utils/localSpeech.ts`).
 */
export const recognizeVoice = async (messageId: number, src: string): Promise<void> => {
  const kind = speechEngineKind()
  if (kind === null) {
    // Распознать запись нечем: объясняем причину (и выход) вместо пустого экрана.
    transcripts[messageId] = {
      status: 'failed',
      text: '',
      error: speechRecognitionSupported() ? microphoneOnlyReason() : unsupportedReason()
    }
    return
  }
  // Повторный запуск по тому же сообщению — начинаем заново.
  stopRecognition(messageId)

  // Модель на устройстве: так распознаём там, где Web Speech ушёл бы в МИКРОФОН
  // (мобильный браузер, Safari, Firefox). Звук остаётся на устройстве, модель
  // скачивается один раз и только с согласия человека.
  if (kind === 'device') {
    transcripts[messageId] = { status: 'running', text: '', via: 'device' }
    await recognizeVoiceLocally(messageId, src, transcriptFinisher(messageId, 'device'))
    return
  }

  // Распознаватель самого устройства (приложение Pismo).
  if (kind === 'system') {
    transcripts[messageId] = { status: 'running', text: '' }
    await recognizeVoiceNatively(messageId, src, transcriptFinisher(messageId, 'system'))
    return
  }

  // Остался `browser`: Web Speech с передачей звука ЗАПИСИ (Chrome на компьютере).
  transcripts[messageId] = { status: 'running', text: '' }

  const finish = transcriptFinisher(messageId)

  const Ctor = recognitionCtor()
  if (Ctor === null) {
    finish({ status: 'failed', text: '', error: microphoneOnlyReason() })
    return
  }

  const run: RunState = { cancelled: false, cancelChunk: null }
  running.set(messageId, () => {
    run.cancelled = true
    run.cancelChunk?.()
  })

  const ctx = new AudioContext()
  try {
    // ГРАБЛЯ (симптом владельца: «речь всё время не распознана, хотя голос
    // есть»): контекст создаётся ПОСЛЕ await'ов, то есть уже вне жеста
    // пользователя — Chrome оставляет такой контекст в состоянии `suspended`,
    // граф не рендерится, и распознаватель получает ТИШИНУ.
    if (ctx.state === 'suspended') await ctx.resume()
    const buffer = await loadAudioBuffer(ctx, src)

    const parts: string[] = []
    let heardAny = false
    let lastError: string | null = null

    for (let offset = 0; offset < buffer.duration; offset += CHUNK_SECONDS) {
      if (run.cancelled) break
      const duration = Math.min(CHUNK_SECONDS, buffer.duration - offset)
      const chunk = await recognizeChunk(Ctor, ctx, buffer, offset, duration, run, (progress) => {
        const text = [...parts, progress].filter(Boolean).join(' ').trim()
        transcripts[messageId] = { status: 'running', text }
      })
      if (chunk.text) parts.push(chunk.text)
      heardAny = heardAny || chunk.heard
      if (chunk.error) lastError = chunk.error
      transcripts[messageId] = { status: 'running', text: parts.join(' ').trim() }
    }

    if (run.cancelled) {
      finish({
        status: 'failed',
        text: parts.join(' ').trim(),
        error: errorMessage('aborted', heardAny)
      })
      return
    }
    const text = parts.join(' ').trim()
    if (text) {
      finish({ status: 'ready', text })
      return
    }
    finish({
      status: 'failed',
      text: '',
      error: lastError ?? errorMessage('no-speech', heardAny)
    })
  } catch (thrown) {
    finish({
      status: 'failed',
      text: '',
      error: describeAudioError(thrown)
    })
  } finally {
    void ctx.close()
  }
}

/**
 * Общий «завершитель» расшифровки: закрывает прогон ровно один раз и не даёт
 * вернуть уже скрытый текст (человек мог нажать «Скрыть», пока шло распознавание).
 *
 * `via` — кто распознавал: подпись под текстом говорит разное про браузер (звук
 * может уходить его сервису) и про модель на устройстве (не уходит никуда).
 */
function transcriptFinisher(
  messageId: number,
  via: VoiceTranscript['via'] = 'browser'
): (state: VoiceTranscript) => void {
  let finished = false
  return (state: VoiceTranscript) => {
    if (finished) return
    finished = true
    running.delete(messageId)
    if (transcripts[messageId]) transcripts[messageId] = { via, ...state }
  }
}

/**
 * Расшифровка моделью НА УСТРОЙСТВЕ (браузер: телефон, Safari, Firefox).
 *
 * Порядок такой, и он важен человеку: сначала спрашиваем согласие на скачивание
 * (десятки мегабайт), потом готовим звук, потом скачиваем модель и, наконец,
 * считаем. Каждый этап виден в подписи под записью — иначе ожидание выглядит
 * как «зависло».
 */
async function recognizeVoiceLocally(
  messageId: number,
  src: string,
  finish: (state: VoiceTranscript) => void
): Promise<void> {
  const model = localSpeechModel()
  const info = localSpeechModelInfo(model)

  if (!(await localSpeechCached(model))) {
    // Скачивание модели — это расход трафика на устройстве человека, поэтому
    // только с его согласия и с честным размером в подписи.
    const agreed = await confirmDialog({
      title: 'Расшифровка на устройстве',
      message:
        `Скачается модель распознавания (${info.title}, ~${info.sizeMb} МБ) — один раз. ` +
        'Дальше расшифровка работает без интернета, звук и текст остаются на устройстве.',
      okLabel: 'Скачать',
      cancelLabel: 'Отменить'
    })
    if (!agreed) {
      finish({
        status: 'failed',
        text: '',
        error: 'Расшифровка отменена — модель не скачана'
      })
      return
    }
  }

  let cancelled = false
  running.set(messageId, () => {
    cancelled = true
  })

  const stage = (patch: Partial<VoiceTranscript>): void => {
    transcripts[messageId] = { status: 'running', text: '', via: 'device', ...patch }
  }

  try {
    // Звук: декодируем запись и приводим к 16 кГц моно — как у браузерного пути,
    // вместе с усилением тихой записи.
    stage({ stage: 'audio' })
    const ctx = new AudioContext()
    let audio: Float32Array
    try {
      if (ctx.state === 'suspended') await ctx.resume()
      audio = await toMono16k(await loadAudioBuffer(ctx, src))
    } finally {
      void ctx.close()
    }
    if (cancelled) {
      finish({ status: 'failed', text: '', error: errorMessage('aborted', true) })
      return
    }

    stage({ stage: 'download' })
    const pipeline = await ensureLocalSpeech(model, (share) => {
      stage({ stage: 'download', progress: share })
    })
    if (cancelled) {
      finish({ status: 'failed', text: '', error: errorMessage('aborted', true) })
      return
    }

    stage({ stage: 'recognize' })
    const text = await transcribeWithLocalSpeech(pipeline, audio, effectiveLanguage())
    if (cancelled) {
      finish({ status: 'failed', text: '', error: errorMessage('aborted', true) })
      return
    }
    if (text) {
      finish({ status: 'ready', text })
      return
    }
    // Модель прослушала запись и не нашла речи: это не «не получило звук», а
    // «не разобрала» — говорим именно так.
    finish({ status: 'failed', text: '', error: errorMessage('no-speech', true) })
  } catch (thrown) {
    finish({ status: 'failed', text: '', error: describeLocalSpeechError(thrown) })
  } finally {
    running.delete(messageId)
  }
}

/**
 * Расшифровка силами устройства (Android-обёртка): звук уходит в системный
 * распознаватель файлом, результат приходит событием `pismo:speech`.
 *
 * Кнопка отмены регистрируется так же, как в браузерном пути, — поэтому уход из
 * чата останавливает и это распознавание.
 */
async function recognizeVoiceNatively(
  messageId: number,
  src: string,
  finish: (state: VoiceTranscript) => void
): Promise<void> {
  running.set(messageId, () => cancelNativeRecognition(messageId))
  try {
    const result = await recognizeWithNative(messageId, src, effectiveLanguage(), (partial) => {
      const text = partial.trim()
      if (text) transcripts[messageId] = { status: 'running', text }
    })
    if (result.status === 'ready' && result.text.trim()) {
      finish({ status: 'ready', text: result.text.trim() })
      return
    }
    finish({
      status: 'failed',
      text: '',
      error: nativeErrorText(result.error)
    })
  } catch (thrown) {
    finish({
      status: 'failed',
      text: '',
      error: describeAudioError(thrown)
    })
  } finally {
    running.delete(messageId)
  }
}
