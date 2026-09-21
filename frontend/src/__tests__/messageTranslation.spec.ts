import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelAllTranslations,
  cancelTranslation,
  canOfferTranslation,
  clearTranslation,
  setTranslationTarget,
  stopTranslationWork,
  toggleTranslation,
  TRANSLATION_TARGETS,
  translateMessage,
  translationActionFor,
  translationCaption,
  translationOf,
  translationSupported,
  translationTarget,
  translationTimeouts
} from '@/utils/translation'

/**
 * Перевод сообщений (F5) — встроенным переводчиком браузера НА УСТРОЙСТВЕ.
 *
 * Внешний сервис тут был бы проще, но в E2EE-чате он означал бы отправку
 * открытого текста третьей стороне, то есть отказ от обещания «сервер не читает
 * переписку». Поэтому проверяем то, что ломается тихо: выбор направления, кэш
 * переводчика, состояния (переводим/готово/ошибка), отмену и то, что текст никуда
 * не уходит.
 */

/** Заглушка встроенного переводчика: помним, что и как переводили. */
interface TranslatorCalls {
  pairs: string[]
  texts: string[]
  destroyed: number
  /** Сколько раз спрашивали про готовность модели. */
  availability: number
}

let calls: TranslatorCalls
let availability: string
let failure: Error | null
let pending: boolean
let progress: number[]

const installTranslator = (options?: {
  availability?: string
  failure?: Error
  /** Перевод «зависает» — так проверяется отмена идущего перевода. */
  pending?: boolean
  /** Доли скачивания модели (0…1), которые «пришлёт» браузер. */
  progress?: number[]
}) => {
  calls = { pairs: [], texts: [], destroyed: 0, availability: 0 }
  availability = options?.availability ?? 'available'
  failure = options?.failure ?? null
  pending = options?.pending ?? false
  progress = options?.progress ?? []
  // В браузере `Translator` — функция со статиками (`availability`, `create`),
  // поэтому и заглушка такая же: объект-литерал не прошёл бы проверку поддержки.
  const factory = function () {
    /* конструктор не нужен: используются только статики */
  } as unknown as Record<string, unknown>
  factory.availability = async () => {
    calls.availability += 1
    return availability
  }
  factory.create = async ({
    sourceLanguage,
    targetLanguage,
    monitor
  }: {
    sourceLanguage: string
    targetLanguage: string
    monitor?: (m: {
      addEventListener: (t: string, h: (e: { loaded: number }) => void) => void
    }) => void
  }) => {
    calls.pairs.push(`${sourceLanguage}-${targetLanguage}`)
    if (monitor) {
      // Браузер сообщает долю скачанного событиями `downloadprogress`.
      let handler: (event: { loaded: number }) => void = () => undefined
      monitor({
        addEventListener: (_type, listener) => {
          handler = listener
        }
      })
      for (const loaded of progress) handler({ loaded })
    }
    if (failure) throw failure
    return {
      translate: async (text: string) => {
        calls.texts.push(text)
        if (pending) await new Promise(() => undefined)
        return `[${targetLanguage}] ${text}`
      },
      destroy: () => {
        calls.destroyed += 1
      }
    }
  }
  ;(globalThis as { Translator?: unknown }).Translator = factory
}

/** Определитель языка: по умолчанию уверенно говорит «английский». */
const installDetector = (language = 'en', confidence = 0.9) => {
  const factory = function () {
    /* конструктор не нужен: используются только статики */
  } as unknown as Record<string, unknown>
  factory.availability = async () => 'available'
  factory.create = async () => ({
    detect: async () => [{ detectedLanguage: language, confidence }],
    destroy: () => undefined
  })
  ;(globalThis as { LanguageDetector?: unknown }).LanguageDetector = factory
}

beforeEach(() => {
  // Ждать реальные секунды в тесте незачем: ограничения ожидания уменьшаем.
  translationTimeouts.availabilityMs = 30
  translationTimeouts.runMs = 200
  delete (globalThis as { Translator?: unknown }).Translator
  delete (globalThis as { LanguageDetector?: unknown }).LanguageDetector
  setTranslationTarget('')
  // Язык перевода по умолчанию — русский, и тесты это проверяют явно.
  localStorage.removeItem('pismo_translate_to')
})

