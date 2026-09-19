/**
 * Перевод сообщений — встроенным переводчиком браузера НА УСТРОЙСТВЕ.
 *
 * Почему так, а не внешним API: текст сообщения в E2EE-чате серверу неизвестен, и
 * отправлять его в чужой сервис ради перевода — значит ломать то единственное
 * обещание, на котором стоит шифрование («сервер не читает переписку»). У Chrome
 * (138+) есть `Translator`: переводит локальная модель, текст никуда не уходит, а
 * сеть нужна только чтобы СКАЧАТЬ модель один раз.
 *
 * ГРАБЛИ, которые тут обойдены (симптом владельца: «не переводит, очень долго
 * ждал»):
 *
 *  1. Модель языка весит десятки мегабайт и качается при первом переводе — молча
 *     ждать этого нельзя. Поэтому сначала спрашиваем `availability()` (с
 *     ограничением по времени) и, если модель не готова, показываем НАДПИСЬ с
 *     кнопкой «Скачать и перевести»: человек видит, на что соглашается и что
 *     именно ждёт.
 *  2. Скачивание требует действия человека (жест), поэтому его запускает нажатие
 *     кнопки, а не первый же вызов из глубины кода.
 *  3. Любое ожидание ограничено по времени: браузер может отвечать бесконечно (в
 *     среде разработки `availability()` не отвечает вовсе), а интерфейс не должен
 *     вечно показывать «Переводим…».
 *  4. Определитель языка (`LanguageDetector`) НЕ используем: это ВТОРАЯ модель
 *     (второе скачивание из-за одного перевода), и для выбора направления хватает
 *     алфавита текста, а точный язык человек всегда может задать сам.
 */

import { reactive, ref } from 'vue'

/** Состояние перевода одного сообщения. */
export type TranslationStatus = 'running' | 'ready' | 'failed' | 'download'

export interface MessageTranslation {
  status: TranslationStatus
  /** Переведённый текст (пусто, пока переводится). */
  text: string
  /** Текст ошибки для интерфейса. */
  error?: string
  /** Язык оригинала (`en`) — как определили. */
  source: string
  /** Язык перевода (`ru`). */
  target: string
  /** Что делаем сейчас (скачивание модели, перевод) — для подписи. */
  note?: string
  /**
   * Доля скачанной модели (0…1) — показываем процентами и полоской.
   *
   * Без этого человек видит «Скачиваем модель…» без движения и не понимает,
   * ждать минуту или зависло навсегда (симптом владельца: «очень долго ждал»).
   */
  progress?: number
}

/** Языки, на которые можно перевести (в порядке частоты у нас). */
export interface TranslationTarget {
  code: string
  label: string
}

export const TRANSLATION_TARGETS: readonly TranslationTarget[] = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'uk', label: 'Українська' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'tr', label: 'Türkçe' }
]

/**
 * Ограничения ожидания (мс). Вынесены наружу, чтобы тест мог их уменьшить: ждать
 * в тесте реальные секунды незачем.
 */
export const translationTimeouts = {
  /** Сколько ждём ответ о готовности модели. */
  availabilityMs: 4000,
  /** Сколько ждём скачивание модели и сам перевод. */
  runMs: 90000
}

/** Куда помним выбранный язык перевода (настройка устройства, не аккаунта). */
const TARGET_KEY = 'pismo_translate_to'

/**
 * Почему модель не скачивается — причину называем прямо.
 *
 * Проверено живьём: в браузере ВНУТРИ VS Code (Electron, `Code/… Electron/…`)
 * `Translator.availability()` не отвечает вообще — ни «доступно», ни «недоступно»:
 * встроенный перевод Chrome там не работает, потому что нет сервиса моделей
 * (в обычном Chrome он есть, и модель скачивается один раз). В сети без доступа к
 * сервисам Google получается то же самое — поэтому различаем эти два случая, иначе
 * человек будет ждать бесконечно.
 */
const modelsUnavailableReason = (): string => {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Electron|Code\//.test(agent)) {
    return 'Встроенный перевод Chrome не работает во встроенном браузере VS Code — откройте приложение в обычном Chrome'
  }
  return 'Браузер не смог связаться со своим сервисом перевода — модель не скачивается'
}

/** Переводы по id сообщения (в памяти вкладки, на сервер не уходит). */
const translations = reactive<Record<number, MessageTranslation>>({})

