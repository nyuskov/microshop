import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  androidBrowser,
  browserLabel,
  deviceReport,
  isEmbeddedBrowser,
  supportSummary,
  voicePlaybackSupport
} from '@/utils/browserSupport'

/**
 * Раздел «Устройство» (G3): что умеет ИМЕННО этот браузер.
 *
 * Проверки здесь дешёвые (наличие API, а не работа сервисов), но именно они
 * отвечают на частые «у меня не работает»: во встроенном браузере VS Code нет
 * ни моделей Chrome, ни распознавания, в WebView нет показа экрана. Поэтому
 * тест подменяет окружение и смотрит, что в отчёте появится честная причина и
 * подсказка, а не общее «не поддерживается».
 */

const originalUserAgent = navigator.userAgent

const stubUa = (ua: string) => {
  vi.stubGlobal('navigator', { ...navigator, userAgent: ua })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: originalUserAgent
  })
})

describe('признаки встроенного браузера', () => {
  it('узнаёт браузер VS Code и оболочки на Electron', () => {
    expect(isEmbeddedBrowser('Mozilla/5.0 Chrome/140.0 Electron/32.0 Code/1.100')).toBe(true)
    expect(isEmbeddedBrowser('Mozilla/5.0 (X11; Linux) Electron/30.0')).toBe(true)
  })

  it('узнаёт WebView приложения и браузер внутри соцсети', () => {
    expect(
      isEmbeddedBrowser('Mozilla/5.0 (Linux; Android 13; PismoApp/1.0; wv) AppleWebKit/537.36')
    ).toBe(true)
    expect(isEmbeddedBrowser('Mozilla/5.0 (iPhone) Instagram 300.0')).toBe(true)
  })

  it('обычный браузер встроенным не считает', () => {
    expect(isEmbeddedBrowser('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36')).toBe(
      false
    )
  })

  it('шапка отчёта называет среду словами', () => {
    stubUa('Mozilla/5.0 Chrome/140.0 Electron/32.0')
    expect(browserLabel()).toBe('Встроенный браузер (не Chrome)')

    stubUa('Mozilla/5.0 (Linux; Android 13) Chrome/140.0')
    expect(browserLabel()).toBe('Chrome на Android')

    stubUa('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0')
    expect(browserLabel()).toBe('Обычный браузер')
  })

  it('различает браузеры Android: у них разные возможности', () => {
    // Владелец: «на Redmi A3 не появляется как приложение установить» — у Xiaomi,
    // в отличие от Chrome, пункта установки нет, и раздел должен это знать.
    const ua = (s: string) => s
    expect(
      androidBrowser(
        ua(
          'Mozilla/5.0 (Linux; Android 14; Redmi A3) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'
        )
      )
    ).toBe('chrome')
    expect(
      androidBrowser(
        ua(
          'Mozilla/5.0 (Linux; U; Android 14; ru-ru; Redmi A3 Build/UP1A) AppleWebKit/537.36 Version/4.0 Chrome/119.0.6045.66 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.1.3'
        )
      )
    ).toBe('miui')
    expect(
      androidBrowser(
        ua('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36')
      )
    ).toBe('samsung')
    expect(
      androidBrowser(
        ua(
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 YaBrowser/24.7 Mobile Safari/537.36'
        )
      )
    ).toBe('yandex')
    expect(
      androidBrowser(ua('Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0'))
    ).toBe('firefox')
    expect(androidBrowser(ua('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36'))).toBe('other')

    stubUa(
      'Mozilla/5.0 (Linux; U; Android 14; ru-ru; Redmi A3) AppleWebKit/537.36 Chrome/119.0 XiaoMi/MiuiBrowser/18.1.3'
    )
    expect(browserLabel()).toBe('Mi Browser на Android')
  })
})