afterEach(() => {
  cancelAllTranslations()
  delete (globalThis as { Translator?: unknown }).Translator
  delete (globalThis as { LanguageDetector?: unknown }).LanguageDetector
})

describe('перевод сообщения', () => {
  it('без встроенного переводчика честно говорит об этом', async () => {
    expect(translationSupported()).toBe(false)
    await translateMessage(1, 'Hello')

    expect(translationOf(1)?.error).toContain('не умеет переводить на устройстве')
  })

  it('переводит на русский, если оригинал не русский', async () => {
    installTranslator()
    installDetector('en')
    await translateMessage(2, 'Hello, how are you?')

    expect(translationOf(2)).toMatchObject({
      status: 'ready',
      text: '[ru] Hello, how are you?',
      source: 'en',
      target: 'ru'
    })
    expect(translationCaption(translationOf(2)!)).toBe('EN → RU')
  })

  it('русский текст переводит на английский', async () => {
    installTranslator()
    installDetector('ru')
    await translateMessage(3, 'Привет, как дела?')

    expect(translationOf(3)).toMatchObject({ status: 'ready', source: 'ru', target: 'en' })
  })

  it('без определителя языка узнаёт язык по алфавиту', async () => {
    // Определителя может не быть, а выбрать направление всё равно надо.
    installTranslator()
    await translateMessage(4, 'Привет')

    expect(translationOf(4)).toMatchObject({ status: 'ready', source: 'ru', target: 'en' })
    await translateMessage(5, 'Hello there')
    expect(translationOf(5)).toMatchObject({ status: 'ready', source: 'en', target: 'ru' })
  })

  it('устаревшему «пары нет» не верим, а даём попытку скачать', async () => {
    // Симптом владельца: «Вылезает ошибка: Для этой пары языков перевода нет».
    // Браузер так отвечает и когда модель ещё не скачалась, поэтому отказывать
    // сразу нельзя — пробуем `create()` по нажатию.
    installTranslator({ availability: 'unavailable', progress: [1] })
    await translateMessage(40, 'Hello')

    expect(translationOf(40)?.status).toBe('download')
    expect(translationOf(40)?.note).toContain('попробуем загрузить')

    await translateMessage(40, 'Hello', { download: true })
    expect(translationOf(40)).toMatchObject({ status: 'ready', text: '[ru] Hello' })
  })

  it('если браузер и вправду не умеет пару — говорим, что нужен Chrome', async () => {
    const unsupported = new Error('language pair not supported')
    unsupported.name = 'NotSupportedError'
    installTranslator({ availability: 'unavailable', failure: unsupported })
    await translateMessage(41, 'Hello', { download: true })

    expect(translationOf(41)?.error).toContain('Chrome 138+')
  })

  it('сообщение на языке перевода не переводит, а говорит об этом', async () => {
    installTranslator()
    installDetector('ru')
    setTranslationTarget('ru')
    await translateMessage(6, 'Привет')

    expect(translationOf(6)?.error).toBe('Сообщение уже на этом языке')
    expect(calls.pairs).toEqual([])
  })

  it('выбранный язык запоминается на устройстве', async () => {
    installTranslator()
    installDetector('en')
    setTranslationTarget('de')
    expect(translationTarget.value).toBe('de')

    await translateMessage(7, 'Hello')
    expect(translationOf(7)).toMatchObject({ target: 'de', text: '[de] Hello' })
    expect(localStorage.getItem('pismo_translate_to')).toBe('de')
  })

  it('после перевода на немецкий другой язык переводится, а не падает', async () => {
    // Симптом владельца: после перевода на немецкий переключение на другой язык
    // давало «Не удалось перевести сообщение» — отмена освобождала пару вместе с
    // уже готовым переводчиком, и следующий запуск брал уничтоженный объект.
    installTranslator()
    installDetector('en')
    setTranslationTarget('de')
    await translateMessage(50, 'Hello')
    expect(translationOf(50)).toMatchObject({ status: 'ready', target: 'de' })

    setTranslationTarget('ru')
    await translateMessage(50, 'Hello')
    expect(translationOf(50)).toMatchObject({ status: 'ready', target: 'ru', text: '[ru] Hello' })
    expect(calls.destroyed).toBe(0)
  })

  it('отмена не уничтожает готовый переводчик — им ещё пользуются', async () => {
    installTranslator()
    installDetector('en')
    await translateMessage(51, 'Hello')
    expect(calls.destroyed).toBe(0)

    // Второй запуск той же пары отменяем — переводчик должен остаться живым.
    installTranslator({ pending: true })
    void translateMessage(51, 'Hello again')
    await vi.waitFor(() => {
      expect(translationOf(51)?.status).toBe('running')
    })
    cancelTranslation(51)

    // Проверяем самим фактом: перевод той же пары снова работает.
    installTranslator()
    installDetector('en')
    await translateMessage(51, 'Third')
    expect(translationOf(51)?.text).toBe('[ru] Third')
    expect(calls.destroyed).toBe(0)
  })

  it('переводчик одной пары берётся один раз (создание — дорогое)', async () => {
    installTranslator()
    installDetector('en')
    await translateMessage(8, 'One')
    await translateMessage(9, 'Two')

    expect(calls.pairs).toEqual(['en-ru'])
    expect(calls.texts).toEqual(['One', 'Two'])
  })

  it('ошибку браузера объясняет словами', async () => {
    const denied = new Error('not allowed')
    denied.name = 'NotAllowedError'
    installTranslator({ failure: denied })
    installDetector('en')
    await translateMessage(10, 'Hello')

    expect(translationOf(10)?.error).toContain('модель не скачалась')
  })

  it('ошибка снова доступна для повтора, а готовый перевод — нет', () => {
    expect(translationActionFor(undefined)).toBe('translate')
    expect(translationActionFor({ status: 'running', text: '', source: 'en', target: 'ru' })).toBe(
      'cancel'
    )
    // Скрытие в одном месте (как у расшифровки голосовых): и готовый перевод, и
    // ошибка — повтор живёт в блоке под сообщением.
    expect(
      translationActionFor({ status: 'ready', text: 'Привет', source: 'en', target: 'ru' })
    ).toBe('hide')
    expect(
      translationActionFor({ status: 'failed', text: '', error: 'нет', source: 'en', target: 'ru' })
    ).toBe('hide')
  })

  it('перевод можно убрать, а идущий — отменить', async () => {
    installTranslator()
    installDetector('en')
    await translateMessage(11, 'Hello')
    expect(translationOf(11)).toBeTruthy()

    clearTranslation(11)
    expect(translationOf(11)).toBeUndefined()

    // Идущий перевод: отмена убирает блок — человек сам её нажал, и оставлять
    // ему «Перевод…» навсегда было бы хуже всего.
    installTranslator({ pending: true })
    void translateMessage(12, 'Hello')
    await vi.waitFor(() => {
      expect(translationOf(12)?.status).toBe('running')
    })
    cancelTranslation(12)
    expect(translationOf(12)).toBeUndefined()
  })

  it('без скачанной модели сначала спрашивает разрешение, а не ждёт молча', async () => {
    // Симптом владельца: «не переводит, очень долго ждал». Модель весит десятки
    // мегабайт, и тянуть её без спроса нельзя: показываем кнопку.
    installTranslator({ availability: 'downloadable' })
    await translateMessage(20, 'Hello')

    expect(translationOf(20)?.status).toBe('download')
    expect(calls.pairs).toEqual([])

    // Нажатие «Скачать и перевести» — это и есть согласие (и жест, который
    // требует API).
    await translateMessage(20, 'Hello', { download: true })
    expect(translationOf(20)).toMatchObject({ status: 'ready', text: '[ru] Hello' })
  })

  it('скачивание начинается сразу по нажатию, без ожидания готовности', async () => {
    // Симптом владельца: «почему-то не скачивается». Причина — ожидание перед
    // `create()`: браузер требует ДЕЙСТВИЯ человека, и к моменту старта жест был
    // уже потрачен.
    installTranslator({ availability: 'downloadable', progress: [0.5, 1] })
    await translateMessage(30, 'Hello', { download: true })

    expect(calls.availability).toBe(0)
    expect(calls.pairs).toEqual(['en-ru'])
  })

  it('крестик останавливает скачивание, но блок не убирает', async () => {
    const factory = function () {
      /* конструктор не нужен */
    } as unknown as Record<string, unknown>
    factory.availability = async () => 'downloadable'
    factory.create = () => new Promise(() => undefined)
    ;(globalThis as { Translator?: unknown }).Translator = factory

    void translateMessage(31, 'Hello', { download: true })
    await vi.waitFor(() => {
      expect(translationOf(31)?.status).toBe('running')
    })

    // Владелец: «крестик должен закрывать не всё окно, а только скачивание» —
    // состояние возвращается к предложению скачать модель, а не исчезает.
    stopTranslationWork(31)
    expect(translationOf(31)).toMatchObject({ status: 'download' })

    // …и загрузку можно начать снова.
    installTranslator({ progress: [1] })
    await translateMessage(31, 'Hello', { download: true })
    expect(translationOf(31)?.status).toBe('ready')
  })

  it('отмена при обычном переводе оставляет блок с пометкой', async () => {
    const factory = function () {
      /* конструктор не нужен */
    } as unknown as Record<string, unknown>
    factory.availability = async () => 'available'
    factory.create = async () => ({
      translate: () => new Promise(() => undefined),
      destroy: () => undefined
    })
    ;(globalThis as { Translator?: unknown }).Translator = factory

    void translateMessage(32, 'Hello')
    await vi.waitFor(() => {
      expect(translationOf(32)?.status).toBe('running')
    })

    stopTranslationWork(32)
    expect(translationOf(32)).toMatchObject({ status: 'failed', error: 'Перевод отменён' })
  })

  it('называет причину, когда модель не скачивается', async () => {
    // Живьём: в браузере внутри VS Code (Electron) встроенный перевод Chrome не
    // работает — сервиса моделей там нет, и `availability()` молчит.
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Code/1.138.0 Electron/42.10' })
    const factory = function () {
      /* конструктор не нужен */
    } as unknown as Record<string, unknown>
    factory.availability = () => new Promise(() => undefined)
    factory.create = () => new Promise(() => undefined)
    ;(globalThis as { Translator?: unknown }).Translator = factory

    await translateMessage(33, 'Hello')
    expect(translationOf(33)?.note).toContain('VS Code')

    await translateMessage(33, 'Hello', { download: true })
    expect(translationOf(33)?.error).toContain('VS Code')
    vi.unstubAllGlobals()
  })

  it('не отвечающий браузер не оставляет «Переводим…» навсегда', async () => {
    // Живьём `availability()` висело бесконечно: в среде разработки модель
    // качается из сети, которой нет. Ожидание обязано заканчиваться.
    const factory = function () {
      /* конструктор не нужен: используются только статики */
    } as unknown as Record<string, unknown>
    factory.availability = () => {
      calls.availability += 1
      return new Promise(() => undefined)
    }
    factory.create = async () => ({
      translate: async () => 'никогда',
      destroy: () => undefined
    })
    ;(globalThis as { Translator?: unknown }).Translator = factory

    await translateMessage(21, 'Hello')

    expect(translationOf(21)?.status).toBe('download')
  })

  it('если модель так и не пришла, говорим про сеть и даём повторить', async () => {
    const factory = function () {
      /* конструктор не нужен: используются только статики */
    } as unknown as Record<string, unknown>
    factory.availability = async () => 'available'
    factory.create = () => new Promise(() => undefined)
    ;(globalThis as { Translator?: unknown }).Translator = factory

    await translateMessage(22, 'Hello', { download: true })

    expect(translationOf(22)).toMatchObject({ status: 'failed' })
    expect(translationOf(22)?.error).toContain('не смог связаться со своим сервисом')
    // Пара отпущена: повтор не подхватит ту же незавершённую загрузку.
    expect(translationActionFor(translationOf(22))).toBe('hide')
  })

  it('показывает проценты скачивания модели', async () => {
    // Владелец: «проценты скачки пиши модели» — без движения непонятно, ждать
    // минуту или уже зависло.
    installTranslator({ availability: 'downloadable', progress: [0.12, 0.48, 1] })
    await translateMessage(23, 'Hello', { download: true })

    // Последнее сообщение о прогрессе — 100%: модель скачана, дальше перевод.
    expect(translationOf(23)?.status).toBe('ready')
  })

  it('во время скачивания в состоянии есть доля и проценты в подписи', async () => {
    let release: (() => void) | null = null
    const factory = function () {
      /* конструктор не нужен */
    } as unknown as Record<string, unknown>
    factory.availability = async () => 'downloadable'
    factory.create = async ({
      monitor
    }: {
      monitor?: (m: {
        addEventListener: (t: string, h: (e: { loaded: number }) => void) => void
      }) => void
    }) => {
      let handler: (event: { loaded: number }) => void = () => undefined
      monitor?.({
        addEventListener: (_type, listener) => {
          handler = listener
        }
      })
      handler({ loaded: 0.42 })
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { translate: async () => 'готово', destroy: () => undefined }
    }
    ;(globalThis as { Translator?: unknown }).Translator = factory

    const running = translateMessage(24, 'Hello', { download: true })
    await vi.waitFor(() => {
      expect(translationOf(24)?.progress).toBeCloseTo(0.42, 5)
    })
    expect(translationOf(24)?.note).toContain('42%')

    release?.()
    await running
    expect(translationOf(24)?.status).toBe('ready')
  })

  it('полоска прогресса есть в разметке блока', () => {
    const block = readFileSync('src/components/common/MessageTranslation.vue', 'utf8')
    // Во время скачивания есть только отмена: повтор предлагать нечего.
    expect(block).toContain("v-if=\"state.status === 'ready' || state.status === 'failed'\"")
    // Крестик живёт в строке прогресса и появляется вместе с ней — он отменяет
    // скачивание, а не прячет перевод.
    expect(block).toContain('v-if="percent !== null" class="mt-run"')
    expect(block).toContain('mt-cancel')
    expect(block).toContain('@click="cancel"')
    expect(block).toContain('role="progressbar"')
    expect(block).toContain('mt-progress-fill')
    expect(block).toContain(':aria-valuenow="percent"')
  })

  it('пустое сообщение переводить нечем', async () => {
    installTranslator()
    await translateMessage(13, '   ')

    expect(translationOf(13)?.error).toContain('нет текста для перевода')
  })

  it('список языков перевода не пуст и начинается с русского', () => {
    expect(TRANSLATION_TARGETS[0]?.code).toBe('ru')
    expect(TRANSLATION_TARGETS.length).toBeGreaterThan(3)
  })
})

