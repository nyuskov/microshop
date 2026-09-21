/**
 * Распознавание речи НА УСТРОЙСТВЕ моделью в браузере (Whisper в WebAssembly).
 *
 * Зачем: расшифровать готовую запись прямо в браузере телефона больше нечем —
 * `SpeechRecognition` там слушает МИКРОФОН, а расширение `start(MediaStreamTrack)`
 * (звук ФАЙЛА в распознаватель) есть только в Chrome на компьютере. См.
 * `utils/voiceRecognition.ts`. Здесь звук никуда не уходит: модель скачивается в
 * браузер один раз и дальше работает офлайн, поэтому обещание E2EE не ломается —
 * наш сервер в распознавании не участвует вовсе.
 *
 * Замеры (компьютер, WASM без WebGPU, 18 с русской речи):
 *   tiny — 42 МБ, 2.1 с (×8.7 к реальному времени);
 *   base — 76 МБ, 3.1 с (×5.7), разборчивее на числах и окончаниях.
 * На телефоне ожидаемо в 3–8 раз медленнее — поэтому модель выбирается по
 * устройству (`defaultLocalSpeechModel`), а скачивание идёт только с согласия
 * человека (`recognizeVoice` спрашивает перед первым разом).
 *
 * Почему движок подключается по URL, а не из зависимостей: пакет
 * `@huggingface/transformers` тянет за собой свой рантайм (ONNX), то есть десятки
 * мегабайт и правку lock-файла ради того, что нужно только на телефоне. Здесь он
 * грузится ДИНАМИЧЕСКИ и только при первом распознавании, поэтому в основной
 * бандл не попадает (бюджет веса в CI) — а версия закреплена строкой ниже.
 */

/** Модели, между которыми выбираем. `id` — репозиторий модели. */
export type LocalSpeechModelKey = 'tiny' | 'base'

export interface LocalSpeechModelInfo {
  key: LocalSpeechModelKey
  /** Имя модели в терминах движка (совпадает с репозиторием на Hugging Face). */
  id: string
  title: string
  /** Сколько примерно скачивать — показываем человеку ДО скачивания. */
  sizeMb: number
}

export const LOCAL_SPEECH_MODELS: Record<LocalSpeechModelKey, LocalSpeechModelInfo> = {
  tiny: { key: 'tiny', id: 'Xenova/whisper-tiny', title: 'быстрая', sizeMb: 42 },
  base: { key: 'base', id: 'Xenova/whisper-base', title: 'точнее', sizeMb: 76 }
}