describe('отчёт по устройству', () => {
  it('всегда отвечает по семи возможностям и в одном порядке', () => {
    expect(deviceReport().map((item) => item.key)).toEqual([
      'calls',
      'push',
      'install',
      'screen',
      'speech',
      'translate',
      'playback'
    ])
  })

  it('на iPhone называет единственный путь: Safari и «Поделиться»', () => {
    // Владелец: «в некоторых мобильных нельзя установить как приложение» —
    // на iPhone кнопки установки нет вовсе, есть только Safari и «На экран \"Домой\"».
    stubUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/605.1.15')
    const item = deviceReport().find((row) => row.key === 'install')
    expect(item?.state).toBe('partial')
    expect(item?.text).toContain('Safari')
    expect(item?.hint).toContain('Поделиться')
    expect(item?.hint).toContain('Домой')
  })

  it('во встроенном браузере предлагает открыть обычный', () => {
    stubUa('Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile')
    const item = deviceReport().find((row) => row.key === 'install')
    expect(item?.state).toBe('partial')
    expect(item?.text).toContain('нельзя')
    expect(item?.hint).toContain('Chrome')
  })

  it('в Chrome на Android называет пункт меню, а не путь RuStore', () => {
    stubUa(
      'Mozilla/5.0 (Linux; Android 14; Redmi A3) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'
    )
    const item = deviceReport().find((row) => row.key === 'install')
    expect(item?.text).toContain('Chrome')
    expect(item?.hint).toContain('Установить приложение')
    expect(item?.hint).not.toContain('RuStore')
  })

  it('на Xiaomi (Mi Browser) не обещает пункт, которого нет', () => {
    stubUa(
      'Mozilla/5.0 (Linux; U; Android 14; ru-ru; Redmi A3) AppleWebKit/537.36 Chrome/119.0 XiaoMi/MiuiBrowser/18.1.3'
    )
    const item = deviceReport().find((row) => row.key === 'install')
    expect(item?.text).toContain('может не показать')
    expect(item?.hint).toContain('Chrome')
    // На телефоне без Chrome (китайские прошивки) остаётся RuStore-приложение.
    expect(item?.hint).toContain('RuStore')
  })

  it('в установленном приложении установка уже не требуется', () => {
    vi.stubGlobal('window', {
      ...globalThis.window,
      matchMedia: (query: string) => ({ matches: query.includes('standalone') })
    })
    const item = deviceReport().find((row) => row.key === 'install')
    expect(item?.state).toBe('ok')
    expect(item?.hint).toBe('')
  })

  it('модель на устройстве: расшифровка есть, но модель скачается один раз', () => {
    // Так на телефоне: Web Speech умеет только микрофон, поэтому считаем моделью,
    // скачанной в браузер. Это не «работает» и не «недоступно», а «с оговоркой».
    const speech = deviceReport().find((item) => item.key === 'speech')
    expect(speech?.state).toBe('partial')
    expect(speech?.text).toContain('на устройстве')
    expect(speech?.hint).toContain('МБ')
    expect(speech?.hint).toContain('остаются на устройстве')
  })

  it('Chrome на компьютере распознаёт запись и предупреждает про сервис браузера', () => {
    stubUa('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36')
    vi.stubGlobal('SpeechRecognition', function RecognitionStub() {
      /* только наличие — как в браузере */
    })
    const speech = deviceReport().find((item) => item.key === 'speech')
    expect(speech?.state).toBe('ok')
    expect(speech?.text).toContain('сервис браузера')
    expect(speech?.hint).toBe('')
  })

  it('в приложении распознаёт распознаватель устройства', () => {
    stubUa(
      'Mozilla/5.0 (Linux; Android 13; PismoAndroid/1.0; wv) Chrome/140.0.0.0 Mobile Safari/537.36'
    )
    vi.stubGlobal('PismoNative', {
      speechSupported: () => true,
      speechBegin: () => true,
      speechChunk: () => undefined
    })
    const speech = deviceReport().find((item) => item.key === 'speech')
    expect(speech?.state).toBe('ok')
    expect(speech?.text).toContain('распознаватель устройства')
  })

  it('распознать нечем: без WebAssembly и без распознавателя — говорим причину', () => {
    stubUa('Mozilla/5.0 Chrome/140.0 Electron/32.0 Code/1.100')
    vi.stubGlobal('WebAssembly', undefined)
    const speech = deviceReport().find((item) => item.key === 'speech')
    expect(speech?.state).toBe('no')
    expect(speech?.text).toContain('нет распознавания речи')
    expect(speech?.hint).toContain('встроенном браузере')
  })

  it('без встроенного переводчика говорит, какой браузер нужен', () => {
    const translate = deviceReport().find((item) => item.key === 'translate')
    expect(translate?.state).toBe('no')
    expect(translate?.hint).toContain('Chrome 138+')
  })

  it('с переводчиком честно предупреждает про скачивание модели', () => {
    // Модель скачивается только по нажатию (жест человека) — раздел не должен
    // обещать «уже готово».
    stubUa('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36')
    vi.stubGlobal('Translator', function TranslatorStub() {
      /* только статики, как у настоящего API */
    })
    const translate = deviceReport().find((item) => item.key === 'translate')
    expect(translate?.state).toBe('partial')
    expect(translate?.text).toContain('скачается при первом переводе')
    expect(translate?.hint).toContain('никуда не уходит' /* текст не уходит с устройства */)
  })

  it('в мобильном браузере перевода нет, даже если API объявлен', () => {
    // Владелец: «на мобилке не открывался перевод расшифрованной записи» —
    // предложение считается по платформе, как и у распознавания записи.
    stubUa('Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/140.0.0.0 Mobile Safari/537.36')
    vi.stubGlobal('Translator', function TranslatorStub() {
      /* API есть, а перевода на устройстве нет */
    })
    const translate = deviceReport().find((item) => item.key === 'translate')
    expect(translate?.state).toBe('no')
    expect(translate?.hint).toContain('компьютере')
  })

  it('проигрывание записей проверяется через canPlayType, а не по вере', () => {
    const spy = vi
      .spyOn(HTMLMediaElement.prototype, 'canPlayType')
      .mockImplementation((type: string) => (type.includes('opus') ? 'probably' : ''))
    expect(voicePlaybackSupport()).toBe(true)
    expect(deviceReport().find((item) => item.key === 'playback')?.state).toBe('ok')

    spy.mockReturnValue('')
    expect(voicePlaybackSupport()).toBe(false)
    const playback = deviceReport().find((item) => item.key === 'playback')
    expect(playback?.state).toBe('no')
    // Выход из положения назван: расшифровка текстом.
    expect(playback?.hint).toContain('расшифровать в текст')
  })

  it('все «недоступно» сопровождаются подсказкой, а «работает» — нет', () => {
    for (const item of deviceReport()) {
      if (item.state === 'ok') expect(item.hint).toBe('')
      else expect(item.hint.length).toBeGreaterThan(10)
    }
  })

  it('сводка считает состояния, не показывая лишнего', () => {
    expect(
      supportSummary([
        { key: 'calls', title: '', state: 'ok', text: '', hint: '' },
        { key: 'push', title: '', state: 'partial', text: '', hint: '' },
        { key: 'screen', title: '', state: 'no', text: '', hint: '' }
      ])
    ).toBe('работает: 1 · с оговоркой: 1 · недоступно: 1')
    expect(supportSummary([{ key: 'calls', title: '', state: 'ok', text: '', hint: '' }])).toBe(
      'работает: 1'
    )
  })
})