/** Идущие переводы — чтобы отменить при уходе из чата или повторном запуске. */
const running = new Map<number, () => void>()

/**
 * Сообщения, у которых отмену просят «оставить блок» (крестик у полоски) —
 * в отличие от ухода из чата, где блок убираем.
 */
const keepBlock = new Set<number>()

/** Выбранный язык перевода (пустая строка — «сам подберу»). */
export const translationTarget = ref<string>('')

const readStoredTarget = (): void => {
  if (typeof localStorage === 'undefined') return
  const stored = localStorage.getItem(TARGET_KEY)
  if (stored !== null) translationTarget.value = stored
}
readStoredTarget()

/** Меняет язык перевода и запоминает выбор на устройстве. */
export const setTranslationTarget = (code: string): void => {
  translationTarget.value = code
  try {
    if (code) localStorage.setItem(TARGET_KEY, code)
    else localStorage.removeItem(TARGET_KEY)
  } catch {
    /* приватный режим — просто не помним выбор */
  }
}

/** Есть ли в браузере перевод НА УСТРОЙСТВЕ. */
export const translationSupported = (): boolean =>
  typeof (globalThis as { Translator?: unknown }).Translator === 'function'

/**
 * Предлагать ли перевод в интерфейсе: пункт меню и кнопку у расшифровки.
 *
 * Там, где встроенного переводчика нет (мобильные браузеры, WebView приложения
 * на Android, Safari и Firefox), пункта НЕТ вовсе. Раньше он показывался всегда,
 * и на телефоне нажатие упиралось в «этот браузер не умеет переводить на
 * устройстве»: человек видел тупик вместо функции.
 *
 * Почему не «починить» на таких устройствах: перевод идёт ТОЛЬКО встроенной
 * моделью браузера, текст никуда не уходит. Сторонний сервис (Google/Яндекс)
 * или перевод на нашем сервере сломали бы обещание E2EE — то же решение
 * владельца, что и в шапке файла. Поэтому честнее не обещать, а сказать об этом
 * в разделе «Устройство» (см. `utils/browserSupport.ts`).
 */
export const canOfferTranslation = (): boolean => translationSupported()

/** Текущий перевод сообщения (undefined — не переводили). */
export const translationOf = (messageId: number): MessageTranslation | undefined =>
  translations[messageId]

/** Что делает пункт «Перевести» при текущем состоянии. */
export type TranslationAction = 'translate' | 'hide' | 'cancel'

/**
 * Действие пункта по состоянию перевода.
 *
 * Как у расшифровки голосовых: пункт меню всегда значит одно и то же (переводит
 * или скрывает блок), идущий перевод — отмена, а повтор живёт в блоке под
 * сообщением («Ещё раз»).
 */
export const translationActionFor = (current?: MessageTranslation): TranslationAction => {
  if (!current) return 'translate'
  if (current.status === 'running') return 'cancel'
  return 'hide'
}

/** Убирает перевод сообщения. */
export const clearTranslation = (messageId: number): void => {
  cancelTranslation(messageId)
  delete translations[messageId]
}

/**
 * Останавливает идущий перевод И убирает блок.
 *
 * Так делают при уходе из чата или повторном запуске — там блок больше не нужен.
 * Крестик в блоке зовёт не это, а `stopTranslationWork`.
 */
export const cancelTranslation = (messageId: number): void => {
  const cancel = running.get(messageId)
  if (!cancel) return
  cancel()
  delete translations[messageId]
}

/**
 * «Перевести» одним действием: перевести, отменить идущий перевод или убрать
 * готовый блок — что именно, решает `translationActionFor`.
 *
 * Одна функция на оба входа (пункт меню у текста и кнопка под расшифровкой
 * голосового): раньше логика жила в `MessageRow.vue`, и вторая кнопка неизбежно
 * разошлась бы с первой.
 */
export const toggleTranslation = (messageId: number, text: string): void => {
  const action = translationActionFor(translations[messageId])
  if (action === 'cancel') {
    cancelTranslation(messageId)
    return
  }
  if (action === 'hide') {
    clearTranslation(messageId)
    return
  }
  void translateMessage(messageId, text)
}

/**
 * Останавливает СКАЧИВАНИЕ модели (крестик у полоски прогресса).
 *
 * Блок при этом остаётся: человек отменил только загрузку, и предложение скачать
 * модель должно быть на месте — иначе он нажал крестик и потерял весь перевод
 * (жалоба владельца: «крестик должен закрывать не всё окно, а только скачивание»).
 */