/** Версия движка: должна совпадать с моделями и с форматом кэша браузера. */
const ENGINE_VERSION = '3.6.0'
const ENGINE_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${ENGINE_VERSION}`

/**
 * Своя раздача движка и моделей (`/stt/…`): если наш сервер их отдаёт, берём оттуда
 * — тогда распознавание не зависит от чужого CDN (важно для сетей, где он медленный).
 * Как положить файлы — см. `docs/gotchas.md`, раздел про модель распознавания.
 */
const ASSET_BASE = '/stt/'

/** Кэш моделей в браузере: так их называет движок (`env.useBrowserCache`). */
const MODEL_CACHE = 'transformers-cache'

/**
 * Минимум того, что мы берём у движка.
 *
 * Свои типы, потому что пакета в зависимостях нет (см. шапку файла): так ошибка
 * «движок поменял API» видна здесь, в одном месте, а не где-то в вызове.
 */
export interface LocalSpeechPipeline {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text?: string }>
}

export interface LocalSpeechEngine {
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>
  ) => Promise<LocalSpeechPipeline>
  env: {
    allowLocalModels: boolean
    useBrowserCache: boolean
    /** Откуда брать файлы модели (нужно для своей раздачи). */
    remoteHost?: string
    remotePathTemplate?: string
  }
}

/** Ошибка внутри движка: `progress_callback` приходит с этими полями. */
interface ProgressEvent {
  status?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}

let engineLoader: (() => Promise<LocalSpeechEngine>) | null = null

/**
 * Подменить движок — для тестов и ручной проверки.
 *
 * Без этого движок грузится по URL: настоящую модель (десятки мегабайт и запуск
 * ONNX) в юнит-тестах поднимать нельзя.
 */
export const setLocalSpeechEngine = (loader: (() => Promise<LocalSpeechEngine>) | null): void => {
  engineLoader = loader
  pipelines.clear()
  ownAssets = null
}

/** Есть ли в браузере WebAssembly — без него модель не запустить. */
export const localSpeechSupported = (): boolean => typeof WebAssembly !== 'undefined'

/** Отдаёт ли наш сервер движок и модели (`/stt/manifest.json`). */
let ownAssets: boolean | null = null

const ownAssetsAvailable = async (): Promise<boolean> => {
  if (ownAssets !== null) return ownAssets
  try {
    const response = await fetch(`${ASSET_BASE}manifest.json`, { cache: 'no-store' })
    ownAssets = response.ok
  } catch {
    // Нет своего каталога — это нормально: работает и на публичном CDN.
    ownAssets = false
  }
  return ownAssets
}

/** Загруженный движок: один на вкладку. */
let engine: Promise<LocalSpeechEngine> | null = null

const loadEngine = async (): Promise<LocalSpeechEngine> => {
  if (engineLoader) return await engineLoader()
  if (engine) return await engine
  const url = (await ownAssetsAvailable()) ? `${ASSET_BASE}transformers.web.js` : ENGINE_CDN
  engine = (async () => {
    // Импорт по URL: сборщик сюда не лезет (`@vite-ignore`), а модуль попадает в
    // бандл только на телефоне и только при первом распознавании.
    const module = (await import(/* @vite-ignore */ url)) as unknown as LocalSpeechEngine
    module.env.allowLocalModels = false
    module.env.useBrowserCache = true
    if (await ownAssetsAvailable()) {
      // Своя раздача: и модель, и файлы рантайма берём с нашего сервера.
      module.env.remoteHost = new URL(ASSET_BASE, location.origin).toString().replace(/\/$/, '')
      module.env.remotePathTemplate = 'models/{model}/resolve/main/'
    }
    return module
  })()
  return await engine
}

/** Загруженные модели: одна на вкладку (десятки мегабайт, пересоздавать незачем). */
const pipelines = new Map<LocalSpeechModelKey, Promise<LocalSpeechPipeline>>()

/** Слабое устройство: тогда берём модель поменьше, иначе она не успеет. */
const deviceIsWeak = (): boolean => {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const cores = navigator.hardwareConcurrency
  if (typeof memory === 'number' && memory > 0 && memory <= 4) return true
  return typeof cores === 'number' && cores > 0 && cores <= 4
}

/** Модель по умолчанию для этого устройства. */
export const defaultLocalSpeechModel = (): LocalSpeechModelKey => (deviceIsWeak() ? 'tiny' : 'base')

/** Куда помним выбранную модель (настройка устройства, не аккаунта). */
const MODEL_KEY = 'pismo_stt_model'

/** Выбранная модель: помним на устройстве, иначе берём по устройству же. */
export const localSpeechModel = (): LocalSpeechModelKey => {
  try {
    const stored = localStorage.getItem(MODEL_KEY)
    if (stored === 'tiny' || stored === 'base') return stored
  } catch {
    /* приватный режим — просто не помним выбор */
  }
  return defaultLocalSpeechModel()
}

/** Меняет модель и запоминает выбор. */
export const setLocalSpeechModel = (key: LocalSpeechModelKey): void => {
  try {
    localStorage.setItem(MODEL_KEY, key)
  } catch {
    /* приватный режим — не страшно */
  }
}

/** Описание модели (для подписей: «скачается ~42 МБ»). */
export const localSpeechModelInfo = (
  key: LocalSpeechModelKey = localSpeechModel()
): LocalSpeechModelInfo => LOCAL_SPEECH_MODELS[key]

/** Скачана ли модель — по кэшу браузера (иначе спросим согласие). */
export const localSpeechCached = async (key: LocalSpeechModelKey): Promise<boolean> => {
  if (typeof caches === 'undefined') return false
  try {
    const cache = await caches.open(MODEL_CACHE)
    const keys = await cache.keys()
    return keys.some((request) => request.url.includes(LOCAL_SPEECH_MODELS[key].id))
  } catch {
    return false
  }
}

/** Забыть скачанную модель (место на устройстве, «скачалось битым»). */
export const forgetLocalSpeech = async (): Promise<void> => {
  pipelines.clear()
  if (typeof caches === 'undefined') return
  try {
    await caches.delete(MODEL_CACHE)
  } catch {
    /* кэша может не быть вовсе */
  }
}

/**
 * Загружает модель и отдаёт готовый распознаватель.
 *
 * `onDownload` получает долю скачанного (0…1). Считаем её от ОБЪЯВЛЕННОГО размера
 * модели: файлов у неё несколько (энкодер, декодер, словарь), и если брать
 * сумму уже известных итогов, то «100%» показалось бы на первом же файле.
 */
export async function ensureLocalSpeech(
  key: LocalSpeechModelKey,
  onDownload?: (share: number) => void
): Promise<LocalSpeechPipeline> {
  const existing = pipelines.get(key)
  if (existing) return await existing
  const loading = (async () => {
    const module = await loadEngine()
    const sizes = new Map<string, { loaded: number; total: number }>()
    // Своя нижняя граница: сколько всего качать — знаем из каталога моделей.
    const declared = LOCAL_SPEECH_MODELS[key].sizeMb * 1024 * 1024
    const report = (event: ProgressEvent): void => {
      if (!onDownload || !event.file) return
      const total = typeof event.total === 'number' && event.total > 0 ? event.total : 0
      const loaded =
        typeof event.loaded === 'number'
          ? event.loaded
          : typeof event.progress === 'number' && total > 0
            ? (event.progress / 100) * total
            : 0
      if (!total) return
      sizes.set(event.file, { loaded, total })
      let sum = 0
      let all = 0
      for (const item of sizes.values()) {
        sum += item.loaded
        all += item.total
      }
      const basis = Math.max(declared, all)
      if (basis > 0) onDownload(Math.min(1, sum / basis))
    }
    const pipeline = await module.pipeline(
      'automatic-speech-recognition',
      LOCAL_SPEECH_MODELS[key].id,
      {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: report
      }
    )
    onDownload?.(1)
    return pipeline
  })()
  pipelines.set(key, loading)
  try {
    return await loading
  } catch (thrown) {
    // Неудачу не запоминаем: следующая попытка должна скачать заново, а не
    // вечно возвращать ту же ошибку.
    pipelines.delete(key)
    throw thrown
  }
}

/**
 * Распознаёт звук готовым распознавателем.
 *
 * `language` — код вида `ru-RU`; Whisper ждёт короткий код (`ru`), а пустая строка
 * означает «определи сам».
 */
export async function transcribeWithLocalSpeech(
  pipeline: LocalSpeechPipeline,
  audio: Float32Array,
  language: string
): Promise<string> {
  const short = language ? language.split('-')[0]?.toLowerCase() : ''
  const result = await pipeline(audio, {
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(short ? { language: short } : {})
  })
  return (result.text ?? '').trim()
}

/**
 * Понятный текст ошибки: сеть при скачивании, место на устройстве, память.
 *
 * Разбирать «Failed to fetch» человеку нечем, а причины у этих отказов разные —
 * и лечатся по-разному: включить интернет, освободить место, взять модель меньше.
 */
export const describeLocalSpeechError = (thrown: unknown): string => {
  const text = thrown instanceof Error ? thrown.message : String(thrown ?? '')
  if (/quota|storage/i.test(text)) {
    return 'В браузере не хватило места для модели — освободите место и попробуйте снова'
  }
  if (/memory|allocation|array buffer|out of/i.test(text)) {
    return 'Модель не поместилась в память устройства — попробуйте модель «быстрая»'
  }
  if (/fetch|network|load|connect|abort/i.test(text)) {
    return 'Не удалось скачать модель — проверьте подключение к интернету и попробуйте снова'
  }
  return text || 'Не удалось распознать запись на устройстве'
}