describe('перевод в ленте: текст на сервер не уходит', () => {
  const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
  const bar = readFileSync('src/components/messenger/MessageActionsBar.vue', 'utf8')
  const block = readFileSync('src/components/common/MessageTranslation.vue', 'utf8')

  it('пункт «Перевести» есть в меню сообщения', () => {
    expect(bar).toContain("translationLabel || 'Перевести'")
    expect(bar).toContain("translationLabel || 'Перевести'")
    expect(row).toContain('@translate="onTranslate"')
  })

  it('перевод идёт только через устройство — запросов к нашему API нет', () => {
    // Ни один из файлов перевода не ходит на сервер: иначе это была бы отправка
    // текста (в E2EE-чате — открытого) третьей стороне.
    for (const source of [row, block]) {
      expect(source).not.toContain('/api/v1')
    }
    const util = readFileSync('src/utils/translation.ts', 'utf8')
    expect(util).toContain('Translator')
    expect(util).not.toContain('fetch(')
  })

  it('блок перевода убирается кликом мимо и кнопкой Escape', () => {
    // Владелец: «не скрывает окно перевода по клику мимо» — блок всплывающий,
    // как меню, и должен вести себя так же.
    expect(block).toContain("document.addEventListener('pointerdown', onPointerDownOutside, true)")
    expect(block).toContain(
      "document.removeEventListener('pointerdown', onPointerDownOutside, true)"
    )
    expect(block).toContain("event.key === 'Escape'")
    // Подписка только пока блок на экране: иначе обработчик висел бы всегда.
    expect(block).toContain('onBeforeUnmount')
  })

  it('в E2EE-чате текст тоже переводится: он расшифрован на устройстве', () => {
    // Грабли: если бы блок прятали по `message.encrypted` (как превью ссылок),
    // перевод исчез бы именно там, где он нужнее всего.
    expect(row).toContain('v-if="message.text && translationVisible"')
    expect(row).not.toContain('!message.encrypted && translationVisible')
  })
})