export const stopTranslationWork = (messageId: number): void => {
  const cancel = running.get(messageId)
  if (!cancel) return
  const current = translations[messageId]
  // Помечаем ДО отмены: незавершённый код ещё успеет проверить флаг и не затрёт
  // состояние, которое мы сейчас поставим.
  keepBlock.add(messageId)
  cancel()
  if (!current) return
  releasePair(pairKey(current.source, current.target))
  const wasDownloading = current.progress !== undefined || /Скачиваем/.test(current.note ?? '')
  translations[messageId] = wasDownloading
    ? { status: 'download', text: '', source: current.source, target: current.target, note: '' }
    : {
        status: 'failed',
        text: '',
        error: 'Перевод отменён',
        source: current.source,
        target: current.target
      }
}

/**
 * Останавливает все переводы и отпускает готовые переводчики.
 *
 * Вызывается при смене чата: держать модели языков в памяти браузера, когда
 * человек читает другой чат, незачем.
 */
export const cancelAllTranslations = (): void => {
  for (const cancel of Array.from(running.values())) cancel()
  for (const prepared of Array.from(translators.values())) {
    void prepared.promise.then((translator) => translator.destroy()).catch(() => undefined)
  }
  translators.clear()
}

/** Подпись перевода: «EN → RU» (для блока под сообщением). */
export const translationCaption = (state: MessageTranslation): string =>
  `${state.source.toUpperCase()} → ${state.target.toUpperCase()}`

// ------------------------------------------------------------------ внутреннее

/**
 * Устройство перевода: `Translator` из встроенных ИИ браузера.
 *
 * Типы описываем сами: в стандартных lib этот API ещё не появился.
 */
interface TranslatorInstance {
  translate: (text: string) => Promise<string>
  destroy: () => void
}

/** Наблюдатель загрузки модели: сообщает долю скачанного. */
interface ProgressMonitor extends EventTarget {
  addEventListener: (type: string, listener: (event: Event & { loaded?: number }) => void) => void
}

interface TranslatorFactory {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>
  create: (options: {
    sourceLanguage: string
    targetLanguage: string
    signal?: AbortSignal
    monitor?: (monitor: ProgressMonitor) => void
  }) => Promise<TranslatorInstance>
}

const translatorFactory = (): TranslatorFactory | null => {
  const holder = globalThis as unknown as { Translator?: TranslatorFactory }
  return typeof holder.Translator === 'function' ? holder.Translator : null
}

/** Готовый переводчик пары языков: создание (загрузка модели) стоит времени. */
interface PreparedTranslator {
  promise: Promise<TranslatorInstance>
  /** Готовый переводчик (null, пока модель качается). */
  instance: TranslatorInstance | null
}

/** Готовые переводчики по парам языков. */
const translators = new Map<string, PreparedTranslator>()

/** Пара языков для кэша переводчиков. */
const pairKey = (source: string, target: string): string => `${source}-${target}`

/**
 * Отпускает НЕЗАВЕРШЁННУЮ загрузку пары (готовый переводчик не трогаем).
 *
 * ГРАБЛЯ (симптом владельца: «после перевода на немецкий другие языки дают
 * ошибку»): раньше отмена освобождала пару целиком — вместе с уже ГОТОВЫМ
 * переводчиком. Следующий запуск брал из кэша уничтоженный объект, браузер
 * отказывался с ним работать, и человек видел «Не удалось перевести сообщение».
 * Прерванную загрузку отпускать обязательно: иначе повтор подхватит ту же
 * незавершённую задачу и снова повиснет.
 */
function releasePair(key: string): void {
  const prepared = translators.get(key)
  if (!prepared || prepared.instance) return
  translators.delete(key)
  void prepared.promise.then((translator) => translator.destroy()).catch(() => undefined)
}

/**
 * Итог ожидания: получилось, не дождались или работа упала с ошибкой.
 *
 * Ошибку НЕ подменяем заглушкой: у неё своё объяснение человеку (`NotAllowedError`
 * — «модель не скачалась»), и потерять его значит показать «не удалось перевести»
 * вместо причины.
 */
type TimeoutResult<T> =
  { ok: true; value: T } | { ok: false; reason: 'timeout' | 'error'; error?: unknown }

