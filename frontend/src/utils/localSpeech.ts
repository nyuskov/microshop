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
 * Как положить и обновить файлы — см. `docs/on-device-transcription.md`.
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
    /** Рантайм ONNX: без явных путей он тянет .wasm с чужого CDN. */
    backends?: { onnx?: { wasm?: { wasmPaths?: unknown } } }
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
  // `undefined` — «ещё не проверяли»: `null` здесь означал бы «проверили, своих
  // файлов нет» и запретил бы пробу на весь сеанс.
  ownAssets = undefined
}

/** Чем поднимаем движок по URL: обычный динамический импорт. */
type EngineImporter = (url: string) => Promise<LocalSpeechEngine>

const defaultImporter: EngineImporter = (url) =>
  import(/* @vite-ignore */ url) as unknown as Promise<LocalSpeechEngine>

let importEngine: EngineImporter = defaultImporter

/**
 * Подменить импорт движка — для тестов.
 *
 * Настоящий импорт тянет из сети мегабайты и запускает ONNX: в юнит-тестах это
 * невозможно, а проверить надо, что из своего каталога мы берём и рантайм, и
 * модели, а при сбое честно откатываемся на публичный CDN.
 */
export const setLocalSpeechImporter = (importer: EngineImporter | null): void => {
  importEngine = importer ?? defaultImporter
  engine = null
  ownAssets = undefined
  pipelines.clear()
}

/** Есть ли в браузере WebAssembly — без него модель не запустить. */
export const localSpeechSupported = (): boolean => typeof WebAssembly !== 'undefined'

/**
 * Что лежит у нас на сервере в `/stt/` (файл `manifest.json`).
 *
 * `engine` — имя файла с движком (собранным нами одним модулем: у пакета из npm
 * есть внешние зависимости, в браузере их взять неоткуда). `models` — лежат ли
 * там же модели: без них берём с Hugging Face, как раньше.
 */
interface OwnAssets {
  engine: string
  models: boolean
}

let ownAssets: OwnAssets | null | undefined = undefined

const ownAssetsManifest = async (): Promise<OwnAssets | null> => {
  if (ownAssets !== undefined) return ownAssets
  ownAssets = null
  try {
    const response = await fetch(`${ASSET_BASE}manifest.json`, { cache: 'no-store' })
    if (response.ok) {
      const manifest = (await response.json()) as { engine?: unknown; models?: unknown } | null
      if (typeof manifest?.engine === 'string' && manifest.engine) {
        ownAssets = { engine: manifest.engine, models: manifest.models === true }
      }
    }
  } catch {
    // Нет своего каталога — нормально: работаем через публичный CDN.
    ownAssets = null
  }
  return ownAssets
}

/**
 * Есть ли у нас своя раздача движка и моделей — для тестов и раздела «Устройство».
 *
 * Наружу открыта ради проверки грабли с фолбэком: без неё легко снова решить,
 * что файлы есть, и упасть на первом же импорте.
 */
export const ownSpeechAssetsAvailable = async (): Promise<boolean> =>
  (await ownAssetsManifest()) !== null

/** Загруженный движок: один на вкладку. */
let engine: Promise<LocalSpeechEngine> | null = null

const loadEngine = async (): Promise<LocalSpeechEngine> => {
  if (engineLoader) return await engineLoader()
  if (engine) return await engine
  const assets = await ownAssetsManifest()

  /**
   * Поднимает движок: со своего сервера или с публичного CDN.
   *
   * В своём режиме рядом с движком лежат и файлы рантайма ONNX — говорим об этом
   * явно (`wasmPaths`), иначе движок потянул бы `.wasm` с чужого CDN, а именно
   * из-за него расшифровка и не запускалась на телефоне (владелец: «всё равно не
   * удалось загрузить движок с телефона»).
   */
  const setup = async (mode: 'own' | 'cdn'): Promise<LocalSpeechEngine> => {
    const url = mode === 'own' && assets ? `${ASSET_BASE}${assets.engine}` : ENGINE_CDN
    // Импорт по URL: сборщик сюда не лезет (`@vite-ignore`), а модуль попадает в
    // бандл только на телефоне и только при первом распознавании.
    const module = await importEngine(url)
    module.env.allowLocalModels = false
    module.env.useBrowserCache = true
    if (mode === 'own' && assets) {
      module.env.backends ??= {}
      module.env.backends.onnx ??= {}
      module.env.backends.onnx.wasm ??= {}
      module.env.backends.onnx.wasm.wasmPaths = ASSET_BASE
      if (assets.models) {
        module.env.remoteHost = new URL(ASSET_BASE, location.origin).toString().replace(/\/$/, '')
        module.env.remotePathTemplate = 'models/{model}/resolve/main/'
      }
    }
    return module
  }

  engine = (async () => {
    if (assets) {
      try {
        return await setup('own')
      } catch (error) {
        // Свои файлы могли не дойти — тогда всё берём с публичного CDN (и модели в
        // том числе), а не оставляем человека с отказом на ровном месте. Причину
        // пишем в консоль: по ней потом видно, что именно не отдал сервер.
        console.warn('[stt] свой движок не поднялся, беру с CDN', error)
        ownAssets = null
      }
    }
    return await setup('cdn')
  })()
  return await engine
}