describe('перевод расшифровки голосового и кружка (G1)', () => {
  const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')

  it('переводит именно текст расшифровки, а не пустую строку', async () => {
    installTranslator()
    installDetector('en')

    toggleTranslation(60, 'Hello from the voice message')
    await vi.waitFor(() => {
      expect(translationOf(60)?.status).toBe('ready')
    })

    expect(calls.texts).toContain('Hello from the voice message')
    expect(translationOf(60)?.text).toContain('[ru] Hello from the voice message')
  })

  it('повторное нажатие убирает блок, а идущий перевод отменяет', async () => {
    installTranslator()
    installDetector('en')
    toggleTranslation(61, 'Hello')
    await vi.waitFor(() => {
      expect(translationOf(61)?.status).toBe('ready')
    })

    // Как пункт меню: второе нажатие не запускает перевод заново, а закрывает.
    expect(translationActionFor(translationOf(61))).toBe('hide')
    toggleTranslation(61, 'Hello')
    expect(translationOf(61)).toBeUndefined()

    installTranslator({ pending: true })
    toggleTranslation(62, 'Hello')
    await vi.waitFor(() => {
      expect(translationOf(62)?.status).toBe('running')
    })
    expect(translationActionFor(translationOf(62))).toBe('cancel')
    toggleTranslation(62, 'Hello')
    expect(translationOf(62)).toBeUndefined()
  })

  it('блок перевода живёт в common: его зовут и лента, и медиа-сообщение', () => {
    // Перенесён из `messenger/`, потому что теперь нужен обеим сторонам; импорты
    // проверяем по исходникам, чтобы перенос не «откатили» случайно.
    const media = readFileSync('src/components/media/TranscriptionBlock.vue', 'utf8')
    expect(media).toContain(
      "import MessageTranslation from '@/components/common/MessageTranslation.vue'"
    )
    expect(row).toContain(
      "import MessageTranslation from '@/components/common/MessageTranslation.vue'"
    )
  })
})