/**
 * Ограничивает ожидание.
 *
 * Браузерный API может не ответить ВООБЩЕ (проверено живьём в среде разработки:
 * `availability()` висит бесконечно, потому что модель качается из сети), а
 * интерфейс не должен вечно показывать «Переводим…».
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
  return new Promise<TimeoutResult<T>>((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms)
    void work.then(
      (value) => {
        window.clearTimeout(timer)
        resolve({ ok: true, value })
      },
      (error) => {
        window.clearTimeout(timer)
        resolve({ ok: false, reason: 'error', error })
      }
    )
  })
}

/**
 * Готовность модели: `available` — можно переводить сейчас, `downloadable` —
 * нужно скачать. Пустая строка — не удалось узнать (нет ответа или ошибка).
 */
async function availabilityOf(
  factory: TranslatorFactory,
  source: string,
  target: string
): Promise<string> {
  const result = await withTimeout(
    factory.availability({ sourceLanguage: source, targetLanguage: target }),
    translationTimeouts.availabilityMs
  )
  return result.ok ? result.value : ''
}
/** Догадка по алфавиту: кириллица — русский, латиница — английский. */
const scriptGuess = (text: string): string => {
  const cyrillic = (text.match(/[а-яёА-ЯЁ]/g) ?? []).length
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length
  if (cyrillic === 0 && latin === 0) return ''
  return cyrillic > latin ? 'ru' : 'en'
}

/** Язык перевода: выбранный человеком или «не русский» (для русского — английский). */
const targetFor = (source: string): string => {
  if (translationTarget.value) return translationTarget.value
  return source === 'ru' ? 'en' : 'ru'
}

/**
 * Готовит переводчик для пары языков.
 *
 * Первый перевод скачивает модель: `onProgress` сообщает долю скачанного — иначе
 * человек видит «Переводим…» без объяснения, почему так долго.
 */
function translatorFor(
  source: string,
  target: string,
  signal: AbortSignal,
  onProgress: (loaded: number) => void
): Promise<TranslatorInstance> {
  const key = pairKey(source, target)
  const cached = translators.get(key)
  if (cached) return cached.promise

  const factory = translatorFactory()
  if (!factory) return Promise.reject(new Error('Нет встроенного перевода'))

  const created = factory.create({
    sourceLanguage: source,
    targetLanguage: target,
    signal,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        const loaded = event.loaded
        if (typeof loaded === 'number') onProgress(Math.min(1, Math.max(0, loaded)))
      })
    }
  })
  const prepared: PreparedTranslator = { promise: created, instance: null }
  void created.then(
    (translator) => {
      prepared.instance = translator
    },
    // Неудачное создание не кэшируем: со второй попытки модель может быть уже
    // скачана.
    () => {
      if (translators.get(key) === prepared) translators.delete(key)
    }
  )
  translators.set(key, prepared)
  return created
}

/**
 * Переводит текст сообщения и кладёт результат в память вкладки.
 *
 * `download: true` означает «человек нажал кнопку и согласен скачать модель» —
 * только в этом случае запускаем скачивание (оно требует действия человека).
 */
