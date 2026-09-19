import { afterEach, describe, expect, it, vi } from 'vitest'

import {
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
    expect(browserLabel()).toBe('Браузер на Android')

    stubUa('Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0')
    expect(browserLabel()).toBe('Обычный браузер')
  })
})

describe('отчёт по устройству', () => {
  it('всегда отвечает по шести возможностям и в одном порядке', () => {
    expect(deviceReport().map((item) => item.key)).toEqual([
      'calls',
      'push',
      'screen',
      'speech',
      'translate',
      'playback'
    ])
  })

  it('без распознавания речи объясняет, что делать (Chrome на телефоне)', () => {
    const speech = deviceReport().find((item) => item.key === 'speech')
    expect(speech?.state).toBe('no')
    expect(speech?.text).toContain('нет распознавания речи')
    expect(speech?.hint).toContain('Chrome')
  })

  it('в браузере редактора подсказка называет причину средой', () => {
    stubUa('Mozilla/5.0 Chrome/140.0 Electron/32.0 Code/1.100')
    const speech = deviceReport().find((item) => item.key === 'speech')
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
    vi.stubGlobal('Translator', function TranslatorStub() {
      /* только статики, как у настоящего API */
    })
    const translate = deviceReport().find((item) => item.key === 'translate')
    expect(translate?.state).toBe('partial')
    expect(translate?.text).toContain('скачается при первом переводе')
    expect(translate?.hint).toContain('никуда не уходит' /* текст не уходит с устройства */)
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
    expect(playback?.hint).toContain('В текст')
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