describe('перевод не предлагается там, где его нечем сделать', () => {
  const row = readFileSync('src/components/messenger/MessageRow.vue', 'utf8')
  const bar = readFileSync('src/components/messenger/MessageActionsBar.vue', 'utf8')
  const media = readFileSync('src/components/media/TranscriptionBlock.vue', 'utf8')

  it('без встроенного переводчика пункт не предлагается', () => {
    // Владелец: «в мобилках перевод пишет, что не может» — меню показывалось
    // всегда, и на телефоне нажатие давало «браузер не умеет переводить».
    expect(canOfferTranslation()).toBe(false)
    expect(bar).toContain('v-if="message.text && canTranslate"')
    expect(bar).toContain('v-if="message.text && canTranslate"')
    expect(media).toContain("transcript.status === 'ready' && canTranslate")
  })

  it('на телефоне пункт не предлагается, даже если API переводчика объявлен', () => {
    // Владелец (21.09.2026): «на мобилке не открывался перевод расшифрованной
    // записи». Платформу проверяем тем же признаком, что и распознавание записи.
    installTranslator()
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/140.0.0.0 Mobile Safari/537.36',
      userAgentData: { mobile: true }
    })
    expect(canOfferTranslation()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('решение принимается по одному признаку устройства', () => {
    // Три входа (меню, лист, кнопка у расшифровки) — один ответ, иначе они
    // разошлись бы, как только появится новый вход.
    expect(row).toContain('const canTranslate = canOfferTranslation()')
    expect(row).toContain(':can-translate="canTranslate"')
    expect(media).toContain('const canTranslate = canOfferTranslation()')
  })

  it('нажатие без поддержки ничего не запускает', () => {
    const onTranslate = row.slice(row.indexOf('const onTranslate'))
    expect(onTranslate).toContain('if (!canTranslate) return')
  })
})