export const translateMessage = async (
  messageId: number,
  text: string,
  options?: { download?: boolean }
): Promise<void> => {
  const body = (text ?? '').trim()
  if (!body) {
    translations[messageId] = {
      status: 'failed',
      text: '',
      error: 'В этом сообщении нет текста для перевода',
      source: '',
      target: ''
    }
    return
  }
  const factory = translatorFactory()
  if (!factory || !translationSupported()) {
    translations[messageId] = {
      status: 'failed',
      text: '',
      error: 'Этот браузер не умеет переводить на устройстве',
      source: '',
      target: ''
    }
    return
  }
  // Повторный запуск по тому же сообщению — начинаем заново.
  cancelTranslation(messageId)

  const controller = new AbortController()
  running.set(messageId, () => controller.abort())
  const source = scriptGuess(body)
  const target = targetFor(source)
  translations[messageId] = {
    status: 'running',
    text: '',
    source,
    target,
    note: 'Готовим перевод…'
  }

  /**
   * Проверяет отмену.
   *
   * Крестик уже показал человеку новое состояние (предложение скачать модель или
   * «Перевод отменён») — его не затираем. А вот уход из чата и повторный запуск
   * блок убирают.
   */
  const aborted = (): boolean => {
    if (!controller.signal.aborted) return false
    // Прерванная загрузка модели не должна остаться в кэше: иначе повтор честно
    // повиснет на той же самой задаче.
    releasePair(pairKey(source, target))
    if (!keepBlock.delete(messageId)) delete translations[messageId]
    return true
  }

  try {
    // Переводить текст на его же язык незачем — говорим об этом прямо.
    if (source && source === target) {
      translations[messageId] = {
        status: 'failed',
        text: '',
        error: 'Сообщение уже на этом языке',
        source,
        target
      }
      return
    }

    // ГРАБЛЯ (симптом владельца: «почему-то не скачивается»): скачивание модели
    // требует ДЕЙСТВИЯ человека. Если перед `create()` сначала ждать ответ
    // `availability()` (до 4 секунд), жест к этому моменту уже потрачен и браузер
    // загрузку не начинает. Поэтому в режиме «человек нажал кнопку» идём в
    // `create()` сразу, без промежуточных ожиданий; вопрос про готовность модели
    // задаёт только путь без согласия на загрузку.
    let availability = 'available'
    if (!options?.download) {
      availability = await availabilityOf(factory, source, target)
      if (aborted()) return
      // ГРАБЛЯ (симптом владельца: «Для этой пары языков перевода нет»): ответ
      // `unavailable` бывает УСТАРЕВШИМ — модель могла ещё не скачаться или
      // компонент обновиться. Поэтому не отказываем сразу: даём человеку нажать
      // кнопку и попробовать `create()` по-настоящему.
      if (availability !== 'available') {
        translations[messageId] = {
          status: 'download',
          text: '',
          source,
          target,
          note:
            availability === ''
              ? modelsUnavailableReason()
              : availability === 'unavailable'
                ? 'Браузер считает, что этой пары языков у него нет — попробуем загрузить модель'
                : ''
        }
        return
      }
    }

    // В режиме «человек нажал кнопку» модель качается даже если браузер успел
    // сказать «доступно»: значит, модель ещё не готова.
    const downloading = Boolean(options?.download) || availability !== 'available'
    translations[messageId] = {
      status: 'running',
      text: '',
      source,
      target,
      note: downloading ? 'Скачиваем модель перевода…' : 'Переводим…',
      progress: downloading ? 0 : undefined
    }

    const key = pairKey(source, target)
    const prepared = translatorFor(source, target, controller.signal, (loaded) => {
      if (!translations[messageId]) return
      translations[messageId] = {
        status: 'running',
        text: '',
        source,
        target,
        note: `Скачиваем модель перевода: ${Math.round(loaded * 100)}%`,
        progress: loaded
      }
    })
    const outcome = await withTimeout(prepared, translationTimeouts.runMs)
    if (aborted()) return
    if (!outcome.ok) {
      if (outcome.reason === 'error') throw outcome.error
      // Не дождались: отпускаем пару, иначе следующий запуск подхватит ту же
      // незавершённую загрузку и снова будет ждать.
      releasePair(key)
      translations[messageId] = {
        status: 'failed',
        text: '',
        error: modelsUnavailableReason(),
        source,
        target
      }
      return
    }
    if (controller.signal.aborted) return

    const translated = await outcome.value.translate(body)
    if (aborted()) return
    translations[messageId] = {
      status: 'ready',
      text: translated.trim(),
      source,
      target
    }
  } catch (thrown) {
    if (aborted()) return
    translations[messageId] = {
      status: 'failed',
      text: '',
      error: describeTranslationError(thrown),
      source,
      target
    }
  } finally {
    running.delete(messageId)
  }
}

/**
 * Ошибка перевода — словами.
 *
 * Коды браузера ничего не говорят человеку, а `NotAllowedError` приходит, когда
 * модель не скачалась (нет сети) или браузер ждёт действия пользователя.
 */
const describeTranslationError = (thrown: unknown): string => {
  const name = thrown instanceof Error ? thrown.name : ''
  const text = thrown instanceof Error ? thrown.message : String(thrown ?? '')
  if (name === 'NotAllowedError' || /not allowed|download/i.test(text)) {
    return 'Не удалось подготовить перевод — возможно, модель не скачалась'
  }
  if (name === 'NotSupportedError' || /language pair|not supported/i.test(text)) {
    return 'Для этой пары языков встроенный переводчик браузера недоступен — нужен Chrome 138+'
  }
  if (name === 'QuotaExceededError') return 'Текст слишком длинный для перевода'
  return 'Не удалось перевести сообщение'
}