describe('раздел «Устройство» в настройках профиля', () => {
  it('пункт есть в списке разделов и грузится лениво', async () => {
    const { readFileSync } = await import('node:fs')
    const profile = readFileSync('src/views/UserProfile.vue', 'utf8')
    expect(profile).toContain("key: 'device'")
    expect(profile).toContain('@/components/messenger/DeviceSettings.vue')
    // Ленивый — как «Технические работы» и «Внешний вид»: профиль большой.
    expect(profile).toContain('const DeviceSettings = defineAsyncComponent(')
    expect(profile).toContain('<div v-if="section === \'device\'" class="settings-embed">')
  })

  it('отчёт показывается словами и не ходит в сеть', async () => {
    const { readFileSync } = await import('node:fs')
    const util = readFileSync('src/utils/browserSupport.ts', 'utf8')
    const component = readFileSync('src/components/messenger/DeviceSettings.vue', 'utf8')
    // Никаких запросов: проверяем только наличие возможностей.
    expect(util).not.toContain('fetch(')
    expect(util).not.toContain('/api/')
    expect(component).toContain('deviceReport()')
    expect(component).toContain('supportSummary')
    // Состояние подписано словами, а не только цветом: цвет один ничего не значит
    // для того, кто не различает оттенки.
    expect(component).toContain('работает')
    expect(component).toContain('недоступно')
  })
})