/** Загруженные модели: одна на вкладку (десятки мегабайт, пересоздавать незачем). */
const pipelines = new Map<LocalSpeechModelKey, Promise<LocalSpeechPipeline>>()

/**
 * Слабое устройство: тогда берём модель поменьше, иначе она не успеет.
 *
 * Порог — 4 ядра и 4 ГБ. Так телефон, у которого браузер показывает ровно 4 ГБ
 * (частый случай у Android), получает модель «точнее»: на «быстрой» он уверенно
 * путает слова, а расшифровка нужна именно ради слов. Совсем слабые устройства
 * (2 ГБ или 2 ядра) всё равно остаются на «быстрой» — большая модель там не
 * поместится в память.
 */
const deviceIsWeak = (): boolean => {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const cores = navigator.hardwareConcurrency
  if (typeof memory === 'number' && memory > 0 && memory < 4) return true
  return typeof cores === 'number' && cores > 0 && cores < 4
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
 * Со скольких слов фраза считается повтором, а не обычной речью.
 *
 * Два слова — минимум: повтор в два слова модель выдаёт десятками («продолжение
 * следует», «спасибо за просмотр»), а одиночные слова не трогаем вовсе — иначе
 * «да да да» превратилось бы в «да».
 */
const MIN_REPEAT_WORDS = 2

/**
 * Схлопывает зацикливание модели: фраза три раза подряд — это сбой, а не речь.
 *
 * На тихой или шумной записи Whisper уходит в повтор: одни и те же слова идут
 * десятками («спасибо за просмотр», «продолжение следует»). Человеку это читать
 * незачем, а в записи это не исправить — поэтому оставляем фразу один раз, а
 * остальное убираем. Повторить фразу трижды подряд человек почти не может, а
 * короткое «да, да, да» под правило не попадает (это одно слово, не фраза).
 */
export const collapseRepeats = (text: string): string => {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length < 9) return trimmed
  const kept: string[] = []
  let index = 0
  while (index < words.length) {
    let collapsed = false
    // Размер фразы перебираем ОТ МАЛОГО к большему: у повтора в два слова
    // («продолжение следует») больший размер захватил бы сразу несколько копий и
    // оставил их в тексте.
    for (let size = MIN_REPEAT_WORDS; size <= 12; size += 1) {
      if (index + size * 3 > words.length) break
      const phrase = words.slice(index, index + size).join(' ')
      let count = 1
      // Сравниваем без регистра: повтор начинается с заглавного слова («Спасибо
      // за просмотр»), а дальше идёт со строчных — с учётом регистра повтор
      // распознался бы только со второго круга, и в тексте остались бы две копии.
      const key = phrase.toLowerCase()
      while (
        words
          .slice(index + count * size, index + (count + 1) * size)
          .join(' ')
          .toLowerCase() === key
      ) {
        count += 1
      }
      if (count >= 3) {
        kept.push(phrase)
        index += count * size
        collapsed = true
        break
      }
    }
    if (!collapsed) {
      kept.push(words[index])
      index += 1
    }
  }
  return kept.join(' ')
}

/**
 * Распознаёт звук готовым распознавателем.
 *
 * `language` — код вида `ru-RU`, Whisper ждёт короткий (`ru`).
 *
 * Пустую строку переводим в РУССКИЙ, а не «определи сам»: без языка движок молча
 * берёт английский и ПЕРЕВОДИТ русскую речь — живьём вышло «Hi. How are you?».
 * Тот же выбор по умолчанию в `voiceRecognition.ts` (`DEFAULT_LANGUAGE`).
 */
export async function transcribeWithLocalSpeech(
  pipeline: LocalSpeechPipeline,
  audio: Float32Array,
  language: string
): Promise<string> {
  const short = (language || 'ru').split('-')[0]?.toLowerCase() || 'ru'
  const result = await pipeline(audio, {
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    language: short
  })
  return collapseRepeats(result.text ?? '')
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
  if (/dynamically imported module|import|module/i.test(text)) {
    return 'Не удалось загрузить движок распознавания — проверьте подключение к интернету'
  }
  if (/fetch|network|load|connect|abort/i.test(text)) {
    return 'Не удалось скачать модель — проверьте подключение к интернету и попробуйте снова'
  }
  return text || 'Не удалось распознать запись на устройстве'
}
